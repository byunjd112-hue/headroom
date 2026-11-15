# -*- coding: utf-8 -*-
"""정적 시험·커버리지 수집 → docs/static_results.json
  pip install coverage bandit pyflakes radon pylint  (개발 PC)
  python tools/static_report.py"""
import ast, collections, json, os, re, subprocess, sys, tempfile, time  # nosec B404 — 개발 도구 실행(고정 인자)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); PY = sys.executable
SRC = ["ifps_ems", "ifps_ems_rt"]
# 소스코드 메트릭 적용 기준(사업 신뢰성시험계획서로 확정): 순환 복잡도, 함수 줄 수, 인자 수, 중첩 깊이, 파일 줄 수
LIMITS = {"cc": 20, "len": 200, "arg": 8, "depth": 5, "file": 1000}


def sh(args):
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True)  # nosec B603 — 고정 인자, shell 미사용


def _ranges(lines):
    """[3,4,5,9] → '3-5, 9'"""
    out = []; lines = sorted(lines)
    for n in lines:
        if out and n == out[-1][1] + 1: out[-1][1] = n
        else: out.append([n, n])
    return ", ".join(str(a) if a == b else f"{a}-{b}" for a, b in out)


def _depth(node, d=0):
    """제어문 중첩 깊이(if/for/while/try/with)."""
    nest = (ast.If, ast.For, ast.While, ast.Try, ast.With, ast.AsyncFor, ast.AsyncWith)
    best = d; elif_ = node.orelse[0] if isinstance(node, ast.If) and len(node.orelse) == 1 and isinstance(node.orelse[0], ast.If) else None
    for ch in ast.iter_child_nodes(node):
        if isinstance(ch, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)): continue
        if ch is elif_: best = max(best, _depth(ch, d)); continue           # elif 는 같은 깊이
        best = max(best, _depth(ch, d + 1 if isinstance(ch, nest) else d))
    return best


def _metrics():
    """소스코드 메트릭: 함수별 순환 복잡도·줄 수·인자 수·중첩 깊이, 파일별 줄 수."""
    r = sh([PY, "-m", "radon", "cc", "-s", "-j"] + SRC); cc = {(f, b["name"], b["lineno"]): b["complexity"] for f, bl in json.loads(r.stdout).items() for b in bl if isinstance(b, dict)}
    for f, bl in json.loads(r.stdout).items():
        for b in bl:
            for m in (b.get("methods") or []) + (b.get("closures") or []): cc[(f, m["name"], m["lineno"])] = m["complexity"]
    funcs = []; files = []
    for src in SRC:
        for dp, _, fs in os.walk(os.path.join(ROOT, src)):
            for fn in sorted(fs):
                if not fn.endswith(".py"): continue
                p = os.path.join(dp, fn); rel = os.path.relpath(p, ROOT); text = open(p, encoding="utf-8").read(); files.append([rel, text.count("\n") + 1])
                for nd in ast.walk(ast.parse(text)):
                    if isinstance(nd, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        a = nd.args; n_arg = len(a.posonlyargs) + len(a.args) + len(a.kwonlyargs) - (1 if a.args and a.args[0].arg in ("self", "cls") else 0)
                        funcs.append([rel, nd.name, nd.lineno, cc.get((rel, nd.name, nd.lineno), 1), nd.end_lineno - nd.lineno + 1, n_arg, _depth(nd)])
    top = lambda i, n=8: sorted(funcs, key=lambda x: -x[i])[:n]
    return {"n_func": len(funcs), "limits": LIMITS, "cc_max": max(f[3] for f in funcs), "len_max": max(f[4] for f in funcs), "arg_max": max(f[5] for f in funcs), "depth_max": max(f[6] for f in funcs),
            "file_max": max(f[1] for f in files), "over": {"cc": [f for f in funcs if f[3] > LIMITS["cc"]], "len": [f for f in funcs if f[4] > LIMITS["len"]], "arg": [f for f in funcs if f[5] > LIMITS["arg"]],
                                                          "depth": [f for f in funcs if f[6] > LIMITS["depth"]], "file": [f for f in files if f[1] > LIMITS["file"]]},
            "top_cc": top(3), "top_len": top(4), "top_arg": top(5), "top_depth": top(6), "files": sorted(files, key=lambda x: -x[1])}


def main():
    R = {"date": time.strftime("%Y-%m-%d %H:%M")}
    # 단위·통합 시험 + 커버리지
    sh([PY, "-m", "coverage", "erase"])
    t0 = time.time(); r = sh([PY, "-W", "ignore", "-m", "coverage", "run", "--branch", "--source", ",".join(SRC), "-m", "unittest", "discover", "-s", "tests", "-v"]); R["unittest_s"] = round(time.time() - t0, 1)
    lines = r.stderr.splitlines(); R["tests"] = [re.sub(r"\s+\(.*?\)", "", l).replace(" ... ", " | ") for l in lines if " ... " in l]
    m = re.search(r"Ran (\d+) tests", r.stderr); R["n_tests"] = int(m.group(1)) if m else 0; R["tests_ok"] = r.stderr.rstrip().endswith("OK")
    fd, cj = tempfile.mkstemp(suffix=".json"); os.close(fd)
    sh([PY, "-m", "coverage", "json", "-o", cj]); cov = json.load(open(cj)); os.remove(cj)
    T = cov["totals"]; pct = lambda a, n: round(100.0 * a / n, 1) if n else 100.0
    R["coverage_pct"] = round(T["percent_covered"], 1)                                   # 문장+분기 합산(coverage.py 기준)
    R["stmt"] = {"n": T["num_statements"], "hit": T["covered_lines"], "pct": pct(T["covered_lines"], T["num_statements"])}
    R["branch"] = {"n": T["num_branches"], "hit": T["covered_branches"], "pct": pct(T["covered_branches"], T["num_branches"])}
    R["coverage_files"] = sorted([[f, pct(v["summary"]["covered_lines"], v["summary"]["num_statements"]), v["summary"]["num_statements"],
                                   pct(v["summary"]["covered_branches"], v["summary"]["num_branches"]), v["summary"]["num_branches"],
                                   _ranges(v["missing_lines"])] for f, v in cov["files"].items()], key=lambda x: x[1])
    # 코딩 규칙(pylint): 오류(E)·경고(W). 표기 관례(C)·구조 권고(R)는 소스코드 메트릭 항목에서 따로 본다
    r = sh([PY, "-m", "pylint"] + SRC + ["--disable=C,R", "--score=n", "-f", "json"]); pl = json.loads(r.stdout or "[]")
    R["pylint"] = {"E": sum(1 for x in pl if x["type"] in ("error", "fatal")), "W": sum(1 for x in pl if x["type"] == "warning"),
                   "by_id": sorted(collections.Counter(f'{x["message-id"]} {x["symbol"]}' for x in pl).items(), key=lambda kv: -kv[1]),
                   "items": [[x["message-id"], x["symbol"], x["path"], x["line"], x["obj"], x["message"]] for x in pl]}
    R["metrics"] = _metrics()
    # pyflakes
    r = sh([PY, "-m", "pyflakes"] + SRC + ["tools", "tests"]); R["pyflakes"] = [l for l in r.stdout.splitlines() if l.strip()]
    # bandit
    r = sh([PY, "-m", "bandit", "-q", "-r"] + SRC + ["tools", "-f", "json"]); b = json.loads(r.stdout or "{}")
    R["bandit"] = {"totals": b.get("metrics", {}).get("_totals", {}), "results": [[x["test_id"], x["issue_severity"], x["filename"], x["line_number"], x["issue_text"]] for x in b.get("results", [])]}
    cwe = lambda x: "CWE-" + str((x.get("issue_cwe") or {}).get("id", "?"))
    rn = sh([PY, "-m", "bandit", "-q", "-r"] + SRC + ["tools", "-f", "json", "--ignore-nosec"]); bn = json.loads(rn.stdout or "{}")
    R["bandit_nosec"] = [[x["test_id"], x["issue_severity"], x["filename"], x["line_number"], x["issue_text"], cwe(x)] for x in bn.get("results", [])]
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
    M = R["metrics"]; print("메트릭 초과:", {k: len(v) for k, v in M["over"].items()}, "최대", M["cc_max"], M["len_max"], M["arg_max"], M["depth_max"], "| pylint E/W", R["pylint"]["E"], R["pylint"]["W"])
    print(f"tests {R['n_tests']} ok={R['tests_ok']} 문장 {R['stmt']['pct']}% 분기 {R['branch']['pct']}% pyflakes {len(R['pyflakes'])} bandit {len(R['bandit']['results'])} cc_avg {R['cc_avg']} → {out}")


if __name__ == "__main__":
    main()
