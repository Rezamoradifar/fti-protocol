# FTI English user presentation

20 scenes, 305 seconds, 1920 × 1080 at 24 fps. All explanatory English text appears on screen; the JSON field `narration` supplies on-screen prose. Audio is an original instrumental ambient composition, with no voiceover, lyrics, downloaded samples or external generation calls.

## Sources and prerequisites

Run the commands below from the repository root. Keep `script.en.json`, the four `backgrounds/*.png` files, `fonts/` and `../telegram/assets/site-logo-profile.png` available. The renderer reuses these images without regenerating the artwork or redrawing the logo.

Required: Python 3.11+, NumPy (rendered with 2.3.5), Inkscape, FFmpeg/FFprobe with `libx264`, `aac` and `libmp3lame`, fontconfig, and DejaVu Sans. The renderer uses the Python standard library; NumPy is required by the music composer. For an isolated Python environment:

```sh
python3 -m venv /tmp/fti-video-venv
/tmp/fti-video-venv/bin/python -m pip install numpy==2.3.5
. /tmp/fti-video-venv/bin/activate
```

Install the supplied headline fonts before launching Inkscape:

```sh
mkdir -p "$HOME/.local/share/fonts/fti-video"
cp marketing/video-20261024/fonts/Orbitron-400.ttf marketing/video-20261024/fonts/Orbitron-700.ttf "$HOME/.local/share/fonts/fti-video/"
fc-cache -f "$HOME/.local/share/fonts/fti-video"
fc-match Orbitron
```

The exact TTFs are retained outside the ignored render directory for portability. They were converted with fontTools (`TTFont`, `flavor=None`) from `orbitron-latin-400-normal.woff` and `orbitron-latin-700-normal.woff` in this repository's `@fontsource/orbitron` 5.2.8 dependency. The unchanged [SIL Open Font License 1.1](fonts/Orbitron-LICENSE.txt) and copyright notice accompany them. Sources: [Fontsource Orbitron](https://fontsource.org/fonts/orbitron), [font files repository](https://github.com/fontsource/font-files/tree/main/fonts/google/orbitron), [Orbitron project](https://github.com/theleagueof/orbitron). The renderer's default headline family is `Orbitron, DejaVu Sans`; silently using the fallback changes the original typography.

## Build

```sh
python3 tools/compose-fti-video-music.py
python3 tools/render-fti-user-video.py --render-frames --render-video --jobs 2 --audio marketing/video-20261024/audio/original-ambient.wav
```

The composer streams two-second synthesis blocks with seed `20261024`, uses a 76 BPM original chord/arpeggio score, applies two-second opening/closing fades, and normalizes to −22 LUFS. It creates a 305-second, 44.1 kHz stereo WAV and a gapless MP3; MP3 container duration includes frame padding. Use the WAV for the video. Two short audition excerpts are written to `/tmp/fti-music-audition/`.

The renderer checks text bounds, renders native SVG through Inkscape, animates the backgrounds and exact logo, and encodes H.264 with stereo AAC. It checks scene dimensions, frame counts and duration, then fully decodes the final MP4. Output: `marketing/video-20261024/fti-user-presentation.mp4`.

For a 1280 × 720 preview, add `--preview` to the render command; the result is `fti-user-presentation-720.mp4`.

To resume interrupted encoding after frames have been rendered:

```sh
python3 tools/render-fti-user-video.py --render-video --resume --jobs 2 --audio marketing/video-20261024/audio/original-ambient.wav
```

Use `--resume` only while the script, fonts, backgrounds, overlays and render settings are unchanged: cached segments are checked for dimensions, duration and frame count, rather than source hashes. After changing visual sources, render frames and video again without `--resume`.

To replace only the music while retaining an existing silent master:

```sh
python3 tools/render-fti-user-video.py --mux-audio-only --audio marketing/video-20261024/audio/original-ambient.wav
```

This requires `intermediate/fti-user-presentation-silent.mp4`; video is copied without re-encoding. Add `--preview` when using the 720p silent master. Generated frames, intermediates, audio, MP4s and temporary QA data are ignored locally; the source JSON, backgrounds, fonts and this README remain trackable.
