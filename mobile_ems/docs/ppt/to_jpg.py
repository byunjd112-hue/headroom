# -*- coding: utf-8 -*-
"""docs/ppt/img 의 PNG 캡처를 JPG 로 바꾸고 PNG 는 지운다(보고자료 용량 절감)."""
import os
from PIL import Image
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "img")
for f in sorted(os.listdir(D)):
    if f.endswith(".png"):
        Image.open(os.path.join(D, f)).convert("RGB").save(os.path.join(D, f[:-4] + ".jpg"), quality=90); os.remove(os.path.join(D, f)); print(f)
