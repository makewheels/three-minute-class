#!/usr/bin/env python3
"""Synthesize per-scene narration, concat audio, and emit timeline data."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd))
    subprocess.run(cmd, check=True)


def ffprobe_duration(path: Path) -> float:
    out = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            str(path),
        ],
        text=True,
    ).strip()
    return round(float(out), 3)


def parse_ts(value: str) -> float:
    value = value.strip().replace(".", ",")
    hms, ms = value.split(",")
    h, m, s = hms.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def format_ts(seconds: float, sep: str = ",") -> str:
    ms = int(round(seconds * 1000))
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def parse_srt(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8-sig").strip()
    cues: list[dict] = []
    for block in re.split(r"\n\s*\n", text):
        lines = [line for line in block.splitlines() if line.strip()]
        if len(lines) < 3 or "-->" not in lines[1]:
            continue
        left, right = lines[1].split("-->", 1)
        cues.append(
            {
                "start": round(parse_ts(left), 3),
                "end": round(parse_ts(right), 3),
                "text": "\n".join(lines[2:]).strip(),
            }
        )
    return cues


def write_srt(cues: list[dict], path: Path) -> None:
    blocks = []
    for i, cue in enumerate(cues, 1):
        blocks.append(
            f"{i}\n{format_ts(cue['start'])} --> {format_ts(cue['end'])}\n{cue['text']}\n"
        )
    path.write_text("\n".join(blocks), encoding="utf-8")


def align_cues(narration: str, cues: list[dict]) -> None:
    """Keep edge-tts timings but restore punctuation it may strip (e.g. 《)."""
    sentences = [s.strip() for s in re.findall(r"[^。！？]+[。！？]?", narration) if s.strip()]
    if len(sentences) == len(cues):
        for cue, sentence in zip(cues, sentences):
            cue["text"] = sentence


def write_vtt(cues: list[dict], path: Path) -> None:
    blocks = ["WEBVTT\n"]
    for cue in cues:
        blocks.append(
            f"{format_ts(cue['start'], '.')} --> {format_ts(cue['end'], '.')}\n{cue['text']}\n"
        )
    path.write_text("\n".join(blocks), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("episode", type=Path, help="Path to episode directory")
    parser.add_argument(
        "--reuse-audio",
        action="store_true",
        help="Reuse existing scene MP3/SRT files; only rebuild the timeline",
    )
    args = parser.parse_args()

    episode_dir = args.episode.resolve()
    meta = json.loads((episode_dir / "episode.json").read_text(encoding="utf-8"))
    audio_dir = episode_dir / "audio"
    subs_dir = episode_dir / "subtitles"
    audio_dir.mkdir(parents=True, exist_ok=True)
    subs_dir.mkdir(parents=True, exist_ok=True)

    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        sys.exit("ffmpeg / ffprobe not found in PATH")
    if not shutil.which("edge-tts"):
        sys.exit("edge-tts not found; run: uv sync --project pipeline && uv run --project pipeline python pipeline/tts.py ...")

    scenes = meta["scenes"]
    durations: list[float] = []
    scene_cues: list[list[dict]] = []

    for i, scene in enumerate(scenes, 1):
        stem = f"scene-{i:02d}"
        mp3 = audio_dir / f"{stem}.mp3"
        srt = audio_dir / f"{stem}.srt"
        print(f"\n[{i}/{len(scenes)}] {scene['id']} · {len(scene['narration'])} chars")
        if not (args.reuse_audio and mp3.exists() and srt.exists()):
            run(
                [
                    "edge-tts",
                    "--voice",
                    meta["voice"],
                    "--rate",
                    meta["rate"],
                    "--volume",
                    meta.get("volume", "+0%"),
                    "--text",
                    scene["narration"],
                    "--write-media",
                    str(mp3),
                    "--write-subtitles",
                    str(srt),
                ]
            )
        duration = ffprobe_duration(mp3)
        durations.append(duration)
        cues = parse_srt(srt)
        align_cues(scene["narration"], cues)
        scene_cues.append(cues)
        print(f"    {duration:.3f}s")

    gap = float(meta.get("gap", 0.35))
    tail = float(meta.get("tail", 0.8))
    starts: list[float] = []
    cursor = 0.0
    for i, duration in enumerate(durations):
        starts.append(round(cursor, 3))
        cursor += duration + (gap if i < len(durations) - 1 else tail)

    total = round(cursor, 3)
    all_cues: list[dict] = []
    for i, cues in enumerate(scene_cues):
        scene_end = starts[i] + durations[i]
        for cue in cues:
            all_cues.append(
                {
                    "start": round(starts[i] + cue["start"], 3),
                    "end": min(round(starts[i] + cue["end"], 3), scene_end),
                    "text": cue["text"],
                    "scene": scenes[i]["id"],
                }
            )
        if cues and all_cues[-1]["scene"] == scenes[i]["id"]:
            all_cues[-1]["end"] = round(scene_end, 3)

    # Concatenate scene audio with a short silence between scenes.
    inputs: list[str] = []
    for i in range(len(scenes)):
        inputs += ["-i", str(audio_dir / f"scene-{i + 1:02d}.mp3")]
    filters = []
    for i in range(len(scenes)):
        pad = gap if i < len(scenes) - 1 else tail
        filters.append(f"[{i}:a]aresample=48000,apad=pad_dur={pad}[a{i}]")
    concat_inputs = "".join(f"[a{i}]" for i in range(len(scenes)))
    filter_complex = (
        ";".join(filters)
        + f";{concat_inputs}concat=n={len(scenes)}:v=0:a=1,loudnorm=I=-16:TP=-1.5:LRA=11[out]"
    )
    run(
        [
            "ffmpeg",
            "-y",
            *inputs,
            "-filter_complex",
            filter_complex,
            "-map",
            "[out]",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            "48000",
            "-ac",
            "2",
            str(audio_dir / "narration.m4a"),
        ]
    )

    slug = meta["slug"]
    write_srt(all_cues, subs_dir / f"{slug}.srt")
    write_vtt(all_cues, subs_dir / f"{slug}.vtt")

    manifest = {
        "title": meta["title"],
        "subtitle": meta.get("subtitle", ""),
        "series": meta.get("series", ""),
        "episode": meta.get("episode", ""),
        "slug": slug,
        "voice": meta["voice"],
        "rate": meta["rate"],
        "width": meta.get("width", 1920),
        "height": meta.get("height", 1080),
        "fps": meta.get("fps", 30),
        "gap": gap,
        "tail": tail,
        "total": total,
        "narration": str((audio_dir / "narration.m4a").relative_to(episode_dir)),
        "scenes": [
            {
                "id": scene["id"],
                "label": scene.get("label", ""),
                "narration": scene["narration"],
                "duration": durations[i],
                "start": starts[i],
                "slot": round(durations[i] + (gap if i < len(scenes) - 1 else tail), 3),
                "cues": [
                    {
                        "start": round(cue["start"], 3),
                        "end": round(cue["end"], 3),
                        "text": cue["text"],
                    }
                    for cue in scene_cues[i]
                ],
            }
            for i, scene in enumerate(scenes)
        ],
    }
    (audio_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    data_js = (
        "// Generated by pipeline/tts.py. Do not edit by hand.\n"
        "window.__EPISODE = "
        + json.dumps(manifest, ensure_ascii=False, indent=2)
        + ";\n"
    )
    (episode_dir / "slides" / "data.js").write_text(data_js, encoding="utf-8")

    minutes, seconds = divmod(total, 60)
    print(f"\nTotal: {int(minutes)}:{seconds:05.2f} ({total:.3f}s)")
    print(f"Audio: {audio_dir / 'narration.m4a'}")
    print(f"Data:  {episode_dir / 'slides' / 'data.js'}")


if __name__ == "__main__":
    main()
