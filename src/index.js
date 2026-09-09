const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=120"
};

const SOURCES = {
  mangadex: {
    id: "mangadex",
    name: "MangaDex",
    base: "https://api.mangadex.org"
  },
  comick: {
    id: "comick",
    name: "Comick",
    base: "https://api.comick.dev"
  }
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra }
  });
}

async function getJson(url) {
  const r = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "MangaMultiSourceWorker/1.0"
    },
    cf: { cacheTtl: 120, cacheEverything: true }
  });
  if (!r.ok) throw new Error(`Source returned ${r.status}`);
  return r.json();
}

function titleOf(m) {
  const t = m?.attributes?.title;
  if (t) return t.en || Object.values(t)[0] || "Unknown";
  return m?.title || "Unknown";
}

function coverOfMd(m) {
  const rel = (m.relationships || []).find(x => x.type === "cover_art");
  const file = rel?.attributes?.fileName;
  return file ? `https://uploads.mangadex.org/covers/${m.id}/${file}` : null;
}

async function searchMangaDex(q) {
  const p = new URLSearchParams({ title: q, limit: "12", "includes[]": "cover_art" });
  const data = await getJson(`https://api.mangadex.org/manga?${p}`);
  return (data.data || []).map(m => ({
    server: "mangadex",
    source: "MangaDex",
    id: m.id,
    title: titleOf(m),
    cover: coverOfMd(m),
    url: `https://mangadex.org/title/${m.id}`,
    access: `/source?server=mangadex&id=${m.id}`
  }));
}

async function searchComick(q) {
  const p = new URLSearchParams({ q, page: "1", limit: "12", t: "false", showall: "false" });
  const data = await getJson(`https://api.comick.dev/v1.0/search/?${p}`);
  const rows = Array.isArray(data) ? data : (data?.results || data?.data || []);
  return rows.map(m => ({
    server: "comick",
    source: "Comick",
    id: m.hid || m.id,
    slug: m.slug,
    title: m.title || m.name,
    cover: m.thumbnail || m.cover_url || null,
    url: m.slug ? `https://comick.dev/comic/${m.slug}` : null,
    access: `/source?server=comick&id=${encodeURIComponent(m.hid || m.id || m.slug)}`
  })).filter(x => x.id);
}

async function sourceMangaDex(id) {
  const [manga, feed] = await Promise.all([
    getJson(`${SOURCES.mangadex.base}/manga/${encodeURIComponent(id)}?includes[]=cover_art`),
    getJson(`${SOURCES.mangadex.base}/manga/${encodeURIComponent(id)}/feed?limit=100&translatedLanguage[]=en&order[chapter]=asc`)
  ]);
  const m = manga.data;
  return {
    server: "mangadex",
    source: "MangaDex",
    id: m.id,
    title: titleOf(m),
    description: m.attributes?.description?.en || Object.values(m.attributes?.description || {})[0] || "",
    status: m.attributes?.status || null,
    cover: coverOfMd(m),
    chapters: (feed.data || []).map(c => ({
      id: c.id,
      number: c.attributes?.chapter || null,
      title: c.attributes?.title || null,
      language: c.attributes?.translatedLanguage,
      pages: c.attributes?.pages || 0,
      access: `/chapter?server=mangadex&id=${c.id}`
    }))
  };
}

async function sourceComick(id) {
  const isSlug = String(id).includes("-");
  const endpoint = isSlug
    ? `${SOURCES.comick.base}/v1.0/comic/${encodeURIComponent(id)}`
    : `${SOURCES.comick.base}/comic/${encodeURIComponent(id)}`;
  const comic = await getJson(endpoint);
  const m = comic?.comic || comic?.data || comic;
  const hid = m?.hid || id;
  const slug = m?.slug || id;
  const chapters = await getJson(`${SOURCES.comick.base}/v1.0/comic/${encodeURIComponent(hid)}/chapters?limit=100&page=0`);
  const rows = Array.isArray(chapters) ? chapters : (chapters?.chapters || chapters?.data || []);
  return {
    server: "comick",
    source: "Comick",
    id: hid,
    slug,
    title: m?.title || m?.name || "Unknown",
    description: m?.desc || m?.description || "",
    cover: m?.thumbnail || m?.cover_url || null,
    chapters: rows.map(c => ({
      id: c.hid || c.id,
      number: c.chap || c.chapter || null,
      title: c.title || null,
      language: c.lang || c.language || null,
      access: `/chapter?server=comick&id=${encodeURIComponent(c.hid || c.id)}`
    })).filter(c => c.id)
  };
}

async function chapterMangaDex(id) {
  const data = await getJson(`${SOURCES.mangadex.base}/at-home/server/${encodeURIComponent(id)}`);
  const base = data.baseUrl;
  const h = data.chapter?.hash;
  const files = data.chapter?.data || [];
  return {
    server: "mangadex",
    source: "MangaDex",
    id,
    pages: files.map((file, i) => ({ number: i + 1, url: `${base}/data/${h}/${file}` }))
  };
}

async function chapterComick(id) {
  const data = await getJson(`${SOURCES.comick.base}/chapter/${encodeURIComponent(id)}`);
  const c = data?.chapter || data?.data || data;
  const images = c?.images || c?.md_images || c?.pages || [];
  return {
    server: "comick",
    source: "Comick",
    id,
    pages: images.map((img, i) => ({
      number: i + 1,
      url: typeof img === "string" ? img : (img.url || img.src || img.image_url)
    })).filter(x => x.url)
  };
}

async function handle(request) {
  const u = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (u.pathname === "/" || u.pathname === "/health") {
    return json({ ok: true, service: "manga-multi-source-worker", sources: Object.values(SOURCES).map(s => ({ id: s.id, name: s.name })) });
  }

  if (u.pathname === "/sources") {
    return json({ sources: Object.values(SOURCES).map(s => ({ id: s.id, name: s.name })) });
  }

  if (u.pathname === "/search") {
    const q = (u.searchParams.get("q") || "").trim();
    if (!q) return json({ error: "Missing q" }, 400);

    const settled = await Promise.allSettled([searchMangaDex(q), searchComick(q)]);
    const results = [];
    const errors = [];
    for (const r of settled) {
      if (r.status === "fulfilled") results.push(...r.value);
      else errors.push(r.reason?.message || "source failed");
    }

    return json({ query: q, results, sourceCount: new Set(results.map(x => x.server)).size, errors });
  }

  // Click/access one specific server result returned by /search.
  if (u.pathname === "/source") {
    const server = (u.searchParams.get("server") || "").toLowerCase();
    const id = u.searchParams.get("id");
    if (!SOURCES[server]) return json({ error: "Unknown server" }, 400);
    if (!id) return json({ error: "Missing id" }, 400);
    return json(server === "mangadex" ? await sourceMangaDex(id) : await sourceComick(id));
  }

  // Get actual page/image URLs for a chapter from the selected server.
  if (u.pathname === "/chapter") {
    const server = (u.searchParams.get("server") || "").toLowerCase();
    const id = u.searchParams.get("id");
    if (!SOURCES[server]) return json({ error: "Unknown server" }, 400);
    if (!id) return json({ error: "Missing id" }, 400);
    return json(server === "mangadex" ? await chapterMangaDex(id) : await chapterComick(id));
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request) {
    try {
      return await handle(request);
    } catch (error) {
      return json({ error: error?.message || "Internal error" }, 502);
    }
  }
};
