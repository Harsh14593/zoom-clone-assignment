from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "zoom_clone.db"
DEFAULT_USER_ID = 1


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def row_to_dict(row: sqlite3.Row | None):
    return dict(row) if row else None


def init_db() -> None:
    with get_db() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                avatar_url TEXT
            );

            CREATE TABLE IF NOT EXISTS meetings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                description TEXT,
                meeting_type TEXT NOT NULL CHECK (meeting_type IN ('instant', 'scheduled')),
                invite_link TEXT NOT NULL,
                host_user_id INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                duration_minutes INTEGER NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('scheduled', 'live', 'ended')),
                created_at TEXT NOT NULL,
                FOREIGN KEY (host_user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS participants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id INTEGER NOT NULL,
                display_name TEXT NOT NULL,
                joined_at TEXT NOT NULL,
                is_host INTEGER NOT NULL DEFAULT 0,
                muted INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (meeting_id) REFERENCES meetings(id)
            );

            CREATE TABLE IF NOT EXISTS recent_meetings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                occurred_at TEXT NOT NULL,
                FOREIGN KEY (meeting_id) REFERENCES meetings(id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            """
        )

        existing_user = db.execute("SELECT id FROM users WHERE id = ?", (DEFAULT_USER_ID,)).fetchone()
        if not existing_user:
            db.execute(
                "INSERT INTO users (id, name, email, avatar_url) VALUES (?, ?, ?, ?)",
                (DEFAULT_USER_ID, "Harsh Jha", "harsh@example.com", None),
            )

        count = db.execute("SELECT COUNT(*) AS count FROM meetings").fetchone()["count"]
        if count:
            return

        now = datetime.utcnow()
        seeds = [
            (
                "482-913-746",
                "Frontend Sync",
                "Daily UI implementation standup",
                "scheduled",
                "/meeting/482-913-746",
                DEFAULT_USER_ID,
                (now + timedelta(hours=3)).isoformat(),
                30,
                "scheduled",
            ),
            (
                "738-204-119",
                "Scaler Assignment Review",
                "Review database and API design",
                "scheduled",
                "/meeting/738-204-119",
                DEFAULT_USER_ID,
                (now + timedelta(days=1, hours=2)).isoformat(),
                45,
                "scheduled",
            ),
            (
                "615-487-230",
                "Product Walkthrough",
                "Recent meeting sample",
                "instant",
                "/meeting/615-487-230",
                DEFAULT_USER_ID,
                (now - timedelta(days=1)).isoformat(),
                40,
                "ended",
            ),
        ]

        for seed in seeds:
            cursor = db.execute(
                """
                INSERT INTO meetings (
                    meeting_id, title, description, meeting_type, invite_link, host_user_id,
                    start_time, duration_minutes, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (*seed, now.isoformat()),
            )
            meeting_pk = cursor.lastrowid
            db.execute(
                "INSERT INTO participants (meeting_id, display_name, joined_at, is_host) VALUES (?, ?, ?, ?)",
                (meeting_pk, "Harsh Jha", seed[6], 1),
            )
            db.execute(
                "INSERT INTO recent_meetings (meeting_id, user_id, action, occurred_at) VALUES (?, ?, ?, ?)",
                (meeting_pk, DEFAULT_USER_ID, "created", seed[6]),
            )

