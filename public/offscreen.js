console.log("[offscreen] ready");

let videoChunkSequence = 0;
let audioChunkSequence = 0;
let screenStream = null;
let micStream = null;
let videoRecorder = null;
let audioRecorder = null;
let sessionId = null;

// Track in-flight chunk uploads to prevent race condition
let pendingUploads = [];
let isStoppingRecording = false;

const VIDEO_UPLOAD_URL = "http://localhost:3000/api/v1/recording/video-chunk";
const AUDIO_UPLOAD_URL = "http://localhost:3000/api/v1/recording/audio-chunk";
const DASHBOARD_URL = "http://localhost:3001/recording";

let isRecording = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "OFFSCREEN_PING") {
    sendResponse({ ready: true });
    return true;
  }

  if (msg.type === "OFFSCREEN_START") {
    if (isRecording) {
      sendResponse({ success: false, error: "Already recording" });
      return;
    }
    isRecording = true;
    isStoppingRecording = false;

    if (msg.sessionId) {
      sessionId = msg.sessionId;
      console.log("[offscreen] sessionId received:", sessionId);
    } else {
      console.warn("[offscreen] No sessionId in OFFSCREEN_START");
    }

    console.log("[offscreen] START received");
    startRecording();
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === "OFFSCREEN_STOP") {
    console.log("[offscreen] STOP received, sessionId:", sessionId);
    stopRecording();
    sendResponse({ success: true });
    return true;
  }
});

function redirectToDashboard(sessionId) {
  try {
    if (!sessionId) {
      console.warn("[offscreen] No sessionId for redirect");
      return;
    }

    const dashboardUrl = `${DASHBOARD_URL}/${sessionId}`;
    console.log("[offscreen] Redirecting to:", dashboardUrl);

    chrome.runtime.sendMessage({
      type: "REDIRECT_TO_DASHBOARD",
      url: dashboardUrl
    });
  } catch (err) {
    console.error("[offscreen] Redirect failed:", err);
  }
}

async function startRecording() {
  try {
    videoChunkSequence = 0;
    audioChunkSequence = 0;
    pendingUploads = [];

    console.log("[offscreen] Starting recording...");
    console.log("[offscreen] NOTE: Permissions pre-granted in popup");

    // Request microphone - should succeed without prompt (popup already granted)
    console.log("[offscreen] Requesting microphone stream...");
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });

      const audioTrack = micStream.getAudioTracks()[0];
      console.log("[offscreen] ✓ Microphone:", audioTrack?.label);
    } catch (micErr) {
      console.error("[offscreen] ✗ Microphone failed:", micErr.name, micErr.message);
      isRecording = false;
      isStoppingRecording = false;

      chrome.runtime.sendMessage({
        type: 'RECORDING_ERROR',
        error: `Microphone: ${micErr.message}`
      });
      return;
    }

    // Request screen - should succeed without prompt (popup already granted)
    console.log("[offscreen] Requesting screen stream...");
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' },
        audio: false
      });

      const videoTrack = screenStream.getVideoTracks()[0];
      const settings = videoTrack?.getSettings();
      console.log("[offscreen] ✓ Screen:", `${settings?.width}x${settings?.height}`);
    } catch (screenErr) {
      console.error("[offscreen] ✗ Screen failed:", screenErr.name);
      try { micStream?.getTracks().forEach(t => t.stop()); } catch (e) { }
      isRecording = false;
      isStoppingRecording = false;
      return;
    }

    // Start recorders
    console.log("[offscreen] Starting recorders...");
    videoRecorder = new MediaRecorder(screenStream, { mimeType: "video/webm; codecs=vp9" });
    audioRecorder = new MediaRecorder(micStream, { mimeType: "audio/webm; codecs=opus" });

    videoRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) uploadVideoChunk(e.data);
    };
    audioRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) uploadAudioChunk(e.data);
    };

    // ✅ SAFE FIX #2: Increased from 200ms to 1000ms for video, 1000ms to 2000ms for audio
    videoRecorder.start(1000);
    audioRecorder.start(2000);

    console.log("[offscreen] ✓ Recording started");
  } catch (err) {
    console.error("[offscreen] ✗ Unexpected error:", err);
    try { micStream?.getTracks().forEach(t => t.stop()); } catch (e) { }
    try { screenStream?.getTracks().forEach(t => t.stop()); } catch (e) { }
    isRecording = false;
    isStoppingRecording = false;
  }
}

async function stopRecording() {
  console.log("[offscreen] Stopping recording...");
  isStoppingRecording = true;

  return new Promise(async (resolve) => {
    let videoStopped = false;
    let audioStopped = false;

    const checkBothStopped = async () => {
      if (videoStopped && audioStopped) {
        console.log("[offscreen] Both stopped, waiting for uploads...");
        console.log(`[offscreen] Pending: ${pendingUploads.length}`);

        // ✅ SAFE FIX #4: Reduced timeout from 30s to 10s
        const uploadTimeout = new Promise((res) => {
          setTimeout(() => {
            console.warn("[offscreen] Upload timeout (10s)");
            res();
          }, 10000);
        });

        await Promise.race([Promise.allSettled(pendingUploads), uploadTimeout]);

        const results = await Promise.allSettled(pendingUploads);
        const success = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;

        console.log(`[offscreen] Uploads - Success: ${success}, Failed: ${failed}`);

        isRecording = false;
        console.log("[offscreen] All chunks uploaded");

        try {
          screenStream?.getTracks().forEach(t => t.stop());
          micStream?.getTracks().forEach(t => t.stop());
        } catch (e) {
          console.error("[offscreen] Cleanup error:", e);
        }

        if (sessionId) {
          console.log("[offscreen] Redirecting...");
          redirectToDashboard(sessionId);
        } else {
          console.warn("[offscreen] No sessionId");
        }

        resolve();
      }
    };

    // ✅ SAFE FIX #9: Check recorder state before stopping
    if (videoRecorder) {
      videoRecorder.onstop = () => {
        console.log("[offscreen] Video stopped");
        videoStopped = true;
        checkBothStopped();
      };

      if (videoRecorder.state === 'recording') {
        console.log("[offscreen] Stopping video recorder...");
        try {
          videoRecorder.stop();
        } catch (e) {
          console.error("[offscreen] Video stop error:", e);
          videoStopped = true;
        }
      } else {
        console.log("[offscreen] Video recorder not recording, state:", videoRecorder.state);
        videoStopped = true;
      }
    } else {
      videoStopped = true;
    }

    if (audioRecorder) {
      audioRecorder.onstop = () => {
        console.log("[offscreen] Audio stopped");
        audioStopped = true;
        checkBothStopped();
      };

      if (audioRecorder.state === 'recording') {
        console.log("[offscreen] Stopping audio recorder...");
        try {
          audioRecorder.stop();
        } catch (e) {
          console.error("[offscreen] Audio stop error:", e);
          audioStopped = true;
        }
      } else {
        console.log("[offscreen] Audio recorder not recording, state:", audioRecorder.state);
        audioStopped = true;
      }
    } else {
      audioStopped = true;
    }

    // Check if both already stopped
    checkBothStopped();
  });
}

function uploadVideoChunk(blob) {
  if (isStoppingRecording) {
    console.warn("[offscreen] Rejecting video chunk");
    return;
  }

  if (!sessionId) {
    console.error("[offscreen] No sessionId for video chunk");
    return;
  }

  // ✅ SAFE FIX #6: Validate blob has data
  if (!blob || blob.size === 0) {
    console.warn("[offscreen] Rejecting empty video chunk");
    return;
  }

  const formData = new FormData();
  formData.append('sessionId', sessionId);
  formData.append('sequence', videoChunkSequence);
  formData.append('timestamp', Date.now());
  formData.append('chunk', blob);

  // ✅ SAFE FIX #3: Log chunk details for debugging
  console.log(`[offscreen] Video chunk ${videoChunkSequence}: ${blob.size} bytes, session: ${sessionId}`);

  const currentSequence = videoChunkSequence;
  videoChunkSequence++;

  const uploadPromise = fetch(VIDEO_UPLOAD_URL, {
    method: "POST",
    body: formData
  })
    .then(response => {
      if (!response.ok) throw new Error(`Video upload failed: ${response.status}`);
      // ✅ SAFE FIX #8: Better logging
      console.log(`[offscreen] ✓ Video chunk ${currentSequence} uploaded (${blob.size} bytes)`);
      return response.json();
    })
    .catch(error => {
      // ✅ SAFE FIX #8: Better error logging and don't rethrow
      console.error(`[offscreen] ✗ Video chunk ${currentSequence} FAILED:`, error.message);
      console.error(`[offscreen]   Chunk size: ${blob.size} bytes, Session: ${sessionId}`);
      // Don't rethrow - let recording continue
    });

  pendingUploads.push(uploadPromise);
}

function uploadAudioChunk(blob) {
  if (isStoppingRecording) {
    console.warn("[offscreen] Rejecting audio chunk");
    return;
  }

  if (!sessionId) {
    console.error("[offscreen] No sessionId for audio chunk");
    return;
  }

  // ✅ SAFE FIX #6: Validate blob has data
  if (!blob || blob.size === 0) {
    console.warn("[offscreen] Rejecting empty audio chunk");
    return;
  }

  const formData = new FormData();
  formData.append('sessionId', sessionId);
  formData.append('sequence', audioChunkSequence);
  formData.append('timestamp', Date.now());
  formData.append('chunk', blob);

  // ✅ SAFE FIX #3: Log chunk details for debugging
  console.log(`[offscreen] Audio chunk ${audioChunkSequence}: ${blob.size} bytes, session: ${sessionId}`);

  const currentSequence = audioChunkSequence;
  audioChunkSequence++;

  const uploadPromise = fetch(AUDIO_UPLOAD_URL, {
    method: "POST",
    body: formData
  })
    .then(response => {
      if (!response.ok) throw new Error(`Audio upload failed: ${response.status}`);
      // ✅ SAFE FIX #8: Better logging
      console.log(`[offscreen] ✓ Audio chunk ${currentSequence} uploaded (${blob.size} bytes)`);
      return response.json();
    })
    .catch(error => {
      // ✅ SAFE FIX #8: Better error logging and don't rethrow
      console.error(`[offscreen] ✗ Audio chunk ${currentSequence} FAILED:`, error.message);
      console.error(`[offscreen]   Chunk size: ${blob.size} bytes, Session: ${sessionId}`);
      // Don't rethrow - let recording continue
    });

  pendingUploads.push(uploadPromise);
}