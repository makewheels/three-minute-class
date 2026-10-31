import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const episodeDir = path.resolve(process.argv[2] || "episodes/001-pdf-ca-signature");
const manifestPath = path.join(episodeDir, "audio/manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error("missing audio/manifest.json; run tts.py first");
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const fps = Number(manifest.fps || 30);
const entrance = Number(process.env.ENTRANCE || 4.0);
const crf = String(process.env.CRF || "18");
const preset = String(process.env.PRESET || "medium");
const renderDir = path.join(episodeDir, "render");
const outDir = path.join(episodeDir, "out");
fs.rmSync(renderDir, { recursive: true, force: true });
fs.mkdirSync(renderDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const chromeCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const chrome = chromeCandidates.find((candidate) => fs.existsSync(candidate));
if (!chrome) {
  console.error("Chrome/Chromium not found; set CHROME_PATH");
  process.exit(1);
}

function ffmpeg(args) {
  console.log("+ ffmpeg", args.join(" "));
  execFileSync("ffmpeg", args, { stdio: "inherit" });
}

function dedupeTimes(times) {
  const seen = new Set();
  const out = [];
  for (const time of times.sort((a, b) => a - b)) {
    const key = Math.round(time * 1000);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(time);
  }
  return out;
}

const browser = await chromium.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage({
  viewport: { width: manifest.width || 1920, height: manifest.height || 1080 },
  deviceScaleFactor: 1,
});
const pageUrl = `file://${path.join(episodeDir, "slides/index.html")}?render=1`;
await page.goto(pageUrl);
await page.waitForFunction(() => window.__ready === true);
await page.evaluate(() => document.fonts.ready);
console.log("rendering", manifest.title, `${manifest.total}s`, `${fps}fps`);

const segments = [];

for (let sceneIndex = 0; sceneIndex < manifest.scenes.length; sceneIndex += 1) {
  const scene = manifest.scenes[sceneIndex];
  const sceneNumber = String(sceneIndex + 1).padStart(2, "0");
  const frameDir = path.join(renderDir, `scene-${sceneNumber}`);
  fs.mkdirSync(frameDir, { recursive: true });

  const entranceEnd = Math.min(entrance, scene.duration);
  const entranceFrames = Math.max(1, Math.round(entranceEnd * fps));
  const times = [];
  for (let frame = 0; frame < entranceFrames; frame += 1) {
    times.push(frame / fps);
  }
  times.push(entranceEnd);
  for (const cue of scene.cues) {
    if (cue.start > entranceEnd + 0.002 && cue.start < scene.duration - 0.002) {
      times.push(cue.start);
    }
  }
  times.push(scene.duration);
  const keyTimes = dedupeTimes(times);

  console.log(
    `[${sceneNumber}/${manifest.scenes.length}] ${scene.id} — ${keyTimes.length} frames, ${scene.slot.toFixed(2)}s`
  );

  const files = [];
  for (let i = 0; i < keyTimes.length; i += 1) {
    const time = keyTimes[i];
    await page.evaluate(
      (globalTime) => {
        window.__seek(globalTime);
        return new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
      },
      scene.start + time
    );
    const file = path.join(frameDir, `frame-${String(i + 1).padStart(4, "0")}.png`);
    await page.screenshot({ path: file });
    files.push({ file, time });
  }

  const listPath = path.join(renderDir, `scene-${sceneNumber}.txt`);
  const lines = [];
  for (let i = 0; i < files.length; i += 1) {
    const current = files[i];
    const next = files[i + 1];
    const duration = next ? next.time - current.time : Math.max(scene.slot - scene.duration, 1 / fps);
    lines.push(`file '${current.file.replace(/'/g, "'\\''")}'`);
    lines.push(`duration ${duration.toFixed(6)}`);
  }
  lines.push(`file '${files[files.length - 1].file.replace(/'/g, "'\\''")}'`);
  fs.writeFileSync(listPath, lines.join("\n") + "\n", "utf8");

  const segment = path.join(renderDir, `scene-${sceneNumber}.mp4`);
  ffmpeg([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-vf",
    "fps=30,format=yuv420p",
    "-t",
    scene.slot.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    preset,
    "-crf",
    crf,
    "-r",
    "30",
    "-fps_mode",
    "cfr",
    segment,
  ]);
  segments.push(segment);
}

const segmentsList = path.join(renderDir, "segments.txt");
fs.writeFileSync(
  segmentsList,
  segments.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n") + "\n",
  "utf8"
);
const silentVideo = path.join(renderDir, "video-noaudio.mp4");
ffmpeg(["-y", "-f", "concat", "-safe", "0", "-i", segmentsList, "-c", "copy", silentVideo]);

const output = path.join(outDir, `${manifest.slug}.mp4`);
ffmpeg([
  "-y",
  "-i",
  silentVideo,
  "-i",
  path.join(episodeDir, manifest.narration),
  "-map",
  "0:v:0",
  "-map",
  "1:a:0",
  "-c:v",
  "copy",
  "-c:a",
  "aac",
  "-b:a",
  "192k",
  "-shortest",
  "-movflags",
  "+faststart",
  output,
]);

const posterSource = path.join(renderDir, "scene-01", "frame-0090.png");
if (fs.existsSync(posterSource)) {
  fs.copyFileSync(posterSource, path.join(outDir, "poster.png"));
}

await browser.close();
console.log("done:", output);
