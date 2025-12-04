// content-script.js
// DOM Event Capture Script - Injected into web pages to capture user interactions

let recordingStartTime = null;
let events = [];
let isRecording = false;
let scrollTimeout = null;
let mutationObserver = null;

// Generate unique session ID
function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Initialize recording session
function startRecording() {
  recordingStartTime = Date.now();
  events = [];
  isRecording = true;
  attachEventListeners();
  startMutationObserver();
  console.log('[content-script] Recording started');
}

function stopRecording() {
  isRecording = false;
  removeEventListeners();
  stopMutationObserver();
  
  const sessionData = {
    sessionId: generateSessionId(),
    startTime: recordingStartTime,
    endTime: Date.now(),
    url: window.location.href,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    events: events
  };
  
  console.log('[content-script] Recording stopped, events captured:', events.length);
  return sessionData;
}

// Attach event listeners
function attachEventListeners() {
  // Click events
  document.addEventListener('click', handleClick, true); // Use capture phase
  
  // Input events
  document.addEventListener('input', handleInput, true);
  document.addEventListener('change', handleChange, true);
  
  // Focus events
  document.addEventListener('focus', handleFocus, true);
  document.addEventListener('blur', handleBlur, true);
  
  // Scroll events (debounced)
  window.addEventListener('scroll', handleScrollDebounced, true);
  
  // Page navigation detection
  window.addEventListener('popstate', handleStepChange);
  
  // Intercept pushState/replaceState for SPA navigation
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  
  history.pushState = function(...args) {
    originalPushState.apply(history, args);
    handleStepChange();
  };
  
  history.replaceState = function(...args) {
    originalReplaceState.apply(history, args);
    handleStepChange();
  };
}

function removeEventListeners() {
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('input', handleInput, true);
  document.removeEventListener('change', handleChange, true);
  document.removeEventListener('focus', handleFocus, true);
  document.removeEventListener('blur', handleBlur, true);
  window.removeEventListener('scroll', handleScrollDebounced, true);
  window.removeEventListener('popstate', handleStepChange);
}

// Click event handler
function handleClick(e) {
  if (!isRecording) return;
  
  const target = e.target;
  const bbox = target.getBoundingClientRect();
  
  const event = {
    timestamp: Date.now() - recordingStartTime,
    type: 'click',
    target: {
      tag: target.tagName,
      id: target.id || null,
      classes: Array.from(target.classList),
      text: getVisibleText(target),
      selector: generateSelector(target),
      bbox: {
        x: Math.round(bbox.x),
        y: Math.round(bbox.y),
        width: Math.round(bbox.width),
        height: Math.round(bbox.height)
      },
      attributes: getImportantAttributes(target)
    },
    metadata: {
      url: window.location.href,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      }
    }
  };
  
  events.push(event);
  sendEventToBackground(event);
}

// Input event handler
function handleInput(e) {
  if (!isRecording) return;
  
  const target = e.target;
  if (!target.matches('input, textarea, select')) return;
  
  const bbox = target.getBoundingClientRect();
  
  const event = {
    timestamp: Date.now() - recordingStartTime,
    type: 'type',
    target: {
      tag: target.tagName,
      id: target.id || null,
      classes: Array.from(target.classList),
      text: null,
      selector: generateSelector(target),
      bbox: {
        x: Math.round(bbox.x),
        y: Math.round(bbox.y),
        width: Math.round(bbox.width),
        height: Math.round(bbox.height)
      },
      attributes: getImportantAttributes(target),
      type: target.type || null,
      name: target.name || null
    },
    value: target.value,
    metadata: {
      url: window.location.href,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      }
    }
  };
  
  events.push(event);
  sendEventToBackground(event);
}

// Change event handler (for select dropdowns, checkboxes, etc.)
function handleChange(e) {
  if (!isRecording) return;
  
  const target = e.target;
  if (!target.matches('input, textarea, select')) return;
  
  const bbox = target.getBoundingClientRect();
  
  const event = {
    timestamp: Date.now() - recordingStartTime,
    type: 'type',
    target: {
      tag: target.tagName,
      id: target.id || null,
      classes: Array.from(target.classList),
      text: null,
      selector: generateSelector(target),
      bbox: {
        x: Math.round(bbox.x),
        y: Math.round(bbox.y),
        width: Math.round(bbox.width),
        height: Math.round(bbox.height)
      },
      attributes: getImportantAttributes(target),
      type: target.type || null,
      name: target.name || null
    },
    value: target.type === 'checkbox' || target.type === 'radio' 
      ? target.checked 
      : target.value,
    metadata: {
      url: window.location.href,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      }
    }
  };
  
  events.push(event);
  sendEventToBackground(event);
}

// Focus event handler
function handleFocus(e) {
  if (!isRecording) return;
  
  const target = e.target;
  if (!target.matches('input, textarea, select')) return;
  
  const bbox = target.getBoundingClientRect();
  
  const event = {
    timestamp: Date.now() - recordingStartTime,
    type: 'focus',
    target: {
      tag: target.tagName,
      id: target.id || null,
      classes: Array.from(target.classList),
      text: null,
      selector: generateSelector(target),
      bbox: {
        x: Math.round(bbox.x),
        y: Math.round(bbox.y),
        width: Math.round(bbox.width),
        height: Math.round(bbox.height)
      },
      attributes: getImportantAttributes(target),
      type: target.type || null,
      name: target.name || null
    },
    metadata: {
      url: window.location.href,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      }
    }
  };
  
  events.push(event);
}

// Blur event handler
function handleBlur(e) {
  if (!isRecording) return;
  
  const target = e.target;
  if (!target.matches('input, textarea, select')) return;
  
  const bbox = target.getBoundingClientRect();
  
  const event = {
    timestamp: Date.now() - recordingStartTime,
    type: 'blur',
    target: {
      tag: target.tagName,
      id: target.id || null,
      classes: Array.from(target.classList),
      text: null,
      selector: generateSelector(target),
      bbox: {
        x: Math.round(bbox.x),
        y: Math.round(bbox.y),
        width: Math.round(bbox.width),
        height: Math.round(bbox.height)
      },
      attributes: getImportantAttributes(target),
      type: target.type || null,
      name: target.name || null
    },
    metadata: {
      url: window.location.href,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      }
    }
  };
  
  events.push(event);
}

// Debounced scroll handler
function handleScrollDebounced() {
  if (!isRecording) return;
  
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    handleScroll();
  }, 300);
}

// Scroll event handler
function handleScroll() {
  if (!isRecording) return;
  
  const event = {
    timestamp: Date.now() - recordingStartTime,
    type: 'scroll',
    metadata: {
      url: window.location.href,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      scrollPosition: {
        x: window.scrollX,
        y: window.scrollY
      }
    }
  };
  
  events.push(event);
}

// Step change handler (page navigation, major UI changes)
function handleStepChange() {
  if (!isRecording) return;
  
  const event = {
    timestamp: Date.now() - recordingStartTime,
    type: 'step_change',
    metadata: {
      url: window.location.href,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      }
    }
  };
  
  events.push(event);
}

// Mutation observer for detecting major DOM changes (modals, etc.)
function startMutationObserver() {
  mutationObserver = new MutationObserver((mutations) => {
    if (!isRecording) return;
    
    // Detect major UI changes (modals, page transitions)
    const hasMajorChange = mutations.some(mutation => {
      return mutation.addedNodes.length > 5 || 
             mutation.removedNodes.length > 5 ||
             Array.from(mutation.addedNodes).some(node => 
               node.nodeType === 1 && 
               (node.matches?.('dialog, [role="dialog"], .modal, .overlay') || false)
             );
    });
    
    if (hasMajorChange) {
      handleStepChange();
    }
  });
  
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function stopMutationObserver() {
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
}

// Generate CSS selector for element
function generateSelector(element) {
  if (element.id) {
    return `#${element.id}`;
  }
  
  if (element.className) {
    const classes = Array.from(element.classList)
      .filter(cls => !cls.startsWith('_')) // Filter out framework classes
      .join('.');
    if (classes) {
      return `${element.tagName.toLowerCase()}.${classes}`;
    }
  }
  
  // Fallback: use path
  const path = [];
  let current = element;
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector += `#${current.id}`;
      path.unshift(selector);
      break;
    }
    if (current.className) {
      const classes = Array.from(current.classList)
        .filter(cls => !cls.startsWith('_'))
        .slice(0, 2) // Limit classes
        .join('.');
      if (classes) selector += `.${classes}`;
    }
    
    const siblings = Array.from(current.parentElement?.children || [])
      .filter(el => el.tagName === current.tagName);
    if (siblings.length > 1) {
      const index = siblings.indexOf(current) + 1;
      selector += `:nth-of-type(${index})`;
    }
    
    path.unshift(selector);
    current = current.parentElement;
  }
  
  return path.join(' > ');
}

// Get visible text content
function getVisibleText(element) {
  // Get text content, excluding hidden elements
  const clone = element.cloneNode(true);
  const hidden = clone.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"], [hidden]');
  hidden.forEach(el => el.remove());
  
  return clone.textContent?.trim() || null;
}

// Get important attributes
function getImportantAttributes(element) {
  const important = ['data-testid', 'aria-label', 'aria-labelledby', 'name', 'type', 'role'];
  const attrs = {};
  
  important.forEach(attr => {
    const value = element.getAttribute(attr);
    if (value) {
      attrs[attr] = value;
    }
  });
  
  return attrs;
}

// Send event to background script (optional: real-time sync)
function sendEventToBackground(event) {
  try {
    chrome.runtime.sendMessage({
      type: 'EVENT_CAPTURED',
      event: event
    });
  } catch (error) {
    // Ignore errors if background script is not available
    console.debug('[content-script] Could not send event to background:', error);
  }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ success: true, ready: true });
    return true;
  }
  
  if (message.type === 'START_RECORDING') {
    startRecording();
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'STOP_RECORDING') {
    const sessionData = stopRecording();
    sendResponse({ success: true, sessionData: sessionData });
    return true;
  }
  
  return true; // Keep message channel open for async response
});

console.log('[content-script] Content script loaded');

