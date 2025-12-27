// Configuration
const WORKER_URL = 'https://api.transcriptmagic.com';
const FREE_LIMIT = 10;

// State
let currentTranscript = null;
let currentMediaId = null;
let deviceId = null;
let user = null;

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
    // Only show anonymous counter when not signed in and 3 or fewer credits remaining
    remainingEl.classList.toggle('hidden', user || count > 3);
  }
}

// Update auth UI based on user state
function updateAuthUI() {
  const signedOutSection = document.getElementById('signedOutSection');
  const signedInSection = document.getElementById('signedInSection');
  const remainingEl = document.getElementById('remainingCount');

  if (user) {
    // Show signed-in UI
    signedOutSection.classList.add('hidden');
    signedInSection.classList.remove('hidden');
    if (remainingEl) remainingEl.classList.add('hidden');

    const avatar = document.getElementById('userAvatar');
    const name = document.getElementById('userName');
    const credits = document.getElementById('userCredits');

    if (avatar) avatar.src = user.picture || '';
    if (name) name.textContent = user.name || user.email || 'User';
    if (credits) credits.textContent = `${user.credits} credits`;
  } else {
    // Show signed-out UI
    signedOutSection.classList.remove('hidden');
    signedInSection.classList.add('hidden');
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
    const requestBody = { url, deviceId };

    // Include auth token if signed in
    if (user) {
      const token = await Auth.getAuthToken();
      if (token) {
        requestBody.token = token;
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(`${WORKER_URL}/api/instagram/transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await response.json();

    if (!response.ok) {
      // Handle auth errors
      if (response.status === 401) {
        await Auth.signOut();
        user = null;
        updateAuthUI();
        showStatus('Session expired. Please sign in again.', 'error');
        return;
      }

      // Update credits display
      if (typeof data.remaining === 'number') {
        await setRemainingCount(data.remaining);
        updateRemainingDisplay(data.remaining);
      }
      if (typeof data.credits === 'number' && user) {
        user.credits = data.credits;
        await Auth.saveUser(user);
        updateAuthUI();
      }
      throw new Error(data.error || 'Failed to fetch transcript');
    }

    if (!data.transcripts || data.transcripts.length === 0) {
      throw new Error('No transcript available for this post');
    }

    // Update credits from response
    if (typeof data.credits === 'number' && user) {
      user.credits = data.credits;
      await Auth.saveUser(user);
      updateAuthUI();
    } else if (typeof data.remaining === 'number') {
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
    if (err.name === 'AbortError') {
      showStatus('Request timed out. Please try again.', 'error');
    } else {
      showStatus(err.message || 'Something went wrong', 'error');
    }
  } finally {
    setLoading(button, false);
  }
}

// Initialize on popup open
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize device ID
  deviceId = await getDeviceId();

  // Check for existing signed-in user
  user = await Auth.getUser();
  updateAuthUI();

  // If signed in, refresh user data in background
  if (user) {
    Auth.refreshUser().then(updatedUser => {
      if (updatedUser) {
        user = updatedUser;
        updateAuthUI();
      }
    });
  } else {
    // No saved user - check if there's a cached token from a previous OAuth flow
    // This handles the case where popup closed during sign-in
    Auth.checkAndRestoreSession().then(restoredUser => {
      if (restoredUser) {
        user = restoredUser;
        updateAuthUI();
        showStatus('Signed in successfully!', 'success');
      } else {
        // Only show anonymous credits if not signed in
        getRemainingCount().then(count => updateRemainingDisplay(count));
      }
    });

    // Show anonymous credits initially while checking
    const count = await getRemainingCount();
    updateRemainingDisplay(count);
  }

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

// Sign-in button handler
document.getElementById('signInBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('signInBtn');
  btn.disabled = true;
  btn.textContent = 'Signing in...';

  try {
    user = await Auth.signIn();
    updateAuthUI();
    showStatus('Signed in successfully!', 'success');
  } catch (err) {
    console.error('Sign in error:', err);
    showStatus('Sign in failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
      Sign in with Google
    `;
  }
});

// Sign-out button handler
document.getElementById('signOutBtn')?.addEventListener('click', async () => {
  await Auth.signOut();
  user = null;
  updateAuthUI();

  // Refresh anonymous credits display
  const count = await getRemainingCount();
  updateRemainingDisplay(count);

  showStatus('Signed out', 'info');
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

// Get More Credits button
const getMoreCreditsBtn = document.getElementById('getMoreCreditsBtn');
if (getMoreCreditsBtn) {
  getMoreCreditsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://transcriptmagic.com/credits' });
  });
}
