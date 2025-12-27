// Authentication module for Chrome extension
const AUTH_WORKER_URL = 'https://api.transcriptmagic.com';

// Get stored user from local storage
async function getUser() {
  const result = await chrome.storage.local.get('user');
  return result.user || null;
}

// Save user to local storage
async function saveUser(user) {
  await chrome.storage.local.set({ user });
}

// Clear user from storage
async function clearUser() {
  await chrome.storage.local.remove('user');
}

// Get auth token non-interactively (for API requests)
async function getAuthToken() {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError || !token) {
        resolve(null);
      } else {
        resolve(token);
      }
    });
  });
}

// Get device ID from storage
async function getDeviceId() {
  const result = await chrome.storage.local.get('deviceId');
  if (result.deviceId) return result.deviceId;

  const newDeviceId = crypto.randomUUID();
  await chrome.storage.local.set({ deviceId: newDeviceId });
  return newDeviceId;
}

// Sign in with Google
async function signIn() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, async (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || 'Sign in failed'));
        return;
      }

      try {
        const deviceId = await getDeviceId();

        // Verify token with backend and get/create user
        const response = await fetch(`${AUTH_WORKER_URL}/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, deviceId }),
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error || 'Failed to authenticate');
        }

        const user = await response.json();
        await saveUser(user);
        resolve(user);
      } catch (err) {
        // Remove cached token on error
        chrome.identity.removeCachedAuthToken({ token });
        reject(err);
      }
    });
  });
}

// Sign out
async function signOut() {
  const token = await getAuthToken();
  if (token) {
    // Remove from Chrome's cache
    chrome.identity.removeCachedAuthToken({ token });

    // Revoke with Google
    try {
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
    } catch (e) {
      // Ignore revoke errors
    }
  }
  await clearUser();
}

// Refresh user data from server
async function refreshUser() {
  const token = await getAuthToken();
  if (!token) return null;

  try {
    const deviceId = await getDeviceId();
    const response = await fetch(`${AUTH_WORKER_URL}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, deviceId }),
    });

    if (!response.ok) return null;

    const user = await response.json();
    await saveUser(user);
    return user;
  } catch {
    return null;
  }
}

// Check if user has a valid cached token and authenticate if so
// This handles the case where popup closed during OAuth flow
async function checkAndRestoreSession() {
  const token = await getAuthToken();
  if (!token) return null;

  // We have a cached token - try to get/restore user session
  try {
    const deviceId = await getDeviceId();
    const response = await fetch(`${AUTH_WORKER_URL}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, deviceId }),
    });

    if (!response.ok) return null;

    const user = await response.json();
    await saveUser(user);
    return user;
  } catch {
    return null;
  }
}

// Export functions for use in popup.js
window.Auth = {
  getUser,
  saveUser,
  clearUser,
  getAuthToken,
  signIn,
  signOut,
  refreshUser,
  checkAndRestoreSession,
};
