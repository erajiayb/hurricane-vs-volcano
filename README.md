# 🌪 HURRICANE vs VOLCANO 🌋 — Interactive LIVE Game

An interactive live-stream game for TikTok / YouTube / Facebook. Viewers vote
by commenting **1** for Hurricane (blue) or **2** for Volcano (orange/red).
Each vote adds power, gifts add a big burst, rounds last 60 seconds, and the
winner is announced with a visual storm-surge / eruption effect.

**Content rules (by design):** halal — no people, faces or animals anywhere,
only natural forces. No music — only optional natural sounds (wind / rain /
low rumble, generated in the browser, off by default).

## How it works

```
Viewer comments "1" / "2" in the LIVE chat
        │
        ▼
TikTokLive reader (Python, in app.py) picks the comment up in real time
        │
        ▼
Game server updates the score and pushes it to every viewer over WebSocket
        │
        ▼
The game page (Canvas 2D) animates: hurricane spiral vs volcano lava
```

* **TikTok:** the reader uses the open-source `TikTokLive` library. It only
  needs the TikTok username (default `@backtothecreatorr`, change with env
  var `TIKTOK_USERNAME`). No API key, no login.
* **YouTube / Facebook:** not wired in yet — the same server can take a
  YouTube Live Chat API reader or a Facebook Graph API reader later; the
  vote intake is one function (`add_vote`) so a new reader just calls it.
* **If TikTok is not live or the reader fails:** the game never stops. It
  runs in **DEMO mode** (badge on screen) — votes come from tapping the
  team panels or pressing keys `1` / `2`. The reader reconnects with
  backoff (5s → 10s → 20s → 30s → 60s).

## Rules

| Action | Effect |
|---|---|
| Comment `1` (or "hurricane"/"storm") | +1 power to Hurricane |
| Comment `2` (or "volcano"/"lava") | +1 power to Volcano |
| Gift | **+25 power burst** to a team (see below) |
| Round length | 60 seconds, then winner announced (8s), scores reset |

**Gift → team mapping** (`gift_team_for` in `app.py`): the gift's name is
checked for storm/water words (storm, rain, wave, ocean, wind…) → Hurricane,
or fire words (fire, flame, lava, rose, gold…) → Volcano. Any other gift goes
to the team **currently in the lead** (Hurricane on a tie), so the burst is
always visible. This is a best-effort mapping — TikTok gift names are not a
reliable team signal, so the streamer should announce the mapping on screen
(e.g. "send a Rose for Volcano, a Wave for Hurricane").

## Files

```
hurricane-vs-volcano-game/
├── app.py             # FastAPI server, game loop, TikTok reader, WebSocket
├── requirements.txt   # fastapi, uvicorn, TikTokLive
├── Dockerfile         # HF Spaces container (port 7860)
├── README.md          # this file
└── static/
    ├── index.html     # game page (English on-screen text)
    ├── style.css      # vertical-friendly layout (9:16 on phones)
    └── app.js         # WebSocket client, Canvas 2D animation, sounds
```

## Run locally (test)

```bash
cd hurricane-vs-volcano-game
pip install -r requirements.txt
python app.py            # or: uvicorn app:app --host 0.0.0.0 --port 7860
```

Then open http://localhost:7860 — you should see the game in **DEMO** mode
(the TikTok account is not live while testing). Try:
* tap the Hurricane / Volcano panels, or press `1` / `2` → scores go up
* the timer counts down from 60; when it hits 0 a winner is announced,
  round wins update, and the next round starts
* `curl http://localhost:7860/state` → JSON game state
* `curl -X POST http://localhost:7860/vote/hurricane` → test a vote
* `curl -X POST http://localhost:7860/gift/volcano?name=Rose` → test a gift burst

The TikTok reader is verified by import: if `TikTokLive` is installed, the
reader thread starts and logs `connecting to @backtothecreatorr ...`, then
falls back to DEMO mode when the account is not live. No real live is
needed for any test.

Optional env vars: `TIKTOK_USERNAME` (default `@backtothecreatorr`),
`ROUND_SECONDS` (default `60`), `PORT` (default `7860`).

## Deploy on Hugging Face Spaces (free, no card)

1. Create a free account at https://huggingface.co/join (email + password,
   **no credit card**).
2. **New Space** → name it e.g. `hurricane-vs-volcano` → SDK: **Docker** →
   hardware: **CPU basic (free)** → Visibility: **Public** (required for free).
3. Upload all files in this folder (or push with git — HF gives you a repo).
4. The Space builds the Docker image and starts the app on port 7860.
   Your game is live at `https://huggingface.co/spaces/<you>/hurricane-vs-volcano`.
5. During a TikTok LIVE, open that URL on your phone, start the LIVE in
   screen-share / mobile-gaming mode showing the game page, and viewers'
   comments `1` / `2` move the score live.

**Honest note on the SDK:** Hugging Face's free CPU tier is what this
project is built for (Docker SDK). In mid-2026 some users reported the
Docker SDK being temporarily pay-gated for new Spaces. If you hit that at
creation time, the **Gradio / Static SDKs are not a fallback for this game**
— it needs a long-running Python server with WebSockets, which only the
Docker SDK provides. In that case: wait/retry the Docker SDK, or run the
same container on Render's free tier instead (same Dockerfile, same port).

## Going live — checklist

1. TikTok LIVE suspension on @backtothecreatorr ends **Dec 1, 2026 20:10** —
   no LIVE before then.
2. Be **present with your voice** during the stream. Fully unattended /
   automated streams can lose monetisation eligibility.
3. No copyrighted music in the stream. The game's own sounds are
   generated wind/rain/rumble only, and off by default.
4. Keep rounds honest: the scoreboard is driven by real comments; DEMO
   votes are only for testing, and the DEMO badge shows while TikTok is
   not connected.
