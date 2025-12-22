// Transcript Generator - Cloudflare Worker
// Proxies requests to ScrapeCreators API to fetch video transcripts

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Create JSON response with CORS headers
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

// URL validators for each platform
function isValidTikTokUrl(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('tiktok.com')) {
      return false;
    }
    if (parsed.hostname === 'vm.tiktok.com') {
      return true;
    }
    return parsed.pathname.includes('/video/');
  } catch {
    return false;
  }
}

function isValidYouTubeUrl(url) {
  try {
    const parsed = new URL(url);
    const validHosts = ['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com'];
    if (!validHosts.some(host => parsed.hostname === host || parsed.hostname.endsWith('.' + host))) {
      return false;
    }
    // youtube.com/watch?v=ID or youtu.be/ID or youtube.com/shorts/ID
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

function isValidInstagramUrl(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('instagram.com')) {
      return false;
    }
    // instagram.com/reel/ID or instagram.com/p/ID
    return parsed.pathname.includes('/reel/') || parsed.pathname.includes('/p/');
  } catch {
    return false;
  }
}

// ScrapeCreators API endpoints
const SCRAPECREATORS_ENDPOINTS = {
  tiktok: 'https://api.scrapecreators.com/v1/tiktok/video/transcript',
  youtube: 'https://api.scrapecreators.com/v1/youtube/video/transcript',
  instagram: 'https://api.scrapecreators.com/v1/instagram/post/transcript',
};

// Handle TikTok transcript request
async function handleTikTokTranscript(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { url } = body;

  if (!url) {
    return jsonResponse({ error: 'Missing "url" in request body' }, 400);
  }

  if (!isValidTikTokUrl(url)) {
    return jsonResponse({ error: 'Invalid URL. Please provide a TikTok video URL.' }, 400);
  }

  if (!env.SCRAPECREATORS_API_KEY) {
    return jsonResponse({ error: 'API key not configured' }, 500);
  }

  try {
    const apiUrl = `${SCRAPECREATORS_ENDPOINTS.tiktok}?url=${encodeURIComponent(url)}`;
    const apiResponse = await fetch(apiUrl, {
      headers: {
        'x-api-key': env.SCRAPECREATORS_API_KEY,
      },
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error('ScrapeCreators API error:', apiResponse.status, errorText);
      return jsonResponse({ error: 'Failed to fetch transcript', details: errorText }, 502);
    }

    const data = await apiResponse.json();
    return jsonResponse(data);

  } catch (err) {
    console.error('Worker error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

// Handle YouTube transcript request
async function handleYouTubeTranscript(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { url } = body;

  if (!url) {
    return jsonResponse({ error: 'Missing "url" in request body' }, 400);
  }

  if (!isValidYouTubeUrl(url)) {
    return jsonResponse({ error: 'Invalid URL. Please provide a YouTube video URL.' }, 400);
  }

  if (!env.SCRAPECREATORS_API_KEY) {
    return jsonResponse({ error: 'API key not configured' }, 500);
  }

  try {
    const apiUrl = `${SCRAPECREATORS_ENDPOINTS.youtube}?url=${encodeURIComponent(url)}`;
    const apiResponse = await fetch(apiUrl, {
      headers: {
        'x-api-key': env.SCRAPECREATORS_API_KEY,
      },
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error('ScrapeCreators API error:', apiResponse.status, errorText);
      return jsonResponse({ error: 'Failed to fetch transcript', details: errorText }, 502);
    }

    const data = await apiResponse.json();
    return jsonResponse(data);

  } catch (err) {
    console.error('Worker error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

// Handle Instagram transcript request
async function handleInstagramTranscript(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { url } = body;

  if (!url) {
    return jsonResponse({ error: 'Missing "url" in request body' }, 400);
  }

  if (!isValidInstagramUrl(url)) {
    return jsonResponse({ error: 'Invalid URL. Please provide an Instagram reel or post URL.' }, 400);
  }

  if (!env.SCRAPECREATORS_API_KEY) {
    return jsonResponse({ error: 'API key not configured' }, 500);
  }

  try {
    const apiUrl = `${SCRAPECREATORS_ENDPOINTS.instagram}?url=${encodeURIComponent(url)}`;
    const apiResponse = await fetch(apiUrl, {
      headers: {
        'x-api-key': env.SCRAPECREATORS_API_KEY,
      },
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error('ScrapeCreators API error:', apiResponse.status, errorText);
      return jsonResponse({ error: 'Failed to fetch transcript', details: errorText }, 502);
    }

    const data = await apiResponse.json();
    return jsonResponse(data);

  } catch (err) {
    console.error('Worker error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Health check
    if (request.method === 'GET' && url.pathname === '/') {
      return jsonResponse({ status: 'ok', service: 'transcript-worker' });
    }

    // Route POST requests
    if (request.method === 'POST') {
      switch (url.pathname) {
        case '/api/tiktok/transcript':
          return handleTikTokTranscript(request, env);

        case '/api/youtube/transcript':
          return handleYouTubeTranscript(request, env);

        case '/api/instagram/transcript':
          return handleInstagramTranscript(request, env);

        default:
          return jsonResponse({ error: 'Not found' }, 404);
      }
    }

    return jsonResponse({ error: 'Method not allowed. Use POST.' }, 405);
  },
};
