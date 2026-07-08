from __future__ import annotations

import os
import random
import re
from datetime import datetime
from typing import Annotated
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .database import DEFAULT_USER_ID, get_db, init_db, row_to_dict

app = FastAPI(title="Zoom Clone API", version="1.0.0")

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        FRONTEND_URL,
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SignalingRoom:
    def __init__(self) -> None:
        self.connections: dict[str, dict[str, WebSocket]] = {}
        self.names: dict[str, dict[str, str]] = {}

    async def connect(self, meeting_id: str, peer_id: str, display_name: str, websocket: WebSocket) -> None:
        await websocket.accept()
        room = self.connections.setdefault(meeting_id, {})
        names = self.names.setdefault(meeting_id, {})
        existing_peers = [{"peerId": key, "displayName": names.get(key, "Guest")} for key in room]
        room[peer_id] = websocket
        names[peer_id] = display_name
        await websocket.send_json({"type": "room-peers", "peers": existing_peers})
        await self.broadcast(
            meeting_id,
            {"type": "peer-joined", "peerId": peer_id, "displayName": display_name},
            exclude=peer_id,
        )

    def disconnect(self, meeting_id: str, peer_id: str) -> None:
        self.connections.get(meeting_id, {}).pop(peer_id, None)
        self.names.get(meeting_id, {}).pop(peer_id, None)
        if not self.connections.get(meeting_id):
            self.connections.pop(meeting_id, None)
            self.names.pop(meeting_id, None)

    async def broadcast(self, meeting_id: str, message: dict, exclude: str | None = None) -> None:
        for peer_id, websocket in list(self.connections.get(meeting_id, {}).items()):
            if peer_id != exclude:
                await websocket.send_json(message)

    async def send_to_peer(self, meeting_id: str, target_peer_id: str, message: dict) -> None:
        websocket = self.connections.get(meeting_id, {}).get(target_peer_id)
        if websocket:
            await websocket.send_json(message)


signaling = SignalingRoom()


class ScheduleMeetingRequest(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    start_time: datetime
    duration_minutes: int = Field(ge=15, le=240)


class JoinMeetingRequest(BaseModel):
    meeting: str = Field(min_length=3)
    display_name: str = Field(min_length=2, max_length=80)


def meeting_id_from_value(value: str) -> str:
    match = re.search(r"(\d{3}-\d{3}-\d{3})", value)
    if match:
        return match.group(1)
    compact = re.sub(r"\D", "", value)
    if len(compact) == 9:
        return f"{compact[:3]}-{compact[3:6]}-{compact[6:]}"
    return value.strip()


def generate_meeting_id(db) -> str:
    while True:
        raw = "".join(str(random.randint(0, 9)) for _ in range(9))
        meeting_id = f"{raw[:3]}-{raw[3:6]}-{raw[6:]}"
        exists = db.execute("SELECT id FROM meetings WHERE meeting_id = ?", (meeting_id,)).fetchone()
        if not exists:
            return meeting_id


def invite_link_for(meeting_id: str) -> str:
    return f"{FRONTEND_URL}/meeting/{meeting_id}"


def meeting_with_participants(db, meeting_id: str):
    meeting = db.execute(
        """
        SELECT m.*, u.name AS host_name
        FROM meetings m
        JOIN users u ON u.id = m.host_user_id
        WHERE m.meeting_id = ?
        """,
        (meeting_id,),
    ).fetchone()
    if not meeting:
        return None
    participants = db.execute(
        """
        SELECT id, display_name, joined_at, is_host, muted
        FROM participants
        WHERE meeting_id = ?
        ORDER BY is_host DESC, joined_at ASC
        """,
        (meeting["id"],),
    ).fetchall()
    result = row_to_dict(meeting)
    result["participants"] = [row_to_dict(row) for row in participants]
    return result


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/dashboard")
def dashboard():
    now = datetime.utcnow().isoformat()
    with get_db() as db:
        user = row_to_dict(db.execute("SELECT * FROM users WHERE id = ?", (DEFAULT_USER_ID,)).fetchone())
        upcoming = db.execute(
            """
            SELECT * FROM meetings
            WHERE status IN ('scheduled', 'live') AND start_time >= ?
            ORDER BY start_time ASC
            LIMIT 8
            """,
            (now,),
        ).fetchall()
        recent = db.execute(
            """
            SELECT m.*, r.action, r.occurred_at
            FROM recent_meetings r
            JOIN meetings m ON m.id = r.meeting_id
            WHERE r.user_id = ?
            ORDER BY r.occurred_at DESC
            LIMIT 8
            """,
            (DEFAULT_USER_ID,),
        ).fetchall()
        return {
            "user": user,
            "upcoming": [row_to_dict(row) for row in upcoming],
            "recent": [row_to_dict(row) for row in recent],
        }


@app.post("/api/meetings/instant", status_code=201)
def create_instant_meeting():
    with get_db() as db:
        meeting_id = generate_meeting_id(db)
        now = datetime.utcnow().isoformat()
        cursor = db.execute(
            """
            INSERT INTO meetings (
                meeting_id, title, description, meeting_type, invite_link, host_user_id,
                start_time, duration_minutes, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                meeting_id,
                "Instant Meeting",
                "Started from dashboard",
                "instant",
                invite_link_for(meeting_id),
                DEFAULT_USER_ID,
                now,
                60,
                "live",
                now,
            ),
        )
        meeting_pk = cursor.lastrowid
        db.execute(
            "INSERT INTO participants (meeting_id, display_name, joined_at, is_host) VALUES (?, ?, ?, ?)",
            (meeting_pk, "Harsh Jha", now, 1),
        )
        db.execute(
            "INSERT INTO recent_meetings (meeting_id, user_id, action, occurred_at) VALUES (?, ?, ?, ?)",
            (meeting_pk, DEFAULT_USER_ID, "created", now),
        )
        return meeting_with_participants(db, meeting_id)


@app.post("/api/meetings/scheduled", status_code=201)
def schedule_meeting(payload: ScheduleMeetingRequest):
    with get_db() as db:
        meeting_id = generate_meeting_id(db)
        now = datetime.utcnow().isoformat()
        cursor = db.execute(
            """
            INSERT INTO meetings (
                meeting_id, title, description, meeting_type, invite_link, host_user_id,
                start_time, duration_minutes, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                meeting_id,
                payload.title,
                payload.description,
                "scheduled",
                invite_link_for(meeting_id),
                DEFAULT_USER_ID,
                payload.start_time.isoformat(),
                payload.duration_minutes,
                "scheduled",
                now,
            ),
        )
        db.execute(
            "INSERT INTO recent_meetings (meeting_id, user_id, action, occurred_at) VALUES (?, ?, ?, ?)",
            (cursor.lastrowid, DEFAULT_USER_ID, "scheduled", now),
        )
        return meeting_with_participants(db, meeting_id)


@app.get("/api/meetings/validate")
def validate_meeting(value: Annotated[str, Query(min_length=3)]):
    meeting_id = meeting_id_from_value(value)
    with get_db() as db:
        meeting = db.execute("SELECT meeting_id, title, status FROM meetings WHERE meeting_id = ?", (meeting_id,)).fetchone()
        if not meeting:
            return {"exists": False, "meeting_id": meeting_id}
        return {"exists": True, **row_to_dict(meeting)}


@app.post("/api/meetings/join")
def join_meeting(payload: JoinMeetingRequest):
    meeting_id = meeting_id_from_value(payload.meeting)
    now = datetime.utcnow().isoformat()
    with get_db() as db:
        meeting = db.execute("SELECT id, status FROM meetings WHERE meeting_id = ?", (meeting_id,)).fetchone()
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        if meeting["status"] == "ended":
            raise HTTPException(status_code=409, detail="Meeting has ended")
        if meeting["status"] == "scheduled":
            db.execute("UPDATE meetings SET status = 'live' WHERE id = ?", (meeting["id"],))
        db.execute(
            "INSERT INTO participants (meeting_id, display_name, joined_at, is_host) VALUES (?, ?, ?, ?)",
            (meeting["id"], payload.display_name.strip(), now, 0),
        )
        db.execute(
            "INSERT INTO recent_meetings (meeting_id, user_id, action, occurred_at) VALUES (?, ?, ?, ?)",
            (meeting["id"], DEFAULT_USER_ID, "joined", now),
        )
        return meeting_with_participants(db, meeting_id)


@app.get("/api/meetings/{meeting_id}")
def get_meeting(meeting_id: str):
    with get_db() as db:
        meeting = meeting_with_participants(db, meeting_id_from_value(meeting_id))
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        return meeting


@app.websocket("/ws/meetings/{meeting_id}")
async def meeting_signaling(
    websocket: WebSocket,
    meeting_id: str,
    peer_id: str | None = None,
    display_name: str = "Guest",
):
    normalized_meeting_id = meeting_id_from_value(meeting_id)
    with get_db() as db:
        meeting = db.execute("SELECT id FROM meetings WHERE meeting_id = ?", (normalized_meeting_id,)).fetchone()
        if not meeting:
            await websocket.close(code=4404)
            return

    current_peer_id = peer_id or str(uuid4())
    await signaling.connect(normalized_meeting_id, current_peer_id, display_name, websocket)
    try:
        while True:
            message = await websocket.receive_json()
            target_peer_id = message.get("targetPeerId")
            if target_peer_id:
                message["fromPeerId"] = current_peer_id
                message["fromDisplayName"] = display_name
                await signaling.send_to_peer(normalized_meeting_id, target_peer_id, message)
    except WebSocketDisconnect:
        signaling.disconnect(normalized_meeting_id, current_peer_id)
        await signaling.broadcast(
            normalized_meeting_id,
            {"type": "peer-left", "peerId": current_peer_id},
            exclude=current_peer_id,
        )
