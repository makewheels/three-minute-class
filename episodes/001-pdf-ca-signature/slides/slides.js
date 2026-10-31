(() => {
  const EPISODE = window.__EPISODE;
  if (!EPISODE) return;

  const isRender = new URLSearchParams(location.search).get("render") === "1";
  document.body.classList.toggle("render", isRender);
  document.body.classList.toggle("player", !isRender);

  const stage = document.getElementById("stage");
  const stageWrap = document.getElementById("stageWrap");
  const controls = document.getElementById("controls");
  const scenes = [...document.querySelectorAll(".scene")];
  const captionEl = document.getElementById("caption");
  const progressFill = document.getElementById("progressFill");
  const pageNum = document.getElementById("pageNum");
  const audio = document.getElementById("narration");
  const playBtn = document.getElementById("playBtn");
  const seekBar = document.getElementById("seekBar");
  const timeLabel = document.getElementById("timeLabel");
  const muteBtn = document.getElementById("muteBtn");
  const fullBtn = document.getElementById("fullBtn");

  if (scenes.length !== EPISODE.scenes.length) {
    console.warn("scene count mismatch", scenes.length, EPISODE.scenes.length);
  }

  scenes.forEach((scene, index) => {
    scene.dataset.index = String(index);
    scene.classList.toggle("active", index === 0);
  });

  const animations = [];

  const specs = {
    "fade-up": {
      duration: 0.62,
      frames: [
        { opacity: 0, transform: "translateY(26px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
    },
    "fade-in": {
      duration: 0.66,
      frames: [{ opacity: 0 }, { opacity: 1 }],
    },
    "slide-left": {
      duration: 0.76,
      frames: [
        { opacity: 0, transform: "translateX(52px)" },
        { opacity: 1, transform: "translateX(0)" },
      ],
    },
    "slide-right": {
      duration: 0.76,
      frames: [
        { opacity: 0, transform: "translateX(-52px)" },
        { opacity: 1, transform: "translateX(0)" },
      ],
    },
    "scale-in": {
      duration: 0.7,
      frames: [
        { opacity: 0, transform: "scale(.93)" },
        { opacity: 1, transform: "scale(1)" },
      ],
    },
    "draw-arrow": {
      duration: 0.42,
      easing: "ease-out",
      frames: [
        { opacity: 0, width: "0px" },
        { opacity: 1, width: "46px" },
      ],
    },
    "pop": {
      duration: 0.55,
      easing: "cubic-bezier(.18,.89,.32,1.28)",
      frames: [
        { opacity: 0, transform: "scale(.6)" },
        { opacity: 1, transform: "scale(1.06)", offset: 0.7 },
        { opacity: 1, transform: "scale(1)" },
      ],
    },
    "flip-in": {
      duration: 0.7,
      frames: [
        { opacity: 0, transform: "perspective(900px) rotateY(-90deg)" },
        { opacity: 1, transform: "perspective(900px) rotateY(0)" },
      ],
    },
    "underline": {
      duration: 0.55,
      easing: "ease-out",
      frames: [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
    },
    "pulse": {
      duration: 0.7,
      easing: "ease-in-out",
      frames: [
        { transform: "scale(1)" },
        { transform: "scale(1.08)" },
        { transform: "scale(1)" },
      ],
    },
    "shake": {
      duration: 0.5,
      easing: "ease-in-out",
      frames: [
        { transform: "translateX(0)" },
        { transform: "translateX(-8px)" },
        { transform: "translateX(8px)" },
        { transform: "translateX(0)" },
      ],
    },
    stamp: {
      duration: 0.66,
      easing: "cubic-bezier(.18,.89,.32,1.28)",
      frames: [
        { opacity: 0, transform: "scale(1.58) rotate(-17deg)" },
        { opacity: 1, transform: "scale(.97) rotate(-8deg)", offset: 0.72 },
        { opacity: 0.9, transform: "scale(1) rotate(-9deg)" },
      ],
    },
    "stamp-small": {
      duration: 0.6,
      easing: "cubic-bezier(.18,.89,.32,1.28)",
      frames: [
        { opacity: 0, transform: "scale(1.45) rotate(-12deg)" },
        { opacity: 0.85, transform: "scale(1) rotate(-6deg)" },
      ],
    },
  };

  function resolveSpec(el) {
    const type = el.dataset.anim;

    if (type === "draw") {
      if (el.tagName.toLowerCase() === "path" || el.tagName.toLowerCase() === "line") {
        el.setAttribute("pathLength", "1");
        el.style.strokeDasharray = "1";
        el.style.strokeDashoffset = "1";
      }
      return {
        duration: 0.8,
        easing: "ease-out",
        frames: [{ strokeDashoffset: "1" }, { strokeDashoffset: "0" }],
      };
    }

    if (type.startsWith("move-")) {
      const distance = Number(el.dataset.distance || 180);
      const moves = {
        "move-right": [`translateX(-${distance}px)`, "translateX(0)"],
        "move-left": [`translateX(${distance}px)`, "translateX(0)"],
        "move-up": [`translateY(${distance}px)`, "translateY(0)"],
        "move-down": [`translateY(-${distance}px)`, "translateY(0)"],
      };
      if (!moves[type]) return null;
      return {
        duration: 0.75,
        frames: [
          { opacity: 0, transform: moves[type][0] },
          { opacity: 1, transform: moves[type][1] },
        ],
      };
    }

    return specs[type] || null;
  }

  document.querySelectorAll("[data-anim]").forEach((el) => {
    const scene = el.closest(".scene");
    const sceneIndex = scene ? Number(scene.dataset.index) : 0;
    const spec = resolveSpec(el);
    if (!spec) return;
    const delay = Number(el.dataset.delay || 0);
    const duration = Number(el.dataset.duration || spec.duration);
    const anim = el.animate(spec.frames, {
      duration: duration * 1000,
      delay: delay * 1000,
      easing: spec.easing || "cubic-bezier(.22,.61,.36,1)",
      fill: "both",
    });
    anim.pause();
    anim.currentTime = 0;
    animations.push({ anim, sceneIndex });
  });

  document.body.classList.add("anim-ready");

  let currentScene = -1;

  function setScene(index) {
    if (index === currentScene) return;
    scenes.forEach((scene, i) => scene.classList.toggle("active", i === index));
    pageNum.textContent = `${String(index + 1).padStart(2, "0")} / ${String(scenes.length).padStart(2, "0")}`;
    currentScene = index;
  }

  function sceneIndexAt(time) {
    let index = 0;
    for (let i = 0; i < EPISODE.scenes.length; i += 1) {
      if (time >= EPISODE.scenes[i].start) index = i;
    }
    return index;
  }

  function updateCaption(scene, local) {
    if (!scene.cues || scene.cues.length === 0) {
      captionEl.textContent = "";
      return;
    }
    let cue = scene.cues[0];
    for (const item of scene.cues) {
      if (local >= item.start - 0.06) cue = item;
    }
    if (local < scene.cues[0].start - 0.06) cue = scene.cues[0];
    if (captionEl.textContent !== cue.text) captionEl.textContent = cue.text;
  }

  function formatTime(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    const m = Math.floor(whole / 60);
    const s = whole % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function seek(time) {
    const t = Math.max(0, Math.min(time, EPISODE.total));
    const index = sceneIndexAt(t);
    const scene = EPISODE.scenes[index];
    const local = t - scene.start;

    if (index !== currentScene) {
      animations.forEach((item) => {
        if (item.sceneIndex === currentScene) item.anim.currentTime = 0;
      });
      setScene(index);
    }

    animations.forEach((item) => {
      if (item.sceneIndex === index) item.anim.currentTime = Math.max(0, local) * 1000;
    });

    updateCaption(scene, local);
    progressFill.style.width = `${(t / EPISODE.total) * 100}%`;
    if (!isRender) {
      timeLabel.textContent = `${formatTime(t)} / ${formatTime(EPISODE.total)}`;
      seekBar.value = String(Math.round((t / EPISODE.total) * 1000));
    }
  }

  window.__seek = seek;
  window.__episode = EPISODE;
  window.__ready = true;

  document.fonts.ready.then(() => {
    window.__fontsReady = true;
  });

  if (isRender) {
    stage.style.transform = "none";
    stageWrap.style.width = "1920px";
    stageWrap.style.height = "1080px";
    seek(0);
    return;
  }

  // ---------------- player ----------------

  function fit() {
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const maxW = Math.min(vw - 32, 1600);
    const maxH = Math.max(260, vh - 112);
    const scale = Math.min(maxW / 1920, maxH / 1080);
    stage.style.transform = `scale(${scale})`;
    stageWrap.style.width = `${1920 * scale}px`;
    stageWrap.style.height = `${1080 * scale}px`;
    controls.style.width = `${Math.min(1920 * scale, vw - 32)}px`;
  }

  let raf = 0;
  function tick() {
    if (audio.paused) return;
    seek(audio.currentTime);
    raf = requestAnimationFrame(tick);
  }

  function startTicking() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  function togglePlay() {
    if (audio.paused) {
      if (audio.currentTime < 0.05) seek(0);
      audio.play();
    } else {
      audio.pause();
    }
  }

  playBtn.addEventListener("click", togglePlay);

  stageWrap.addEventListener("click", (event) => {
    if (event.target.closest(".controls")) return;
    togglePlay();
  });

  audio.addEventListener("play", () => {
    playBtn.textContent = "❚❚";
    startTicking();
  });

  audio.addEventListener("pause", () => {
    playBtn.textContent = "▶";
    cancelAnimationFrame(raf);
    seek(audio.currentTime);
  });

  audio.addEventListener("ended", () => {
    playBtn.textContent = "▶";
    seek(EPISODE.total);
  });

  audio.addEventListener("loadedmetadata", () => {
    timeLabel.textContent = `00:00 / ${formatTime(EPISODE.total)}`;
  });

  seekBar.addEventListener("input", () => {
    const t = (Number(seekBar.value) / 1000) * EPISODE.total;
    audio.currentTime = t;
    seek(t);
  });

  muteBtn.addEventListener("click", () => {
    audio.muted = !audio.muted;
    muteBtn.textContent = audio.muted ? "取消静音" : "静音";
  });

  fullBtn.addEventListener("click", () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  });

  document.addEventListener("fullscreenchange", () => {
    setTimeout(fit, 60);
  });

  window.addEventListener("resize", fit);

  document.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      togglePlay();
    } else if (event.code === "ArrowLeft") {
      event.preventDefault();
      audio.currentTime = Math.max(0, audio.currentTime - 5);
      seek(audio.currentTime);
    } else if (event.code === "ArrowRight") {
      event.preventDefault();
      audio.currentTime = Math.min(EPISODE.total, audio.currentTime + 5);
      seek(audio.currentTime);
    } else if (event.key === "m" || event.key === "M") {
      muteBtn.click();
    } else if (event.key === "f" || event.key === "F") {
      fullBtn.click();
    }
  });

  fit();
  seek(1.5);
})();
