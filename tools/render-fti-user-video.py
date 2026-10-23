#!/usr/bin/env python3
"""Render FTI's English user presentation with native text and exact logo assets.

Requires Inkscape and FFmpeg. Backgrounds are existing image assets, never drawn
or regenerated here. Python only writes SVG and orchestrates native renderers.
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
import textwrap
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "marketing/video-20261024"
WIDTH, HEIGHT, FPS = 1920, 1080, 24
FONT = "DejaVu Sans"


def command(args):
    result = subprocess.run([str(a) for a in args], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("Command failed: " + " ".join(map(str, args[:4])) + "\n" + result.stderr[-2400:])
    return result.stdout


def image_uri(path):
    suffix = path.suffix.lower()
    mime = "image/jpeg" if suffix in (".jpg", ".jpeg") else "image/png"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def wrap_title(value):
    if len(value) <= 26:
        return [value]
    words = value.split()
    split = min(range(1, len(words)), key=lambda i: abs(len(" ".join(words[:i])) - len(" ".join(words[i:]))))
    return [" ".join(words[:split]), " ".join(words[split:])]


def root_svg(body, description):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1920" height="1080" viewBox="0 0 1920 1080"><title>{escape(description)}</title>{body}</svg>'''


def scene_overlay(scene, number, total, logo_uri, title_size=82, body_size=43, title_font="Orbitron, DejaVu Sans"):
    titles = wrap_title(scene["title"])
    # Full narration is visible so the video explains the end-user experience
    # even when played without audio. Avoid repeating the shorter screen_lines.
    body_lines = textwrap.wrap(scene["narration"], width=53, break_long_words=False, break_on_hyphens=False)
    body_top = 480 if len(titles) == 2 else 430
    if len(body_lines) > 7:
        raise ValueError(f"Scene {number} needs too many narration lines")
    if body_top + (len(body_lines)-1)*61 > 902:
        body_top = 902 - (len(body_lines)-1)*61
    title = "".join(f'<tspan x="112" y="{310+i*101}">{escape(line)}</tspan>' for i, line in enumerate(titles))
    body = "".join(f'<tspan x="116" y="{body_top+i*61}">{escape(line)}</tspan>' for i, line in enumerate(body_lines))
    return f'''<defs><linearGradient id="readability"><stop stop-color="#03140e" stop-opacity=".91"/><stop offset=".68" stop-color="#03140e" stop-opacity=".77"/><stop offset="1" stop-color="#03140e" stop-opacity=".14"/></linearGradient><clipPath id="badge"><circle cx="139" cy="103" r="27"/></clipPath></defs>
    <rect width="1920" height="1080" fill="url(#readability)"/>
    <image xlink:href="{logo_uri}" x="112" y="76" width="54" height="54" clip-path="url(#badge)"/>
    <g font-family="{FONT}" fill="#e2ffed">
    <text id="brand" x="186" y="112" font-size="29" font-weight="700" letter-spacing="3">FTI PROTOCOL</text>
    <text id="series" x="1808" y="112" text-anchor="end" font-size="23" letter-spacing="2" fill="#b3d8c2">USER PRESENTATION / {number:02d} OF {total:02d}</text>
    <text id="kicker" x="116" y="214" font-size="22" letter-spacing="3" fill="#b3efd0">{escape(scene['kicker'])}</text>
    <text id="headline" font-family="{escape(title_font)}" font-size="{title_size}" font-weight="700" letter-spacing="-2">{title}</text>
    <text id="narration" font-size="{body_size}" fill="#d1e8d9">{body}</text>
    <text id="website" x="112" y="1003" font-size="25" fill="#a8cdb7">ftiprotocol.com</text>
    <text id="channel" x="1808" y="1003" text-anchor="end" font-size="25" fill="#a8cdb7">@FTIProtocol_Official</text>
    </g>'''


def render_svg(svg_path, png_path, inkscape):
    ET.fromstring(svg_path.read_text())
    command([inkscape, svg_path, "--export-type=png", f"--export-filename={png_path}", "--export-width=1920", "--export-height=1080"])


def text_bounds(svg_path, inkscape):
    data = command([inkscape, svg_path, "--query-all"])
    found = {}
    for row in data.splitlines():
        fields = row.split(',')
        if len(fields) == 5 and fields[0] in {"brand", "series", "kicker", "headline", "narration", "website", "channel"}:
            found[fields[0]] = tuple(map(float, fields[1:]))
    if len(found) != 7:
        raise RuntimeError(f"Missing text geometry: {svg_path.name}")
    for key, (x, y, width, height) in found.items():
        right = 1320 if key in {"kicker", "headline", "narration"} else 1810
        if x < 108 or y < 75 or x+width > right or y+height > 1013:
            return key, found
    return None, found


def render_frames(script, args, inkscape):
    frames = args.base / "frames"
    frames.mkdir(parents=True, exist_ok=True)
    logo = image_uri(ROOT / "marketing/telegram/assets/site-logo-profile.png")
    scenes = script["scenes"]
    def render(pair):
        number, scene = pair
        background = args.base / "backgrounds" / f"{(number-1)%4+1:02d}.png"
        if not background.exists():
            raise FileNotFoundError(f"Required generated background missing: {background}")
        overlay_path = frames / f"scene-{number:02d}-overlay.svg"
        body_size, title_size = 43, 82
        for attempt in range(5):
            overlay_body = scene_overlay(scene, number, len(scenes), logo, title_size, body_size, args.title_font)
            overlay_path.write_text(root_svg(overlay_body, scene["title"]))
            issue, found = text_bounds(overlay_path, inkscape)
            if not issue:
                break
            if issue == "headline":
                title_size -= 4
            elif issue == "narration":
                body_size -= 2
            else:
                raise RuntimeError(f"Text outside safe area in scene {number}: {issue}: {found[issue]}")
        else:
            raise RuntimeError(f"Could not fit scene {number} copy")
        bg = f'<image xlink:href="{image_uri(background)}" width="1920" height="1080" preserveAspectRatio="xMidYMid slice"/>'
        still_path = frames / f"scene-{number:02d}.svg"
        still_path.write_text(root_svg(bg + overlay_body, scene["title"]))
        render_svg(overlay_path, frames / f"scene-{number:02d}-overlay.png", inkscape)
        render_svg(still_path, frames / f"scene-{number:02d}.png", inkscape)
        return {"scene": number, "title_size": title_size, "body_size": body_size, "text_geometry": "passed"}
    pairs = [(number, scene) for number, scene in enumerate(scenes, 1) if not args.scenes or number in args.scenes]
    if not pairs:
        raise ValueError("No scenes selected")
    with ThreadPoolExecutor(max_workers=min(3, max(1, args.jobs))) as pool:
        qa = list(pool.map(render, pairs))
    # Exact logo prepared for FFmpeg with native SVG circle clipping. No redraw.
    mark = root_svg(f'<defs><clipPath id="circle"><circle cx="165" cy="165" r="163"/></clipPath></defs><image xlink:href="{logo}" width="330" height="330" clip-path="url(#circle)"/>', "Exact FTI website emblem")
    mark = mark.replace('width="1920" height="1080" viewBox="0 0 1920 1080"', 'width="330" height="330" viewBox="0 0 330 330"')
    logo_svg = frames / "logo-overlay.svg"
    logo_svg.write_text(mark)
    command([inkscape, logo_svg, "--export-type=png", f"--export-filename={frames/'logo-overlay.png'}", "--export-width=330", "--export-height=330"])
    (frames / "render-qa.json").write_text(json.dumps({"size": [1920,1080], "fps": FPS, "scenes": qa}, indent=2)+"\n")
    print(json.dumps({"rendered_scenes": len(qa), "frames": str(frames), "text_geometry": "all passed"}), flush=True)


def render_video(script, args, ffmpeg, ffprobe):
    frames = args.base / "frames"
    intermediate = args.base / "intermediate"
    intermediate.mkdir(parents=True, exist_ok=True)
    width, height = (1280, 720) if args.preview else (1920,1080)
    factor = width / 1920
    logo_size = int(round(330 * factor / 2) * 2)
    durations = [float(s["seconds"]) for s in script["scenes"]]
    offsets = [sum(durations[:i]) for i in range(len(durations))]
    def encode(pair):
        index, scene = pair
        background = args.base / "backgrounds" / f"{index%4+1:02d}.png"
        overlay = frames / f"scene-{index+1:02d}-overlay.png"
        logo = frames / "logo-overlay.png"
        for path in (background, overlay, logo):
            if not path.exists():
                raise FileNotFoundError(path)
        seconds = durations[index]
        suffix = "-720" if args.preview else ""
        output = intermediate / f"segment-{index+1:02d}{suffix}.mp4"
        def segment_valid():
            if not output.exists():
                return False
            try:
                meta = json.loads(command([ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", output]))
                stream = next(item for item in meta['streams'] if item['codec_type'] == 'video')
                return (stream['width'], stream['height']) == (width,height) and abs(float(meta['format']['duration'])-seconds) < .1 and int(stream.get('nb_frames', 0)) == round(seconds*FPS)
            except (RuntimeError, ValueError, KeyError, StopIteration):
                return False
        if args.resume and segment_valid():
            print(f"Reused verified scene {index+1:02d}/{len(durations)}", flush=True)
            return output
        filters = (
            f"[0:v]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},"
            f"zoompan=z='1.012+on*0.000025':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s={width}x{height}:fps={FPS},setsar=1[bg];"
            f"[1:v]scale={width}:{height},format=rgba[copy];"
            f"[2:v]scale={logo_size}:{logo_size},format=rgba,rotate='2*PI*(t+{offsets[index]})/16':ow=iw:oh=ih:c=none[logo];"
            f"[bg][copy]overlay=0:0:shortest=1[base];"
            f"[base][logo]overlay={round(1460*factor)}:{round(359*factor)}:shortest=1,"
            f"fade=t=in:st=0:d=0.45,fade=t=out:st={seconds-.45}:d=0.45,format=yuv420p[out]"
        )
        inputs = []
        for path in (background, overlay, logo):
            inputs += ["-loop", "1", "-framerate", str(FPS), "-i", str(path)]
        command([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-filter_complex_threads", "1", *inputs, "-filter_complex", filters, "-map", "[out]", "-t", str(seconds), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-threads", "2", "-r", str(FPS), "-movflags", "+faststart", output])
        if not segment_valid():
            raise RuntimeError(f"Encoded scene {index+1} did not pass duration, dimensions, or frame-count verification")
        if index == 0:
            motion_still = frames / f"scene-01-motion-at-2s{suffix}.png"
            command([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-ss", "2", "-i", output, "-frames:v", "1", motion_still])
            print(f"Motion QA still: {motion_still}", flush=True)
        print(f"Encoded scene {index+1:02d}/{len(durations)}", flush=True)
        return output
    with ThreadPoolExecutor(max_workers=min(2, max(1, args.jobs))) as pool:
        segments = list(pool.map(encode, enumerate(script["scenes"])))
    suffix = "-720" if args.preview else ""
    concat = intermediate / f"segments{suffix}.txt"
    concat.write_text("".join("file '"+str(p).replace("'", "'\\''")+"'\n" for p in segments))
    silent = intermediate / f"fti-user-presentation{suffix}-silent.mp4"
    command([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", concat, "-c", "copy", "-movflags", "+faststart", silent])
    output = args.base / f"fti-user-presentation{suffix}.mp4"
    if args.audio:
        command([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", silent, "-i", args.audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-af", "apad", "-t", str(sum(durations)), "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", output])
    else:
        shutil.copyfile(silent, output)
    metadata = json.loads(command([ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", output]))
    video = next(s for s in metadata["streams"] if s["codec_type"] == "video")
    if (video["width"], video["height"]) != (width, height) or abs(float(metadata["format"]["duration"])-sum(durations)) > .2:
        raise RuntimeError("Final video metadata differs from the scene plan")
    command([ffmpeg, "-v", "error", "-threads", "2", "-i", output, "-f", "null", "-"])
    (intermediate / f"video-qa{suffix}.json").write_text(json.dumps(metadata, indent=2)+"\n")
    print(json.dumps({"video": str(output), "bytes": output.stat().st_size, "seconds": sum(durations), "size": [width,height], "decode_check": "passed", "audio": bool(args.audio)}), flush=True)


def mux_audio_only(script, args, ffmpeg, ffprobe):
    """Add approved existing audio without encoding the scene video again."""
    suffix = "-720" if args.preview else ""
    silent = args.base / "intermediate" / f"fti-user-presentation{suffix}-silent.mp4"
    output = args.base / f"fti-user-presentation{suffix}.mp4"
    seconds = sum(float(scene['seconds']) for scene in script['scenes'])
    if not silent.exists() or not args.audio or not args.audio.exists():
        raise ValueError("An existing silent master and --audio file are required")
    command([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", silent, "-i", args.audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-af", "apad", "-t", str(seconds), "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", output])
    metadata = json.loads(command([ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", output]))
    video = next(stream for stream in metadata['streams'] if stream['codec_type'] == 'video')
    audio = next(stream for stream in metadata['streams'] if stream['codec_type'] == 'audio')
    expected = (1280,720) if args.preview else (1920,1080)
    if (video['width'], video['height']) != expected or abs(float(metadata['format']['duration'])-seconds) > .2 or audio['channels'] != 2:
        raise RuntimeError("Muxed video metadata differs from the approved plan")
    command([ffmpeg, "-v", "error", "-threads", "2", "-i", output, "-f", "null", "-"])
    (args.base / "intermediate" / f"video-qa{suffix}.json").write_text(json.dumps(metadata, indent=2)+"\n")
    print(json.dumps({"video": str(output), "bytes": output.stat().st_size, "seconds": seconds, "size": expected, "decode_check": "passed", "audio": "stereo AAC", "video_stream": "copied without re-encoding"}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--script", type=Path, default=BASE/"script.en.json")
    parser.add_argument("--base", type=Path, default=BASE)
    parser.add_argument("--render-frames", action="store_true")
    parser.add_argument("--render-video", action="store_true")
    parser.add_argument("--mux-audio-only", action="store_true", help="Mux --audio into an already encoded silent master")
    parser.add_argument("--preview", action="store_true", help="Encode 1280×720 rather than 1920×1080")
    parser.add_argument("--resume", action="store_true", help="Reuse scene segments after verifying dimensions, duration and frame count")
    parser.add_argument("--audio", type=Path, help="Existing authorized narration/music audio to mux")
    parser.add_argument("--title-font", default="Orbitron, DejaVu Sans", help="Installed headline font family, with fallback")
    parser.add_argument("--scenes", nargs="+", type=int, help="Render selected still frames only (one-based indices)")
    parser.add_argument("--jobs", type=int, default=2)
    args = parser.parse_args()
    if not args.render_frames and not args.render_video and not args.mux_audio_only:
        parser.error("Choose --render-frames, --render-video, or --mux-audio-only")
    if args.scenes and args.render_video:
        parser.error("--scenes selects still-frame QA only; omit it to encode the complete video")
    script = json.loads(args.script.read_text())
    if len({s['id'] for s in script['scenes']}) != len(script['scenes']):
        raise SystemExit("Duplicate scene IDs")
    for scene in script['scenes']:
        if not 1 <= float(scene['seconds']) <= 60:
            raise SystemExit("Scene durations must be between 1 and 60 seconds")
    tools = {name: shutil.which(name) for name in ("inkscape", "ffmpeg", "ffprobe")}
    if any(not value for value in tools.values()):
        raise SystemExit("Inkscape, FFmpeg and FFprobe are required")
    if args.render_frames:
        render_frames(script, args, tools['inkscape'])
    if args.render_video:
        render_video(script, args, tools['ffmpeg'], tools['ffprobe'])
    if args.mux_audio_only:
        mux_audio_only(script, args, tools['ffmpeg'], tools['ffprobe'])


if __name__ == '__main__':
    main()
