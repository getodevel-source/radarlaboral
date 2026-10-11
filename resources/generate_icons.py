"""Generate Windows icon sizes from the exact Radar Laboral brand PNG.

The source artwork stays unchanged in ``brand-icon.png``. Only the platform
sizes are resampled for the Windows executable, installer, and system tray.
Requires Pillow (``python -m pip install Pillow``).
"""

from pathlib import Path
import struct

from PIL import Image


OUT = Path(__file__).resolve().parent
SOURCE = OUT / "brand-icon.png"
SIZES = (16, 24, 32, 48, 64, 128, 256)


def dib_bytes(image):
    size = image.width
    pixels = image.convert("RGBA")
    xor = bytearray()
    mask_row_size = ((size + 31) // 32) * 4
    and_mask = bytearray()
    rows = [pixels.crop((0, y, size, y + 1)).tobytes() for y in range(size)]

    for row in reversed(rows):
        for x in range(size):
            r, g, b, a = row[x * 4:x * 4 + 4]
            xor.extend((b, g, r, a))
    for row in reversed(rows):
        mask = bytearray(mask_row_size)
        for x in range(size):
            if row[x * 4 + 3] == 0:
                mask[x // 8] |= 1 << (7 - x % 8)
        and_mask.extend(mask)

    header = struct.pack(
        "<IiiHHIIiiII", 40, size, size * 2, 1, 32, 0,
        len(xor) + len(and_mask), 0, 0, 0, 0,
    )
    return header + xor + and_mask


def write_ico(source):
    images = []
    for size in SIZES:
        resized = source.resize((size, size), Image.Resampling.LANCZOS)
        images.append((size, dib_bytes(resized)))

    directory = struct.pack("<HHH", 0, 1, len(images))
    entries = bytearray()
    offset = 6 + 16 * len(images)
    for size, image in images:
        dimensions = 0 if size == 256 else size
        entries.extend(struct.pack("<BBBBHHII", dimensions, dimensions, 0, 0, 1, 32, len(image), offset))
        offset += len(image)

    (OUT / "icon.ico").write_bytes(directory + entries + b"".join(image for _, image in images))


def main():
    with Image.open(SOURCE) as image:
        if image.width != image.height:
            raise ValueError(f"Brand icon must be square: {image.size}")
        source = image.convert("RGBA")

    source.resize((64, 64), Image.Resampling.LANCZOS).save(OUT / "tray.png", format="PNG")
    write_ico(source)


if __name__ == "__main__":
    main()
