// Configuration
const WORKER_URL = 'https://api.klipgrab.com';

// Device ID management for usage tracking
async function getDeviceId() {
  const result = await chrome.storage.local.get('deviceId');
  if (result.deviceId) return result.deviceId;
  const deviceId = crypto.randomUUID();
  await chrome.storage.local.set({ deviceId });
  return deviceId;
}

async function getRemainingCount() {
  const result = await chrome.storage.local.get('remainingCount');
  return result.remainingCount ?? 10;
}

async function setRemainingCount(count) {
  await chrome.storage.local.set({ remainingCount: count });
  updateRemainingDisplay(count);
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

function showSignupPrompt(isSignedIn = false) {
  if (isSignedIn) {
    // Show upgrade prompt for signed-in users
    document.getElementById('signupPrompt')?.classList.remove('visible');
    document.getElementById('upgradePrompt')?.classList.add('visible');
  } else {
    // Show signup prompt for anonymous users
    document.getElementById('signupPrompt')?.classList.add('visible');
    document.getElementById('upgradePrompt')?.classList.remove('visible');
  }
  document.querySelector('.form-section')?.classList.add('disabled');
  document.getElementById('currentVideo')?.classList.add('disabled');
}

function hideSignupPrompt() {
  document.getElementById('signupPrompt')?.classList.remove('visible');
  document.getElementById('upgradePrompt')?.classList.remove('visible');
  document.querySelector('.form-section')?.classList.remove('disabled');
  document.getElementById('currentVideo')?.classList.remove('disabled');
}

// Auth UI management
function updateAuthUI(user) {
  const userSection = document.getElementById('userSection');
  const signInSection = document.getElementById('signInSection');
  const remainingCounter = document.getElementById('remainingCount');

  if (user) {
    // User is signed in
    userSection.classList.remove('hidden');
    signInSection.classList.add('hidden');

    document.getElementById('userAvatar').src = user.picture || '';
    document.getElementById('userName').textContent = user.name || user.email;
    document.getElementById('userCredits').textContent = `${user.credits} credits`;

    // Show credits instead of "free downloads remaining"
    if (remainingCounter) {
      remainingCounter.innerHTML = `
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
        </svg>
        <span><span id="countValue">${user.credits}</span> credits available</span>
      `;
      remainingCounter.classList.remove('warning', 'exhausted');
      if (user.credits <= 10 && user.credits > 0) {
        remainingCounter.classList.add('warning');
      } else if (user.credits <= 0) {
        remainingCounter.classList.add('exhausted');
      }
    }

    // If user has credits, hide prompts and enable form
    if (user.credits > 0) {
      hideSignupPrompt();
    } else {
      // User is signed in but out of credits - show upgrade prompt
      showSignupPrompt(true);
    }
  } else {
    // User is not signed in
    userSection.classList.add('hidden');
    signInSection.classList.remove('hidden');
  }
}

const form = document.getElementById('downloadForm');
const urlInput = document.getElementById('urlInput');
const downloadBtn = document.getElementById('downloadBtn');
const status = document.getElementById('status');
const currentVideoSection = document.getElementById('currentVideo');
const downloadCurrentBtn = document.getElementById('downloadCurrentBtn');

let currentTabUrl = null;

// Initialize on popup open
document.addEventListener('DOMContentLoaded', async () => {
  // Check if user is signed in (from cache - instant)
  let user = await Auth.getUser();
  console.log('DOMContentLoaded - user from storage:', user);

  // Show cached user immediately for instant UI
  if (user) {
    console.log('Showing cached user immediately');
    updateAuthUI(user);

    // Then refresh from server in background to get latest credits
    Auth.refreshUser().then(refreshedUser => {
      if (refreshedUser) {
        console.log('Background refresh complete:', refreshedUser.credits, 'credits');
        updateAuthUI(refreshedUser);
      }
    }).catch(e => {
      console.log('Background refresh failed, using cached data:', e.message);
    });
  } else {
    // No cached user - check if there's a Google token (from incomplete auth)
    try {
      const token = await Auth.getAuthToken();
      if (token) {
        console.log('Found cached token, completing auth...');
        user = await Auth.signIn();
        console.log('Auto-completed auth, user:', user);
        updateAuthUI(user);
      }
    } catch (e) {
      // No cached token or auth failed, that's fine
      console.log('No cached token or auto-auth failed:', e.message);
    }
  }

  // If still no user, show anonymous UI
  if (!user) {
    console.log('No user found, showing anonymous UI');
    const count = await getRemainingCount();
    updateRemainingDisplay(count);
    if (count <= 0) showSignupPrompt();
    updateAuthUI(null);
  }

  // Sign in button handler
  document.getElementById('signInBtn').addEventListener('click', async () => {
    const btn = document.getElementById('signInBtn');
    btn.disabled = true;
    btn.textContent = 'Signing in...';

    try {
      console.log('Starting sign in...');
      const user = await Auth.signIn();
      console.log('Sign in completed, user:', user);
      updateAuthUI(user);
      showStatus('Signed in successfully!', 'success');
    } catch (err) {
      console.error('Sign in error:', err);
      showStatus('Sign in failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        Sign in with Google
      `;
    }
  });

  // Sign out button handler
  document.getElementById('signOutBtn').addEventListener('click', async () => {
    await Auth.signOut();
    updateAuthUI(null);

    // Reset to free trial state
    const count = await getRemainingCount();
    updateRemainingDisplay(count);
    if (count <= 0) showSignupPrompt();

    showStatus('Signed out', 'info');
  });

  // Signup prompt sign-in button (same as main sign in)
  document.getElementById('signupBtn').addEventListener('click', async () => {
    const btn = document.getElementById('signupBtn');
    btn.disabled = true;

    try {
      const user = await Auth.signIn();
      updateAuthUI(user);
      showStatus('Signed in successfully!', 'success');
    } catch (err) {
      showStatus('Sign in failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // Upgrade button handler (opens checkout)
  document.getElementById('upgradeBtn').addEventListener('click', async () => {
    const user = await Auth.getUser();
    if (!user) {
      // Not signed in, sign in first
      try {
        await Auth.signIn();
        updateAuthUI(await Auth.getUser());
      } catch (err) {
        showStatus('Sign in failed: ' + err.message, 'error');
      }
      return;
    }

    // User is signed in, open checkout
    const btn = document.getElementById('upgradeBtn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Loading...';

    try {
      const token = await Auth.getAuthToken();
      const res = await fetch(`${WORKER_URL}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, plan: 'monthly' })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create checkout');
      }

      if (data.url) {
        // Open checkout in new tab
        chrome.tabs.create({ url: data.url });
        showStatus('Opening checkout...', 'success');
      } else {
        throw new Error('No checkout URL received');
      }
    } catch (err) {
      console.error('Checkout error:', err);
      showStatus('Checkout failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  // Helper function to open checkout for a specific plan
  async function openCheckout(plan, button) {
    const originalHTML = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span> Loading...';

    try {
      const token = await Auth.getAuthToken();
      const res = await fetch(`${WORKER_URL}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, plan })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create checkout');
      }

      if (data.url) {
        chrome.tabs.create({ url: data.url });
        showStatus('Opening checkout...', 'success');
      } else {
        throw new Error('No checkout URL received');
      }
    } catch (err) {
      console.error('Checkout error:', err);
      showStatus('Checkout failed: ' + err.message, 'error');
    } finally {
      button.disabled = false;
      button.innerHTML = originalHTML;
    }
  }

  // Monthly plan button handler
  document.getElementById('monthlyPlanBtn').addEventListener('click', async (e) => {
    await openCheckout('monthly', e.currentTarget);
  });

  // Yearly plan button handler
  document.getElementById('yearlyPlanBtn').addEventListener('click', async (e) => {
    await openCheckout('yearly', e.currentTarget);
  });
});

// Check if URL is a TikTok video page (with /video/ in path)
function isTikTokVideoPage(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('tiktok.com') && parsed.pathname.includes('/video/');
  } catch {
    return false;
  }
}

// Validate TikTok video URL
function isValidTikTokUrl(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('tiktok.com')) {
      return false;
    }
    // Short links (vm.tiktok.com) are valid, they redirect to video
    if (parsed.hostname === 'vm.tiktok.com') {
      return true;
    }
    // Must contain /video/ in path
    return parsed.pathname.includes('/video/');
  } catch {
    return false;
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

// Download video from URL
async function downloadVideo(url, button) {
  const user = await Auth.getUser();

  // Check credits/remaining count before attempting
  if (user) {
    if (user.credits <= 0) {
      showSignupPrompt();
      showStatus('Out of credits. Upgrade to continue!', 'error');
      return;
    }
  } else {
    const currentRemaining = await getRemainingCount();
    if (currentRemaining <= 0) {
      showSignupPrompt();
      showStatus('Free trial exhausted. Sign in to continue!', 'error');
      return;
    }
  }

  setLoading(button, true);
  showStatus('Fetching video...');

  try {
    const deviceId = await getDeviceId();

    // Build request body
    const body = { url, deviceId };

    // Include auth token if signed in
    if (user) {
      try {
        body.token = await Auth.getAuthToken();
      } catch (e) {
        // Token expired, try to refresh
        console.log('Token expired, signing out');
        await Auth.signOut();
        updateAuthUI(null);
      }
    }

    const response = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    // Handle limit/credits errors
    if (data.error === 'limit_reached' || data.error === 'no_credits') {
      if (user) {
        // Update user credits locally
        user.credits = 0;
        await Auth.getUser(); // This won't work, need to refresh
        const refreshedUser = await Auth.refreshUser();
        updateAuthUI(refreshedUser);
      } else {
        await setRemainingCount(0);
      }
      showSignupPrompt();
      showStatus(user ? 'Out of credits. Upgrade to continue!' : 'Free trial exhausted. Sign in to continue!', 'error');
      setLoading(button, false);
      return;
    }

    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch video');
    }

    if (!data.downloadUrl) {
      throw new Error('No download URL received');
    }

    // Update credits/remaining from server response
    if (user && typeof data.credits === 'number') {
      // Refresh user data to get updated credits
      const refreshedUser = await Auth.refreshUser();
      if (refreshedUser) {
        updateAuthUI(refreshedUser);
      }
    } else if (typeof data.remaining === 'number') {
      await setRemainingCount(data.remaining);
    }

    showStatus('Starting download...');

    chrome.downloads.download({
      url: data.downloadUrl,
      filename: `tiktok_${Date.now()}.mp4`,
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        showStatus('Download failed: ' + chrome.runtime.lastError.message, 'error');
      } else {
        showStatus('Successfully Downloaded!', 'success');
        urlInput.value = '';
      }
      setLoading(button, false);
    });

  } catch (err) {
    console.error('Error:', err);
    showStatus(err.message || 'Something went wrong', 'error');
    setLoading(button, false);
  }
}

// Check current tab for TikTok video
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]?.url && isTikTokVideoPage(tabs[0].url)) {
    currentTabUrl = tabs[0].url;
    currentVideoSection.classList.add('visible');
  }
});

// Handle "Download this Video" button
downloadCurrentBtn.addEventListener('click', () => {
  if (currentTabUrl) {
    downloadVideo(currentTabUrl, downloadCurrentBtn);
  }
});

// Handle form submission (manual URL)
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();

  if (!isValidTikTokUrl(url)) {
    showStatus('Please enter a TikTok video URL', 'error');
    return;
  }

  downloadVideo(url, downloadBtn);
});
