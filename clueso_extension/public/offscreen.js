console.log("[offscreen] ready");

let videoRecorder = null;
let audioRecorder = null;
let screenStream = null;
let micStream = null;

const VIDEO_UPLOAD_URL = "http://localhost:3000/api/v1/recording/video-chunk";
const AUDIO_UPLOAD_URL = "http://localhost:3000/api/v1/recording/audio-chunk";

let isRecording = false;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "OFFSCREEN_START") {
    if (isRecording) return;
    isRecording = true;

    console.log("[offscreen] START received");
    startRecording();
  }

  if (msg.type === "OFFSCREEN_STOP") {
    stopRecording();
  }
});

async function startRecording() {
  try {
    console.log("[offscreen] requesting microphone permission first...");

    // 1) Request microphone first (user gesture preserved)
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });
      console.log("[offscreen] mic permission granted");
    } catch (micErr) {
      // Log detailed error info so we can see exactly why it failed
      console.error(
        "[offscreen] Microphone permission failed:",
        micErr,
        micErr?.name,
        micErr?.message
      );
      // Let user know and abort (or choose to continue only with screen)
      // For now abort so we always have audio+video recordings.
      isRecording = false;
      return;
    }

    // 2) Immediately request screen capture (picker will appear)
    console.log("[offscreen] requesting screen permission...");
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false // keep false to avoid system audio; we already have mic
      });
      console.log("[offscreen] screen permission granted");
    } catch (screenErr) {
      console.error("[offscreen] Screen permission failed:", screenErr);
      // Close mic if screen fails so no stray mic stays open
      try { micStream?.getTracks().forEach(t => t.stop()); } catch(e){}
      isRecording = false;
      return;
    }

    // 3) Start recorders after both streams available
    console.log("[offscreen] starting recorders...");
    videoRecorder = new MediaRecorder(screenStream, { mimeType: "video/webm; codecs=vp9" });
    audioRecorder = new MediaRecorder(micStream, { mimeType: "audio/webm; codecs=opus" });

    videoRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) uploadVideoChunk(e.data);
    };
    audioRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) uploadAudioChunk(e.data);
    };

    videoRecorder.start(200);
    audioRecorder.start(1000);

    console.log("[offscreen] recording started");
  } catch (err) {
    console.error("[offscreen] Unexpected startRecording error:", err);
    // ensure cleanup
    try { micStream?.getTracks().forEach(t => t.stop()); } catch(e){}
    try { screenStream?.getTracks().forEach(t => t.stop()); } catch(e){}
    isRecording = false;
  }
}



function stopRecording() {
  console.log("[offscreen] stopping recording...");

  try {
    videoRecorder?.stop();
    audioRecorder?.stop();
    screenStream?.getTracks().forEach((t) => t.stop());
    micStream?.getTracks().forEach((t) => t.stop());
  } catch (e) {
    console.error("[offscreen] stop error:", e);
  }

  isRecording = false;
}

function uploadVideoChunk(blob) {
  fetch(VIDEO_UPLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: blob,
  });
}

function uploadAudioChunk(blob) {
  fetch(AUDIO_UPLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: blob,
  });
}
