const SOURCE = "https://novelfull.net";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=120"
};

function response(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...headers }
  });
}

function clean(value = "") {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(url) {
  return new URL(url, SOURCE).href;
}

function safeNovelUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === "novelfull.net" || u.hostname.endsWith(".novelfull.net");
  } catch {
    return false;
  }
}

function slugFromUrl(url) {
  const u = new URL(url);
  return u.pathname.split("/").filter(Boolean)[0] || null;
}

function extractMeta(html, property) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i");
  return html.match(re)?.[1] || "";
}

function extractLinks(html) {
  const links = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    links.push({ url: absoluteUrl(m[1]), title: clean(m[2]) });
  }
  return links;
}

function parseNovelPage(html, url) {
  const title = clean(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || extractMeta(html, "og:title"));
  const description = clean(
    html.match(/<div[^>]+class=["'][^"']*(?:desc-text|summary|description)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
    extractMeta(html, "og:description")
  );
  const cover = extractMeta(html, "og:image");

  const chapterLinks = extractLinks(html)
    .filter(x => x.url.includes("novelfull.net/") && /chapter|\.html$/i.test(x.url))
    .filter(x => x.title && !/previous|next|first|last/i.test(x.title));

  const seen = new Set();
  const chapters = chapterLinks.filter(x => {
    if (seen.has(x.url)) return false;
    seen.add(x.url);
    return true;
  }).map((x, i) => ({
    number: i + 1,
    title: x.title,
    url: x.url
  }));

  return {
    source: "novelfull",
    title,
    slug: slugFromUrl(url),
    url,
    cover: cover ? absoluteUrl(cover) : null,
    description,
    chapters
  };
}

function parseChapter(html, url) {
  const title = clean(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");

  let content = html.match(/<div[^>]+class=["'][^"']*chapter-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  if (!content) content = html.match(/<div[^>]+class=["'][^"']*(?:chapter|reading-content|content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];

  const text = clean(content || "");
  return {
    source: "novelfull",
    title,
    url,
    content: text
  };
}

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ZenkaiNovelWorker/1.0; +https://github.com/Nyyrox/Manga-multi-source-)"
    },
    cf: { cacheTtl: 120, cacheEverything: true }
  });
  if (!r.ok) throw new Error(`Source returned ${r.status}`);
  return r.text();
}

async function handle(request) {
  const u = new URL(request.url);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (u.pathname === "/" || u.pathname === "/health") {
    return response({ ok: true, service: "multi-source-novel-worker", sources: ["novelfull"], version: "1.0.0" });
  }

  if (u.pathname === "/sources") {
    return response({ sources: [{ id: "novelfull", name: "NovelFull", baseUrl: SOURCE }] });
  }

  if (u.pathname === "/search") {
    const q = (u.searchParams.get("q") || "").trim();
    if (!q) return response({ error: "Missing q" }, 400);

    // NovelFull exposes search through its normal site search UI. Keep the worker
    // restricted to the source domain instead of becoming an arbitrary proxy.
    const searchUrl = `${SOURCE}/search.html?keyword=${encodeURIComponent(q)}`;
    const html = await fetchHtml(searchUrl);
    const results = extractLinks(html)
      .filter(x => x.url.startsWith(`${SOURCE}/`))
      .filter(x => x.title && !/chapter|login|register|home|contact|privacy|terms/i.test(x.title))
      .filter(x => !x.url.includes("/search") && !x.url.includes("/genre/"))
      .slice(0, 30);

    const unique = [];
    const seen = new Set();
    for (const item of results) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      unique.push({ source: "novelfull", title: item.title, url: item.url });
    }
    return response({ query: q, results: unique });
  }

  if (u.pathname === "/novel") {
    const url = u.searchParams.get("url");
    if (!url || !safeNovelUrl(url)) return response({ error: "A valid NovelFull URL is required" }, 400);
    const html = await fetchHtml(url);
    return response(parseNovelPage(html, url));
  }

  if (u.pathname === "/chapter") {
    const url = u.searchParams.get("url");
    if (!url || !safeNovelUrl(url)) return response({ error: "A valid NovelFull chapter URL is required" }, 400);
    const html = await fetchHtml(url);
    return response(parseChapter(html, url));
  }

  return response({ error: "Not found" }, 404);
}

export default {
  async fetch(request) {
    try {
      return await handle(request);
    } catch (error) {
      return response({ error: error?.message || "Internal error" }, 502);
    }
  }
};
