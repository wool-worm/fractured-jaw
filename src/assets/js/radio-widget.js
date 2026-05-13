// Pirate-radio tuner widget. Renders a small dial inside
// <canvas id="radio-widget-dial">. The widget appears bottom-right on
// every page (mirroring the graph widget's top-right slot).
//
// Phase A: UI only.
// Phase B: Web Audio engines for dead_air (pink noise), carrier_wave
//   (tone + optional hum, LFO-gated), pirate_signal (3-voice detuned
//   drone). Audio is gated behind the power toggle to satisfy browser
//   autoplay policy.
// Phase C (this file, now): speechSynthesis voices for numbers (RNG
//   digit groups), lock (A1Z26 cipher of /radio-cipher.json, one offset
//   per channel), and compromised (termination loop with per-channel
//   violation codes / authorities and occasional stutter glitches).
//
// Bands and frequencies are made-up. Each band has 64 channels labelled
// 0x00..0x3F. Signal type and audio parameters are both deterministic —
// hash(band, index) seeds everything — so the same dial position always
// sounds the same.

(function () {
  if (typeof document === "undefined") return;

  var shell = document.getElementById("radio-widget");
  if (!shell) return;
  var canvas = document.getElementById("radio-widget-dial");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");

  var bandEl = document.getElementById("radio-widget-band");
  var freqEl = document.getElementById("radio-widget-freq");
  var statusEl = document.getElementById("radio-widget-status");
  var powerBtn = document.getElementById("radio-widget-power");
  var trawlBtn = document.getElementById("radio-widget-trawl");
  var foldBtn = document.getElementById("radio-widget-fold");

  var BANDS = ["ALPHA", "BETA", "GAMMA", "DELTA"];
  // 64 channels per band — sparse enough that each tick is a real, aimable
  // slot on a ~320px dial (~5px each) rather than a sub-pixel smear.
  // Channels are labelled 0x00..0x3F.
  var STEPS = 64;

  // Signal-type distribution. Most of the dial is static; a small fraction
  // carries content. Audio behavior is keyed off these in Phase B/C.
  //   dead_air      — pure noise (the silent majority of the band)
  //   carrier_wave  — steady tone / pulse / hum, no content (Phase B)
  //   pirate_signal — synthesized ambient music; CC0 audio files later (Phase B)
  //   numbers       — RNG-driven numbers-station voice (Phase C)
  //   lock          — A1Z26 cipher from radio-source.md (Phase C)
  //   compromised   — termination-loop "this station has been terminated" (Phase C)
  var SIGNAL_TYPES = [
    { name: "dead_air",      weight: 63 },
    { name: "carrier_wave",  weight: 15 },
    { name: "pirate_signal", weight:  3 },
    { name: "numbers",       weight:  9 },
    { name: "lock",          weight:  5 },
    { name: "compromised",   weight:  5 },
    // Fractured Jaw Radio: placed by fixed coordinate (not hash roll),
    // so weight is 0. The FJR_BAND/FJR_INDEX constants below decide the
    // single channel it occupies. The override is inside signalAt().
    { name: "fractured_jaw", weight:  0 },
  ];

  // ── Fractured Jaw Radio location ────────────────────────────────────────
  // The dedicated FJR station lives at a fixed coordinate on the dial.
  // References in the ticker and .site-nav::after derive from these
  // constants. To relocate FJR, change the two values here — everywhere
  // else (ticker entry, nav station-ID, signal-type override, audio engine
  // dispatch) updates automatically. The CSS fallback strings in cult.css
  // hardcode the same coordinate for no-JS readers; update those if you
  // want them to match a new location.
  var FJR_BAND = "GAMMA";
  var FJR_INDEX = 0x14;

  // State.
  var powered = false;
  var currentBand = "ALPHA";
  var currentIndex = 0;
  var trawling = false;
  var trawlTimer = null;
  var folded = false;

  // Trawl pacing. Steps quickly through static, pauses longer on any
  // channel with actual content so the user can hear what they've found.
  var TRAWL_STEP_MS = 350;
  var TRAWL_PAUSE_MS = 3000;

  // ── Helpers ─────────────────────────────────────────────────────────────

  // FNV-1a 32-bit. Deterministic, fast, no dependencies. Used to decide
  // each frequency's signal type without storing a 1024-entry table.
  function hash(str) {
    var h = 0x811c9dc5 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h;
  }

  function signalAt(band, index) {
    // FJR is pinned to one fixed coordinate, regardless of the random
    // weight distribution. Whatever signal the hash roll would have
    // chosen for this channel gets replaced.
    if (band === FJR_BAND && index === FJR_INDEX) return "fractured_jaw";
    var roll = hash(band + ":" + index) % 100;
    var acc = 0;
    for (var i = 0; i < SIGNAL_TYPES.length; i++) {
      acc += SIGNAL_TYPES[i].weight;
      if (roll < acc) return SIGNAL_TYPES[i].name;
    }
    return "dead_air";
  }

  function freqLabel(index) {
    // 2-char hex, zero-padded. 64 channels → 0x00..0x3F.
    var hex = index.toString(16).toUpperCase();
    if (hex.length < 2) hex = "0" + hex;
    return "0x" + hex;
  }

  function statusFor(index) {
    if (!powered) return "offline";
    return signalAt(currentBand, index);
  }

  // ── Canvas drawing ──────────────────────────────────────────────────────

  function resize() {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    // Baseline rail across the middle of the dial.
    var midY = Math.floor(h / 2);
    ctx.strokeStyle = "#3d3322"; // --brass-faint
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    // Tick marks. Render every frequency in the band as a short vertical line
    // whose height + color encode its signal type. This is the "spectrum
    // analyzer" feel — most of the dial is short brass-faint static, with
    // taller bone-dim/sodium marks where signals live.
    var tickW = w / STEPS;
    for (var i = 0; i < STEPS; i++) {
      var x = Math.floor(i * tickW);
      var sig = powered ? signalAt(currentBand, i) : "offline";
      var tickHeight;
      var color;
      switch (sig) {
        case "carrier_wave":
          tickHeight = 8;
          color = "#8a857c"; // --bone-dim — alive but no content
          break;
        case "pirate_signal":
          tickHeight = 14;
          color = "#2a9d80"; // --verdigris-bright — illicit broadcast
          break;
        case "numbers":
          tickHeight = 12;
          color = "#c9a961"; // --brass — number-station voice
          break;
        case "lock":
          tickHeight = 14;
          color = "#ffaa33"; // --sodium — cipher channel
          break;
        case "compromised":
          tickHeight = 14;
          color = "#c62828"; // --blood-bright — authority jamming
          break;
        case "fractured_jaw":
          tickHeight = 16; // tallest — flagship station
          color = "#9b3ab8"; // --ichor-bright — the only FJR channel
          break;
        case "dead_air":
        default:
          // Slight jitter so the static ticks look like noise, not a comb.
          tickHeight = 2 + (hash(currentBand + ":" + i + ":j") % 3);
          color = "#3d3322"; // --brass-faint
      }
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, midY - tickHeight);
      ctx.lineTo(x, midY + tickHeight);
      ctx.stroke();
    }

    // Tuning needle — a vertical bar at currentIndex's x position.
    var needleX = Math.floor(currentIndex * tickW + tickW / 2);
    ctx.strokeStyle = powered ? "#ffaa33" : "#8a7340"; // sodium when live, brass-deep when off
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(needleX, 2);
    ctx.lineTo(needleX, h - 2);
    ctx.stroke();
  }

  // ── State updates ───────────────────────────────────────────────────────

  function updateReadout() {
    if (bandEl)   bandEl.textContent = currentBand;
    if (freqEl)   freqEl.textContent = freqLabel(currentIndex);
    if (statusEl) statusEl.textContent = statusFor(currentIndex);
    shell.dataset.band = currentBand;
    shell.dataset.frequency = String(currentIndex);
    shell.dataset.signal = powered ? signalAt(currentBand, currentIndex) : "offline";
  }

  function setBand(next) {
    if (BANDS.indexOf(next) < 0 || next === currentBand) return;
    currentBand = next;
    var buttons = shell.querySelectorAll(".radio-widget-bands button[data-band]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed", buttons[i].dataset.band === currentBand ? "true" : "false");
    }
    updateReadout();
    draw();
    applyAudio();
  }

  function setIndex(next) {
    next = Math.max(0, Math.min(STEPS - 1, Math.round(next)));
    if (next === currentIndex) return;
    currentIndex = next;
    updateReadout();
    draw();
    applyAudio();
  }

  function setPowered(next) {
    if (next === powered) return;
    powered = next;
    powerBtn.setAttribute("aria-pressed", powered ? "true" : "false");
    powerBtn.textContent = powered ? "●" : "◯";
    // Powering off should also stop any in-flight trawl so the dial
    // doesn't keep advancing silently in the background.
    if (!powered && trawling) setTrawling(false);
    updateReadout();
    draw();
    applyAudio();
  }

  // Trawl: step forward through the band on a timer. Brief pause on
  // static, longer pause on anything else so the listener can actually
  // hear what the scanner has found. Auto-powers the radio on if it's
  // currently off — pressing trawl while silent is unambiguous intent.
  function setTrawling(on) {
    if (on === trawling) return;
    trawling = on;
    if (trawlBtn) trawlBtn.setAttribute("aria-pressed", on ? "true" : "false");
    if (on) {
      if (!powered) setPowered(true);
      scheduleNextTrawl();
    } else {
      if (trawlTimer) {
        clearTimeout(trawlTimer);
        trawlTimer = null;
      }
    }
  }

  function scheduleNextTrawl() {
    if (!trawling) return;
    if (trawlTimer) clearTimeout(trawlTimer);
    var sig = signalAt(currentBand, currentIndex);
    var delay = sig === "dead_air" ? TRAWL_STEP_MS : TRAWL_PAUSE_MS;
    trawlTimer = setTimeout(stepTrawl, delay);
  }

  function stepTrawl() {
    if (!trawling) return;
    // Wrap forward through the band so trawl can run indefinitely.
    var next = (currentIndex + 1) % STEPS;
    // Bypass setIndex's no-op guard — necessary when STEPS is 1 but
    // also clearer about intent here. (Normal flow still goes through
    // setIndex for the readout/draw/audio updates.)
    setIndex(next);
    scheduleNextTrawl();
  }

  // Fold/unfold: toggle .is-folded on the shell so CSS translates the
  // widget right, leaving just the fold button visible at the window
  // edge. Audio keeps playing when folded — only the UI hides.
  function setFolded(next) {
    if (next === folded) return;
    folded = next;
    if (folded) {
      shell.classList.add("is-folded");
      foldBtn.textContent = "«";
      foldBtn.setAttribute("aria-pressed", "true");
      foldBtn.setAttribute("aria-label", "Unfold scanner");
      foldBtn.setAttribute("title", "Unfold scanner");
    } else {
      shell.classList.remove("is-folded");
      foldBtn.textContent = "»";
      foldBtn.setAttribute("aria-pressed", "false");
      foldBtn.setAttribute("aria-label", "Fold scanner");
      foldBtn.setAttribute("title", "Fold scanner to right margin");
    }
  }

  // ── Audio engine ────────────────────────────────────────────────────────
  // Lazy-init AudioContext on first power-on (browsers block creation and
  // playback before a user gesture). Each "engine" is a small graph of
  // Web Audio nodes wired into the master gain; switching channels stops
  // the old engine and starts a new one. Short gain ramps on start/stop
  // avoid clicks.

  var audioCtx = null;
  var masterGain = null;
  var currentEngine = null;    // { stop() } — null when silent

  // Pink noise is loud at unity gain — keep the master well below 1.0.
  var MASTER_VOLUME = 0.35;
  // Fade duration for engine swap and master mute. Long enough to mask
  // discontinuities, short enough to feel responsive.
  var FADE_MS = 80;

  function ensureAudio() {
    if (audioCtx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0;   // start silent; applyAudio ramps up
    masterGain.connect(audioCtx.destination);
  }

  function setMasterGain(value, ms) {
    if (!audioCtx || !masterGain) return;
    var t = audioCtx.currentTime;
    masterGain.gain.cancelScheduledValues(t);
    masterGain.gain.setValueAtTime(masterGain.gain.value, t);
    masterGain.gain.linearRampToValueAtTime(value, t + (ms || FADE_MS) / 1000);
  }

  // Mulberry32 seeded by an FNV-1a hash of the channel key. Used for the
  // per-channel parameters of carrier_wave and pirate_signal so the same
  // (band, index) always synthesizes the same sound.
  function rngFor(key) {
    var seed = hash(key);
    return function () {
      seed = (seed + 0x6d2b79f5) >>> 0;
      var t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (((t ^ (t >>> 14)) >>> 0) / 0x100000000);
    };
  }

  // ── Engine factories ────────────────────────────────────────────────────

  // Pink noise via Paul Kellet's filter — pre-fills a 2s buffer and loops.
  // Pink (vs. white) is the natural choice for "broadcast static" because
  // it matches the ear's frequency sensitivity.
  function createDeadAirEngine() {
    var sr = audioCtx.sampleRate;
    var buf = audioCtx.createBuffer(1, sr * 2, sr);
    var data = buf.getChannelData(0);
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (var i = 0; i < data.length; i++) {
      var white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    var src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    var g = audioCtx.createGain();
    g.gain.value = 1.0;
    src.connect(g);
    g.connect(masterGain);
    src.start();
    return {
      stop: function () {
        var t = audioCtx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0, t + FADE_MS / 1000);
        try { src.stop(t + FADE_MS / 1000 + 0.05); } catch (e) {}
      }
    };
  }

  // A sine tone gated by a slow LFO so it "pulses." Some channels also
  // get a mains-hum sine at 50/60 Hz layered underneath. Every parameter
  // (frequency, pulse rate, hum presence/frequency) is rng-derived from
  // the channel key.
  function createCarrierWaveEngine(channelKey) {
    var rng = rngFor(channelKey);
    var baseFreq = 180 + Math.floor(rng() * 520);   // 180-700 Hz
    var pulseRate = 0.2 + rng() * 2.0;              // 0.2-2.2 Hz
    var hasHum = rng() < 0.5;
    var humFreq = rng() < 0.5 ? 50 : 60;

    var osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = baseFreq;

    var oscGain = audioCtx.createGain();
    oscGain.gain.value = 0.12;

    // LFO sums into oscGain.gain — when the LFO swings negative the tone
    // dips toward silence, when positive it rises. Audible pulse.
    var lfo = audioCtx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = pulseRate;
    var lfoDepth = audioCtx.createGain();
    lfoDepth.gain.value = 0.10;
    lfo.connect(lfoDepth);
    lfoDepth.connect(oscGain.gain);

    osc.connect(oscGain);
    oscGain.connect(masterGain);

    var humOsc = null, humGain = null;
    if (hasHum) {
      humOsc = audioCtx.createOscillator();
      humOsc.type = "sine";
      humOsc.frequency.value = humFreq;
      humGain = audioCtx.createGain();
      humGain.gain.value = 0.03;
      humOsc.connect(humGain);
      humGain.connect(masterGain);
      humOsc.start();
    }

    osc.start();
    lfo.start();

    return {
      stop: function () {
        var t = audioCtx.currentTime;
        oscGain.gain.cancelScheduledValues(t);
        oscGain.gain.setValueAtTime(oscGain.gain.value, t);
        oscGain.gain.linearRampToValueAtTime(0, t + FADE_MS / 1000);
        if (humGain) {
          humGain.gain.cancelScheduledValues(t);
          humGain.gain.setValueAtTime(humGain.gain.value, t);
          humGain.gain.linearRampToValueAtTime(0, t + FADE_MS / 1000);
        }
        var off = t + FADE_MS / 1000 + 0.05;
        try { osc.stop(off); lfo.stop(off); if (humOsc) humOsc.stop(off); } catch (e) {}
      }
    };
  }

  // Three-voice drone: root, fifth, octave. Each voice slightly detuned and
  // amplitude-modulated by its own slow LFO. Summed through a bandpass for
  // texture. Comes out as a slowly shifting pad — closer to "lost-radio
  // station signal" than "music," but on-aesthetic for now. CC0 audio file
  // playback could replace this later; the engine interface (start now,
  // stop on demand) stays the same.
  function createPirateSignalEngine(channelKey) {
    var rng = rngFor(channelKey);
    var root = 90 + Math.floor(rng() * 80);          // 90-170 Hz drone root

    function voice(freq, detune, lfoRate, lfoDepth, gainBase) {
      var o = audioCtx.createOscillator();
      o.type = "sine";
      o.frequency.value = freq;
      o.detune.value = detune;
      var g = audioCtx.createGain();
      g.gain.value = gainBase;
      var l = audioCtx.createOscillator();
      l.type = "sine";
      l.frequency.value = lfoRate;
      var ld = audioCtx.createGain();
      ld.gain.value = lfoDepth;
      l.connect(ld);
      ld.connect(g.gain);
      o.connect(g);
      return { o: o, g: g, l: l };
    }

    var v1 = voice(root,        (rng() - 0.5) * 12, 0.10 + rng() * 0.10, 0.04, 0.10);
    var v2 = voice(root * 1.5,  (rng() - 0.5) * 12, 0.13 + rng() * 0.10, 0.03, 0.07);
    var v3 = voice(root * 2.0,  (rng() - 0.5) * 12, 0.07 + rng() * 0.10, 0.02, 0.05);

    var bus = audioCtx.createGain();
    bus.gain.value = 0;
    v1.g.connect(bus);
    v2.g.connect(bus);
    v3.g.connect(bus);

    var bp = audioCtx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = root * 2.5;
    bp.Q.value = 0.8;
    bus.connect(bp);
    bp.connect(masterGain);

    v1.o.start(); v1.l.start();
    v2.o.start(); v2.l.start();
    v3.o.start(); v3.l.start();

    // Slow fade-in — drones feel right when they ease in over a beat.
    // Bus ramps above 1.0 to boost the drone above carrier_wave and
    // dead_air, which otherwise dominate the mix.
    var t0 = audioCtx.currentTime;
    bus.gain.setValueAtTime(0, t0);
    bus.gain.linearRampToValueAtTime(3.0, t0 + 0.4);

    return {
      stop: function () {
        var t = audioCtx.currentTime;
        bus.gain.cancelScheduledValues(t);
        bus.gain.setValueAtTime(bus.gain.value, t);
        bus.gain.linearRampToValueAtTime(0, t + FADE_MS / 1000);
        var off = t + FADE_MS / 1000 + 0.05;
        try {
          v1.o.stop(off); v1.l.stop(off);
          v2.o.stop(off); v2.l.stop(off);
          v3.o.stop(off); v3.l.stop(off);
        } catch (e) {}
      }
    };
  }

  // Returned when speechSynthesis isn't available, or as a fallback for
  // voice channels when the cipher data hasn't loaded yet.
  function createSilentEngine() {
    return { stop: function () {} };
  }

  // ── Speech synthesis ────────────────────────────────────────────────────
  // Web Audio (engines above) and speechSynthesis (engines below) are
  // independent output paths — the master gain only affects Web Audio,
  // so utterance.volume controls voice level. Engines that own
  // speechSynthesis call cancel() on stop() to flush the queue, and
  // gate their onend callbacks behind an `alive` flag so late callbacks
  // can't resurrect a stopped engine.

  var voicesCache = null;

  // Cipher data — array of passages, each passage an array of 5-digit
  // groups. The 11ty emitter splits radio-source.md on `---` lines, so
  // multiple passages are supported out of the box. Channels are
  // assigned passages by round-robin in band-then-index order.
  var cipherPassages = null;
  var cipherLoading = null;

  // Compromised templates — array of strings with {CODE}/{SECTION}/
  // {AUTHORITY} placeholders. Same multi-template-by-`---` pattern.
  var compromisedTemplates = null;
  var compromisedLoading = null;

  // Cached ordinal lookups: for each voice type, the list of channels
  // (in band-then-index order) that carry that signal. Used to assign
  // passages/templates to channels round-robin so the user gets stable,
  // predictable coverage of their source material across the dial.
  var channelOrderCache = {};

  function channelOrderFor(type) {
    if (channelOrderCache[type]) return channelOrderCache[type];
    var list = [];
    for (var b = 0; b < BANDS.length; b++) {
      for (var i = 0; i < STEPS; i++) {
        if (signalAt(BANDS[b], i) === type) {
          list.push(BANDS[b] + ":" + i);
        }
      }
    }
    channelOrderCache[type] = list;
    return list;
  }

  function ordinalOf(channelKey, type) {
    var order = channelOrderFor(type);
    var idx = order.indexOf(channelKey);
    // Channel not in the list (shouldn't happen if caller filtered by
    // signalAt first) — fall back to a hash-based pick so the engine
    // still has something to play.
    return idx < 0 ? hash(channelKey) >>> 0 : idx;
  }

  function hasSpeech() {
    return typeof window !== "undefined" && !!window.speechSynthesis;
  }

  function getVoices() {
    if (!hasSpeech()) return [];
    if (voicesCache && voicesCache.length) return voicesCache;
    voicesCache = window.speechSynthesis.getVoices();
    return voicesCache;
  }

  // Voice list populates asynchronously in some browsers (Chrome). Refresh
  // the cache when the browser tells us the list changed.
  if (hasSpeech() && typeof window.speechSynthesis.onvoiceschanged !== "undefined") {
    window.speechSynthesis.onvoiceschanged = function () {
      voicesCache = window.speechSynthesis.getVoices();
    };
  }

  // Build the candidate-voice pool for a role. Returns every English
  // voice whose name matches any of the role's preference patterns,
  // preserving prefs order. Falls back to the full English voice list
  // when nothing matches (so engines still sound at least somewhat
  // role-appropriate).
  //
  // Voice availability is wildly OS-dependent — on a system with three
  // matching voices we get three distinct broadcast voices per role; on
  // a system with one, every station of that role shares the same voice
  // but stays internally consistent (which is the main thing).
  function voicePool(role) {
    var voices = getVoices();
    if (!voices.length) return [];
    var english = voices.filter(function (v) { return /^en/i.test(v.lang); });
    var pool = english.length ? english : voices;
    var prefs;
    switch (role) {
      case "numbers":
        prefs = [/zira/i, /samantha/i, /aria/i, /female/i, /microsoft.*english/i];
        break;
      case "lock":
        prefs = [/karen/i, /tessa/i, /serena/i, /natural/i, /female/i];
        break;
      case "compromised":
        prefs = [/david/i, /daniel/i, /alex/i, /mark/i, /male/i];
        break;
      case "fractured_jaw":
        // Premium/neural voices first; falls through to ordinary female
        // English voices. Different role-pool from "numbers" so FJR
        // sounds distinct even on minimal voice setups.
        prefs = [/neural/i, /natural/i, /enhanced/i, /samantha/i, /aria/i, /female/i];
        break;
      default:
        prefs = [];
    }
    var matched = [];
    for (var i = 0; i < prefs.length; i++) {
      for (var j = 0; j < pool.length; j++) {
        if (prefs[i].test(pool[j].name) && matched.indexOf(pool[j]) < 0) {
          matched.push(pool[j]);
        }
      }
    }
    return matched.length ? matched : pool;
  }

  // Pick a voice for a role. With channelKey, picks deterministically
  // from the pool by hash — same channel always gets the same voice,
  // different channels of the same role may get different voices.
  function pickVoice(role, channelKey) {
    var pool = voicePool(role);
    if (!pool.length) return null;
    if (channelKey) return pool[hash(channelKey + ":voice") % pool.length];
    return pool[0];
  }

  // configureUtterance accepts an optional cached voice — engines pick
  // once at creation and pass the same voice in for every utterance, so
  // late-loading voice lists can't switch the broadcast voice mid-station.
  function configureUtterance(utterance, role, cachedVoice) {
    if (cachedVoice) utterance.voice = cachedVoice;
    else {
      var v = pickVoice(role);
      if (v) utterance.voice = v;
    }
    switch (role) {
      case "numbers":
        utterance.rate  = 0.85;
        utterance.pitch = 1.00;
        break;
      case "lock":
        utterance.rate  = 0.80;
        utterance.pitch = 1.05;
        break;
      case "compromised":
        // Slower + lower pitch for "authority broadcast" feel.
        utterance.rate  = 0.78;
        utterance.pitch = 0.85;
        break;
      case "fractured_jaw":
        // Slightly slow + slightly low — measured radio-announcer pacing,
        // not as grave as the compromised authority voice.
        utterance.rate  = 0.90;
        utterance.pitch = 0.95;
        break;
      default:
        utterance.rate  = 1.0;
        utterance.pitch = 1.0;
    }
    utterance.volume = 0.9;
  }

  // "niner" instead of "nine" is military/aviation/numbers-station
  // convention — distinguishes audibly from "five" over a noisy channel.
  var DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five",
                     "six", "seven", "eight", "niner"];

  function digitsToWords(group) {
    var out = "";
    for (var i = 0; i < group.length; i++) {
      if (i > 0) out += " ";
      out += DIGIT_WORDS[parseInt(group.charAt(i), 10)] || "";
    }
    return out;
  }

  function loadCipher() {
    if (cipherPassages) return Promise.resolve(cipherPassages);
    if (cipherLoading) return cipherLoading;
    if (typeof fetch !== "function") {
      cipherPassages = [];
      return Promise.resolve(cipherPassages);
    }
    cipherLoading = fetch("/radio-cipher.json")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        cipherPassages = (data && data.passages) || [];
        return cipherPassages;
      })
      .catch(function () { cipherPassages = []; return cipherPassages; });
    return cipherLoading;
  }

  function loadCompromised() {
    if (compromisedTemplates) return Promise.resolve(compromisedTemplates);
    if (compromisedLoading) return compromisedLoading;
    if (typeof fetch !== "function") {
      compromisedTemplates = [];
      return Promise.resolve(compromisedTemplates);
    }
    compromisedLoading = fetch("/radio-compromised.json")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        compromisedTemplates = (data && data.templates) || [];
        return compromisedTemplates;
      })
      .catch(function () { compromisedTemplates = []; return compromisedTemplates; });
    return compromisedLoading;
  }

  // Fractured Jaw Radio script segments. One emitter, one source file
  // (src/content/_local/radio/fractured-jaw-radio.md), one channel.
  // Segments are separated by `---` in the source; each one plays as a
  // separate utterance with a short pause between, longer pause at the
  // end of the loop.
  var fjrSegments = null;
  var fjrLoading = null;

  function loadFracturedJaw() {
    if (fjrSegments) return Promise.resolve(fjrSegments);
    if (fjrLoading) return fjrLoading;
    if (typeof fetch !== "function") {
      fjrSegments = [];
      return Promise.resolve(fjrSegments);
    }
    fjrLoading = fetch("/fractured-jaw-radio.json")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        fjrSegments = (data && data.segments) || [];
        return fjrSegments;
      })
      .catch(function () { fjrSegments = []; return fjrSegments; });
    return fjrLoading;
  }

  // ── Voice engine: numbers ───────────────────────────────────────────────
  // Pre-generates a deterministic playlist of 30 random 5-digit groups,
  // speaks them with ~1.2s gaps, loops forever. Playlist is fixed per
  // channel so the same dial position always reads the same sequence.
  function createNumbersEngine(channelKey) {
    if (!hasSpeech()) return createSilentEngine();
    var rng = rngFor(channelKey);
    var groups = [];
    for (var i = 0; i < 30; i++) {
      var g = "";
      for (var j = 0; j < 5; j++) g += Math.floor(rng() * 10).toString();
      groups.push(g);
    }

    var alive = true;
    var idx = 0;
    var pendingTimer = null;
    // Cache voice at engine creation. If voices aren't loaded yet,
    // pickVoice returns null and we re-try lazily inside speakNext
    // until we get one — then stay on that voice for the rest of the
    // station's broadcast.
    var voice = pickVoice("numbers", channelKey);

    function speakNext() {
      if (!alive) return;
      if (!voice) voice = pickVoice("numbers", channelKey);
      var u = new SpeechSynthesisUtterance(digitsToWords(groups[idx]));
      configureUtterance(u, "numbers", voice);
      u.onend = function () {
        if (!alive) return;
        idx = (idx + 1) % groups.length;
        pendingTimer = setTimeout(speakNext, 1200);
      };
      u.onerror = function () {
        // speechSynthesis errors transiently on some platforms (especially
        // when cancelled mid-utterance). Wait and try again — if engine
        // was stopped, the alive check short-circuits.
        if (!alive) return;
        pendingTimer = setTimeout(speakNext, 1500);
      };
      try { window.speechSynthesis.speak(u); } catch (e) {}
    }

    speakNext();

    return {
      stop: function () {
        alive = false;
        if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }
    };
  }

  // ── Voice engine: lock ──────────────────────────────────────────────────
  // Reads cipher digit groups from /radio-cipher.json (built from
  // src/content/_local/radio/radio-source.md; multiple passages
  // supported via `---` separator). Round-robin: the Nth lock channel
  // in band-then-index order broadcasts passage (N mod passages.length).
  // Each channel reads its assigned passage from the start, looping.
  function createLockEngine(channelKey) {
    if (!hasSpeech()) return createSilentEngine();

    var alive = true;
    var pendingTimer = null;
    var groups = null;
    var idx = 0;
    var voice = pickVoice("lock", channelKey);

    function speakNext() {
      if (!alive || !groups || !groups.length) return;
      if (!voice) voice = pickVoice("lock", channelKey);
      var u = new SpeechSynthesisUtterance(digitsToWords(groups[idx]));
      configureUtterance(u, "lock", voice);
      u.onend = function () {
        if (!alive) return;
        idx = (idx + 1) % groups.length;
        pendingTimer = setTimeout(speakNext, 1200);
      };
      u.onerror = function () {
        if (!alive) return;
        pendingTimer = setTimeout(speakNext, 1500);
      };
      try { window.speechSynthesis.speak(u); } catch (e) {}
    }

    loadCipher().then(function (passages) {
      if (!alive) return;
      if (!passages || !passages.length) return;
      var ord = ordinalOf(channelKey, "lock");
      groups = passages[ord % passages.length];
      if (!groups || !groups.length) return;
      idx = 0;
      speakNext();
    });

    return {
      stop: function () {
        alive = false;
        if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }
    };
  }

  // ── Voice engine: compromised ───────────────────────────────────────────
  // Repeating "this station has been terminated" announcement, with
  // per-channel deterministic violation codes, sections, and issuing
  // authority. ~25% of repetitions stutter on a content word ("ter,
  // ter, terminated") to give the loop a degraded-recording feel.

  var AUTHORITIES = [
    "Civic Compliance Authority",
    "Bureau of Frequency Moderation",
    "Office of Public Information",
    "Ministry of Domestic Harmony",
    "Directorate of Spectral Order"
  ];

  // Stopwords filtered out of glitch candidates — common ≥6-letter
  // words that don't sound interesting when stuttered ("their, their,
  // their" feels flat; "violation, violation, violation" feels degraded).
  // Maintaining a stopword list instead of a positive target list means
  // user-authored templates with novel vocabulary still glitch on their
  // own content words automatically.
  var GLITCH_STOPWORDS = [
    "their", "there", "where", "could", "would", "should", "these",
    "those", "which", "while", "before", "after", "about", "again",
    "since", "until", "going", "doing", "being", "having", "still",
    "every", "first", "other", "right", "shall", "might", "across",
    "behind", "between", "during", "without", "within", "through"
  ];

  // Fallback template used if /radio-compromised.json hasn't loaded yet
  // (or fails to load). The build emitter ships this same string as its
  // own fallback, so behavior is the same in either path.
  var FALLBACK_COMPROMISED_TEMPLATE =
    "This station's operations have been terminated due to violation of " +
    "L M M C code {CODE}, section {SECTION}. By order of the {AUTHORITY}. " +
    "Report dissidents to your nearest party office. " +
    "This message will now repeat.";

  // Auto-detect glitch candidates from the resolved message: words
  // ≥6 letters, alphabetic only (excludes the substituted CODE/SECTION
  // digits), not in the stopword list, deduplicated. Original-case
  // preserved so the in-place replace finds the same string.
  function findGlitchTargets(message) {
    var matches = message.match(/\b[a-z]{6,}\b/gi) || [];
    var seen = {};
    var out = [];
    for (var i = 0; i < matches.length; i++) {
      var lower = matches[i].toLowerCase();
      if (GLITCH_STOPWORDS.indexOf(lower) >= 0) continue;
      if (seen[lower]) continue;
      seen[lower] = true;
      out.push(matches[i]);
    }
    return out;
  }

  function buildCompromisedMessage(template, code, section, sectionLetter, authority) {
    return template
      .replace(/\{CODE\}/g, String(code))
      .replace(/\{SECTION\}/g, section + sectionLetter)
      .replace(/\{AUTHORITY\}/g, authority);
  }

  // Apply a stutter glitch by picking a random eligible word in the
  // message and prepending two stem repeats ("ter, ter, terminated").
  // The commas insert TTS-natural pauses that read as a degraded
  // recording.
  function applyStutterGlitch(message, rng) {
    var targets = findGlitchTargets(message);
    if (!targets.length) return message;
    var word = targets[Math.floor(rng() * targets.length)];
    var stem = word.substring(0, 3);
    return message.replace(word, stem + ", " + stem + ", " + word);
  }

  // Apply a slowdown glitch by splitting the sentence into three
  // utterances — text before the target word, the target word at a
  // reduced rate, and the text after. speechSynthesis.rate is per-
  // utterance, so this is the only way to actually slow one word's
  // pronunciation (rather than chopping it up). Returns an array of
  // { text, rate? } parts; the engine queues them back-to-back.
  function applySlowdownSplit(message, rng) {
    var targets = findGlitchTargets(message);
    if (!targets.length) return [{ text: message }];
    var word = targets[Math.floor(rng() * targets.length)];
    var pos = message.indexOf(word);
    if (pos < 0) return [{ text: message }];
    var before = message.substring(0, pos);
    var after = message.substring(pos + word.length);
    return [
      { text: before },
      { text: word, rate: 0.4 },  // ~half the role's normal rate
      { text: after }
    ];
  }

  function createCompromisedEngine(channelKey) {
    if (!hasSpeech()) return createSilentEngine();

    var alive = true;
    var pendingTimer = null;
    var glitchRng = rngFor(channelKey + ":glitch");
    var voice = pickVoice("compromised", channelKey);

    // Resolve per-channel parameters once at engine creation. Same channel
    // always gets the same code/section/authority — different channels
    // sound like different broadcasts from different authorities.
    var paramRng = rngFor(channelKey + ":msg");
    var code = 100 + Math.floor(paramRng() * 900);
    var section = 1 + Math.floor(paramRng() * 30);
    var sectionLetter = String.fromCharCode(97 + Math.floor(paramRng() * 4));
    var authority = AUTHORITIES[Math.floor(paramRng() * AUTHORITIES.length)];

    // Hold off on the first utterance until templates have loaded — if
    // we spoke immediately with the fallback we'd hear a different
    // phrase on rep 1 vs rep 2+ (because the fetch usually resolves
    // between them). Engine still falls back to FALLBACK_COMPROMISED_
    // TEMPLATE if the fetch fails.
    var template = FALLBACK_COMPROMISED_TEMPLATE;
    loadCompromised().then(function (templates) {
      if (!alive) return;
      if (templates && templates.length) {
        var ord = ordinalOf(channelKey, "compromised");
        template = templates[ord % templates.length];
      }
      speakNext();
    });

    function speakNext() {
      if (!alive) return;
      if (!voice) voice = pickVoice("compromised", channelKey);
      // 30% chance of glitching per repetition. When it fires, pick
      // 50/50 between a stutter (single utterance with stem repeats)
      // and a slowdown (three utterances so the target word actually
      // pronounces at half speed).
      var doGlitch = glitchRng() < 0.30;
      var message = buildCompromisedMessage(template, code, section, sectionLetter, authority);
      var parts;
      if (doGlitch) {
        parts = glitchRng() < 0.5
          ? [{ text: applyStutterGlitch(message, glitchRng) }]
          : applySlowdownSplit(message, glitchRng);
      } else {
        parts = [{ text: message }];
      }
      speakParts(parts);
    }

    // Queue a sequence of utterances back-to-back. Only the last part's
    // onend reschedules the next repetition; intermediate parts chain
    // through speechSynthesis's natural queue.
    function speakParts(parts) {
      if (!alive) return;
      var valid = parts.filter(function (p) { return p.text && p.text.trim(); });
      if (!valid.length) {
        // Defensive: nothing to say. Skip to next repetition.
        var skipPause = 3000 + Math.floor(glitchRng() * 2000);
        pendingTimer = setTimeout(speakNext, skipPause);
        return;
      }
      var last = valid.length - 1;
      for (var i = 0; i < valid.length; i++) {
        (function (part, isLast) {
          var u = new SpeechSynthesisUtterance(part.text);
          configureUtterance(u, "compromised", voice);
          // Per-part rate override — used by the slowdown glitch on
          // the middle utterance. configureUtterance has already set
          // the role default (0.78); we override after.
          if (part.rate !== undefined) u.rate = part.rate;
          if (isLast) {
            u.onend = function () {
              if (!alive) return;
              var pause = 3000 + Math.floor(glitchRng() * 2000);
              pendingTimer = setTimeout(speakNext, pause);
            };
            u.onerror = function () {
              if (!alive) return;
              pendingTimer = setTimeout(speakNext, 2000);
            };
          }
          try { window.speechSynthesis.speak(u); } catch (e) {}
        })(valid[i], i === last);
      }
    }

    // First speakNext is triggered by the loadCompromised().then handler
    // above — not called eagerly here.

    return {
      stop: function () {
        alive = false;
        if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }
    };
  }

  // ── Voice engine: Fractured Jaw Radio ───────────────────────────────────
  // Single fixed channel (FJR_BAND, FJR_INDEX). Reads script segments
  // straight out of /fractured-jaw-radio.json — no encoding, just plain
  // text speech. Multiple segments cycle in turn with a short pause
  // between; the end of the cycle gets a longer pause before restart so
  // the loop has breathing room.
  function createFracturedJawEngine() {
    if (!hasSpeech()) return createSilentEngine();

    var alive = true;
    var pendingTimer = null;
    var segments = null;
    var idx = 0;
    // FJR is a singleton — use a fixed channel key so voice picking is
    // deterministic across page loads.
    var channelKey = FJR_BAND + ":" + FJR_INDEX;
    var voice = pickVoice("fractured_jaw", channelKey);

    function speakNext() {
      if (!alive || !segments || !segments.length) return;
      if (!voice) voice = pickVoice("fractured_jaw", channelKey);
      var u = new SpeechSynthesisUtterance(segments[idx]);
      configureUtterance(u, "fractured_jaw", voice);
      u.onend = function () {
        if (!alive) return;
        var wasLast = idx === segments.length - 1;
        idx = (idx + 1) % segments.length;
        // Longer pause when wrapping back to segment 0 so the loop has
        // a clear beat between rotations; shorter pause between
        // sequential segments within the same rotation.
        var pause = wasLast ? 6000 : 2500;
        pendingTimer = setTimeout(speakNext, pause);
      };
      u.onerror = function () {
        if (!alive) return;
        pendingTimer = setTimeout(speakNext, 2000);
      };
      try { window.speechSynthesis.speak(u); } catch (e) {}
    }

    loadFracturedJaw().then(function (loaded) {
      if (!alive) return;
      if (!loaded || !loaded.length) return;
      segments = loaded;
      speakNext();
    });

    return {
      stop: function () {
        alive = false;
        if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }
    };
  }

  function applyAudio() {
    if (!powered) {
      if (currentEngine) {
        currentEngine.stop();
        currentEngine = null;
      }
      setMasterGain(0);
      return;
    }

    ensureAudio();
    if (!audioCtx) return;

    // Some browsers leave the context suspended even after a user gesture
    // (e.g. iOS Safari). Resume defensively — no-op if already running.
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(function () {});
    }

    setMasterGain(MASTER_VOLUME);

    if (currentEngine) currentEngine.stop();
    var sig = signalAt(currentBand, currentIndex);
    var key = currentBand + ":" + currentIndex;
    switch (sig) {
      case "carrier_wave":
        currentEngine = createCarrierWaveEngine(key);
        break;
      case "pirate_signal":
        currentEngine = createPirateSignalEngine(key);
        break;
      case "numbers":
        currentEngine = createNumbersEngine(key);
        break;
      case "lock":
        currentEngine = createLockEngine(key);
        break;
      case "compromised":
        currentEngine = createCompromisedEngine(key);
        break;
      case "fractured_jaw":
        currentEngine = createFracturedJawEngine();
        break;
      case "dead_air":
      default:
        currentEngine = createDeadAirEngine();
    }
  }

  // ── Event listeners ─────────────────────────────────────────────────────

  function indexFromClientX(clientX) {
    var rect = canvas.getBoundingClientRect();
    var x = clientX - rect.left;
    var ratio = Math.max(0, Math.min(1, x / rect.width));
    return Math.floor(ratio * STEPS);
  }

  function setupListeners() {
    canvas.addEventListener("click", function (e) {
      setIndex(indexFromClientX(e.clientX));
    });

    canvas.addEventListener("wheel", function (e) {
      // Fine-tune: one frequency step per notch. Prevent page scroll only
      // while the user is interacting with the dial — checking that the
      // canvas is the wheel target is enough; preventDefault keeps the page still.
      e.preventDefault();
      var step = e.deltaY > 0 ? 1 : -1;
      setIndex(currentIndex + step);
    }, { passive: false });

    canvas.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault();
        setIndex(currentIndex + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault();
        setIndex(currentIndex - 1);
      } else if (e.key === "PageUp") {
        e.preventDefault();
        setIndex(currentIndex + 8);
      } else if (e.key === "PageDown") {
        e.preventDefault();
        setIndex(currentIndex - 8);
      }
    });

    var bandButtons = shell.querySelectorAll(".radio-widget-bands button[data-band]");
    for (var i = 0; i < bandButtons.length; i++) {
      bandButtons[i].addEventListener("click", function (ev) {
        setBand(ev.currentTarget.dataset.band);
      });
    }

    powerBtn.addEventListener("click", function () {
      setPowered(!powered);
    });

    if (trawlBtn) {
      trawlBtn.addEventListener("click", function () {
        setTrawling(!trawling);
      });
    }

    if (foldBtn) {
      foldBtn.addEventListener("click", function () {
        setFolded(!folded);
      });
    }

    window.addEventListener("resize", function () {
      resize();
      draw();
    });
  }

  // ── Ticker injection ────────────────────────────────────────────────────
  // The site already has a scrolling broadcast ticker (.broadcast-banner
  // in cult.css). Its content lives in a CSS pseudo-element fed by the
  // --ticker-content custom property, so JS can swap it without touching
  // the rest of the styling. We pick a random pirate_signal channel and
  // a random compromised channel per page load, splice their real
  // band/frequency coordinates into the entry list, and re-emit the
  // string into the custom property. If JS doesn't run, the CSS fallback
  // value keeps the original ticker readable.

  // Entries that scroll across the banner. Three slots are runtime-bound:
  //   {FJR_FREQ}       → "FREQ:BAND <X> 0x<YY>" — Fractured Jaw Radio,
  //                      fixed coordinate from FJR_BAND / FJR_INDEX
  //   {PIRATE_FREQ}    → "PIRATE_FREQ:BAND <X> 0x<YY>" — random per load
  //   {COMPROMISED}    → "COMPROMISED STATION DETECTED, ADJUST YOUR
  //                       SCANNER: BAND <X> 0x<YY>" — random per load
  // Edit this list to change which static entries appear and where.
  var TICKER_ENTRIES = [
    "MACHINE_LISTENING",
    "ZONE_9",
    "{FJR_FREQ}",
    "SIGNAL:LOCKED",
    "LEMURIAN_TIME_WAR",
    "CYBERGOTHIC",
    "TERMINUS_MACHINE",
    "ENCRYPTED_SIGNAL",
    "{COMPROMISED}",
    "DOWNTIME_PROTOCOL",
    "SOUL:CORRUPTED",
    "HYPERSTITION",
    "ZONE_23",
    "MELTDOWN",
    "MACHINE_INTACT",
    "NUMOGRAM_ACTIVE",
    "{PIRATE_FREQ}",
    "ZONE_9"
  ];

  // Format FJR_INDEX as the same 0xNN hex used everywhere else.
  function fjrHex() {
    var h = FJR_INDEX.toString(16).toUpperCase();
    if (h.length < 2) h = "0" + h;
    return "0x" + h;
  }

  function formatChannelKey(key) {
    var bits = key.split(":");
    var band = bits[0];
    var idx = parseInt(bits[1], 10);
    var hex = idx.toString(16).toUpperCase();
    if (hex.length < 2) hex = "0" + hex;
    return { band: band, freq: "0x" + hex };
  }

  // Pick a random channel of the given signal type. Random per page
  // load so each visit shows different alerts in the rotation.
  function randomChannelOf(type) {
    var order = channelOrderFor(type);
    if (!order.length) return null;
    return order[Math.floor(Math.random() * order.length)];
  }

  // Duration of the steady-state scroll animation in cult.css. Must
  // stay in sync with the @keyframes ticker-scroll declaration there.
  // Used to derive a speed-matched intro duration below.
  var TICKER_SCROLL_DURATION_S = 65;

  // Measure how wide the rendered ticker content would be, by stamping
  // a hidden span with matching font properties into the DOM. Used to
  // compute an intro duration that matches the steady-state scroll
  // speed (so the on-load slide-in pace is identical to the loop pace).
  function measureTickerWidth(content) {
    if (typeof document === "undefined") return 0;
    var probe = document.createElement("span");
    probe.style.cssText = [
      "position:absolute",
      "left:-99999px",
      "top:0",
      "white-space:nowrap",
      "visibility:hidden",
      // Mirror the CSS in .broadcast-banner::before — keep these in sync
      // if you change the ticker's font.
      "font-family:var(--font-body)",
      "font-size:0.58rem",
      "letter-spacing:0.1em"
    ].join(";");
    probe.textContent = content;
    document.body.appendChild(probe);
    var width = probe.scrollWidth || probe.offsetWidth || 0;
    document.body.removeChild(probe);
    return width;
  }

  function initTicker() {
    var banner = document.querySelector(".broadcast-banner");
    if (!banner) return;

    var pirateKey = randomChannelOf("pirate_signal");
    var compromisedKey = randomChannelOf("compromised");
    var fjrCoord = FJR_BAND + " " + fjrHex();

    // Expose FJR coordinates as a CSS variable so .site-nav::after (and
    // any other CSS consumer) can splice them into its content string.
    // Set on documentElement so :root descendants inherit it.
    document.documentElement.style.setProperty(
      "--fjr-coordinates", '"' + fjrCoord + '"'
    );

    var entries = TICKER_ENTRIES.map(function (entry) {
      if (entry === "{PIRATE_FREQ}") {
        if (!pirateKey) return null;
        var p = formatChannelKey(pirateKey);
        return "PIRATE_FREQ:BAND " + p.band + " " + p.freq;
      }
      if (entry === "{COMPROMISED}") {
        if (!compromisedKey) return null;
        var c = formatChannelKey(compromisedKey);
        return "COMPROMISED STATION DETECTED, ADJUST YOUR SCANNER: BAND " +
               c.band + " " + c.freq;
      }
      if (entry === "{FJR_FREQ}") {
        return "FREQ:BAND " + fjrCoord;
      }
      return entry;
    }).filter(function (e) { return e !== null; });

    var content = "◈ " + entries.join(" ◈ ") + " ◈";
    // CSS string requires outer quotes inside the custom-property value.
    // Entries don't contain `"` so simple wrapping is safe.
    banner.style.setProperty("--ticker-content", '"' + content + '"');

    // Compute intro duration that matches the steady-state scroll speed.
    // The scroll animation covers one content-width over
    // TICKER_SCROLL_DURATION_S seconds (because the element is two
    // copies wide and the keyframe shifts it by -50%). So the px/sec
    // rate is contentWidth / TICKER_SCROLL_DURATION_S, and the intro
    // (which covers one viewport-width) needs:
    //   introDuration = viewportWidth / (contentWidth / SCROLL_DURATION)
    //                 = SCROLL_DURATION * viewportWidth / contentWidth
    var contentWidth = measureTickerWidth(content);
    if (contentWidth > 0) {
      var viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1500;
      var introDuration = TICKER_SCROLL_DURATION_S * viewportWidth / contentWidth;
      // Clamp so a weird measurement (or a very long/short content) can't
      // produce a jarring duration.
      introDuration = Math.max(6, Math.min(60, introDuration));
      banner.style.setProperty("--ticker-intro-duration", introDuration + "s");
    }
  }

  // ── Boot ────────────────────────────────────────────────────────────────

  function boot() {
    resize();
    setupListeners();
    updateReadout();
    draw();
    // Kick off all three voice-data fetches in the background so the
    // first tune to a lock / compromised / FJR channel doesn't start
    // with a network-bound delay. Fire-and-forget — the engines await
    // the same promises.
    loadCipher();
    loadCompromised();
    loadFracturedJaw();
    initTicker();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
