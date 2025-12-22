// Configuration
const WORKER_URL = 'https://transcript-worker.nlschnell0413.workers.dev';

// State
let currentTranscript = null;
let currentVideoId = null;

// DOM elements
const form = document.getElementById('transcriptForm');
const urlInput = document.getElementById('urlInput');
const getTranscriptBtn = document.getElementById('getTranscriptBtn');
const status = document.getElementById('status');
const currentVideoSection = document.getElementById('currentVideo');
const getTranscriptCurrentBtn = document.getElementById('getTranscriptCurrentBtn');
const transcriptResult = document.getElementById('transcriptResult');
const transcriptText = document.getElementById('transcriptText');
const copyBtn = document.getElementById('copyBtn');
const copyPlainBtn = document.getElementById('copyPlainBtn');
const downloadSrtBtn = document.getElementById('downloadSrtBtn');

let currentTabUrl = null;

// Check if URL is a YouTube video page
function isYouTubeVideoPage(url) {
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
}

// Validate YouTube video URL
function isValidYouTubeUrl(url) {
  return isYouTubeVideoPage(url);
}

// Extract video ID from YouTube URL
function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.slice(1);
    }
    if (parsed.pathname.includes('/shorts/')) {
      return parsed.pathname.split('/shorts/')[1]?.split('/')[0];
    }
    return parsed.searchParams.get('v');
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

// Convert milliseconds to SRT timestamp format (HH:MM:SS,mmm)
function msToSrtTimestamp(ms) {
  const totalMs = parseInt(ms, 10);
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const milliseconds = totalMs % 1000;

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`;
}

// Convert transcript array to SRT format
function convertToSrt(transcript) {
  let srt = '';

  transcript.forEach((cue, index) => {
    srt += `${index + 1}\n`;
    srt += `${msToSrtTimestamp(cue.startMs)} --> ${msToSrtTimestamp(cue.endMs)}\n`;
    srt += `${cue.text}\n\n`;
  });

  return srt.trim();
}

// Get plain text from transcript (no timestamps)
function getPlainText(transcript) {
  return transcript.map(cue => cue.text).join('\n');
}

// Convert transcript to VTT format
function convertToVtt(transcript) {
  let vtt = 'WEBVTT\n\n';

  transcript.forEach((cue) => {
    const startTime = msToSrtTimestamp(cue.startMs).replace(',', '.');
    const endTime = msToSrtTimestamp(cue.endMs).replace(',', '.');
    vtt += `${startTime} --> ${endTime}\n`;
    vtt += `${cue.text}\n\n`;
  });

  return vtt.trim();
}

// Format transcript for display
function formatTranscriptDisplay(transcript) {
  return transcript.map(cue => {
    return `<div class="cue"><span class="timestamp">${cue.startTimeText || '0:00'}</span><span class="text">${cue.text}</span></div>`;
  }).join('');
}

// Show transcript result
function showTranscriptResult(transcript, videoId) {
  currentTranscript = transcript;
  currentVideoId = videoId;

  transcriptText.innerHTML = formatTranscriptDisplay(transcript);
  transcriptResult.classList.add('visible');
}

// Hide transcript result
function hideTranscriptResult() {
  currentTranscript = null;
  currentVideoId = null;
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
      showStatus('SRT file downloaded!', 'success');
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
    const response = await fetch(`${WORKER_URL}/api/youtube/transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch transcript');
    }

    if (!data.transcript || data.transcript.length === 0) {
      throw new Error('No transcript available for this video');
    }

    const videoId = extractVideoId(url) || data.id;
    showTranscriptResult(data.transcript, videoId);
    showStatus('Transcript loaded!', 'success');
    urlInput.value = '';

  } catch (err) {
    console.error('Error:', err);
    showStatus(err.message || 'Something went wrong', 'error');
  } finally {
    setLoading(button, false);
  }
}

// Initialize on popup open
document.addEventListener('DOMContentLoaded', async () => {
  // Check current tab for YouTube video
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.url && isYouTubeVideoPage(tabs[0].url)) {
      currentTabUrl = tabs[0].url;
      currentVideoSection.classList.add('visible');
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

  if (!isValidYouTubeUrl(url)) {
    showStatus('Please enter a valid YouTube video URL', 'error');
    return;
  }

  getTranscript(url, getTranscriptBtn);
});

// Copy with timestamps (VTT format)
copyBtn.addEventListener('click', () => {
  if (currentTranscript) {
    const vtt = convertToVtt(currentTranscript);
    copyToClipboard(vtt, 'Copied with timestamps!');
  }
});

// Copy plain text (no timestamps)
copyPlainBtn.addEventListener('click', () => {
  if (currentTranscript) {
    const plainText = getPlainText(currentTranscript);
    copyToClipboard(plainText, 'Copied plain text!');
  }
});

// Download SRT
downloadSrtBtn.addEventListener('click', () => {
  if (currentTranscript) {
    const srt = convertToSrt(currentTranscript);
    const filename = `youtube_${currentVideoId || Date.now()}.srt`;
    downloadFile(srt, filename, 'text/srt');
  }
});
