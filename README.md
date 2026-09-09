# Manga Multi Source Worker

Cloudflare Worker API for multi-source manga search and reading.

## Sources

- MangaDex
- Comick

## Flow

1. Search every source:

```text
GET /search?q=One%20Piece
```

Each result includes `server`, `id` and an `access` endpoint. Your app can display the source/server as a selectable button.

2. Click a specific source/server:

```text
GET /source?server=mangadex&id=MANGA_ID
GET /source?server=comick&id=COMICK_HID
```

This returns metadata and that server's chapter list. Every chapter also contains its own `/chapter?...` endpoint.

3. Get chapter page/image URLs:

```text
GET /chapter?server=mangadex&id=CHAPTER_ID
GET /chapter?server=comick&id=CHAPTER_ID
```

For MangaDex, the chapter endpoint resolves the MangaDex@Home server and returns the page image URLs. MangaDex documents `/manga`, `/manga/{id}/feed` and `/at-home/server/{chapterId}` for these operations. citeturn1search2

Comick exposes search, comic details, chapter lists and chapter information through its API. citeturn3search0

## Example app flow

```text
/search?q=Solo Leveling
        ↓
┌───────────────────────────────┐
│ MangaDex   → /source?...      │
│ Comick     → /source?...      │
└───────────────────────────────┘
        ↓ user clicks a server
/source?server=comick&id=...
        ↓
chapter list
        ↓ user clicks chapter
/chapter?server=comick&id=...
        ↓
page/image URLs
```

The worker does not act as an arbitrary URL proxy; requests are routed through explicit source adapters.

## Deploy

```bash
npm install -g wrangler
wrangler login
wrangler deploy
```
