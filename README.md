# Zoom Clone Assignment

Full-stack Zoom-style meeting dashboard built with Next.js, FastAPI, and SQLite.

## Tech Stack

- Frontend: Next.js, React, TypeScript
- Backend: Python, FastAPI
- Database: SQLite

## Features

- Zoom-inspired dashboard with navbar, profile/settings placeholders, and action buttons
- Instant meeting creation with generated meeting ID and invite link
- Join meeting by meeting ID or invite link after entering display name
- Meeting existence validation
- Scheduled meetings with title, description, date/time, duration, and generated link
- Upcoming and recent meetings sections
- Meeting room page with participants and basic host controls placeholders
- Real-time browser audio/video between participants using WebRTC
- WebSocket signaling for peer discovery, offers, answers, and ICE candidates
- Copyable invite links for sharing a meeting room
- Seeded sample data for evaluation

## Assumptions

- A default user is already logged in, so authentication is intentionally omitted.
- Browser camera and microphone access requires `localhost` or HTTPS in production.
- WebRTC uses a public STUN server. For production-grade reliability across strict NATs, add a TURN server.
- Host controls are modeled in the UI; muting/removing all participants can be connected to the existing WebSocket room state.

## Setup

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The backend creates and seeds `zoom_clone.db` automatically on startup.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

If your backend runs on another URL, create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_WS_BASE_URL=ws://localhost:8000
```

## Deployment

The backend and frontend are deployed separately.

### Backend (Render)

1. Create a new **Web Service** on Render pointing at this repo, with **Root Directory** set to `backend`.
2. Build command: `pip install -r requirements.txt`
3. Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. Set an environment variable `FRONTEND_URL` to your deployed Vercel URL (e.g. `https://your-app.vercel.app`) so CORS allows requests from it.

Render's default filesystem is ephemeral, so `zoom_clone.db` resets (re-seeds) on every redeploy/restart — expected for this assignment.

### Frontend (Vercel)

1. Import this repo on Vercel with **Root Directory** set to `frontend`.
2. Set environment variables:
   ```env
   NEXT_PUBLIC_API_BASE_URL=https://your-backend.onrender.com
   NEXT_PUBLIC_WS_BASE_URL=wss://your-backend.onrender.com
   ```
3. Deploy. Vercel auto-detects the Next.js build.

Live links:
- Frontend: _TBD_
- Backend: _TBD_

## Real-Time Meeting Flow

1. Start a new meeting from the dashboard.
2. Enter a display name and allow camera/microphone permissions.
3. Click `Invite` or `Copy invite link`.
4. Open the copied meeting link in another browser/device, enter a name, and join.
5. Both users connect through the backend WebSocket signaling server and exchange WebRTC media directly.

## Database Schema

- `users`: default user profile
- `meetings`: instant and scheduled meetings, generated IDs, links, start time, duration, status
- `participants`: display names linked to joined meetings
- `recent_meetings`: dashboard activity history

## API Overview

- `GET /api/dashboard`
- `POST /api/meetings/instant`
- `POST /api/meetings/scheduled`
- `GET /api/meetings/validate?value=...`
- `POST /api/meetings/join`
- `GET /api/meetings/{meeting_id}`
- `WS /ws/meetings/{meeting_id}`
