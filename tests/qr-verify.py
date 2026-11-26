"""Verifica el generador de QR (src/qr.ts) decodificándolo con OpenCV para varios largos (versiones 1-10). Uso: python tests/qr-verify.py"""
import subprocess, sys, os, tempfile
import numpy as np
import cv2

H = '/viajo/#viaje=-60.6393,-32.9468~-60.7,-32.99&o=C%C3%B3rdoba%201500&d=Plaza'
cases = ['hola', 'https://x.io/#linea=1-28&parada=5074', 'https://u.io' + H, 'z' * 100, 'z' * 230, 'ñQ' * 60, 'a' * 14, 'a' * 40, 'a' * 70, 'b' * 150, 'c' * 180, 'd' * 270]
bad = 0
for t in cases:
    out = subprocess.run(['node', 'tests/qr-dump.ts', t], capture_output=True, text=True)
    if out.returncode:
        print('no entra', len(t.encode())); continue
    rows = [l for l in out.stdout.split() if l]
    q, px, n = 4, 8, len(rows) + 8
    img = np.full((n * px, n * px), 255, np.uint8)
    for y, r in enumerate(rows):
        for x, c in enumerate(r):
            if c == '1': img[(y + q) * px:(y + q + 1) * px, (x + q) * px:(x + q + 1) * px] = 0
    txt, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
    ok = txt == t
    bad += not ok
    print('OK ' if ok else 'FALLA', 'size', len(rows), 'bytes', len(t.encode()))
sys.exit(1 if bad else 0)
