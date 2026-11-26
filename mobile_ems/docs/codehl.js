// 예시 코드의 문법 강조(C++ · C#): 한 줄을 색이 붙은 조각으로 나눈다. 편집기의 밝은 화면 색을 따른다(인쇄해도 읽히는 색)
const COLOR = { kw: "0000FF", type: "267F99", fn: "795E26", com: "008000", str: "A31515", num: "098658", pre: "AF00DB", txt: "000000", op: "000000" };
const KW = new Set(("alignas auto break case catch class const constexpr continue default delete do else enum explicit extern false for friend goto if inline namespace new nullptr operator "
  + "private protected public return sizeof static struct switch template this throw true try typedef typename union using virtual volatile while "
  + "abstract as async await base checked event finally foreach get in init interface internal is lock null out override params readonly record ref sealed set typeof var when where yield").split(" "));
const TYPE = new Set(("void bool char short int long float double unsigned signed size_t string object decimal byte uint ulong ushort sbyte "
  + "u8 u16 u32 u64 i8 i16 i32 i64 f32 f64 Task ValueTask List Dictionary IReadOnlyList IReadOnlyDictionary TimeSpan DateTime DateTimeOffset CancellationToken").split(" "));
const RE = /(\/\/.*$|\/\*.*?\*\/)|(\$?@?"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])'|<[a-z_]+\.h>)|(^\s*#\s*[a-z]+)|(\b\d[\dA-Fa-fxXuUlL.]*\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|(.)/g;

/** 한 줄 → [{ t: 글, c: 색(16진), i: 기울임 }] */
function tokens(line) {
  const out = [], push = (t, k) => { const c = COLOR[k], p = out[out.length - 1]; if (p && p.c === c && !!p.i === (k === "com")) p.t += t; else out.push({ t, c, i: k === "com" }); };
  let m; RE.lastIndex = 0;
  while ((m = RE.exec(line)) !== null) {
    if (m[1]) push(m[1], "com"); else if (m[2]) push(m[2], "str"); else if (m[3]) push(m[3], "pre"); else if (m[4]) push(m[4], "num");
    else if (m[5]) { const w = m[5], rest = line.slice(RE.lastIndex);
      push(w, KW.has(w) ? "kw" : TYPE.has(w) ? "type" : /^\s*\(/.test(rest) ? "fn" : /^[A-Z][a-z0-9]+[A-Z]?/.test(w) && !/^[A-Z0-9_]+$/.test(w) ? "type" : "txt"); }
    else push(m[6] || m[7], "txt");
  }
  return out.length ? out : [{ t: " ", c: COLOR.txt, i: false }];
}
module.exports = { tokens, COLOR };
