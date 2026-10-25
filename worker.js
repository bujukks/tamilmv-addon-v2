// TamilMV catalog addon for Stremio - Cloudflare Workers version (single file, no dependencies).
//
// Settings (Worker -> Settings -> Variables and Secrets), all optional:
//   SOURCE_URL        Catalogs separated by ; (or new lines) as   Name|URL   or   Name|URL|CSS selector
//                     - Name|URL                 -> forum listing page (topic titles from the topic links)
//                     - Name|URL|.banger-row     -> text block on any page, one title per line
//                                                   (e.g. the "Top Releases This Week" widget)
//   FALLBACK_DOMAINS  Comma-separated front-door domains (default: https://1tamilmv.fi)

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const CINEMETA = "https://v3-cinemeta.strem.io";

const DEFAULT_SOURCES = [
  "TamilMV - Latest WebHD|https://1tamilmv.fi/index.php?/forums/forum/11-web-hd-itunes-hd-bluray/&sortby=start_date&sortdirection=desc",
  "TamilMV - Hollywood Multi Audio|https://1tamilmv.fi/index.php?/forums/forum/17-hollywood-movies-in-multi-audios/&sortby=start_date&sortdirection=desc",
  "TamilMV - Top Releases This Week|https://1tamilmv.fi/|.banger-row",
].join("\n");

const DEFAULT_FALLBACK = "https://1tamilmv.fi";

// Free plan allows 50 subrequests per request; 1-2 page fetches + up to 35 lookups stays safely under.
const MAX_TITLES = 35;
const TTL_MS = 15 * 60 * 1000;
const ORIGIN_TTL_MS = 60 * 60 * 1000;

// ---------- config parsing ----------

function parseSources(raw) {
  const used = new Set();
  return raw
    .split(/[\n;]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((entry, i) => {
      let name, rest;
      const bar = entry.indexOf("|");
      if (bar > 0 && !/^https?:/i.test(entry.slice(0, bar))) {
        name = entry.slice(0, bar).trim();
        rest = entry.slice(bar + 1).trim();
      } else {
        rest = entry;
        name = `TamilMV Catalog ${i + 1}`;
      }
      // Optional third field: CSS selector of a text block to read titles from.
      const bar2 = rest.indexOf("|");
      const url = (bar2 > 0 ? rest.slice(0, bar2) : rest).trim();
      const selector = bar2 > 0 ? rest.slice(bar2 + 1).trim() : "";

      let id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "catalog-" + (i + 1);
      if (used.has(id)) id += "-" + (i + 1);
      used.add(id);
      return { id, name, url, selector };
    })
    .filter((x) => /^https?:\/\//i.test(x.url));
}

function parseFallbacks(raw) {
  return (raw || DEFAULT_FALLBACK)
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => (/^https?:\/\//i.test(d) ? d : "https://" + d));
}

function buildManifest(sources) {
  return {
    id: "community.tamilmv.webhd",
    version: "1.1.0",
    name: "TamilMV WebHD",
    description: "Latest WebHD / HD releases from the TamilMV forum, matched to IMDb IDs.",
    resources: ["catalog"],
    types: ["movie"],
    idPrefixes: ["tt"],
    catalogs: sources.map((s) => ({ type: "movie", id: s.id, name: s.name })),
    behaviorHints: { configurable: false },
  };
}

// ---------- title parsing / IMDb matching ----------

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// Text after the year, e.g. " Tamil HQ PreDVD (HQ Clean) - [1080p ...]" -> "HQ PreDVD"
const LANG = /\b(?:tamil|telugu|hindi|malayalam|kannada|english|bengali|marathi|punjabi|urdu|sinhala|nepali)\b/gi;

function parseTag(rest) {
  let t = rest.split("[")[0];

  const open = t.indexOf("(");
  let core;
  if (open < 0) {
    core = t;
  } else {
    const before = t.slice(0, open).trim();
    const closed = t.slice(open).match(/^\s*\(([^)]*)\)/);
    core = before || (closed ? closed[1] : t.slice(open + 1));
  }

  core = core.split(/\s[-\u2013\u2014]\s/)[0]; // stop at " - "
  core = core.split(/\s\+\s/)[0];              // drop "+ ESub"
  core = core.replace(LANG, " ");              // <-- "Tamil HQ HDRip" -> " HQ HDRip"
  core = core.replace(/[()[\]]/g, "");
  core = core.replace(/\s+/g, " ").trim();
  core = core.replace(/^[-–—:·]+|[-–—:·]+$/g, "").trim();
  return core.length > 40 ? core.slice(0, 40).trim() : core;
}

/*function parseTag(rest) {
  let t = rest.split(/\s[-\u2013\u2014]\s|\[/)[0]; // stop at " - " or "["
  t = t.split(/\s\+\s/)[0]; // drop "+ ESub", "+ HC-ESub" ...
  t = t.replace(/\([^)]*\)/g, ""); // drop "(HQ Clean)" ...
  t = t.replace(/\s+/g, " ").trim();
  return t.length > 40 ? t.slice(0, 40).trim() : t;
}*/

// "Mandaadi (2026) Tamil HQ HDRip ..." -> { title: "Mandaadi", year: 2026, tag: "Tamil HQ HDRip" }
function parseTitle(raw) {
  const text = decodeEntities(raw).replace(/\s+/g, " ").trim();
  const m = text.match(/^(.*?)\s*[(\[]\s*((?:19|20)\d{2})\s*[)\]](.*)$/);
  if (!m) return null;
  const title = m[1].replace(/^(\s*[\[(][^\])]*[\])])+\s*/, "").trim();
  if (!title) return null;
  return { title, year: parseInt(m[2], 10), tag: parseTag(m[3]) };
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const yearOf = (m) => parseInt(m.year || m.releaseInfo, 10) || 0;

const resolved = new Map(); // title:year -> Cinemeta meta (per isolate)

async function resolveImdb({ title, year }) {
  const key = `${norm(title)}:${year}`;
  if (resolved.has(key)) return resolved.get(key);

  let meta = null;
  try {
    const url = `${CINEMETA}/catalog/movie/top/search=${encodeURIComponent(title)}.json`;
    const r = await fetch(url, {
      headers: { "User-Agent": UA },
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    if (r.ok) {
      const { metas = [] } = await r.json();
      const close = (m) => Math.abs(yearOf(m) - year) <= 1;
      meta =
        metas.find((m) => norm(m.name) === norm(title) && close(m)) ||
        metas.find(
          (m) =>
            yearOf(m) === year &&
            (norm(m.name).includes(norm(title)) || norm(title).includes(norm(m.name)))
        ) ||
        null;
    }
  } catch (e) {
    console.error(`Cinemeta lookup failed for "${title}": ${e.message}`);
  }
  if (meta) resolved.set(key, meta);
  return meta;
}

// ---------- scraping ----------

// Collect the text of every element matching `selector` (uses Cloudflare's built-in HTMLRewriter).
async function extractTexts(html, selector) {
  const items = [];
  const seen = new Set();
  let current = null;
  await new HTMLRewriter()
    .on(selector, {
      element(el) {
        const href = el.getAttribute("href");
        if (!href || seen.has(href)) {
          current = null;
          return;
        }
        seen.add(href);
        current = { text: "" };
        items.push(current);
      },
      text(chunk) {
        if (current) current.text += chunk.text;
      },
    })
    .transform(new Response(html))
    .arrayBuffer();
  return items.map((i) => i.text);
}

// Read a text block (e.g. ".banger-row") and return its lines, splitting at <br> tags.
async function extractLines(html, selector) {
  let buf = "";
  await new HTMLRewriter()
    .on(selector, {
      text(chunk) {
        buf += chunk.text;
      },
    })
    .on(`${selector} br`, {
      element() {
        buf += "\n";
      },
    })
    .transform(new Response(html))
    .arrayBuffer();
  return buf.split("\n");
}

const BROWSER_HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function fetchTopics(url, selector) {
  const want = new URL(url);
  let r = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow" });

  // Redirected to another domain (e.g. .fi -> current domain)? Redirects often drop the
  // forum path and sort options, so repeat them on the domain we landed on.
  const landed = new URL(r.url || url);
  if (landed.origin !== want.origin) {
    const retry = landed.origin + want.pathname + want.search;
    console.error(`${want.origin} redirected to ${landed.href}; retrying ${retry}`);
    r = await fetch(retry, { headers: BROWSER_HEADERS, redirect: "follow" });
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);

  const html = await r.text();
  let raw;
  if (selector) {
    raw = await extractLines(html, selector);
  } else {
    raw = await extractTexts(html, ".ipsDataItem_title a[href*='/topic/']");
    if (!raw.length) raw = await extractTexts(html, "a[href*='/topic/']");
  }

  const out = raw.map(parseTitle).filter(Boolean);
  if (!out.length) {
    const pageTitle = (html.match(/<title[^>]*>([^<]*)/i) || [])[1] || "";
    console.error(
      `0 titles parsed (${raw.length} ${selector ? `lines from "${selector}"` : "topic links"}). Page title: "${pageTitle.trim()}"`
    );
  }
  return out;
}

const originCache = new Map(); // front domain -> { origin, at }

async function discoverOrigin(front) {
  const hit = originCache.get(front);
  if (hit && Date.now() - hit.at < ORIGIN_TTL_MS) return hit.origin;
  try {
    const r = await fetch(front, { headers: BROWSER_HEADERS, redirect: "follow" });
    const origin = new URL(r.url).origin;
    originCache.set(front, { origin, at: Date.now() });
    return origin;
  } catch (e) {
    console.error(`Could not resolve ${front}: ${e.message}`);
    return null;
  }
}

async function scrapeTopics(url, fallbacks, selector) {
  const tried = new Set();
  const attempt = async (u) => {
    if (tried.has(u)) return null;
    tried.add(u);
    try {
      const topics = await fetchTopics(u, selector);
      if (topics.length) return topics;
    } catch (e) {
      console.error(`Fetch failed for ${u}: ${e.message}`);
    }
    return null;
  };

  let topics = await attempt(url);
  if (topics) return topics;

  const parsed = new URL(url);
  for (const front of fallbacks) {
    const origin = await discoverOrigin(front);
    if (!origin) continue;
    topics = await attempt(origin + parsed.pathname + parsed.search);
    if (topics) return topics;
  }
  throw new Error("All domains failed");
}

// ---------- catalog ----------

const catalogCache = new Map(); // source id -> { at, metas }

async function buildCatalog(source, fallbacks) {
  const cached = catalogCache.get(source.id);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.metas;

  try {
    const topics = (await scrapeTopics(source.url, fallbacks, source.selector)).slice(0, MAX_TITLES);
    const results = await Promise.all(topics.map(resolveImdb));

    const seen = new Set();
    const metas = [];
    results.forEach((m, i) => {
      if (!m || !m.id || seen.has(m.id)) return; // same movie, many uploads / languages
      seen.add(m.id);
      const year = m.releaseInfo || String(m.year || "");
      const tag = topics[i].tag;
      metas.push({
        id: m.id,
        type: "movie",
        name: m.name,
        poster: m.poster,
        background: m.background,
        releaseInfo: tag ? `${year} \u00b7 ${tag}` : year, // e.g. "2026 · Tamil UHD"
      });
    });
    if (metas.length) catalogCache.set(source.id, { at: Date.now(), metas });
    return metas;
  } catch (e) {
    console.error(`Catalog "${source.id}" failed: ${e.message}`);
    return cached ? cached.metas : []; // serve the last good list if we have one
  }
}

// ---------- worker entry ----------

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

function json(body, cacheControl) {
  return new Response(JSON.stringify(body), {
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": cacheControl },
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const sources = parseSources(env.SOURCE_URL || DEFAULT_SOURCES);
    const fallbacks = parseFallbacks(env.FALLBACK_DOMAINS);
    const { pathname } = new URL(request.url);

    if (pathname === "/" || pathname === "/manifest.json") {
      return json(buildManifest(sources), "public, max-age=3600");
    }

    const m = pathname.match(/^\/catalog\/([^/]+)\/([^/]+?)(?:\/[^/]+)?\.json$/);
    if (m) {
      const source = sources.find((s) => s.id === decodeURIComponent(m[2]));
      if (source) {
        const cache = caches.default;
        const hit = await cache.match(request);
        if (hit) return hit;

        const metas = await buildCatalog(source, fallbacks);
        // Only cache real results; never cache an empty/failed list.
        const res = json({ metas }, metas.length ? "public, max-age=900" : "no-store");
        if (metas.length) ctx.waitUntil(cache.put(request, res.clone()));
        return res;
      }
    }

    return json({ error: "Not found" }, "no-store");
  },
};
