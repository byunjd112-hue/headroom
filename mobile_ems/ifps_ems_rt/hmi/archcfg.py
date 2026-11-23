# -*- coding: utf-8 -*-
"""수집 항목 관리: 관리자(엔지니어 권한)가 화면에서 ESS 안전 운영정보 항목과 장치별 수집 신호, 저장 주기·보관 기간을 고친다.

  ESS 안전 운영정보 항목   config/ess_safety.csv 를 고쳐 쓴다(항목 넣기·빼기, 이름·단위·연결 신호).
  장치별 수집 신호         대응표의 읽기 신호 가운데 뺄 것을 고른다(runtime.json 의 archive.dev_exclude).
  주기 · 보관              검침(interval_min) · 장치별(dev_interval_min) · ESS(ess_interval_s) · 보관 기간 · 용량 한도.
저장하면 이전 판을 config/backup 에 남기고 바로 적용한다(재기동 불필요). 대응표 자체(주소·배율)는 디버그 화면의 설정 편집에서 고친다.
항목이나 주기를 바꾼 뒤의 기록은 새 구성으로 쌓이고, 앞선 기록은 그때의 구성으로 읽힌다.
"""
import csv, io, json, os, re, time
from .. import archive, archdev, fsio
from . import cfgedit

MAX_ITEMS = 120
KEY = re.compile(r"[a-z][a-z0-9_]{0,31}")
COLS = ("key", "group", "label", "unit", "tag")


def read(eng):
    """지금 구성: 주기·보관 설정, ESS 항목, 대응표의 읽기 신호(장치별, 수집 여부)."""
    cfg = archive.settings(eng.cfg.get("archive")); ex = set(cfg["dev_exclude"]); path = os.path.join(os.path.dirname(eng.cfg_path), "ess_safety.csv")
    sig = [{"tag": p["tag"], "dev": p["tag"].split(".")[0], "name": archdev.NAMES.get(p["tag"].split(".")[0], p["tag"].split(".")[0]), "unit": p["unit"], "on": p["tag"] not in ex} for p in eng.rt.pts if p["rw"] == "r"]
    return {"ok": True, "cfg": {k: cfg[k] for k in ("enabled", "interval_min", "dev_interval_min", "ess_interval_s", "retain_years", "max_mb", "server_url")}, "items": archdev.load_items(path), "signals": sig,
            "choices": {"interval_min": list(archive.INTERVALS), "dev_interval_min": list(archive.INTERVALS), "ess_interval_s": list(archive.ESS_STEPS), "retain_years": [1, 2, 3, 4, 5]}, "legal_years": archive.LEGAL_YEARS, "max_items": MAX_ITEMS}


def check(eng, b):
    """검사. 반환: (오류 목록, 항목, 설정 조각)"""
    bad = []; tags = {p["tag"] for p in eng.rt.pts if p["rw"] == "r"}; items = []; seen = set()
    raw = b.get("items")
    if not isinstance(raw, list) or len(raw) > MAX_ITEMS: return [f"ESS 항목은 {MAX_ITEMS}개까지입니다"], [], {}
    for n, r in enumerate(raw, 1):
        if not isinstance(r, dict): bad.append(f"{n}번 항목: 형식 오류"); continue
        it = {k: str(r.get(k) or "").strip()[:60] for k in COLS}
        if not KEY.fullmatch(it["key"]): bad.append(f"{n}번 항목: 이름표(key)는 영문 소문자로 시작하는 영문·숫자·밑줄 32자 이내")
        elif it["key"] in seen: bad.append(f"{n}번 항목: 이름표 '{it['key']}' 가 겹칩니다")
        if not it["label"]: bad.append(f"{n}번 항목: 항목 이름이 비었습니다")
        if it["tag"] and it["tag"] not in tags: bad.append(f"{n}번 항목: 연결 신호 '{it['tag']}' 가 대응표에 없습니다")
        seen.add(it["key"]); items.append(it)
    c = b.get("cfg") if isinstance(b.get("cfg"), dict) else {}; ex = b.get("dev_exclude", [])
    if not isinstance(ex, list) or any(x not in tags for x in ex): bad.append("빼는 신호 목록에 대응표에 없는 신호가 있습니다"); ex = []
    part = {k: c[k] for k in ("interval_min", "dev_interval_min", "ess_interval_s", "retain_years", "max_mb") if k in c}; part["dev_exclude"] = sorted(set(ex))
    cfgedit._check_archive(part, bad)                                  # pylint: disable=protected-access — 설정 편집과 같은 범위 검사
    return bad, items, part


def items_csv(items):
    out = io.StringIO(newline=""); w = csv.writer(out, lineterminator="\n"); w.writerow(COLS); [w.writerow([i[k] for k in COLS]) for i in items]; return out.getvalue()


def _write(path, text, bdir):
    """이전 판을 남기고 임시 파일에 쓴 뒤 바꿔치기한다."""
    os.makedirs(bdir, exist_ok=True)
    if os.path.isfile(path):
        with open(path, "rb") as f, open(os.path.join(bdir, f"ess_safety.{time.strftime('%Y%m%d-%H%M%S')}.csv"), "wb") as g: g.write(f.read())
    fsio.write_text(path, text, sync=True)


def save(eng, b, who):
    """검사 → 파일 두 개 저장(이전 판 보관) → 바로 적용 → 사건 기록."""
    bad, items, part = check(eng, b)
    if bad: return {"ok": False, "errors": bad}
    ed = eng.cfged; base = os.path.dirname(eng.cfg_path); synced = ed.loaded["runtime"] == cfgedit._sha(ed._text("runtime"))     # pylint: disable=protected-access
    with open(eng.cfg_path, encoding="utf-8") as f: full = json.load(f)
    before = archive.settings(full.get("archive")); full["archive"] = dict(full.get("archive") or {}, **part); old_items = archdev.load_items(os.path.join(base, "ess_safety.csv"))
    ed._write("runtime", json.dumps(full, ensure_ascii=False, indent=1) + "\n")                                                # pylint: disable=protected-access
    if synced: ed.loaded["runtime"] = cfgedit._sha(ed._text("runtime"))                                                        # pylint: disable=protected-access — 이 변경은 바로 적용되므로 '재기동 필요'로 보이지 않게
    if items != old_items: _write(os.path.join(base, "ess_safety.csv"), items_csv(items), ed.bdir)
    eng.cfg["archive"] = full["archive"]; after = archive.settings(full["archive"]); eng.archw.reconfigure(eng, after, items)
    diff = [f"{k} {before[k]} → {after[k]}" for k in ("interval_min", "dev_interval_min", "ess_interval_s", "retain_years", "max_mb") if before[k] != after[k]]
    if before["dev_exclude"] != after["dev_exclude"]: diff.append(f"장치별 수집 제외 신호 {len(before['dev_exclude'])} → {len(after['dev_exclude'])}개")
    if items != old_items: diff.append(f"ESS 안전 항목 {len(old_items)} → {len(items)}개(연결 {sum(1 for i in items if i['tag'])}개)")
    eng.rt.note("설정", "수집 항목 관리 저장: " + ("; ".join(diff) or "바뀐 내용 없음"), actor=who)
    return {"ok": True, "changed": diff}
