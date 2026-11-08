/* BEYBLADE X Radar v0.4.3 - live draw screen + persistent product slot. */
(() => {
  'use strict';

  const STORAGE = {
    events: 'bxxr:v1:events',
    products: 'bxxr:v1:products',
    progress: 'bxxr:v1:progress',
    queue: 'bxxr:v1:queue-mode',
    notification: 'bxxr:v1:notification',
    lineClicks: 'bxxr:v1:line-clicks',
    slotLastProduct: 'bxxr:v1:slot-last-product'
  };
  const DEFAULT_REGION = 'TW-TXG';
  const DIRECTORY_URL = 'https://beybuilder.5-seven.dog/draw/';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const safeUrl = value => {
    try { const url = new URL(String(value || '')); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; }
    catch { return ''; }
  };
  const nowIso = () => new Date().toISOString();
  const readStorage = (key, fallback) => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
  const writeStorage = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { toast('無法儲存：瀏覽器儲存空間可能已滿。', 'error'); return false; } };
  const readSession = key => { try { return sessionStorage.getItem(key); } catch { return null; } };
  const writeSession = (key, value) => { try { sessionStorage.setItem(key, value); } catch { /* optional */ } };
  const removeSession = key => { try { sessionStorage.removeItem(key); } catch { /* optional */ } };
  const formatTaipei = value => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('zh-TW', { timeZone:'Asia/Taipei', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).format(date);
  };
  const money = value => value === null || value === undefined || value === '' ? '價格尚未確認' : `NT$ ${Number(value).toLocaleString('zh-TW')}`;

  const state = {
    regions: [], stores: [], products: [], events: [], notSellingStoreIds: [], drawSources: [],
    updatedAt: null, activeRegion: DEFAULT_REGION, activeTab: 'funbox', query: '',
    productCode: 'all', timeSlot: 'all', queueMode: false, pendingEventId: null,
    appInstallPrompt: null, wasHidden: false, slotSpinning: false, slotLastProduct: null
  };

  async function loadJson(path, fallback) {
    try {
      const response = await fetch(`${path}?v=0.4.3`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.warn(`無法載入 ${path}`, error);
      return fallback;
    }
  }

  function normalizeEventData(data) {
    if (Array.isArray(data)) return { events: data, notSellingStoreIds: [], updatedAt: null };
    if (data && typeof data === 'object') {
      return {
        events: Array.isArray(data.events) ? data.events : [],
        notSellingStoreIds: Array.isArray(data.notSellingStoreIds) ? data.notSellingStoreIds : [],
        updatedAt: data.updatedAt || data.lastUpdated || null
      };
    }
    return { events: [], notSellingStoreIds: [], updatedAt: null };
  }

  async function init() {
    const [regions, stores, products, eventData, metadata, drawSources] = await Promise.all([
      loadJson('data/regions.json', []),
      loadJson('data/stores.json', []),
      loadJson('data/products.json', []),
      loadJson('data/draw-events.json', []),
      loadJson('data/source-metadata.json', {}),
      loadJson('data/draw-sources.json', { sources: [] })
    ]);
    state.regions = Array.isArray(regions) ? regions : [];
    state.stores = Array.isArray(stores) ? stores : [];
    state.products = Array.isArray(readStorage(STORAGE.products, null)) ? readStorage(STORAGE.products, null) : (Array.isArray(products) ? products : []);
    const savedEvents = readStorage(STORAGE.events, null);
    const normalized = normalizeEventData(eventData);
    state.events = Array.isArray(savedEvents) ? savedEvents : normalized.events;
    state.notSellingStoreIds = normalized.notSellingStoreIds;
    state.drawSources = Array.isArray(drawSources?.sources) ? drawSources.sources : [];
    state.updatedAt = metadata.importedAt || null;
    state.queueMode = !!readStorage(STORAGE.queue, false);
    state.slotLastProduct = readStorage(STORAGE.slotLastProduct, null);
    readUrlState();
    bindEvents();
    renderAll();
    registerServiceWorker();
    if ('Notification' in window && Notification.permission === 'granted' && readStorage(STORAGE.notification, false)) {
      $('#notificationStatus').textContent = '通知權限已開啟';
    }
    checkPendingReturn();
  }

  function readUrlState() {
    const params = new URLSearchParams(location.search);
    const region = params.get('region');
    const city = params.get('c');
    if (region && knownRegion(region)) state.activeRegion = region;
    else if (city) {
      const match = uniqueRegions().find(item => item.name === city);
      if (match) state.activeRegion = match.regionId;
    }
    if (params.get('tab') === 'eslite') state.activeTab = 'eslite';
    state.query = params.get('q') || '';
  }

  function knownRegion(regionId) { return regionId === 'all' || uniqueRegions().some(item => item.regionId === regionId); }
  function uniqueRegions() {
    const byId = new Map();
    for (const store of state.stores) {
      const id = store.regionId || 'TW-UNK';
      if (!byId.has(id)) byId.set(id, { regionId:id, name:store.regionName || '待指定縣市' });
    }
    return [...byId.values()].sort((a,b) => {
      if (a.regionId === DEFAULT_REGION) return -1;
      if (b.regionId === DEFAULT_REGION) return 1;
      return a.name.localeCompare(b.name, 'zh-Hant');
    });
  }

  function updateUrl() {
    const params = new URLSearchParams();
    if (state.activeRegion !== 'all') params.set('region', state.activeRegion);
    if (state.activeTab !== 'funbox') params.set('tab', state.activeTab);
    if (state.query.trim()) params.set('q', state.query.trim());
    const query = params.toString();
    history.replaceState({}, '', `${location.pathname}${query ? `?${query}` : ''}`);
  }

  function bindEvents() {
    $('#regionSelect').addEventListener('change', event => {
      state.activeRegion = event.target.value;
      renderAll();
      updateUrl();
    });
    $('#searchInput').addEventListener('input', event => {
      state.query = event.target.value.trimStart();
      $('#clearSearch').hidden = !state.query;
      renderStores(); renderEvents(); renderProducts(); updateDirectoryLink();
      updateUrl();
    });
    $('#clearSearch').addEventListener('click', () => {
      state.query = ''; $('#searchInput').value = ''; $('#clearSearch').hidden = true;
      renderStores(); renderEvents(); renderProducts(); updateDirectoryLink(); updateUrl();
    });
    $$('.main-tab').forEach(button => button.addEventListener('click', () => setTab(button.dataset.tab)));
    $('#productFilter').addEventListener('change', event => { state.productCode = event.target.value; renderEvents(); });
    $('#timeFilter').addEventListener('change', event => { state.timeSlot = event.target.value; renderEvents(); });
    $$('.mode-button').forEach(button => button.addEventListener('click', () => {
      state.queueMode = button.dataset.mode === 'queue';
      writeStorage(STORAGE.queue, state.queueMode);
      updateModeButtons(); renderEvents();
    }));
    $('#settingsOpen').addEventListener('click', () => $('#settingsDialog').showModal());
    $('#spinProduct').addEventListener('click', spinProductSlot);
    $('#livePreviewDetails').addEventListener('toggle', () => {
      const details = $('#livePreviewDetails');
      const frame = $('#liveDrawFrame');
      if (details.open && frame) {
        const url = frame.dataset.src || 'https://uxux11.github.io/funbox-line/#:~:text=%E6%8A%BD%E9%81%B8%E6%A8%A1%E5%BC%8F';
        if (frame.getAttribute('src') !== url) frame.setAttribute('src', url);
      }
    });
    $$('[data-close]').forEach(button => button.addEventListener('click', () => $('#' + button.dataset.close).close()));
    $('#exportButton').addEventListener('click', exportBackup);
    $('#importInput').addEventListener('change', importBackup);
    $('#clearLineClicks').addEventListener('click', resetLineClicks);
    $('#enableNotifications').addEventListener('click', enableNotifications);
    $('#addEventButton').addEventListener('click', openEventDialog);
    $('#addProductButton').addEventListener('click', openProductDialog);
    $('#eventForm').addEventListener('submit', saveEvent);
    $('#productForm').addEventListener('submit', saveProduct);
    $('#markComplete').addEventListener('click', () => finishEventProgress('complete'));
    $('#markPending').addEventListener('click', () => finishEventProgress('pending'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') state.wasHidden = true;
      if (document.visibilityState === 'visible' && state.wasHidden) { state.wasHidden = false; checkPendingReturn(); }
    });
    window.addEventListener('pageshow', checkPendingReturn);
    window.addEventListener('focus', () => { if (readSession('bxxr:v04:pending-event')) checkPendingReturn(); });
    window.addEventListener('popstate', () => { readUrlState(); syncControls(); renderAll(); });
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('service-worker.js').catch(error => console.warn('Service worker register failed', error));
    }
  }

  function setTab(tab, shouldScroll = true) {
    state.activeTab = tab;
    $$('.main-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
    $('#view-funbox').classList.toggle('active', tab === 'funbox');
    $('#view-funbox').hidden = tab !== 'funbox';
    $('#view-eslite').classList.toggle('active', tab === 'eslite');
    $('#view-eslite').hidden = tab !== 'eslite';
    updateUrl();
    if (shouldScroll) window.scrollTo({ top:0, behavior:'smooth' });
    if (tab === 'eslite') renderProducts();
  }

  function shortDate(value) {
    if (!value) return '';
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[2]}/${match[3]}` : String(value);
  }

  function renderLatestBatch() {
    const source = state.drawSources.find(item => item.id === 'uxux11');
    const host = $('#latestBatchSummary');
    if (!host) return;
    if (!source) {
      host.innerHTML = `<div class="latest-batch-copy"><span class="kicker">LATEST DRAW BATCH</span><h2>最新抽選來源暫時無法讀取</h2><p>可以直接開啟 UXUX11 原始頁面查看最新公告。</p></div>`;
      return;
    }
    const range = source.batchStartDate && source.batchEndDate
      ? `${shortDate(source.batchStartDate)} – ${shortDate(source.batchEndDate)}`
      : '日期以原始頁面為準';
    const update = source.lastPageUpdate ? formatTaipei(source.lastPageUpdate) : '更新時間未提供';
    const expired = source.snapshotStatus === 'expired' || (source.batchEndDate && new Date(`${source.batchEndDate}T23:59:59+08:00`).getTime() < Date.now());
    const statusText = expired ? '最近一批已結束' : source.snapshotStatus === 'historical' ? '歷史批次' : '來源有最新批次';
    const statusClass = expired ? 'closed' : 'open';
    const count = source.drawBatchStoreCount ? `${source.drawBatchStoreCount} 家門市` : '門市數以來源為準';
    const noSale = source.notSellingStoreCount ? `${source.notSellingStoreCount} 家列為本週未販售` : '';
    const drawUrl = safeUrl(source.drawScreenUrl) || safeUrl(source.url) || 'https://uxux11.github.io/funbox-line/';
    host.href = drawUrl;
    const primaryLink = $('#primaryDrawLink');
    const fullScreenLink = $('#fullScreenDrawLink');
    const frame = $('#liveDrawFrame');
    if (primaryLink) primaryLink.href = drawUrl;
    if (fullScreenLink) fullScreenLink.href = drawUrl;
    if (frame) {
      frame.dataset.src = drawUrl;
      if ($('#livePreviewDetails')?.open && frame.getAttribute('src') !== drawUrl) frame.setAttribute('src', drawUrl);
    }
    const products = (Array.isArray(source.lastBatchProducts) ? source.lastBatchProducts : [])
      .map(product => `${product.code || product.productCode || ''} ${product.name || product.nameZh || ''}`.trim())
      .filter(Boolean);
    const productText = products.length ? products.join('、') : '商品清單以原始抽選頁為準';
    host.innerHTML = `
      <div class="latest-batch-top"><span class="pill ${statusClass}">${esc(statusText)}</span><span class="latest-source-name">${esc(source.name)}</span></div>
      <div class="latest-batch-copy"><span class="kicker">LATEST DRAW BATCH · 點擊進入抽選</span><h2>${esc(range)} 抽選批次</h2><p>最後核對更新：${esc(update)}（台灣時間）</p><p class="latest-batch-products"><b>商品：</b>${esc(productText)}</p></div>
      <div class="latest-batch-stats"><div><strong>${esc(count)}</strong><span>最近批次門市數</span></div>${noSale ? `<div><strong>${esc(noSale)}</strong><span>來源附帶資訊</span></div>` : ''}</div>
      <p class="latest-batch-disclaimer">點擊卡片直接進入原站抽選畫面。此處顯示最後核對的批次快照；有新批次時，以原站即時畫面為準。</p>`;
  }

  function renderAll() {
    renderRegionSelect();
    syncControls();
    renderLatestBatch();
    renderStores();
    renderEvents();
    renderProducts();
    renderProductSlot();
    setTab(state.activeTab, false);
    const meta = state.updatedAt ? `門市更新 ${formatTaipei(state.updatedAt)}` : '門市資料以 Google Sheet 同步版本為準';
    $('#footerMeta').textContent = meta;
    $('#dataState').textContent = state.stores.length ? `${state.stores.length} 家門市` : '門市資料未載入';
  }

  function renderRegionSelect() {
    const regions = uniqueRegions();
    const select = $('#regionSelect');
    select.innerHTML = `<option value="all">全部地區 (${state.stores.length})</option>` + regions.map(region => {
      const count = state.stores.filter(store => store.regionId === region.regionId && store.active !== false).length;
      return `<option value="${esc(region.regionId)}">${esc(region.name)} (${count})</option>`;
    }).join('');
    if (!knownRegion(state.activeRegion)) state.activeRegion = regions.some(item => item.regionId === DEFAULT_REGION) ? DEFAULT_REGION : (regions[0]?.regionId || 'all');
    select.value = state.activeRegion;
  }

  function syncControls() {
    $('#searchInput').value = state.query;
    $('#clearSearch').hidden = !state.query;
    $('#regionSelect').value = state.activeRegion;
    $$('.main-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === state.activeTab));
    updateModeButtons();
  }

  function updateModeButtons() {
    $$('.mode-button').forEach(button => button.classList.toggle('active', (button.dataset.mode === 'queue') === state.queueMode));
    $('#modeDescription').hidden = !state.queueMode;
  }

  function currentStores() {
    return state.stores.filter(store => store.active !== false && (state.activeRegion === 'all' || store.regionId === state.activeRegion));
  }
  function matchesQuery(text) { return !state.query || String(text || '').toLocaleLowerCase().includes(state.query.toLocaleLowerCase()); }
  function lineClicks() { return readStorage(STORAGE.lineClicks, {}); }

  function renderStores() {
    const stores = currentStores().filter(store => matchesQuery(`${store.name || ''} ${store.lineId || ''} ${(store.aliases || []).join(' ')}`));
    $('#storeCount').textContent = `${stores.length} 家`;
    const list = $('#storeList');
    if (!stores.length) {
      list.innerHTML = '<div class="empty-state"><strong>沒有符合的門市</strong><p>請清除搜尋條件，或切換其他縣市。</p></div>';
      return;
    }
    const clicks = lineClicks();
    list.innerHTML = stores.map(store => {
      const lineId = store.lineId || '';
      const lineUrl = safeUrl(store.lineUrl) || (lineId ? `https://line.me/R/ti/p/${encodeURIComponent(lineId)}` : '');
      const fbUrl = safeUrl(store.facebookUrl);
      const clicked = !!clicks[store.storeId];
      return `<article class="store-row">
        <div class="store-main"><span class="store-name">${esc(store.name)}</span><span class="store-id">${esc(lineId || 'LINE ID 未提供')}</span></div>
        <div class="store-secondary">${fbUrl ? `<a class="facebook-link" href="${esc(fbUrl)}" target="_blank" rel="noopener noreferrer">FB</a>` : ''}
          ${lineUrl ? `<a class="line-button${clicked ? ' visited' : ''}" href="${esc(lineUrl)}" target="_blank" rel="noopener noreferrer" data-line-store="${esc(store.storeId)}">${clicked ? '已開啟' : '＋ 加好友'}</a>` : '<span class="line-button visited">未提供 LINE</span>'}
        </div>
      </article>`;
    }).join('');
    list.querySelectorAll('[data-line-store]').forEach(link => link.addEventListener('click', () => {
      const clicksNow = lineClicks();
      clicksNow[link.dataset.lineStore] = nowIso();
      writeStorage(STORAGE.lineClicks, clicksNow);
      window.setTimeout(renderStores, 160);
    }));
  }

  function getStore(storeId) { return state.stores.find(store => store.storeId === storeId); }
  function eventStart(event) { return event.startsAt || event.startAt || event.startTime || null; }
  function eventEnd(event) { return event.endsAt || event.endAt || event.endTime || null; }
  function eventCode(event) { return event.productCode || event.productId || event.code || '商品待確認'; }
  function eventName(event) { return event.productName || event.name || ''; }
  function effectiveStatus(event) {
    const explicit = event.status || 'needs-verification';
    if (['cancelled','closed'].includes(explicit)) return explicit;
    const end = eventEnd(event);
    if (end && !Number.isNaN(new Date(end).getTime()) && new Date(end).getTime() < Date.now()) return 'closed';
    const start = eventStart(event);
    if (start && !Number.isNaN(new Date(start).getTime()) && new Date(start).getTime() > Date.now()) return 'upcoming';
    return explicit;
  }
  function eventStatusPill(status) {
    const map = {
      open: ['進行中','open'], upcoming: ['即將開始','upcoming'],
      'needs-verification':['待確認','warning'], announced:['已公告','warning'],
      closed:['已結束','closed'], cancelled:['已取消','closed']
    };
    return map[status] || map['needs-verification'];
  }
  function eventTimeText(event) {
    if (event.timeText) return event.timeText;
    const start = eventStart(event), end = eventEnd(event);
    if (start && end) return `${formatTaipei(start)} – ${formatTaipei(end)}`;
    if (start) return `開始 ${formatTaipei(start)}`;
    if (end) return `截止 ${formatTaipei(end)}`;
    return event.timeLabel || '時間以門市公告為準';
  }
  function eventMethodLabel(method) {
    return ({'line-draw':'LINE 抽選','in-store':'現場販售',preorder:'預購',online:'線上販售',unknown:'方式待確認'})[method] || '販售／抽選';
  }
  function eventProgress() { return readStorage(STORAGE.progress, {}); }
  function progressStatus(eventId) { return eventProgress()[eventId]?.status || 'not-started'; }
  function activeEvents() {
    return state.events.filter(event => {
      const store = getStore(event.storeId);
      const eventRegion = store?.regionId || event.regionId;
      if (state.activeRegion !== 'all' && eventRegion !== state.activeRegion) return false;
      if (!matchesQuery(`${eventCode(event)} ${eventName(event)} ${store?.name || ''}`)) return false;
      if (state.productCode !== 'all' && eventCode(event) !== state.productCode) return false;
      if (state.timeSlot !== 'all' && timeKey(event) !== state.timeSlot) return false;
      if (effectiveStatus(event) === 'closed' || effectiveStatus(event) === 'cancelled') return false;
      if (state.queueMode && ['complete','skipped'].includes(progressStatus(event.eventId))) return false;
      return true;
    }).sort((a,b) => {
      const da = eventStart(a) ? new Date(eventStart(a)).getTime() : Number.MAX_SAFE_INTEGER;
      const db = eventStart(b) ? new Date(eventStart(b)).getTime() : Number.MAX_SAFE_INTEGER;
      return da - db || String(eventCode(a)).localeCompare(String(eventCode(b)));
    });
  }
  function timeKey(event) {
    const start = eventStart(event);
    if (!start) return '未標示時間';
    const date = new Date(start);
    if (Number.isNaN(date.getTime())) return '未標示時間';
    return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
  }
  function renderEventFilters() {
    const productSelect = $('#productFilter');
    const currentProduct = state.productCode;
    const codes = [...new Set(state.events.filter(event => {
      const store = getStore(event.storeId);
      return state.activeRegion === 'all' || store?.regionId === state.activeRegion;
    }).map(eventCode))].sort();
    productSelect.innerHTML = '<option value="all">全部商品</option>' + codes.map(code => `<option value="${esc(code)}">${esc(code)}</option>`).join('');
    state.productCode = codes.includes(currentProduct) ? currentProduct : 'all';
    productSelect.value = state.productCode;
    const timeSelect = $('#timeFilter');
    const times = [...new Set(state.events.filter(event => {
      const store = getStore(event.storeId);
      return state.activeRegion === 'all' || store?.regionId === state.activeRegion;
    }).map(timeKey))].sort((a,b) => a.localeCompare(b, 'zh-Hant'));
    timeSelect.innerHTML = '<option value="all">全部時間</option>' + times.map(time => `<option value="${esc(time)}">${esc(time)}</option>`).join('');
    if (!times.includes(state.timeSlot)) state.timeSlot = 'all';
    timeSelect.value = state.timeSlot;
    $('#drawControls').hidden = state.events.length === 0;
  }

  function directoryUrl() {
    const params = new URLSearchParams();
    if (state.activeRegion !== 'all') {
      const region = uniqueRegions().find(item => item.regionId === state.activeRegion);
      if (region) {
        params.set('c', region.name);
        const names = currentStores().map(store => store.name).filter(Boolean);
        if (names.length) params.set('s', names.join(','));
      }
    }
    if (state.query.trim()) params.set('q', state.query.trim());
    return `${DIRECTORY_URL}${params.toString() ? `?${params.toString()}` : ''}`;
  }
  function updateDirectoryLink() { $('#directoryLink').href = directoryUrl(); }

  function eventCard(event, index) {
    const store = getStore(event.storeId);
    const status = eventStatusPill(effectiveStatus(event));
    const drawUrl = safeUrl(event.drawUrl);
    const announcementUrl = safeUrl(event.announcementUrl);
    const progress = progressStatus(event.eventId);
    const isComplete = progress === 'complete';
    const isOpened = progress === 'opened';
    const product = `${eventCode(event)} ${eventName(event)}`.trim();
    const time = eventTimeText(event);
    const action = drawUrl
      ? `<button class="event-button" type="button" data-open-event="${esc(event.eventId)}">前往抽選</button>`
      : announcementUrl
        ? `<a class="event-button event-link-button" href="${esc(announcementUrl)}" target="_blank" rel="noopener noreferrer">查看公告 ↗</a>`
        : `<a class="event-button event-link-button" href="https://uxux11.github.io/funbox-line/" target="_blank" rel="noopener noreferrer">開啟抽選清單 ↗</a>`;
    return `<article class="event-card" data-event-id="${esc(event.eventId)}">
      <div class="event-content">
        <div class="event-labels"><span class="pill ${status[1]}">${status[0]}</span><span class="pill">${esc(eventMethodLabel(event.method))}</span>${isComplete ? '<span class="pill open">已確認完成</span>' : isOpened ? '<span class="pill warning">已開啟</span>' : ''}</div>
        <h3 class="event-title">${esc(product)}</h3>
        <div class="event-store">${esc(store?.name || event.storeName || '門市待確認')}</div>
        <div class="event-time">${esc(time)}${event.purchaseTimeText ? `<br>購買資格：${esc(event.purchaseTimeText)}` : ''}</div>
      </div>
      <div class="event-action-wrap">${action}${announcementUrl && drawUrl ? `<a class="event-source" href="${esc(announcementUrl)}" target="_blank" rel="noopener noreferrer">原始公告 ↗</a>` : ''}</div>
    </article>`;
  }

  function renderEvents() {
    renderEventFilters();
    const verifiedBlock = $('#verifiedEventsBlock');
    if (verifiedBlock) verifiedBlock.hidden = state.events.length === 0;
    updateDirectoryLink();
    const visible = activeEvents();
    const expired = state.events.filter(event => {
      const store = getStore(event.storeId);
      if (state.activeRegion !== 'all' && store?.regionId !== state.activeRegion) return false;
      return ['closed','cancelled'].includes(effectiveStatus(event));
    });
    $('#drawUpdated').textContent = state.events.length ? `活動資料 ${state.events.length} 筆` : '當期活動尚未匯入；可查看外部整理來源';
    $('#eventList').innerHTML = visible.length ? visible.map((event,index) => eventCard(event,index)).join('') : emptyEventsHtml();
    $('#eventList').querySelectorAll('[data-open-event]').forEach(button => button.addEventListener('click', () => openEvent(button.dataset.openEvent)));
    $('#endedPanel').hidden = expired.length === 0;
    $('#endedCount').textContent = `${expired.length} 筆`;
    $('#endedList').innerHTML = expired.map(event => eventCard(event,null)).join('');
    $('#endedList').querySelectorAll('[data-open-event]').forEach(button => button.addEventListener('click', () => openEvent(button.dataset.openEvent)));
    renderNotSelling();
    updateModeButtons();
  }

  function emptyEventsHtml() {
    const hasData = state.events.length > 0;
    const title = hasData ? '目前沒有符合條件的活動' : '本站尚未匯入可核實的當期抽選';
    const message = hasData
      ? '請調整商品或時間條件，或切換地區查看。'
      : '先從兩個公開整理來源查看公告。外部資料可能含已結束批次，請以門市官方公告及抽選頁顯示的時間為準。';
    const cards = state.drawSources.map(source => {
      const date = source.lastPageUpdate || source.lastIndexedAt;
      const dateText = date ? `來源更新 ${formatTaipei(date)}` : '更新時間未提供';
      const statusText = source.snapshotStatus === 'expired' ? '最近批次已結束' : source.snapshotStatus === 'historical' ? '歷史資料庫' : '外部整理來源';
      const summary = source.id === 'uxux11'
        ? `LINE 名錄 ${source.lineDirectoryRows || '—'} 筆 · 最近批次 ${source.drawBatchStoreCount || '—'} 家 · ${statusText}`
        : `歷史索引 ${source.indexedItemCount || '—'} 項 · ${source.indexedStoreCount || '—'} 家門市 · ${source.indexedProductCount || '—'} 種商品`;
      const url = source.id === 'beybuilder' ? directoryUrl() : safeUrl(source.url);
      return `<a class="draw-source-card" href="${esc(url || source.url)}" target="_blank" rel="noopener"><span class="draw-source-name">${esc(source.name)}</span><span class="draw-source-meta">${esc(summary)}</span><span class="draw-source-date">${esc(dateText)}　↗</span></a>`;
    }).join('');
    return `<div class="empty-state"><strong>${title}</strong><p>${message}</p></div><div class="draw-source-grid">${cards}</div>`;
  }

  function renderNotSelling() {
    const ids = state.notSellingStoreIds;
    let items = [];
    if (ids.length) {
      items = ids.map(id => typeof id === 'string' ? state.stores.find(store => store.storeId === id || store.name === id) : null).filter(Boolean);
      $('#notSellingMeta').textContent = `${items.length} 家`;
      $('#notSellingContent').textContent = items.length ? items.map(store => store.name).join('、') : '來源提供的名單目前無法對應門市資料。';
    } else {
      $('#notSellingMeta').textContent = '尚無完整名單';
      $('#notSellingContent').textContent = '目前沒有經來源確認的完整未販售名單。沒有出現在抽選清單，不代表該門市沒有販售。';
    }
  }

  function buildProductPool() {
    const pool = new Map();
    const add = (codeValue, nameValue, sourceLabel) => {
      const code = String(codeValue || '').trim().toUpperCase();
      if (!code || code === '商品待確認') return;
      const name = String(nameValue || '').trim();
      const key = code.replace(/\s+/g, '');
      const existing = pool.get(key);
      if (!existing || (!existing.name && name)) {
        pool.set(key, { code, name, source: sourceLabel || '商品資料' });
      }
    };

    // Products are generated dynamically from verified/local draw records and Eslite watch products.
    state.events.forEach(event => add(eventCode(event), eventName(event), '抽選活動'));
    state.products.forEach(product => {
      if (product.watchEnabled === false) return;
      add(product.code || product.productId, product.nameZh || product.name, '誠品追蹤商品');
    });
    state.drawSources.forEach(source => {
      (Array.isArray(source.lastBatchProducts) ? source.lastBatchProducts : []).forEach(product => {
        add(product.code || product.productCode, product.name || product.nameZh, source.name || '最近批次');
      });
    });
    return [...pool.values()].sort((a,b) => a.code.localeCompare(b.code, 'zh-Hant'));
  }

  function renderProductSlot() {
    const pool = buildProductPool();
    const count = $('#slotPoolCount');
    const button = $('#spinProduct');
    const codeNode = $('#slotCode');
    const nameNode = $('#slotName');
    const metaNode = $('#slotMeta');
    const lastNode = $('#slotLastResult');
    if (!count || !button || !codeNode || !nameNode || !metaNode || !lastNode) return;
    count.textContent = `${pool.length} 款候選商品`;
    button.disabled = state.slotSpinning || pool.length === 0;
    button.textContent = state.slotSpinning ? '拉霸中…' : '🎰 開始拉霸';

    if (state.slotSpinning) return;
    const last = state.slotLastProduct;
    if (last && last.code) {
      codeNode.textContent = last.code;
      nameNode.textContent = last.name || '商品名稱待確認';
      metaNode.textContent = '最後一次抽出 · 已保存在本機';
      const timeText = last.drawnAt ? formatTaipei(last.drawnAt) : '時間未記錄';
      lastNode.innerHTML = `<span class="slot-last-badge">已保留上次結果</span><span>${esc(last.code)} ${esc(last.name || '')}</span><small>${esc(timeText)}</small>`;
    } else {
      codeNode.textContent = 'BEYBLADE X';
      nameNode.textContent = pool.length ? '按下開始拉霸' : '目前沒有可抽商品';
      metaNode.textContent = pool.length ? '候選商品由抽選批次及誠品追蹤清單自動整理' : '待匯入抽選商品或新增追蹤商品';
      lastNode.textContent = '尚未有抽出紀錄';
    }
  }

  function spinProductSlot() {
    if (state.slotSpinning) return;
    const pool = buildProductPool();
    if (!pool.length) { toast('目前商品池是空的，請先載入抽選活動或誠品商品。', 'error'); return; }

    let candidates = pool;
    if (state.slotLastProduct && pool.length > 1) {
      const withoutLast = pool.filter(item => item.code !== state.slotLastProduct.code);
      if (withoutLast.length) candidates = withoutLast;
    }
    const result = candidates[Math.floor(Math.random() * candidates.length)];
    const reel = $('#slotReel');
    const button = $('#spinProduct');
    const codeNode = $('#slotCode');
    const nameNode = $('#slotName');
    const metaNode = $('#slotMeta');
    state.slotSpinning = true;
    button.disabled = true;
    button.textContent = '拉霸中…';
    reel.classList.add('spinning');
    metaNode.textContent = `正在從 ${pool.length} 款商品中抽選`;

    const start = Date.now();
    const duration = 1500;
    const timer = window.setInterval(() => {
      const preview = pool[Math.floor(Math.random() * pool.length)];
      codeNode.textContent = preview.code;
      nameNode.textContent = preview.name || '商品名稱待確認';
      if (Date.now() - start >= duration) {
        window.clearInterval(timer);
        state.slotLastProduct = { ...result, drawnAt: nowIso(), poolSize: pool.length };
        writeStorage(STORAGE.slotLastProduct, state.slotLastProduct);
        state.slotSpinning = false;
        reel.classList.remove('spinning');
        renderProductSlot();
        toast(`拉霸結果：${result.code} ${result.name || ''}`);
      }
    }, 78);
  }

  function renderProducts() {
    const products = state.products.filter(product => product.watchEnabled !== false && matchesQuery(`${product.code || ''} ${product.nameZh || product.name || ''} ${(product.aliases || []).join(' ')}`));
    const container = $('#productList');
    if (!products.length) {
      container.innerHTML = '<div class="empty-state"><strong>沒有符合的追蹤商品</strong><p>可以清除搜尋，或到設定裡新增商品。</p></div>';
      return;
    }
    container.innerHTML = products.map(product => {
      const code = product.code || product.productId;
      const name = product.nameZh || product.name || code;
      const url = safeUrl(product.url || product.esliteUrl);
      const statusMap = {
        unknown:['庫存尚未確認','warning'],
        'add-to-cart-visible':['頁面顯示可加入購物車','open'],
        'sold-out-visible':['頁面顯示缺貨','closed'],
        'preorder-visible':['頁面顯示預購','upcoming'],
        'not-listed':['頁面查無商品','closed']
      };
      const status = statusMap[product.status] || statusMap.unknown;
      const price = product.lastPrice != null ? money(product.lastPrice) : (product.researchPrice != null ? `曾記錄 ${money(product.researchPrice)}（非即時）` : '價格尚未確認');
      return `<article class="product-row"><div class="product-code">${esc(code)}</div><div class="product-main"><div class="product-name">${esc(name)}</div><div class="product-detail">${esc(price)}${product.lastCheckedAt ? ` · 核對 ${esc(formatTaipei(product.lastCheckedAt))}` : ''}</div><span class="product-status">${status[0]}</span></div>${url ? `<a class="product-action" href="${esc(url)}" target="_blank" rel="noopener">前往誠品 ↗</a>` : '<span class="product-action disabled">無商品網址</span>'}</article>`;
    }).join('');
  }

  function openEvent(eventId) {
    const event = state.events.find(item => item.eventId === eventId);
    if (!event) return;
    const directDrawUrl = safeUrl(event.drawUrl);
    const announcementUrl = safeUrl(event.announcementUrl);
    const url = directDrawUrl || announcementUrl;
    if (!url) { toast('這筆活動沒有抽選頁或公告網址。', 'error'); return; }
    const progress = eventProgress();
    progress[eventId] = { status:'opened', updatedAt:nowIso() };
    writeStorage(STORAGE.progress, progress);
    writeSession('bxxr:v04:pending-event', eventId);
    // Open directly from the user's click so mobile browsers do not block it as a popup.
    const opened = window.open(url, '_blank');
    if (opened) opened.opener = null;
    renderEvents();
    toast(directDrawUrl ? '已開啟單筆抽選頁。返回後請確認是否完成。' : '這筆沒有單獨抽選網址，已開啟原始公告；請從公告確認抽選入口。');
  }

  function checkPendingReturn() {
    const eventId = readSession('bxxr:v04:pending-event');
    if (!eventId || document.visibilityState === 'hidden' || $('#progressDialog').open) return;
    const event = state.events.find(item => item.eventId === eventId);
    if (!event) { removeSession('bxxr:v04:pending-event'); return; }
    state.pendingEventId = eventId;
    $('#progressMessage').textContent = `${eventCode(event)} ${eventName(event)}｜${getStore(event.storeId)?.name || event.storeName || '門市'}。返回本頁不代表抽選成功，請依官方結果確認。`;
    $('#progressDialog').showModal();
  }

  function finishEventProgress(result) {
    const id = state.pendingEventId || readSession('bxxr:v04:pending-event');
    if (!id) { $('#progressDialog').close(); return; }
    const previous = eventProgress();
    previous[id] = { status:result === 'complete' ? 'complete' : 'opened', updatedAt:nowIso() };
    writeStorage(STORAGE.progress, previous);
    removeSession('bxxr:v04:pending-event');
    state.pendingEventId = null;
    $('#progressDialog').close();
    renderEvents();
    if (result === 'complete' && state.queueMode) {
      const next = activeEvents()[0];
      if (next) {
        // This is still a user click (the confirmation button), so opening the next item is user-initiated.
        toast(`已記錄完成，接著處理：${eventCode(next)} ${eventName(next)}`);
        openEvent(next.eventId);
      } else toast('本地區待處理活動已完成。');
    } else {
      toast(result === 'complete' ? '已記錄為你確認完成；不代表系統驗證中籤。' : '已保留為待處理，可稍後再開啟。');
    }
  }

  function renderStoresForSelect() {
    $('#eventStore').innerHTML = state.stores.map(store => `<option value="${esc(store.storeId)}">${esc(store.regionName || '')} ${esc(store.name)}</option>`).join('');
  }
  function openEventDialog() {
    renderStoresForSelect();
    $('#eventForm').reset();
    const localStore = currentStores()[0];
    if (localStore) $('#eventStore').value = localStore.storeId;
    $('#eventDialog').showModal();
  }
  function saveEvent(event) {
    event.preventDefault();
    const storeId = $('#eventStore').value;
    const code = $('#eventCode').value.trim().toUpperCase();
    const drawUrl = safeUrl($('#eventDrawUrl').value);
    const announcementUrl = safeUrl($('#eventAnnouncement').value);
    if (!code || (!drawUrl && !announcementUrl)) { toast('請填商品型號，以及至少一個官方或公告網址。', 'error'); return; }
    state.events.unshift({
      eventId:`manual-${Date.now()}`, storeId, productCode:code, productName:$('#eventName').value.trim(),
      startsAt:$('#eventStarts').value ? new Date($('#eventStarts').value).toISOString() : null,
      endsAt:$('#eventEnds').value ? new Date($('#eventEnds').value).toISOString() : null,
      method:$('#eventMethod').value, status:$('#eventStatus').value, drawUrl, announcementUrl,
      updatedAt:nowIso(), sourceType:'user-submitted'
    });
    writeStorage(STORAGE.events, state.events);
    $('#eventDialog').close(); renderEvents(); toast('已補登活動（僅儲存在這台裝置）。');
  }
  function openProductDialog() { $('#productForm').reset(); $('#productDialog').showModal(); }
  function saveProduct(event) {
    event.preventDefault();
    const code = $('#productCode').value.trim().toUpperCase();
    const url = safeUrl($('#productUrl').value);
    if (!code || !url) { toast('請填寫商品型號及有效的誠品網址。', 'error'); return; }
    const product = { productId:`eslite-${code.toLowerCase()}`, code, nameZh:$('#productName').value.trim(), url, channel:'eslite', status:'unknown', researchPrice:$('#productPrice').value ? Number($('#productPrice').value) : null, watchEnabled:true, aliases:[code.replace('-','')] };
    const index = state.products.findIndex(item => item.code?.toUpperCase() === code);
    if (index >= 0) state.products[index] = {...state.products[index],...product}; else state.products.unshift(product);
    writeStorage(STORAGE.products, state.products);
    $('#productDialog').close(); renderProducts(); renderProductSlot(); toast('已加入本機商品清單，商品拉霸候選池也已更新。');
  }

  function exportBackup() {
    const data = { app:'beyblade-x-radar', version:4, exportedAt:nowIso(), events:state.events, products:state.products, progress:eventProgress(), lineClicks:lineClicks(), queueMode:state.queueMode, slotLastProduct:state.slotLastProduct };
    const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `beyblade-x-radar-backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url);
    toast('已匯出個人紀錄。');
  }
  async function importBackup(event) {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'beyblade-x-radar' || !Array.isArray(data.events) || !Array.isArray(data.products)) throw new Error('檔案格式不正確');
      state.events=data.events; state.products=data.products;
      writeStorage(STORAGE.events,state.events); writeStorage(STORAGE.products,state.products);
      if (data.progress) writeStorage(STORAGE.progress,data.progress);
      if (data.lineClicks) writeStorage(STORAGE.lineClicks,data.lineClicks);
      if (data.queueMode !== undefined) { state.queueMode=!!data.queueMode; writeStorage(STORAGE.queue,state.queueMode); }
      if (data.slotLastProduct) { state.slotLastProduct=data.slotLastProduct; writeStorage(STORAGE.slotLastProduct,state.slotLastProduct); }
      renderAll(); toast('個人紀錄已匯入。');
    } catch (error) { toast(`匯入失敗：${error.message}`,'error'); }
    finally { event.target.value=''; }
  }
  function resetLineClicks() {
    if (!confirm('確定重設所有 LINE「已開啟」標記？')) return;
    localStorage.removeItem(STORAGE.lineClicks); renderStores(); toast('LINE 點擊紀錄已重設。');
  }
  async function enableNotifications() {
    if (!('Notification' in window)) { toast('此瀏覽器不支援通知 API。','error'); return; }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') { writeStorage(STORAGE.notification,true); $('#notificationStatus').textContent='通知權限已開啟（目前僅前景提醒）'; new Notification('BEYBLADE X 搶購助手',{body:'瀏覽器通知已啟用。活動與庫存仍請以官方頁面核對。'}); toast('通知權限已開啟。'); }
    else { $('#notificationStatus').textContent=`通知權限：${permission}`; toast('尚未取得通知權限。','error'); }
  }
  function toast(message,type='') {
    const region=$('#toastRegion'), node=document.createElement('div'); node.className=`toast ${type}`; node.textContent=message; region.appendChild(node);
    window.setTimeout(()=>node.remove(),3800);
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('service-worker.js').catch(error => console.warn('Service worker register failed',error));
    }
  }

  init().catch(error => { console.error(error); toast('載入失敗，請重新整理頁面。','error'); });
})();
