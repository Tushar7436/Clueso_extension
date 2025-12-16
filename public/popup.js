const startBtn = document.getElementById("start-recording");
const stopBtn = document.getElementById("stop-recording");
const statusEl = document.getElementById("status");

// Update UI based on recording state
async function updateUI() {
  const { isRecording } = await chrome.storage.local.get("isRecording");

  if (isRecording) {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    startBtn.classList.add("disabled");
    stopBtn.classList.remove("disabled");
    if (statusEl) statusEl.textContent = "Recording...";
  } else {
    startBtn.disabled = false;
    stopBtn.disabled = true;
    startBtn.classList.remove("disabled");
    stopBtn.classList.add("disabled");
    if (statusEl) statusEl.textContent = "Ready";
  }
}

// Listen for recording status changes
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "RECORDING_STATUS") {
    updateUI();
  }

  if (msg.type === "RECORDING_ERROR") {
    console.error("[popup] Recording error:", msg.error);
    if (statusEl) statusEl.textContent = `Error: ${msg.error}`;
    alert(`Recording failed: ${msg.error}\n\nPlease try again.`);
  }
});

// Start recording - request permissions in popup (has user gesture)
startBtn.onclick = async () => {
  console.log("[popup] START button clicked");

  if (statusEl) statusEl.textContent = "Requesting permissions...";

  try {
    // Request permissions HERE in popup (user gesture is still active)
    console.log("[popup] Requesting microphone permission...");
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    const audioTrack = micStream.getAudioTracks()[0];
    console.log("[popup] ✓ Microphone permission granted:", audioTrack?.label);

    // Request screen permission
    console.log("[popup] Requesting screen permission...");
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'monitor'
      },
      audio: false
    });

    const videoTrack = screenStream.getVideoTracks()[0];
    console.log("[popup] ✓ Screen permission granted");

    // Permissions granted! Now send START_RECORDING with stream IDs
    // Note: We can't pass MediaStream objects directly, so we'll just signal
    // that permissions are OK and offscreen should start
    console.log("[popup] Sending START_RECORDING message");
    chrome.runtime.sendMessage({
      type: "START_RECORDING",
      permissionsGranted: true,
      micLabel: audioTrack?.label,
      screenLabel: videoTrack?.label
    });

    // Keep streams alive temporarily
    // Offscreen will request new streams using granted permissions
    // ✅ SAFE FIX #5: Increased from 1s to 3s to give more time for offscreen
    setTimeout(() => {
      console.log("[popup] Closing temporary permission streams");
      micStream.getTracks().forEach(t => t.stop());
      screenStream.getTracks().forEach(t => t.stop());
    }, 3000);

    if (statusEl) statusEl.textContent = "Starting recording...";
  } catch (err) {
    console.error("[popup] Permission error:", err);

    let errorMsg = "Permission denied";
    if (err.name === 'NotAllowedError') {
      errorMsg = "You dismissed the permission prompt. Please try again and click 'Allow'.";
    } else if (err.name === 'NotFoundError') {
      errorMsg = "No microphone or screen found.";
    }

    if (statusEl) statusEl.textContent = errorMsg;
    alert(errorMsg);
  }
};

// Stop recording
stopBtn.onclick = () => {
  console.log("[popup] STOP button clicked");

  try {
    chrome.runtime.sendMessage({ type: "STOP_RECORDING" });
    console.log("[popup] STOP_RECORDING message sent");

    if (statusEl) statusEl.textContent = "Stopping recording...";
  } catch (err) {
    console.error("[popup] Error sending STOP_RECORDING:", err);
  }
};

// Initialize UI on popup open
updateUI();
console.log("[popup] Popup initialized");