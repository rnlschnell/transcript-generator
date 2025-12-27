// Transcript Generator - Cloudflare Worker
// Proxies requests to ScrapeCreators API to fetch video transcripts
// Includes user authentication and payment processing

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Free tier limit
const FREE_LIMIT = 10;

// Credit packages configuration
const CREDIT_PACKAGES = {
  '200': { credits: 200, name: '200 Credits' },
  '500': { credits: 500, name: '500 Credits' },
  '1000': { credits: 1000, name: '1000 Credits' },
};

// ScrapeCreators API endpoints
const SCRAPECREATORS_ENDPOINTS = {
  tiktok: 'https://api.scrapecreators.com/v1/tiktok/video/transcript',
  youtube: 'https://api.scrapecreators.com/v1/youtube/video/transcript',
  instagram: 'https://api.scrapecreators.com/v2/instagram/media/transcript',
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

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

// Validate UUID v4 device ID
function isValidDeviceId(deviceId) {
  if (!deviceId || typeof deviceId !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(deviceId);
}

// =============================================================================
// URL VALIDATORS
// =============================================================================

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
    return parsed.pathname.includes('/reel/') || parsed.pathname.includes('/p/');
  } catch {
    return false;
  }
}

// =============================================================================
// USAGE TRACKING (Anonymous Users)
// =============================================================================

// Check device usage and return remaining credits
async function checkUsage(env, deviceId) {
  if (!env.USAGE_STORE) {
    return { allowed: true, remaining: FREE_LIMIT, requiresSignup: false };
  }

  const deviceKey = `device:${deviceId}`;
  const deviceData = await env.USAGE_STORE.get(deviceKey, 'json');

  if (!deviceData) {
    return { allowed: true, remaining: FREE_LIMIT, requiresSignup: false };
  }

  const remaining = Math.max(0, FREE_LIMIT - deviceData.count);
  return {
    allowed: remaining > 0,
    remaining,
    requiresSignup: remaining <= 0
  };
}

// Increment usage count for a device
async function incrementUsage(env, deviceId, source = 'extension') {
  if (!env.USAGE_STORE) return FREE_LIMIT - 1;

  const deviceKey = `device:${deviceId}`;
  const now = new Date().toISOString();
  let deviceData = await env.USAGE_STORE.get(deviceKey, 'json');

  if (!deviceData) {
    deviceData = {
      count: 0,
      userId: null,
      source,
      createdAt: now,
      lastUsed: now,
    };
  }

  deviceData.count += 1;
  deviceData.lastUsed = now;
  if (!deviceData.source) deviceData.source = source;

  await env.USAGE_STORE.put(deviceKey, JSON.stringify(deviceData));
  return Math.max(0, FREE_LIMIT - deviceData.count);
}

// =============================================================================
// GOOGLE AUTHENTICATION
// =============================================================================

// Verify Google access token and get user info (used by Chrome extension)
async function verifyGoogleToken(token) {
  const tokenInfoRes = await fetch(
    `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${token}`
  );

  if (!tokenInfoRes.ok) {
    return null;
  }

  const tokenInfo = await tokenInfoRes.json();

  // Get full user profile from userinfo endpoint
  const userInfoRes = await fetch(
    'https://www.googleapis.com/oauth2/v2/userinfo',
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  );

  if (!userInfoRes.ok) {
    return {
      googleId: tokenInfo.sub,
      email: tokenInfo.email,
      name: tokenInfo.email?.split('@')[0] || 'User',
      picture: null
    };
  }

  const userInfo = await userInfoRes.json();

  return {
    googleId: userInfo.id || tokenInfo.sub,
    email: userInfo.email,
    name: userInfo.name || userInfo.email?.split('@')[0] || 'User',
    picture: userInfo.picture || null
  };
}

// Verify Google ID token/credential (used by web Google Sign-In)
async function verifyGoogleCredential(credential, env) {
  const tokenInfoRes = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`
  );

  if (!tokenInfoRes.ok) {
    return null;
  }

  const tokenInfo = await tokenInfoRes.json();

  // Verify the token is for our app (get valid client IDs from env)
  const validClientIds = [];
  if (env.GOOGLE_CLIENT_ID_EXTENSION) validClientIds.push(env.GOOGLE_CLIENT_ID_EXTENSION);
  if (env.GOOGLE_CLIENT_ID_WEB) validClientIds.push(env.GOOGLE_CLIENT_ID_WEB);

  // If no client IDs configured, skip validation (development mode)
  if (validClientIds.length > 0 && !validClientIds.includes(tokenInfo.aud)) {
    console.error('Invalid client ID in token:', tokenInfo.aud);
    return null;
  }

  return {
    googleId: tokenInfo.sub,
    email: tokenInfo.email,
    name: tokenInfo.name || tokenInfo.email?.split('@')[0] || 'User',
    picture: tokenInfo.picture || null
  };
}

// Verify either access token or credential
async function verifyGoogleAuth(token, credential, env) {
  if (credential) {
    return verifyGoogleCredential(credential, env);
  }
  if (token) {
    return verifyGoogleToken(token);
  }
  return null;
}

// =============================================================================
// USER MANAGEMENT
// =============================================================================

// Get user by Google ID
async function getUser(env, googleId) {
  if (!env.USAGE_STORE) return null;
  return env.USAGE_STORE.get(`user:${googleId}`, 'json');
}

// Save user
async function saveUser(env, user) {
  if (!env.USAGE_STORE) return;
  user.updatedAt = new Date().toISOString();
  await env.USAGE_STORE.put(`user:${user.googleId}`, JSON.stringify(user));
}

// Handle Google authentication endpoint
async function handleGoogleAuth(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { token, credential, deviceId } = body;

  if (!token && !credential) {
    return jsonResponse({ error: 'Missing token or credential' }, 400);
  }

  const googleUser = await verifyGoogleAuth(token, credential, env);

  if (!googleUser) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401);
  }

  const { googleId, email, name, picture } = googleUser;
  const now = new Date().toISOString();

  // Get or create user
  let user = await getUser(env, googleId);
  let isNewUser = false;

  if (!user) {
    isNewUser = true;
    user = {
      googleId,
      email,
      name,
      picture,
      credits: FREE_LIMIT,
      plan: 'free',
      lemonCustomerId: null,
      deviceIds: [],
      createdAt: now
    };
  } else {
    // Update profile info (may have changed)
    user.name = name;
    user.picture = picture;
    user.email = email;
  }

  // Link device if provided and not already linked
  if (deviceId && isValidDeviceId(deviceId) && !user.deviceIds.includes(deviceId)) {
    user.deviceIds.push(deviceId);

    // Check device usage
    const device = await env.USAGE_STORE.get(`device:${deviceId}`, 'json');
    if (device && !device.userId) {
      if (isNewUser) {
        // New user: subtract any downloads already used from their free credits
        user.credits = Math.max(0, FREE_LIMIT - device.count);
      } else {
        // Existing user linking new device: add remaining free credits
        const remainingFree = Math.max(0, FREE_LIMIT - device.count);
        user.credits += remainingFree;
      }

      // Mark device as linked
      device.userId = googleId;
      await env.USAGE_STORE.put(`device:${deviceId}`, JSON.stringify(device));
    }
  }

  user.lastLogin = now;
  await saveUser(env, user);

  // Save email->googleId mapping (for webhook lookups)
  await env.USAGE_STORE.put(`email:${email}`, googleId);

  return jsonResponse({
    googleId,
    email,
    name,
    picture,
    credits: user.credits,
    plan: user.plan
  });
}

// =============================================================================
// LEMON SQUEEZY INTEGRATION
// =============================================================================

// Verify Lemon Squeezy webhook signature
async function verifyLemonSignature(body, signature, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const expectedSig = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return signature === expectedSig;
}

// Handle Lemon Squeezy webhook events (order_created only for credit packages)
async function handleLemonWebhook(request, env) {
  const signature = request.headers.get('X-Signature');
  const body = await request.text();

  if (!signature || !env.LEMON_WEBHOOK_SECRET) {
    console.error('Missing signature or webhook secret');
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const isValid = await verifyLemonSignature(body, signature, env.LEMON_WEBHOOK_SECRET);
  if (!isValid) {
    console.error('Invalid webhook signature');
    return jsonResponse({ error: 'Invalid signature' }, 401);
  }

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { meta, data } = event;
  const eventName = meta?.event_name;

  console.log('Lemon Squeezy webhook:', eventName, data?.id);

  // Only handle order_created for credit purchases
  if (eventName !== 'order_created') {
    console.log('Ignoring event:', eventName);
    return jsonResponse({ received: true, ignored: true });
  }

  const status = data.attributes.status;
  if (status !== 'paid') {
    console.log('Order not paid, skipping. Status:', status);
    return jsonResponse({ received: true, skipped: 'not_paid' });
  }

  // Get user by email from webhook data
  const email = data?.attributes?.user_email;
  if (!email) {
    console.error('No email in webhook data');
    return jsonResponse({ error: 'No email in webhook' }, 400);
  }

  const googleId = await env.USAGE_STORE.get(`email:${email}`);
  if (!googleId) {
    console.error('No user found for email:', email);
    return jsonResponse({ received: true, warning: 'User not found' });
  }

  const user = await env.USAGE_STORE.get(`user:${googleId}`, 'json');
  if (!user) {
    console.error('User data not found for googleId:', googleId);
    return jsonResponse({ received: true, warning: 'User data not found' });
  }

  // Get credits from meta.custom_data (set during checkout)
  let creditsToAdd = meta?.custom_data?.credits ? parseInt(meta.custom_data.credits, 10) : null;

  // Fallback: try to determine credits from product_name or variant_name
  if (!creditsToAdd) {
    const productName = data.attributes.first_order_item?.product_name || '';
    const variantName = data.attributes.first_order_item?.variant_name || '';
    const match = (productName + ' ' + variantName).match(/(\d+)\s*credits?/i);
    if (match) {
      creditsToAdd = parseInt(match[1], 10);
    }
  }

  if (!creditsToAdd || isNaN(creditsToAdd)) {
    console.error('Could not determine credits to add from order:', data.id);
    return jsonResponse({ received: true, error: 'unknown_credits' });
  }

  const now = new Date().toISOString();
  user.lemonCustomerId = String(data.attributes.customer_id);
  user.credits += creditsToAdd;
  user.lastCreditPurchase = now;
  user.plan = 'credits';
  user.updatedAt = now;

  await env.USAGE_STORE.put(`user:${googleId}`, JSON.stringify(user));

  console.log('Added', creditsToAdd, 'credits for user:', googleId, 'order:', data.id);

  return jsonResponse({ success: true, creditsAdded: creditsToAdd });
}

// Handle checkout session creation for credit packages
async function handleCheckout(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { token, credential, credits } = body;

  if (!token && !credential) {
    return jsonResponse({ error: 'Missing token or credential' }, 400);
  }

  // Validate credits package
  const creditsStr = String(credits);
  if (!CREDIT_PACKAGES[creditsStr]) {
    return jsonResponse({
      error: 'Invalid credits package. Must be one of: 200, 500, 1000'
    }, 400);
  }

  const pkg = CREDIT_PACKAGES[creditsStr];

  // Verify user
  const googleUser = await verifyGoogleAuth(token, credential, env);
  if (!googleUser) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401);
  }

  const { googleId, email } = googleUser;

  if (!env.LEMON_API_KEY || !env.LEMON_STORE_ID) {
    console.error('Missing Lemon Squeezy configuration');
    return jsonResponse({ error: 'Payment configuration error' }, 500);
  }

  // Get variant ID for this credit package
  const variantIdKey = `LEMON_CREDITS_${creditsStr}_VARIANT_ID`;
  const variantId = env[variantIdKey];

  if (!variantId) {
    console.error('Missing variant ID for credits package:', creditsStr);
    return jsonResponse({ error: 'Payment configuration error' }, 500);
  }

  try {
    const storeId = String(env.LEMON_STORE_ID);
    const variantIdStr = String(variantId);

    const checkoutBody = {
      data: {
        type: 'checkouts',
        attributes: {
          checkout_data: {
            email: email,
            custom: {
              google_id: googleId,
              credits: String(pkg.credits)
            }
          }
        },
        relationships: {
          store: {
            data: { type: 'stores', id: storeId }
          },
          variant: {
            data: { type: 'variants', id: variantIdStr }
          }
        }
      }
    };

    const checkoutRes = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.LEMON_API_KEY}`,
        'Content-Type': 'application/vnd.api+json',
        'Accept': 'application/vnd.api+json'
      },
      body: JSON.stringify(checkoutBody)
    });

    if (!checkoutRes.ok) {
      const errorData = await checkoutRes.text();
      console.error('Lemon Squeezy checkout error:', checkoutRes.status, errorData);
      return jsonResponse({ error: 'Failed to create checkout session' }, 502);
    }

    const checkout = await checkoutRes.json();
    const checkoutUrl = checkout?.data?.attributes?.url;

    if (!checkoutUrl) {
      console.error('No checkout URL in response:', JSON.stringify(checkout));
      return jsonResponse({ error: 'Failed to get checkout URL' }, 502);
    }

    return jsonResponse({ url: checkoutUrl });

  } catch (err) {
    console.error('Checkout error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

// =============================================================================
// CREDITS CHECK
// =============================================================================

async function handleCreditsCheck(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { deviceId, token, credential } = body;

  // If authenticated, return user credits
  if (token || credential) {
    const googleUser = await verifyGoogleAuth(token, credential, env);
    if (googleUser) {
      const user = await getUser(env, googleUser.googleId);
      if (user) {
        return jsonResponse({
          credits: user.credits,
          plan: user.plan,
          authenticated: true
        });
      }
    }
  }

  // Anonymous user - check device usage
  if (!isValidDeviceId(deviceId)) {
    return jsonResponse({ error: 'Missing or invalid deviceId' }, 400);
  }

  const usage = await checkUsage(env, deviceId);

  return jsonResponse({
    credits: usage.remaining,
    requiresSignup: usage.requiresSignup,
    authenticated: false
  });
}

// =============================================================================
// TRANSCRIPT HANDLERS
// =============================================================================

// Generic transcript handler that supports both anonymous and authenticated users
async function handleTranscript(request, env, platform, urlValidator, apiEndpoint) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { url, deviceId, token, credential, source } = body;

  if (!url) {
    return jsonResponse({ error: 'Missing "url" in request body' }, 400);
  }

  if (!urlValidator(url)) {
    return jsonResponse({ error: `Invalid URL. Please provide a valid ${platform} video URL.` }, 400);
  }

  let user = null;
  let googleId = null;

  // Check if authenticated
  if (token || credential) {
    const googleUser = await verifyGoogleAuth(token, credential, env);

    if (!googleUser) {
      return jsonResponse({ error: 'Invalid or expired token' }, 401);
    }

    googleId = googleUser.googleId;
    user = await getUser(env, googleId);

    if (!user) {
      return jsonResponse({ error: 'User not found. Please sign in again.' }, 404);
    }

    if (user.credits <= 0) {
      return jsonResponse({
        error: 'no_credits',
        credits: 0,
        message: 'Out of credits. Please upgrade to continue.'
      }, 403);
    }
  } else {
    // Anonymous user - validate device ID
    if (!isValidDeviceId(deviceId)) {
      return jsonResponse({ error: 'Invalid or missing device ID' }, 400);
    }

    const usage = await checkUsage(env, deviceId);
    if (!usage.allowed) {
      return jsonResponse({
        error: 'limit_reached',
        remaining: 0,
        requiresSignup: true,
        message: 'No credits remaining. Sign up to continue.'
      }, 403);
    }
  }

  if (!env.SCRAPECREATORS_API_KEY) {
    return jsonResponse({ error: 'API key not configured' }, 500);
  }

  try {
    const apiUrl = `${apiEndpoint}?url=${encodeURIComponent(url)}`;
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

    // Decrement credits/usage after success
    if (user && googleId) {
      user.credits -= 1;
      user.lastTranscript = new Date().toISOString();
      await saveUser(env, user);

      return jsonResponse({
        ...data,
        credits: user.credits
      });
    } else {
      const remaining = await incrementUsage(env, deviceId, source || 'extension');

      return jsonResponse({
        ...data,
        remaining
      });
    }

  } catch (err) {
    console.error('Worker error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

// Platform-specific handlers
async function handleTikTokTranscript(request, env) {
  return handleTranscript(
    request,
    env,
    'TikTok',
    isValidTikTokUrl,
    SCRAPECREATORS_ENDPOINTS.tiktok
  );
}

async function handleYouTubeTranscript(request, env) {
  return handleTranscript(
    request,
    env,
    'YouTube',
    isValidYouTubeUrl,
    SCRAPECREATORS_ENDPOINTS.youtube
  );
}

async function handleInstagramTranscript(request, env) {
  return handleTranscript(
    request,
    env,
    'Instagram',
    isValidInstagramUrl,
    SCRAPECREATORS_ENDPOINTS.instagram
  );
}

// =============================================================================
// MAIN ROUTER
// =============================================================================

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
        // Authentication
        case '/auth/google':
          return handleGoogleAuth(request, env);

        // Transcript endpoints
        case '/api/tiktok/transcript':
          return handleTikTokTranscript(request, env);

        case '/api/youtube/transcript':
          return handleYouTubeTranscript(request, env);

        case '/api/instagram/transcript':
          return handleInstagramTranscript(request, env);

        // Credits and payments
        case '/credits':
          return handleCreditsCheck(request, env);

        case '/checkout':
          return handleCheckout(request, env);

        // Webhooks
        case '/webhook/lemonsqueezy':
          return handleLemonWebhook(request, env);

        default:
          return jsonResponse({ error: 'Not found' }, 404);
      }
    }

    return jsonResponse({ error: 'Method not allowed. Use POST.' }, 405);
  },
};
