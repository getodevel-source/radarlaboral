"""Generate Radar Laboral's R-and-radar mark for Windows and the system tray."""

from math import hypot
from pathlib import Path
import struct
import zlib


OUT = Path(__file__).resolve().parent
BACKGROUND_TOP = (40, 86, 69)
BACKGROUND_BOTTOM = (23, 56, 47)
PAPER = (246, 242, 232)
SIGNAL_START = (231, 123, 87)
SIGNAL_END = (255, 177, 131)


def rounded_rectangle_distance(x, y, center_x, center_y, half_width, half_height, radius):
    dx = abs(x - center_x) - (half_width - radius)
    dy = abs(y - center_y) - (half_height - radius)
    return hypot(max(dx, 0), max(dy, 0)) + min(max(dx, dy), 0) - radius


def cubic(start, control_one, control_two, end, steps=12):
    points = []
    for step in range(steps + 1):
        t = step / steps
        inverse = 1 - t
        points.append((
            inverse**3 * start[0] + 3 * inverse**2 * t * control_one[0] + 3 * inverse * t**2 * control_two[0] + t**3 * end[0],
            inverse**3 * start[1] + 3 * inverse**2 * t * control_one[1] + 3 * inverse * t**2 * control_two[1] + t**3 * end[1],
        ))
    return points


def distance_to_path(x, y, points):
    best_squared = float('inf')
    for start, end in zip(points, points[1:]):
        dx, dy = end[0] - start[0], end[1] - start[1]
        length_squared = dx * dx + dy * dy
        if length_squared == 0:
            closest = start
        else:
            amount = min(max(((x - start[0]) * dx + (y - start[1]) * dy) / length_squared, 0), 1)
            closest = (start[0] + amount * dx, start[1] + amount * dy)
        offset_x, offset_y = x - closest[0], y - closest[1]
        best_squared = min(best_squared, offset_x * offset_x + offset_y * offset_y)
    return best_squared**0.5


R_STROKE = 5.2 / 2
R_BOWL = cubic((31.2, 16), (38.8, 16), (42.5, 20.1), (42.5, 26.5)) + cubic((42.5, 26.5), (42.5, 33.2), (38.6, 37), (31.2, 37))[1:]
R_DIAGONAL = [(31.5, 37), (45.7, 49)]
SWEEP = [(28.6, 28.9), (42.6, 16.5)]


def mix(start, end, amount):
    return tuple(round(a + (b - a) * amount) for a, b in zip(start, end))


def sample(x, y):
    if rounded_rectangle_distance(x, y, 32, 32, 31, 31, 16) > 0:
        return (0, 0, 0, 0)

    gradient = min(max((x * 0.75 + y) / (64 * 1.75), 0), 1)
    color = mix(BACKGROUND_TOP, BACKGROUND_BOTTOM, gradient)

    if 17.4 <= x <= 20.6 and 16 <= y <= 48:
        color = PAPER
    elif abs(y - 16) <= R_STROKE and 19 <= x <= 31.2:
        color = PAPER
    elif abs(y - 37) <= R_STROKE and 19 <= x <= 31.2:
        color = PAPER
    elif distance_to_path(x, y, R_BOWL) <= R_STROKE:
        color = PAPER
    elif distance_to_path(x, y, R_DIAGONAL) <= R_STROKE:
        color = PAPER

    sweep_distance = distance_to_path(x, y, SWEEP)
    if sweep_distance <= 1.2:
        amount = min(max((x - 28.6) / (42.6 - 28.6), 0), 1)
        color = mix(SIGNAL_START, SIGNAL_END, amount)

    target_distance = hypot(x - 42.6, y - 16.5)
    if target_distance <= 4.2:
        color = (33, 75, 59) if target_distance >= 3.35 else SIGNAL_END
    if target_distance <= 1.2:
        color = (255, 247, 237)

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
