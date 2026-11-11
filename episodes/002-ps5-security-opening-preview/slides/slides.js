(() => {
  const episode = window.__EPISODE;
  if (!episode) return;
  const render = new URLSearchParams(location.search).get("render") === "1";
  document.body.classList.toggle("render", render);
  const scenes = [...document.querySelectorAll(".scene")];
  if (scenes.length !== episode.scenes.length) throw new Error("Scene count mismatch");
  const animations = [];
  const reveals = [];
  scenes.forEach((element, index) => {
    const scene = episode.scenes[index];
    if (element.id !== scene.id) throw new Error("Scene order mismatch");
    element.querySelectorAll("[data-enter]").forEach((target) => {
      const animation = target.animate([
        { opacity: 0, translate: "0 16px" },
        { opacity: 1, translate: "0 0" },
      ], { duration: 650, fill: "both", easing: "ease-out" });
      animation.pause();
      animations.push({ animation, index });
    });
    element.querySelectorAll("[data-after]").forEach((target) => {
      const cue = scene.cues.find((item) => item.text.includes(target.dataset.after));
      if (!cue) throw new Error(`Missing narration cue: ${target.dataset.after}`);
      reveals.push({ target, index, start: cue.start });
    });
  });
  const audio = document.getElementById("narration");
  const caption = document.getElementById("caption");
  const slider = document.getElementById("seekBar");
  const play = document.getElementById("playBtn");
  const formatTime = (time) => `${String(Math.floor(time / 60)).padStart(2, "0")}:${String(Math.floor(time % 60)).padStart(2, "0")}`;
  function seek(time) {
    const t = Math.max(0, Math.min(time, episode.total));
    let index = 0;
    episode.scenes.forEach((scene, i) => { if (t >= scene.start) index = i; });
    const scene = episode.scenes[index];
    const local = Math.round((t - scene.start) * 1000) / 1000;
    scenes.forEach((element, i) => element.classList.toggle("active", i === index));
    animations.forEach((item) => { item.animation.currentTime = item.index === index ? local * 1000 : 0; });
    reveals.forEach((item) => { item.target.classList.toggle("revealed", item.index === index && local >= item.start); });
    let cue;
    for (const item of scene.cues) {
      if (local >= item.start) cue = item;
    }
    caption.textContent = cue?.text || "";
    document.getElementById("pageNum").textContent = `${index + 1} / ${scenes.length}`;
    document.getElementById("progressFill").style.width = `${100 * t / episode.total}%`;
    document.getElementById("timeLabel").textContent = `${formatTime(t)} / ${formatTime(episode.total)}`;
    slider.value = String(1000 * t / episode.total);
  }
  window.__episode = episode;
  window.__seek = seek;
  seek(0);
  window.__ready = true;
  if (render) return;
  function fit() {
    const scale = Math.min((innerWidth - 32) / 1920, Math.max(200, innerHeight - 110) / 1080);
    document.getElementById("stage").style.transform = `scale(${scale})`;
    const wrap = document.getElementById("stageWrap");
    wrap.style.width = `${1920 * scale}px`;
    wrap.style.height = `${1080 * scale}px`;
    document.getElementById("controls").style.width = `${1920 * scale}px`;
  }
  play.addEventListener("click", async () => {
    if (audio.paused) {
      if (audio.ended) audio.currentTime = 0;
      try { await audio.play(); } catch { play.textContent = "播放失败，请重试"; }
    } else audio.pause();
  });
  audio.addEventListener("play", () => { play.textContent = "暂停"; });
  audio.addEventListener("pause", () => { play.textContent = "播放开场预览"; });
  audio.addEventListener("ended", () => { seek(episode.total); play.textContent = "重播开场预览"; });
  slider.addEventListener("input", () => {
    audio.currentTime = Number(slider.value) / 1000 * episode.total;
    seek(audio.currentTime);
  });
  function tick() {
    if (!audio.paused) seek(audio.currentTime);
    requestAnimationFrame(tick);
  }
  addEventListener("resize", fit);
  fit();
  tick();
})();
