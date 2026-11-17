# -*- coding: utf-8 -*-
"""C++ 핵심부(cpp/) 신뢰성 사전 점검: 엄격 컴파일, 파이썬 판과의 동등성 시험, 실행률(gcov), 정적 점검(clang-tidy),
MISRA C++:2008 기계 점검(일부 규칙), 소스 메트릭(lizard). 결과: docs/cpp_results.json

  python tools/cpp_report.py

주의: 공인 도구(LDRA·VectorCAST·QAC·CodeScroll 등)의 결과가 아니다. 공인 시험 전에 걸러 내기 위한 사전 점검이다.
필요: g++ 또는 clang++, cmake, gcov. clang-tidy·lizard 는 있으면 쓴다."""
import json, os, re, shutil, subprocess, sys  # nosec B404 — 개발 도구 실행(고정 인자)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); CPP = os.path.join(ROOT, "cpp"); B = os.path.join(CPP, "build")
SRC = ["src/modbus_codec.cpp", "src/ops_logic.cpp"]; HDR = ["include/ems_types.h", "include/modbus_codec.h", "include/ops_logic.h"]
STRICT = ["-std=c++98", "-Wall", "-Wextra", "-Wpedantic", "-Werror", "-Wconversion", "-Wsign-conversion", "-Wshadow", "-Wfloat-equal", "-Wold-style-cast", "-Wcast-qual", "-Wundef",
          "-fno-exceptions", "-fno-rtti", "-fsyntax-only", "-Iinclude"]
TIDY = "-*,clang-analyzer-*,bugprone-*,-bugprone-easily-swappable-parameters,cert-*,misc-*,-misc-include-cleaner,-misc-use-anonymous-namespace,readability-braces-around-statements,google-readability-casting,cppcoreguidelines-pro-type-reinterpret-cast,cppcoreguidelines-pro-type-union-access,cppcoreguidelines-pro-type-const-cast,cppcoreguidelines-no-malloc,cppcoreguidelines-owning-memory"
LIMITS = {"cc": 20, "len": 200, "arg": 8}
# 기계로 확인할 수 있는 MISRA C++:2008 규칙 일부 (번호, 내용, 정규식 — 주석·문자열을 지운 본문에 적용)
RULES = [("0-1-x / 18-4-1", "동적 메모리(new·delete·malloc·free) 사용 금지", r"\b(new|delete|malloc|calloc|realloc|free)\b"),
         ("15-x", "예외(throw·try·catch) 미사용 — 상태값 반환 방식", r"\b(throw|try|catch)\b"),
         ("9-5-1", "공용체(union) 금지", r"\bunion\b"), ("6-6-1 / 6-6-2", "goto 금지", r"\bgoto\b"),
         ("5-2-4", "C 방식·함수 표기 형 변환 금지(static_cast 사용)", r"\((?:unsigned |signed |const )*(?:u8|u16|u32|i16|i32|f32|f64|int|char|short|long|float|double|bool)\s*\*?\)\s*[\w(]"),
         ("5-2-7 / 5-2-8", "reinterpret_cast·const_cast·dynamic_cast 금지", r"\b(reinterpret_cast|const_cast|dynamic_cast)\b"),
         ("16-0-x / 16-2-1", "매크로 금지(포함 방지용만 허용)", r"^\s*#\s*define\s+(?!EMS_\w+_H\s*$)"), ("16-2-x", "#undef·#pragma·#if 조건부 컴파일 금지", r"^\s*#\s*(undef|pragma|if\b|elif)"),
         ("27-0-1", "<cstdio> 입출력 금지", r"<c?stdio(\.h)?>|\bprintf\b|\bscanf\b"), ("18-0-x", "<cstdlib>·<cstring>·<ctime>·<csignal> 금지", r"<c(stdlib|string|time|signal|setjmp)>|<(stdlib|string|time|signal|setjmp)\.h>"),
         ("3-9-2", "크기가 드러나지 않는 기본 자료형 직접 사용 금지(ems_types.h 제외)", r"\b(unsigned|signed|short|long|int|char|float|double)\b"),
         ("2-13-x / C++03", "C++11 이후 문법(auto·nullptr·constexpr·long long) 미사용", r"\b(auto|nullptr|constexpr|noexcept|decltype|static_assert)\b|\blong\s+long\b"),
         ("7-5-4", "재귀 금지 — 아래 호출 그래프 점검으로 확인", None), ("6-6-5", "함수당 return 하나", None), ("6-3-1 / 6-4-1", "제어문 본문은 중괄호 — clang-tidy readability-braces-around-statements 로 확인", None), ("6-4-2", "if … else if 는 else 로 끝남 — 사람 검토", None),
         ("6-4-6", "switch 에 default", None), ("6-2-2", "실수 == · != 비교 금지 — 컴파일러 -Wfloat-equal 로 확인", None)]


def run(args, cwd=CPP):
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True)  # nosec B603 — 고정 인자, shell 미사용
    return r.returncode, r.stdout + r.stderr


def strip(text):
    """주석과 문자열을 지운다(줄 수는 유지)."""
    text = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S); text = re.sub(r"//[^\n]*", "", text)
    return re.sub(r'"(?:\\.|[^"\\])*"', '""', text)


def functions(body):
    """함수 본문 목록 [(이름, 본문)]. 이름공간·클래스 중괄호는 건너뛴다."""
    out = []
    for m in re.finditer(r"^\s{4,12}(?:[\w:&<>*]+\s+)+?((?:\w+::)?\w+)\s*\([^;{}]*\)\s*(?:const\s*)?(?::[^{;]*)?\{", body, flags=re.M):
        i = m.end(); depth = 1
        while depth and i < len(body): depth += {"{": 1, "}": -1}.get(body[i], 0); i += 1
        out.append((m.group(1), body[m.end():i - 1]))
    return out


def misra(files):
    hits = {r[0]: [] for r in RULES}; funcs = []
    for f in files:
        raw = open(os.path.join(CPP, f), encoding="utf-8").read(); body = strip(raw)
        for rid, _, rx in RULES:
            if rx is None or (rid == "3-9-2" and f.endswith("ems_types.h")): continue
            for m in re.finditer(rx, body, flags=re.M): hits[rid].append(f"{f}:{body.count(chr(10), 0, m.start()) + 1}")
        if f.endswith(".cpp"): funcs += [(f, n, b) for n, b in functions(body)]
    names = {n.split("::")[-1] for _, n, _ in funcs}
    for f, n, b in funcs:
        if len(re.findall(r"\breturn\b", b)) > 1: hits["6-6-5"].append(f"{f}:{n}")
        if re.search(r"\b" + re.escape(n.split("::")[-1]) + r"\s*\(", b): hits["7-5-4"].append(f"{f}:{n}")
        for m in re.finditer(r"\bswitch\b", b):
            if "default" not in b[m.start():]: hits["6-4-6"].append(f"{f}:{n}")
    # 직접 재귀만 본다(호출 그래프가 얕다). 서로 부르는 재귀는 이름 집합으로 보조 확인
    del names
    return [{"rule": rid, "text": txt, "auto": rx is not None or rid in ("7-5-4", "6-6-5", "6-4-6"), "count": len(hits[rid]), "where": hits[rid][:8]} for rid, txt, rx in RULES], len(funcs)


def coverage():
    out = {}
    obj = os.path.join(B, "CMakeFiles", "ems_core.dir", "src")
    for s in SRC:
        base = os.path.basename(s); code, txt = run(["gcov", "-b", "-c", "-o", obj, os.path.join(obj, base + ".gcda")], cwd=B)
        gc = os.path.join(B, base + ".gcov"); ln = hit = br = bt = 0; miss = []
        for line in open(gc, encoding="utf-8", errors="replace"):
            m = re.match(r"\s*([\d#=\-]+)\*?:\s*(\d+):", line)
            if m and m.group(1) != "-":
                ln += 1
                if m.group(1).isdigit(): hit += 1
                else: miss.append(int(m.group(2)))
            m = re.match(r"branch\s+\d+\s+(taken\s+(\d+)|never executed)", line)
            if m: br += 1; bt += 1 if (m.group(2) and int(m.group(2)) > 0) else 0
        out[s] = {"lines": ln, "lines_hit": hit, "branches": br, "branches_hit": bt, "missed_lines": miss[:20]}
    tot = {k: sum(v[k] for v in out.values()) for k in ("lines", "lines_hit", "branches", "branches_hit")}
    tot["line_pct"] = round(100.0 * tot["lines_hit"] / max(1, tot["lines"]), 1); tot["branch_pct"] = round(100.0 * tot["branches_hit"] / max(1, tot["branches"]), 1)
    return out, tot


def metrics():
    try: import lizard
    except ImportError: return None
    fs = []
    for s in SRC:
        for f in lizard.analyze_file(os.path.join(CPP, s)).function_list: fs.append({"file": s, "name": f.name, "cc": f.cyclomatic_complexity, "len": f.nloc, "arg": len(f.parameters)})
    over = {k: [f"{f['name']}({f[k]})" for f in fs if f[k] > LIMITS[k]] for k in LIMITS}
    return {"n_func": len(fs), "limits": LIMITS, "cc_max": max(f["cc"] for f in fs), "cc_avg": round(sum(f["cc"] for f in fs) / len(fs), 2), "len_max": max(f["len"] for f in fs), "arg_max": max(f["arg"] for f in fs),
            "over": over, "top_cc": sorted(fs, key=lambda f: -f["cc"])[:6], "nloc": sum(f["len"] for f in fs)}


def main():
    res = {"standard": "MISRA C++:2008 (ISO C++03)", "files": SRC + HDR}
    if os.path.isdir(B): shutil.rmtree(B)
    os.makedirs(os.path.join(B, "vec"))
    code, txt = run([sys.executable, "tools/gen_vectors.py", os.path.join(B, "vec")]); res["vectors"] = txt.strip().splitlines()[-1] if code == 0 else "실패: " + txt[-300:]
    res["compile"] = []
    for cxx in ("g++", "clang++"):
        if not shutil.which(cxx): continue
        ver = run([cxx, "--version"])[1].splitlines()[0]; warn = 0; ok = True
        for s in SRC:
            c, t = run([cxx] + STRICT + [s]); ok = ok and c == 0; warn += len(re.findall(r"(warning|error):", t))
        res["compile"].append({"compiler": ver, "flags": " ".join(STRICT[:-2]), "ok": ok, "diagnostics": warn})
    c1, t1 = run(["cmake", "-S", ".", "-B", "build", "-DEMS_COVERAGE=ON"]); c2, t2 = run(["cmake", "--build", "build"])
    if c1 or c2: print(t1[-800:], t2[-1500:]); sys.exit("빌드 실패")
    c, t = run([os.path.join(B, "ems_tests"), os.path.join(B, "vec")]); m = re.search(r"확인 (\d+)건, 실패 (\d+)건", t)
    res["tests"] = {"ok": c == 0, "checks": int(m.group(1)) if m else 0, "failed": int(m.group(2)) if m else -1, "tail": t.strip().splitlines()[-3:]}
    res["coverage"], res["coverage_total"] = coverage()
    if shutil.which("clang-tidy"):
        c, t = run(["clang-tidy", "--quiet", "-checks=" + TIDY] + SRC + ["--", "-std=c++98", "-Iinclude", "-fno-exceptions"]); w = sorted(set(re.findall(r"^[^\n]*warning: [^\n]*\[([\w\-.,]+)\]", t, flags=re.M)))
        res["tidy"] = {"version": run(["clang-tidy", "--version"])[1].strip().splitlines()[0].strip(), "checks": TIDY, "warnings": len(re.findall(r"warning:", t)), "kinds": w, "sample": [x for x in t.splitlines() if "warning:" in x][:10]}
    res["misra"], res["misra_funcs"] = misra(SRC + HDR)
    res["misra_auto_violations"] = sum(r["count"] for r in res["misra"])
    res["metrics"] = metrics()
    with open(os.path.join(ROOT, "docs", "cpp_results.json"), "w", encoding="utf-8") as f: json.dump(res, f, ensure_ascii=False, indent=1)
    ct = res["coverage_total"]
    print(f"C++ 확인 {res['tests']['checks']}건 실패 {res['tests']['failed']} · 문장 {ct['line_pct']}% 분기 {ct['branch_pct']}% · 정적 경고 {res.get('tidy', {}).get('warnings', '미실행')} · MISRA 기계 점검 위반 {res['misra_auto_violations']} · 함수 {res['misra_funcs']}개")
    return 0 if res["tests"]["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
