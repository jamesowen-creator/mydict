#!/usr/bin/env python
# 작업358: 스펠링 런 그림 정리. 원본 그림 9장(reference/spellrun-art, git 무시)에서 게임용 결과물만 public/img/spellrun/ 에 만든다.
# 사용: python scripts/spellrun_art_build.py <원본 폴더> [<출력 폴더> [<수치 보고 파일>]]   (출력 폴더 기본값 public/img/spellrun, 보고 파일 기본값 scripts/spellrun_art_report.json)
# 같은 입력이면 같은 결과가 나온다(난수 없음). 필요한 것: Python 3, Pillow, numpy. 결과 수치는 scripts/spellrun_art_report.json 에 쓴다(시험이 읽는다).
#
# 만드는 것(논리 1px = 그림 2px, 캔버스 배율 최대 약 1.5 x dpr 2 = 3 에서도 흐리지 않게 하되 파일 크기를 줄이는 균형):
#   낮: bg_day_far.png(먼 층) bg_day_mid.png(중간 층) clouds_sheet.png(구름 5개 시트)
#   보스: bg_boss_sky.png(하늘, 불투명) bg_boss_far.png(먼 층) bg_boss_near.png(가까운 층)
#   spellrun_obstacles_sheet.png(1024x256, 칸 256, 흰 테두리 포함, 바닥선 FOOT_Y 237)
#   items_sheet.png(아이템 4종 한 줄: 하트, 번개, 힌트 전구, 천사 날개와 고리. 칸 112, 겉보기 큰 변 104)
#   spellrun_girl_sheet.png, spellrun_boy_sheet.png (1728x288, 칸 288, 6동작: 달리기 4 + 점프 상승 + 점프 하강, 발끝 y 280)
import json
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

SRC = {
    'day_far': '잔잔한 언덕과 작은 풍차.png',
    'day_mid': '꽃핀 초록 언덕과 두 울타리.png',
    'clouds': '투명 배경의 포근한 다섯 구름.png',
    'boss_sky': '인디고에서 금빛으로 물드는 석양 하늘-1.png',
    'boss_far': '보랏빛 원경의 완만한 구릉-2.png',
    'boss_near': '황혼의 보랏빛 전경 능선-3.png',
    'obstacles': '러너 게임용 4종 지형 장애물 스프라이트.png',
    'girl': '네이비 체육 반바지 치비 러너 스프라이트 시트.png',
    'boy': '한국 고등학생 러너 6프레임 스프라이트-2.png',
    'items': '하트·번개·전구·천사 날개 파워업.png',
}
ALPHA_CUT = 8          # 불투명도 약 3% 이하는 0(빛 번짐·점 얼룩·테두리 색 잔상)
SPECK_MIN = 400        # 이보다 작은 떨어진 조각(원본 px 면적)은 얼룩으로 보고 지운다
PX = 2                 # 논리 1px 당 그림 px
TILE_W = 640           # 배경 층 한 장의 논리 폭(그림 폭 = 1280)
SEAM = 32              # 좌우 이음새를 섞는 폭(그림 px). 먼저 윤곽이 맞는 자르는 자리를 찾아서(loop_crop) 조금만 섞는다
CELL_P = 288           # 캐릭터 칸
FOOT_Y = 280           # 캐릭터 발끝(칸 아래에서 8px 위). 펭귄 시트와 같다
OBST_CELL, OBST_FOOT = 256, 237
CLOUD_MAX_LOGICAL = 150

report = {}


def load(path):
    return np.array(Image.open(path).convert('RGBA'))


def clean_alpha(a):
    a = a.copy()
    a[..., 3] = np.where(a[..., 3] <= ALPHA_CUT, 0, a[..., 3])
    a[a[..., 3] == 0, :3] = 0
    return a


def label(mask, step=2):
    """연결 요소 라벨(4방향). 속도를 위해 step 배 줄여서 센 뒤 원래 크기로 돌려 준다."""
    small = mask[::step, ::step]
    h, w = small.shape
    lab = np.zeros((h, w), np.int32)
    n = 0
    ys, xs = np.nonzero(small)
    for y0, x0 in zip(ys.tolist(), xs.tolist()):
        if lab[y0, x0]:
            continue
        n += 1
        lab[y0, x0] = n
        q = deque([(y0, x0)])
        while q:
            y, x = q.popleft()
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                yy, xx = y + dy, x + dx
                if 0 <= yy < h and 0 <= xx < w and small[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = n
                    q.append((yy, xx))
    full = np.kron(lab, np.ones((step, step), np.int32))[:mask.shape[0], :mask.shape[1]]
    if full.shape != mask.shape:
        pad = np.zeros(mask.shape, np.int32)
        pad[:full.shape[0], :full.shape[1]] = full
        full = pad
    return full, n


def dilate(mask, r):
    im = Image.fromarray((mask * 255).astype(np.uint8))
    return np.array(im.filter(ImageFilter.MaxFilter(2 * r + 1))) > 0


def remove_specks(a, label_thr=40):
    """떨어진 작은 얼룩(조각)을 지운다. 가장 큰 것들은 그대로 둔다."""
    mask = a[..., 3] > label_thr
    lab, n = label(mask, 4)
    if n == 0:
        return a, 0
    areas = np.bincount(lab.ravel(), minlength=n + 1)
    removed = 0
    keep = np.ones(n + 1, bool)
    keep[0] = False
    for i in range(1, n + 1):
        if areas[i] * 16 < SPECK_MIN:   # step 4 라 면적은 1/16
            keep[i] = False
            removed += 1
    keep_mask = dilate(keep[lab], 6)    # 부드러운 가장자리를 남기려고 조금 넓혀서 유지
    out = a.copy()
    out[~keep_mask] = 0
    return out, removed


def to_img(a):
    return Image.fromarray(a, 'RGBA')


def premul(a):
    f = a.astype(np.float64)
    al = f[..., 3:4] / 255.0
    f[..., :3] = f[..., :3] * al
    return f


def unpremul(f):
    out = f.copy()
    al = out[..., 3:4] / 255.0
    with np.errstate(divide='ignore', invalid='ignore'):
        out[..., :3] = np.where(al > 0, out[..., :3] / np.maximum(al, 1e-6), 0)
    out = np.clip(np.rint(out), 0, 255).astype(np.uint8)
    out[out[..., 3] <= ALPHA_CUT, :] = 0
    return out


def seamless(a, blend=SEAM):
    """좌우 이음새 맞추기: 오른쪽 끝 blend 폭을 왼쪽 시작에 섞는다(미리 곱한 색으로). 결과 폭 = 원래 폭 - blend."""
    h, w = a.shape[:2]
    n = w - blend
    f = premul(a)
    out = f[:, :n].copy()
    t = np.linspace(0, 1, blend)[None, :, None]
    t = t * t * (3 - 2 * t)   # smoothstep
    out[:, :blend] = f[:, n:n + blend] * (1 - t) + f[:, :blend] * t
    res = unpremul(out)
    return res


def seam_diff(a):
    """이음새(마지막 열 → 첫 열)의 색 차이와, 이미지 안쪽 이웃 열 사이의 평균 차이(비교용). 둘 다 불투명한 행만 센다."""
    f = a.astype(np.int32)
    last, first = f[:, -1], f[:, 0]
    both = (last[:, 3] > 200) & (first[:, 3] > 200)
    alpha_mismatch = int(((last[:, 3] > 128) != (first[:, 3] > 128)).sum())
    seam = float(np.abs(last[both, :3] - first[both, :3]).mean()) if both.any() else 0.0
    inner = []
    for x in range(1, f.shape[1] - 1, max(1, f.shape[1] // 200)):
        l, r = f[:, x], f[:, x + 1]
        bo = (l[:, 3] > 200) & (r[:, 3] > 200)
        if bo.any():
            inner.append(np.abs(l[bo, :3] - r[bo, :3]).mean())
    return {'seam': round(seam, 2), 'inner_mean': round(float(np.mean(inner)), 2) if inner else 0.0, 'alpha_row_mismatch': alpha_mismatch, 'rows': int(f.shape[0])}


def save_png(a, path, colors=256, dither=False):
    im = to_img(a) if a.shape[2] == 4 else Image.fromarray(a, 'RGB')
    if a.shape[2] == 4:
        q = im.quantize(colors=colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG if dither else Image.Dither.NONE)
        pal = q.getpalette('RGBA')
        for i in range(0, len(pal), 4):
            if pal[i + 3] <= ALPHA_CUT:
                pal[i:i + 4] = [0, 0, 0, 0]
        q.putpalette(pal, 'RGBA')
    else:
        q = im.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG if dither else Image.Dither.NONE)
    q.save(path, optimize=True)
    return os.path.getsize(path)


def bbox(a, thr=40):
    ys, xs = np.nonzero(a[..., 3] > thr)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def resize_rgba(a, size):
    return np.array(to_img(a).resize(size, Image.LANCZOS))


def loop_crop(a):
    """왼쪽 끝과 오른쪽 끝의 윤곽(맨 위 불투명 줄)·색이 가장 비슷한 자르는 자리를 찾는다. 이음새에서 두 윤곽이 다르면 섞을 때 겹쳐 보이므로 먼저 맞는 자리를 고른다."""
    h, w = a.shape[:2]
    op = a[..., 3] > 128
    top = np.where(op.any(0), op.argmax(0), h).astype(np.float64)
    best = None
    la = range(0, int(w * 0.18), 3)
    ra = range(int(w * 0.82), w - 2, 3)
    for l in la:
        for r in ra:
            if r - l < w * 0.78:
                continue
            c = abs(top[l] - top[r]) * 2.0 + abs((top[l + 1] - top[l]) - (top[r] - top[r - 1])) * 1.0
            lc, rc = a[:, l], a[:, r]
            both = (lc[:, 3] > 200) & (rc[:, 3] > 200)
            if both.any():
                c += np.abs(lc[both, :3].astype(int) - rc[both, :3].astype(int)).mean() * 0.5
            if best is None or c < best[0]:
                best = (c, l, r)
    return a[:, best[1]:best[2]], {'left': best[1], 'right': best[2], 'cost': round(float(best[0]), 2)}


def build_layer(src, out_path, name):
    a, removed = remove_specks(clean_alpha(load(src)))
    x0, y0, x1, y1 = bbox(a, ALPHA_CUT)
    top = max(0, y0 - 4)
    a = a[top:]                                   # 내용이 있는 아래쪽만
    a, loop = loop_crop(a)                        # 윤곽이 맞는 좌우 자르는 자리
    ow = TILE_W * PX + SEAM
    h = int(round(a.shape[0] * ow / a.shape[1]))
    r = resize_rgba(a, (ow, h))
    r = clean_alpha(r)
    t = seamless(r)
    size = save_png(t, out_path, 256, dither=False)
    stat = seam_diff(np.array(Image.open(out_path).convert('RGBA')))
    report[name] = {'file': os.path.basename(out_path), 'size': [t.shape[1], t.shape[0]], 'bytes': size, 'logical': [TILE_W, t.shape[0] / PX], 'specks_removed': removed, 'loop_crop': loop, 'seam': stat}
    return t


def build_sky(src, out_path, name):
    a = np.array(Image.open(src).convert('RGB'))
    h, w = a.shape[:2]
    ow = 1024 + SEAM
    oh = int(round(h * ow / w))
    r = np.array(Image.fromarray(a).resize((ow, oh), Image.LANCZOS))
    rgba = np.dstack([r, np.full(r.shape[:2], 255, np.uint8)])
    t = seamless(rgba, SEAM)[..., :3]
    # 하늘은 부드러운 그라데이션이라 색 수를 늘려(디더링) 줄무늬를 줄인다
    size = save_png(t, out_path, 256, dither=True)
    stat = seam_diff(np.dstack([np.array(Image.open(out_path).convert('RGB')), np.full(t.shape[:2], 255, np.uint8)]))
    report[name] = {'file': os.path.basename(out_path), 'size': [t.shape[1], t.shape[0]], 'bytes': size, 'aspect': round(t.shape[1] / t.shape[0], 4), 'seam': stat}


def components_by_bbox(a, min_area=1500, step=4):
    lab, n = label(a[..., 3] > 40, step)
    areas = np.bincount(lab.ravel(), minlength=n + 1)
    items = []
    for i in range(1, n + 1):
        if areas[i] * step * step < min_area:
            continue
        ys, xs = np.nonzero(lab == i)
        items.append({'id': i, 'x0': int(xs.min()), 'y0': int(ys.min()), 'x1': int(xs.max()) + 1, 'y1': int(ys.max()) + 1, 'area': int(areas[i]) * step * step})
    return lab, items


def comp_pixels(a, lab, comp_ids, grow=6):
    keep = np.isin(lab, comp_ids)
    keep = dilate(keep, grow)
    out = a.copy()
    out[~keep] = 0
    return out


def build_clouds(src, out_path):
    a, removed = remove_specks(clean_alpha(load(src)))
    lab, items = components_by_bbox(a)
    items.sort(key=lambda c: (c['x0']))               # 왼쪽부터
    items = items[:5]
    maxw = max(c['x1'] - c['x0'] for c in items)
    s = (CLOUD_MAX_LOGICAL * PX) / maxw
    pieces = []
    for c in items:
        part = comp_pixels(a, lab, [c['id']])
        x0, y0, x1, y1 = bbox(part, ALPHA_CUT)
        part = part[y0:y1, x0:x1]
        w, h = int(round(part.shape[1] * s)), int(round(part.shape[0] * s))
        pieces.append(clean_alpha(resize_rgba(part, (w, h))))
    pad = 4
    sheet_w = max(p.shape[1] for p in pieces) + pad * 2
    # 한 줄에 쌓기(세로로 쌓은 시트: 단순하고 좌표 계산이 쉽다)
    y = pad
    rects = []
    for p in pieces:
        rects.append({'sx': pad, 'sy': y, 'sw': p.shape[1], 'sh': p.shape[0]})
        y += p.shape[0] + pad
    sheet = np.zeros((y, sheet_w, 4), np.uint8)
    for p, r in zip(pieces, rects):
        sheet[r['sy']:r['sy'] + r['sh'], r['sx']:r['sx'] + r['sw']] = p
    size = save_png(sheet, out_path, 256)
    report['clouds'] = {'file': os.path.basename(out_path), 'size': [sheet.shape[1], sheet.shape[0]], 'bytes': size, 'items': rects, 'specks_removed': removed, 'px_per_logical': PX}


def border_thickness(part):
    """흰 스티커 테두리 두께(그림 px): 바깥에서 안쪽으로 거의 흰색인 연속 픽셀 수의 중앙값."""
    th = []
    h, w = part.shape[:2]
    for y in range(h // 4, h * 3 // 4, max(1, h // 24)):
        row = part[y]
        idx = np.nonzero(row[:, 3] > 128)[0]
        if len(idx) == 0:
            continue
        n = 0
        for x in range(idx[0], w):
            if row[x, 3] > 128 and row[x, :3].min() >= 225:
                n += 1
            else:
                break
        th.append(n)
    return float(np.median(th)) if th else 0.0


def build_obstacles(src, out_path):
    a, removed = remove_specks(clean_alpha(load(src)))
    lab, items = components_by_bbox(a, 8000)
    assert len(items) == 4, '장애물 덩어리가 4개가 아님: %d' % len(items)
    items.sort(key=lambda c: ((c['y0'] + c['y1']) // 2 > a.shape[0] // 2, (c['x0'] + c['x1']) // 2))   # 위 왼쪽, 위 오른쪽, 아래 왼쪽, 아래 오른쪽
    names = ['rocks', 'log', 'crate', 'bush']
    parts = []
    for c in items:
        part = comp_pixels(a, lab, [c['id']])
        x0, y0, x1, y1 = bbox(part, ALPHA_CUT)
        parts.append(part[y0:y1, x0:x1])
    # 네 개가 같은 배율(테두리 두께가 같도록): 가장 넓은 것이 칸 안에 들어가게
    s = min((OBST_CELL - 12) / p.shape[1] for p in parts)
    scaled = [clean_alpha(resize_rgba(p, (int(round(p.shape[1] * s)), int(round(p.shape[0] * s))))) for p in parts]
    B = int(round(float(np.median([border_thickness(p) for p in scaled]))))
    sheet = np.zeros((OBST_CELL, OBST_CELL * 4, 4), np.uint8)
    objs = []
    for i, p in enumerate(scaled):
        h, w = p.shape[:2]
        bottom = OBST_FOOT + B                      # 흰 테두리 아래 끝(칸 안)
        top = bottom - h
        assert top >= 0, '장애물이 칸보다 높음: ' + names[i]
        left = OBST_CELL * i + (OBST_CELL - w) // 2
        sheet[top:bottom, left:left + w] = p
        objs.append({'name': names[i], 'w': w - 2 * B, 'h': h - 2 * B})
    size = save_png(sheet, out_path, 256)
    # 다시 읽어 칸마다 물체 크기·바닥을 잰다(game.js 가 실행 중에 재는 것과 같은 방식)
    chk = np.array(Image.open(out_path).convert('RGBA'))
    meas = []
    for i in range(4):
        cell = chk[:, OBST_CELL * i:OBST_CELL * (i + 1)]
        x0, y0, x1, y1 = bbox(cell, 128)
        meas.append({'name': names[i], 'w': x1 - x0 - 2 * B, 'h': y1 - y0 - 2 * B, 'foot': y1 - B})
    report['obstacles'] = {'file': os.path.basename(out_path), 'size': [sheet.shape[1], sheet.shape[0]], 'bytes': size, 'cell': OBST_CELL, 'foot_y': OBST_FOOT, 'border': B, 'scale': round(s, 4), 'objects': meas, 'specks_removed': removed}


def build_character(src, out_path, key, ref_penguin_h):
    a, removed = remove_specks(clean_alpha(load(src)))
    lab, items = components_by_bbox(a, 600, 2)
    H, W = a.shape[:2]
    cw, ch = W / 3.0, H / 2.0
    frames = {i: [] for i in range(6)}
    for c in items:
        cx, cy = (c['x0'] + c['x1']) / 2.0, (c['y0'] + c['y1']) / 2.0
        cell = int(cy // ch) * 3 + int(cx // cw)
        frames[cell].append(c['id'])
    assert all(len(v) >= 1 for v in frames.values()), '동작이 비어 있음: ' + str(frames)
    crops = []
    cut = []
    for i in range(6):
        part = comp_pixels(a, lab, frames[i], 3)
        x0, y0, x1, y1 = bbox(part, ALPHA_CUT)
        part = part[y0:y1, x0:x1]
        # 격자 칸을 넘어 이어지는 동작인지(칸 끝에 닿았는지) 기록
        gx0, gy0 = x0, y0
        gx1, gy1 = x1, y1
        cell_r, cell_c = i // 3, i % 3
        over = []
        if gx0 < cell_c * cw: over.append('왼쪽')
        if gx1 > (cell_c + 1) * cw: over.append('오른쪽')
        if gy0 < cell_r * ch: over.append('위')
        if gy1 > (cell_r + 1) * ch: over.append('아래')
        cut.append(over)
        crops.append(part)
    # 같은 배율: 가장 큰 동작이 펭귄의 가장 큰 동작 높이에 맞게
    s = ref_penguin_h / max(p.shape[0] for p in crops)
    sheet = np.zeros((CELL_P, CELL_P * 6, 4), np.uint8)
    feet, clipped = [], []
    heights = []
    for i, p in enumerate(crops):
        r = clean_alpha(resize_rgba(p, (max(1, int(round(p.shape[1] * s))), max(1, int(round(p.shape[0] * s))))))
        h, w = r.shape[:2]
        heights.append(h)
        al = r[..., 3].astype(np.float64)
        cm = float((al.sum(0) * np.arange(w)).sum() / max(al.sum(), 1))   # 가로 질량 중심
        left = int(round(CELL_P / 2 - cm))
        top = FOOT_Y - h
        # 칸 밖으로 나가면 잘린다: 기록하고 잘라서 넣는다
        sx0, sy0 = max(0, -left), max(0, -top)
        dx0, dy0 = max(0, left), max(0, top)
        ww, hh = min(w - sx0, CELL_P - dx0), min(h - sy0, CELL_P - dy0)
        if sx0 > 0 or sy0 > 0 or ww < w - sx0 or hh < h - sy0:
            clipped.append(i)
        sheet[dy0:dy0 + hh, i * CELL_P + dx0:i * CELL_P + dx0 + ww] = r[sy0:sy0 + hh, sx0:sx0 + ww]
    size = save_png(sheet, out_path, 256)
    chk = np.array(Image.open(out_path).convert('RGBA'))
    for i in range(6):
        x0, y0, x1, y1 = bbox(chk[:, i * CELL_P:(i + 1) * CELL_P], 40)
        feet.append(y1)
    report[key] = {'file': os.path.basename(out_path), 'size': [sheet.shape[1], sheet.shape[0]], 'bytes': size, 'cell': CELL_P, 'scale': round(s, 4), 'frame_heights': heights, 'foot_y': feet, 'foot_spread': max(feet) - min(feet),
                   'clipped_frames': clipped, 'source_cross_grid': cut, 'specks_removed': removed}


ITEM_CELL, ITEM_MAX = 112, 104


def build_items(src, out_path):
    a, removed = remove_specks(clean_alpha(load(src)))
    lab, comps = components_by_bbox(a, 3000)
    # 2x2 칸마다 조각(천사의 고리와 날개처럼 떨어진 것)을 묶는다. 하트, 번개 / 전구, 천사 순서
    quad = {}
    for c in comps:
        q = ((c['y0'] + c['y1']) // 2 > a.shape[0] // 2) * 2 + ((c['x0'] + c['x1']) // 2 > a.shape[1] // 2)
        quad.setdefault(q, []).append(c['id'])
    assert sorted(quad) == [0, 1, 2, 3], '아이템 칸이 4개가 아님: ' + str(sorted(quad))
    items = [{'id': quad[q]} for q in range(4)]
    names = ['heart', 'speed', 'hint', 'angel']
    sheet = np.zeros((ITEM_CELL, ITEM_CELL * 4, 4), np.uint8)
    sizes = []
    for i, c in enumerate(items):
        part = comp_pixels(a, lab, c['id'])
        x0, y0, x1, y1 = bbox(part, ALPHA_CUT)
        part = part[y0:y1, x0:x1]
        s = ITEM_MAX / max(part.shape[0], part.shape[1])           # 겉보기 큰 변을 같게
        r = clean_alpha(resize_rgba(part, (max(1, int(round(part.shape[1] * s))), max(1, int(round(part.shape[0] * s))))))
        h, w = r.shape[:2]
        left = ITEM_CELL * i + (ITEM_CELL - w) // 2
        top = (ITEM_CELL - h) // 2
        sheet[top:top + h, left:left + w] = r
        sizes.append({'name': names[i], 'w': w, 'h': h})
    size = save_png(sheet, out_path, 256)
    report['items'] = {'file': os.path.basename(out_path), 'size': [sheet.shape[1], sheet.shape[0]], 'bytes': size, 'cell': ITEM_CELL, 'objects': sizes, 'specks_removed': removed}


def penguin_max_height(path):
    a = np.array(Image.open(path).convert('RGBA'))
    hs = []
    for i in range(6):
        x0, y0, x1, y1 = bbox(a[:, i * CELL_P:(i + 1) * CELL_P], 40)
        hs.append(y1 - y0)
    return max(hs)


def main():
    if len(sys.argv) < 2:
        print(__doc__ if __doc__ else '사용: python scripts/spellrun_art_build.py <원본 폴더> [<출력 폴더>]')
        sys.exit(1)
    src_dir = sys.argv[1]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, 'public', 'img', 'spellrun')
    os.makedirs(out_dir, exist_ok=True)
    p = lambda k: os.path.join(src_dir, SRC[k])
    o = lambda n: os.path.join(out_dir, n)
    for k in SRC:
        assert os.path.exists(p(k)), '원본이 없음: ' + SRC[k]
    root0 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ref = penguin_max_height(os.path.join(root0, 'public', 'img', 'spellrun', 'spellrun_penguin_sheet.png'))   # 펭귄 시트(원본 아님, 저장소 안의 것)가 기준 높이
    build_layer(p('day_far'), o('bg_day_far.png'), 'day_far')
    build_layer(p('day_mid'), o('bg_day_mid.png'), 'day_mid')
    build_clouds(p('clouds'), o('clouds_sheet.png'))
    build_sky(p('boss_sky'), o('bg_boss_sky.png'), 'boss_sky')
    build_layer(p('boss_far'), o('bg_boss_far.png'), 'boss_far')
    build_layer(p('boss_near'), o('bg_boss_near.png'), 'boss_near')
    build_obstacles(p('obstacles'), o('spellrun_obstacles_sheet.png'))
    build_items(p('items'), o('items_sheet.png'))
    build_character(p('girl'), o('spellrun_girl_sheet.png'), 'girl', ref)
    build_character(p('boy'), o('spellrun_boy_sheet.png'), 'boy', ref)
    # 투명 잔여(불투명도 1~8) 확인
    total = 0
    for k, v in report.items():
        f = os.path.join(out_dir, v['file'])
        im = Image.open(f).convert('RGBA')
        al = np.array(im)[..., 3]
        v['low_alpha_pixels'] = int(((al > 0) & (al <= ALPHA_CUT)).sum())
        total += v['bytes']
    report['_total'] = {'bytes': total, 'penguin_ref_height': ref}
    rp = sys.argv[3] if len(sys.argv) > 3 else os.path.join(root, 'scripts', 'spellrun_art_report.json')
    with open(rp, 'w', encoding='utf-8') as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps(report, ensure_ascii=False, indent=1, sort_keys=True))


if __name__ == '__main__':
    main()
