import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import tts


class SceneLeadTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "audio").mkdir()
        (self.root / "slides").mkdir()
        self.meta = {
            "slug": "preview",
            "title": "Preview",
            "voice": "test",
            "rate": "+0%",
            "gap": 0.5,
            "tail": 1.0,
            "scenes": [
                {"id": "first", "narration": "First."},
                {"id": "second", "narration": "Second."},
            ],
        }
        for index, scene in enumerate(self.meta["scenes"], 1):
            (self.root / "audio" / f"scene-{index:02d}.mp3").touch()
            (self.root / "audio" / f"scene-{index:02d}.srt").write_text(
                f"1\n00:00:00,100 --> 00:00:00,900\n{scene['narration']}\n",
                encoding="utf-8",
            )

    def build(self):
        (self.root / "episode.json").write_text(
            json.dumps(self.meta), encoding="utf-8"
        )
        with (
            patch("sys.argv", ["tts.py", str(self.root), "--reuse-audio"]),
            patch("tts.shutil.which", return_value="available"),
            patch("tts.ffprobe_duration", side_effect=[2.0, 3.0]),
            patch("tts.run") as run,
            contextlib.redirect_stdout(io.StringIO()),
        ):
            tts.main()
        manifest = json.loads(
            (self.root / "audio" / "manifest.json").read_text(encoding="utf-8")
        )
        command = run.call_args.args[0]
        filters = command[command.index("-filter_complex") + 1]
        cues = tts.parse_srt(self.root / "subtitles" / "preview.srt")
        return manifest, filters, cues

    def test_lead_pads_audio_and_shifts_local_and_global_cues(self):
        self.meta["lead"] = 0.8
        manifest, filters, cues = self.build()
        self.assertEqual(manifest["total"], 8.1)
        self.assertEqual(manifest["scenes"][0]["duration"], 2.8)
        self.assertEqual(manifest["scenes"][1]["start"], 3.3)
        self.assertEqual(manifest["scenes"][0]["cues"][0]["start"], 0.9)
        self.assertEqual([cue["start"] for cue in cues], [0.9, 4.2])
        self.assertIn("aresample=48000,adelay=800:all=1,apad", filters)

    def test_without_lead_keeps_existing_timeline(self):
        manifest, filters, cues = self.build()
        self.assertEqual(manifest["total"], 6.5)
        self.assertEqual(manifest["scenes"][1]["start"], 2.5)
        self.assertEqual([cue["start"] for cue in cues], [0.1, 2.6])
        self.assertNotIn("adelay", filters)

    def test_rebuilding_with_new_lead_does_not_double_shift_cues(self):
        self.meta["lead"] = 0.8
        self.build()
        self.meta["lead"] = 0.4
        manifest, _, cues = self.build()
        self.assertEqual(manifest["total"], 7.3)
        self.assertEqual([cue["start"] for cue in cues], [0.5, 3.4])
        original = tts.parse_srt(self.root / "audio" / "scene-01.srt")
        self.assertEqual(original[0]["start"], 0.1)


if __name__ == "__main__":
    unittest.main()
