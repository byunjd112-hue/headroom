# -*- coding: utf-8 -*-
"""태양 위치와 청천 출력(기상 예보 없이 위치·시각만으로 계산). 로직 설명서 2장."""
import math
import numpy as np


def cos_zenith(doy, hour, lat, lon, tz):
    """doy: 연중 일수(1~366), hour: 현지 표준시(소수 시간). 배열 입력 가능."""
    doy = np.asarray(doy, dtype=float); hour = np.asarray(hour, dtype=float)
    g = 2 * math.pi / 365 * (doy - 1 + (hour - 12) / 24)
    eot = 229.18 * (0.000075 + 0.001868 * np.cos(g) - 0.032077 * np.sin(g) - 0.014615 * np.cos(2 * g) - 0.040849 * np.sin(2 * g))
    dec = (0.006918 - 0.399912 * np.cos(g) + 0.070257 * np.sin(g) - 0.006758 * np.cos(2 * g) + 0.000907 * np.sin(2 * g)
           - 0.002697 * np.cos(3 * g) + 0.00148 * np.sin(3 * g))
    tst = hour * 60 + eot + 4 * lon - 60 * tz
    w = np.radians(tst / 4 - 180)
    la = math.radians(lat)
    return math.sin(la) * np.sin(dec) + math.cos(la) * np.cos(dec) * np.cos(w)


def clear_ghi(cz):
    """Haurwitz 청천 전천일사(W/㎡)."""
    cz = np.asarray(cz, dtype=float)
    out = np.zeros_like(cz)
    m = cz > 0.01
    out[m] = 1098 * cz[m] * np.exp(-0.057 / cz[m])
    return out


def clear_pv_kw(site, doy, hour):
    return site.pv_kwp * site.pv_pr * clear_ghi(cos_zenith(doy, hour, site.lat, site.lon, site.tz)) / 1000.0
