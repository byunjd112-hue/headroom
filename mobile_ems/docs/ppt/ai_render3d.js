// 입체 모델 그림 생성: ai_paper_eval.json 의 실제 값을 three.js 로 그려 docs/ppt/img/ai3d_m_*.png 로 저장한다(개발 PC 에서만 실행, 결과 그림을 저장소에 둔다).
//   npm i three (아무 폴더)  →  node docs/ppt/ai_render3d.js <three 가 설치된 node_modules/three 경로>
const http = require("http"), fs = require("fs"), path = require("path"); const { chromium } = require("playwright");
const THREE_DIR = process.argv[2]; if (!THREE_DIR || !fs.existsSync(path.join(THREE_DIR, "build", "three.module.js"))) { console.error("three 경로를 주십시오"); process.exit(2); }
const HERE = path.join(__dirname, "ai3d"), TYPES = { ".js": "text/javascript", ".html": "text/html; charset=utf-8", ".json": "application/json" };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split("?")[0]);
  const f = u === "/data.json" ? path.join(__dirname, "ai_paper_eval.json") : u.startsWith("/three/") ? path.join(THREE_DIR, path.normalize(u.slice(7))) : path.join(HERE, path.normalize(u === "/" ? "index.html" : u.slice(1)));
  if (!(f.startsWith(THREE_DIR) || f.startsWith(__dirname)) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); });
srv.listen(0, "127.0.0.1", async () => { const B = `http://127.0.0.1:${srv.address().port}/`, b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  for (const s of (process.argv[3] ? process.argv[3].split(",") : ["arch", "ridge", "attn", "imp", "band", "alpha", "now"])) { const p = await b.newPage({ viewport: { width: 1600, height: 900 } }); const errs = []; p.on("pageerror", e => errs.push(String(e))); p.on("console", m => m.type() === "error" && errs.push(m.text()));
    await p.goto(B + "?s=" + s); await p.waitForFunction("window.__done === true", null, { timeout: 180000 }).catch(() => {}); await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(__dirname, "img", `ai3d_m_${s}.png`) }); console.log(s, errs.length ? errs.slice(0, 3) : "ok"); await p.close(); }
  await b.close(); srv.close(); });
