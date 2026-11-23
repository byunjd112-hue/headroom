# -*- coding: utf-8 -*-
"""파일을 안전하게 바꿔 쓰는 공용 함수. 임시 파일에 다 쓴 뒤 이름을 바꾼다 — 쓰는 도중 전원이 끊겨도 앞 파일이 남는다.
상태 · 설정 · 배치 파일은 모두 이 함수로 쓴다(같은 코드를 모듈마다 되풀이하지 않는다)."""
import json, os, tempfile


def write_text(path, text, sync=False):
    """글을 path 에 바꿔 쓴다. sync: 디스크에 내려쓴 것을 확인한 뒤 바꾼다(설정 파일처럼 잃으면 안 되는 것). 실패하면 임시 파일을 지우고 OSError 를 그대로 낸다."""
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(path)), prefix=".w-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
            if sync: f.flush(); os.fsync(f.fileno())
        os.replace(tmp, path)
    except OSError:
        if os.path.exists(tmp): os.unlink(tmp)
        raise


def write_json(path, obj, indent=None, sync=False):
    write_text(path, json.dumps(obj, ensure_ascii=False, indent=indent), sync)
