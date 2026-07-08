export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
export const WS_BASE_URL =
  process.env.NEXT_PUBLIC_WS_BASE_URL ?? API_BASE_URL.replace(/^http/, "ws");

export type Meeting = {
  id: number;
  meeting_id: string;
  title: string;
  description?: string | null;
  meeting_type: "instant" | "scheduled";
  invite_link: string;
  host_user_id: number;
  host_name?: string;
  start_time: string;
  duration_minutes: number;
  status: "scheduled" | "live" | "ended";
  created_at: string;
  action?: string;
  occurred_at?: string;
  participants?: Participant[];
};

export type Participant = {
  id: number;
  display_name: string;
  joined_at: string;
  is_host: number;
  muted: number;
};

export type DashboardData = {
  user: { id: number; name: string; email: string; avatar_url?: string | null };
  upcoming: Meeting[];
  recent: Meeting[];
};

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(error.detail ?? "Request failed");
  }
  return response.json() as Promise<T>;
}

export function getDashboard() {
  return fetch(`${API_BASE_URL}/api/dashboard`, { cache: "no-store" }).then((res) =>
    parseResponse<DashboardData>(res)
  );
}

export function createInstantMeeting() {
  return fetch(`${API_BASE_URL}/api/meetings/instant`, { method: "POST" }).then((res) =>
    parseResponse<Meeting>(res)
  );
}

export function scheduleMeeting(payload: {
  title: string;
  description?: string;
  start_time: string;
  duration_minutes: number;
}) {
  return fetch(`${API_BASE_URL}/api/meetings/scheduled`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).then((res) => parseResponse<Meeting>(res));
}

export function joinMeeting(payload: { meeting: string; display_name: string }) {
  return fetch(`${API_BASE_URL}/api/meetings/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).then((res) => parseResponse<Meeting>(res));
}

export function getMeeting(meetingId: string) {
  return fetch(`${API_BASE_URL}/api/meetings/${meetingId}`, { cache: "no-store" }).then((res) =>
    parseResponse<Meeting>(res)
  );
}
