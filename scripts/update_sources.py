#!/usr/bin/env python3
"""Fetch BEYWATCH pages independently into GitHub Pages JSON snapshots.
A failed source never blocks snapshots from the other pages. No third-party dependencies.
"""
from __future__ import annotations
import json, os, sys, time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.environ.get("BBX_OUTPUT_DIR", str(ROOT / "data"))).resolve()
SOURCES = {
    "blade": "https://beywatch.gg/",
    "ratchet": "https://beywatch.gg/parts/ratchets",
    "bit": "https://beywatch.gg/parts/bits",
    "combo": "https://beywatch.gg/combos",
}
REQUIRED = ("blade", "ratchet", "bit")
MAX_BYTES = 15 * 1024 * 1024


def fetch(kind: str, url: str) -> dict:
    # Use a conventional browser UA; some sites reject generic bot identifiers.
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,zh-TW;q=0.7",
        "Cache-Control": "no-cache",
    }
    # Link paths are the actual identifiers emitted by BEYWATCH's part tables.
    expected = {
        "blade": '/blades/',
        "ratchet": '/parts/ratchet-',
        "bit": '/parts/bit-',
        "combo": '/combos/',
    }[kind]
    last_error = None
    for attempt in range(3):
        try:
            req = Request(url, headers=headers)
            with urlopen(req, timeout=45) as response:
                status = getattr(response, "status", 200)
                raw = response.read(MAX_BYTES + 1)
                charset = response.headers.get_content_charset() or "utf-8"
                final_url = response.geturl()
            if status != 200:
                raise RuntimeError(f"HTTP {status}")
            if len(raw) > MAX_BYTES:
                raise RuntimeError("來源頁面超過 15 MB")
            html = raw.decode(charset, errors="replace")
            low = html.lower()
            if len(html) < 1000 or "beywatch" not in low:
                raise RuntimeError("回傳內容不是 BEYWATCH 頁面（可能來源限制自動讀取）")
            if "<tr" not in low:
                raise RuntimeError("頁面沒有可解析的表格列；來源網站可能已改版")
            if expected not in low:
                raise RuntimeError(f"頁面缺少必要連結識別碼 {expected}")
            return {
                "ok": True,
                "type": kind,
                "source": final_url,
                "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "html": html,
            }
        except (HTTPError, URLError, TimeoutError, RuntimeError, OSError) as exc:
            last_error = exc
            print(f"WARN {kind} attempt {attempt + 1}/3: {type(exc).__name__}: {exc}", flush=True)
            if attempt < 2:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"HTTP 擷取失敗：{type(last_error).__name__}: {last_error}")


def write_snapshot(kind: str, payload: dict) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    target = DATA / f"{kind}.json"
    temp = DATA / f"{kind}.json.tmp"
    temp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temp.replace(target)
    print(f"OK {kind}: {target.stat().st_size:,} bytes; fetchedAt={payload['fetchedAt']}", flush=True)


def main() -> int:
    DATA.mkdir(parents=True, exist_ok=True)
    success, errors = [], []
    # Save each successful category immediately. One blocked endpoint will not
    # prevent the other two categories from updating.
    for kind in REQUIRED:
        try:
            payload = fetch(kind, SOURCES[kind])
            write_snapshot(kind, payload)
            success.append(kind)
        except Exception as exc:
            errors.append((kind, str(exc)))
            print(f"ERROR {kind}: {exc}", file=sys.stderr, flush=True)

    # Combos are optional; failure never blocks the part snapshots.
    try:
        payload = fetch("combo", SOURCES["combo"])
        write_snapshot("combo", payload)
        success.append("combo")
    except Exception as exc:
        errors.append(("combo", str(exc)))
        print(f"WARNING combo: {exc}", file=sys.stderr, flush=True)

    print("\n=== 同步摘要 ===", flush=True)
    print("成功：" + (", ".join(success) if success else "無"), flush=True)
    print("失敗：" + ("；".join(f"{k}: {v}" for k, v in errors) if errors else "無"), flush=True)
    existing = [k for k in REQUIRED if (DATA / f"{k}.json").is_file()]
    print("可發布必要快照：" + (", ".join(existing) if existing else "無；網站會使用內建資料"), flush=True)
    # A transient outage is not a workflow crash: publish successful snapshots
    # and keep old snapshots for failed categories. The browser shows per-source status.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
