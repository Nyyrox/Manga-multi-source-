# Manga Multi Source Worker

Cloudflare Worker API for reading public novel metadata and chapter text from supported sources.

## Current source

- NovelFull

## Endpoints

- `GET /` — health
- `GET /sources` — enabled sources
- `GET /search?q=...` — search
- `GET /novel?url=...` — novel metadata + chapters
- `GET /chapter?url=...` — chapter text

Example:

```text
GET /search?q=I%20Shall%20Seal%20the%20Heavens
GET /novel?url=https://novelfull.net/i-shall-seal-the-heavens.html
GET /chapter?url=https://novelfull.net/i-shall-seal-the-heavens/chapter-1.html
```

The worker intentionally only accepts URLs from supported source domains; it is not an open proxy. Add new providers as source adapters rather than forwarding arbitrary URLs.

## Deploy

```bash
npm install -g wrangler
wrangler login
wrangler deploy
```

Or connect this repository to Cloudflare Workers Builds and deploy from the `main` branch.

Use public source pages responsibly, respect applicable terms and copyright, and do not bypass authentication, paywalls, CAPTCHAs, or other access controls.
