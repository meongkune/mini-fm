"""선수 사진을 중계 그래픽처럼 같은 틀로 만든다 (얼굴 위치·크기 통일 + 배경 제거)

  1) 위키백과 대표 사진(data/photos/<리그>.json의 주소)을 큰 크기(960px)로 받는다
  2) 얼굴을 찾아(OpenCV) 얼굴이 같은 위치·같은 크기가 되도록 '머리~가슴' 정사각형으로 자른다
  3) 배경을 지운다(rembg) → 투명 배경 PNG를 160x160 WebP로 저장
  4) 얼굴을 못 찾거나 너무 작은(흐린) 사진은 건너뛴다 → 게임에서 구단 색 실루엣으로 대신한다

실행: python tools/player_faces.py --teams BRE,BMG   (또는 --leagues premier-league --limit 300)
결과: frontend/public/data/faces/<선수ID>.webp + frontend/public/data/faces/<리그>.json (만든 선수 목록)
사진은 위키미디어 공용의 자유 라이선스 이미지이며, 자르고 배경을 지운 결과물도 원본 라이선스를 따른다.
"""
import argparse
import io
import json
import os
import sys
import time
import urllib.request

import cv2
import numpy as np
from PIL import Image
from rembg import new_session, remove

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'frontend', 'public', 'data')
OUT = os.path.join(DATA, 'faces')
UA = 'MiniFM-faces/1.0 (https://github.com/meongkune/mini-fm; football manager hobby game)'
SIZE = 160

ap = argparse.ArgumentParser()
ap.add_argument('--teams', default='')
ap.add_argument('--leagues', default='')
ap.add_argument('--limit', type=int, default=100000)
ap.add_argument('--redo', action='store_true')
args = ap.parse_args()
teams = set(filter(None, args.teams.split(',')))
leagues = set(filter(None, args.leagues.split(',')))

cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
session = new_session('isnet-general-use')
os.makedirs(OUT, exist_ok=True)
index = json.load(open(os.path.join(DATA, 'index.json'), encoding='utf-8'))


def big(url):
    # 위키미디어 썸네일 주소의 폭을 키운다. 표준 크기만 허용된다(250·330·500·960·1280, 800은 400 오류)
    import re
    return re.sub(r'/(\d+)px-', '/960px-', url)


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def make(raw):
    img = Image.open(io.BytesIO(raw)).convert('RGB')
    arr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(arr, cv2.COLOR_BGR2GRAY)
    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(48, 48))
    if len(faces) == 0:
        return None, '얼굴 없음'
    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])  # 가장 큰 얼굴
    if w < 56:
        return None, '얼굴이 너무 작음'
    # 같은 틀: 얼굴 폭의 2.9배 정사각형, 얼굴 위쪽에 얼굴 높이의 0.7배 여백 → 머리~가슴
    side = int(w * 2.9)
    cx = x + w / 2
    top = int(y - h * 0.7)
    left = int(cx - side / 2)
    H, W = arr.shape[:2]
    pad = max(0, -left, -top, left + side - W, top + side - H)
    if pad > side * 0.22:
        return None, '얼굴이 사진 가장자리'
    rgba = np.zeros((side, side, 4), dtype=np.uint8)  # 바깥은 투명
    sx0, sy0 = max(0, left), max(0, top)
    sx1, sy1 = min(W, left + side), min(H, top + side)
    crop = cv2.cvtColor(arr[sy0:sy1, sx0:sx1], cv2.COLOR_BGR2RGBA)
    rgba[sy0 - top:sy1 - top, sx0 - left:sx1 - left] = crop
    cut = remove(Image.fromarray(rgba), session=session)  # 배경 제거
    alpha = np.array(cut)[:, :, 3]
    if (alpha > 128).mean() < 0.12:
        return None, '배경 제거 실패'
    return cut.resize((SIZE, SIZE), Image.LANCZOS), None


made = 0
stats = {}
for l in index['leagues']:
    if leagues and l['id'] not in leagues:
        continue
    pf = os.path.join(DATA, 'photos', f"{l['id']}.json")
    if not os.path.exists(pf):
        continue
    photos = json.load(open(pf, encoding='utf-8'))['players']
    season = json.load(open(os.path.join(DATA, l['seasons'][0]['file']), encoding='utf-8'))
    listf = os.path.join(OUT, f"{l['id']}.json")
    done = json.load(open(listf, encoding='utf-8'))['players'] if os.path.exists(listf) else {}
    for t in season['teams']:
        if teams and t['id'] not in teams:
            continue
        for p in t['players']:
            if made >= args.limit:
                break
            ph = photos.get(p['id'])
            if not ph or (p['id'] in done and not args.redo):
                continue
            try:
                face, why = make(fetch(big(ph['img'])))
            except Exception as e:  # noqa: BLE001 — 한 장 실패는 건너뛴다
                face, why = None, f'받기 실패 ({type(e).__name__})'
            time.sleep(0.4)
            if face is None:
                stats[why] = stats.get(why, 0) + 1
                done.pop(p['id'], None)
                continue
            face.save(os.path.join(OUT, f"{p['id']}.webp"), 'WEBP', quality=80, method=6)
            done[p['id']] = 1
            made += 1
            stats['성공'] = stats.get('성공', 0) + 1
    json.dump({'players': done}, open(listf, 'w', encoding='utf-8'))
    print(f"✔ {l['id']}: 통일 사진 {len(done)}명")
print('결과:', json.dumps(stats, ensure_ascii=False))
sys.stdout.flush()
