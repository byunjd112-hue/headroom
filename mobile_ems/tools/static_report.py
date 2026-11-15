# -*- coding: utf-8 -*-
"""정적 시험·커버리지 수집 → docs/static_results.json
  pip install coverage bandit pyflakes radon  (개발 PC)
  python tools/static_report.py"""
import json, os, re, subprocess, sys, tempfile, time  # nosec B404 — 개발 도구 실행(고정 인자)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); PY = sys.executable
SRC = ["ifps_ems", "ifps_ems_rt"]


def sh(args):
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True)  # nosec B603 — 고정 인자, shell 미사용


def main():
    R = {"date": time.strftime("%Y-%m-%d %H:%M")}
    # 단위·통합 시험 + 커버리지
    sh([PY, "-m", "coverage", "erase"])
    t0 = time.time(); r = sh([PY, "-W", "ignore", "-m", "coverage", "run", "--source", ",".join(SRC), "-m", "unittest", "discover", "-s", "tests", "-v"]); R["unittest_s"] = round(time.time() - t0, 1)
    lines = r.stderr.splitlines(); R["tests"] = [re.sub(r"\s+\(.*?\)", "", l).replace(" ... ", " | ") for l in lines if " ... " in l]
    m = re.search(r"Ran (\d+) tests", r.stderr); R["n_tests"] = int(m.group(1)) if m else 0; R["tests_ok"] = r.stderr.rstrip().endswith("OK")
    fd, cj = tempfile.mkstemp(suffix=".json"); os.close(fd)
    sh([PY, "-m", "coverage", "json", "-o", cj]); cov = json.load(open(cj)); os.remove(cj)
    R["coverage_pct"] = round(cov["totals"]["percent_covered"], 1)
    R["coverage_files"] = sorted([[f, round(v["summary"]["percent_covered"], 1), v["summary"]["num_statements"]] for f, v in cov["files"].items()], key=lambda x: x[1])
    # pyflakes
    r = sh([PY, "-m", "pyflakes"] + SRC + ["tools", "tests"]); R["pyflakes"] = [l for l in r.stdout.splitlines() if l.strip()]
    # bandit
    r = sh([PY, "-m", "bandit", "-q", "-r"] + SRC + ["tools", "-f", "json"]); b = json.loads(r.stdout or "{}")
    R["bandit"] = {"totals": b.get("metrics", {}).get("_totals", {}), "results": [[x["test_id"], x["issue_severity"], x["filename"], x["line_number"], x["issue_text"]] for x in b.get("results", [])]}
    rn = sh([PY, "-m", "bandit", "-q", "-r"] + SRC + ["tools", "-f", "json", "--ignore-nosec"]); bn = json.loads(rn.stdout or "{}")
    R["bandit_nosec"] = [[x["test_id"], x["issue_severity"], x["filename"], x["line_number"], x["issue_text"]] for x in bn.get("results", [])]
    # 복잡도·유지보수성
    r = sh([PY, "-m", "radon", "cc", "-s", "-j"] + SRC); cc = json.loads(r.stdout)
    blocks = [[f, b["name"], b["complexity"], b["rank"]] for f, bl in cc.items() for b in bl if isinstance(b, dict)]
    R["cc_avg"] = round(sum(b[2] for b in blocks) / len(blocks), 2); R["cc_n"] = len(blocks)
    R["cc_rank"] = {k: sum(1 for b in blocks if b[3] == k) for k in "ABCDEF"}; R["cc_top"] = sorted(blocks, key=lambda b: -b[2])[:10]
    r = sh([PY, "-m", "radon", "mi", "-s", "-j"] + SRC); R["mi"] = sorted([[f, round(v["mi"], 1), v["rank"]] for f, v in json.loads(r.stdout).items()], key=lambda x: x[1])
    r = sh([PY, "-m", "radon", "raw", "-s", "-j"] + SRC); raw = json.loads(r.stdout)
    R["loc_py"] = {"files": len(raw), "sloc": sum(v["sloc"] for v in raw.values()), "comments": sum(v["comments"] + v["multi"] for v in raw.values())}
    js = [os.path.join("ifps_ems_rt/hmi/static", f) for f in os.listdir(os.path.join(ROOT, "ifps_ems_rt/hmi/static")) if f.endswith(".js")]
    R["js"] = [[f, sum(1 for _ in open(os.path.join(ROOT, f), encoding="utf-8")), sh(["node", "--check", f]).returncode == 0] for f in sorted(js)]
    R["inline_handlers"] = sum(open(os.path.join(ROOT, f), encoding="utf-8").read().count('onclick="') for f in js)
    out = os.path.join(ROOT, "docs", "static_results.json"); json.dump(R, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"tests {R['n_tests']} ok={R['tests_ok']} coverage {R['coverage_pct']}% pyflakes {len(R['pyflakes'])} bandit {len(R['bandit']['results'])} cc_avg {R['cc_avg']} → {out}")


if __name__ == "__main__":
    main()
