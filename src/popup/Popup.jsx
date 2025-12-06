// src/popup/Popup.jsx
import React, { useEffect, useRef, useState } from 'react';

export default function Popup() {
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef(null);

  // On mount, sync with stored recording state and listen for updates
  useEffect(() => {
    // Get initial state from storage so popup reflects real status
    chrome.storage.local.get('isRecording', (res) => {
      setRecording(!!res.isRecording);
    });

    // Listen for status updates from background
    const handler = (msg) => {
      if (msg?.type === 'RECORDING_STATUS') {
        setRecording(!!msg.isRecording);
        if (!msg.isRecording) {
          setCountdown(0);
          if (countdownRef.current) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
        }
      }
    };

    chrome.runtime.onMessage.addListener(handler);
    return () => {
      try { chrome.runtime.onMessage.removeListener(handler); } catch (e) {}
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, []);

  const start = async () => {
    // Prevent multiple countdowns or starting while already recording
    if (recording || countdown > 0) return;

    let counter = 3;
    setCountdown(counter);

    const id = setInterval(() => {
      counter -= 1;
      if (counter <= 0) {
        clearInterval(id);
        countdownRef.current = null;
        setCountdown(0);

        try {
          chrome.runtime.sendMessage({ type: 'START_RECORDING' });
          setRecording(true);
        } catch (err) {
          console.error('start error', err);
        }
      } else {
        setCountdown(counter);
      }
    }, 1000);

    countdownRef.current = id;
  };

  const stop = () => {
    try {
      chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
      setRecording(false);
      setCountdown(0);
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    } catch (err) {
      console.error('stop error', err);
    }
  };

  return (
    <div style={{ padding: 18, width: 320, boxSizing: 'border-box', fontFamily: 'Inter, Arial, sans-serif' }}>
      <h2>Clueso Recorder</h2>
      <p>Records screen (video-only) and microphone (audio-only) separately and streams to your backend.</p>

      {countdown > 0 && !recording && (
        <div style={{ marginTop: 8, marginBottom: 4, color: '#d97706', fontWeight: 500 }}>
          Starting in {countdown}...
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <button
          onClick={start}
          disabled={recording || countdown > 0}
          style={{ padding: '8px 12px', fontSize: 14 }}
        >
          {countdown > 0 ? `Starting...` : 'Start Recording'}
        </button>
        <button
          onClick={stop}
          disabled={!recording}
          style={{ padding: '8px 12px', fontSize: 14, marginLeft: 8 }}
        >
          Stop Recording
        </button>
      </div>

      <small style={{ display: 'block', marginTop: 12, color: '#666' }}>
        Make sure to set backend URLs in offscreen.js
      </small>
    </div>
  );
}
