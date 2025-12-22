import { useState, useEffect } from 'react';

const WORKER_URL = 'https://api.klipgrab.com';
const GOOGLE_CLIENT_ID = '600326666488-qff3c5vbit0s8b0tlntm4nlgr670er5j.apps.googleusercontent.com';

interface User {
  googleId: string;
  email: string;
  name: string;
  picture: string;
  credits: number;
  plan: string;
}

export default function DownloadForm() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [deviceId, setDeviceId] = useState<string>('');
  const [remainingFree, setRemainingFree] = useState(10);

  // Initialize device ID and check for saved user
  useEffect(() => {
    // Get or create device ID
    let id = localStorage.getItem('deviceId');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('deviceId', id);
    }
    setDeviceId(id);

    // Check for saved user
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }

    // Get remaining free downloads
    const remaining = localStorage.getItem('remainingFree');
    if (remaining) {
      setRemainingFree(parseInt(remaining, 10));
    }

    // Initialize Google Sign-In
    if (typeof google !== 'undefined') {
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCallback,
      });
    }
  }, []);

  // Refresh user data from server
  const refreshUser = async (token: string) => {
    try {
      const res = await fetch(`${WORKER_URL}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, deviceId }),
      });

      if (res.ok) {
        const userData = await res.json();
        setUser(userData);
        localStorage.setItem('user', JSON.stringify(userData));
        return userData;
      }
    } catch (err) {
      console.error('Failed to refresh user:', err);
    }
    return null;
  };

  // Handle Google Sign-In callback
  const handleGoogleCallback = async (response: google.accounts.id.CredentialResponse) => {
    try {
      // Exchange the credential for an access token via our worker
      const res = await fetch(`${WORKER_URL}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: response.credential,
          deviceId
        }),
      });

      if (res.ok) {
        const userData = await res.json();
        setUser(userData);
        localStorage.setItem('user', JSON.stringify(userData));
        localStorage.setItem('googleCredential', response.credential);
        setStatus({ message: 'Signed in successfully!', type: 'success' });
      } else {
        setStatus({ message: 'Sign in failed', type: 'error' });
      }
    } catch (err) {
      setStatus({ message: 'Sign in failed', type: 'error' });
    }
  };

  // Sign in with Google
  const handleSignIn = () => {
    if (typeof google !== 'undefined') {
      google.accounts.id.prompt();
    }
  };

  // Sign out
  const handleSignOut = () => {
    setUser(null);
    localStorage.removeItem('user');
    localStorage.removeItem('googleCredential');
    setStatus({ message: 'Signed out', type: 'info' });
  };

  // Validate TikTok URL
  const isValidTikTokUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      if (!parsed.hostname.endsWith('tiktok.com')) return false;
      if (parsed.hostname === 'vm.tiktok.com') return true;
      return parsed.pathname.includes('/video/');
    } catch {
      return false;
    }
  };

  // Download video
  const handleDownload = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!url.trim()) {
      setStatus({ message: 'Please enter a TikTok URL', type: 'error' });
      return;
    }

    if (!isValidTikTokUrl(url)) {
      setStatus({ message: 'Please enter a valid TikTok video URL', type: 'error' });
      return;
    }

    // Check credits/remaining
    if (user && user.credits <= 0) {
      setStatus({ message: 'Out of credits. Please upgrade!', type: 'error' });
      return;
    }
    if (!user && remainingFree <= 0) {
      setStatus({ message: 'Free trial exhausted. Sign in to continue!', type: 'error' });
      return;
    }

    setLoading(true);
    setStatus({ message: 'Fetching video...', type: 'info' });

    try {
      const body: Record<string, string> = { url, deviceId };

      // Include credential if signed in
      const credential = localStorage.getItem('googleCredential');
      if (user && credential) {
        body.credential = credential;
      }

      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (data.error === 'limit_reached' || data.error === 'no_credits') {
        if (user) {
          setUser({ ...user, credits: 0 });
        } else {
          setRemainingFree(0);
          localStorage.setItem('remainingFree', '0');
        }
        setStatus({
          message: user ? 'Out of credits. Please upgrade!' : 'Free trial exhausted. Sign in!',
          type: 'error'
        });
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch video');
      }

      if (!data.downloadUrl) {
        throw new Error('No download URL received');
      }

      // Update credits/remaining
      if (user && typeof data.credits === 'number') {
        setUser({ ...user, credits: data.credits });
        localStorage.setItem('user', JSON.stringify({ ...user, credits: data.credits }));
      } else if (typeof data.remaining === 'number') {
        setRemainingFree(data.remaining);
        localStorage.setItem('remainingFree', String(data.remaining));
      }

      // Trigger download
      setStatus({ message: 'Starting download...', type: 'success' });

      const link = document.createElement('a');
      link.href = data.downloadUrl;
      link.download = `tiktok_${Date.now()}.mp4`;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setStatus({ message: 'Download started!', type: 'success' });
      setUrl('');

    } catch (err) {
      setStatus({ message: err instanceof Error ? err.message : 'Download failed', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="download-form-container">
      {/* User status */}
      <div className="user-status">
        {user ? (
          <div className="user-info">
            <img src={user.picture} alt={user.name} className="user-avatar" />
            <div className="user-details">
              <span className="user-name">{user.name}</span>
              <span className="user-credits">{user.credits} credits remaining</span>
            </div>
            <button onClick={handleSignOut} className="sign-out-btn">Sign Out</button>
          </div>
        ) : (
          <div className="anonymous-info">
            <div className="remaining-wrap">
              <span className="remaining-count">{remainingFree}</span>
              <span className="remaining-label">free downloads left</span>
            </div>
            <button onClick={handleSignIn} className="sign-in-btn">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Sign in for more
            </button>
          </div>
        )}
      </div>

      {/* Download form */}
      <form onSubmit={handleDownload} className="download-form">
        <div className="input-group">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste TikTok video URL..."
            disabled={loading}
          />
          <button type="submit" disabled={loading} className="download-btn">
            {loading ? (
              <span className="spinner" />
            ) : (
              <>
                <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
                  <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z"/>
                  <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z"/>
                </svg>
                Download
              </>
            )}
          </button>
        </div>
      </form>

      {/* Status message */}
      {status && (
        <div className={`status status-${status.type}`}>
          {status.type === 'success' && (
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd"/>
            </svg>
          )}
          {status.type === 'error' && (
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd"/>
            </svg>
          )}
          {status.type === 'info' && (
            <svg className="spinner-small" viewBox="0 0 20 20" fill="none" width="16" height="16">
              <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" strokeDasharray="40" strokeDashoffset="10"/>
            </svg>
          )}
          <span>{status.message}</span>
        </div>
      )}

      <style>{`
        .download-form-container {
          font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
        }

        .user-status {
          margin-bottom: 1.25rem;
          padding-bottom: 1.25rem;
          border-bottom: 1px solid #e2e8f0;
        }

        .user-info {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .user-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border: 2px solid #e2e8f0;
        }

        .user-details {
          display: flex;
          flex-direction: column;
          flex: 1;
        }

        .user-name {
          font-weight: 600;
          font-size: 0.9375rem;
          color: #0f172a;
        }

        .user-credits {
          font-size: 0.8125rem;
          color: #06b6d4;
          font-weight: 500;
        }

        .sign-out-btn {
          background: none;
          border: 1px solid #e2e8f0;
          padding: 0.5rem 0.875rem;
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.8125rem;
          font-weight: 500;
          color: #64748b;
          transition: all 0.2s;
        }

        .sign-out-btn:hover {
          background: #f8fafc;
          border-color: #cbd5e1;
          color: #0f172a;
        }

        .anonymous-info {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .remaining-wrap {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .remaining-count {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          background: linear-gradient(135deg, #06b6d4 0%, #0891b2 100%);
          color: white;
          border-radius: 8px;
          font-weight: 700;
          font-size: 0.9375rem;
        }

        .remaining-label {
          color: #64748b;
          font-size: 0.875rem;
        }

        .sign-in-btn {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          background: white;
          border: 1px solid #e2e8f0;
          padding: 0.5rem 1rem;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 500;
          font-size: 0.875rem;
          color: #0f172a;
          transition: all 0.2s;
        }

        .sign-in-btn:hover {
          background: #f8fafc;
          border-color: #cbd5e1;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
        }

        .download-form {
          margin-bottom: 1rem;
        }

        .input-group {
          display: flex;
          gap: 0.75rem;
        }

        .input-group input {
          flex: 1;
          padding: 0.875rem 1rem;
          border: 2px solid #e2e8f0;
          border-radius: 10px;
          font-size: 0.9375rem;
          font-family: inherit;
          outline: none;
          transition: all 0.2s;
          background: #f8fafc;
        }

        .input-group input::placeholder {
          color: #94a3b8;
        }

        .input-group input:focus {
          border-color: #06b6d4;
          background: white;
          box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.1);
        }

        .download-btn {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.875rem 1.5rem;
          background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 0.9375rem;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 2px 8px rgba(249, 115, 22, 0.25);
        }

        .download-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(249, 115, 22, 0.35);
        }

        .download-btn:active:not(:disabled) {
          transform: translateY(0);
        }

        .download-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .spinner {
          width: 18px;
          height: 18px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .status {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          border-radius: 8px;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .status-success {
          background: rgba(16, 185, 129, 0.1);
          color: #059669;
        }

        .status-error {
          background: rgba(239, 68, 68, 0.1);
          color: #dc2626;
        }

        .status-info {
          background: rgba(6, 182, 212, 0.1);
          color: #0891b2;
        }

        .spinner-small {
          animation: spin 1s linear infinite;
        }

        @media (max-width: 480px) {
          .input-group {
            flex-direction: column;
          }

          .download-btn {
            width: 100%;
            justify-content: center;
          }

          .anonymous-info {
            flex-direction: column;
            gap: 1rem;
            align-items: stretch;
          }

          .remaining-wrap {
            justify-content: center;
          }

          .sign-in-btn {
            justify-content: center;
          }
        }
      `}</style>
    </div>
  );
}

// Type declaration for Google Sign-In
declare global {
  interface Window {
    google?: typeof google;
  }
}

declare namespace google.accounts.id {
  interface CredentialResponse {
    credential: string;
  }
  function initialize(config: { client_id: string; callback: (response: CredentialResponse) => void }): void;
  function prompt(): void;
}
