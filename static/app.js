/* Hurricane vs Volcano — front end.
 * - Connects to /ws for live state; falls back to polling /state every 1s.
 * - DEMO voting: tap a team panel or press 1 / 2 (POST /vote/<team>).
 * - Canvas 2D animation: hurricane spiral + rain (left, blue),
 *   volcano + lava particles + smoke (right, orange). No images, no
 *   people/faces/animals — only natural forces.
 * - Optional natural sounds (wind / rain / low rumble) made with
 *   WebAudio noise — NO music. Off by default; toggle with the button.
 */
(function () {
  "use strict";
  var state = null;
  var ws = null;
  var wsOk = false;

  var $ = function (id) { return document.getElementById(id); };

  // ---------------------------------------------------------- state UI
  function applyState(s) {
    state = s;
    $("round-label").textContent = "ROUND " + s.round_number;
    $("timer").textContent = s.time_left;
    $("timer-fill").style.width =
      Math.max(0, (s.time_left / s.round_seconds) * 100) + "%";
    $("score-hurricane").textContent = s.hurricane;
    $("score-volcano").textContent = s.volcano;
    $("wins-hurricane").textContent = s.round_wins_hurricane;
    $("wins-volcano").textContent = s.round_wins_volcano;
    $("totals").textContent =
      "Votes: " + s.total_votes + "  •  Gifts: " + s.total_gifts;
    $("viewers").textContent = s.live_viewers || 0;

    var badge = $("mode-badge");
    if (s.mode === "LIVE") {
      badge.textContent = "● LIVE";
      badge.className = "badge live";
    } else {
      badge.textContent = "DEMO";
      badge.className = "badge demo";
    }
    var hints = document.querySelectorAll(".tap-hint");
    for (var i = 0; i < hints.length; i++) {
      hints[i].style.display = s.mode === "LIVE" ? "none" : "block";
    }

    var total = s.hurricane + s.volcano;
    $("bar-hurricane").style.width = total ? (s.hurricane / total * 100) + "%" : "0%";
    $("bar-volcano").style.width = total ? (s.volcano / total * 100) + "%" : "0%";

    var banner = $("winner-banner");
    if (s.phase === "winner") {
      var txt = s.winner === "tie" ? "IT'S A TIE!" :
        s.winner === "hurricane" ? "🌪 HURRICANE WINS!" : "🌋 VOLCANO WINS!";
      $("winner-text").textContent = txt;
      banner.classList.remove("hidden");
      if (s.winner !== "tie") burst(s.winner);
    } else {
      banner.classList.add("hidden");
    }

    var feed = $("feed");
    feed.innerHTML = "";
    (s.events || []).forEach(function (e) {
      var li = document.createElement("li");
      li.textContent = (e.t ? e.t + "  " : "") + e.text;
      feed.appendChild(li);
    });
  }

  // ---------------------------------------------------------- voting
  function vote(team) {
    if (wsOk && ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify({ vote: team })); return; } catch (e) {}
    }
    fetch("/vote/" + team, { method: "POST" }).catch(function () {});
  }
  $("panel-hurricane").addEventListener("click", function () { vote("hurricane"); });
  $("panel-volcano").addEventListener("click", function () { vote("volcano"); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "1") vote("hurricane");
    if (e.key === "2") vote("volcano");
  });

  // ---------------------------------------------------------- live connection
  function connectWS() {
    try {
      var proto = location.protocol === "https:" ? "wss://" : "ws://";
      ws = new WebSocket(proto + location.host + "/ws");
      ws.onopen = function () { wsOk = true; };
      ws.onmessage = function (ev) {
        try { applyState(JSON.parse(ev.data)); } catch (e) {}
      };
      ws.onclose = function () { wsOk = false; setTimeout(connectWS, 3000); };
      ws.onerror = function () { wsOk = false; try { ws.close(); } catch (e) {} };
    } catch (e) { wsOk = false; }
  }
  connectWS();
  // Polling fallback: keeps the page alive even if WebSockets are blocked.
  setInterval(function () {
    if (wsOk) return;
    fetch("/state").then(function (r) { return r.json(); })
      .then(applyState).catch(function () {});
  }, 1000);

  // ---------------------------------------------------------- canvas animation
  var canvas = $("game-canvas");
  var ctx = canvas.getContext("2d");
  var W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  var rain = [], lava = [], smoke = [], sparks = [];
  for (var i = 0; i < 90; i++) {
    rain.push({ x: Math.random(), y: Math.random(), s: 0.008 + Math.random() * 0.02 });
  }
  for (var j = 0; j < 40; j++) {
    lava.push({ x: Math.random(), y: 0.75 + Math.random() * 0.25, s: 0.002 + Math.random() * 0.006, r: 1 + Math.random() * 2.5 });
  }
  for (var k = 0; k < 14; k++) {
    smoke.push({ x: 0.72 + Math.random() * 0.06, y: 0.25 + Math.random() * 0.3, r: 8 + Math.random() * 16, v: 0.0006 + Math.random() * 0.001 });
  }
  function burst(team) {
    if (sparks.length > 40) return;
    var x0 = team === "hurricane" ? W * 0.25 : W * 0.75;
    var col = team === "hurricane" ? "#38b6ff" : "#ff7a1a";
    for (var i = 0; i < 40; i++) {
      sparks.push({ x: x0, y: H * 0.5, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.7) * 6, life: 1, col: col });
    }
  }

  var angle = 0;
  function draw(now) {
    angle += 0.02;
    ctx.clearRect(0, 0, W, H);

    var hPow = state ? Math.min(1, state.hurricane / 60) : 0;
    var vPow = state ? Math.min(1, state.volcano / 60) : 0;

    // --- sea (bottom strip)
    ctx.fillStyle = "#0b2233";
    ctx.fillRect(0, H * 0.82, W, H * 0.18);
    ctx.strokeStyle = "rgba(56,182,255,0.5)";
    ctx.lineWidth = 1.5;
    for (var w = 0; w < 3; w++) {
      ctx.beginPath();
      var yBase = H * (0.86 + w * 0.05);
      for (var x = 0; x <= W; x += 8) {
        var y = yBase + Math.sin(x * 0.03 + now / 300 + w * 2) * 3;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // --- HURRICANE (left): rotating spiral + rain
    var cx = W * 0.25, cy = H * 0.42;
    var spiralR = 26 + hPow * 26;
    ctx.lineWidth = 3 + hPow * 2;
    for (var a = 0; a < 3; a++) {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(56,182,255," + (0.9 - a * 0.25) + ")";
      var start = angle * (1 + hPow) + a * 2.1;
      for (var t = 0; t < Math.PI * 2.4; t += 0.15) {
        var r = (spiralR * (0.25 + (t / (Math.PI * 2.4)) * 0.75)) * (1 - a * 0.18);
        var px = cx + Math.cos(start + t) * r;
        var py = cy + Math.sin(start + t) * r * 0.75;
        t === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.fillStyle = "#38b6ff";
    ctx.beginPath(); ctx.arc(cx, cy, 5 + hPow * 3, 0, Math.PI * 2); ctx.fill();
    // rain streaks (left half)
    ctx.strokeStyle = "rgba(160,210,255,0.55)";
    ctx.lineWidth = 1;
    rain.forEach(function (d) {
      d.y += d.s * (1 + hPow * 2);
      if (d.y > 1) { d.y = -0.05; d.x = Math.random() * 0.5; }
      var rx = d.x * W, ry = d.y * H;
      ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - 4, ry + 12); ctx.stroke();
    });

    // --- VOLCANO (right): mountain, lava glow, lava particles, smoke
    var vx = W * 0.75, base = H * 0.82;
    ctx.fillStyle = "#2b1a12";
    ctx.beginPath();
    ctx.moveTo(vx - W * 0.19, base);
    ctx.lineTo(vx - W * 0.03, H * 0.28);
    ctx.lineTo(vx + W * 0.03, H * 0.28);
    ctx.lineTo(vx + W * 0.19, base);
    ctx.closePath(); ctx.fill();
    // glowing crater + lava flow
    var glow = ctx.createRadialGradient(vx, H * 0.28, 2, vx, H * 0.28, 46 + vPow * 30);
    glow.addColorStop(0, "rgba(255,180,60,0.95)");
    glow.addColorStop(0.5, "rgba(255,90,20,0.55)");
    glow.addColorStop(1, "rgba(255,60,10,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(vx, H * 0.28, 46 + vPow * 30, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#ff5a14";
    ctx.lineWidth = 3 + vPow * 2;
    ctx.beginPath();
    ctx.moveTo(vx, H * 0.28);
    ctx.lineTo(vx - W * 0.02, H * 0.5);
    ctx.lineTo(vx + W * 0.015, H * 0.66);
    ctx.lineTo(vx - W * 0.01, base);
    ctx.stroke();
    // rising lava particles
    lava.forEach(function (p) {
      p.y -= p.s * (1 + vPow * 2.5);
      if (p.y < 0.26) { p.y = 0.8; p.x = 0.62 + Math.random() * 0.26; }
      ctx.fillStyle = Math.random() > 0.5 ? "#ffb43c" : "#ff5a14";
      ctx.beginPath(); ctx.arc(p.x * W, p.y * H, p.r, 0, Math.PI * 2); ctx.fill();
    });
    // smoke puffs
    smoke.forEach(function (p) {
      p.y -= p.v; p.r += 0.05;
      if (p.y < 0.02) { p.y = 0.3; p.r = 8 + Math.random() * 10; }
      ctx.fillStyle = "rgba(120,120,120,0.28)";
      ctx.beginPath(); ctx.arc(p.x * W, p.y * H, p.r, 0, Math.PI * 2); ctx.fill();
    });

    // --- winner burst sparks
    sparks = sparks.filter(function (p) { return p.life > 0; });
    sparks.forEach(function (p) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life -= 0.02;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.col;
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    });

    // divider
    ctx.strokeStyle = "rgba(245,194,66,0.35)";
    ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.setLineDash([]);

    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  // ---------------------------------------------------------- natural sounds (optional, no music)
  var audioCtx = null, soundOn = false, soundNodes = null;
  function makeNoise(ctx2) {
    var buf = ctx2.createBuffer(1, ctx2.sampleRate * 2, ctx2.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    var src = ctx2.createBufferSource();
    src.buffer = buf; src.loop = true;
    return src;
  }
  $("sound-btn").addEventListener("click", function () {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (!soundOn) {
      var wind = makeNoise(audioCtx);
      var bp = audioCtx.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 400; bp.Q.value = 0.6;
      var g1 = audioCtx.createGain(); g1.gain.value = 0.05;
      wind.connect(bp); bp.connect(g1); g1.connect(audioCtx.destination); wind.start();
      var rumble = audioCtx.createOscillator();
      rumble.type = "sine"; rumble.frequency.value = 55;
      var g2 = audioCtx.createGain(); g2.gain.value = 0.03;
      rumble.connect(g2); g2.connect(audioCtx.destination); rumble.start();
      soundNodes = { wind: wind, rumble: rumble };
      soundOn = true;
      $("sound-btn").textContent = "🔊 Sound on";
    } else {
      try { soundNodes.wind.stop(); soundNodes.rumble.stop(); } catch (e) {}
      soundNodes = null; soundOn = false;
      $("sound-btn").textContent = "🔇 Sound";
    }
  });
})();
