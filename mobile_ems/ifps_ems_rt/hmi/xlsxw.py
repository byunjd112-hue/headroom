"""표준 라이브러리만으로 쓰는 Excel(.xlsx) 작성기 — 표 몇 장을 글자 · 숫자로 적는다(수식 · 그림 없음).

write([(시트 이름, 줄 목록, 열 너비 목록), …]) → bytes. 줄의 첫 칸이 '#' 로 시작하면 그 줄은 굵게(머리말) 쓴다(# 는 빼고 적는다).
"""
import io, zipfile
from xml.sax.saxutils import escape

_CT = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
       '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
       '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
       '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>{sheets}</Types>')
_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
         '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
_STYLES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
           '<fonts count="2"><font><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><name val="맑은 고딕"/></font></fonts>'
           '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7E0D0"/></patternFill></fill></fills>'
           '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders>'
           '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
           '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
           '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
           '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs></styleSheet>')
_BAD = {i: None for i in range(32) if i not in (9, 10, 13)}                 # XML 에 쓸 수 없는 제어 문자는 뺀다


def _col(i):
    s = ""; i += 1
    while i: i, r = divmod(i - 1, 26); s = chr(65 + r) + s
    return s


def _cell(ref, v, style):
    if isinstance(v, (int, float)) and not isinstance(v, bool): return f'<c r="{ref}" s="{style}"><v>{v}</v></c>'
    t = escape(str("" if v is None else v).translate(_BAD))
    return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{t}</t></is></c>'


def _sheet(rows, widths):
    cols = "".join(f'<col min="{i + 1}" max="{i + 1}" width="{w}" customWidth="1"/>' for i, w in enumerate(widths or []))
    out = []
    for r, row in enumerate(rows, 1):
        head = bool(row) and isinstance(row[0], str) and row[0].startswith("#"); cells = [row[0][1:] if head else row[0]] + list(row[1:]) if row else []
        out.append(f'<row r="{r}">' + "".join(_cell(f"{_col(c)}{r}", v, 2 if head else 1) for c, v in enumerate(cells)) + "</row>")
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            + (f"<cols>{cols}</cols>" if cols else "") + "<sheetData>" + "".join(out) + "</sheetData></worksheet>")


def write(sheets):
    """sheets: [(이름(31자 이내), 줄 목록, 열 너비 목록 또는 None)] → xlsx 파일의 바이트."""
    if not sheets: raise ValueError("시트가 없습니다")
    names = [escape(str(n)[:31].translate({ord(c): "_" for c in "[]:*?/\\"}), {'"': "&quot;"}) for n, _, _ in sheets]
    wb = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
          + "".join(f'<sheet name="{n}" sheetId="{i}" r:id="rId{i}"/>' for i, n in enumerate(names, 1)) + "</sheets></workbook>")
    rel = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
           + "".join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1, len(sheets) + 1))
           + f'<Relationship Id="rId{len(sheets) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", _CT.format(sheets="".join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1, len(sheets) + 1))))
        z.writestr("_rels/.rels", _RELS); z.writestr("xl/workbook.xml", wb); z.writestr("xl/_rels/workbook.xml.rels", rel); z.writestr("xl/styles.xml", _STYLES)
        for i, (_, rows, widths) in enumerate(sheets, 1): z.writestr(f"xl/worksheets/sheet{i}.xml", _sheet(rows, widths))
    return buf.getvalue()
