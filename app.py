"""
Hurricane vs Volcano — interactive LIVE game.

One Python app (FastAPI) that:
  * serves the game page (static/index.html, Canvas 2D animation)
  * pushes live game state to every viewer over WebSocket (/ws)
  * reads TikTok LIVE comments/gifts with the TikTokLive library
    (username @backtothecreatorr) and turns them into votes
  * NEVER crashes if TikTok is not live / the reader fails:
    the game keeps running in DEMO mode (click panels or press 1 / 2)

Rules:
  * viewers comment "1" = Hurricane (blue), "2" = Volcano (orange/red)
  * each valid vote = +1 power to that team
  * a gift = +25 power burst to the team the sender supports
    (mapped by gift name when possible, otherwise to the team
    currently in the lead — see README)
  * rounds last 60 seconds, then a winner is announced,
    round wins are tallied, scores reset for the next round

Halal / content rules enforced by design:
  * no people, faces or animals anywhere — only natural forces
  * no music — only optional natural sounds (wind / rain / rumble),
    off by default, mutable, generated with WebAudio (no audio files)

Run locally:
    pip install -r requirements.txt
    python app.py            # or: uvicorn app:app --host 0.0.0.0 --port 7860
    open http://localhost:7860

On Hugging Face Spaces (Docker SDK) the container listens on $PORT
(default 7860). Set env var TIKTOK_USERNAME to change the account
that is listened to (default: @backtothecreatorr).
"""

import asyncio
import json
import os
import queue
import threading
import time
from dataclasses import dataclass, field

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# ---------------------------------------------------------------- config
TIKTOK_USERNAME = os.environ.get("TIKTOK_USERNAME", "@backtothecreatorr")
ROUND_SECONDS = int(os.environ.get("ROUND_SECONDS", "60"))
VOTE_POWER = 1
GIFT_BURST = 25
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "7860"))

# ---------------------------------------------------------------- state
@dataclass
class GameState:
    round_number: int = 1
    phase: str = "battle"          # "battle" | "winner"
    time_left: int = ROUND_SECONDS
    hurricane: int = 0
    volcano: int = 0
    round_wins_hurricane: int = 0
    round_wins_volcano: int = 0
    winner: str = ""               # "hurricane" | "volcano" | "tie" | ""
    mode: str = "DEMO"             # "DEMO" | "LIVE"
    live_viewers: int = 0
    events: list = field(default_factory=list)  # recent events, newest first
    total_votes: int = 0
    total_gifts: int = 0

    def to_dict(self):
        return {
            "round_number": self.round_number,
            "phase": self.phase,
            "time_left": self.time_left,
            "round_seconds": ROUND_SECONDS,
            "hurricane": self.hurricane,
            "volcano": self.volcano,
            "round_wins_hurricane": self.round_wins_hurricane,
            "round_wins_volcano": self.round_wins_volcano,
            "winner": self.winner,
            "mode": self.mode,
            "live_viewers": self.live_viewers,
            "events": self.events[:12],
            "total_votes": self.total_votes,
            "total_gifts": self.total_gifts,
        }


state = GameState()
# RLock (not Lock): the game loop calls log_event() while already
# holding the lock when a round ends — a plain Lock would deadlock.
state_lock = threading.RLock()
# Events produced by the TikTok reader thread (and only there).
event_queue: queue.Queue = queue.Queue()
# Connected WebSocket clients.
clients: set = set()

app = FastAPI(title="Hurricane vs Volcano — Interactive LIVE Game")
app.mount("/static", StaticFiles(directory="static"), name="static")


def log_event(text: str):
    with state_lock:
        state.events.insert(0, {"text": text, "t": time.strftime("%H:%M:%S")})
        state.events = state.events[:12]


def add_vote(team: str, source: str = "demo", username: str = ""):
    """Add one vote to a team. Thread-safe; called from any thread."""
    if team not in ("hurricane", "volcano"):
        return
    with state_lock:
        if state.phase != "battle":
            return
        if team == "hurricane":
            state.hurricane += VOTE_POWER
        else:
            state.volcano += VOTE_POWER
        state.total_votes += 1
    who = f"@{username} " if username else ""
    label = "HURRICANE" if team == "hurricane" else "VOLCANO"
    log_event(f"{who}{source}: +1 {label}")


def add_gift_burst(team: str, gift_name: str, username: str = ""):
    """A gift adds a big burst (+25) to a team."""
    if team not in ("hurricane", "volcano"):
        return
    with state_lock:
        if state.phase != "battle":
            return
        if team == "hurricane":
            state.hurricane += GIFT_BURST
        else:
            state.volcano += GIFT_BURST
        state.total_gifts += 1
    who = f"@{username} " if username else ""
    label = "HURRICANE" if team == "hurricane" else "VOLCANO"
    log_event(f"{who}sent {gift_name or 'a gift'}: +{GIFT_BURST} {label}!")


def gift_team_for(gift_name: str) -> str:
    """Map a gift to a team by its name; fall back to the leading team.

    Storm/water themed gifts -> Hurricane, fire themed gifts -> Volcano.
    Anything else -> the team currently in the lead (Hurricane on a tie,
    so the burst always lands somewhere visible).
    """
    name = (gift_name or "").lower()
    storm_words = ("storm", "hurricane", "rain", "wave", "ocean", "sea",
                   "cloud", "snow", "ice", "water", "wind", "tornado")
    fire_words = ("fire", "flame", "lava", "volcano", "rose", "heart",
                  "sun", "star", "gold", "crown", "diamond")
    if any(w in name for w in storm_words):
        return "hurricane"
    if any(w in name for w in fire_words):
        return "volcano"
    with state_lock:
        return "hurricane" if state.hurricane >= state.volcano else "volcano"


def parse_vote(text: str):
    """Return 'hurricane' / 'volcano' for a comment, else None.

    Accepts: "1", "2", "1 hurricane", "team 2", the words hurricane /
    volcano / storm / lava, and the keycap emojis 1 / 2.
    """
    t = (text or "").strip().lower()
    if not t:
        return None
    if t.startswith(("1", "1️⃣")) or "hurricane" in t or "storm" in t:
        return "hurricane"
    if t.startswith(("2", "2️⃣")) or "volcano" in t or "lava" in t:
        return "volcano"
    return None


# ---------------------------------------------------------------- TikTok reader
def tiktok_reader_loop():
    """Background thread: listen to TikTok LIVE, push events to the queue.

    Fault-tolerant by design:
      * the TikTokLive import is lazy and guarded — if the library is
        missing the game simply stays in DEMO mode
      * if the account is not live (or the connection drops) we wait
        and reconnect with backoff: 5s, 10s, 20s, 30s, 60s, then 60s
      * the reader NEVER touches game state directly — it only puts
        events on a queue, so a crash here cannot crash the game
    """
    try:
        from TikTokLive import TikTokLiveClient
        from TikTokLive.events import CommentEvent, GiftEvent
    except Exception as exc:  # library missing / broken install
        print(f"[tiktok] TikTokLive unavailable ({exc}) — staying in DEMO mode")
        return

    backoff = 5
    while True:
        try:
            client = TikTokLiveClient(unique_id=TIKTOK_USERNAME)

            @client.on("comment")
            async def on_comment(event: CommentEvent):
                team = parse_vote(event.comment)
                if team:
                    event_queue.put(("vote", team, event.user.nickname or event.user.unique_id or ""))

            @client.on("gift")
            async def on_gift(event: GiftEvent):
                # Only count a gift once: TikTok sends repeats while it
                # is still "streaking"; event.gift.streakable + repeat_end
                # marks the final count of one gift.
                if getattr(event.gift, "streakable", False) and not event.gift.repeat_end:
                    return
                name = ""
                try:
                    name = event.gift.name or ""
                except Exception:
                    pass
                user = ""
                try:
                    user = event.user.nickname or event.user.unique_id or ""
                except Exception:
                    pass
                event_queue.put(("gift", gift_team_for(name), name, user))

            @client.on("connect")
            async def on_connect(_):
                event_queue.put(("mode", "LIVE"))

            @client.on("disconnect")
            async def on_disconnect(_):
                event_queue.put(("mode", "DEMO"))

            print(f"[tiktok] connecting to {TIKTOK_USERNAME} ...")
            client.run()  # blocks until disconnected
            print("[tiktok] disconnected, will retry")
        except Exception as exc:
            print(f"[tiktok] reader error: {exc!r} — retry in {backoff}s")
        event_queue.put(("mode", "DEMO"))
        time.sleep(backoff)
        backoff = min(backoff * 2, 60)


def drain_event_queue():
    """Apply queued TikTok events to the game state (runs in the loop)."""
    while True:
        try:
            item = event_queue.get_nowait()
        except queue.Empty:
            return
        if item[0] == "vote":
            _, team, user = item
            add_vote(team, source="tiktok", username=user)
        elif item[0] == "gift":
            _, team, name, user = item
            add_gift_burst(team, name, username=user)
        elif item[0] == "mode":
            with state_lock:
                state.mode = item[1]
            log_event("LIVE connected — votes from TikTok are live!"
                      if item[1] == "LIVE" else
                      "TikTok disconnected — DEMO mode (tap to vote)")


# ---------------------------------------------------------------- game loop
async def broadcast():
    payload = json.dumps(state.to_dict())
    dead = []
    for ws in list(clients):
        try:
            await ws.send_text(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


async def game_loop():
    """1-second tick: countdown, round end, winner, reset."""
    while True:
        await asyncio.sleep(1)
        drain_event_queue()
        with state_lock:
            if state.phase == "battle":
                state.time_left -= 1
                if state.time_left <= 0:
                    state.phase = "winner"
                    if state.hurricane > state.volcano:
                        state.winner = "hurricane"
                        state.round_wins_hurricane += 1
                    elif state.volcano > state.hurricane:
                        state.winner = "volcano"
                        state.round_wins_volcano += 1
                    else:
                        state.winner = "tie"
                    state.time_left = 8  # show the winner for 8 seconds
                    log_event("Round over! Winner: " +
                              {"hurricane": "HURRICANE",
                               "volcano": "VOLCANO",
                               "tie": "TIE"}.get(state.winner, ""))
            else:  # winner screen
                state.time_left -= 1
                if state.time_left <= 0:
                    state.round_number += 1
                    state.hurricane = 0
                    state.volcano = 0
                    state.winner = ""
                    state.phase = "battle"
                    state.time_left = ROUND_SECONDS
                    log_event(f"Round {state.round_number} — comment 1 or 2 to vote!")
        await broadcast()


@app.on_event("startup")
async def startup():
    log_event("Welcome! Comment 1 for Hurricane, 2 for Volcano.")
    threading.Thread(target=tiktok_reader_loop, daemon=True).start()
    asyncio.create_task(game_loop())


# ---------------------------------------------------------------- routes
@app.get("/")
async def index():
    return FileResponse("static/index.html")


@app.get("/state")
async def get_state():
    drain_event_queue()
    return state.to_dict()


@app.post("/vote/{team}")
async def vote(team: str):
    add_vote(team, source="demo")
    await broadcast()
    return state.to_dict()


@app.post("/gift/{team}")
async def gift(team: str, name: str = "gift"):
    add_gift_burst(team, name)
    await broadcast()
    return state.to_dict()


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    try:
        await ws.send_text(json.dumps(state.to_dict()))
        while True:
            # Clients may send {"vote": "hurricane"} over the socket too.
            msg = await ws.receive_text()
            try:
                data = json.loads(msg)
                if data.get("vote") in ("hurricane", "volcano"):
                    add_vote(data["vote"], source="demo")
                    await broadcast()
            except Exception:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(ws)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT)
