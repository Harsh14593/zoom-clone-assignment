"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CalendarPlus, Clock3, Link2, Settings, UserCircle, Users, Video, X } from "lucide-react";
import {
  DashboardData,
  Meeting,
  createInstantMeeting,
  getDashboard,
  joinMeeting,
  scheduleMeeting
} from "./api";

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function meetingHref(meeting: Meeting) {
  return `/meeting/${meeting.meeting_id}`;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [joinOpen, setJoinOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    setError("");
    setLoading(true);
    try {
      setData(await getDashboard());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function startInstantMeeting() {
    setError("");
    try {
      const meeting = await createInstantMeeting();
      window.location.href = meetingHref(meeting);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create meeting");
    }
  }

  const currentTime = useMemo(
    () =>
      new Intl.DateTimeFormat("en-IN", {
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date()),
    []
  );

  return (
    <main className="app-shell">
      <nav className="topbar">
        <div className="brand">
          <span className="brand-mark">z</span>
          <span>Zoom Workplace</span>
        </div>
        <div className="nav-links">
          <a className="active" href="/">Home</a>
          <a href="#upcoming-meetings">Meetings</a>
          <a href="#team-chat">Team Chat</a>
          <a href="#contacts">Contacts</a>
        </div>
        <div className="nav-actions">
          <button aria-label="Settings" onClick={() => setSettingsOpen((value) => !value)}>
            <Settings size={18} />
            <span>Settings</span>
          </button>
          <button aria-label="Profile" onClick={() => setProfileOpen((value) => !value)}>
            <UserCircle size={20} />
            <span>Profile</span>
          </button>
        </div>
      </nav>

      <section className="dashboard">
        <aside className="sidebar">
          <button className="primary-action" onClick={startInstantMeeting}>
            <Video size={22} />
            New Meeting
          </button>
          <button className="secondary-action" onClick={() => setJoinOpen(true)}>
            <Link2 size={22} />
            Join
          </button>
          <button className="secondary-action" onClick={() => setScheduleOpen(true)}>
            <CalendarPlus size={22} />
            Schedule
          </button>
        </aside>

        <section className="content">
          <div className="welcome-band">
            <div>
              <p>{currentTime}</p>
              <h1>Welcome back{data?.user?.name ? `, ${data.user.name.split(" ")[0]}` : ""}</h1>
            </div>
            <div className="meeting-summary">
              <Clock3 size={18} />
              <span>{data?.upcoming.length ?? 0} upcoming meetings</span>
            </div>
          </div>

          {error ? <div className="error-banner">{error}</div> : null}
          {loading ? <div className="empty-state">Loading meetings...</div> : null}

          <section className="section-grid">
            <MeetingList id="upcoming-meetings" title="Upcoming Meetings" meetings={data?.upcoming ?? []} empty="No scheduled meetings yet." />
            <MeetingList title="Recent Meetings" meetings={data?.recent ?? []} empty="No recent meetings yet." />
          </section>

          <section className="info-strip">
            <div id="team-chat">
              <h2>Team Chat</h2>
              <p>Workspace chat placeholder for assignment navigation.</p>
            </div>
            <div id="contacts">
              <h2>Contacts</h2>
              <p>Saved teammates and guests appear here in a full product build.</p>
            </div>
          </section>
        </section>
      </section>

      {joinOpen ? (
        <JoinModal
          onClose={() => setJoinOpen(false)}
          onJoined={(meeting) => {
            window.location.href = meetingHref(meeting);
          }}
        />
      ) : null}
      {scheduleOpen ? (
        <ScheduleModal
          onClose={() => setScheduleOpen(false)}
          onScheduled={() => {
            setScheduleOpen(false);
            refresh();
          }}
        />
      ) : null}
      {settingsOpen ? <SettingsPanel onClose={() => setSettingsOpen(false)} /> : null}
      {profileOpen ? <ProfilePanel user={data?.user ?? null} onClose={() => setProfileOpen(false)} /> : null}
    </main>
  );
}

function MeetingList({ id, title, meetings, empty }: { id?: string; title: string; meetings: Meeting[]; empty: string }) {
  return (
    <section className="meeting-panel" id={id}>
      <div className="panel-heading">
        <h2>{title}</h2>
        <span>{meetings.length}</span>
      </div>
      <div className="meeting-list">
        {meetings.length ? (
          meetings.map((meeting) => (
            <a className="meeting-row" href={meetingHref(meeting)} key={`${title}-${meeting.id}-${meeting.occurred_at ?? ""}`}>
              <div>
                <h3>{meeting.title}</h3>
                <p>{formatTime(meeting.start_time)} · {meeting.duration_minutes} min</p>
              </div>
              <span className={`status ${meeting.status}`}>{meeting.status}</span>
            </a>
          ))
        ) : (
          <div className="empty-state">{empty}</div>
        )}
      </div>
    </section>
  );
}

function JoinModal({ onClose, onJoined }: { onClose: () => void; onJoined: (meeting: Meeting) => void }) {
  const [meeting, setMeeting] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      onJoined(await joinMeeting({ meeting, display_name: displayName }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to join meeting");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Join Meeting" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <label>
          Meeting ID or invite link
          <input required value={meeting} onChange={(event) => setMeeting(event.target.value)} placeholder="482-913-746" />
        </label>
        <label>
          Display name
          <input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Harsh Jha" />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="submit-button" disabled={submitting}>{submitting ? "Joining..." : "Join"}</button>
      </form>
    </Modal>
  );
}

function ScheduleModal({ onClose, onScheduled }: { onClose: () => void; onScheduled: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startTime, setStartTime] = useState("");
  const [duration, setDuration] = useState(30);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await scheduleMeeting({
        title,
        description,
        start_time: new Date(startTime).toISOString(),
        duration_minutes: duration
      });
      onScheduled();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to schedule meeting");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Schedule Meeting" onClose={onClose}>
      <form className="modal-form" onSubmit={onSubmit}>
        <label>
          Title
          <input required minLength={3} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Design review" />
        </label>
        <label>
          Description
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Agenda or meeting notes" />
        </label>
        <div className="form-grid">
          <label>
            Date and time
            <input required type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
          </label>
          <label>
            Duration
            <select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={45}>45 min</option>
              <option value={60}>60 min</option>
              <option value={90}>90 min</option>
            </select>
          </label>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="submit-button" disabled={submitting}>{submitting ? "Scheduling..." : "Schedule"}</button>
      </form>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-heading">
          <h2>{title}</h2>
          <button onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [startWithVideo, setStartWithVideo] = useState(true);
  const [startMuted, setStartMuted] = useState(false);
  const [compactView, setCompactView] = useState(false);

  return (
    <div className="panel-backdrop" role="dialog" aria-modal="true">
      <aside className="side-panel">
        <div className="side-panel-heading">
          <div>
            <h2>Settings</h2>
            <p>Meeting defaults and display preferences.</p>
          </div>
          <button aria-label="Close settings" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="toggle-row">
          <span>Start meetings with video</span>
          <input type="checkbox" checked={startWithVideo} onChange={(event) => setStartWithVideo(event.target.checked)} />
        </label>
        <label className="toggle-row">
          <span>Start muted</span>
          <input type="checkbox" checked={startMuted} onChange={(event) => setStartMuted(event.target.checked)} />
        </label>
        <label className="toggle-row">
          <span>Compact room view</span>
          <input type="checkbox" checked={compactView} onChange={(event) => setCompactView(event.target.checked)} />
        </label>
        <div className="panel-note">
          These are local UI preferences in this assignment build.
        </div>
      </aside>
    </div>
  );
}

function ProfilePanel({ user, onClose }: { user: DashboardData["user"] | null; onClose: () => void }) {
  return (
    <div className="panel-backdrop" role="dialog" aria-modal="true">
      <aside className="side-panel">
        <div className="side-panel-heading">
          <div>
            <h2>Profile</h2>
            <p>Your workspace identity.</p>
          </div>
          <button aria-label="Close profile" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="profile-card">
          <div className="profile-avatar">{user?.name?.slice(0, 1) ?? "U"}</div>
          <div>
            <strong>{user?.name ?? "User"}</strong>
            <p>{user?.email ?? "No email available"}</p>
          </div>
        </div>
        <div className="panel-note">
          Authentication is intentionally omitted in the assignment, so this panel shows the seeded default user.
        </div>
      </aside>
    </div>
  );
}
