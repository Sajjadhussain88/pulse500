# Pulse500 MVP

A responsive trend-discovery website prototype with a Node.js backend. It includes category filtering, search, sorting, saved trends, trend-detail modals, a demo newsletter form, and a backend endpoint that attempts to fetch Google Trends RSS data for several regions.

## Requirements
- Node.js 18 or later
- Internet access on the server for Google Trends RSS data

## Run locally

```bash
npm start
```

Then open http://localhost:3000.

No npm packages are required. The server uses built-in Node.js modules and `fetch`.

## API endpoints
- `GET /api/health` — server health
- `GET /api/trends` — trend data (cached)
- `GET /api/trends?refresh=1` — force a refresh
- `GET /api/config` — region and cache settings

## Configuration
Copy `.env.example` to `.env` for reference, but note that this minimal server does not automatically load `.env`. Set environment variables in your hosting dashboard or shell. Example:

```bash
PORT=3000 CACHE_MINUTES=15 TREND_REGIONS=US,GB,IN,CA,AU npm start
```

## Important limitations before public launch
1. The Pulse Score is a prototype heuristic, not a validated measure of trend importance. It currently estimates scores from source traffic metadata and cross-region recurrence where available.
2. Google Trends RSS availability, fields, and usage conditions may change. If the source fails, the API returns sample data so the demo remains viewable. Check the source's current terms and availability before commercial use.
3. The public homepage's newsletter form is a local-browser demo only. It does not send or store email addresses on a server. Connect a real email marketing provider and obtain appropriate consent before launch.
4. Saved trends are stored in the visitor's browser only. User accounts and cloud synchronization are not implemented.
5. This MVP has no authenticated admin dashboard, database, paid subscriptions, billing, or content moderation system yet. Do not present sample content as real-time data.
6. A production release should add persistent storage, authentication, rate limits, logging, monitoring, stronger source verification, privacy/terms pages, and tests.

## Deploying to pulse500.com
Deploy this Node app to a host that supports Node.js services (for example, Render, Railway, Fly.io, or a VPS). Connect your domain in that host's dashboard and configure DNS at your domain registrar. DNS values depend on the hosting provider, so do not change DNS until the host gives you the exact records. This project has not been deployed and is not yet connected to pulse500.com.
