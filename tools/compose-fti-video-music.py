#!/usr/bin/env python3
"""Compose an original 305-second FTI ambient score with local oscillators only.

No downloaded samples, speech, external APIs, or borrowed melodies are used.
Synthesis is streamed in two-second blocks; FFmpeg provides two-pass loudness
normalization and MP3 encoding. Requires Python, NumPy, ffmpeg and ffprobe.
"""
import argparse
import json
import math
from pathlib import Path
import re
import subprocess
import tempfile
import wave

import numpy as np

RATE = 44100
DURATION = 305
BPM = 76
SEED = 20261024
BEAT = 60.0 / BPM
CHORD_SECONDS = BEAT * 16
CHORDS = (
    (50, 53, 57, 60, 64),  # D minor ninth
    (46, 50, 53, 57, 60),  # B-flat major ninth
    (43, 46, 50, 53, 57),  # G minor ninth
    (45, 48, 52, 55, 59),  # A minor ninth
)
ARP = (0, 3, 1, 4, 2, 1, 3, 2, 4, 0, 2, 3, 1, 4, 3, 1)


def frequency(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def run(args):
    return subprocess.run(args, check=True, text=True, capture_output=True)


def loudness(path):
    result = run(['ffmpeg', '-hide_banner', '-nostdin', '-threads', '2',
                  '-i', str(path), '-af',
                  'loudnorm=I=-22:TP=-3:LRA=7:print_format=json',
                  '-f', 'null', '-'])
    matches = re.findall(r'\{\s*"input_i".*?\}', result.stderr, re.S)
    if not matches:
        raise RuntimeError('FFmpeg did not return loudness measurements')
    return json.loads(matches[-1])


def synthesize(path):
    rng = np.random.default_rng(SEED)
    phases = rng.uniform(0, 2 * math.pi, (4, 5))
    total_frames = RATE * DURATION
    block_frames = RATE * 2
    with wave.open(str(path), 'wb') as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(RATE)
        for start in range(0, total_frames, block_frames):
            count = min(block_frames, total_frames - start)
            t = (start + np.arange(count, dtype=np.float64)) / RATE
            left = np.zeros(count, dtype=np.float64)
            right = np.zeros(count, dtype=np.float64)

            # Long chord tails overlap smoothly without chunk-boundary edits.
            for chord_index, chord in enumerate(CHORDS):
                local = np.remainder(t - chord_index * CHORD_SECONDS,
                                     CHORD_SECONDS * len(CHORDS))
                attack = np.sin(np.minimum(local / 2.6, 1) * math.pi / 2) ** 2
                release = np.cos(np.clip((local - CHORD_SECONDS) / 2.6,
                                         0, 1) * math.pi / 2) ** 2
                envelope = attack * release * (local < CHORD_SECONDS + 2.6)
                if not np.any(envelope):
                    continue
                for note_index, note in enumerate(chord):
                    freq = frequency(note)
                    phase = phases[chord_index, note_index]
                    motion = .2 * np.sin(2 * math.pi * .071 * t + phase)
                    fundamental = 2 * math.pi * freq * t + phase + motion
                    spread = 2 * math.pi * freq * .00085 * t
                    warmth = .10 * np.sin(2 * fundamental)
                    amplitude = .020 * envelope / (1 + .1 * note_index)
                    left += amplitude * (np.sin(fundamental - spread) + warmth)
                    right += amplitude * (np.sin(fundamental + spread) + warmth)

            # Subtle bass notes follow the harmony, with an independent slow swell.
            chord_positions = np.floor(t / CHORD_SECONDS).astype(int) % 4
            for chord_index, chord in enumerate(CHORDS):
                local = np.remainder(t - chord_index * CHORD_SECONDS,
                                     CHORD_SECONDS * 4)
                bass_env = np.sin(np.clip(local / 1.8, 0, 1) * math.pi / 2) ** 2
                bass_env *= np.cos(np.clip((local - CHORD_SECONDS + 1.5) / 3,
                                          0, 1) * math.pi / 2) ** 2
                bass_env *= (local < CHORD_SECONDS + 1.5)
                bass = .024 * bass_env * np.sin(2 * math.pi * frequency(chord[0] - 12) * t)
                left += bass
                right += bass

            # Original sparse bell pattern: quiet, harmonically tied and non-vocal.
            arp_step = np.floor(t / (BEAT * 2)).astype(np.int64)
            arp_time = np.remainder(t, BEAT * 2)
            for chord_index, chord in enumerate(CHORDS):
                for pattern_index in np.unique(arp_step % len(ARP)):
                    mask = (chord_positions == chord_index) & (arp_step % len(ARP) == pattern_index)
                    if not np.any(mask):
                        continue
                    bell_frequency = frequency(chord[ARP[int(pattern_index)]] + 12)
                    a = arp_time[mask]
                    bell_env = (1 - np.exp(-a * 80)) * np.exp(-a * 2.4)
                    bell = .008 * bell_env * np.sin(
                        2 * math.pi * bell_frequency * a
                        + .8 * np.exp(-a * 3) * np.sin(2 * math.pi * bell_frequency * 2.01 * a))
                    pan = .5 + .28 * math.sin(int(pattern_index) * 2.399963)
                    left[mask] += bell * math.sqrt(1 - pan)
                    right[mask] += bell * math.sqrt(pan)

            # Barely audible low percussion; seeded noise is synthesized, not sampled.
            pulse_time = np.remainder(t, BEAT * 4)
            pulse = .004 * np.sin(2 * math.pi * (44 * pulse_time
                                   + 14 * (1 - np.exp(-pulse_time * 20)) / 20))
            pulse *= np.exp(-pulse_time * 13) * (1 - np.exp(-pulse_time * 130))
            tick_time = np.remainder(t + BEAT, BEAT * 2)
            tick = rng.standard_normal(count) * .0004 * np.exp(-tick_time * 110)
            left += pulse + tick
            right += pulse - tick * .7

            # Two-second opening and closing fades, with a slow breathing contour.
            fade_in = np.sin(np.clip(t / 2, 0, 1) * math.pi / 2) ** 2
            fade_out = np.sin(np.clip((DURATION - t) / 2, 0, 1) * math.pi / 2) ** 2
            contour = .92 + .08 * np.sin(2 * math.pi * t / 83 - .5)
            stereo = np.column_stack((left, right))
            stereo *= (fade_in * fade_out * contour)[:, None]
            if np.max(np.abs(stereo)) >= .98:
                raise RuntimeError('Unexpected synthesis clipping')
            out.writeframes(np.rint(stereo * 32767).astype('<i2').tobytes())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path,
        default=Path(__file__).resolve().parents[1] / 'marketing/video-20261024/audio')
    parser.add_argument('--excerpt-dir', type=Path, default=Path('/tmp/fti-music-audition'))
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    wav_path = args.output_dir / 'original-ambient.wav'
    mp3_path = args.output_dir / 'original-ambient.mp3'
    with tempfile.TemporaryDirectory(prefix='fti-original-score-') as temporary:
        raw = Path(temporary) / 'raw.wav'
        synthesize(raw)
        measured = loudness(raw)
        normalization = (
            'loudnorm=I=-22:TP=-3:LRA=7:linear=true:'
            f'measured_I={measured["input_i"]}:measured_TP={measured["input_tp"]}:'
            f'measured_LRA={measured["input_lra"]}:measured_thresh={measured["input_thresh"]}:'
            f'offset={measured["target_offset"]}')
        run(['ffmpeg', '-y', '-hide_banner', '-nostdin', '-threads', '2',
             '-i', str(raw), '-af', normalization, '-ar', str(RATE), '-ac', '2',
             '-c:a', 'pcm_s16le', str(wav_path)])
    run(['ffmpeg', '-y', '-hide_banner', '-nostdin', '-threads', '2',
         '-i', str(wav_path), '-c:a', 'libmp3lame', '-b:a', '192k',
         '-metadata', 'title=FTI Original Ambient — 76 BPM',
         '-metadata', 'comment=Original local oscillator composition; seed 20261024; no samples or vocals',
         str(mp3_path)])
    args.excerpt_dir.mkdir(parents=True, exist_ok=True)
    for index, position in enumerate((38, 186), start=1):
        excerpt = args.excerpt_dir / f'excerpt-{index:02d}.mp3'
        run(['ffmpeg', '-y', '-hide_banner', '-nostdin', '-threads', '2',
             '-ss', str(position), '-i', str(wav_path), '-t', '10',
             '-af', 'afade=t=in:d=0.3,afade=t=out:st=9.5:d=0.5',
             '-c:a', 'libmp3lame', '-b:a', '128k', str(excerpt)])
    print(json.dumps({'wav': str(wav_path), 'mp3': str(mp3_path),
                      'duration_seconds': DURATION, 'seed': SEED,
                      'loudness': loudness(wav_path),
                      'excerpts': str(args.excerpt_dir)}, indent=2))


if __name__ == '__main__':
    main()
