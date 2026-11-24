/* =========================================================
   KRILLION & ANTI-KRILLION GAME CONTROLLER
   ========================================================= */
(() => {
  const ROUND_SECONDS = 30;
  const RING_CIRCUMFERENCE = 2 * Math.PI * 27; // matches r="27" in index.html

  /* ---------- Text Normalization & Fuzzy Matching ---------- */
  function normalize(str) {
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s+#]/g, " ")
      .replace(/\b(the|a|an)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 1; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return dp[m][n];
  }

  function matchAnswer(rawInput, question) {
    const clean = normalize(rawInput);
    if (!clean) return null;

    const candidates = [];
    for (const ans of question.answers) {
      const forms = [ans.label, ...(ans.aliases || [])].map(normalize);
      // 1. Exact match (or simple singular/plural match)
      for (const f of forms) {
        if (
          clean === f ||
          clean + "s" === f ||
          f + "s" === clean ||
          clean + "es" === f ||
          f + "es" === clean
        ) {
          return ans;
        }
        candidates.push({ ans, form: f });
      }
    }

    // 2. Forgiving typo check (only for words length >= 4)
    if (clean.length >= 4) {
      let best = null;
      let bestDist = Infinity;
      const maxAllowed = clean.length >= 7 ? 2 : 1;
      for (const c of candidates) {
        if (Math.abs(c.form.length - clean.length) > maxAllowed) continue;
        const d = levenshtein(clean, c.form);
        if (d <= maxAllowed && d < bestDist) {
          bestDist = d;
          best = c.ans;
        }
      }
      if (best) return best;
    }

    return null;
  }

  /* ---------- Zone & Tier Labels ---------- */
  function getZone(totalScore, maxPossible, activeMode) {
    const ratio = maxPossible > 0 ? totalScore / maxPossible : 0;
    if (activeMode === "anti") {
      if (ratio >= 0.82) return "Exosphere · Hive Mind";
      if (ratio >= 0.65) return "Stratosphere Peak";
      if (ratio >= 0.45) return "Jet Stream";
      if (ratio >= 0.25) return "Cumulus Breeze";
      return "Launchpad";
    }
    if (ratio >= 0.82) return "Mariana Trench · Abyssal Legend";
    if (ratio >= 0.65) return "Abyssal Zone";
    if (ratio >= 0.45) return "Midnight Zone";
    if (ratio >= 0.25) return "Twilight Zone";
    return "Surface Waters";
  }

  function getTier(points, mode) {
    if (mode === "krillion") {
      if (points >= 90) return { label: "ONE IN A KRILLION!", emoji: "💎" };
      if (points >= 75) return { label: "ABYSSAL DEEP CUT", emoji: "🦑" };
      if (points >= 55) return { label: "TWILIGHT PICK", emoji: "🐙" };
      if (points >= 30) return { label: "REEF DIVER", emoji: "🐠" };
      return { label: "SURFACE PLANKTON", emoji: "🫧" };
    } else {
      if (points >= 90) return { label: "HIVE MIND CERTIFIED!", emoji: "👑" };
      if (points >= 75) return { label: "MAINSTREAM LIFT", emoji: "🚀" };
      if (points >= 55) return { label: "POPULAR PICK", emoji: "🎈" };
      if (points >= 30) return { label: "NICHE DRIFT", emoji: "☁️" };
      return { label: "TOO OBSCURE", emoji: "⚓" };
    }
  }

  function shuffle(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /* ---------- DOM References ---------- */
  const el = {
    body: document.body,
    canvas: document.getElementById("bg-canvas"),
    fpsBadge: document.getElementById("fps-badge"),
    soundBtn: document.getElementById("sound-btn"),
    homeBtn: document.getElementById("home-btn"),
    brandIcon: document.getElementById("brand-icon"),

    screenMenu: document.getElementById("screen-menu"),
    screenPlay: document.getElementById("screen-play"),
    screenSummary: document.getElementById("screen-summary"),

    modeCards: document.querySelectorAll(".mode-card"),
    categorySelect: document.getElementById("category-select"),
    roundsSelect: document.getElementById("rounds-select"),
    startBtn: document.getElementById("start-btn"),
    bestKrillion: document.getElementById("best-krillion"),
    bestAnti: document.getElementById("best-anti"),
    bestFlip: document.getElementById("best-flip"),

    hudModePill: document.getElementById("hud-mode-pill"),
    hudRound: document.getElementById("hud-round"),
    hudAltLabel: document.getElementById("hud-altitude-label"),
    hudAltVal: document.getElementById("hud-altitude-val"),
    hudZone: document.getElementById("hud-zone"),

    timerWrap: document.querySelector(".timer-wrap"),
    timerRing: document.getElementById("timer-ring-progress"),
    timerText: document.getElementById("timer-text"),

    promptCard: document.getElementById("prompt-card"),
    promptCategory: document.getElementById("prompt-category"),
    promptDirective: document.getElementById("prompt-directive"),
    promptText: document.getElementById("prompt-text"),
    promptHintBox: document.getElementById("prompt-hint-box"),
    answerForm: document.getElementById("answer-form"),
    answerInput: document.getElementById("answer-input"),
    hintBtn: document.getElementById("hint-btn"),
    skipBtn: document.getElementById("skip-btn"),

    feedbackPanel: document.getElementById("feedback-panel"),
    feedbackBadge: document.getElementById("feedback-badge"),
    feedbackAnswer: document.getElementById("feedback-answer"),
    feedbackStat: document.getElementById("feedback-stat"),
    feedbackPoints: document.getElementById("feedback-points"),
    catchBars: document.getElementById("catch-bars"),
    nextBtn: document.getElementById("next-btn"),

    summaryMode: document.getElementById("summary-mode"),
    summaryTotal: document.getElementById("summary-total"),
    summaryZone: document.getElementById("summary-zone"),
    summaryBestPick: document.getElementById("summary-best-pick"),
    summaryList: document.getElementById("summary-list"),
    shareBtn: document.getElementById("share-btn"),
    playAgainBtn: document.getElementById("play-again-btn"),
    menuReturnBtn: document.getElementById("menu-return-btn"),
    toast: document.getElementById("toast")
  };

  /* ---------- Initialize Engines ---------- */
  const scene = new window.SceneEngine(el.canvas, el.fpsBadge);
  const sfx = new window.SoundFX();

  /* ---------- State ---------- */
  const STORAGE_KEY = "krillion_records_v1";
  const records = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { krillion: 0, anti: 0, flip: 0 };
    } catch {
      return { krillion: 0, anti: 0, flip: 0 };
    }
  })();

  const state = {
    selectedMode: "krillion",   // "krillion" | "anti" | "flip"
    roundMode: "krillion",      // effective mode for current prompt
    category: "all",
    totalRounds: 7,
    questions: [],
    index: 0,
    totalMeters: 0,             // points * 10
    displayedMeters: 0,
    timeLeft: ROUND_SECONDS,
    lastSecondBeep: ROUND_SECONDS,
    timerRunning: false,
    hintUsed: false,
    history: []
  };

  /* ---------- Populate Categories & Best Scores ---------- */
  const categories = [...new Set(window.QUESTION_BANK.map((q) => q.category))].sort();
  for (const cat of categories) {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    el.categorySelect.appendChild(opt);
  }

  function refreshBestScores() {
    el.bestKrillion.textContent = `${records.krillion.toLocaleString()} m`;
    el.bestAnti.textContent = `${records.anti.toLocaleString()} m`;
    el.bestFlip.textContent = `${records.flip.toLocaleString()} pts`;
  }
  refreshBestScores();

  /* ---------- Theme & Screen Helpers ---------- */
  function applyVisualTheme(mode) {
    const visual = mode === "anti" ? "anti" : "krillion";
    el.body.dataset.theme = visual;
    el.brandIcon.textContent = visual === "anti" ? "🎈" : "🦐";
    scene.setMode(visual);
  }

  function showScreen(target) {
    [el.screenMenu, el.screenPlay, el.screenSummary].forEach((s) => s.classList.remove("active"));
    target.classList.add("active");
  }

  let toastTimer = null;
  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2200);
  }

  /* ---------- Start a Run ---------- */
  function startGame() {
    state.category = el.categorySelect.value;
    state.totalRounds = parseInt(el.roundsSelect.value, 10);

    let pool = window.QUESTION_BANK;
    if (state.category !== "all") {
      pool = pool.filter((q) => q.category === state.category);
    }

    // If category has fewer prompts than selected run length, top up with others
    let picked = shuffle(pool).slice(0, state.totalRounds);
    if (picked.length < state.totalRounds) {
      const others = shuffle(window.QUESTION_BANK.filter((q) => !picked.includes(q)));
      picked = picked.concat(others.slice(0, state.totalRounds - picked.length));
    }

    state.questions = picked;
    state.index = 0;
    state.totalMeters = 0;
    state.displayedMeters = 0;
    state.history = [];

    scene.setProgress(0, 0);
    showScreen(el.screenPlay);
    loadRound();
  }

  /* ---------- Load Current Prompt ---------- */
  function loadRound() {
    const q = state.questions[state.index];

    if (state.selectedMode === "flip") {
      // Alternate with slight unpredictability while guaranteeing both appear
      state.roundMode = state.index === 0
        ? (Math.random() < 0.5 ? "krillion" : "anti")
        : (Math.random() < 0.65 ? (state.roundMode === "krillion" ? "anti" : "krillion") : state.roundMode);
      sfx.playModeFlip(state.roundMode);
    } else {
      state.roundMode = state.selectedMode;
    }

    applyVisualTheme(state.roundMode);

    // Update HUD
    const isAnti = state.roundMode === "anti";
    el.hudModePill.textContent = isAnti
      ? "🎈 ANTI-KRILLION · MOST COMMON WINS"
      : "🌊 KRILLION · RAREST WINS";
    el.hudRound.textContent = `Prompt ${state.index + 1} / ${state.questions.length}`;
    el.hudAltLabel.textContent = state.selectedMode === "flip"
      ? "SCORE"
      : isAnti ? "ALTITUDE" : "DEPTH";

    const maxSoFar = state.questions.length * 1000;
    el.hudZone.textContent = getZone(state.totalMeters, maxSoFar, state.roundMode);

    // Update Prompt Card
    el.promptCategory.textContent = q.category;
    el.promptDirective.textContent = isAnti
      ? "Think like the crowd — pick the #1 most obvious answer!"
      : "Think off the beaten path — find a valid obscure gem!";
    el.promptText.textContent = q.prompt;

    state.hintUsed = false;
    el.promptHintBox.classList.add("hidden");
    el.promptHintBox.textContent = "";
    el.hintBtn.disabled = false;

    el.feedbackPanel.classList.add("hidden");
    el.promptCard.classList.remove("hidden", "flip-flash");
    void el.promptCard.offsetWidth; // restart animation
    el.promptCard.classList.add("flip-flash");

    el.answerInput.value = "";
    el.answerInput.disabled = false;
    setTimeout(() => el.answerInput.focus(), 60);

    // Reset Timer
    state.timeLeft = ROUND_SECONDS;
    state.lastSecondBeep = ROUND_SECONDS;
    state.timerRunning = true;
    el.timerWrap.classList.remove("pulse");
    el.timerRing.classList.remove("urgent");
    updateTimerVisuals();
  }

  /* ---------- 60 FPS Synced Timer & Score Counter ---------- */
  function updateTimerVisuals() {
    const frac = Math.max(0, state.timeLeft / ROUND_SECONDS);
    el.timerRing.style.strokeDashoffset = (RING_CIRCUMFERENCE * (1 - frac)).toFixed(2);
    el.timerText.textContent = Math.ceil(state.timeLeft);
  }

  scene.onTick((dt) => {
    // Smoothly roll HUD meter counter at 60 FPS
    if (Math.abs(state.displayedMeters - state.totalMeters) > 0.5) {
      state.displayedMeters += (state.totalMeters - state.displayedMeters) * Math.min(1, dt * 8);
      const val = Math.round(state.displayedMeters).toLocaleString();
      const unit = state.selectedMode === "flip" ? " pts" : " m";
      el.hudAltVal.textContent = `${val}${unit}`;
    } else if (state.displayedMeters !== state.totalMeters) {
      state.displayedMeters = state.totalMeters;
      const unit = state.selectedMode === "flip" ? " pts" : " m";
      el.hudAltVal.textContent = `${state.totalMeters.toLocaleString()}${unit}`;
    }

    // Countdown timer
    if (!state.timerRunning) return;
    state.timeLeft -= dt;

    const whole = Math.ceil(state.timeLeft);
    if (whole <= 5 && whole > 0 && whole < state.lastSecondBeep) {
      state.lastSecondBeep = whole;
      el.timerRing.classList.add("urgent");
      el.timerWrap.classList.add("pulse");
      sfx.playTick(true);
    }

    if (state.timeLeft <= 0) {
      state.timeLeft = 0;
      state.timerRunning = false;
      updateTimerVisuals();
      resolveRound(null, "Time's Up!");
      return;
    }

    updateTimerVisuals();
  });

  /* ---------- Handle Answer Submission / Hint / Skip ---------- */
  el.answerForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!state.timerRunning) return;
    const raw = el.answerInput.value.trim();
    if (!raw) {
      el.promptCard.classList.remove("shake");
      void el.promptCard.offsetWidth;
      el.promptCard.classList.add("shake");
      return;
    }

    const q = state.questions[state.index];
    const matched = matchAnswer(raw, q);
    state.timerRunning = false;
    resolveRound(matched, raw);
  });

  el.hintBtn.addEventListener("click", () => {
    if (!state.timerRunning || state.hintUsed) return;
    state.hintUsed = true;
    el.hintBtn.disabled = true;

    const q = state.questions[state.index];
    const sorted = q.answers.slice().sort((a, b) => b.pop - a.pop);
    // Pick a strong target-tier answer to hint at
    const target = state.roundMode === "anti"
      ? sorted[Math.floor(Math.random() * Math.min(3, sorted.length))]
      : sorted[sorted.length - 1 - Math.floor(Math.random() * Math.min(6, sorted.length))];

    const firstChar = target.label[0].toUpperCase();
    const len = target.label.replace(/\s+/g, "").length;
    el.promptHintBox.textContent = state.roundMode === "anti"
      ? `💡 Crowd Hint: A top answer starts with "${firstChar}" (${len} letters).`
      : `💡 Deep-Cut Hint: A rare gem starts with "${firstChar}" (${len} letters).`;
    el.promptHintBox.classList.remove("hidden");
    el.answerInput.focus();
  });

  el.skipBtn.addEventListener("click", () => {
    if (!state.timerRunning) return;
    state.timerRunning = false;
    resolveRound(null, "Skipped");
  });

  /* ---------- Resolve Round & Show "The Catch" ---------- */
  function resolveRound(matched, rawInput) {
    const q = state.questions[state.index];
    const mode = state.roundMode;
    el.timerWrap.classList.remove("pulse");

    let basePoints = 0;
    let earnedMeters = 0;
    let tier = { label: "NO ECHOES", emoji: "❌" };

    if (matched) {
      basePoints = mode === "krillion" ? (100 - matched.pop) : matched.pop;
      if (state.hintUsed) basePoints = Math.max(1, Math.round(basePoints * 0.85));
      earnedMeters = basePoints * 10;
      tier = getTier(basePoints, mode);

      state.totalMeters += earnedMeters;
      const maxRun = state.questions.length * 1000;
      scene.setProgress(state.totalMeters / maxRun, 220 + basePoints * 3.8);
      scene.spawnBurst(basePoints / 100, false);
      sfx.playSuccess(basePoints / 100, mode);
    } else {
      scene.spawnBurst(0.4, true);
      sfx.playMiss();
    }

    // Record history
    state.history.push({
      prompt: q.prompt,
      mode,
      answer: matched ? matched.label : rawInput,
      valid: Boolean(matched),
      pop: matched ? matched.pop : null,
      points: basePoints,
      meters: earnedMeters,
      tier
    });

    // Update Zone HUD
    const maxRun = state.questions.length * 1000;
    el.hudZone.textContent = getZone(state.totalMeters, maxRun, mode);

    // Populate Feedback Panel
    el.promptCard.classList.add("hidden");
    el.feedbackPanel.classList.remove("hidden");

    const unit = state.selectedMode === "flip" ? "pts" : "m";
    el.feedbackBadge.textContent = `${tier.emoji} ${tier.label}`;
    el.feedbackBadge.classList.toggle("miss", !matched);

    if (matched) {
      el.feedbackAnswer.textContent = matched.label;
      el.feedbackStat.textContent = mode === "krillion"
        ? `Only ${matched.pop}% of players picked this${state.hintUsed ? " (hint -15%)" : ""}.`
        : `${matched.pop}% of the crowd agreed with you${state.hintUsed ? " (hint -15%)" : ""}!`;
      el.feedbackPoints.textContent = `+${earnedMeters.toLocaleString()} ${unit}`;
    } else {
      el.feedbackAnswer.textContent = rawInput === "Time's Up!" || rawInput === "Skipped"
        ? rawInput
        : `"${rawInput}" wasn't in the bank`;
      el.feedbackStat.textContent = "Zero depth gained on this prompt — check out the crowd picks below.";
      el.feedbackPoints.textContent = `+0 ${unit}`;
    }

    renderCatchBars(q, matched);

    el.nextBtn.textContent = state.index === state.questions.length - 1
      ? "View Final Results →"
      : "Next Prompt →";
    el.nextBtn.focus();
  }

  function renderCatchBars(question, matched) {
    const sorted = question.answers.slice().sort((a, b) => b.pop - a.pop);
    // Show Top 3 most common + Bottom 2 rarest gems (+ user's pick if outside those)
    const display = [
      ...sorted.slice(0, 3),
      ...sorted.slice(-2)
    ];

    if (matched && !display.some((d) => d.label === matched.label)) {
      display.splice(3, 0, matched);
    }

    // Remove duplicates & sort descending by popularity
    const unique = [...new Map(display.map((d) => [d.label, d])).values()]
      .sort((a, b) => b.pop - a.pop);

    el.catchBars.innerHTML = "";
    unique.forEach((item) => {
      const isUser = matched && item.label === matched.label;
      const isGem = item.pop <= 10;

      const row = document.createElement("div");
      row.className = `catch-row${isUser ? " is-user" : ""}${isGem && !isUser ? " is-gem" : ""}`;
      row.innerHTML = `
        <span class="catch-name" title="${item.label}">${isUser ? "★ " : isGem ? "💎 " : ""}${item.label}</span>
        <div class="catch-track"><div class="catch-fill" data-w="${Math.max(4, item.pop)}%"></div></div>
        <span class="catch-pct">${item.pop}%</span>
      `;
      el.catchBars.appendChild(row);
    });

    // Trigger GPU-smooth width transitions on next animation frame
    requestAnimationFrame(() => {
      el.catchBars.querySelectorAll(".catch-fill").forEach((bar) => {
        bar.style.width = bar.dataset.w;
      });
    });
  }

  /* ---------- Next Prompt or Summary ---------- */
  el.nextBtn.addEventListener("click", () => {
    state.index++;
    if (state.index >= state.questions.length) {
      finishRun();
    } else {
      loadRound();
    }
  });

  function finishRun() {
    const modeKey = state.selectedMode;
    const isNewBest = state.totalMeters > (records[modeKey] || 0);
    if (isNewBest) {
      records[modeKey] = state.totalMeters;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); } catch {}
      refreshBestScores();
    }

    const unit = modeKey === "flip" ? "pts" : "m";
    const maxRun = state.questions.length * 1000;
    const modeTitle = modeKey === "anti"
      ? "🎈 ANTI-KRILLION ASCENT COMPLETE"
      : modeKey === "flip"
        ? "⚡ FLIP-FLOP CHAOS COMPLETE"
        : "🌊 KRILLION DIVE COMPLETE";

    el.summaryMode.textContent = isNewBest ? `${modeTitle} · NEW RECORD!` : modeTitle;
    el.summaryTotal.textContent = `${state.totalMeters.toLocaleString()} ${unit}`;
    el.summaryZone.textContent = modeKey === "flip"
      ? `Accuracy: ${state.history.filter((h) => h.valid).length} / ${state.history.length} prompts`
      : getZone(state.totalMeters, maxRun, modeKey);

    const bestPick = state.history.reduce((best, item) =>
      item.meters > (best ? best.meters : -1) ? item : best, null
    );
    el.summaryBestPick.textContent = bestPick && bestPick.valid
      ? `Best Pick: "${bestPick.answer}" (${bestPick.tier.emoji} +${bestPick.meters.toLocaleString()} ${unit})`
      : "Rough waters—dive back in and beat the crowd!";

    el.summaryList.innerHTML = "";
    state.history.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "summary-item";
      const tag = state.selectedMode === "flip" ? (item.mode === "anti" ? "🎈 " : "🌊 ") : "";
      row.innerHTML = `
        <div class="summary-item-left">
          <span class="summary-q">${idx + 1}. ${tag}${item.prompt}</span>
          <span class="summary-a">${item.tier.emoji} ${item.answer}${item.pop !== null ? ` (${item.pop}% crowd)` : ""}</span>
        </div>
        <span class="summary-pts${item.meters === 0 ? " zero" : ""}">+${item.meters.toLocaleString()} ${unit}</span>
      `;
      el.summaryList.appendChild(row);
    });

    scene.spawnBurst(1.1, false);
    showScreen(el.screenSummary);
  }

  /* ---------- Shareable Spoiler-Free Scorecard ---------- */
  el.shareBtn.addEventListener("click", async () => {
    const unit = state.selectedMode === "flip" ? "pts" : "m";
    const title = state.selectedMode === "anti"
      ? "🎈 Anti-Krillion"
      : state.selectedMode === "flip"
        ? "⚡ Krillion Flip-Flop"
        : "🌊 Krillion";

    const bar = state.history.map((h) => {
      if (!h.valid) return "🟥";
      if (h.points >= 85) return "💎";
      if (h.points >= 65) return "🟦";
      if (h.points >= 40) return "🟩";
      return "🟨";
    }).join("");

    const text = `${title} · ${state.totalMeters.toLocaleString()} ${unit}\n${bar}\n${el.summaryZone.textContent}`;
    try {
      await navigator.clipboard.writeText(text);
      showToast("Scorecard copied to clipboard!");
    } catch {
      showToast("Couldn't access clipboard—copy manually.");
    }
  });

  /* ---------- Menu & Control Bindings ---------- */
  el.modeCards.forEach((card) => {
    card.addEventListener("click", () => {
      el.modeCards.forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      state.selectedMode = card.dataset.mode;

      const labels = {
        krillion: "Start Dive",
        anti: "Launch Ascent",
        flip: "Enter Chaos"
      };
      el.startBtn.innerHTML = `${labels[state.selectedMode]} <span class="btn-arrow">→</span>`;
      applyVisualTheme(state.selectedMode === "anti" ? "anti" : "krillion");
    });
  });

  el.startBtn.addEventListener("click", startGame);
  el.playAgainBtn.addEventListener("click", startGame);

  function returnToMenu() {
    state.timerRunning = false;
    scene.setProgress(0, 0);
    applyVisualTheme(state.selectedMode === "anti" ? "anti" : "krillion");
    showScreen(el.screenMenu);
  }

  el.homeBtn.addEventListener("click", returnToMenu);
  el.menuReturnBtn.addEventListener("click", returnToMenu);

  el.soundBtn.addEventListener("click", () => {
    sfx.muted = !sfx.muted;
    el.soundBtn.textContent = sfx.muted ? "🔇" : "🔊";
    showToast(sfx.muted ? "Sound muted" : "Sound enabled");
  });

  // Allow Enter key on feedback screen to advance rapidly
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !el.feedbackPanel.classList.contains("hidden") && el.screenPlay.classList.contains("active")) {
      if (document.activeElement !== el.nextBtn) {
        e.preventDefault();
        el.nextBtn.click();
      }
    }
  });
})();
