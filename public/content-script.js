// content-script.js — Pure DOM event sensor

console.log("[content] loaded");

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
let isRecording = false;
let sessionId = null;
let startTime = null;

// Keep references for cleanup
let listeners = [];
let mutationObserver = null;

// ─────────────────────────────────────────────
// Messaging
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "PING") {
    sendResponse({ ready: true });
    return true;
  }

  if (msg?.type === "START_RECORDING") {
    ({ sessionId, startTime } = msg);
    startDomCapture();
    sendResponse({ success: true });
    return true;
  }

  if (msg?.type === "STOP_RECORDING") {
    stopDomCapture();
    sendResponse({ success: true });
    return true;
  }
});

// ─────────────────────────────────────────────
// Recording lifecycle
// ─────────────────────────────────────────────
function startDomCapture() {
  if (isRecording) return;

  isRecording = true;
  console.log("[content] DOM capture started", sessionId);

  addListener("click", handleClick, true);
  addListener("scroll", handleScroll, true);
  addListener("input", handleInput, true);

  observeDomMutations();
}

function stopDomCapture() {
  if (!isRecording) return;

  isRecording = false;
  console.log("[content] DOM capture stopped", sessionId);

  listeners.forEach(({ type, handler, options }) => {
    window.removeEventListener(type, handler, options);
  });
  listeners = [];

  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }

  sessionId = null;
  startTime = null;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function addListener(type, handler, options) {
  window.addEventListener(type, handler, options);
  listeners.push({ type, handler, options });
}

function now() {
  return Date.now() - startTime;
}

function sendEvent(event) {
  if (!isRecording) return;

  try {
    if (!chrome.runtime?.id) return;

    chrome.runtime.sendMessage(
      { type: "EVENT_CAPTURED", event },
      () => {
        // Ignore teardown errors
        if (chrome.runtime.lastError) { }
      }
    );
  } catch {
    console.log("Extension context already invalidated");
  }
}


// ─────────────────────────────────────────────
// Event handlers
// ─────────────────────────────────────────────
function handleClick(e) {
  const target = e.target;
  if (!(target instanceof Element)) return;

  // Show visual click indicator
  showClickIndicator(e.clientX, e.clientY);

  sendEvent({
    source: "dom",
    type: "click",
    timestamp: now(),
    target: serializeTarget(target),
    metadata: baseMetadata()
  });
}

// ─────────────────────────────────────────────
// Click indicator visual feedback
// ─────────────────────────────────────────────
let activeIndicator = null;
let indicatorTimeout = null;

function showClickIndicator(x, y) {
  // Remove any existing indicator immediately
  if (activeIndicator) {
    activeIndicator.remove();
    activeIndicator = null;
  }

  // Clear any pending timeout
  if (indicatorTimeout) {
    clearTimeout(indicatorTimeout);
    indicatorTimeout = null;
  }

  // Create the indicator element
  const indicator = document.createElement('div');
  indicator.className = 'clueso-click-indicator';

  // Position it at the click coordinates
  indicator.style.cssText = `
    position: fixed;
    left: ${x}px;
    top: ${y}px;
    width: 20px;
    height: 20px;
    background-color: #ed5252ff;
    border: 1px solid white;
    border-radius: 50%;
    pointer-events: none;
    z-index: 999999;
    transform: translate(-50%, -50%) scale(1);
    opacity: 1;
    transition: opacity 0.3s ease-out, transform 0.3s ease-out;
  `;

  // Add to DOM immediately
  document.body.appendChild(indicator);
  activeIndicator = indicator;

  // Track mouse movement to remove indicator when mouse moves away
  const removeOnMouseMove = (e) => {
    const dx = e.clientX - x;
    const dy = e.clientY - y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Remove if mouse moves more than 30px away
    if (distance > 30) {
      if (activeIndicator) {
        // Trigger smooth fade-out
        activeIndicator.style.opacity = '0';
        activeIndicator.style.transform = 'translate(-50%, -50%) scale(0.5)';

        // Remove from DOM after transition completes
        setTimeout(() => {
          if (activeIndicator) {
            activeIndicator.remove();
            activeIndicator = null;
          }
        }, 300);
      }
      window.removeEventListener('mousemove', removeOnMouseMove);
      if (indicatorTimeout) {
        clearTimeout(indicatorTimeout);
        indicatorTimeout = null;
      }
    }
  };

  window.addEventListener('mousemove', removeOnMouseMove);

  // Also remove after 2 seconds as fallback
  indicatorTimeout = setTimeout(() => {
    if (activeIndicator) {
      // Trigger smooth fade-out
      activeIndicator.style.opacity = '0';
      activeIndicator.style.transform = 'translate(-50%, -50%) scale(0.5)';

      // Remove from DOM after transition completes
      setTimeout(() => {
        if (activeIndicator) {
          activeIndicator.remove();
          activeIndicator = null;
        }
      }, 300);
    }
    window.removeEventListener('mousemove', removeOnMouseMove);
  }, 2000);
}

let lastScrollY = window.scrollY;
let lastScrollTime = 0;

function handleScroll() {
  const y = window.scrollY;
  const delta = Math.abs(y - lastScrollY);
  const t = Date.now();

  if (delta < 80 && t - lastScrollTime < 300) return;

  lastScrollY = y;
  lastScrollTime = t;

  sendEvent({
    source: "dom",
    type: "scroll",
    timestamp: now(),
    metadata: {
      ...baseMetadata(),
      scrollPosition: { x: window.scrollX, y }
    }
  });
}

function handleInput(e) {
  const target = e.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;

  // 🚨 Never capture sensitive input values
  if (target.type === "password") return;

  sendEvent({
    source: "dom",
    type: "input",
    timestamp: now(),
    target: serializeTarget(target),
    metadata: baseMetadata()
  });
}

// ─────────────────────────────────────────────
// Mutation observer (for SPA navigation / step changes)
// ─────────────────────────────────────────────
function observeDomMutations() {
  let lastMutation = 0;

  mutationObserver = new MutationObserver(() => {
    const t = Date.now();
    if (t - lastMutation < 500) return;
    lastMutation = t;

    sendEvent({
      source: "dom",
      type: "dom_mutation",
      timestamp: now(),
      metadata: baseMetadata()
    });
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// ─────────────────────────────────────────────
// Serialization helpers
// ─────────────────────────────────────────────
function serializeTarget(el) {
  const rect = el.getBoundingClientRect();

  return {
    tag: el.tagName,
    id: el.id || null,
    classes: [...el.classList],
    text: el.innerText?.slice(0, 100) || null,
    selector: buildSelector(el),
    bbox: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    },
    attributes: getSafeAttributes(el)
  };
}

function buildSelector(el) {
  if (el.id) return `#${el.id}`;

  let path = [];
  while (el && el.nodeType === Node.ELEMENT_NODE && path.length < 4) {
    let selector = el.tagName.toLowerCase();
    if (el.classList.length) {
      selector += "." + [...el.classList].slice(0, 2).join(".");
    }
    path.unshift(selector);
    el = el.parentElement;
  }
  return path.join(" > ");
}

function getSafeAttributes(el) {
  const allowed = ["data-testid", "aria-label", "role"];
  const attrs = {};

  allowed.forEach(name => {
    if (el.hasAttribute(name)) {
      attrs[name] = el.getAttribute(name);
    }
  });

  return attrs;
}

function baseMetadata() {
  return {
    url: location.href,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight
    }
  };
}
