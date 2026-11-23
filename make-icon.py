#!/usr/bin/env python
"""
把源图做成包里的图标：抠掉棋盘格背景 → 裁紧 → 方形留边 → 256px → 256 色量化。

    & E:\\DSH-PET\\.tmp-check\\sd\\py313\\python.exe make-icon.py

源图（`鲸海少女抽取上上签.png`）是 RGB 无 alpha 的，棋盘格是画进去的，所以这里不是简单地
「设 alpha」：先按「浅色且接近中性」找候选，再从四边做连通填充，只有和大片背景连在一起的部分
才算背景——角色身上的白毛、白裙有描边隔着，属于独立连通块，不会被吃掉。最后两轮补刀：
清掉背景里被噪声打断的孤立小块、吃掉描边外侧的浅色白边。

产物：`cortico-world-omikuji/assets/icon.png`（256×256，约 17 kB）
"""

from collections import deque
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(ROOT, '鲸海少女抽取上上签.png')
TARGET = os.path.join(ROOT, 'cortico-world-omikuji', 'assets', 'icon.png')
SIZE = 256


def neighbour_count(mask: np.ndarray) -> np.ndarray:
    """每个像素的 8 邻域里有多少个 True。"""
    total = np.zeros(mask.shape, np.uint8)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy or dx:
                total += np.roll(np.roll(mask, dy, 0), dx, 1).astype(np.uint8)
    return total


def border_connected_background(light: np.ndarray) -> np.ndarray:
    """从四边出发、只穿过 light 像素能走到的位置。洪水填充的显式版本。"""
    height, width = light.shape
    bg = np.zeros((height, width), bool)
    queue: deque[tuple[int, int]] = deque()

    def push(y: int, x: int) -> None:
        if light[y, x] and not bg[y, x]:
            bg[y, x] = True
            queue.append((y, x))

    for x in range(width):
        push(0, x)
        push(height - 1, x)
    for y in range(height):
        push(y, 0)
        push(y, width - 1)
    while queue:
        y, x = queue.popleft()
        if y > 0:
            push(y - 1, x)
        if y < height - 1:
            push(y + 1, x)
        if x > 0:
            push(y, x - 1)
        if x < width - 1:
            push(y, x + 1)
    return bg


def drop_small_islands(bg: np.ndarray, lightish: np.ndarray, limit: int) -> int:
    """浅色小岛一律当背景；白毛球约 700+ 像素，远在阈值之上，不会被误删。"""
    height, width = lightish.shape
    rest = lightish & ~bg
    seen = np.zeros((height, width), bool)
    removed = 0
    for y0 in range(height):
        for x0 in np.where(rest[y0] & ~seen[y0])[0]:
            if seen[y0, x0]:
                continue
            component = []
            queue = deque([(y0, x0)])
            seen[y0, x0] = True
            while queue:
                y, x = queue.popleft()
                component.append((y, x))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < height and 0 <= nx < width and rest[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        queue.append((ny, nx))
            if len(component) < limit:
                for y, x in component:
                    bg[y, x] = True
                removed += 1
    return removed


def main() -> None:
    rgb = np.asarray(Image.open(SOURCE).convert('RGB')).astype(np.int16)
    bright = rgb.max(axis=2)
    spread = rgb.max(axis=2) - rgb.min(axis=2)

    light = (bright >= 220) & (spread <= 20)
    bg = border_connected_background(light)

    # 噪声把棋盘格打断成碎块：补两轮「够亮且邻居多为背景」的像素，再吃两轮描边外的白边。
    for _ in range(2):
        bg |= ~bg & (bright >= 190) & (spread <= 40) & (neighbour_count(bg) >= 5)
    for _ in range(2):
        bg |= ~bg & (bright >= 205) & (spread <= 45) & (neighbour_count(bg) >= 1)

    lightish = (bright >= 195) & (spread <= 35)
    for _ in range(3):
        if drop_small_islands(bg, lightish, 300) == 0:
            break

    rgba = np.dstack([rgb.astype(np.uint8), np.full(bright.shape, 255, np.uint8)])
    rgba[bg, 3] = 0
    cut = Image.fromarray(rgba, 'RGBA')
    content = cut.crop(cut.getbbox())

    side = max(content.size)
    pad = int(side * 0.06)
    canvas = Image.new('RGBA', (side + 2 * pad, side + 2 * pad), (0, 0, 0, 0))
    canvas.paste(content, ((canvas.width - content.width) // 2, (canvas.height - content.height) // 2), content)

    icon = canvas.resize((SIZE, SIZE), Image.LANCZOS)
    os.makedirs(os.path.dirname(TARGET), exist_ok=True)
    icon.quantize(colors=256, method=Image.FASTOCTREE, dither=Image.FLOYDSTEINBERG).save(TARGET, optimize=True)
    print(f'{TARGET}  {SIZE}x{SIZE}  {os.path.getsize(TARGET) / 1024:.1f} kB  背景 {bg.mean() * 100:.1f}%')


if __name__ == '__main__':
    main()
