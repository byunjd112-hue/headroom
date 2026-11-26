"""문서 작성 공통 규칙(사용자 지시)을 산출물의 글에 적용한다: 줄표로 구절을 잇지 않는다, 낱말 사이에 가운뎃점을 쓰지 않는다.
Word 문서는 docs/lib.js 가 만들 때 같은 규칙을 적용한다(nodot · nodash — 두 곳의 규칙을 같게 유지한다).
여기서는 PowerPoint(.pptx)의 글과 파이썬으로 만드는 문서의 글에 쓴다.

  python tools/doc_rules.py pptx <파일> [<파일> …]     슬라이드 · 노트의 글을 고쳐 다시 저장
"""
import re
import sys
import zipfile

_DELIM = re.compile(r"([,.:;=→/①-⑳])")


def nodot(t):
    """가운뎃점으로 이은 나열: 둘이면 '및', 셋 이상이면 쉼표로 나열하고 마지막만 '및'. 괄호 안은 따로 센다."""
    t = t.replace("ㆍ", "·").replace("•", "·").replace("∙", "·")
    if "·" not in t: return t
    if "=" in t: t = re.sub(r"(?<=[A-Za-z0-9_)])·(?=[A-Za-z0-9_(])", " × ", t)        # 수식의 곱셈
    t = re.sub(r" ?· ?", " · ", t)                                                    # 붙여 쓴 점도 같은 나열로 본다
    hold = []

    def seg(x):
        n = x.count(" · ")
        if not n: return x
        has = re.search(r"(^|\s)및(\s|$)", x) is not None; parts = x.split(" · "); out = parts[0]
        for k, p in enumerate(parts[1:], 1): out += (" 및 " if k == n and not has else ", ") + p
        return out

    def flat(x): return "".join(seg(p) for p in _DELIM.split(x))

    def keep(m): hold.append("(" + flat(m.group(1)) + ")"); return f"\x01{len(hold) - 1}\x02"
    prev = None
    while prev != t: prev = t; t = re.sub(r"\(([^()]*)\)", keep, t)
    t = flat(t); prev = None
    while prev != t: prev = t; t = re.sub(r"\x01(\d+)\x02", lambda m: hold[int(m.group(1))], t)
    return t.replace(" · ", ", ")


def nodash(t):
    """줄표로 구절을 잇지 않는다: 앞말이 짧은 이름표면 쌍점, 아니면 쉼표로 잇는다. 줄표만 있는 칸은 '해당 없음'."""
    if t.strip() in ("—", "–"): return t.replace("—", "해당 없음").replace("–", "해당 없음")
    if "—" not in t and "–" not in t and " - " not in t: return t

    def rep(m):
        left = re.split(r"[.:;,(]", t[:m.start()])[-1].strip()
        return ": " if 0 < len(left) <= 14 and ":" not in t[:m.start()][-30:] else ", "
    t = re.sub(r"\s*[—–]\s*", rep, t)
    return re.sub(r"(?<=[가-힣)]) - (?=[가-힣(])", rep, t)


def clean(t):
    return nodot(nodash(t)) if isinstance(t, str) else t


def fix_pptx(path):
    """슬라이드 · 노트의 글(<a:t>)에 규칙을 적용해 같은 파일로 다시 쓴다. 고친 글의 수를 돌려준다."""
    n = 0; items = []
    with zipfile.ZipFile(path) as z:
        for i in z.infolist():
            data = z.read(i.filename)
            if re.match(r"ppt/(slides|notesSlides)/[^/]+\.xml$", i.filename):
                s = data.decode("utf-8")

                def rep(m):
                    nonlocal n
                    new = clean(m.group(2))
                    if new != m.group(2): n += 1
                    return m.group(1) + new + "</a:t>"
                data = re.sub(r"(<a:t(?: [^>]*)?>)([^<]*)</a:t>", rep, s).encode("utf-8")
            items.append((i, data))
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for i, data in items: z.writestr(i, data)
    return n


if __name__ == "__main__":
    if len(sys.argv) < 3 or sys.argv[1] != "pptx": sys.exit(__doc__)
    for p in sys.argv[2:]: print(f"규칙 적용 {fix_pptx(p)}곳: {p.split('/')[-1]}")
