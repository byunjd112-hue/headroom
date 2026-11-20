# -*- coding: utf-8 -*-
"""Word(.docx) 문서를 표준 라이브러리만으로 만든다(현장 노트북에는 Word 생성 도구가 없다). 제목·문단·표만 지원한다."""
import io, zipfile


def escape(t):
    """XML 본문에 넣을 글자 바꾸기(제어 문자는 뺀다)."""
    return "".join(c for c in str(t) if c >= " " or c in "\t\n").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


FONT = "맑은 고딕"
CT = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      '<Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
DOC_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
RPR = f'<w:rFonts w:ascii="{FONT}" w:hAnsi="{FONT}" w:eastAsia="{FONT}" w:cs="{FONT}"/>'
STYLES = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles {W}><w:docDefaults><w:rPrDefault><w:rPr>{RPR}<w:sz w:val="20"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault>'
          '<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="280" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
          '<w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/></w:style>'
          + "".join(f'<w:style w:type="paragraph" w:styleId="h{i}"><w:name w:val="heading {i}"/><w:basedOn w:val="a"/><w:next w:val="a"/><w:pPr><w:keepNext/><w:spacing w:before="{b}" w:after="{a}"/><w:outlineLvl w:val="{i - 1}"/></w:pPr>'
                    f'<w:rPr><w:b/><w:sz w:val="{s}"/></w:rPr></w:style>' for i, s, b, a in ((1, 30, 320, 140), (2, 24, 220, 100)))
          + '</w:styles>')
CENTER = '<w:jc w:val="center"/>'
BORDER = "".join(f'<w:{s} w:val="single" w:sz="4" w:space="0" w:color="808080"/>' for s in ("top", "left", "bottom", "right", "insideH", "insideV"))


def _run(text, bold=False, size=None, color=None):
    pr = ("<w:b/>" if bold else "") + (f'<w:sz w:val="{size}"/>' if size else "") + (f'<w:color w:val="{color}"/>' if color else "")
    return f'<w:r><w:rPr>{RPR}{pr}</w:rPr><w:t xml:space="preserve">{escape(str(text))}</w:t></w:r>'


class Doc:
    def __init__(self):
        self.body = []

    def h1(self, text): self.body.append(f'<w:p><w:pPr><w:pStyle w:val="h1"/></w:pPr>{_run(text, True, 30)}</w:p>'); return self
    def h2(self, text): self.body.append(f'<w:p><w:pPr><w:pStyle w:val="h2"/></w:pPr>{_run(text, True, 24)}</w:p>'); return self

    def p(self, text, bold=False, size=None, color=None, align=None):
        ppr = f'<w:pPr><w:jc w:val="{align}"/></w:pPr>' if align else ""
        self.body.append(f"<w:p>{ppr}{_run(text, bold, size, color)}</w:p>"); return self

    def kv(self, key, value):
        self.body.append(f"<w:p>{_run(key + '  ', True)}{_run(value)}</w:p>"); return self

    def page_break(self):
        self.body.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'); return self

    def table(self, head, rows, widths=None, size=17):
        """표. widths: 열 너비 비율. 줄이 없으면 '자료 없음' 한 줄을 넣는다."""
        n = len(head); total = 9638; ws = widths or [1] * n; cw = [int(total * w / sum(ws)) for w in ws]
        def cell(t, i, hd):
            shade = '<w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/>' if hd else ""
            return f'<w:tc><w:tcPr><w:tcW w:w="{cw[i]}" w:type="dxa"/>{shade}</w:tcPr><w:p><w:pPr><w:spacing w:after="0"/>{CENTER if hd else ''}</w:pPr>{_run("" if t is None else t, hd, size)}</w:p></w:tc>'
        grid = "".join('<w:gridCol w:w="%d"/>' % c for c in cw)
        body = "".join("<w:tr>" + "".join(cell(c, i, False) for i, c in enumerate(r)) + "</w:tr>" for r in rows) or ("<w:tr>" + cell("자료 없음", 0, False) + "".join(cell("", i, False) for i in range(1, n)) + "</w:tr>")
        self.body.append(f'<w:tbl><w:tblPr><w:tblW w:w="{total}" w:type="dxa"/><w:tblBorders>{BORDER}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr>'
                         f'<w:tblGrid>{grid}</w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr>{"".join(cell(h, i, True) for i, h in enumerate(head))}</w:tr>{body}</w:tbl><w:p/>')
        return self

    def to_bytes(self):
        doc = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W}><w:body>{"".join(self.body)}'
               '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1134" w:bottom="1418" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>')
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("[Content_Types].xml", CT); z.writestr("_rels/.rels", RELS); z.writestr("word/_rels/document.xml.rels", DOC_RELS); z.writestr("word/styles.xml", STYLES); z.writestr("word/document.xml", doc)
        return out.getvalue()
