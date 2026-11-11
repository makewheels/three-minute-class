# 流水线说明

## 1. 输入

一期的源文件是 `episode.json`：

```json
{
  "slug": "pdf-ca-signature",
  "voice": "zh-CN-YunxiNeural",
  "rate": "+15%",
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "gap": 0.35,
  "scenes": [
    { "id": "hook", "label": "开场", "narration": "……" }
  ]
}
```

`scenes` 的顺序必须和 `slides/index.html` 里的 `<section class="scene">` 顺序一致。

需要让观众先看画面、再听解释时，可以增加 `"lead": 1.2`，给每场旁白前留 1.2 秒静音；`gap` 是讲完后停留的时间，`tail` 是最后一场的停留时间。`lead` 默认是 0，不改变既有视频的节奏。不要靠加速旁白给停顿腾时间。

## 2. 配音与时间轴

`pipeline/tts.py` 做四件事：

1. 逐场调用 `edge-tts`，生成 `audio/scene-NN.mp3` 和句级 `scene-NN.srt`。
2. 用 `ffprobe` 取每段真实时长，按 `gap` 拼接成 `audio/narration.m4a`。
3. 把所有 SRT 偏移到全局时间，写 `subtitles/<slug>.srt` 和 `.vtt`。
4. 写 `audio/manifest.json` 和 `slides/data.js`。

`manifest.json` 里每场有：

- `start`：这一场在成片中的绝对起点；
- `duration`：场景前静音与旁白的实际时长；
- `slot`：这一场占用的时间（`duration + gap`，最后一场加 `tail`）；
- `cues`：这一场内部的逐句字幕，时间是场景内相对时间。

**改旁白后不要手改 `data.js`**，重新跑 `make audio`。

只改 `lead`、`gap` 或 `tail`，可运行 `tts.py --reuse-audio`，重新生成音轨与同步时间轴，分场原始 MP3/SRT 不变。播放器应在第一条字幕的 `start` 之前不显示字幕，避免把后面的解释提前呈现。

## 3. 画面与 seek

`slides/index.html` 是唯一的画面源，也是网页播放器。每场一个 `<section class="scene">`，元素用 `data-anim`、`data-delay` 标记入场动画。

`slides.js` 启动时用 Web Animations API 创建动画并暂停；`window.__seek(t)` 接受成片绝对时间：

1. 找到当前场景；
2. 把该场景所有动画的 `currentTime` 设为场景内时间；
3. 更新字幕、页码、进度条。

因为动画不依赖墙钟，同一个 `t` 每次渲染结果一致。

字幕 46px；长句拆成短句，CSS 用 `text-wrap: balance` 防止出现“索。”这种孤字。

## 4. 渲染

`pipeline/render.mjs` 不再逐帧录屏，而是按关键时间截图：

- 每场前 `ENTRANCE` 秒（默认 3s）按 30fps 逐帧截图，覆盖入场动画；
- 之后每个字幕切换点截一张，因为画面静止、只有字幕在变；
- 每场结尾截一张，覆盖场景末尾；
- 用 concat demuxer 给每张图写 `duration`，FFmpeg 用 `fps=30` 重采样成恒定帧率；
- 所有场景片段 concat 后，加上 `narration.m4a`。

字幕已经画在 HTML 里，所以不依赖 FFmpeg 的 `subtitles` / libass。

## 5. 参数

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `ENTRANCE` | `3.0` | 每场逐帧渲染的入场秒数 |
| `CRF` | `18` | x264 质量，越小越清晰、文件越大 |
| `PRESET` | `medium` | x264 预设 |
| `CHROME_PATH` | 自动探测 | Chrome/Chromium 路径 |

```bash
CRF=16 PRESET=slow node pipeline/render.mjs episodes/001-pdf-ca-signature
```

## 6. 加一场戏

1. 在 `episode.json` 的 `scenes` 里加一项，写 `id` 和 `narration`。
2. 在 `slides/index.html` 的相同位置加 `<section class="scene" data-scene="...">`。
3. 需要入场动画的元素加 `class="... anim" data-anim="fade-up" data-delay="0.4"`。
4. 跑 `make audio`，再跑 `make render`。

`data-delay` 是场景内的相对秒数；不要写墙钟动画。

## 7. 常见问题

- **edge-tts 403**：升级 `edge-tts`（本项目锁定 7.3.1），旧版本会因服务端 token 变化失败。
- **截图是空白/被裁切**：检查 `#scenes` 是否有 `position: absolute; inset: 0`，否则场景容器高度为 0。
- **切场有白屏**：把 kicker 设成静态，标题的 `data-delay` 控制在 0.05s 以内。
- **字幕和声音不同步**：确认 `manifest.json` 的 `start`/`duration` 是新生成的，不要混用旧 `data.js`。
- **FFmpeg 找不到字幕滤镜**：本项目不需要 libass；字幕已画进帧。
- **视频太长**：先看 `manifest.total`，优先删旁白，不要硬加速到听不清。
