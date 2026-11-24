/* =========================================================
   60 FPS CANVAS SCENE ENGINE + WEB AUDIO SYNTHESIZER
   ========================================================= */
(() => {
  /* ---------- Color Interpolation Helpers ---------- */
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function lerpColor(c1, c2, t) {
    return [
      Math.round(lerp(c1[0], c2[0], t)),
      Math.round(lerp(c1[1], c2[1], t)),
      Math.round(lerp(c1[2], c2[2], t))
    ];
  }

  function sampleStops(stops, t) {
    const clamped = clamp(t, 0, 1);
    const scaled = clamped * (stops.length - 1);
    const idx = Math.min(Math.floor(scaled), stops.length - 2);
    const localT = scaled - idx;
    return lerpColor(stops[idx], stops[idx + 1], localT);
  }

  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  /* Ocean depth palettes (Surface -> Mariana Trench) */
  const OCEAN_TOP = [
    [14, 116, 168],
    [10, 62, 112],
    [6, 28, 66],
    [3, 12, 34],
    [2, 5, 16]
  ];
  const OCEAN_BOT = [
    [8, 68, 114],
    [5, 34, 74],
    [3, 15, 42],
    [2, 7, 22],
    [0, 2, 8]
  ];

  /* Sky altitude palettes (Launchpad -> Exosphere) */
  const SKY_TOP = [
    [37, 134, 218],
    [29, 92, 186],
    [54, 52, 148],
    [24, 22, 76],
    [6, 8, 24]
  ];
  const SKY_BOT = [
    [108, 192, 240],
    [76, 146, 214],
    [164, 96, 156],
    [64, 46, 118],
    [18, 20, 56]
  ];

  /* ---------- Web Audio Procedural Sound Engine ---------- */
  class SoundFX {
    constructor() {
      this.ctx = null;
      this.muted = false;
    }

    ensure() {
      if (this.muted) return null;
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
      return this.ctx;
    }

    tone(freq, duration = 0.14, type = "sine", gainVal = 0.1, freqEnd = null) {
      const ctx = this.ensure();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (freqEnd !== null) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);
      }
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(gainVal, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    }

    playSuccess(scoreRatio, mode) {
      const base = mode === "krillion" ? 310 : 420;
      const notes = scoreRatio >= 0.8
        ? [base, base * 1.25, base * 1.5, base * 2]
        : scoreRatio >= 0.45
          ? [base, base * 1.25, base * 1.5]
          : [base, base * 1.15];

      notes.forEach((n, i) => {
        setTimeout(() => this.tone(n, 0.24, mode === "krillion" ? "sine" : "triangle", 0.11), i * 70);
      });
    }

    playMiss() {
      this.tone(210, 0.24, "sawtooth", 0.06, 115);
    }

    playTick(urgent = false) {
      this.tone(urgent ? 880 : 600, 0.055, "sine", urgent ? 0.07 : 0.035);
    }

    playModeFlip(toMode) {
      if (toMode === "krillion") {
        this.tone(520, 0.22, "sine", 0.08, 220);
      } else {
        this.tone(260, 0.22, "triangle", 0.08, 620);
      }
    }
  }

  /* ---------- 60 FPS Canvas 2D Scene Engine ---------- */
  class SceneEngine {
    constructor(canvas, fpsBadgeEl) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d", { alpha: false });
      this.fpsEl = fpsBadgeEl;

      this.width = window.innerWidth;
      this.height = window.innerHeight;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);

      // Visual state (interpolates smoothly every frame)
      this.mode = "krillion";        // "krillion" | "anti"
      this.modeBlend = 0;            // 0 = Ocean, 1 = Sky
      this.targetBlend = 0;

      this.progress = 0;             // 0..1 depth or altitude
      this.targetProgress = 0;
      this.travelImpulse = 0;        // temporary vertical rush speed

      // Avatar spring physics
      this.avatarY = 0.5;
      this.avatarVel = 0;
      this.time = 0;

      // Ambient particles + bursts
      this.ambient = [];
      this.clouds = [];
      this.stars = [];
      this.bursts = [];
      this.ripples = [];

      // Frame timing
      this.lastTime = performance.now();
      this.fpsFrames = 0;
      this.fpsTimer = 0;
      this.tickCallback = null;

      this.resize();
      this.initPools();
      window.addEventListener("resize", () => this.resize());
      requestAnimationFrame((t) => this.loop(t));
    }

    resize() {
      this.width = window.innerWidth;
      this.height = window.innerHeight;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.floor(this.width * this.dpr);
      this.canvas.height = Math.floor(this.height * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    initPools() {
      this.ambient = Array.from({ length: 85 }, () => ({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        r: 1.2 + Math.random() * 4.2,
        speed: 14 + Math.random() * 42,
        phase: Math.random() * Math.PI * 2,
        layer: 0.35 + Math.random() * 0.65
      }));

      this.clouds = Array.from({ length: 12 }, () => ({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        w: 110 + Math.random() * 190,
        h: 34 + Math.random() * 48,
        speed: 8 + Math.random() * 18,
        alpha: 0.08 + Math.random() * 0.12
      }));

      this.stars = Array.from({ length: 70 }, () => ({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        r: 0.8 + Math.random() * 1.9,
        twinkle: Math.random() * Math.PI * 2
      }));
    }

    setMode(mode) {
      this.mode = mode === "anti" ? "anti" : "krillion";
      this.targetBlend = this.mode === "anti" ? 1 : 0;
    }

    setProgress(norm, impulse = 0) {
      this.targetProgress = clamp(norm, 0, 1);
      if (impulse > 0) {
        this.travelImpulse = Math.min(this.travelImpulse + impulse, 650);
      }
    }

    spawnBurst(intensity = 1, isMiss = false) {
      const cx = this.width * 0.5;
      const cy = this.height * 0.46;
      const count = isMiss ? 14 : Math.round(24 + intensity * 34);
      const colors = isMiss
        ? ["#fb7185", "#fda4af", "#f43f5e"]
        : this.mode === "krillion"
          ? ["#22d3ee", "#38bdf8", "#a78bfa", "#34d399", "#e0f2fe"]
          : ["#fbbf24", "#fb923c", "#fde047", "#f472b6", "#fffbeb"];

      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
        const speed = (90 + Math.random() * 270) * (0.65 + intensity * 0.65);
        this.bursts.push({
          x: cx + (Math.random() - 0.5) * 60,
          y: cy + (Math.random() - 0.5) * 30,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - (this.mode === "anti" ? 45 : -25),
          r: 2.5 + Math.random() * 4.5,
          life: 1,
          decay: 0.75 + Math.random() * 0.65,
          color: colors[i % colors.length]
        });
      }

      if (!isMiss) {
        this.ripples.push({
          x: cx,
          y: cy,
          r: 24,
          maxR: 180 + intensity * 180,
          alpha: 0.55,
          color: colors[0]
        });
      }

      // Cap bursts to preserve locked 60 FPS
      if (this.bursts.length > 140) {
        this.bursts.splice(0, this.bursts.length - 140);
      }
    }

    onTick(fn) {
      this.tickCallback = fn;
    }

    loop(now) {
      const dt = Math.min((now - this.lastTime) / 1000, 0.05);
      this.lastTime = now;
      this.time += dt;

      // Measure FPS every 400ms
      this.fpsFrames++;
      this.fpsTimer += dt;
      if (this.fpsTimer >= 0.4) {
        const fps = Math.round(this.fpsFrames / this.fpsTimer);
        if (this.fpsEl) this.fpsEl.textContent = `${fps} FPS`;
        this.fpsFrames = 0;
        this.fpsTimer = 0;
      }

      // Smoothly blend environment
      this.modeBlend = lerp(this.modeBlend, this.targetBlend, 1 - Math.exp(-4.5 * dt));
      this.progress = lerp(this.progress, this.targetProgress, 1 - Math.exp(-3.2 * dt));
      this.travelImpulse *= Math.exp(-2.8 * dt);

      // Spring avatar position
      const desiredY = this.mode === "krillion"
        ? 0.24 + this.progress * 0.54
        : 0.78 - this.progress * 0.56;
      const force = (desiredY - this.avatarY) * 28;
      this.avatarVel = (this.avatarVel + force * dt) * Math.exp(-5.5 * dt);
      this.avatarY += this.avatarVel * dt;

      if (this.tickCallback) this.tickCallback(dt);
      this.render(dt);

      requestAnimationFrame((t) => this.loop(t));
    }

    render(dt) {
      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;

      // 1. Blended Background Gradient
      const oTop = sampleStops(OCEAN_TOP, this.progress);
      const oBot = sampleStops(OCEAN_BOT, this.progress);
      const sTop = sampleStops(SKY_TOP, this.progress);
      const sBot = sampleStops(SKY_BOT, this.progress);

      const topColor = lerpColor(oTop, sTop, this.modeBlend);
      const botColor = lerpColor(oBot, sBot, this.modeBlend);

      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, rgb(topColor));
      grad.addColorStop(1, rgb(botColor));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // 2. Ocean God Rays (fade out as you dive deep or switch to sky)
      const oceanVis = 1 - this.modeBlend;
      if (oceanVis > 0.02 && this.progress < 0.75) {
        const rayAlpha = oceanVis * (1 - this.progress / 0.75) * 0.11;
        ctx.save();
        for (let i = 0; i < 5; i++) {
          const rx = w * (0.14 + i * 0.19) + Math.sin(this.time * 0.4 + i) * 36;
          const rayW = 70 + (i % 3) * 45;
          const rGrad = ctx.createLinearGradient(rx, 0, rx + 110, h * 0.85);
          rGrad.addColorStop(0, `rgba(125, 211, 252, ${rayAlpha})`);
          rGrad.addColorStop(1, "rgba(125, 211, 252, 0)");
          ctx.fillStyle = rGrad;
          ctx.beginPath();
          ctx.moveTo(rx - rayW * 0.4, 0);
          ctx.lineTo(rx + rayW * 0.4, 0);
          ctx.lineTo(rx + rayW * 1.4, h * 0.88);
          ctx.lineTo(rx - rayW * 0.2, h * 0.88);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

      // 3. Sky Clouds (fade out in stratosphere) & High-Altitude Stars
      const skyVis = this.modeBlend;
      if (skyVis > 0.02) {
        // Stars appear above 35% altitude
        const starAlphaBase = skyVis * clamp((this.progress - 0.28) / 0.55, 0, 1);
        if (starAlphaBase > 0.01) {
          for (const s of this.stars) {
            const tw = 0.45 + 0.55 * Math.sin(this.time * 2.4 + s.twinkle);
            ctx.fillStyle = `rgba(255, 250, 230, ${starAlphaBase * tw})`;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Parallax Clouds
        const cloudVis = skyVis * clamp(1 - this.progress * 1.15, 0.08, 1);
        for (const c of this.clouds) {
          c.x += c.speed * dt;
          c.y += this.travelImpulse * 0.45 * dt;
          if (c.x - c.w > w) c.x = -c.w;
          if (c.y - c.h > h) {
            c.y = -c.h;
            c.x = Math.random() * w;
          }
          ctx.fillStyle = `rgba(255, 255, 255, ${c.alpha * cloudVis})`;
          ctx.beginPath();
          ctx.ellipse(c.x, c.y, c.w * 0.5, c.h * 0.5, 0, 0, Math.PI * 2);
          ctx.ellipse(c.x - c.w * 0.24, c.y + 6, c.w * 0.32, c.h * 0.38, 0, 0, Math.PI * 2);
          ctx.ellipse(c.x + c.w * 0.24, c.y + 8, c.w * 0.28, c.h * 0.36, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 4. Ambient Bubbles (Ocean) / Wind Motes (Sky)
      const dirSign = this.mode === "krillion" ? -1 : 1; // bubbles rise as you dive; air streams down as you climb
      for (const p of this.ambient) {
        const rush = this.travelImpulse * p.layer;
        p.y += dirSign * (p.speed * p.layer + rush) * dt;
        p.x += Math.sin(this.time * 1.4 + p.phase) * 14 * dt;

        if (p.y < -20) {
          p.y = h + 20;
          p.x = Math.random() * w;
        } else if (p.y > h + 20) {
          p.y = -20;
          p.x = Math.random() * w;
        }

        if (this.modeBlend < 0.5) {
          // Ocean: hollow bubbles near surface, glowing bioluminescent plankton in deep sea
          const bio = clamp(this.progress * 1.25, 0, 1);
          if (bio > 0.35 && p.r < 3) {
            ctx.fillStyle = `rgba(56, 239, 255, ${0.22 + bio * 0.45})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.strokeStyle = `rgba(186, 230, 253, ${0.26 * p.layer})`;
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else {
          // Sky: crisp updraft wind streaks
          const streakLen = 6 + (this.travelImpulse * 0.06) * p.layer;
          ctx.strokeStyle = `rgba(255, 251, 235, ${0.18 * p.layer})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x, p.y + streakLen);
          ctx.stroke();
        }
      }

      // 5. Side Depth / Altitude Indicator Avatar (Submarine / Hot Air Balloon)
      this.drawAvatar(ctx, w, h);

      // 6. Shockwave Ripples
      for (let i = this.ripples.length - 1; i >= 0; i--) {
        const rp = this.ripples[i];
        rp.r += 340 * dt;
        rp.alpha -= 0.9 * dt;
        if (rp.alpha <= 0 || rp.r >= rp.maxR) {
          this.ripples.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.globalAlpha = Math.max(0, rp.alpha);
        ctx.strokeStyle = rp.color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // 7. Celebration / Feedback Burst Particles
      for (let i = this.bursts.length - 1; i >= 0; i--) {
        const b = this.bursts[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.vx *= Math.exp(-2.2 * dt);
        b.vy += (this.mode === "krillion" ? -60 : 180) * dt;
        b.life -= b.decay * dt;
        if (b.life <= 0) {
          this.bursts.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.globalAlpha = clamp(b.life, 0, 1);
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * (0.4 + 0.6 * b.life), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    drawAvatar(ctx, w, h) {
      if (w < 960) return; // Keep mobile screens uncluttered
      const x = w - 64;
      const y = this.avatarY * h + Math.sin(this.time * 2.2) * 7;

      // Vertical track line
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(x, 100);
      ctx.lineTo(x, h - 90);
      ctx.stroke();
      ctx.setLineDash([]);

      if (this.modeBlend < 0.5) {
        // Bioluminescent Deep-Sea Sub
        ctx.fillStyle = "#22d3ee";
        ctx.beginPath();
        ctx.ellipse(x, y, 18, 11, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#082f49";
        ctx.beginPath();
        ctx.arc(x - 5, y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        // Headlight beam
        const beam = ctx.createLinearGradient(x - 18, y, x - 95, y);
        beam.addColorStop(0, "rgba(186, 230, 253, 0.35)");
        beam.addColorStop(1, "rgba(186, 230, 253, 0)");
        ctx.fillStyle = beam;
        ctx.beginPath();
        ctx.moveTo(x - 18, y - 4);
        ctx.lineTo(x - 95, y - 24);
        ctx.lineTo(x - 95, y + 24);
        ctx.lineTo(x - 18, y + 4);
        ctx.closePath();
        ctx.fill();
      } else {
        // Ascending Hot-Air Balloon
        ctx.fillStyle = "#fbbf24";
        ctx.beginPath();
        ctx.arc(x, y - 6, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#f97316";
        ctx.beginPath();
        ctx.ellipse(x, y - 6, 6, 15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x - 5, y + 8);
        ctx.lineTo(x - 3, y + 16);
        ctx.moveTo(x + 5, y + 8);
        ctx.lineTo(x + 3, y + 16);
        ctx.stroke();
        ctx.fillStyle = "#92400e";
        ctx.fillRect(x - 5, y + 16, 10, 7);
      }
      ctx.restore();
    }
  }

  window.SoundFX = SoundFX;
  window.SceneEngine = SceneEngine;
})();
