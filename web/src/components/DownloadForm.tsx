import { useState, useEffect } from 'react';

const WORKER_URL = 'https://api.transcriptmagic.com';

type Platform = 'youtube' | 'tiktok' | 'instagram';

interface TranscriptSegment {
  text: string;
  start?: number;
  end?: number;
}

interface DownloadFormProps {
  platform?: Platform;
}

export default function DownloadForm({ platform }: DownloadFormProps) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [deviceId, setDeviceId] = useState<string>('');
  const [remainingFree, setRemainingFree] = useState(10);
  const [transcript, setTranscript] = useState<TranscriptSegment[] | null>(null);

  // Initialize device ID
  useEffect(() => {
    let id = localStorage.getItem('deviceId');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('deviceId', id);
    }
    setDeviceId(id);

    // Get remaining free downloads
    const remaining = localStorage.getItem('remainingFree');
    if (remaining) {
      setRemainingFree(parseInt(remaining, 10));
    }
  }, []);

  // Platform validators
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

  const isValidYouTubeUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      const validHosts = ['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com'];
      if (!validHosts.some(host => parsed.hostname === host || parsed.hostname.endsWith('.' + host))) {
        return false;
      }
      if (parsed.hostname === 'youtu.be') {
        return parsed.pathname.length > 1;
      }
      return parsed.pathname.includes('/watch') ||
             parsed.pathname.includes('/shorts/') ||
             parsed.searchParams.has('v');
    } catch {
      return false;
    }
  };

  const isValidInstagramUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      if (!parsed.hostname.endsWith('instagram.com')) return false;
      return parsed.pathname.includes('/reel/') || parsed.pathname.includes('/p/');
    } catch {
      return false;
    }
  };

  // Detect platform from URL
  const detectPlatform = (url: string): Platform | null => {
    if (isValidYouTubeUrl(url)) return 'youtube';
    if (isValidTikTokUrl(url)) return 'tiktok';
    if (isValidInstagramUrl(url)) return 'instagram';
    return null;
  };

  // Get placeholder text based on platform
  const getPlaceholder = (): string => {
    if (platform === 'youtube') return 'Paste YouTube video URL...';
    if (platform === 'tiktok') return 'Paste TikTok video URL...';
    if (platform === 'instagram') return 'Paste Instagram reel URL...';
    return 'Paste YouTube, TikTok, or Instagram URL...';
  };

  // Get platform display name
  const getPlatformName = (p: Platform): string => {
    if (p === 'youtube') return 'YouTube';
    if (p === 'tiktok') return 'TikTok';
    if (p === 'instagram') return 'Instagram';
    return '';
  };

  // Format timestamp
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Copy transcript to clipboard
  const copyTranscript = (withTimestamps: boolean) => {
    if (!transcript) return;
    const text = transcript.map(seg => {
      if (withTimestamps && seg.start !== undefined) {
        return `[${formatTime(seg.start)}] ${seg.text}`;
      }
      return seg.text;
    }).join('\n');
    navigator.clipboard.writeText(text);
    setStatus({ message: 'Copied to clipboard!', type: 'success' });
  };

  // Download as SRT
  const downloadSRT = () => {
    if (!transcript) return;
    const srt = transcript.map((seg, i) => {
      const start = seg.start ?? i * 3;
      const end = seg.end ?? start + 3;
      const formatSRT = (s: number) => {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        const ms = Math.floor((s % 1) * 1000);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
      };
      return `${i + 1}\n${formatSRT(start)} --> ${formatSRT(end)}\n${seg.text}\n`;
    }).join('\n');
    const blob = new Blob([srt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `transcript_${Date.now()}.srt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Handle transcription
  const handleTranscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    setTranscript(null);

    if (!url.trim()) {
      const platformName = platform ? getPlatformName(platform) : 'video';
      setStatus({ message: `Please enter a ${platformName} URL`, type: 'error' });
      return;
    }

    // Detect or validate platform
    const detectedPlatform = platform || detectPlatform(url);

    if (!detectedPlatform) {
      setStatus({ message: 'Please enter a valid YouTube, TikTok, or Instagram URL', type: 'error' });
      return;
    }

    // If platform is specified, validate URL matches that platform
    if (platform) {
      const validators: Record<Platform, (url: string) => boolean> = {
        youtube: isValidYouTubeUrl,
        tiktok: isValidTikTokUrl,
        instagram: isValidInstagramUrl,
      };
      if (!validators[platform](url)) {
        setStatus({ message: `Please enter a valid ${getPlatformName(platform)} URL`, type: 'error' });
        return;
      }
    }

    if (remainingFree <= 0) {
      setStatus({ message: 'Free trial exhausted. Please sign in to continue!', type: 'error' });
      return;
    }

    setLoading(true);
    setStatus({ message: `Fetching ${getPlatformName(detectedPlatform)} transcript...`, type: 'info' });

    try {
      const endpoint = `${WORKER_URL}/api/${detectedPlatform}/transcript`;
      const body: Record<string, string> = { url, deviceId };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (data.error === 'limit_reached' || data.error === 'no_credits') {
        setRemainingFree(0);
        localStorage.setItem('remainingFree', '0');
        setStatus({
          message: 'Free trial exhausted. Please sign in to continue!',
          type: 'error'
        });
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch transcript');
      }

      // Update remaining
      if (typeof data.remaining === 'number') {
        setRemainingFree(data.remaining);
        localStorage.setItem('remainingFree', String(data.remaining));
      }

      // Parse transcript from response
      const segments: TranscriptSegment[] = data.transcript || data.subtitles || [];
      if (segments.length === 0) {
        throw new Error('No transcript available for this video');
      }

      setTranscript(segments);
      setStatus({ message: 'Transcript ready!', type: 'success' });

    } catch (err) {
      setStatus({ message: err instanceof Error ? err.message : 'Transcription failed', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="download-form-container">
      {/* Remaining downloads */}
      <div className="remaining-status">
        <div className="remaining-wrap">
          <span className="remaining-count">{remainingFree}</span>
          <span className="remaining-label">free transcripts remaining</span>
        </div>
      </div>

      {/* Transcribe form */}
      <form onSubmit={handleTranscribe} className="download-form">
        <div className="input-group">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={getPlaceholder()}
            disabled={loading}
          />
          <button type="submit" disabled={loading} className="download-btn">
            {loading ? (
              <span className="spinner" />
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                  <path d="M4 4h16v16H4z" fill="currentColor" opacity="0.2"/>
                  <path d="M8 8h8M8 12h8M8 16h4"/>
                </svg>
                Transcribe
              </>
            )}
          </button>
        </div>
      </form>

      {/* Status message */}
      {status && !transcript && (
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

      {/* Transcript result */}
      {transcript && (
        <div className="transcript-result">
          <div className="transcript-actions">
            <button onClick={() => copyTranscript(false)} className="action-btn">
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                <path d="M8 2a1 1 0 000 2h2a1 1 0 100-2H8z"/>
                <path d="M3 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v6h-4.586l1.293-1.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L10.414 13H15v3a2 2 0 01-2 2H5a2 2 0 01-2-2V5z"/>
              </svg>
              Copy Text
            </button>
            <button onClick={() => copyTranscript(true)} className="action-btn">
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/>
              </svg>
              Copy with Timestamps
            </button>
            <button onClick={downloadSRT} className="action-btn action-btn-primary">
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd"/>
              </svg>
              Download SRT
            </button>
          </div>
          <div className="transcript-content">
            {transcript.map((seg, i) => (
              <div key={i} className="transcript-segment">
                {seg.start !== undefined && (
                  <span className="segment-time">{formatTime(seg.start)}</span>
                )}
                <span className="segment-text">{seg.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        .download-form-container {
          font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
        }

        .remaining-status {
          margin-bottom: 1.25rem;
          padding-bottom: 1.25rem;
          border-bottom: 1px solid #e2e8f0;
        }

        .remaining-wrap {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.625rem;
        }

        .remaining-count {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
          color: white;
          border-radius: 10px;
          font-weight: 700;
          font-size: 1rem;
        }

        .remaining-label {
          color: #64748b;
          font-size: 0.9375rem;
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
          border-color: #3b82f6;
          background: white;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        }

        .download-btn {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.875rem 1.5rem;
          background: #2563eb;
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 0.9375rem;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
        }

        .download-btn:hover:not(:disabled) {
          background: #1d4ed8;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
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
          background: rgba(37, 99, 235, 0.1);
          color: #2563eb;
        }

        .spinner-small {
          animation: spin 1s linear infinite;
        }

        .transcript-result {
          margin-top: 1.5rem;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          overflow: hidden;
        }

        .transcript-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          padding: 1rem;
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          justify-content: center;
        }

        .action-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.5rem 0.875rem;
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          font-size: 0.8125rem;
          font-weight: 500;
          color: #475569;
          cursor: pointer;
          transition: all 0.15s ease;
          font-family: inherit;
        }

        .action-btn:hover {
          background: #f1f5f9;
          border-color: #cbd5e1;
          color: #1e293b;
        }

        .action-btn-primary {
          background: #2563eb;
          border-color: #2563eb;
          color: white;
        }

        .action-btn-primary:hover {
          background: #1d4ed8;
          border-color: #1d4ed8;
          color: white;
        }

        .transcript-content {
          max-height: 400px;
          overflow-y: auto;
          padding: 1rem;
          background: white;
        }

        .transcript-segment {
          display: flex;
          gap: 0.75rem;
          padding: 0.5rem 0;
          border-bottom: 1px solid #f1f5f9;
        }

        .transcript-segment:last-child {
          border-bottom: none;
        }

        .segment-time {
          flex-shrink: 0;
          font-family: 'SF Mono', 'Fira Code', monospace;
          font-size: 0.75rem;
          color: #64748b;
          background: #f1f5f9;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          min-width: 48px;
          text-align: center;
          height: fit-content;
        }

        .segment-text {
          font-size: 0.9375rem;
          color: #1e293b;
          line-height: 1.5;
        }

        @media (max-width: 480px) {
          .input-group {
            flex-direction: column;
          }

          .download-btn {
            width: 100%;
            justify-content: center;
          }

          .transcript-actions {
            flex-direction: column;
          }

          .action-btn {
            width: 100%;
            justify-content: center;
          }
        }
      `}</style>
    </div>
  );
}
