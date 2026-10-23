#!/usr/bin/env python3
"""Render the Telegram editorial series as self-contained SVGs and PNGs.

Uses only the Python standard library and Inkscape. The emblem is the unchanged
JPEG embedded by frontend/header-mark.jsx, cropped using that component's viewBox.
"""
from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
from html import escape
import json
from pathlib import Path
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "marketing/telegram/series-20261024"
FONT = "DejaVu Sans"


def heading_lines(value):
    words = value.split()
    if len(words) < 2:
        return words
    splits = [(words[:i], words[i:]) for i in range(1, len(words))]
    # Balance the optical line lengths, keeping whole words intact.
    a, b = min(splits, key=lambda pair: abs(len(" ".join(pair[0])) - len(" ".join(pair[1]))))
    return [" ".join(a), " ".join(b)]


def emblem(uri, x, y, size, key):
    return f'''<defs><clipPath id="mark-{key}"><circle cx="{x+size/2}" cy="{y+size/2}" r="{size/2}"/></clipPath></defs>
    <g clip-path="url(#mark-{key})"><svg x="{x}" y="{y}" width="{size}" height="{size}" viewBox="170 170 914 914"><image xlink:href="{uri}" width="1254" height="1254"/></svg></g>
    <circle cx="{x+size/2}" cy="{y+size/2}" r="{size/2}" fill="none" stroke="#b8ffda" stroke-opacity=".25"/>
    <circle cx="{x+size/2}" cy="{y+size/2}" r="{size/2+8}" fill="none" stroke="#bcffde" stroke-opacity=".08"/>'''


def card(x, y, w, h, rotate=0, opacity=1):
    return f'''<g opacity="{opacity}" transform="rotate({rotate} {x+w/2} {y+h/2})"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="38" fill="url(#glass)" stroke="url(#edge)"/>
    <path d="M {x+38} {y+1} H {x+w-38}" stroke="#e4fff1" stroke-opacity=".28"/>
    <path d="M {x+26} {y+28} V {y+h-40}" stroke="#dcffec" stroke-opacity=".10"/></g>'''


def art(variant, uri):
    if variant == 0:
        shapes = '''<circle cx="540" cy="410" r="223" fill="url(#halo)" stroke="#b1f8d2" stroke-opacity=".16"/>
        <ellipse cx="540" cy="410" rx="382" ry="117" transform="rotate(-22 540 410)" fill="none" stroke="url(#edge)" stroke-width="2"/>
        <ellipse cx="540" cy="410" rx="328" ry="184" transform="rotate(29 540 410)" fill="none" stroke="#a0f6c9" stroke-opacity=".13"/>
        <circle cx="215" cy="546" r="8" fill="#b6fbd5"/><circle cx="864" cy="274" r="5" fill="#b6fbd5" fill-opacity=".55"/>'''
        return shapes + emblem(uri, 390, 260, 300, "hero")
    if variant == 1:
        return (card(175, 276, 415, 280, -13, .58) + card(477, 246, 406, 306, 12, .76)
                + card(293, 238, 494, 349, 0) + emblem(uri, 390, 261, 300, "hero")
                + '<path d="M176 590 Q540 652 907 565" fill="none" stroke="#b0ffd8" stroke-opacity=".22"/>')
    if variant == 2:
        return ('''<circle cx="681" cy="410" r="230" fill="url(#glass)" stroke="url(#edge)"/>
        <circle cx="681" cy="410" r="193" fill="none" stroke="#c6ffe3" stroke-opacity=".11"/>
        <path d="M230 222 C409 110 848 180 875 394 C902 606 510 660 243 551" fill="none" stroke="#b2ffd6" stroke-opacity=".21"/>
        <path d="M755 230 Q912 307 886 485" fill="none" stroke="#e4fff0" stroke-opacity=".30" stroke-width="2"/>
        ''' + card(207, 303, 309, 254, -8, .48) + emblem(uri, 368, 253, 312, "hero"))
    if variant == 3:
        return ('''<path d="M105 485 C250 167 765 177 966 394" fill="none" stroke="url(#edge)" stroke-width="72" stroke-linecap="round" opacity=".24"/>
        <path d="M109 485 C250 167 765 177 966 394" fill="none" stroke="#d0ffe7" stroke-width="1" opacity=".32"/>
        <path d="M113 497 C465 689 774 640 964 327" fill="none" stroke="#9bedc3" stroke-width="1" opacity=".20"/>
        <ellipse cx="540" cy="554" rx="270" ry="42" fill="#000" opacity=".15"/>
        ''' + emblem(uri, 378, 248, 324, "hero")
                + '<circle cx="169" cy="396" r="17" fill="url(#glass)" stroke="url(#edge)"/><circle cx="886" cy="503" r="28" fill="url(#glass)" stroke="url(#edge)"/>')
    return (card(185, 244, 710, 344, 0)
            + '''<path d="M227 485 Q540 173 853 485" fill="none" stroke="#caffdf" stroke-opacity=".19"/>
            <path d="M228 520 Q540 252 853 520" fill="none" stroke="#caffdf" stroke-opacity=".09"/>
            <circle cx="264" cy="326" r="33" fill="url(#glass)" stroke="url(#edge)"/>
            <circle cx="826" cy="490" r="26" fill="url(#glass)" stroke="url(#edge)"/>
            <circle cx="822" cy="320" r="7" fill="#b7fbd8" fill-opacity=".55"/>'''
            + emblem(uri, 394, 266, 292, "hero"))


def render_svg(post, index, total, uri):
    lines = heading_lines(post["visual_heading"])
    maxlen = max(map(len, lines))
    font_size = min(80, int(860 / (maxlen * .72)))
    font_size = max(64, font_size)
    heading = "".join(f'<tspan x="80" y="{714+i*91}">{escape(line)}</tspan>' for i, line in enumerate(lines))
    category = post["category"].replace("-", " ").upper()
    label_size = 15 if len(category) > 25 else 17
    return f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1080" viewBox="0 0 1080 1080">
    <title>{escape(post['title'])} | FTI Protocol</title>
    <desc>Official FTI editorial series {index:02d} of {total}. {escape(post['visual_subtitle'])} The exact website emblem is reused unchanged; glass shapes are decorative.</desc>
    <defs>
    <radialGradient id="bg" cx="74%" cy="20%" r="90%"><stop stop-color="#174b39"/><stop offset=".48" stop-color="#0a271d"/><stop offset="1" stop-color="#04110d"/></radialGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#c8ffe3" stop-opacity=".11"/><stop offset=".38" stop-color="#91efbf" stop-opacity=".035"/><stop offset="1" stop-color="#e1fff1" stop-opacity=".09"/></linearGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d9ffeb" stop-opacity=".45"/><stop offset=".42" stop-color="#9ff3c7" stop-opacity=".05"/><stop offset="1" stop-color="#baffdb" stop-opacity=".30"/></linearGradient>
    <radialGradient id="halo"><stop stop-color="#baffdc" stop-opacity=".10"/><stop offset="1" stop-color="#81d7aa" stop-opacity=".025"/></radialGradient>
    </defs>
    <rect width="1080" height="1080" fill="url(#bg)"/>
    <path d="M80 174 H1000 M80 944 H1000" stroke="#c7ffe2" stroke-opacity=".12"/>
    <path d="M1075 20 Q665 280 1075 601" fill="none" stroke="#bcffdc" stroke-opacity=".05" stroke-width="120"/>
    {emblem(uri, 80, 80, 44, 'badge')}
    <g font-family="{FONT}" fill="#ddfbea">
    <text x="142" y="99" font-size="20" font-weight="700" letter-spacing="2">FTI PROTOCOL</text>
    <text x="142" y="124" font-size="13" letter-spacing="2" fill="#9fc5b0">OFFICIAL / FIELD NOTES</text>
    <text x="1000" y="105" text-anchor="end" font-size="24" letter-spacing="1">{index:02d}<tspan fill="#769b87"> / {total:02d}</tspan></text>
    <text x="80" y="216" font-size="{label_size}" letter-spacing="2.3" fill="#a9d7bd">{escape(category)}</text>
    </g>
    {art((index-1)%5, uri)}
    <text font-family="{FONT}" font-size="{font_size}" font-weight="700" letter-spacing="-2" fill="#e3ffed">{heading}</text>
    <text x="82" y="869" font-family="{FONT}" font-size="30" fill="#add0bd">{escape(post['visual_subtitle'])}</text>
    <g font-family="{FONT}" font-size="21" fill="#a9cbb8">
    <text x="80" y="997">ftiprotocol.com</text><text x="1000" y="997" text-anchor="end">@FTIProtocol_Official</text>
    </g></svg>'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", nargs="+", type=Path)
    parser.add_argument("--out", type=Path, default=OUT)
    parser.add_argument("--jobs", type=int, default=3)
    args = parser.parse_args()
    configs = args.config
    if not configs:
        merged = ROOT / "config/telegram-series-20261024.en.json"
        configs = [merged] if merged.exists() else [ROOT / f"config/telegram-series-20261024-{part}.en.json" for part in ("a", "b")]
    posts = []
    for path in configs:
        posts.extend(json.loads(path.read_text())["posts"])
    posts.sort(key=lambda p: p["id"])
    if len({p['id'] for p in posts}) != len(posts):
        raise SystemExit("Duplicate post IDs")
    source = (ROOT / "frontend/header-mark.jsx").read_text()
    match = re.search(r'href="(data:image/jpeg;base64,([A-Za-z0-9+/=]+))"', source)
    if not match:
        raise SystemExit("Exact HeaderMark JPEG was not found")
    base64.b64decode(match.group(2), validate=True)
    uri = match.group(1)
    inkscape = shutil.which("inkscape")
    if not inkscape:
        raise SystemExit("Inkscape is required")
    args.out.mkdir(parents=True, exist_ok=True)
    jobs = []
    for index, post in enumerate(posts, 1):
        if not 1 <= len(post["visual_heading"]) <= 24 or len(post["visual_subtitle"]) > 38:
            raise SystemExit(f"Visual copy exceeds safe limits: {post['id']}")
        svg = args.out / f"{index:02d}.svg"
        png = args.out / f"{index:02d}.png"
        xml = render_svg(post, index, len(posts), uri)
        ET.fromstring(xml)
        svg.write_text(xml)
        jobs.append((svg, png))
    def convert(pair):
        svg, png = pair
        result = subprocess.run([inkscape, str(svg), "--export-type=png", f"--export-filename={png}", "--export-width=1080", "--export-height=1080"], capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stderr[-1500:])
        header = png.read_bytes()[:24]
        if header[:8] != b'\x89PNG\r\n\x1a\n' or int.from_bytes(header[16:20], 'big') != 1080 or int.from_bytes(header[20:24], 'big') != 1080:
            raise RuntimeError(f"Invalid PNG output: {png}")
        bounds = subprocess.run([inkscape, str(svg), "--query-all"], capture_output=True, text=True, check=True)
        text_count = 0
        for row in bounds.stdout.splitlines():
            fields = row.split(',')
            if len(fields) != 5 or not fields[0].startswith('text'):
                continue
            text_count += 1
            x, y, width, height = map(float, fields[1:])
            if x < 78 or y < 78 or x + width > 1002 or y + height > 1004:
                raise RuntimeError(f"Text exceeds safe bounds: {svg.name}: {row}")
        if text_count != 8:
            raise RuntimeError(f"Expected 8 visible text elements in {svg.name}, found {text_count}")
        return {"file": png.name, "bytes": png.stat().st_size}
    with ThreadPoolExecutor(max_workers=max(1, min(args.jobs, 4))) as pool:
        outputs = list(pool.map(convert, jobs))
    print(json.dumps({"count": len(outputs), "dimensions": [1080, 1080], "native_layouts": 5, "png_bytes": sum(p['bytes'] for p in outputs), "min_png_bytes": min(p['bytes'] for p in outputs), "max_png_bytes": max(p['bytes'] for p in outputs), "output": str(args.out)}, indent=2))


if __name__ == "__main__":
    main()
