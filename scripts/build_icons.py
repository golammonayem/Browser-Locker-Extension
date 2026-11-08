"""
Builds icon16.png, icon48.png, and icon128.png using Python standard library (zlib + struct)
Native Zinc/Blue palette - zero AI neon gradients.
"""
import zlib
import struct
import math
import os

def create_png(width, height, rgba_data):
    def chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xffffffff
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', crc)

    png = b'\x89PNG\r\n\x1a\n'
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    png += chunk(b'IHDR', ihdr_data)

    raw_rows = bytearray()
    for y in range(height):
        raw_rows.append(0)
        start = y * width * 4
        raw_rows.extend(rgba_data[start:start + width * 4])

    idat_data = zlib.compress(bytes(raw_rows), level=9)
    png += chunk(b'IDAT', idat_data)
    png += chunk(b'IEND', b'')
    return png

def render_icon(size):
    rgba = bytearray(size * size * 4)
    cx = size / 2.0
    cy = size / 2.0

    for y in range(size):
        for x in range(size):
            idx = (y * size + x) * 4
            nx = (x - cx) / (size / 2.0)
            ny = (y - cy) / (size / 2.0)

            # Rounded square plate
            corner_r = 0.22
            dx = max(0, abs(nx) - (1.0 - corner_r))
            dy = max(0, abs(ny) - (1.0 - corner_r))
            corner_dist = math.sqrt(dx * dx + dy * dy)

            if corner_dist > corner_r or abs(nx) > 0.96 or abs(ny) > 0.96:
                rgba[idx:idx+4] = b'\x00\x00\x00\x00'
                continue

            # Neutral dark plate (#18181b = 24, 24, 27)
            r, g, b, a = 24, 24, 27, 255

            # Border line (#3f3f46 = 63, 63, 70)
            if corner_dist > corner_r - 0.05 or abs(nx) > 0.90 or abs(ny) > 0.90:
                r, g, b = 63, 63, 70

            # Shield shape (Royal Blue #2563eb = 37, 99, 235)
            in_shield = False
            if ny >= -0.55 and ny <= 0.68 and abs(nx) <= 0.60:
                if ny <= -0.2:
                    in_shield = True
                else:
                    taper_factor = (0.68 - ny) / 0.88
                    if abs(nx) <= 0.60 * math.pow(max(0, taper_factor), 0.7):
                        in_shield = True

            if in_shield:
                r, g, b = 37, 99, 235

            # Padlock Shackle: crisp white (#f4f4f5 = 244, 244, 245)
            shackle_w = 0.22
            shackle_th = 0.08
            if ny >= -0.25 and ny <= -0.05 and abs(nx) <= shackle_w:
                arch_dist = math.sqrt(nx * nx + (ny - -0.05) * (ny - -0.05))
                if (arch_dist <= shackle_w and arch_dist >= shackle_w - shackle_th) or (ny >= -0.12 and abs(abs(nx) - (shackle_w - shackle_th/2)) < shackle_th/2):
                    r, g, b = 244, 244, 245

            # Padlock Body: crisp white
            if abs(nx) <= 0.28 and ny >= -0.05 and ny <= 0.38:
                r, g, b = 244, 244, 245
                # Keyhole dot (Dark Zinc #18181b)
                if math.sqrt(nx * nx + (ny - 0.12) * (ny - 0.12)) <= 0.06:
                    r, g, b = 24, 24, 27
                # Keyhole slit
                elif abs(nx) <= 0.04 and ny >= 0.12 and ny <= 0.26:
                    r, g, b = 24, 24, 27

            rgba[idx] = r
            rgba[idx+1] = g
            rgba[idx+2] = b
            rgba[idx+3] = a

    return rgba

def main():
    icons_dir = os.path.join(os.path.dirname(__file__), '..', 'icons')
    os.makedirs(icons_dir, exist_ok=True)

    for size in [16, 48, 128]:
        rgba = render_icon(size)
        png_data = create_png(size, size, rgba)
        out_path = os.path.join(icons_dir, f'icon{size}.png')
        with open(out_path, 'wb') as f:
            f.write(png_data)
        print(f"Generated {out_path} ({len(png_data)} bytes)")

if __name__ == '__main__':
    main()
