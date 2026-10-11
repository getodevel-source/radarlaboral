"""Generate Radar Laboral's shared camera mark for Windows and the system tray."""

from math import hypot
from pathlib import Path
import struct
import zlib


OUT = Path(__file__).resolve().parent
BACKGROUND_TOP = (243, 139, 103)
BACKGROUND_BOTTOM = (233, 118, 86)
WHITE = (255, 255, 255)


def rounded_rectangle_distance(x, y, center_x, center_y, half_width, half_height, radius):
    dx = abs(x - center_x) - (half_width - radius)
    dy = abs(y - center_y) - (half_height - radius)
    return hypot(max(dx, 0), max(dy, 0)) + min(max(dx, dy), 0) - radius


def sample(x, y):
    background_distance = rounded_rectangle_distance(x, y, 32, 32, 32, 32, 17)
    if background_distance > 0:
        return (0, 0, 0, 0)

    gradient = min(max((x * 0.85 + y) / (64 * 1.85), 0), 1)
    color = tuple(round(top + (bottom - top) * gradient) for top, bottom in zip(BACKGROUND_TOP, BACKGROUND_BOTTOM))

    camera_frame = rounded_rectangle_distance(x, y, 32, 32, 16, 16, 8)
    lens_distance = hypot(x - 32, y - 32) - 8.2
    dot_distance = hypot(x - 43, y - 21)
    if abs(camera_frame) <= 1.1 or abs(lens_distance) <= 1.1 or dot_distance <= 1.6:
        color = WHITE
    return (*color, 255)


def draw(size, samples=4):
    pixels = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            channels = [0, 0, 0, 0]
            for sample_y in range(samples):
                for sample_x in range(samples):
                    point_x = (x + (sample_x + 0.5) / samples) * 64 / size
                    point_y = (y + (sample_y + 0.5) / samples) * 64 / size
                    for channel, value in enumerate(sample(point_x, point_y)):
                        channels[channel] += value
            row.extend(round(value / (samples * samples)) for value in channels)
        pixels.append(row)
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


def dib_bytes(pixels):
    size = len(pixels)
    xor = bytearray()
    mask_row_size = ((size + 31) // 32) * 4
    and_mask = bytearray()
    for row in reversed(pixels):
        for x in range(size):
            r, g, b, a = row[x * 4:x * 4 + 4]
            xor.extend((b, g, r, a))
    for row in reversed(pixels):
        mask = bytearray(mask_row_size)
        for x in range(size):
            if row[x * 4 + 3] == 0:
                mask[x // 8] |= 1 << (7 - x % 8)
        and_mask.extend(mask)
    header = struct.pack("<IiiHHIIiiII", 40, size, size * 2, 1, 32, 0, len(xor) + len(and_mask), 0, 0, 0, 0)
    return header + xor + and_mask


def write_ico():
    sizes = (16, 24, 32, 48, 64, 128, 256)
    images = [(size, dib_bytes(draw(size))) for size in sizes]
    directory = struct.pack("<HHH", 0, 1, len(images))
    entries = bytearray()
    offset = 6 + 16 * len(images)
    for size, image in images:
        dimensions = 0 if size == 256 else size
        entries.extend(struct.pack("<BBBBHHII", dimensions, dimensions, 0, 0, 1, 32, len(image), offset))
        offset += len(image)
    (OUT / "icon.ico").write_bytes(directory + entries + b"".join(image for _, image in images))


if __name__ == "__main__":
    (OUT / "tray.png").write_bytes(png_bytes(draw(64)))
    write_ico()
