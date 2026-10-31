import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const episodeDir = path.resolve(process.argv[2] || "episodes/001-pdf-ca-signature");
const coverHtml = path.join(episodeDir, "cover/cover.html");
const coverPng = path.join(episodeDir, "cover/cover.png");
const coverSmall = path.join(episodeDir, "cover/cover-1146x717.png");

const candidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const chrome = candidates.find((candidate) => fs.existsSync(candidate));
if (!chrome) {
  console.error("Chrome/Chromium not found; set CHROME_PATH");
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(`file://${coverHtml}`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: coverPng });
await browser.close();

execFileSync(
  "ffmpeg",
  ["-y", "-i", coverPng, "-vf", "scale=1146:717:flags=lanczos", coverSmall],
  { stdio: "inherit" }
);
console.log(coverPng);
console.log(coverSmall);
