console.log("[offscreen] ready");

// ─── State ─────────────────────────────────────────────
let sessionId = null;
let startTime = null;

let screenStream = null;
let micStream = null;
let videoRecorder = null;
let audioRecorder = null;

let videoSeq = 0;
let audioSeq = 0;

let pendingUploads = [];
let isRecording = false;
let isStopping = false;

// ─── Config ────────────────────────────────────────────
const VIDEO_UPLOAD_URL = "http://localhost:3000/api/v1/recording/video-chunk";
const AUDIO_UPLOAD_URL = "http://localhost:3000/api/v1/recording/audio-chunk";

// ─── Messaging ─────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "OFFSCREEN_PING") {
    sendResponse({ ready: true });
    return true;
  }

  if (msg?.type === "OFFSCREEN_START") {
    if (isRecording) {
      sendResponse({ success: false, error: "Already recording" });
      return true;
    }
    ({ sessionId, startTime } = msg);
    startRecording().then(() => {
      chrome.runtime.sendMessage({ type: "OFFSCREEN_STARTED", sessionId });
    }).catch(err => {
      chrome.runtime.sendMessage({ type: "OFFSCREEN_ERROR", error: err.message });
    });
    sendResponse({ success: true });
    return true;
  }

  if (msg?.type === "OFFSCREEN_STOP") {
    stopRecording().then(() => {
      chrome.runtime.sendMessage({ type: "OFFSCREEN_FINISHED", sessionId });
    });
    sendResponse({ success: true });
    return true;
  }
});

// ─── Recording ─────────────────────────────────────────
async function startRecording() {
  isRecording = true;
  isStopping = false;
  pendingUploads = [];
  videoSeq = 0;
  audioSeq = 0;

  // Media (no prompts here)
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false
  });

  screenStream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: "monitor" },
    audio: false
  });

  videoRecorder = new MediaRecorder(screenStream, { mimeType: "video/webm; codecs=vp8" });
  audioRecorder = new MediaRecorder(micStream, { mimeType: "audio/webm; codecs=opus" });

  videoRecorder.ondataavailable = e => e.data?.size && uploadVideo(e.data);
  audioRecorder.ondataavailable = e => e.data?.size && uploadAudio(e.data);

  videoRecorder.start(1000); // stream
  audioRecorder.start(2000); // stream

  console.log("[offscreen] recording started", { sessionId, startTime });
}

async function stopRecording() {
  if (!isRecording) return;
  isStopping = true;

  try {
    if (videoRecorder?.state === "recording") videoRecorder.stop();
    if (audioRecorder?.state === "recording") audioRecorder.stop();
  } catch { }

  // Wait for uploads to finish (best-effort)
  await Promise.race([
    Promise.allSettled(pendingUploads),
    new Promise(res => setTimeout(res, 10000))
  ]);

  try {
    screenStream?.getTracks().forEach(t => t.stop());
    micStream?.getTracks().forEach(t => t.stop());
  } catch { }

  // ─────────────────────────────────────────────
  // SENDING SESSION TO BACKGROUND.JS (media lifecycle complete)
  // ─────────────────────────────────────────────
  console.log("[offscreen] Session finished");


  isRecording = false;

  console.log("[offscreen] recording finished", sessionId);

  // Notify background LAST
  chrome.runtime.sendMessage({
    type: "OFFSCREEN_FINISHED",
    sessionId
  });
}

// ─── Upload helpers ────────────────────────────────────
function uploadVideo(blob) {
  if (isStopping || !sessionId) return;
  const fd = new FormData();
  fd.append("sessionId", sessionId);
  fd.append("sequence", videoSeq++);
  fd.append("timestamp", Date.now() - startTime);
  fd.append("chunk", blob);

  const p = fetch(VIDEO_UPLOAD_URL, { method: "POST", body: fd })
    .then(r => { if (!r.ok) throw new Error(`video ${r.status}`); });
  pendingUploads.push(p);
}

function uploadAudio(blob) {
  if (isStopping || !sessionId) return;
  const fd = new FormData();
  fd.append("sessionId", sessionId);
  fd.append("sequence", audioSeq++);
  fd.append("timestamp", Date.now() - startTime);
  fd.append("chunk", blob);

  const p = fetch(AUDIO_UPLOAD_URL, { method: "POST", body: fd })
    .then(r => { if (!r.ok) throw new Error(`audio ${r.status}`); });
  pendingUploads.push(p);
}