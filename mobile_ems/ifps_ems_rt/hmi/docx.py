# -*- coding: utf-8 -*-
"""Word(.docx) 문서를 표준 라이브러리만으로 만든다(현장 노트북에는 Word 생성 도구가 없다). 제목·문단·표만 지원한다."""
import io, zipfile


def escape(t):
    """XML 본문에 넣을 글자 바꾸기(제어 문자는 뺀다)."""
    return "".join(c for c in str(t) if c >= " " or c in "\t\n").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


FONT = "맑은 고딕"
# 양식: 사무용 Word 문서와 같은 값(docs/lib.js 의 S · SP — 고치면 함께 고친다). 글자 크기는 반 포인트(22 = 11 pt)
SZ = {"body": 22, "h1": 28, "h2": 24, "table": 20, "note": 18, "foot": 18}
TEXT_W = 9638                                    # 본문 폭: A4, 좌·우 여백 20 mm
FOOT = "IFPS 전술전력통제체계(TPCS)  "              # 바닥글(쪽 번호 앞)
NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
CT = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      '<Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>')
RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
DOC_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>')
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
RPR = f'<w:rFonts w:ascii="{FONT}" w:hAnsi="{FONT}" w:eastAsia="{FONT}" w:cs="{FONT}"/>'
STYLES = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles {W}><w:docDefaults><w:rPrDefault><w:rPr>{RPR}<w:sz w:val="{SZ["body"]}"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault>'
          '<w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
          '<w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/></w:style>'
          + "".join(f'<w:style w:type="paragraph" w:styleId="h{i}"><w:name w:val="heading {i}"/><w:basedOn w:val="a"/><w:next w:val="a"/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="{b}" w:after="{a}"/><w:outlineLvl w:val="{i - 1}"/></w:pPr>'
                    f'<w:rPr><w:b/><w:sz w:val="{SZ["h" + str(i)]}"/></w:rPr></w:style>' for i, b, a in ((1, 280, 140), (2, 200, 100)))
          + '</w:styles>')
CENTER = '<w:jc w:val="center"/>'
BORDER = "".join(f'<w:{s} w:val="single" w:sz="4" w:space="0" w:color="808080"/>' for s in ("top", "left", "bottom", "right", "insideH", "insideV"))
CELL_MAR = "".join(f'<w:{s} w:w="{v}" w:type="dxa"/>' for s, v in (("top", 50), ("left", 90), ("bottom", 50), ("right", 90)))
FLD = '<w:r><w:rPr>{0}</w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr>{0}</w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr>{0}</w:rPr><w:fldChar w:fldCharType="end"/></w:r>'


def _run(text, bold=False, size=None, color=None):
    pr = ("<w:b/>" if bold else "") + (f'<w:sz w:val="{size}"/>' if size else "") + (f'<w:color w:val="{color}"/>' if color else "")
    return f'<w:r><w:rPr>{RPR}{pr}</w:rPr><w:t xml:space="preserve">{escape(str(text))}</w:t></w:r>'


def _size(size):
    """문단 글자 크기를 공통 양식에 맞춘다: 본문보다 작게 달라는 글은 주석 크기(9 pt), 큰 글(표지 제목)은 그대로."""
    return size if size is None or size > SZ["body"] else SZ["note"] if size < SZ["body"] else None


class Doc:
    def __init__(self):
        self.body = []

    def h1(self, text): self.body.append(f'<w:p><w:pPr><w:pStyle w:val="h1"/></w:pPr>{_run(text, True, SZ["h1"])}</w:p>'); return self
    def h2(self, text): self.body.append(f'<w:p><w:pPr><w:pStyle w:val="h2"/></w:pPr>{_run(text, True, SZ["h2"])}</w:p>'); return self

    def p(self, text, bold=False, size=None, color=None, align=None):
        ppr = f'<w:pPr><w:jc w:val="{align}"/></w:pPr>' if align else ""
        self.body.append(f"<w:p>{ppr}{_run(text, bold, _size(size), color)}</w:p>"); return self

    def kv(self, key, value):
        self.body.append(f"<w:p>{_run(key + '  ', True)}{_run(value)}</w:p>"); return self

    def page_break(self):
        self.body.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'); return self

    def table(self, head, rows, widths=None, size=None):
        """표. widths: 열 너비 비율. 줄이 없으면 '자료 없음' 한 줄을 넣는다. 글자는 공통 양식의 표 크기(10 pt)로 쓴다(size 는 예전 호출과 맞추려고 받기만 한다).
        폭 = 본문 폭, 머리줄은 쪽이 넘어가면 되풀이, 줄은 쪽 사이에서 나누지 않는다."""
        del size
        n = len(head); total = TEXT_W; ws = widths or [1] * n; cw = [int(total * w / sum(ws)) for w in ws]; cw[-1] += total - sum(cw); sz = SZ["table"]
        def cell(t, i, hd):
            shade = '<w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/>' if hd else ""
            return f'<w:tc><w:tcPr><w:tcW w:w="{cw[i]}" w:type="dxa"/>{shade}<w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:after="0" w:line="264" w:lineRule="auto"/>{CENTER if hd else ''}</w:pPr>{_run("" if t is None else t, hd, sz)}</w:p></w:tc>'
        grid = "".join('<w:gridCol w:w="%d"/>' % c for c in cw); row = lambda cells, hd=False: f'<w:tr><w:trPr><w:cantSplit/>{"<w:tblHeader/>" if hd else ""}</w:trPr>{cells}</w:tr>'
        body = "".join(row("".join(cell(c, i, False) for i, c in enumerate(r))) for r in rows) or row(cell("자료 없음", 0, False) + "".join(cell("", i, False) for i in range(1, n)))
        self.body.append(f'<w:tbl><w:tblPr><w:tblW w:w="{total}" w:type="dxa"/><w:tblBorders>{BORDER}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar>{CELL_MAR}</w:tblCellMar></w:tblPr>'
                         f'<w:tblGrid>{grid}</w:tblGrid>{row("".join(cell(h, i, True) for i, h in enumerate(head)), True)}{body}</w:tbl><w:p><w:pPr><w:spacing w:after="60"/></w:pPr></w:p>')
        return self

    def to_bytes(self):
        doc = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W} {NS_R}><w:body>{"".join(self.body)}'
               '<w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1134" w:bottom="1418" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>')
        rp = f'{RPR}<w:sz w:val="{SZ["foot"]}"/><w:color w:val="595959"/>'
        foot = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr {W}><w:p><w:pPr>{CENTER}</w:pPr>{_run(FOOT, False, SZ["foot"], "595959")}{FLD.format(rp)}</w:p></w:ftr>'
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("[Content_Types].xml", CT); z.writestr("_rels/.rels", RELS); z.writestr("word/_rels/document.xml.rels", DOC_RELS); z.writestr("word/styles.xml", STYLES); z.writestr("word/footer1.xml", foot); z.writestr("word/document.xml", doc)
        return out.getvalue()
