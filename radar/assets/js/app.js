/* BEYBLADE X Radar - static-first MVP. No credentials or cookies are collected. */
(() => {
  'use strict';

  const STORAGE = {
    events: 'bxxr:v1:events',
    products: 'bxxr:v1:products',
    progress: 'bxxr:v1:progress',
    queue: 'bxxr:v1:queue-mode',
    notification: 'bxxr:v1:notification'
  };
  const DEFAULT_REGION = 'TW-TXG';
  const PRODUCT_STATUS = {
    unknown: ['尚未確認', 'status-warning'],
    'add-to-cart-visible': ['頁面可加入購物車', 'status-open'],
    'sold-out-visible': ['頁面顯示缺貨', 'status-closed'],
    'preorder-visible': ['頁面顯示預購', 'status-upcoming'],
    'not-listed': ['頁面查無商品', 'status-closed']
  };
  const EVENT_STATUS = {
    open: ['進行中', 'status-open'],
    upcoming: ['尚未開始', 'status-upcoming'],
    'needs-verification': ['待確認', 'status-warning'],
    closed: ['已結束', 'status-closed'],
    cancelled: ['已取消', 'status-cancelled'],
    announced: ['已公告', 'status-warning']
  };
  const METHOD_LABEL = {
    'line-draw': 'LINE 抽選',
    'in-store': '現場販售',
    preorder: '預購',
    online: '線上販售',
    other: '其他',
    unknown: '方式待確認'
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const safeUrl = value => {
    try { const url = new URL(String(value)); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; }
    catch { return ''; }
  };
  const nowIso = () => new Date().toISOString();
  const formatDate = value => {
    if (!value) return '未提供';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '未提供';
    return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  };
  const formatFullDate = value => {
    if (!value) return '尚未核對';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '尚未核對';
    return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  };
  const money = value => value === null || value === undefined || value === '' ? '價格未確認' : `NT$ ${Number(value).toLocaleString('zh-TW')}`;
  const readStorage = (key, fallback) => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch { return fallback; }
  };
  const writeStorage = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { toast('無法儲存：瀏覽器儲存空間可能已滿。', 'error'); return false; }
  };
  const readSession = key => { try { return sessionStorage.getItem(key); } catch { return null; } };
  const writeSession = (key, value) => { try { sessionStorage.setItem(key, value); return true; } catch { return false; } };
  const removeSession = key => { try { sessionStorage.removeItem(key); } catch { /* Session storage may be unavailable in a restricted browser. */ } };

  const state = {
    regions: [], stores: [], products: [], events: [],
    activeTab: 'overview', activeRegion: DEFAULT_REGION, activeStore: 'all', query: '',
    eventStatus: 'all', funboxSubtab: 'events', queueMode: false,
    editingProductId: null, pendingConfirmId: null, queueIndex: 0,
    appInstallPrompt: null, wasHidden: false
  };

  async function loadJson(path, fallback) {
    try {
      const response = await fetch(path, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.warn(`資料載入失敗：${path}`, error);
      return fallback;
    }
  }

  async function init() {
    const [regions, stores, products, events] = await Promise.all([
      loadJson('data/regions.json', [{ regionId: DEFAULT_REGION, name: '台中市', enabled: true, default: true }]),
      loadJson('data/stores.json', []),
      loadJson('data/products.json', []),
      loadJson('data/draw-events.json', [])
    ]);
    state.regions = Array.isArray(regions) ? regions : [];
    state.stores = Array.isArray(stores) ? stores : [];
    const savedProducts = readStorage(STORAGE.products, null);
    const savedEvents = readStorage(STORAGE.events, null);
    state.products = Array.isArray(savedProducts) ? savedProducts : products;
    state.events = Array.isArray(savedEvents) ? savedEvents : events;
    state.queueMode = !!readStorage(STORAGE.queue, false);
    readUrlState();
    bindEvents();
    renderAll();
    updateInstallControl();
    registerServiceWorker();
    checkPendingReturn();
    if (Notification.permission === 'granted' && readStorage(STORAGE.notification, false)) {
      $('#notificationStatus').textContent = '通知權限已開啟';
    }
  }

  function readUrlState() {
    const params = new URLSearchParams(location.search);
    const region = params.get('region');
    const legacyCity = params.get('c');
    const requestedRegion = region || (legacyCity ? state.regions.find(item => item.name === legacyCity)?.regionId : null);
    if (requestedRegion && state.regions.some(item => item.regionId === requestedRegion)) state.activeRegion = requestedRegion;
    const store = params.get('store');
    const legacyStores = params.get('s');
    if (store && store !== 'all') state.activeStore = store;
    else if (legacyStores && !legacyStores.includes(',')) {
      const found = state.stores.find(item => item.name === legacyStores || (item.aliases || []).includes(legacyStores));
      if (found) state.activeStore = found.storeId;
    }
    state.query = params.get('q') || '';
    const tab = params.get('tab');
    if (['overview', 'funbox', 'eslite', 'manage'].includes(tab)) state.activeTab = tab;
    state.eventStatus = params.get('status') || 'all';
  }

  function updateUrl() {
    const params = new URLSearchParams();
    params.set('region', state.activeRegion);
    if (state.activeStore !== 'all') params.set('store', state.activeStore);
    if (state.query.trim()) params.set('q', state.query.trim());
    if (state.activeTab !== 'overview') params.set('tab', state.activeTab);
    if (state.eventStatus !== 'all') params.set('status', state.eventStatus);
    history.replaceState({}, '', `${location.pathname}?${params.toString()}${location.hash}`);
  }

  function bindEvents() {
    $$('.tab-button').forEach(button => button.addEventListener('click', () => setTab(button.dataset.tab)));
    $$('[data-go]').forEach(button => button.addEventListener('click', () => setTab(button.dataset.go)));
    $('#regionSelect').addEventListener('change', event => {
      state.activeRegion = event.target.value;
      state.activeStore = 'all';
      renderFilters(); renderAll(); updateUrl();
    });
    $('#storeSelect').addEventListener('change', event => { state.activeStore = event.target.value; renderAll(); updateUrl(); });
    $('#searchInput').addEventListener('input', event => { state.query = event.target.value; renderAll(); updateUrl(); });
    $('#clearFilters').addEventListener('click', () => { state.activeStore = 'all'; state.query = ''; $('#searchInput').value = ''; renderFilters(); renderAll(); updateUrl(); });
    $('#addEventTop').addEventListener('click', openEventDialog);
    $('#addEventButton').addEventListener('click', openEventDialog);
    $('#addProductTop').addEventListener('click', () => openProductDialog());
    $('#addProductButton').addEventListener('click', () => openProductDialog());
    $('#eventForm').addEventListener('submit', saveEventForm);
    $('#productForm').addEventListener('submit', saveProductForm);
    $$('[data-close]').forEach(button => button.addEventListener('click', () => $('#' + button.dataset.close).close()));
    $$('#eventStatusFilters .chip').forEach(button => button.addEventListener('click', () => {
      state.eventStatus = button.dataset.status;
      $$('#eventStatusFilters .chip').forEach(chip => chip.classList.toggle('active', chip === button));
      renderEvents(); updateUrl();
    }));
    $$('#funboxSubtabs .subtab').forEach(button => button.addEventListener('click', () => setFunboxSubtab(button.dataset.subtab)));
    $('#queueMode').checked = state.queueMode;
    $('#queueMode').addEventListener('change', event => { state.queueMode = event.target.checked; writeStorage(STORAGE.queue, state.queueMode); renderEvents(); });
    $('#exportButton').addEventListener('click', exportBackup);
    $('#importInput').addEventListener('change', importBackup);
    $('#enableNotifications').addEventListener('click', enableNotifications);
    $('#resetLocalButton').addEventListener('click', resetLocalData);
    $('#confirmComplete').addEventListener('click', () => finishEventProgress('user-confirmed-complete'));
    $('#confirmPending').addEventListener('click', () => finishEventProgress('opened'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') state.wasHidden = true;
      if (document.visibilityState === 'visible' && state.wasHidden) { state.wasHidden = false; checkPendingReturn(); }
    });
    window.addEventListener('pageshow', checkPendingReturn);
    window.addEventListener('focus', () => { if (readSession('bxxr:pending-event')) checkPendingReturn(); });
    window.addEventListener('popstate', () => { readUrlState(); renderFilters(); renderAll(); });
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.appInstallPrompt = event; updateInstallControl(); });
    $('#installButton').addEventListener('click', installApp);
  }

  function setTab(tab) {
    state.activeTab = tab;
    $$('.tab-button').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
    $$('.view').forEach(view => view.classList.toggle('active', view.id === `view-${tab}`));
    updateUrl();
    if (tab === 'funbox') renderEvents();
    if (tab === 'eslite') renderProducts();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setFunboxSubtab(subtab) {
    state.funboxSubtab = subtab;
    $$('#funboxSubtabs .subtab').forEach(button => button.classList.toggle('active', button.dataset.subtab === subtab));
    $('#funboxEventsPanel').hidden = subtab !== 'events';
    $('#funboxStoresPanel').hidden = subtab !== 'stores';
    if (subtab === 'stores') renderStores(); else renderEvents();
  }

  function renderAll() {
    renderHeader(); renderFilters(); renderStats(); renderOverview(); renderEvents(); renderStores(); renderProducts();
    $$('.tab-button').forEach(button => button.classList.toggle('active', button.dataset.tab === state.activeTab));
    $$('.view').forEach(view => view.classList.toggle('active', view.id === `view-${state.activeTab}`));
    $$('#eventStatusFilters .chip').forEach(chip => chip.classList.toggle('active', chip.dataset.status === state.eventStatus));
    $('#queueMode').checked = state.queueMode;
  }

  function renderHeader() {
    const region = state.regions.find(item => item.regionId === state.activeRegion);
    $('#heroRegion').textContent = region?.name || '全部地區';
    $('#updatedAt').textContent = '2026/11/04';
    $('#footerDate').textContent = '台灣時間 Asia/Taipei';
  }

  function renderFilters() {
    const regionSelect = $('#regionSelect');
    regionSelect.innerHTML = state.regions.filter(item => item.enabled !== false).map(item => `<option value="${esc(item.regionId)}">${esc(item.name)}</option>`).join('');
    if (!state.regions.some(item => item.regionId === state.activeRegion)) state.activeRegion = state.regions[0]?.regionId || DEFAULT_REGION;
    regionSelect.value = state.activeRegion;
    const stores = state.stores.filter(store => store.regionId === state.activeRegion && store.active !== false);
    $('#storeSelect').innerHTML = `<option value="all">全部門市</option>` + stores.map(store => `<option value="${esc(store.storeId)}">${esc(store.name)}</option>`).join('');
    if (!stores.some(store => store.storeId === state.activeStore)) state.activeStore = 'all';
    $('#storeSelect').value = state.activeStore;
    $('#searchInput').value = state.query;
  }

  function renderStats() {
    const activeStores = state.stores.filter(store => store.regionId === state.activeRegion && store.active !== false);
    const official = activeStores.filter(store => store.sourceType === 'official-directory').length;
    $('#statStores').textContent = activeStores.length;
    $('#statProducts').textContent = state.products.filter(product => product.watchEnabled !== false).length;
    const pending = state.events.filter(event => event.status !== 'closed' && event.status !== 'cancelled' && event.status !== 'user-confirmed-complete').length;
    $('#statEvents').textContent = pending;
    $('#eventCount').textContent = state.events.length;
    $('#storeCount').textContent = activeStores.length;
    $('#officialStoreCount').textContent = official;
    $('#candidateStoreCount').textContent = activeStores.length - official;
  }

  function eventEffectiveStatus(event) {
    if (event.status === 'cancelled' || event.status === 'closed') return event.status;
    if (event.endsAt && new Date(event.endsAt).getTime() < Date.now()) return 'closed';
    if (event.startsAt && new Date(event.startsAt).getTime() > Date.now() && event.status === 'open') return 'upcoming';
    return event.status || 'needs-verification';
  }

  function getEventStore(event) { return state.stores.find(store => store.storeId === event.storeId); }
  function getProgress() { return readStorage(STORAGE.progress, {}); }
  function setProgress(id, progress) {
    const current = getProgress(); current[id] = { status: progress, updatedAt: nowIso() }; writeStorage(STORAGE.progress, current);
  }
  function getEventProgress(id) { return getProgress()[id]?.status || 'not-started'; }
  function progressLabel(status) { return ({ 'not-started':'未處理', opened:'已開啟，待確認', 'user-confirmed-complete':'已確認完成', skipped:'已略過' })[status] || '未處理'; }

  function matchesQuery(text) {
    const query = state.query.trim().toLowerCase();
    return !query || String(text || '').toLowerCase().includes(query);
  }
  function storeMatchesFilter(storeId) {
    if (state.activeStore !== 'all' && state.activeStore !== storeId) return false;
    const store = state.stores.find(item => item.storeId === storeId);
    return !!store && store.regionId === state.activeRegion;
  }

  function eventCard(event, index = null) {
    const store = getEventStore(event);
    const productCode = event.productCode || event.productId || '未填型號';
    const productName = event.productName || event.name || '';
    const status = eventEffectiveStatus(event);
    const [statusText, statusClass] = EVENT_STATUS[status] || EVENT_STATUS['needs-verification'];
    const progress = getEventProgress(event.eventId);
    const drawUrl = safeUrl(event.drawUrl);
    const announcementUrl = safeUrl(event.announcementUrl);
    const price = event.price !== null && event.price !== undefined && event.price !== '' ? money(event.price) : '';
    const times = [event.startsAt ? `開始 ${formatDate(event.startsAt)}` : '', event.endsAt ? `截止 ${formatDate(event.endsAt)}` : ''].filter(Boolean).join('　·　');
    return `<article class="event-card" data-event-id="${esc(event.eventId)}">
      <div>
        <div class="card-top">${index !== null ? `<span class="queue-number">${index + 1}</span>` : ''}<span class="status-pill ${statusClass}">${statusText}</span><span class="mini-badge">${esc(METHOD_LABEL[event.method] || METHOD_LABEL.unknown)}</span><span class="mini-badge">${esc(progressLabel(progress))}</span></div>
        <h3>${esc(productCode)} ${esc(productName)}</h3>
        <div class="event-meta"><span>▣ ${esc(store?.name || '未知門市')}</span>${times ? `<span>◷ ${esc(times)}</span>` : ''}${price ? `<span>${esc(price)}</span>` : ''}${event.purchaseLimit ? `<span>限購：${esc(event.purchaseLimit)}</span>` : ''}</div>
        ${event.notes ? `<p class="event-notes">${esc(event.notes)}</p>` : ''}
        <div class="event-meta"><span>資料最後整理：${esc(formatDate(event.updatedAt || event.observedAt || event.createdAt))}</span><span>來源需自行核對</span></div>
      </div>
      <div class="event-actions">
        ${drawUrl ? `<button class="button button-primary" data-action="open-event" data-id="${esc(event.eventId)}" type="button">開啟官方活動頁 ↗</button>` : `<button class="button button-ghost" data-action="no-event-url" type="button">尚未提供活動網址</button>`}
        ${announcementUrl ? `<a class="button button-ghost" href="${esc(announcementUrl)}" target="_blank" rel="noopener">查看原始公告 ↗</a>` : ''}
        <button class="button button-ghost" data-action="progress-event" data-id="${esc(event.eventId)}" type="button">更新處理狀態</button>
        <button class="button button-ghost" data-action="delete-event" data-id="${esc(event.eventId)}" type="button">刪除此筆</button>
      </div>
    </article>`;
  }

  function renderEvents() {
    const list = $('#eventList');
    const matching = state.events.filter(event => {
      const store = getEventStore(event);
      if (!storeMatchesFilter(event.storeId)) return false;
      if (!matchesQuery(`${event.productCode || event.productId || ''} ${event.productName || ''} ${store?.name || ''}`)) return false;
      const status = eventEffectiveStatus(event);
      if (state.eventStatus !== 'all' && status !== state.eventStatus) return false;
      if (state.queueMode && ['user-confirmed-complete', 'skipped'].includes(getEventProgress(event.eventId))) return false;
      return true;
    }).sort((a, b) => {
      const rank = event => ({ open:0, upcoming:1, 'needs-verification':2, announced:3, closed:4, cancelled:5 })[eventEffectiveStatus(event)] ?? 6;
      return rank(a) - rank(b) || new Date(a.endsAt || '2999-12-31') - new Date(b.endsAt || '2999-12-31');
    });

    const queueBanner = state.queueMode ? `<div class="queue-banner show"><span>逐項處理模式：只顯示尚未確認完成或略過的活動。開啟官方頁後，返回本頁再自行確認結果。</span><b>${matching.length} 項待處理</b></div>` : '';
    if (!matching.length) {
      list.innerHTML = `${queueBanner}<div class="panel empty-state"><div class="empty-symbol">◈</div><strong>${state.events.length ? '目前篩選條件沒有符合的活動' : '目前沒有已核實的開放抽選資料'}</strong><p>${state.events.length ? '可以切換狀態篩選、清除關鍵字，或檢查是否已把活動標記為完成。' : '這是刻意保留的空清單：目前沒有足夠的官方公告與有效抽選網址可安全標示為開放。新增公告後，活動會出現在這裡。'}</p><button class="button button-primary" id="emptyAddEvent" type="button">＋ 新增活動資料</button></div>`;
      $('#emptyAddEvent')?.addEventListener('click', openEventDialog);
    } else {
      list.innerHTML = `${queueBanner}${matching.map((event, index) => eventCard(event, state.queueMode ? index : null)).join('')}`;
    }
    list.querySelectorAll('[data-action="open-event"]').forEach(button => button.addEventListener('click', () => openEvent(button.dataset.id)));
    list.querySelectorAll('[data-action="progress-event"]').forEach(button => button.addEventListener('click', () => openProgressDialog(button.dataset.id)));
    list.querySelectorAll('[data-action="no-event-url"]').forEach(button => button.addEventListener('click', () => toast('此筆活動沒有原始公告或官方活動網址，請先補上可核對的來源。', 'error')));
    list.querySelectorAll('[data-action="delete-event"]').forEach(button => button.addEventListener('click', () => deleteEvent(button.dataset.id)));
  }

  function storeCard(store) {
    const isOfficial = store.sourceType === 'official-directory';
    const lineUrl = safeUrl(store.lineUrl);
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(store.address || store.name)}`;
    const sourceUrl = (store.sourceUrls || []).map(safeUrl).find(Boolean);
    return `<article class="store-card">
      <div class="store-card-top"><h3>${esc(store.name)}</h3><span class="mini-badge ${isOfficial ? 'official' : 'candidate'}">${isOfficial ? '官方門市名錄' : '補充候選'}</span></div>
      <div class="store-badges"><span class="mini-badge">LINE ${store.lineId ? esc(store.lineId) : '未整理'}</span><span class="mini-badge">販售陀螺狀態待核對</span></div>
      <div class="address">${esc(store.address || '地址待補')}</div>
      ${store.phone ? `<div class="store-phone">☎ ${esc(store.phone)}</div>` : ''}
      <div class="store-actions">${lineUrl ? `<a class="button button-primary" href="${esc(lineUrl)}" target="_blank" rel="noopener">加入 LINE ↗</a>` : `<button class="button button-ghost" disabled>LINE 待補</button>`}<a class="button button-ghost" href="${esc(mapUrl)}" target="_blank" rel="noopener">地圖 ↗</a></div>
      <div class="store-source">${isOfficial ? '地址來源：Funbox 官方線上門市名錄' : '候選來源：官方舊名錄 / 第三方整理，需確認現況'} · LINE ID 未逐一人工驗證</div>
      ${sourceUrl ? `<a class="text-button" href="${esc(sourceUrl)}" target="_blank" rel="noopener">查看資料來源 ↗</a>` : ''}
    </article>`;
  }

  function renderStores() {
    const stores = state.stores.filter(store => store.regionId === state.activeRegion && store.active !== false)
      .filter(store => state.activeStore === 'all' || store.storeId === state.activeStore)
      .filter(store => matchesQuery(`${store.name} ${(store.aliases || []).join(' ')} ${store.address} ${store.lineId || ''}`));
    $('#storeList').innerHTML = stores.length ? stores.map(storeCard).join('') : `<div class="panel empty-state"><strong>沒有符合條件的門市</strong><p>可以清除搜尋，或切換其他地區。</p></div>`;
  }

  function productCard(product) {
    const status = PRODUCT_STATUS[product.status] || PRODUCT_STATUS.unknown;
    const url = safeUrl(product.url || product.esliteUrl);
    const priceLine = product.lastPrice !== undefined && product.lastPrice !== null && product.lastPrice !== ''
      ? money(product.lastPrice)
      : product.researchPrice !== undefined && product.researchPrice !== null ? `研究頁面曾顯示 ${money(product.researchPrice)}` : '價格未確認';
    const checkLine = product.lastCheckedAt ? `人工核對 ${formatFullDate(product.lastCheckedAt)}` : '尚未人工核對販售狀態';
    return `<article class="product-card">
      <div class="product-art"><b>${esc(product.code)}</b><small>BEYBLADE X</small></div>
      <div class="product-info"><div class="product-code">ESLITE ONLINE / ${esc(product.code)}</div><h3>${esc(product.nameZh || product.name || product.code)}</h3><div class="product-price">${esc(priceLine)}</div><span class="status-pill ${status[1]}">${esc(status[0])}</span><p>${esc(checkLine)}</p>${product.researchNote ? `<p>${esc(product.researchNote)}</p>` : ''}
        <div class="product-card-actions">${url ? `<a class="button button-primary" href="${esc(url)}" target="_blank" rel="noopener">前往誠品 ↗</a>` : ''}<button class="button button-ghost" data-action="edit-product" data-id="${esc(product.productId)}" type="button">更新核對資料</button><button class="button button-ghost" data-action="delete-product" data-id="${esc(product.productId)}" type="button">移除</button></div>
      </div>
    </article>`;
  }

  function renderProducts() {
    const products = state.products.filter(product => product.watchEnabled !== false).filter(product => matchesQuery(`${product.code} ${product.nameZh || ''} ${(product.aliases || []).join(' ')}`));
    $('#productList').innerHTML = products.length ? products.map(productCard).join('') : `<div class="panel empty-state"><strong>沒有符合條件的追蹤商品</strong><p>可以新增商品型號與誠品商品網址。</p><button class="button button-primary" id="emptyAddProduct" type="button">＋ 新增商品</button></div>`;
    $('#productList').querySelectorAll('[data-action="edit-product"]').forEach(button => button.addEventListener('click', () => openProductDialog(button.dataset.id)));
    $('#productList').querySelectorAll('[data-action="delete-product"]').forEach(button => button.addEventListener('click', () => deleteProduct(button.dataset.id)));
    $('#emptyAddProduct')?.addEventListener('click', () => openProductDialog());
  }

  function renderOverview() {
    const regionEvents = state.events.filter(event => getEventStore(event)?.regionId === state.activeRegion)
      .filter(event => !['closed', 'cancelled'].includes(eventEffectiveStatus(event)))
      .sort((a,b) => new Date(a.endsAt || '2999-12-31') - new Date(b.endsAt || '2999-12-31')).slice(0, 3);
    $('#overviewEvents').innerHTML = regionEvents.length ? regionEvents.map(event => `<div class="product-mini"><div class="product-avatar">${esc(event.productCode || 'X')}</div><div class="product-mini-info"><b>${esc(event.productName || event.productCode || '活動')}</b><small>${esc(getEventStore(event)?.name || '未知門市')} · ${esc(METHOD_LABEL[event.method] || '待確認')}</small></div><span class="status-pill ${(EVENT_STATUS[eventEffectiveStatus(event)] || EVENT_STATUS['needs-verification'])[1]}">${esc((EVENT_STATUS[eventEffectiveStatus(event)] || EVENT_STATUS['needs-verification'])[0])}</span></div>`).join('') : `<div class="empty-state compact-empty"><div class="empty-symbol">◈</div><strong>目前沒有已核實的開放活動</strong><p>可以貼上門市公告與官方抽選網址，建立活動紀錄。</p><button class="button button-dark" data-go="manage" type="button">＋ 新增活動資料</button></div>`;
    $('#overviewEvents').querySelector('[data-go="manage"]')?.addEventListener('click', () => setTab('manage'));
    const previewProducts = state.products.filter(product => product.watchEnabled !== false).slice(0, 3);
    $('#overviewProducts').innerHTML = previewProducts.length ? previewProducts.map(product => `<div class="product-mini"><div class="product-avatar">${esc(product.code)}</div><div class="product-mini-info"><b>${esc(product.nameZh || product.code)}</b><small>${esc(product.code)} · ${esc(product.lastCheckedAt ? formatDate(product.lastCheckedAt) : '未確認即時狀態')}</small></div><span class="status-pill ${(PRODUCT_STATUS[product.status] || PRODUCT_STATUS.unknown)[1]}">${esc((PRODUCT_STATUS[product.status] || PRODUCT_STATUS.unknown)[0])}</span></div>`).join('') : `<div class="empty-state compact-empty"><strong>尚未新增追蹤商品</strong><p>前往誠品商品頁新增你想追蹤的型號。</p></div>`;
  }

  function openEventDialog() {
    const select = $('#eventStore');
    const regionStores = state.stores.filter(store => store.regionId === state.activeRegion && store.active !== false);
    select.innerHTML = regionStores.map(store => `<option value="${esc(store.storeId)}">${esc(store.name)}</option>`).join('');
    $('#eventForm').reset();
    $('#eventStatus').value = 'needs-verification';
    $('#eventMethod').value = 'line-draw';
    $('#eventDialog').showModal();
  }

  function saveEventForm(event) {
    event.preventDefault();
    const storeId = $('#eventStore').value;
    const productCode = $('#eventCode').value.trim().toUpperCase();
    if (!storeId || !productCode) { toast('請填寫門市與商品型號。', 'error'); return; }
    const eventRecord = {
      eventId: `user-${Date.now()}-${Math.random().toString(16).slice(2,7)}`,
      storeId, productCode, productName: $('#eventName').value.trim(),
      method: $('#eventMethod').value, status: $('#eventStatus').value,
      startsAt: inputDateToIso($('#eventStarts').value), endsAt: inputDateToIso($('#eventEnds').value),
      price: $('#eventPrice').value ? Number($('#eventPrice').value) : null,
      purchaseLimit: $('#eventLimit').value.trim() || null,
      announcementUrl: safeUrl($('#eventAnnouncement').value) || null,
      drawUrl: safeUrl($('#eventDrawUrl').value) || null,
      notes: $('#eventNotes').value.trim(),
      sourceType: 'user-submitted', createdAt: nowIso(), updatedAt: nowIso(), userProgress: 'not-started'
    };
    if (!eventRecord.drawUrl && !eventRecord.announcementUrl) {
      toast('建議至少填寫原始公告或活動網址；這筆資料仍可儲存為待確認。', 'error');
      return;
    }
    state.events.unshift(eventRecord);
    writeStorage(STORAGE.events, state.events);
    if (eventRecord.status === 'open') sendForegroundNotice('新增開放活動', `${eventRecord.productCode}｜${getEventStore(eventRecord)?.name || 'Funbox 門市'}`);
    $('#eventDialog').close();
    state.eventStatus = 'all';
    $$('#eventStatusFilters .chip').forEach(chip => chip.classList.toggle('active', chip.dataset.status === 'all'));
    renderStats(); renderEvents(); renderOverview();
    setTab('funbox'); setFunboxSubtab('events');
    toast('活動已儲存在這台裝置。請再核對原始公告與截止時間。', 'success');
  }

  function inputDateToIso(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function openProductDialog(productId = null) {
    state.editingProductId = productId;
    const product = productId ? state.products.find(item => item.productId === productId) : null;
    $('#productForm').reset();
    $('#productDialogTitle').textContent = product ? '更新商品核對資料' : '新增追蹤商品';
    $('#productCode').value = product?.code || '';
    $('#productName').value = product?.nameZh || product?.name || '';
    $('#productUrl').value = product?.url || product?.esliteUrl || '';
    $('#productPrice').value = product?.lastPrice ?? product?.researchPrice ?? '';
    $('#productStatus').value = product?.status || 'unknown';
    $('#productChecked').value = product?.lastCheckedAt ? formatFullDate(product.lastCheckedAt) : '儲存時自動記錄';
    $('#productDialog').showModal();
  }

  function saveProductForm(event) {
    event.preventDefault();
    const code = $('#productCode').value.trim().toUpperCase();
    const nameZh = $('#productName').value.trim();
    const url = safeUrl($('#productUrl').value);
    if (!code || !nameZh || !url) { toast('請填寫商品型號、名稱與有效的誠品商品網址。', 'error'); return; }
    const price = $('#productPrice').value ? Number($('#productPrice').value) : null;
    const product = {
      productId: state.editingProductId || `eslite-${code.toLowerCase()}-${Date.now()}`,
      code, nameZh, channel: 'eslite', url, status: $('#productStatus').value,
      lastPrice: price, lastCheckedAt: nowIso(), watchEnabled: true,
      aliases: [code.replace('-', '')]
    };
    const existingIndex = state.products.findIndex(item => item.productId === product.productId || (!state.editingProductId && item.code.toUpperCase() === code));
    const previousStatus = existingIndex >= 0 ? state.products[existingIndex].status : null;
    if (existingIndex >= 0) state.products[existingIndex] = { ...state.products[existingIndex], ...product };
    else state.products.unshift(product);
    writeStorage(STORAGE.products, state.products);
    if (product.status === 'add-to-cart-visible' && previousStatus !== 'add-to-cart-visible') sendForegroundNotice('誠品商品狀態更新', `${product.code} ${product.nameZh}：頁面顯示可加入購物車，請立即到誠品確認。`);
    $('#productDialog').close();
    renderStats(); renderProducts(); renderOverview();
    setTab('eslite');
    toast('商品核對資料已儲存。這是人工紀錄，不是即時庫存。', 'success');
  }

  function openEvent(eventId) {
    const event = state.events.find(item => item.eventId === eventId);
    const url = safeUrl(event?.drawUrl || event?.announcementUrl);
    if (!event || !url) { toast('這筆活動尚未提供可開啟的官方網址。', 'error'); return; }
    setProgress(eventId, 'opened');
    writeSession('bxxr:pending-event', eventId);
    renderEvents(); renderStats(); renderOverview();
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast('已嘗試開啟官方頁。完成操作後返回本頁，手動確認結果。');
  }

  function checkPendingReturn() {
    const eventId = readSession('bxxr:pending-event');
    if (!eventId || document.visibilityState === 'hidden') return;
    const event = state.events.find(item => item.eventId === eventId);
    if (!event) { removeSession('bxxr:pending-event'); return; }
    state.pendingConfirmId = eventId;
    $('#confirmMessage').textContent = `${event.productCode || ''} ${event.productName || ''}｜${getEventStore(event)?.name || '門市'}。返回本頁不代表官方已記錄抽選成功，請確認官方頁面是否顯示完成結果。`;
    if (!$('#confirmDialog').open) $('#confirmDialog').showModal();
  }

  function openProgressDialog(eventId) {
    state.pendingConfirmId = eventId;
    const event = state.events.find(item => item.eventId === eventId);
    $('#confirmMessage').textContent = `${event?.productCode || ''} ${event?.productName || ''}｜${getEventStore(event)?.name || ''}。請依官方頁面結果選擇狀態。`;
    $('#confirmDialog').showModal();
  }

  function finishEventProgress(progress) {
    if (!state.pendingConfirmId) return;
    setProgress(state.pendingConfirmId, progress);
    removeSession('bxxr:pending-event');
    $('#confirmDialog').close();
    state.pendingConfirmId = null;
    renderStats(); renderEvents(); renderOverview();
    toast(progress === 'user-confirmed-complete' ? '已記錄為「你確認完成」，並非系統驗證中獎。' : '已保留為待處理，可稍後再回來完成。', 'success');
  }

  function deleteEvent(eventId) {
    if (!confirm('確定刪除這筆活動紀錄？此動作不會影響官方抽選頁。')) return;
    state.events = state.events.filter(item => item.eventId !== eventId);
    writeStorage(STORAGE.events, state.events);
    const progress = getProgress(); delete progress[eventId]; writeStorage(STORAGE.progress, progress);
    renderStats(); renderEvents(); renderOverview();
    toast('活動紀錄已刪除。', 'success');
  }

  function deleteProduct(productId) {
    if (!confirm('確定從本機追蹤清單移除此商品？')) return;
    state.products = state.products.filter(item => item.productId !== productId);
    writeStorage(STORAGE.products, state.products);
    renderStats(); renderProducts(); renderOverview();
    toast('商品已從追蹤清單移除。', 'success');
  }

  function sendForegroundNotice(title, body) {
    if ('Notification' in window && Notification.permission === 'granted' && readStorage(STORAGE.notification, false)) {
      try { new Notification(title, { body }); } catch (error) { console.warn('Notification failed', error); }
    }
  }

  function exportBackup() {
    const backup = {
      app: 'beyblade-x-radar', version: 1, exportedAt: nowIso(),
      events: state.events, products: state.products, progress: getProgress(), queueMode: state.queueMode
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `beyblade-x-radar-backup-${new Date().toISOString().slice(0,10)}.json`;
    link.click(); URL.revokeObjectURL(url);
    toast('已匯出本機資料備份。', 'success');
  }

  async function importBackup(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'beyblade-x-radar' || !Array.isArray(data.events) || !Array.isArray(data.products)) throw new Error('格式不符');
      if (!confirm(`即將匯入 ${data.events.length} 筆活動與 ${data.products.length} 項商品，並覆蓋目前本機清單。確定繼續？`)) return;
      state.events = data.events; state.products = data.products;
      writeStorage(STORAGE.events, state.events); writeStorage(STORAGE.products, state.products);
      if (data.progress) writeStorage(STORAGE.progress, data.progress);
      if (data.queueMode !== undefined) { state.queueMode = !!data.queueMode; writeStorage(STORAGE.queue, state.queueMode); }
      renderAll(); toast('備份已匯入。', 'success');
    } catch (error) {
      toast(`匯入失敗：${error.message}`, 'error');
    } finally { event.target.value = ''; }
  }

  async function enableNotifications() {
    if (!('Notification' in window)) { $('#notificationStatus').textContent = '此瀏覽器不支援通知 API'; toast('此瀏覽器不支援通知。', 'error'); return; }
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        writeStorage(STORAGE.notification, true);
        $('#notificationStatus').textContent = '通知權限已開啟；目前只支援頁面開啟期間的前景提醒';
        new Notification('BEYBLADE X 搶購雷達', { body: '瀏覽器通知已啟用。記得官方庫存與抽選狀態仍需確認。' });
        toast('通知權限已開啟。', 'success');
      } else {
        $('#notificationStatus').textContent = `通知權限：${permission}`;
        toast('尚未取得通知權限。', 'error');
      }
    } catch { toast('無法啟用通知，請檢查瀏覽器設定。', 'error'); }
  }

  function resetLocalData() {
    if (!confirm('確定清除本機新增的活動、商品、抽選處理進度與偏好？靜態門市資料不會被刪除。建議先匯出備份。')) return;
    Object.values(STORAGE).forEach(key => localStorage.removeItem(key));
    removeSession('bxxr:pending-event');
    location.reload();
  }

  function toast(message, type = '') {
    const region = $('#toastRegion');
    const item = document.createElement('div'); item.className = `toast ${type}`; item.textContent = message;
    region.appendChild(item);
    window.setTimeout(() => item.remove(), 4200);
  }

  function updateInstallControl() {
    const button = $('#installButton');
    if (state.appInstallPrompt) button.hidden = false;
  }
  async function installApp() {
    if (!state.appInstallPrompt) { toast('可使用瀏覽器選單中的「加入主畫面」安裝。'); return; }
    state.appInstallPrompt.prompt();
    await state.appInstallPrompt.userChoice;
    state.appInstallPrompt = null; $('#installButton').hidden = true;
  }
  function registerServiceWorker() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('service-worker.js').catch(error => console.warn('Service worker registration failed', error));
    }
  }

  init().catch(error => {
    console.error(error);
    toast('資料載入發生問題，請從 GitHub Pages 或本機伺服器開啟，不要直接雙擊 index.html。', 'error');
  });
})();
