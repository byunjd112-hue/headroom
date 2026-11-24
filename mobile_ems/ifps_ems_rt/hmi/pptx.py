# -*- coding: utf-8 -*-
"""PowerPoint(.pptx) 파일을 표준 라이브러리만으로 쓰고 읽는다(현장 노트북에는 PPT 생성 도구가 없다).

쓰기: 글상자 · 사각형 · 선(화살표) · 표.  읽기: 장마다 글상자의 글과 표의 칸 글자만 뽑는다(시퀀스 문서를 고쳐서 다시 올릴 때 쓴다).
길이 단위는 인치. 16:9(13.333 × 7.5 인치).
"""
import io, re, zipfile
import xml.etree.ElementTree as ET        # nosec B405 — 읽는 쪽은 아래 read() 에서 DTD·엔티티 선언이 든 파일을 거부한다

FONT = "맑은 고딕"
EMU = 914400
W_IN, H_IN = 13.333, 7.5
NS = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main", "p": "http://schemas.openxmlformats.org/presentationml/2006/main"}
XA = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG = "application/vnd.openxmlformats-officedocument.presentationml"
DASH = '<a:prstDash val="dash"/>'
TAIL = '<a:tailEnd type="triangle"/>'
GRID = '<a:gridCol w="{}"/>'
MAX_FILE = 8 * 1024 * 1024
MAX_XML = 6 * 1024 * 1024


def esc(t):
    return "".join(c for c in str(t) if c >= " " or c in "\t\n").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def emu(v):
    return int(round(v * EMU))


def _rels(items):
    return HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + "".join(f'<Relationship Id="{i}" Type="{REL}/{t}" Target="{g}"/>' for i, t, g in items) + "</Relationships>"


def _theme():
    c = lambda n, v: f'<a:{n}><a:srgbClr val="{v}"/></a:{n}>'
    fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'; ln = '<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'; font = f'<a:latin typeface="{FONT}"/><a:ea typeface="{FONT}"/><a:cs typeface="{FONT}"/>'
    return (HEAD + '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="EMS"><a:themeElements><a:clrScheme name="EMS">'
            + c("dk1", "000000") + c("lt1", "FFFFFF") + c("dk2", "44546A") + c("lt2", "E7E6E6") + c("accent1", "4472C4") + c("accent2", "ED7D31") + c("accent3", "A5A5A5") + c("accent4", "FFC000") + c("accent5", "5B9BD5") + c("accent6", "70AD47") + c("hlink", "0563C1") + c("folHlink", "954F72")
            + f'</a:clrScheme><a:fontScheme name="EMS"><a:majorFont>{font}</a:majorFont><a:minorFont>{font}</a:minorFont></a:fontScheme><a:fmtScheme name="EMS"><a:fillStyleLst>{fill * 3}</a:fillStyleLst><a:lnStyleLst>{ln * 3}</a:lnStyleLst>'
            + '<a:effectStyleLst>' + '<a:effectStyle><a:effectLst/></a:effectStyle>' * 3 + f'</a:effectStyleLst><a:bgFillStyleLst>{fill * 3}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>')


TREE0 = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
MASTER = (HEAD + f'<p:sldMaster {XA}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>{TREE0}</p:spTree></p:cSld>'
          '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
          '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>')
LAYOUT = HEAD + f'<p:sldLayout {XA} type="blank"><p:cSld name="Blank"><p:spTree>{TREE0}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'


def _runs(text, size, bold, color, align):
    rp = f'<a:rPr lang="ko-KR" sz="{int(size * 100)}" b="{1 if bold else 0}" dirty="0"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill><a:latin typeface="{FONT}"/><a:ea typeface="{FONT}"/></a:rPr>'
    return "".join(f'<a:p><a:pPr algn="{align}"/><a:r>{rp}<a:t>{esc(line)}</a:t></a:r></a:p>' for line in str(text).split("\n"))


class Slide:
    def __init__(self):
        self.xml = []; self.n = 1

    def _id(self):
        self.n += 1; return self.n

    def box(self, x, y, w, h, text="", *style, **o):
        """글상자. style 은 차례로 (글자 크기, 굵게, 글자색, 정렬, 채움색, 테두리색) — 이름으로도 줄 수 있다. name 은 다시 읽을 때 찾는 이름표, valign 세로 정렬, round_ 둥근 모서리."""
        size, bold, color, align, fill, line = [o.get(k, style[n] if n < len(style) else d) for n, (k, d) in enumerate((("size", 12), ("bold", False), ("color", "222222"), ("align", "l"), ("fill", None), ("line", None)))]
        name = o.get("name", ""); valign = o.get("valign", "ctr"); round_ = o.get("round_", False); i = self._id(); f = f'<a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>' if fill else "<a:noFill/>"; ln = f'<a:ln w="9525"><a:solidFill><a:srgbClr val="{line}"/></a:solidFill></a:ln>' if line else "<a:ln><a:noFill/></a:ln>"
        self.xml.append(f'<p:sp><p:nvSpPr><p:cNvPr id="{i}" name="{esc(name or "box" + str(i))}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{emu(x)}" y="{emu(y)}"/><a:ext cx="{emu(w)}" cy="{emu(h)}"/></a:xfrm>'
                        f'<a:prstGeom prst="{"roundRect" if round_ else "rect"}"><a:avLst/></a:prstGeom>{f}{ln}</p:spPr><p:txBody><a:bodyPr wrap="square" lIns="54000" tIns="27000" rIns="54000" bIns="27000" anchor="{valign}"><a:normAutofit/></a:bodyPr><a:lstStyle/>{_runs(text, size, bold, color, align)}</p:txBody></p:sp>')
        return self

    def line(self, x1, y1, x2, y2, color="444444", width=1.25, dash=False, arrow=False):
        i = self._id(); fx = ' flipH="1"' if x2 < x1 else ""; fy = ' flipV="1"' if y2 < y1 else ""
        self.xml.append(f'<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="{i}" name="line{i}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm{fx}{fy}><a:off x="{emu(min(x1, x2))}" y="{emu(min(y1, y2))}"/><a:ext cx="{emu(abs(x2 - x1))}" cy="{emu(abs(y2 - y1))}"/></a:xfrm>'
                        f'<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="{int(width * 12700)}"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill>{DASH if dash else ""}{TAIL if arrow else ""}</a:ln></p:spPr></p:cxnSp>')
        return self

    def table(self, x, y, w, head, rows, *opt, **o):
        """표. opt 는 차례로 (열 너비 비율, 글자 크기, 줄 높이, 이름표) — 이름으로도 줄 수 있다. head_size 는 머리줄 글자 크기(없으면 본문과 같게)."""
        widths, size, row_h, name = [o.get(k, opt[n] if n < len(opt) else d) for n, (k, d) in enumerate((("widths", None), ("size", 10), ("row_h", 0.3), ("name", "table")))]; head_fill = o.get("head_fill", "5B4A34"); head_size = o.get("head_size", size); i = self._id(); n = len(head); ws = widths or [1.0] * n; tot = float(sum(ws)); cw = [emu(w * v / tot) for v in ws]
        def cell(t, hd):
            f = f'<a:solidFill><a:srgbClr val="{head_fill}"/></a:solidFill>' if hd else '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>'; b = "".join(f'<a:{s} w="6350"><a:solidFill><a:srgbClr val="999999"/></a:solidFill></a:{s}>' for s in ("lnL", "lnR", "lnT", "lnB"))
            return f'<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>{_runs(t, head_size if hd else size, hd, "FFFFFF" if hd else "222222", "ctr" if hd else "l")}</a:txBody><a:tcPr marL="45720" marR="45720" marT="22860" marB="22860" anchor="ctr">{b}{f}</a:tcPr></a:tc>'
        body = "".join(f'<a:tr h="{emu(row_h)}">' + "".join(cell("" if c is None else c, k == 0) for c in (list(r) + [""] * n)[:n]) + "</a:tr>" for k, r in enumerate([head] + list(rows)))
        self.xml.append(f'<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="{i}" name="{esc(name)}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="{emu(x)}" y="{emu(y)}"/><a:ext cx="{emu(w)}" cy="{emu(row_h * (len(rows) + 1))}"/></p:xfrm>'
                        f'<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid>{"".join(GRID.format(c) for c in cw)}</a:tblGrid>{body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>')
        return self

    def render(self):
        return HEAD + f'<p:sld {XA}><p:cSld><p:spTree>{TREE0}{"".join(self.xml)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'


class Deck:
    def __init__(self):
        self.slides = []

    def slide(self):
        s = Slide(); self.slides.append(s); return s

    def to_bytes(self):
        n = len(self.slides); buf = io.BytesIO()
        ct = (HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
              f'<Override PartName="/ppt/presentation.xml" ContentType="{PKG}.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="{PKG}.slideMaster+xml"/>'
              f'<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="{PKG}.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
              + "".join(f'<Override PartName="/ppt/slides/slide{i + 1}.xml" ContentType="{PKG}.slide+xml"/>' for i in range(n)) + "</Types>")
        pres = (HEAD + f'<p:presentation {XA}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>' + "".join(f'<p:sldId id="{256 + i}" r:id="rId{i + 3}"/>' for i in range(n))
                + f'</p:sldIdLst><p:sldSz cx="{emu(W_IN)}" cy="{emu(H_IN)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>')
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("[Content_Types].xml", ct); z.writestr("_rels/.rels", _rels([("rId1", "officeDocument", "ppt/presentation.xml")])); z.writestr("ppt/presentation.xml", pres)
            z.writestr("ppt/_rels/presentation.xml.rels", _rels([("rId1", "slideMaster", "slideMasters/slideMaster1.xml"), ("rId2", "theme", "theme/theme1.xml")] + [(f"rId{i + 3}", "slide", f"slides/slide{i + 1}.xml") for i in range(n)]))
            z.writestr("ppt/theme/theme1.xml", _theme()); z.writestr("ppt/slideMasters/slideMaster1.xml", MASTER)
            z.writestr("ppt/slideMasters/_rels/slideMaster1.xml.rels", _rels([("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"), ("rId2", "theme", "../theme/theme1.xml")]))
            z.writestr("ppt/slideLayouts/slideLayout1.xml", LAYOUT); z.writestr("ppt/slideLayouts/_rels/slideLayout1.xml.rels", _rels([("rId1", "slideMaster", "../slideMasters/slideMaster1.xml")]))
            for i, s in enumerate(self.slides):
                z.writestr(f"ppt/slides/slide{i + 1}.xml", s.render()); z.writestr(f"ppt/slides/_rels/slide{i + 1}.xml.rels", _rels([("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml")]))
        return buf.getvalue()


def _text(node):
    """글상자·칸 하나의 글자(문단은 줄바꿈으로)."""
    return "\n".join("".join(t.text or "" for t in p.iter(f"{{{NS['a']}}}t")) for p in node.iter(f"{{{NS['a']}}}p")).strip()


def _order(z, names):
    """장 순서는 presentation.xml 의 순서를 따른다(장을 옮겨도 맞게). 못 읽으면 파일 이름 순서."""
    try:
        rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("ppt/_rels/presentation.xml.rels"))}      # nosec B314 — read() 의 검사를 거친 꾸러미
        order = ["ppt/" + rels[s.get(f"{{{REL}}}id")].lstrip("/").replace("ppt/", "") for s in ET.fromstring(z.read("ppt/presentation.xml")).iter(f"{{{NS['p']}}}sldId")]      # nosec B314
        return [n for n in order if n in names] or names
    except (KeyError, ET.ParseError):
        return names


def _slide(raw):
    """장 하나의 글상자와 표."""
    if b"<!DOCTYPE" in raw or b"<!ENTITY" in raw: raise ValueError("허용하지 않는 XML 선언이 들어 있습니다")
    try: root = ET.fromstring(raw)                                         # nosec B314 — 크기 제한 + DTD·엔티티 거부 뒤에 읽는다
    except ET.ParseError as e: raise ValueError("장을 읽지 못했습니다(파일이 손상됨)") from e
    texts = []
    for sp in root.iter(f"{{{NS['p']}}}sp"):
        nm = sp.find(f"{{{NS['p']}}}nvSpPr/{{{NS['p']}}}cNvPr"); t = _text(sp)
        if t: texts.append((nm.get("name", "") if nm is not None else "", t))
    return {"texts": texts, "tables": [[[_text(tc) for tc in tr.findall(f"{{{NS['a']}}}tc")] for tr in tbl.findall(f"{{{NS['a']}}}tr")] for tbl in root.iter(f"{{{NS['a']}}}tbl")]}


def read(body):
    """pptx 를 읽어 장마다 {texts: [(이름표, 글)], tables: [[[칸 …] …] …]} 로 돌려준다. PowerPoint·한컴·LibreOffice 로 고쳐 저장한 파일도 읽는다."""
    if len(body) > MAX_FILE: raise ValueError("파일이 너무 큽니다(8 MB 까지)")
    try: z = zipfile.ZipFile(io.BytesIO(body))
    except zipfile.BadZipFile as e: raise ValueError("PowerPoint(.pptx) 파일이 아닙니다") from e
    names = sorted((n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)), key=lambda n: int(re.findall(r"\d+", n)[-1])); out = []
    for n in _order(z, names)[:400]:
        if z.getinfo(n).file_size > MAX_XML: raise ValueError("장 하나가 너무 큽니다")
        out.append(_slide(z.read(n)))
    return out
