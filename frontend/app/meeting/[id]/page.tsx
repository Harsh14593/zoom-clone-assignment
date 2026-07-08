"use client";

import { RefObject, use, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Mic, MicOff, PhoneOff, ScreenShare, UserMinus, Users, Video, VideoOff } from "lucide-react";
import { Meeting, WS_BASE_URL, getMeeting } from "../../api";

type RemotePeer = {
  peerId: string;
  displayName: string;
  stream?: MediaStream;
};

type SignalMessage = {
  type: string;
  peerId?: string;
  displayName?: string;
  peers?: Array<{ peerId: string; displayName: string }>;
  targetPeerId?: string;
  fromPeerId?: string;
  fromDisplayName?: string;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

function makePeerId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export default function MeetingRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Enter your name to join with camera and microphone.");
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [camera, setCamera] = useState(true);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);

  const peerId = useMemo(makePeerId, []);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const peerNamesRef = useRef<Map<string, string>>(new Map());

  const inviteLink = typeof window === "undefined" ? "" : window.location.href;

  useEffect(() => {
    getMeeting(id)
      .then(setMeeting)
      .catch((err) => setError(err instanceof Error ? err.message : "Meeting not found"));
  }, [id]);

  useEffect(() => {
    return () => leaveMeeting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (joined && localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [joined]);

  function updateRemotePeer(peerIdValue: string, patch: Partial<RemotePeer>) {
    setRemotePeers((current) => {
      const existing = current.find((peer) => peer.peerId === peerIdValue);
      if (existing) {
        return current.map((peer) => (peer.peerId === peerIdValue ? { ...peer, ...patch } : peer));
      }
      return [...current, { peerId: peerIdValue, displayName: peerNamesRef.current.get(peerIdValue) ?? "Guest", ...patch }];
    });
  }

  function removeRemotePeer(peerIdValue: string) {
    peerConnectionsRef.current.get(peerIdValue)?.close();
    peerConnectionsRef.current.delete(peerIdValue);
    peerNamesRef.current.delete(peerIdValue);
    setRemotePeers((current) => current.filter((peer) => peer.peerId !== peerIdValue));
  }

  function sendSignal(message: SignalMessage) {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    }
  }

  function createPeerConnection(targetPeerId: string, targetName: string) {
    const existing = peerConnectionsRef.current.get(targetPeerId);
    if (existing) {
      return existing;
    }

    peerNamesRef.current.set(targetPeerId, targetName);
    updateRemotePeer(targetPeerId, { displayName: targetName });

    const connection = new RTCPeerConnection(rtcConfig);
    peerConnectionsRef.current.set(targetPeerId, connection);

    localStreamRef.current?.getTracks().forEach((track) => {
      connection.addTrack(track, localStreamRef.current as MediaStream);
    });

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal({ type: "ice-candidate", targetPeerId, candidate: event.candidate.toJSON() });
      }
    };

    connection.ontrack = (event) => {
      updateRemotePeer(targetPeerId, {
        displayName: peerNamesRef.current.get(targetPeerId) ?? targetName,
        stream: event.streams[0]
      });
    };

    connection.onconnectionstatechange = () => {
      if (["failed", "disconnected", "closed"].includes(connection.connectionState)) {
        removeRemotePeer(targetPeerId);
      }
    };

    return connection;
  }

  async function callPeer(targetPeerId: string, targetName: string) {
    const connection = createPeerConnection(targetPeerId, targetName);
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    sendSignal({ type: "offer", targetPeerId, offer });
  }

  async function handleSignal(message: SignalMessage) {
    if (message.type === "room-peers") {
      setStatus(message.peers?.length ? "Connecting to people already in the meeting..." : "You are the first person in this meeting.");
      for (const peer of message.peers ?? []) {
        await callPeer(peer.peerId, peer.displayName);
      }
      return;
    }

    if (message.type === "peer-joined" && message.peerId) {
      peerNamesRef.current.set(message.peerId, message.displayName ?? "Guest");
      updateRemotePeer(message.peerId, { displayName: message.displayName ?? "Guest" });
      setStatus(`${message.displayName ?? "Someone"} joined.`);
      return;
    }

    if (message.type === "peer-left" && message.peerId) {
      removeRemotePeer(message.peerId);
      setStatus("A participant left the meeting.");
      return;
    }

    const fromPeerId = message.fromPeerId;
    if (!fromPeerId) {
      return;
    }

    const connection = createPeerConnection(fromPeerId, message.fromDisplayName ?? "Guest");
    if (message.type === "offer" && message.offer) {
      await connection.setRemoteDescription(message.offer);
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      sendSignal({ type: "answer", targetPeerId: fromPeerId, answer });
    }

    if (message.type === "answer" && message.answer) {
      await connection.setRemoteDescription(message.answer);
    }

    if (message.type === "ice-candidate" && message.candidate) {
      await connection.addIceCandidate(message.candidate);
    }
  }

  async function joinRealtimeMeeting() {
    if (!displayName.trim()) {
      setError("Enter a display name before joining.");
      return;
    }

    setError("");
    setStatus("Requesting camera and microphone access...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      cameraStreamRef.current = stream;
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const socket = new WebSocket(
        `${WS_BASE_URL}/ws/meetings/${id}?peer_id=${encodeURIComponent(peerId)}&display_name=${encodeURIComponent(displayName.trim())}`
      );
      socketRef.current = socket;
      socket.onopen = () => {
        setJoined(true);
        setStatus("Connected. Share the invite link to bring someone into this room.");
      };
      socket.onmessage = (event) => {
        handleSignal(JSON.parse(event.data)).catch((err) => setError(err instanceof Error ? err.message : "Signaling failed"));
      };
      socket.onclose = () => setStatus("Disconnected from the signaling server.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to access camera or microphone");
      setStatus("Camera and microphone are required for a real-time meeting.");
    }
  }

  function toggleMute() {
    const nextMuted = !muted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setMuted(nextMuted);
  }

  function toggleCamera() {
    const nextCamera = !camera;
    const targetStream = sharingScreen ? cameraStreamRef.current : localStreamRef.current;
    targetStream?.getVideoTracks().forEach((track) => {
      track.enabled = nextCamera;
    });
    if (!sharingScreen) {
      setCamera(nextCamera);
    } else {
      setCamera(nextCamera);
    }
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(inviteLink);
    setStatus("Invite link copied.");
  }

  async function toggleShareScreen() {
    if (!sharingScreen) {
      setError("");
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        screenStreamRef.current = displayStream;
        const screenTrack = displayStream.getVideoTracks()[0];
        const audioTracks = cameraStreamRef.current?.getAudioTracks() ?? [];
        localStreamRef.current = new MediaStream([...audioTracks, screenTrack]);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
        }

        peerConnectionsRef.current.forEach((connection) => {
          connection.getSenders().forEach((sender) => {
            if (sender.track?.kind === "video") {
              sender.replaceTrack(screenTrack);
            }
          });
        });

        screenTrack.onended = () => {
          void stopShareScreen();
        };
        setSharingScreen(true);
        setStatus("Sharing your screen.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to start screen share");
      }
      return;
    }

    await stopShareScreen();
  }

  async function stopShareScreen() {
    const cameraStream = cameraStreamRef.current;
    if (!cameraStream) {
      return;
    }
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    localStreamRef.current = cameraStream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = cameraStream;
    }

    const cameraVideoTrack = cameraStream.getVideoTracks()[0];
    peerConnectionsRef.current.forEach((connection) => {
      connection.getSenders().forEach((sender) => {
        if (sender.track?.kind === "video") {
          sender.replaceTrack(cameraVideoTrack);
        }
      });
    });

    setSharingScreen(false);
    setStatus("Screen sharing stopped.");
  }

  function leaveMeeting(redirect = true) {
    socketRef.current?.close();
    peerConnectionsRef.current.forEach((connection) => connection.close());
    peerConnectionsRef.current.clear();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    if (redirect) {
      window.location.href = "/";
    }
  }

  if (error && !meeting) {
    return (
      <main className="room-shell">
        <div className="room-error">{error}</div>
      </main>
    );
  }

  if (!meeting) {
    return (
      <main className="room-shell">
        <div className="room-error">Loading meeting...</div>
      </main>
    );
  }

  return (
    <main className="room-shell">
      <header className="room-topbar">
        <div>
          <strong>{meeting.title}</strong>
          <span>{meeting.meeting_id}</span>
        </div>
        <button className="copy-link-button" onClick={copyInvite}>
          <Copy size={16} />
          Invite
        </button>
      </header>

      {!joined ? (
        <section className="prejoin">
          <div className="prejoin-panel">
            <h1>Join {meeting.title}</h1>
            <p>{status}</p>
            <label>
              Display name
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your name" />
            </label>
            {error ? <div className="form-error">{error}</div> : null}
            <button className="submit-button" onClick={joinRealtimeMeeting}>Join with audio and video</button>
            <button className="secondary-copy-button" onClick={copyInvite}>
              <Copy size={16} />
              Copy invite link
            </button>
          </div>
        </section>
      ) : (
        <section className="room-layout">
          <div className="video-stage">
            <div className="live-video-grid">
              <VideoTile name={`${displayName} (You)`} streamRef={localVideoRef} muted />
              {remotePeers.map((peer) => (
                <RemoteVideoTile key={peer.peerId} peer={peer} />
              ))}
            </div>
            <div className="room-status">{status}</div>
            {error ? <div className="error-banner">{error}</div> : null}
          </div>

          <aside className="participants-panel">
            <div className="panel-heading">
              <h2>Participants</h2>
              <span>{remotePeers.length + 1}</span>
            </div>
            <div className="participant-list">
              <div className="participant-line">
                <div>
                  <strong>{displayName}</strong>
                  <span>You</span>
                </div>
                {muted ? <MicOff size={16} /> : <Mic size={16} />}
              </div>
              {remotePeers.map((peer) => (
                <div className="participant-line" key={`line-${peer.peerId}`}>
                  <div>
                    <strong>{peer.displayName}</strong>
                    <span>Guest</span>
                  </div>
                  <Mic size={16} />
                </div>
              ))}
            </div>
            <div className="host-controls">
              <button><MicOff size={16} />Mute All</button>
              <button><UserMinus size={16} />Remove</button>
            </div>
          </aside>
        </section>
      )}

      {joined ? (
        <footer className="meeting-controls">
          <button onClick={toggleMute}>{muted ? <MicOff /> : <Mic />}<span>{muted ? "Unmute" : "Mute"}</span></button>
          <button onClick={toggleCamera}>{camera ? <Video /> : <VideoOff />}<span>{camera ? "Stop Video" : "Start Video"}</span></button>
          <button onClick={copyInvite}><Copy /><span>Invite</span></button>
          <button onClick={() => void toggleShareScreen()}><ScreenShare /><span>{sharingScreen ? "Stop Share" : "Share"}</span></button>
          <button><Users /><span>{remotePeers.length + 1}</span></button>
          <button className="end-button" onClick={() => leaveMeeting(true)}><PhoneOff /><span>End</span></button>
        </footer>
      ) : null}
    </main>
  );
}

function VideoTile({ name, streamRef, muted }: { name: string; streamRef: RefObject<HTMLVideoElement | null>; muted?: boolean }) {
  return (
    <div className="video-tile live">
      <video ref={streamRef} autoPlay playsInline muted={muted} />
      <span>{name}</span>
    </div>
  );
}

function RemoteVideoTile({ peer }: { peer: RemotePeer }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current && peer.stream) {
      videoRef.current.srcObject = peer.stream;
    }
  }, [peer.stream]);

  return (
    <div className="video-tile live">
      {peer.stream ? <video ref={videoRef} autoPlay playsInline /> : <div className="avatar-large">{peer.displayName.slice(0, 1)}</div>}
      <span>{peer.displayName}</span>
    </div>
  );
}
