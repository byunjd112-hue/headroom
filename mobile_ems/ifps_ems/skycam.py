# -*- coding: utf-8 -*-
"""하늘 카메라: 하늘 사진에서 구름량(0~1)을 구한다. 태양광 예측의 입력으로 쓴다.

방법(붉은빛·푸른빛 비율): 맑은 하늘은 푸른빛이 강하고(R 이 B 보다 훨씬 작다) 구름은 흰색·회색이다(R ≈ B).
    ρ = (R − B) / (R + B)        구름 화소 ⇔ ρ > −0.12        구름량 = 구름 화소 수 ÷ 하늘 화소 수
어두운 사진(야간)은 판정하지 않는다. 카메라 프로그램이 정해진 경로에 최신 사진을 계속 덮어쓰면 TPCS 가 읽는다(runtime.json 의 skycam.path).
그림 형식: PNG(8비트 RGB·RGBA) — 표준 라이브러리만으로 읽는다. JPEG 등은 Pillow 가 설치되어 있을 때만 읽는다.
가상 장치 모드에서는 render() 가 구름량에 맞는 하늘 그림을 만들어 같은 경로로 흘려보낸다(카메라 흉내).
"""
import os, struct, time, zlib
import numpy as np

THRESH = -0.12              # 구름 판정 경계(ρ)
DARK = 40.0                 # 평균 밝기가 이보다 낮으면 야간으로 본다


def _unfilter(raw, w, h, bpp):
    """PNG 줄 필터를 푼다. 필터 0(없음)만 있는 그림은 한 번에 처리한다."""
    stride = w * bpp; rows = np.frombuffer(raw, dtype=np.uint8).reshape(h, stride + 1)
    if not rows[:, 0].any(): return rows[:, 1:].reshape(h, w, bpp)
    out = np.zeros((h, stride), dtype=np.uint8); prev = np.zeros(stride, dtype=np.int32)
    for y in range(h):
        ft = int(rows[y, 0]); line = rows[y, 1:].astype(np.int32); cur = np.zeros(stride, dtype=np.int32)
        if ft == 0: cur = line
        elif ft == 2: cur = (line + prev) & 255
        else:
            for x in range(stride):
                a = cur[x - bpp] if x >= bpp else 0; b = prev[x]; c = prev[x - bpp] if x >= bpp else 0
                if ft == 1: p = a
                elif ft == 3: p = (a + b) >> 1
                else:
                    pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c); p = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                cur[x] = (line[x] + p) & 255
        out[y] = cur; prev = cur
    return out.reshape(h, w, bpp)


def read_png(path):
    """8비트 RGB·RGBA PNG 를 (높이, 너비, 3) 배열로 읽는다. 지원하지 않는 형식이면 ValueError."""
    with open(path, "rb") as f: b = f.read()
    if b[:8] != b"\x89PNG\r\n\x1a\n": raise ValueError("PNG 가 아님")
    i = 8; idat = b""; w = h = bpp = 0
    while i + 8 <= len(b):
        n, typ = struct.unpack(">I4s", b[i:i + 8]); body = b[i + 8:i + 8 + n]; i += 12 + n
        if typ == b"IHDR":
            w, h, depth, ctype, _, _, inter = struct.unpack(">IIBBBBB", body)
            if depth != 8 or ctype not in (2, 6) or inter != 0: raise ValueError("8비트 RGB·RGBA(비월 주사 아님) PNG 만 지원")
            if w * h > 4000 * 3000: raise ValueError("그림이 너무 큼")
            bpp = 3 if ctype == 2 else 4
        elif typ == b"IDAT": idat += body
        elif typ == b"IEND": break
    if not w or not idat: raise ValueError("PNG 내용 없음")
    raw = zlib.decompress(idat)
    if len(raw) != h * (w * bpp + 1): raise ValueError("PNG 길이 불일치")
    return _unfilter(raw, w, h, bpp)[:, :, :3]


def write_png(path, rgb):
    """(높이, 너비, 3) uint8 배열을 PNG 로 쓴다(임시 파일 후 교체 — 읽는 쪽이 반쯤 쓴 그림을 보지 않게)."""
    h, w, _ = rgb.shape; raw = np.zeros((h, w * 3 + 1), dtype=np.uint8); raw[:, 1:] = rgb.reshape(h, w * 3)
    def chunk(typ, body): return struct.pack(">I", len(body)) + typ + body + struct.pack(">I", zlib.crc32(typ + body) & 0xFFFFFFFF)
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw.tobytes(), 6)) + chunk(b"IEND", b"")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True); tmp = path + ".tmp"
    with open(tmp, "wb") as f: f.write(data)
    os.replace(tmp, path)


def read_image(path):
    if path.lower().endswith(".png"): return read_png(path)
    try: from PIL import Image
    except ImportError: raise ValueError("PNG 가 아닌 그림은 Pillow 가 있어야 읽을 수 있음") from None
    with Image.open(path) as im: return np.asarray(im.convert("RGB"))


def cloud_cover(rgb):
    """구름량(0~1). 야간(어두움)이면 None."""
    a = np.asarray(rgb, dtype=float); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    if float(np.mean((r + g + b) / 3.0)) < DARK: return None
    sun = (r > 250) & (g > 250) & (b > 245)                       # 태양 원반(포화)은 하늘·구름 어느 쪽으로도 세지 않는다
    rho = (r - b) / (r + b + 1.0); sky = ~sun
    n = int(sky.sum())
    return None if n == 0 else float(np.mean(rho[sky] > THRESH))


def render(cover, seed=0, size=(160, 120)):
    """구름량에 맞는 하늘 그림을 만든다(가상 장치 모드의 카메라 흉내). 반환: uint8 배열"""
    w, h = size; rng = np.random.default_rng(seed); cover = float(min(1.0, max(0.0, cover)))
    yy = np.linspace(0, 1, h)[:, None]; sky = np.zeros((h, w, 3)); sky[..., 0] = 60 + 70 * yy; sky[..., 1] = 120 + 70 * yy; sky[..., 2] = 215 + 25 * yy
    field = np.zeros((h, w))
    for cell in (40, 20, 10):                                    # 크고 작은 덩어리를 겹쳐 구름 모양을 만든다
        gh, gw = h // cell + 2, w // cell + 2; small = rng.random((gh, gw)); big = np.kron(small, np.ones((cell, cell)))[:h, :w]
        kn = min(cell, h, w); k = np.ones(kn) / kn; big = np.apply_along_axis(lambda m: np.convolve(m, k, mode="same"), 0, big); big = np.apply_along_axis(lambda m: np.convolve(m, k, mode="same"), 1, big)
        field += big * cell
    img = sky.copy()
    if cover > 0.001:
        thr = np.quantile(field, 1.0 - cover); m = field >= thr
        shade = 205 + 40 * (field - field.min()) / max(1e-9, field.max() - field.min())
        for c in range(3): img[..., c] = np.where(m, shade - (4 if c == 2 else 0), img[..., c])
    return np.clip(img, 0, 255).astype(np.uint8)


class SkyCam:
    """정해진 경로의 최신 사진을 읽어 구름량을 돌려준다. 오래된 사진·읽기 실패는 '없음'으로 처리한다(잘못된 값을 쓰지 않는다)."""

    def __init__(self, path, max_age_s=180.0):
        self.path, self.max_age = path, float(max_age_s); self.last = {"ok": False, "why": "아직 읽지 않음"}; self._mtime = None

    def read(self, now=None):
        now = time.time() if now is None else now
        try:
            mt = os.path.getmtime(self.path)
            if now - mt > self.max_age: self.last = {"ok": False, "why": f"사진이 {now - mt:.0f}초 전 것(한도 {self.max_age:.0f}초)"}; return self.last
            if mt != self._mtime:
                c = cloud_cover(read_image(self.path)); self._mtime = mt
                self.last = {"ok": c is not None, "cover": c, "t": mt, "why": "" if c is not None else "야간(어두움) — 판정하지 않음"}
        except (OSError, ValueError, zlib.error, struct.error) as e:
            self.last = {"ok": False, "why": f"사진 읽기 실패: {e}"}
        return self.last
