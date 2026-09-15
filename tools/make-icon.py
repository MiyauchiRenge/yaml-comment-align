#!/usr/bin/env python3
"""生成扩展图标 icon/icon128.png（128x128 PNG）。

只用 Python 标准库手写 PNG 编码器，不依赖 ImageMagick 或 PIL。
图案语义：几行长短不一的「代码条」，右侧「注释条」全部从同一列开始，
中间一条竖向引导线标出对齐列。

    python3 tools/make-icon.py
"""

import os
import struct
import zlib

W = H = 128

BG = (0x1E, 0x1E, 0x2E)          # 深色背景
GUIDE = (0x4B, 0x55, 0x63)       # 对齐列引导线
CODE = (0x9C, 0xA3, 0xAF)        # 代码条
COMMENT = (0x34, 0xD3, 0x99)     # 注释条（绿）
ACCENT = (0xF5, 0x9E, 0x0B)      # 顶部强调线（琥珀）

GUIDE_X = 78                      # 对齐列
COMMENT_X = 82                    # 注释条起点
CODE_X = 14
BAR_H = 12
ROWS_Y = [20, 40, 60, 80, 100]
CODE_LEN = [36, 24, 44, 30, 40]
COMMENT_LEN = [30, 22, 26, 18, 28]


def blank(w, h, color):
    return [[color for _ in range(w)] for _ in range(h)]


def rect(px, x0, y0, w, h, color):
    for y in range(max(0, y0), min(H, y0 + h)):
        for x in range(max(0, x0), min(W, x0 + w)):
            px[y][x] = color


def write_png(path, px):
    raw = bytearray()
    for row in px:
        raw.append(0)                                  # filter type 0 (None)
        for (r, g, b) in row:
            raw += bytes((r, g, b))

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0)  # 8bit truecolor
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', ihdr)
           + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)
    return len(png)


def main():
    px = blank(W, H, BG)

    # 对齐列引导线
    rect(px, GUIDE_X, 14, 2, 102, GUIDE)

    # 代码条 + 注释条
    for i, y in enumerate(ROWS_Y):
        rect(px, CODE_X, y, CODE_LEN[i], BAR_H, CODE)
        rect(px, COMMENT_X, y, COMMENT_LEN[i], BAR_H, COMMENT)

    # 顶部一小段强调线，暗示「对齐的目标列」
    rect(px, CODE_X, 8, W - CODE_X - (W - GUIDE_X), 2, ACCENT)

    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       'icon', 'icon128.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    size = write_png(out, px)
    print('已生成 %s (%d bytes, %dx%d)' % (out, size, W, H))


if __name__ == '__main__':
    main()
