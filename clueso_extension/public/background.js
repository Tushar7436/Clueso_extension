// public/background.js
// Background service worker - creates an offscreen document to perform capture
const OFFSCREEN_URL = "offscreen.html";
const NODE_SERVER_URL = "http://localhost:3000/api/v1/recording/process-recording";

// Event storage for buffering events from content script
let eventBuffer = [];
let currentTabId = null;

// ---- SINGLE message listener (correct) ----
chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  try {
    if (msg?.type === "START_RECORDING") {
      // Mark recording state and notify any open popups
      await chrome.storage.local.set({ isRecording: true });
      chrome.runtime.sendMessage({ type: "RECORDING_STATUS", isRecording: true });

      // Get active tab and inject content script
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        currentTabId = tabs[0].id;
        await injectContentScript(tabs[0].id);
        
        // Start content script recording with retry
        try {
          await sendMessageWithRetry(tabs[0].id, { type: "START_RECORDING" }, 3, 200);
          console.log("[background] Content script recording started");
        } catch (error) {
          console.error("[background] Failed to start content script recording:", error);
          // Continue anyway - events will be buffered if content script becomes available
        }
      }

      await ensureOffscreen();
      console.log("[background] Sending OFFSCREEN_START");
      chrome.runtime.sendMessage({ type: "OFFSCREEN_START" });
      
      // Clear event buffer
      eventBuffer = [];
    }

    if (msg?.type === "STOP_RECORDING") {
      // Clear recording state and notify any open popups
      await chrome.storage.local.set({ isRecording: false });
      chrome.runtime.sendMessage({ type: "RECORDING_STATUS", isRecording: false });

      // Stop content script recording and collect events
      if (currentTabId !== null) {
        let sessionDataSent = false;
        
        try {
          // First, check if tab still exists and content script is available
          const tab = await chrome.tabs.get(currentTabId).catch(() => null);
          if (!tab) {
            console.log("[background] Tab no longer exists");
          } else {
            // Check if content script is still available before trying to stop
            const isContentScriptReady = await waitForContentScript(currentTabId, 2, 100);
            if (isContentScriptReady) {
              // Content script is available, try to get events
              try {
                const response = await sendMessageWithRetry(currentTabId, { type: "STOP_RECORDING" }, 3, 300);
                if (response && response.sessionData) {
                  console.log("[background] Received session data from content script");
                  await sendEventsToNodeServer(response.sessionData);
                  sessionDataSent = true;
                }
              } catch (retryError) {
                console.log("[background] Could not get data from content script:", retryError.message);
                // Will fall through to use buffered events
              }
            } else {
              console.log("[background] Content script not available, will use buffered events");
            }
          }
          
          // If we didn't get data from content script, use buffered events
          if (!sessionDataSent) {
            if (eventBuffer.length > 0) {
              console.log("[background] Using buffered events:", eventBuffer.length, "events");
              const tab = await chrome.tabs.get(currentTabId).catch(() => null);
              const sessionData = {
                sessionId: generateSessionId(),
                startTime: Date.now() - 60000,
                endTime: Date.now(),
                url: tab?.url || "unknown",
                viewport: { width: 0, height: 0 },
                events: eventBuffer
              };
              await sendEventsToNodeServer(sessionData);
              sessionDataSent = true;
            } else {
              console.warn("[background] No events available (content script unavailable and no buffered events)");
              // Send empty session to indicate recording completed but no events captured
              const tab = await chrome.tabs.get(currentTabId).catch(() => null);
              const sessionData = {
                sessionId: generateSessionId(),
                startTime: Date.now() - 60000,
                endTime: Date.now(),
                url: tab?.url || "unknown",
                viewport: { width: 0, height: 0 },
                events: []
              };
              await sendEventsToNodeServer(sessionData);
            }
          }
        } catch (error) {
          // Only log unexpected errors (not connection errors we've already handled)
          if (!error.message || !error.message.includes("Receiving end does not exist")) {
            console.error("[background] Unexpected error stopping recording:", error);
          }
          
          // Try to send buffered events as last resort
          if (!sessionDataSent && eventBuffer.length > 0) {
            console.log("[background] Sending buffered events after error");
            const tab = await chrome.tabs.get(currentTabId).catch(() => null);
            const sessionData = {
              sessionId: generateSessionId(),
              startTime: Date.now() - 60000,
              endTime: Date.now(),
              url: tab?.url || "unknown",
              viewport: { width: 0, height: 0 },
              events: eventBuffer
            };
            await sendEventsToNodeServer(sessionData);
          }
        }
        
        currentTabId = null;
        eventBuffer = []; // Clear buffer after use
      }

      chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP" });
    }

    // Handle real-time event capture from content script
    if (msg?.type === "EVENT_CAPTURED") {
      eventBuffer.push(msg.event);
      // Optional: Send events in batches to Node.js server
      // For now, we'll send all events when recording stops
    }
  } catch (err) {
    console.error("background listener error:", err);
  }
  
  return true; // Keep message channel open for async responses
});

// Wait for content script to be ready (with retries)
async function waitForContentScript(tabId, maxRetries = 5, delay = 200) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "PING" });
      if (response && response.ready) {
        return true;
      }
    } catch (error) {
      if (i < maxRetries - 1) {
        console.log(`[background] Content script not ready, retrying... (${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        return false;
      }
    }
  }
  return false;
}

// Send message to content script with retries
async function sendMessageWithRetry(tabId, message, maxRetries = 3, delay = 200) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      return response;
    } catch (error) {
      if (error.message && error.message.includes("Receiving end does not exist")) {
        if (i < maxRetries - 1) {
          console.log(`[background] Content script not available, retrying... (${i + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
  }
}

// Inject content script into tab
async function injectContentScript(tabId) {
  try {
    // Check if content script is already injected by trying to ping it
    const isReady = await waitForContentScript(tabId, 3, 100);
    if (isReady) {
      console.log("[background] Content script already active");
      return;
    }
  } catch (error) {
    // Content script not injected, inject it
    console.log("[background] Content script not found, injecting...");
  }
  
  // Content script not injected, inject it
  console.log("[background] Injecting content script into tab:", tabId);
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["content-script.js"]
    });
    console.log("[background] Content script injected successfully");
    
    // Wait for content script to initialize and be ready
    const isReady = await waitForContentScript(tabId, 5, 200);
    if (isReady) {
      console.log("[background] Content script is ready");
    } else {
      console.warn("[background] Content script injected but not responding to ping");
    }
  } catch (injectError) {
    console.error("[background] Failed to inject content script:", injectError);
    throw injectError;
  }
}

// Send events to Node.js server
async function sendEventsToNodeServer(sessionData) {
  try {
    console.log("[background] Sending events to Node.js server:", sessionData.events.length, "events");
    console.log("[background] Target URL:", NODE_SERVER_URL);
    
    // Create FormData for multipart/form-data request
    const formData = new FormData();
    
    // Add events as JSON string
    const eventsJson = JSON.stringify(sessionData.events);
    formData.append('events', eventsJson);
    console.log("[background] Events JSON length:", eventsJson.length);
    
    // Add metadata as JSON string
    const metadataJson = JSON.stringify({
      sessionId: sessionData.sessionId,
      startTime: sessionData.startTime,
      endTime: sessionData.endTime,
      url: sessionData.url,
      viewport: sessionData.viewport
    });
    formData.append('metadata', metadataJson);
    console.log("[background] Metadata:", metadataJson);
    
    console.log("[background] Making fetch request to:", NODE_SERVER_URL);
    const response = await fetch(NODE_SERVER_URL, {
      method: 'POST',
      body: formData
      // Don't set Content-Type header - browser will set it with boundary for FormData
    });
    
    console.log("[background] Response status:", response.status, response.statusText);
    console.log("[background] Response URL:", response.url);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[background] Error response body:", errorText);
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }
    
    const result = await response.json();
    console.log("[background] Node.js server response:", result);
    
    // Send instructions to popup or store for replay
    try {
      await chrome.runtime.sendMessage({
        type: 'INSTRUCTIONS_RECEIVED',
        instructions: result.instructions || [],
        sessionId: result.sessionId || sessionData.sessionId
      });
    } catch (err) {
      // Ignore if no listeners (popup might be closed)
      // This is expected if popup is not open
      console.log("[background] No listeners for INSTRUCTIONS_RECEIVED (popup may be closed)");
    }
    
    return result;
  } catch (error) {
    console.error("[background] Failed to send events to Node.js server:", error);
    console.error("[background] Error details:", {
      message: error.message,
      stack: error.stack,
      url: NODE_SERVER_URL,
      name: error.name
    });
    
    // Notify popup of error (if it's open)
    try {
      await chrome.runtime.sendMessage({
        type: 'EVENT_UPLOAD_ERROR',
        error: error.message,
        url: NODE_SERVER_URL
      });
    } catch (err) {
      // Ignore if no listeners (popup might be closed)
      console.log("[background] Could not notify popup of error (popup may be closed)");
    }
    
    // Don't throw - just log the error so recording can complete
    return { success: false, error: error.message };
  }
}

// Generate session ID
function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ---- SAFE offscreen creation logic ----
let creatingOffscreen = false;

async function ensureOffscreen() {
  // If already created → return immediately
  if (await chrome.offscreen.hasDocument()) {
    console.log("[background] Offscreen already exists");
    return;
  }

  // If creation already started → wait
  if (creatingOffscreen) {
    console.log("[background] Offscreen creation already in progress...");
    while (!(await chrome.offscreen.hasDocument())) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return;
  }

  // Create offscreen
  creatingOffscreen = true;
  console.log("[background] Creating offscreen document...");

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["DISPLAY_MEDIA", "USER_MEDIA"],
      justification: "Needed to record screen and microphone"
    });

    console.log("[background] Offscreen document created");
  } catch (err) {
    console.error("[background] Failed to create offscreen document:", err);
  } finally {
    creatingOffscreen = false;
  }
}

