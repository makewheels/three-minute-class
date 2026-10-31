import { chromium } from "playwright-core";
import path from "node:path";
import fs from "node:fs";

const episodeDir = path.resolve(process.argv[2] || "episodes/001-pdf-ca-signature");
const outDir = path.resolve(process.argv[3] || "/tmp/tmc-shots");
fs.mkdirSync(outDir, { recursive: true });

const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(`file://${path.join(episodeDir, "slides/index.html")}?render=1`);
await page.waitForFunction(() => window.__ready === true);
await page.evaluate(() => document.fonts.ready);

const scenes = await page.evaluate(() =>
  window.__episode.scenes.map((s) => ({ id: s.id, start: s.start, duration: s.duration }))
);

for (const scene of scenes) {
  const t = scene.start + Math.min(4.0, scene.duration);
  await page.evaluate((time) => window.__seek(time), t);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
  const file = path.join(outDir, `${scene.id}.png`);
  await page.screenshot({ path: file });
  console.log(file);
}

await browser.close();
