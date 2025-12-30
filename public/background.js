// background.js — Orchestrator (single source of truth)

const OFFSCREEN_URL = "offscreen.html";

// DOM streaming (batched)
const DOM_EVENTS_URL = "http://localhost:3000/api/v1/recording/dom-events";

// Final confirmation
const FINALIZE_URL = "http://localhost:3000/api/v1/recording/finalize";

const DOM_BATCH_INTERVAL = 200; // ms

// ─────────────────────────────────────────────
// Global recording state
// ─────────────────────────────────────────────
let recording = {
  isActive: false,
  sessionId: null,
  startTime: null,
  tabId: null
};

// DOM batching buffer
let domBuffer = [];
let domFlushTimer = null;

// Finalization flags
let completion = {
  mediaDone: false,
  domDone: false
};

let finalized = false;

// ─────────────────────────────────────────────
// Message Listener
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg?.type) return;

  switch (msg.type) {
    case "START_RECORDING":
      handleStart();
      break;

    case "STOP_RECORDING":
      handleStop().then(() => {
        sendResponse({ success: true });
      });
      return true;

    case "EVENT_CAPTURED":
      if (recording.isActive && msg.event) {
        bufferDomEvent(msg.event);
      }
      break;

    case "OFFSCREEN_FINISHED":
      if (msg.sessionId === recording.sessionId) {
        completion.mediaDone = true;
        tryFinalize();
      }
      break;

    case "OFFSCREEN_PING":
      sendResponse({ ready: true });
      return true;
  }

  return true;
});

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────
async function handleStart() {
  broadcastRecordingStatus(true);
  if (recording.isActive) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  finalized = false;
  completion = { mediaDone: false, domDone: false };
  domBuffer = [];

  recording = {
    isActive: true,
    sessionId: generateSessionId(),
    startTime: Date.now(),
    tabId: tab.id
  };

  await chrome.storage.local.set({
    isRecording: true,
    sessionId: recording.sessionId
  });

  await ensureOffscreen();
  await ensureContentScript(tab.id);

  chrome.tabs.sendMessage(tab.id, {
    type: "START_RECORDING",
    sessionId: recording.sessionId,
    startTime: recording.startTime
  });

  chrome.runtime.sendMessage({
    type: "OFFSCREEN_START",
    sessionId: recording.sessionId,
    startTime: recording.startTime
  });
}

// ─────────────────────────────────────────────
// STOP
// ─────────────────────────────────────────────
async function handleStop() {
  broadcastRecordingStatus(false);
  if (!recording.isActive) return;

  recording.isActive = false;

  // Flush remaining DOM events immediately
  await flushDomEvents();

  completion.domDone = true;

  chrome.runtime.sendMessage({
    type: "OFFSCREEN_STOP",
    sessionId: recording.sessionId
  });

  if (recording.tabId) {
    chrome.tabs.sendMessage(recording.tabId, {
      type: "STOP_RECORDING"
    });
  }
  tryFinalize();
}

// ─────────────────────────────────────────────
// DOM EVENT BATCHING (200 ms)
// ─────────────────────────────────────────────
function bufferDomEvent(event) {
  domBuffer.push(event);

  if (!domFlushTimer) {
    domFlushTimer = setTimeout(flushDomEvents, DOM_BATCH_INTERVAL);
  }
}

async function flushDomEvents() {
  if (!domBuffer.length || !recording.sessionId) {
    clearFlushTimer();
    return;
  }

  const batch = domBuffer;
  domBuffer = [];
  clearFlushTimer();

  try {
    await fetch(DOM_EVENTS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Id": recording.sessionId
      },
      body: JSON.stringify({
        sessionId: recording.sessionId,
        events: batch,
        metadata: {
          url: recording.url,                    // ✅ Add this
          viewport: recording.viewport,          // ✅ Add this
          startTime: recording.startTime,        // ✅ Add this
          // endTime will be added on finalize
        }
      })
    });
  } catch (err) {
    console.warn("[background] DOM batch upload failed:", err.message);
  }
}

function clearFlushTimer() {
  if (domFlushTimer) {
    clearTimeout(domFlushTimer);
    domFlushTimer = null;
  }
}

// ─────────────────────────────────────────────
// FINALIZE BARRIER (CONFIRMATION ONLY)
// ─────────────────────────────────────────────
async function tryFinalize() {
  if (finalized) return;
  if (!completion.mediaDone || !completion.domDone) return;

  finalized = true;

  try {
    await fetch(FINALIZE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: recording.sessionId,
        metadata: {
          endTime: Date.now()  // ✅ Add endTime on finalize
        }
      })
    });
  } catch (err) {
    console.warn("[background] finalize failed:", err.message);
  }

  chrome.tabs.create({
    url: `http://localhost:3001/recording/${recording.sessionId}`
  });

  recording = {
    isActive: false,
    sessionId: null,
    startTime: null,
    tabId: null
  };
}

// ─────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────
function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["DISPLAY_MEDIA", "USER_MEDIA"],
    justification: "Screen and microphone recording"
  });
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-script.js"]
    });
  }
}

//helper function
function broadcastRecordingStatus(isRecording) {
  chrome.runtime.sendMessage({
    type: "RECORDING_STATUS",
    isRecording
  });

  chrome.storage.local.set({ isRecording });
}
