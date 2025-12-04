const startBtn = document.getElementById("start-recording");
const stopBtn = document.getElementById("stop-recording");


startBtn.onclick = async () => {
  try {
    console.log("[popup] requesting screen + mic permissions");

    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false
    });

    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false
    });

    console.log("[popup] permissions granted");

    // Send PORTS to background script
    const screenPort = chrome.runtime.connect({ name: "screenStream" });
    const micPort = chrome.runtime.connect({ name: "micStream" });

    screenPort.postMessage({ stream: screenStream });
    micPort.postMessage({ stream: micStream });

    let isRecording = false;

    document.getElementById("start-recording").onclick = () => {
    if (isRecording) return;
    isRecording = true;

    console.log("[popup] START sent");
    chrome.runtime.sendMessage({ type: "START_RECORDING" });
    };


  } catch (err) {
    console.error("[popup] permission error:", err);
  }
};

stopBtn.onclick = () => {
  chrome.runtime.sendMessage({ type: "STOP_RECORDING" });
};
