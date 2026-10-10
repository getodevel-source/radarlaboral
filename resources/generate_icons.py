"""Generate the small Radar Laboral tray and Windows app icons (Python stdlib only)."""

from math import cos, hypot, pi, sin
from pathlib import Path
import struct
import zlib


OUT = Path(__file__).resolve().parent


def color(r, g, b, a=255):
    return bytes((r, g, b, a))


def draw(size):
    pixels = [bytearray((0, 0, 0, 0) * size) for _ in range(size)]
    scale = size / 64

    def put(x, y, rgba):
        x, y = round(x * scale), round(y * scale)
        if 0 <= x < size and 0 <= y < size:
            offset = x * 4
            pixels[y][offset:offset + 4] = rgba

    def disc(x, y, radius, rgba):
        for py in range(max(0, round((y - radius) * scale)), min(size, round((y + radius) * scale) + 1)):
            for px in range(max(0, round((x - radius) * scale)), min(size, round((x + radius) * scale) + 1)):
                if hypot(px / scale - x, py / scale - y) <= radius:
                    pixels[py][px * 4:px * 4 + 4] = rgba

    # Rounded square background.
    for y in range(size):
        for x in range(size):
            px, py = (x + 0.5) / scale, (y + 0.5) / scale
            cx = min(max(px, 11), 53)
            cy = min(max(py, 11), 53)
            if hypot(px - cx, py - cy) <= 11:
                pixels[y][x * 4:x * 4 + 4] = color(25, 57, 42)

    # Three radar arcs and a sweep line.
    center = (29, 36)
    for radius in (10, 18, 26):
        for step in range(181):
            angle = (-150 + step * 0.72) * pi / 180
            x = center[0] + cos(angle) * radius
            y = center[1] + sin(angle) * radius
            put(x, y, color(191, 216, 193, 235))
            disc(x, y, 0.6, color(191, 216, 193, 235))
    for step in range(36):
        t = step / 35
        put(center[0] + (51 - center[0]) * t, center[1] + (14 - center[1]) * t, color(238, 244, 231))
        disc(center[0] + (51 - center[0]) * t, center[1] + (14 - center[1]) * t, 1.1, color(238, 244, 231))
    disc(*center, 2.5, color(238, 244, 231))
    return pixels


def png_bytes(pixels):
    height = len(pixels)
    width = len(pixels[0]) // 4
    raw = b"".join(b"\x00" + bytes(row) for row in pixels)

    def chunk(name, data):
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", zlib.crc32(name + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def write_ico(pixels):
    size = len(pixels)
    xor = bytearray()
    and_mask = bytearray()
    for row in reversed(pixels):
        for x in range(size):
            r, g, b, a = row[x * 4:x * 4 + 4]
            xor.extend((b, g, r, a))
    for _ in range(size):
        and_mask.extend(bytes((size + 7) // 8))
    header = struct.pack("<IiiHHIIiiII", 40, size, size * 2, 1, 32, 0, len(xor) + len(and_mask), 0, 0, 0, 0)
    image = header + xor + and_mask
    directory = struct.pack("<HHH", 0, 1, 1)
    dimensions = 0 if size == 256 else size
    entry = struct.pack("<BBBBHHII", dimensions, dimensions, 0, 0, 1, 32, len(image), 22)
    (OUT / "icon.ico").write_bytes(directory + entry + image)


if __name__ == "__main__":
    tray = draw(64)
    (OUT / "tray.png").write_bytes(png_bytes(tray))
    write_ico(draw(256))
