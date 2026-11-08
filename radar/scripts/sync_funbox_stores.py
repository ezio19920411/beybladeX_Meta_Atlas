#!/usr/bin/env python3
"""Sync Funbox store links from a published Google Sheets CSV into the radar data files.

Required Google Sheets columns:
  店名, 粉專網址, LINE官方帳號ID
Optional:
  縣市, 地址, 電話, 是否啟用

Uses only Python's standard library. Existing region assignments are retained by
matching store names, so the current sheet does not need a city column immediately.
For newly added stores, add a 縣市 column to avoid an unassigned region.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

SHEET_ID = "1FoLE_Y8EgVoeydoh_WXeCm7EIl0q8SqMIR6zK_6CtQU"
SHEET_GID = "0"
SHEET_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit?gid={SHEET_GID}#gid={SHEET_GID}"
DEFAULT_CSV_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={SHEET_GID}"

CITY_MAP = {
    "台北市": ("TW-TPE", "台北市"), "臺北市": ("TW-TPE", "台北市"), "台北": ("TW-TPE", "台北市"),
    "新北市": ("TW-NWT", "新北市"), "新北": ("TW-NWT", "新北市"),
    "桃園市": ("TW-TAO", "桃園市"), "桃園": ("TW-TAO", "桃園市"),
    "新竹市": ("TW-HSZ", "新竹市"), "新竹縣": ("TW-HSC", "新竹縣"),
    "苗栗縣": ("TW-MIA", "苗栗縣"), "苗栗": ("TW-MIA", "苗栗縣"),
    "台中市": ("TW-TXG", "台中市"), "臺中市": ("TW-TXG", "台中市"), "台中": ("TW-TXG", "台中市"),
    "彰化縣": ("TW-CHA", "彰化縣"), "南投縣": ("TW-NAN", "南投縣"),
    "雲林縣": ("TW-YUN", "雲林縣"), "嘉義市": ("TW-CYI", "嘉義市"), "嘉義縣": ("TW-CYQ", "嘉義縣"),
    "台南市": ("TW-TNN", "台南市"), "臺南市": ("TW-TNN", "台南市"), "台南": ("TW-TNN", "台南市"),
    "高雄市": ("TW-KHH", "高雄市"), "高雄": ("TW-KHH", "高雄市"),
    "屏東縣": ("TW-PIF", "屏東縣"), "宜蘭縣": ("TW-ILA", "宜蘭縣"), "宜蘭": ("TW-ILA", "宜蘭縣"),
    "花蓮縣": ("TW-HUA", "花蓮縣"), "台東縣": ("TW-TTT", "台東縣"), "臺東縣": ("TW-TTT", "台東縣"),
    "澎湖縣": ("TW-PEN", "澎湖縣"), "金門縣": ("TW-KIN", "金門縣"), "連江縣": ("TW-LIE", "連江縣"),
}
HEADER_ALIASES = {
    "name": {"店名", "門市", "門市名稱", "店家名稱", "store", "storename"},
    "facebook": {"粉專網址", "facebook", "facebook網址", "facebook粉專", "facebook粉絲專頁", "fb網址"},
    "line": {"line官方帳號id", "lineid", "line官方帳號", "lineid官方帳號", "line帳號", "line"},
    "city": {"縣市", "縣市別", "地區", "縣市/區域", "城市"},
    "address": {"地址", "門市地址"},
    "phone": {"電話", "連絡電話", "聯絡電話"},
    "active": {"是否啟用", "啟用", "active", "狀態"},
}


def norm_header(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "").strip().lower()
    return re.sub(r"[\s_\-（）()]+", "", value)


def norm_name(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "").strip()
    return re.sub(r"[\s　]+", "", value).lower()


def decode_csv(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp950", "big5"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            pass
    raise ValueError("CSV 編碼無法辨識；請將 Google Sheet 發布為 UTF-8 CSV。")


def fetch_csv(url: str) -> str:
    if not url:
        raise ValueError("缺少 CSV 網址。請先發布 Google Sheet，並設定 FUNBOX_SHEET_CSV_URL。")
    request = urllib.request.Request(url, headers={"User-Agent": "Beyblade-X-Radar/0.3 (+Google Sheets CSV sync)"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"下載 Google Sheet CSV 失敗：HTTP {exc.code}。請確認工作表已發布為 CSV，或連結可供檢視。") from exc
    except Exception as exc:
        raise RuntimeError(f"無法下載 Google Sheet CSV：{exc}") from exc
    text = decode_csv(raw)
    probe = text.lstrip()[:300].lower()
    if probe.startswith("<!doctype html") or probe.startswith("<html") or "accounts.google.com" in probe:
        raise RuntimeError("Google 回傳的是登入頁／HTML，不是 CSV。請在試算表選「檔案 → 分享 → 發布到網路」，指定工作表並選 CSV。")
    return text


def header_map(fieldnames: list[str] | None) -> dict[str, str]:
    if not fieldnames:
        raise ValueError("CSV 是空的，沒有標題列。")
    normalized = {norm_header(name): name for name in fieldnames if name is not None}
    result: dict[str, str] = {}
    for key, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            alias_n = norm_header(alias)
            if alias_n in normalized:
                result[key] = normalized[alias_n]
                break
    missing = [label for key, label in (("name", "店名"), ("facebook", "粉專網址"), ("line", "LINE官方帳號ID")) if key not in result]
    if missing:
        raise ValueError("CSV 缺少必要欄位：" + "、".join(missing) + f"。目前讀到欄位：{fieldnames}")
    return result


def clean_url(value: str) -> str | None:
    value = (value or "").strip().replace("\u00a0", "")
    if not value:
        return None
    if value.startswith("http://"):
        value = "https://" + value[len("http://"):]
    if not value.startswith(("https://", "http://")):
        raise ValueError(f"網址格式不正確：{value}")
    return value


def clean_line_id(value: str) -> str | None:
    value = (value or "").strip().replace("\u00a0", "")
    if not value:
        return None
    # Accept either a LINE ID or a pasted line.me friend link.
    if "line.me/" in value:
        match = re.search(r"(?:ti/p/~?|addfriend/)(@?[A-Za-z0-9._-]+)", value)
        if match:
            value = match.group(1)
    value = value.strip()
    if not value.startswith("@"): 
        value = "@" + value
    return value


def city_info(city: str | None, old: dict[str, Any] | None) -> tuple[str, str, str]:
    city = unicodedata.normalize("NFKC", city or "").strip()
    if city:
        compact = city.replace("臺", "台")
        for key, value in CITY_MAP.items():
            if key.replace("臺", "台") == compact:
                return value[0], value[1], "from-sheet-city-column"
        # Do not guess unknown or malformed values.
        return "TW-UNK", city, "unrecognized-city-value"
    if old and old.get("regionId") and old.get("regionName"):
        return old["regionId"], old["regionName"], old.get("regionAssignmentStatus", "retained-from-existing-data")
    return "TW-UNK", "待指定縣市", "needs-city-column"


def stable_id(name: str, region_id: str) -> str:
    digest = hashlib.sha1(norm_name(name).encode("utf-8")).hexdigest()[:10]
    return f"tw-{region_id.lower()}-funbox-{digest}"


def find_header_row(rows: list[list[str]], scan_limit: int = 40) -> tuple[int, list[str], dict[str, str]]:
    """Find the real column-header row, even when a title/blank row is above it."""
    for index, row in enumerate(rows[:scan_limit]):
        # Google Sheets may serialize a merged title cell as one value plus empty cells.
        try:
            columns = header_map(row)
            return index, row, columns
        except ValueError:
            continue
    preview = [row for row in rows[:min(8, len(rows))]]
    raise ValueError(
        "前 40 列都找不到必要欄位標題（店名、粉專網址、LINE官方帳號ID）。"
        f"目前 CSV 前幾列：{preview}。請確認發布的是正確工作表，且欄位標題有包含這三個名稱。"
    )


def parse_rows(csv_text: str, old_stores: list[dict[str, Any]], sheet_url: str) -> list[dict[str, Any]]:
    # Do not assume the first CSV row is the header: the user's sheet has a title row first.
    rows = list(csv.reader(io.StringIO(csv_text)))
    if not rows:
        raise ValueError("CSV 是空的，沒有任何資料列。")
    header_index, header, columns = find_header_row(rows)
    header_positions = {name: index for index, name in enumerate(header) if name is not None}

    def cell(row: list[str], key: str) -> str:
        column_name = columns.get(key)
        if not column_name:
            return ""
        column_index = header_positions.get(column_name)
        if column_index is None or column_index >= len(row):
            return ""
        return (row[column_index] or "").strip()

    existing = {norm_name(store.get("name", "")): store for store in old_stores}
    stores: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row_number, row in enumerate(rows[header_index + 1:], start=header_index + 2):
        name = cell(row, "name")
        facebook_raw = cell(row, "facebook")
        line_raw = cell(row, "line")
        if not name and not facebook_raw and not line_raw:
            continue
        if not name:
            raise ValueError(f"第 {row_number} 列有社群資料但沒有店名。")
        key = norm_name(name)
        if key in seen:
            raise ValueError(f"店名重複：{name}（第 {row_number} 列）。請先在試算表合併重複列。")
        seen.add(key)
        old = existing.get(key)
        city = cell(row, "city")
        region_id, region_name, region_status = city_info(city, old)
        facebook = clean_url(facebook_raw)
        line_id = clean_line_id(line_raw)
        if not facebook and not line_id:
            raise ValueError(f"第 {row_number} 列「{name}」沒有 Facebook 網址或 LINE ID。")
        address = cell(row, "address")
        phone = cell(row, "phone")
        active_raw = cell(row, "active").lower()
        active = active_raw not in {"否", "停用", "關閉", "false", "0", "no", "inactive"}
        item = {
            "storeId": (old or {}).get("storeId") or stable_id(name, region_id),
            "regionId": region_id,
            "regionName": region_name,
            "brand": "Funbox",
            "name": name,
            "aliases": (old or {}).get("aliases", []),
            "address": address or (old or {}).get("address"),
            "phone": phone or (old or {}).get("phone"),
            "lineId": line_id,
            "lineUrl": f"https://line.me/R/ti/p/{urllib.parse.quote(line_id, safe='@') }" if line_id else None,
            "facebookUrl": facebook,
            "sourceType": "google-sheets-import",
            "verificationStatus": "user-provided-not-individually-verified",
            "sourceUrls": [sheet_url],
            "lastVerifiedAt": (old or {}).get("lastVerifiedAt"),
            "active": active,
            "regionAssignmentStatus": region_status,
        }
        stores.append(item)
    return stores


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="從 Google Sheets CSV 自動同步 Funbox 門市資料")
    parser.add_argument("--csv-url", default=os.environ.get("FUNBOX_SHEET_CSV_URL") or DEFAULT_CSV_URL)
    parser.add_argument("--sheet-url", default=SHEET_URL)
    parser.add_argument("--data-dir", default="radar/data")
    parser.add_argument("--minimum-rows", type=int, default=20)
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    stores_path = data_dir / "stores.json"
    regions_path = data_dir / "regions.json"
    csv_path = data_dir / "stores.csv"
    metadata_path = data_dir / "source-metadata.json"

    old_stores = json.loads(stores_path.read_text(encoding="utf-8")) if stores_path.exists() else []
    old_regions = json.loads(regions_path.read_text(encoding="utf-8")) if regions_path.exists() else []
    metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else {}

    csv_text = fetch_csv(args.csv_url)
    source_rows = list(csv.reader(io.StringIO(csv_text)))
    header_index, _, _ = find_header_row(source_rows)
    print(f"已在 CSV 第 {header_index + 1} 列找到真正的欄位標題（自動略過上方標題／空白列）。")
    new_stores = parse_rows(csv_text, old_stores, args.sheet_url)
    if len(new_stores) < args.minimum_rows:
        raise ValueError(f"匯入只有 {len(new_stores)} 家，低於安全門檻 {args.minimum_rows} 家；為避免空白／錯誤 CSV 覆蓋原資料，已停止更新。")
    if old_stores and len(new_stores) < max(args.minimum_rows, int(len(old_stores) * 0.5)):
        raise ValueError(f"匯入筆數 {len(new_stores)} 家低於原資料 {len(old_stores)} 家的一半；已停止更新，請檢查試算表是否只發布部分範圍。")

    # Preserve existing region options and add regions seen in the sheet.
    region_by_id = {r.get("regionId"): r for r in old_regions}
    for store in new_stores:
        rid = store["regionId"]
        if rid not in region_by_id:
            region_by_id[rid] = {
                "regionId": rid,
                "country": "TW",
                "name": store["regionName"],
                "enabled": True,
                "default": rid == metadata.get("defaultRegion", "TW-TXG"),
            }
    new_regions = list(region_by_id.values())

    updated_at = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec="seconds")
    content_changed = (new_stores != old_stores) or (new_regions != old_regions)
    imported_at = updated_at if content_changed else metadata.get("importedAt", metadata.get("version", updated_at))
    new_metadata = dict(metadata)
    new_metadata.update({
        "dataset": "Funbox store social links",
        "version": imported_at,
        "providedBy": "Google Sheets (user-maintained)",
        "storeCount": len(new_stores),
        "regionCount": len({s["regionId"] for s in new_stores}),
        "defaultRegion": metadata.get("defaultRegion", "TW-TXG"),
        "fields": ["store name", "Facebook page URL", "LINE official account ID", "city (optional)"],
        "verification": "Imported from user-maintained Google Sheet. Facebook and LINE links are not automatically verified as active or official.",
        "sourceSheetUrl": args.sheet_url,
        "sourceCsvUrl": args.csv_url,
        "importedAt": imported_at,
        "regionMapping": "Existing region mapping is retained by matching store name. New stores should include an optional 縣市 column; otherwise they are assigned to 待指定縣市.",
    })

    # Emit a stable, spreadsheet-friendly CSV in the project's canonical column order.
    output = io.StringIO(newline="")
    fieldnames = ["storeId", "storeName", "regionName", "facebookUrl", "lineOfficialAccountId", "lineFriendUrl", "address", "phone", "verificationStatus"]
    writer = csv.DictWriter(output, fieldnames=fieldnames, lineterminator="\n")
    writer.writeheader()
    for s in new_stores:
        writer.writerow({
            "storeId": s["storeId"], "storeName": s["name"], "regionName": s["regionName"],
            "facebookUrl": s["facebookUrl"] or "", "lineOfficialAccountId": s["lineId"] or "",
            "lineFriendUrl": s["lineUrl"] or "", "address": s["address"] or "", "phone": s["phone"] or "",
            "verificationStatus": s["verificationStatus"],
        })

    changed_paths = []
    outputs = [
        (stores_path, json.dumps(new_stores, ensure_ascii=False, indent=2) + "\n"),
        (regions_path, json.dumps(new_regions, ensure_ascii=False, indent=2) + "\n"),
        (metadata_path, json.dumps(new_metadata, ensure_ascii=False, indent=2) + "\n"),
        (csv_path, "\ufeff" + output.getvalue()),
    ]
    for path, content in outputs:
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists() or path.read_text(encoding="utf-8-sig") != content.lstrip("\ufeff"):
            path.write_text(content, encoding="utf-8")
            changed_paths.append(str(path))

    print(f"Google Sheets 門市同步完成：{len(new_stores)} 家／{len({s['regionId'] for s in new_stores})} 個地區")
    print(f"台中市門市：{sum(1 for s in new_stores if s['regionId'] == 'TW-TXG')} 家")
    print("更新檔案：" + (", ".join(changed_paths) if changed_paths else "資料沒有變動"))
    if any(s["regionId"] == "TW-UNK" for s in new_stores):
        print("注意：有新門市缺少可判斷的縣市，請在試算表新增「縣市」欄並補值。")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"::error::{exc}", file=sys.stderr)
        raise SystemExit(1)
