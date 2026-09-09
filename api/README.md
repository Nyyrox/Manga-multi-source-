# Manga Multi-Source API

This API wraps `github.com/elboletaire/manga-downloader` v1.7.0 instead of reimplementing its site grabbers. The upstream project currently supports 84 sites and uses dedicated grabbers plus a browser/Chromium path for JavaScript and Cloudflare-protected readers. urlUpstream projecthttps://github.com/elboletaire/manga-downloader

## Endpoints

### Search

```text
GET /search?q=One%20Piece
```

Search fan-outs to MangaDex and Comick. Each result includes the original source URL and a `/source?...` access URL.

### Open a source

```text
GET /source?url=https%3A%2F%2Fmangadex.org%2Ftitle%2F...
```

The engine identifies the source using the upstream grabber registry, fetches the title and chapter list, and returns a stable chapter `index` for the app.

### Open a chapter

```text
GET /chapter?url=<encoded-series-url>&index=0
```

The selected upstream grabber resolves that chapter and returns its page/image URLs.

## Important deployment detail

This part is **not a Cloudflare Worker**. The upstream engine can launch Chromium for sites that need JavaScript/Cloudflare handling, so it needs a normal container/VM with Chromium. The included Dockerfile installs Chromium.

The Cloudflare Worker can remain as a lightweight gateway in front of this API, but it cannot replace the browser-enabled backend.

## License

The upstream `manga-downloader` project is AGPL-3.0. This API uses it as a Go dependency; review and comply with the upstream license when deploying or distributing this service.
