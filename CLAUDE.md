# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Transcript generator for social media videos, consisting of:
1. **Web App** (`web/`) - Main website for generating transcripts from video URLs
2. **YouTube Extension** (`extensions/youtube/`) - Chrome extension for grabbing YouTube video transcripts
3. **Instagram Extension** (`extensions/instagram/`) - Chrome extension for grabbing Instagram video transcripts
4. **TikTok Extension** (`extensions/tiktok/`) - Chrome extension for grabbing TikTok video transcripts
5. **Cloudflare Worker** (`worker/`) - Backend proxy that calls ScrapeCreators API to fetch video transcripts

## Architecture

```
User → Web App / Chrome Extension → Cloudflare Worker → ScrapeCreators API
                                            ↓
                                   Returns transcript data
                                            ↓
                            Displayed in UI / copied to clipboard
```

The worker acts as a proxy to hide the API key from the client. It validates video URLs, calls the ScrapeCreators API, and extracts the transcript from the response.

## Development Commands

### Cloudflare Worker

```bash
# Navigate to worker directory
cd worker

# Install wrangler CLI (if not installed)
npm install -g wrangler

# Set the API key secret (one-time setup)
npx wrangler secret put SCRAPECREATORS_API_KEY

# Run locally
npx wrangler dev

# Deploy to production
npx wrangler deploy
```

### Chrome Extensions

Load an extension manually in Chrome:
1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the appropriate extension folder (e.g., `extensions/youtube/`)

### Web App

```bash
cd web
npm install
npm run dev

# Build and deploy to production (Cloudflare Pages)
npm run build
npx wrangler pages deploy dist --project-name=transcriptmagic-web --branch=main --commit-dirty=true
```

## Key Files

- `worker/src/index.js` - Cloudflare Worker entry point; handles POST requests with video URLs
- `extensions/youtube/` - YouTube transcript extension
- `extensions/instagram/` - Instagram transcript extension
- `extensions/tiktok/` - TikTok transcript extension
- `web/` - Main web application
- `worker/wrangler.toml` - Cloudflare Worker configuration

## Configuration

- Worker API URL: `https://api.klipgrab.com` (custom domain on Cloudflare Worker) - will be renamed
- API key is stored as a Cloudflare secret (`SCRAPECREATORS_API_KEY`), not in code

## Design Notes

- Keep consistent color scheme and layout across web app and all extensions
- Project name will be changed from "klipgrab" to a new name (TBD)

## Upgrade/Purchase Flow

When a user clicks "Upgrade" in the extension:
1. **Sign in first** (Google OAuth)
2. **Choose credits** - show pricing options with their current balance
3. **Purchase**

This flow was chosen because:
- Simpler implementation (no state to preserve through OAuth redirect)
- Can display existing credit balance on the pricing page
- User clicking "Upgrade" has already signaled purchase intent
