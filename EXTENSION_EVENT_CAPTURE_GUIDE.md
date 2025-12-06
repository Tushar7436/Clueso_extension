Creating a markdown document summarizing the extension event capture approach for your extension project.


[1 tool called]


Markdown document for your extension project:

```markdown
# Extension Event Capture Implementation Guide

## Overview

This document outlines the implementation of **DOM event capture** in the browser extension for ProductAI. Instead of relying on backend video analysis with OCR, the extension will capture structured interaction events directly from the DOM, providing more accurate and efficient detection of user interactions (clicks, text inputs, focus changes, etc.).

## Why Extension-Based Event Capture?

### Advantages

1. **Accuracy**: Direct access to DOM events means we know exactly what was clicked/typed, without OCR errors
2. **Performance**: Lightweight JSON events vs heavy video processing
3. **Reliability**: Works across all websites/apps, captures interactions even if UI changes visually
4. **Cost-Effective**: Reduces backend CPU/memory usage (critical for free-tier deployments)
5. **Rich Metadata**: Can capture element selectors, IDs, classes, attributes for precise frontend replay

### Architecture

```
Extension (Browser)    Node.js Server      Python Backend (FastAPI)
┌─────────────────┐    ┌──────────────┐    ┌──────────────────────┐
│ 1. Capture DOM  │───>│ 2. Receive   │───>│ 4. Validate &       │
│    Events       │    │    Events    │    │    Enrich Events    │
│                 │    │              │    │                      │
│                 │    │ 3. Forward   │───>│ 5. Generate         │
│                 │    │    to Python │    │    Instructions     │
│                 │    │              │    │                      │
│                 │<───│ 6. Return    │<───│ 7. Return JSON      │
│                 │    │    Response  │    │    Instructions     │
└─────────────────┘    └──────────────┘    └──────────────────────┘
```

---

## Event Capture Specification

### Event Types to Capture

1. **Click Events** - Button clicks, link clicks, any clickable element
2. **Input Events** - Text typing, form field changes
3. **Focus Events** - Input field focus/blur
4. **Scroll Events** - Page scrolling (for step detection)
5. **Step Changes** - Major UI state changes (page navigation, modal opens/closes)

### Event Structure

Each captured event should follow this schema:

```typescript
interface InteractionEvent {
  timestamp: number;           // Milliseconds since recording start
  type: 'click' | 'type' | 'focus' | 'blur' | 'scroll' | 'step_change';
  target: {
    tag: string;               // HTML tag name (e.g., 'BUTTON', 'INPUT')
    id: string | null;         // Element ID
    classes: string[];         // Array of CSS classes
    text: string | null;       // Visible text content
    selector: string;          // CSS selector for replay (e.g., '#submit-btn')
    bbox: {                    // Bounding box coordinates
      x: number;
      y: number;
      width: number;
      height: number;
    };
    attributes: Record<string, string>;  // Important attributes (data-testid, aria-label, etc.)
    type?: string;             // For inputs: 'text', 'email', 'password', etc.
    name?: string;             // For inputs: name attribute
  };
  value?: string;              // For input events: current field value
  valueChange?: string;        // For input events: what changed (optional)
  metadata?: {
    url: string;               // Current page URL
    viewport: {                // Viewport dimensions
      width: number;
      height: number;
    };
    scrollPosition?: {         // For scroll events
      x: number;
      y: number;
    };
  };
}
```

---

## Implementation Details

### 1. Content Script Setup

Inject a content script into all tabs when recording starts:

```javascript
// content-script.js

let recordingStartTime = null;
let events = [];
let isRecording = false;

// Initialize recording session
function startRecording() {
  recordingStartTime = Date.now();
  events = [];
  isRecording = true;
  attachEventListeners();
}

function stopRecording() {
  isRecording = false;
  removeEventListeners();
  return {
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
}
```

### 2. Event Listeners

#### Click Events

```javascript
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
  let scrollTimeout;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      handleScroll();
    }, 300);
  }, true);
  
  // Page navigation detection
  window.addEventListener('popstate', handleStepChange);
  window.addEventListener('pushstate', handleStepChange);
}

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
  sendEventToBackground(event); // Optional: real-time sync
}
```

#### Input Events

```javascript
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
      text: null, // Inputs don't have visible text content
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
```

#### Focus Events

```javascript
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
```

#### Scroll Events

```javascript
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
```

#### Step Change Detection

```javascript
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

// Also detect modal opens/closes, major DOM changes
const observer = new MutationObserver((mutations) => {
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

// Start observing when recording starts
function startRecording() {
  // ... existing code ...
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}
```

### 3. Helper Functions

#### Generate CSS Selector

```javascript
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
```

#### Get Visible Text

```javascript
function getVisibleText(element) {
  // Get text content, excluding hidden elements
  const clone = element.cloneNode(true);
  const hidden = clone.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"], [hidden]');
  hidden.forEach(el => el.remove());
  
  return clone.textContent?.trim() || null;
}
```

#### Get Important Attributes

```javascript
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
```

### 4. Background Script Communication

```javascript
// background.js

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RECORDING_START') {
    // Inject content script into active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: ['content-script.js']
      });
      
      chrome.tabs.sendMessage(tabs[0].id, { type: 'START_RECORDING' });
    });
  }
  
  if (message.type === 'RECORDING_STOP') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_RECORDING' }, (response) => {
        // response contains events array
        sendEventsToBackend(response.events, response.videoBlob, response.audioBlob);
      });
    });
  }
  
  if (message.type === 'EVENT_CAPTURED') {
    // Optional: real-time event sync
    bufferEvent(message.event);
  }
});

async function sendEventsToBackend(events, videoBlob, audioBlob) {
  const formData = new FormData();
  
  // Add events as JSON
  formData.append('events', JSON.stringify(events));
  
  // Add video if available
  if (videoBlob) {
    formData.append('video', videoBlob, 'recording.webm');
  }
  
  // Add audio if available
  if (audioBlob) {
    formData.append('audio', audioBlob, 'narration.webm');
  }
  
  // Add metadata
  formData.append('metadata', JSON.stringify({
    sessionId: generateSessionId(),
    url: events[0]?.metadata?.url || '',
    viewport: events[0]?.metadata?.viewport || {}
  }));
  
  try {
    // Send to Node.js server first (which will forward to Python backend)
    const response = await fetch('http://localhost:3000/api/process-recording', {
      method: 'POST',
      body: formData
    });
    
    const result = await response.json();
    console.log('Backend response:', result);
    
    // Send instructions to frontend or store for replay
    chrome.runtime.sendMessage({
      type: 'INSTRUCTIONS_RECEIVED',
      instructions: result.instructions
    });
  } catch (error) {
    console.error('Failed to send events to Node.js server:', error);
  }
}
```

### 5. Screen Recording Integration

```javascript
// In content script or background script

let mediaRecorder;
let recordedChunks = [];

async function startScreenRecording() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        mediaSource: 'screen',
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: true // Include system audio if needed
    });
    
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9'
    });
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };
    
    mediaRecorder.onstop = () => {
      const videoBlob = new Blob(recordedChunks, { type: 'video/webm' });
      recordedChunks = [];
      return videoBlob;
    };
    
    mediaRecorder.start();
  } catch (error) {
    console.error('Screen recording failed:', error);
  }
}

function stopScreenRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(track => track.stop());
  }
}
```

### 6. Audio Recording Integration

```javascript
let audioRecorder;
let audioChunks = [];

async function startAudioRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    audioRecorder = new MediaRecorder(stream);
    
    audioRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };
    
    audioRecorder.onstop = () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      audioChunks = [];
      return audioBlob;
    };
    
    audioRecorder.start();
  } catch (error) {
    console.error('Audio recording failed:', error);
  }
}

function stopAudioRecording() {
  if (audioRecorder && audioRecorder.state !== 'inactive') {
    audioRecorder.stop();
    audioRecorder.stream.getTracks().forEach(track => track.stop());
  }
}
```

---

## Node.js Server Implementation

The Node.js server acts as an intermediary between the extension and the Python backend. It receives events from the extension and forwards them to the Python FastAPI backend.

### 7. Node.js Server Setup

Create a Node.js server using Express:

```javascript
// server.js
const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const fetch = require('node-fetch');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:8000';

// Middleware
app.use(cors());
app.use(express.json());

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'node-server' });
});

// Main endpoint: receive events from extension and forward to Python backend
app.post('/api/process-recording', upload.fields([
  { name: 'events', maxCount: 1 },
  { name: 'video', maxCount: 1 },
  { name: 'audio', maxCount: 1 },
  { name: 'metadata', maxCount: 1 }
]), async (req, res) => {
  try {
    console.log('Received recording data from extension');
    
    // Create FormData for Python backend
    const formData = new FormData();
    
    // Forward events JSON
    if (req.body.events) {
      formData.append('events', req.body.events);
    }
    
    // Forward metadata JSON
    if (req.body.metadata) {
      formData.append('metadata', req.body.metadata);
    }
    
    // Forward video file if present
    if (req.files && req.files.video && req.files.video[0]) {
      const videoFile = req.files.video[0];
      formData.append('video', fs.createReadStream(videoFile.path), {
        filename: videoFile.originalname || 'recording.webm',
        contentType: videoFile.mimetype || 'video/webm'
      });
    }
    
    // Forward audio file if present
    if (req.files && req.files.audio && req.files.audio[0]) {
      const audioFile = req.files.audio[0];
      formData.append('audio', fs.createReadStream(audioFile.path), {
        filename: audioFile.originalname || 'narration.webm',
        contentType: audioFile.mimetype || 'audio/webm'
      });
    }
    
    // Forward to Python backend
    console.log('Forwarding to Python backend:', PYTHON_BACKEND_URL);
    const pythonResponse = await fetch(`${PYTHON_BACKEND_URL}/api/process-recording`, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders()
    });
    
    if (!pythonResponse.ok) {
      const errorText = await pythonResponse.text();
      throw new Error(`Python backend error: ${pythonResponse.status} - ${errorText}`);
    }
    
    const result = await pythonResponse.json();
    
    // Clean up uploaded files
    if (req.files) {
      Object.values(req.files).forEach(fileArray => {
        fileArray.forEach(file => {
          fs.unlink(file.path, (err) => {
            if (err) console.error('Error deleting file:', err);
          });
        });
      });
    }
    
    // Return response to extension
    res.json(result);
    
  } catch (error) {
    console.error('Error processing recording:', error);
    res.status(500).json({
      error: 'Failed to process recording',
      message: error.message
    });
  }
});

// Real-time event streaming endpoint (optional)
app.post('/api/events/stream', express.json(), async (req, res) => {
  try {
    const { events } = req.body;
    
    // Buffer events or forward immediately to Python backend
    // This can be used for real-time event processing
    
    // For now, just acknowledge receipt
    res.json({ received: events.length });
  } catch (error) {
    console.error('Error streaming events:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Node.js server running on port ${PORT}`);
  console.log(`Python backend URL: ${PYTHON_BACKEND_URL}`);
});
```

### 8. Node.js Server Package Configuration

Create `package.json` for the Node.js server:

```json
{
  "name": "clueso-node-server",
  "version": "1.0.0",
  "description": "Node.js intermediary server for Clueso extension",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "multer": "^1.4.5-lts.1",
    "form-data": "^4.0.0",
    "node-fetch": "^2.7.0",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  },
  "engines": {
    "node": ">=14.0.0"
  }
}
```

### 9. Environment Configuration

Create `.env` file for the Node.js server:

```env
PORT=3000
PYTHON_BACKEND_URL=http://localhost:8000
NODE_ENV=development
```

### 10. Error Handling & Retry Logic

Add retry logic for failed requests to Python backend:

```javascript
// utils/retry.js
async function retryRequest(fn, maxRetries = 3, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      console.log(`Retry attempt ${i + 1}/${maxRetries} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
}

// Usage in server.js
const pythonResponse = await retryRequest(async () => {
  return await fetch(`${PYTHON_BACKEND_URL}/api/process-recording`, {
    method: 'POST',
    body: formData,
    headers: formData.getHeaders()
  });
});
```

### 11. Event Batching (Optional)

For real-time event streaming, implement batching:

```javascript
// utils/eventBatcher.js
class EventBatcher {
  constructor(batchSize = 50, flushInterval = 2000) {
    this.batch = [];
    this.batchSize = batchSize;
    this.flushInterval = flushInterval;
    this.flushTimer = null;
  }
  
  add(event) {
    this.batch.push(event);
    
    if (this.batch.length >= this.batchSize) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.flushInterval);
    }
  }
  
  async flush() {
    if (this.batch.length === 0) return;
    
    const eventsToSend = [...this.batch];
    this.batch = [];
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    
    // Send batch to Python backend
    try {
      await fetch(`${PYTHON_BACKEND_URL}/api/events/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: eventsToSend })
      });
    } catch (error) {
      console.error('Failed to send event batch:', error);
    }
  }
}

// Usage
const batcher = new EventBatcher();
app.post('/api/events/stream', express.json(), (req, res) => {
  req.body.events.forEach(event => batcher.add(event));
  res.json({ received: req.body.events.length });
});
```

---

## Backend API Integration

### Architecture Flow

1. **Extension → Node.js Server**: Extension sends events to Node.js server at `http://localhost:3000/api/process-recording`
2. **Node.js Server → Python Backend**: Node.js server forwards the request to Python FastAPI backend at `http://localhost:8000/api/process-recording`
3. **Python Backend → Node.js Server**: Python backend processes and returns instructions
4. **Node.js Server → Extension**: Node.js server forwards the response back to extension

### Node.js Server Endpoint: `/api/process-recording`

**Request Format (from Extension):**
```
POST http://localhost:3000/api/process-recording
Content-Type: multipart/form-data

Form Data:
- events: JSON string (array of InteractionEvent)
- video: File (optional, WebM format)
- audio: File (optional, WebM format)
- metadata: JSON string (session info)
```

**Response Format (to Extension):**
```json
{
  "sessionId": "abc123",
  "instructions": [
    {
      "timestamp": 3100,
      "action": "type",
      "target": {
        "type": "input_field",
        "selector": "#email-input",
        "bbox": [100, 200, 300, 30],
        "label": "Email"
      },
      "value": "user@example.com",
      "confidence": 0.95
    },
    {
      "timestamp": 5200,
      "action": "click",
      "target": {
        "type": "button",
        "selector": "#submit-btn",
        "bbox": [400, 250, 100, 40],
        "text": "Submit"
      },
      "confidence": 0.98
    }
  ],
  "metadata": {
    "processingTime": 0.5,
    "eventsProcessed": 15,
    "warnings": []
  }
}
```

### Python Backend Endpoint: `/api/process-recording`

**Request Format (from Node.js Server):**
```
POST http://localhost:8000/api/process-recording
Content-Type: multipart/form-data

Form Data:
- events: JSON string (array of InteractionEvent)
- video: File (optional, WebM format)
- audio: File (optional, WebM format)
- metadata: JSON string (session info)
```

**Response Format (to Node.js Server):**
```json
{
  "sessionId": "abc123",
  "instructions": [
    {
      "timestamp": 3100,
      "action": "type",
      "target": {
        "type": "input_field",
        "selector": "#email-input",
        "bbox": [100, 200, 300, 30],
        "label": "Email"
      },
      "value": "user@example.com",
      "confidence": 0.95
    },
    {
      "timestamp": 5200,
      "action": "click",
      "target": {
        "type": "button",
        "selector": "#submit-btn",
        "bbox": [400, 250, 100, 40],
        "text": "Submit"
      },
      "confidence": 0.98
    }
  ],
  "metadata": {
    "processingTime": 0.5,
    "eventsProcessed": 15,
    "warnings": []
  }
}
```

---

## Testing Checklist

### Functional Tests

- [ ] Click events are captured correctly
- [ ] Input events capture full field values
- [ ] Focus events trigger on input fields
- [ ] Scroll events are debounced appropriately
- [ ] Step changes detected on navigation
- [ ] Selectors are generated correctly
- [ ] Bounding boxes are accurate
- [ ] Timestamps are sequential and relative to recording start

### Edge Cases

- [ ] Dynamic content (SPA navigation)
- [ ] Iframes (cross-origin handling)
- [ ] Shadow DOM elements
- [ ] Rapid interactions (debouncing)
- [ ] Large forms (performance)
- [ ] Mobile viewport changes

### Integration Tests

- [ ] Events sync with screen recording timestamps
- [ ] Events sync with audio recording timestamps
- [ ] Extension sends events to Node.js server correctly
- [ ] Node.js server forwards events to Python backend correctly
- [ ] Python backend receives all events correctly
- [ ] Python backend generates valid instructions
- [ ] Node.js server forwards response back to extension correctly
- [ ] Frontend can replay instructions accurately

---

## Performance Considerations

1. **Event Batching**: Buffer events and send in batches (every 1-2 seconds) instead of individual messages
2. **Memory Management**: Clear old events if recording exceeds certain duration
3. **Selector Optimization**: Cache selectors for frequently accessed elements
4. **Debouncing**: Use debouncing for scroll/resize events
5. **Lazy Evaluation**: Only generate selectors/bboxes when needed

---

## Security & Privacy

1. **Sensitive Data**: Consider masking password fields and sensitive inputs
2. **URL Sanitization**: Remove query parameters or tokens from URLs
3. **User Consent**: Ensure users understand what data is being captured
4. **Data Minimization**: Only capture necessary events and metadata

---

## Migration Notes

### Current State
- Backend uses PaddleOCR for video analysis
- Heavy CPU/memory usage
- Dependency conflicts (NumPy, PaddlePaddle)

### Target State
- Extension captures structured events
- Backend validates/enriches events (lightweight)
- Video used only as fallback
- Minimal dependencies

### Backward Compatibility
- Keep `/analyze-video` endpoint as fallback
- Support both event-based and video-based processing
- Gradually migrate to event-first approach

---

## Next Steps

1. **Phase 1**: Implement basic event capture (clicks, inputs)
2. **Phase 2**: Add focus/scroll/step detection
3. **Phase 3**: Integrate with screen/audio recording
4. **Phase 4**: Set up Node.js server and configure endpoints
5. **Phase 5**: Integrate Node.js server with Python backend
6. **Phase 6**: End-to-end testing (Extension → Node.js → Python → Node.js → Extension)
7. **Phase 7**: Frontend replay implementation

---

## Support & Questions

For implementation questions or clarifications, refer to:
- Node.js Server API: `http://localhost:3000/api/process-recording`
- Python Backend API: `http://localhost:8000/api/process-recording`
- Event schema: See "Event Structure" section above
- Example implementations: See code snippets in this document

## Node.js Server Setup Instructions

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   - Copy `.env.example` to `.env`
   - Set `PYTHON_BACKEND_URL` to your Python backend URL

3. **Start the server:**
   ```bash
   npm start
   # or for development with auto-reload:
   npm run dev
   ```

4. **Verify server is running:**
   ```bash
   curl http://localhost:3000/health
   ```

5. **Update extension configuration:**
   - Set the Node.js server URL in `background.js`
   - Default: `http://localhost:3000/api/process-recording`
```

Save this as `EXTENSION_EVENT_CAPTURE_GUIDE.md` in your extension project. It includes:

1. Overview and rationale
2. Event structure specification
3. Implementation code examples
4. Backend integration details
5. Testing checklist
6. Performance and security considerations

The document is ready to share with your extension developers. Should I create a separate backend API specification document for the Python FastAPI endpoint?