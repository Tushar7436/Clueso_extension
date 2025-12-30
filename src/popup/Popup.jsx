// src/popup/Popup.jsx
import React, { useEffect, useState } from "react";

export default function Popup() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Ready");

  // ─────────────────────────────────────────────
  // Sync state from background ONLY
  // ─────────────────────────────────────────────
  useEffect(() => {
    // Initial sync
    chrome.storage.local.get("isRecording", (res) => {
      setIsRecording(!!res.isRecording);
      setStatus(res.isRecording ? "Recording…" : "Ready");
    });

    // Listen for authoritative updates
    const handler = (msg) => {
      if (msg?.type === "RECORDING_STATUS") {
        setIsRecording(!!msg.isRecording);
        setStatus(msg.isRecording ? "Recording…" : "Ready");
      }

      if (msg?.type === "RECORDING_ERROR") {
        setStatus("Error");
        alert(msg.error || "Recording failed");
      }
    };

    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  // ─────────────────────────────────────────────
  // User actions ONLY
  // ─────────────────────────────────────────────
  const startRecording = async () => {
    if (isRecording) return;

    try {
      // Optional: mic gate only (screen is offscreen-owned)
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      alert(
        "Microphone permission is required to start recording.\n\n" +
        "Please allow microphone access and try again."
      );
      return;
    }

    chrome.runtime.sendMessage({ type: "START_RECORDING" });
    setStatus("Starting…");
  };

  const stopRecording = () => {
    if (!isRecording) return;
    chrome.runtime.sendMessage({ type: "STOP_RECORDING" });
    setStatus("Stopping…");
  };

  // ─────────────────────────────────────────────
  // UI
  // ─────────────────────────────────────────────
  return (
    <div
      style={{
        padding: 16,
        width: 300,
        fontFamily: "Inter, Arial, sans-serif",
        boxSizing: "border-box"
      }}
    >
      <h3 style={{ marginTop: 0 }}>Clueso Recorder</h3>

      <div style={{ marginBottom: 12, color: "#555" }}>
        Status: <strong>{status}</strong>
      </div>

      <button
        onClick={startRecording}
        disabled={isRecording}
        style={{ padding: "8px 12px", width: "100%" }}
      >
        Start Recording
      </button>

      <button
        onClick={stopRecording}
        disabled={!isRecording}
        style={{ padding: "8px 12px", width: "100%", marginTop: 8 }}
      >
        Stop Recording
      </button>

      <small style={{ display: "block", marginTop: 12, color: "#777" }}>
        Screen selection will be requested after starting.
      </small>
    </div>
  );
}
