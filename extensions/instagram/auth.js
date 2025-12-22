// auth.js - Google OAuth helpers for Chrome Extension

// Uses WORKER_URL from popup.js (loaded first would cause issues, so we define it here if not exists)
const AUTH_WORKER_URL = 'https://api.klipgrab.com';

// Get cached user from local storage
async function getUser() {
  const { user } = await chrome.storage.local.get('user');
  return user || null;
}

// Save user to local storage
async function saveUser(user) {
  await chrome.storage.local.set({ user });
}

// Clear user from local storage
async function clearUser() {
  await chrome.storage.local.remove('user');
}

// Get Google auth token (non-interactive, for API calls)
async function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(token);
    });
  });
}

// Sign in with Google
async function signIn() {
  return new Promise((resolve, reject) => {
    console.log('Auth.signIn: requesting token...');
    chrome.identity.getAuthToken({ interactive: true }, async (token) => {
      if (chrome.runtime.lastError) {
        console.error('Auth.signIn: getAuthToken error:', chrome.runtime.lastError);
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      console.log('Auth.signIn: got token, verifying with worker...');

      try {
        // Get device ID to link with account
        const { deviceId } = await chrome.storage.local.get('deviceId');
        console.log('Auth.signIn: deviceId:', deviceId);

        // Verify token with our worker and get user data
        const res = await fetch(`${AUTH_WORKER_URL}/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, deviceId })
        });

        console.log('Auth.signIn: worker response status:', res.status);

        if (!res.ok) {
          const error = await res.json();
          console.error('Auth.signIn: worker error:', error);
          throw new Error(error.error || 'Authentication failed');
        }

        const user = await res.json();
        console.log('Auth.signIn: user from worker:', user);
        await saveUser(user);
        console.log('Auth.signIn: user saved to storage');
        resolve(user);
      } catch (err) {
        console.error('Auth.signIn: error:', err);
        // Revoke token on failure
        chrome.identity.removeCachedAuthToken({ token });
        reject(err);
      }
    });
  });
}

// Sign out
async function signOut() {
  await clearUser();

  // Revoke Google token
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        // Remove from Chrome's cache
        chrome.identity.removeCachedAuthToken({ token }, () => {
          // Also revoke with Google
          fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`)
            .finally(() => resolve());
        });
      } else {
        resolve();
      }
    });
  });
}

// Refresh user data from server
async function refreshUser() {
  try {
    const token = await getAuthToken();
    const { deviceId } = await chrome.storage.local.get('deviceId');

    const res = await fetch(`${AUTH_WORKER_URL}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, deviceId })
    });

    if (!res.ok) {
      throw new Error('Failed to refresh user');
    }

    const user = await res.json();
    await saveUser(user);
    return user;
  } catch (err) {
    // If refresh fails, clear local user
    await clearUser();
    return null;
  }
}

// Export functions
window.Auth = {
  getUser,
  signIn,
  signOut,
  getAuthToken,
  refreshUser
};
