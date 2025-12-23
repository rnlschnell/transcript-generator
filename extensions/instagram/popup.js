// Configuration
const WORKER_URL = 'https://api.transcriptmagic.com';
const FREE_LIMIT = 10;

// State
let currentTranscript = null;
let currentMediaId = null;
let deviceId = null;

// Device ID functions - generates a unique ID per extension install
async function getDeviceId() {
  const result = await chrome.storage.local.get('deviceId');
  if (result.deviceId) return result.deviceId;

  // Generate new UUID v4
  const newDeviceId = crypto.randomUUID();
  await chrome.storage.local.set({ deviceId: newDeviceId });
  return newDeviceId;
}

// Credit display functions (credits tracked server-side, cached locally for display)
async function getRemainingCount() {
  const result = await chrome.storage.local.get('remainingCount');
  return result.remainingCount ?? FREE_LIMIT;
}

async function setRemainingCount(count) {
  await chrome.storage.local.set({ remainingCount: count });
}

function updateRemainingDisplay(count) {
  const countEl = document.getElementById('countValue');
  const remainingEl = document.getElementById('remainingCount');
  if (countEl) countEl.textContent = count;
  if (remainingEl) {
    remainingEl.classList.toggle('warning', count <= 3 && count > 0);
    remainingEl.classList.toggle('exhausted', count <= 0);
  }
}

// DOM elements
const form = document.getElementById('transcriptForm');
const urlInput = document.getElementById('urlInput');
const getTranscriptBtn = document.getElementById('getTranscriptBtn');
const formAlt = document.getElementById('transcriptFormAlt');
const urlInputAlt = document.getElementById('urlInputAlt');
const getTranscriptBtnAlt = document.getElementById('getTranscriptBtnAlt');
const urlFormSection = document.getElementById('urlFormSection');
const status = document.getElementById('status');
const currentVideoSection = document.getElementById('currentVideo');
const getTranscriptCurrentBtn = document.getElementById('getTranscriptCurrentBtn');
const transcriptResult = document.getElementById('transcriptResult');
const transcriptText = document.getElementById('transcriptText');
const copyBtn = document.getElementById('copyBtn');
const downloadTxtBtn = document.getElementById('downloadTxtBtn');

let currentTabUrl = null;

// Toggle button visibility based on input
function setupInputToggle(input, button) {
  input.addEventListener('input', () => {
    const hasValue = input.value.trim().length > 0;
    button.classList.toggle('hidden', !hasValue);
  });
}

// Check if URL is an Instagram reel or post page
function isInstagramMediaPage(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('instagram.com')) {
      return false;
    }
    return parsed.pathname.includes('/reel/') || parsed.pathname.includes('/p/');
  } catch {
    return false;
  }
}

// Validate Instagram URL
function isValidInstagramUrl(url) {
  return isInstagramMediaPage(url);
}

// Extract media ID/shortcode from Instagram URL
function extractMediaId(url) {
  try {
    const parsed = new URL(url);
    const reelMatch = parsed.pathname.match(/\/reel\/([^\/]+)/);
    const postMatch = parsed.pathname.match(/\/p\/([^\/]+)/);
    return reelMatch?.[1] || postMatch?.[1] || null;
  } catch {
    return null;
  }
}

// Status icons
const statusIcons = {
  error: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>',
  success: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>',
  info: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>'
};

// Show status message
function showStatus(message, type = '') {
  if (!message) {
    status.innerHTML = '';
    status.className = 'status';
    return;
  }
  const icon = statusIcons[type] || statusIcons.info;
  status.innerHTML = icon + '<span>' + message + '</span>';
  status.className = 'status ' + (type || 'info');
}

// Set loading state for a button
function setLoading(button, loading) {
  button.disabled = loading;
  button.classList.toggle('loading', loading);
}

// Show transcript result
function showTranscriptResult(text, mediaId) {
  currentTranscript = text;
  currentMediaId = mediaId;

  // Display the transcript as plain text
  transcriptText.innerHTML = `<div class="plain-text">${text}</div>`;
  transcriptResult.classList.add('visible');
}

// Hide transcript result
function hideTranscriptResult() {
  currentTranscript = null;
  currentMediaId = null;
  transcriptResult.classList.remove('visible');
}

// Copy to clipboard
async function copyToClipboard(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showStatus(successMessage, 'success');
  } catch (err) {
    showStatus('Failed to copy: ' + err.message, 'error');
  }
}

// Download file
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: true
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      showStatus('Download failed: ' + chrome.runtime.lastError.message, 'error');
    } else {
      showStatus('Text file downloaded!', 'success');
    }
    URL.revokeObjectURL(url);
  });
}

// Get transcript from URL
async function getTranscript(url, button) {
  setLoading(button, true);
  showStatus('Fetching transcript...');
  hideTranscriptResult();

  try {
    const response = await fetch(`${WORKER_URL}/api/instagram/transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, deviceId }),
    });

    const data = await response.json();

    if (!response.ok) {
      // Update display if server returns remaining count
      if (typeof data.remaining === 'number') {
        await setRemainingCount(data.remaining);
        updateRemainingDisplay(data.remaining);
      }
      throw new Error(data.error || 'Failed to fetch transcript');
    }

    if (!data.transcripts || data.transcripts.length === 0) {
      throw new Error('No transcript available for this post');
    }

    // Update remaining count from server response
    if (typeof data.remaining === 'number') {
      await setRemainingCount(data.remaining);
      updateRemainingDisplay(data.remaining);
    }

    // Instagram returns an array of transcripts, use the first one
    const transcript = data.transcripts[0];
    const mediaId = extractMediaId(url) || transcript.shortcode || transcript.id;

    showTranscriptResult(transcript.text, mediaId);
    showStatus('Transcript loaded!', 'success');
    urlInput.value = '';
    urlInputAlt.value = '';
    getTranscriptBtn.classList.add('hidden');

  } catch (err) {
    console.error('Error:', err);
    showStatus(err.message || 'Something went wrong', 'error');
  } finally {
    setLoading(button, false);
  }
}

// Initialize on popup open
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize device ID
  deviceId = await getDeviceId();

  // Initialize credit display from cache
  const count = await getRemainingCount();
  updateRemainingDisplay(count);

  // Setup input toggle for inline form (button only shows when URL entered)
  setupInputToggle(urlInput, getTranscriptBtn);

  // Check current tab for Instagram reel/post
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.url && isInstagramMediaPage(tabs[0].url)) {
      currentTabUrl = tabs[0].url;
      currentVideoSection.classList.add('visible');
      urlFormSection.classList.add('hidden');
    } else {
      urlFormSection.classList.add('visible');
    }
  });
});

// Handle "Get Transcript" button for current video
getTranscriptCurrentBtn.addEventListener('click', () => {
  if (currentTabUrl) {
    getTranscript(currentTabUrl, getTranscriptCurrentBtn);
  }
});

// Handle form submission (manual URL)
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();

  if (!isValidInstagramUrl(url)) {
    showStatus('Please enter a valid Instagram reel or post URL', 'error');
    return;
  }

  getTranscript(url, getTranscriptBtn);
});

// Handle alternative form submission (when no video detected)
formAlt.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = urlInputAlt.value.trim();

  if (!isValidInstagramUrl(url)) {
    showStatus('Please enter a valid Instagram reel or post URL', 'error');
    return;
  }

  getTranscript(url, getTranscriptBtnAlt);
});

// Copy text
copyBtn.addEventListener('click', () => {
  if (currentTranscript) {
    copyToClipboard(currentTranscript, 'Copied to clipboard!');
  }
});

// Download as text file
downloadTxtBtn.addEventListener('click', () => {
  if (currentTranscript) {
    const filename = `instagram_${currentMediaId || Date.now()}.txt`;
    downloadFile(currentTranscript, filename, 'text/plain');
  }
});
