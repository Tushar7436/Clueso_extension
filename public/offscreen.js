console.log("[offscreen] ready");

let videoChunkSequence = 0;  // ← ADD THIS
let audioChunkSequence = 0;  // ← ADD THIS
let screenStream = null;
let micStream = null;
let videoRecorder = null;  // ← ADD THIS
let audioRecorder = null;  // ← ADD THIS
let sessionId = null; // Store sessionId from background


const VIDEO_UPLOAD_URL = "http://localhost:3000/api/v1/recording/video-chunk";
const AUDIO_UPLOAD_URL = "http://localhost:3000/api/v1/recording/audio-chunk";
const DASHBOARD_URL = "http://localhost:3001/recording";

let isRecording = false;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "OFFSCREEN_START") {
    if (isRecording) return;
    isRecording = true;

    // Capture sessionId from START message (not STOP!)
    if (msg.sessionId) {
      sessionId = msg.sessionId;
      console.log("[offscreen] sessionId received from START:", sessionId);
    } else {
      console.warn("[offscreen] No sessionId in OFFSCREEN_START message");
    }

    console.log("[offscreen] START received");
    startRecording();
  }

  if (msg.type === "OFFSCREEN_STOP") {
    // sessionId already captured from OFFSCREEN_START
    console.log("[offscreen] STOP received, using sessionId:", sessionId);
    stopRecording();
  }
});

// Redirect to dashboard with sessionId
function redirectToDashboard(sessionId) {
  try {
    if (!sessionId) {
      console.warn("[offscreen] No sessionId available for redirect");
      return;
    }

    const dashboardUrl = `${DASHBOARD_URL}/${sessionId}`;
    console.log("[offscreen] Requesting redirect to dashboard:", dashboardUrl);

    // Send message to background script to create tab (offscreen doesn't have tabs API)
    chrome.runtime.sendMessage({
      type: "REDIRECT_TO_DASHBOARD",
      url: dashboardUrl
    });
  } catch (err) {
    console.error("[offscreen] Failed to redirect to dashboard:", err);
  }
}

async function startRecording() {
  try {
    videoChunkSequence = 0;  // ← ADD THIS
    audioChunkSequence = 0;  // ← ADD THIS
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
      try { micStream?.getTracks().forEach(t => t.stop()); } catch (e) { }
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
    try { micStream?.getTracks().forEach(t => t.stop()); } catch (e) { }
    try { screenStream?.getTracks().forEach(t => t.stop()); } catch (e) { }
    isRecording = false;
  }
}



function stopRecording() {
  console.log("[offscreen] stopping recording...");

  return new Promise((resolve) => {
    let videoStopped = false;
    let audioStopped = false;

    const checkBothStopped = () => {
      if (videoStopped && audioStopped) {
        isRecording = false;
        console.log("[offscreen] Both recorders stopped, all chunks flushed");

        // Clean up streams
        try {
          screenStream?.getTracks().forEach((t) => t.stop());
          micStream?.getTracks().forEach((t) => t.stop());
        } catch (e) {
          console.error("[offscreen] stream cleanup error:", e);
        }

        // Now safe to redirect - all chunks have been uploaded
        if (sessionId) {
          console.log("[offscreen] Redirecting to dashboard with sessionId:", sessionId);
          redirectToDashboard(sessionId);
        } else {
          console.warn("[offscreen] stopRecording: No sessionId available, cannot redirect");
        }

        resolve();
      }
    };

    // Set up stop event handlers BEFORE calling stop()
    if (videoRecorder) {
      videoRecorder.onstop = () => {
        console.log("[offscreen] Video recorder stopped and flushed");
        videoStopped = true;
        checkBothStopped();
      };
    } else {
      videoStopped = true; // No video recorder to wait for
    }

    if (audioRecorder) {
      audioRecorder.onstop = () => {
        console.log("[offscreen] Audio recorder stopped and flushed");
        audioStopped = true;
        checkBothStopped();
      };
    } else {
      audioStopped = true; // No audio recorder to wait for
    }

    // Now trigger the stop (will emit final chunks then fire onstop)
    try {
      videoRecorder?.stop();
      audioRecorder?.stop();
    } catch (e) {
      console.error("[offscreen] stop error:", e);
      // If stop fails, still try to clean up
      isRecording = false;
      videoStopped = true;
      audioStopped = true;
      checkBothStopped();
    }
  });
}

function uploadVideoChunk(blob) {
  if (!sessionId) {
    console.error("[offscreen] Cannot upload video chunk: no sessionId");
    return;
  }

  const formData = new FormData();
  formData.append('sessionId', sessionId);
  formData.append('sequence', videoChunkSequence++);
  formData.append('timestamp', Date.now());
  formData.append('chunk', blob);

  fetch(VIDEO_UPLOAD_URL, {
    method: "POST",
    body: formData
  })
    .then(response => {
      if (!response.ok) {
        throw new Error(`Video upload failed: ${response.status}`);
      }
      console.log(`[offscreen] Video chunk ${videoChunkSequence - 1} uploaded successfully`);
      return response.json();
    })
    .catch(error => {
      console.error(`[offscreen] Video chunk upload error:`, error);
      // TODO: Implement retry queue
    });
}

function uploadAudioChunk(blob) {
  if (!sessionId) {
    console.error("[offscreen] Cannot upload audio chunk: no sessionId");
    return;
  }

  const formData = new FormData();
  formData.append('sessionId', sessionId);
  formData.append('sequence', audioChunkSequence++);
  formData.append('timestamp', Date.now());
  formData.append('chunk', blob);

  fetch(AUDIO_UPLOAD_URL, {
    method: "POST",
    body: formData
  })
    .then(response => {
      if (!response.ok) {
        throw new Error(`Audio upload failed: ${response.status}`);
      }
      console.log(`[offscreen] Audio chunk ${audioChunkSequence - 1} uploaded successfully`);
      return response.json();
    })
    .catch(error => {
      console.error(`[offscreen] Audio chunk upload error:`, error);
      // TODO: Implement retry queue
    });
}