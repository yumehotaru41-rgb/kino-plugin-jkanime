/// <reference path="./kino.d.ts" />
/**
 * Kino plugin for jkanime.net
 * - Precise search (exact + partial match ranking)
 * - Manual server/quality selection via alternatives + settings
 * - Home rows: en emisión, recientes, películas, OVAs
 */

const BASE = "https://jkanime.net";
const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

function headers() {
  return {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    Referer: BASE + "/",
  };
}

async function fetchHtml(pathOrUrl) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : BASE + pathOrUrl;
  const r = await kino.fetch(url, { headers: headers(), timeoutMs: 20000 });
  if (!r.ok) throw kino.error("unavailable", "jkanime " + r.status);
  return await r.text();
}

/** Simple HTML helpers (no DOM in QuickJS) */
function attr(tag, name) {
  const m = tag.match(new RegExp(name + '=["\']([^"\']+)["\']', "i"));
  return m ? m[1] : "";
}

function stripTags(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function slugFromHref(href) {
  if (!href) return "";
  try {
    const u = new URL(href, BASE);
    const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    return parts[0] || "";
  } catch (_) {
    return "";
  }
}

function absoluteUrl(href) {
  if (!href) return "";
  if (href.startsWith("//")) return "https:" + href;
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return BASE + href;
  return BASE + "/" + href;
}

/** Rank search results so exact / prefix matches come first */
function rankItems(items, q) {
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const nq = norm(q);
  if (!nq) return items;
  return items
    .map((it) => {
      const nt = norm(it.title);
      let score = 0;
      if (nt === nq) score = 1000;
      else if (nt.startsWith(nq)) score = 800;
      else if (nt.includes(nq)) score = 500;
      else {
        const words = nq.split(" ");
        let hit = 0;
        for (const w of words) if (w.length > 1 && nt.includes(w)) hit++;
        score = hit * 100;
      }
      return { it, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.it);
}

/** Parse search / directory cards */
function parseCards(html) {
  const items = [];
  // Common patterns on jkanime: anime__item, let-post, page_directorio
  const blocks =
    html.match(
      /<div[^>]*class=["'][^"']*(?:anime__item|let-post|anime-card)[^"']*["'][^>]*>[\s\S]*?(?=<div[^>]*class=["'][^"']*(?:anime__item|let-post|anime-card)|<\/main>|<\/section>|$)/gi
    ) || [];
  for (const block of blocks) {
    const a = block.match(/<a[^>]+href=["']([^"']+)["'][^>]*>/i);
    if (!a) continue;
    const href = a[1];
    if (!href.includes("jkanime") && !href.startsWith("/")) continue;
    if (href.includes("/buscar/") || href.includes("/directorio/")) continue;
    const slug = slugFromHref(href);
    if (!slug || slug.length < 2) continue;

    let title =
      attr(block.match(/<h[12][^>]*>[\s\S]*?<\/h[12]>/i)?.[0] || "", "") ||
      stripTags((block.match(/class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\//i) || [])[1] || "");
    if (!title) {
      const t = block.match(/title=["']([^"']+)["']/i);
      title = t ? t[1] : slug.replace(/-/g, " ");
    }
    title = stripTags(title);
    if (!title || title.length < 2) continue;

    let poster = "";
    const bg = block.match(/data-setbg=["']([^"']+)["']/i);
    if (bg) poster = absoluteUrl(bg[1]);
    else {
      const img = block.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (img) poster = absoluteUrl(img[1]);
    }

    const typeText = (block.match(/(Serie|Pelicula|OVA|Especial|ONA|Movie)/i) || [])[1] || "Serie";
    const kind =
      /pelicula|movie/i.test(typeText) ? "movie" : "series";

    items.push({
      id: "jk:" + slug,
      ref: slug,
      title,
      kind,
      poster: poster || undefined,
      genres: ["anime"],
    });
  }

  // Fallback: any /slug/ links with title nearby
  if (items.length === 0) {
    const re = /href=["'](https?:\/\/jkanime\.net\/([a-z0-9-]+)\/)["'][^>]*>[\s\S]{0,200}?<(?:h[12]|div|span)[^>]*>([^<]{3,80})</gi;
    let m;
    const seen = new Set();
    while ((m = re.exec(html)) !== null) {
      const slug = m[2];
      if (seen.has(slug) || ["buscar", "directorio", "genero", "letra"].includes(slug)) continue;
      seen.add(slug);
      items.push({
        id: "jk:" + slug,
        ref: slug,
        title: stripTags(m[3]),
        kind: "series",
        genres: ["anime"],
      });
    }
  }

  // Dedupe by ref
  const map = new Map();
  for (const it of items) if (!map.has(it.ref)) map.set(it.ref, it);
  return Array.from(map.values());
}

/** Parse episode list from anime page */
function parseEpisodes(html, slug) {
  const episodes = [];
  // Numbers from data-number, links /slug/N/, or episode buttons
  const numLinks = html.matchAll(
    new RegExp(`href=["'](?:https?:\\/\\/jkanime\\.net)?\\/${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/(\\d+)\\/?["']`, "gi")
  );
  const nums = new Set();
  for (const m of numLinks) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n < 5000) nums.add(n);
  }
  // data-number attributes
  for (const m of html.matchAll(/data-number=["'](\d+)["']/gi)) {
    const n = parseInt(m[1], 10);
    if (n > 0) nums.add(n);
  }
  // JSON-like episode lists
  for (const m of html.matchAll(/"number"\s*:\s*"?(\d+)"?/gi)) {
    const n = parseInt(m[1], 10);
    if (n > 0) nums.add(n);
  }

  const sorted = Array.from(nums).sort((a, b) => a - b);
  for (const n of sorted) {
    episodes.push({
      season: 1,
      number: n,
      ref: slug + "/" + n,
      title: "Episodio " + n,
    });
  }
  return episodes;
}

/** Extract server embeds from episode page */
function parseServers(html) {
  const servers = [];
  // c4.php?u=BASE64&s=name
  for (const m of html.matchAll(
    /(?:href|src|data-url|data-src)=["']([^"']*c4\.php\?u=([^&"']+)&s=([^&"']+)[^"']*)["']/gi
  )) {
    const b64 = m[2];
    const name = decodeURIComponent(m[3] || "").toLowerCase();
    let target = "";
    try {
      target = atob(b64);
    } catch (_) {
      try {
        target = decodeURIComponent(escape(atob(b64)));
      } catch (__) {}
    }
    if (target && target.startsWith("http")) {
      servers.push({ name: name || "server", url: target, label: prettyServer(name) });
    }
  }
  // Direct embed iframes
  for (const m of html.matchAll(/<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/gi)) {
    const url = m[1];
    if (/ads|google|facebook|twitter/i.test(url)) continue;
    const host = (() => {
      try {
        return new URL(url).hostname.replace(/^www\./, "");
      } catch (_) {
        return "embed";
      }
    })();
    if (!servers.some((s) => s.url === url)) {
      servers.push({ name: host, url, label: prettyServer(host) });
    }
  }
  // video[src]
  for (const m of html.matchAll(/<video[^>]+src=["'](https?:\/\/[^"']+)["']/gi)) {
    servers.push({ name: "direct", url: m[1], label: "Directo" });
  }
  // Dedupe by url
  const seen = new Set();
  return servers.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}

function prettyServer(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("streamwish") || n === "sw") return "StreamWish";
  if (n.includes("voe")) return "VOE";
  if (n.includes("mixdrop") || n === "md") return "MixDrop";
  if (n.includes("mp4upload") || n === "mp4") return "Mp4Upload";
  if (n.includes("filemoon") || n === "fm") return "Filemoon";
  if (n.includes("streamtape") || n === "st") return "Streamtape";
  if (n.includes("ok") || n.includes("odnoklassniki")) return "OK.ru";
  if (n.includes("fembed") || n.includes("embedsito")) return "Fembed";
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Servidor";
}

function pickPreferred(servers) {
  const prefer = (kino.config && kino.config.get("preferServer")) || "auto";
  if (prefer === "auto" || !prefer) return servers;
  const idx = servers.findIndex((s) => s.name.includes(prefer) || s.label.toLowerCase().includes(prefer));
  if (idx > 0) {
    const [p] = servers.splice(idx, 1);
    servers.unshift(p);
  }
  return servers;
}

/** Resolve a single server URL to a playable stream (best effort) */
async function resolveServer(server) {
  const url = server.url;
  // Already a direct media file
  if (/\.(mp4|m3u8|mkv|webm)(\?|$)/i.test(url)) {
    return { url, mime: url.includes(".m3u8") ? "application/x-mpegURL" : "video/mp4", label: server.label };
  }

  // Try fetch the embed page and look for m3u8 / mp4
  try {
    const r = await kino.fetch(url, {
      headers: { ...headers(), Referer: BASE + "/" },
      timeoutMs: 15000,
    });
    if (r.ok) {
      const body = await r.text();
      const m3u = body.match(/(https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*)/i);
      if (m3u) {
        return {
          url: m3u[1].replace(/\\u0026/g, "&").replace(/\\"/g, ""),
          mime: "application/x-mpegURL",
          label: server.label,
          headers: { Referer: url },
        };
      }
      const mp4 = body.match(/(https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*)/i);
      if (mp4) {
        return {
          url: mp4[1].replace(/\\u0026/g, "&"),
          mime: "video/mp4",
          label: server.label,
          headers: { Referer: url },
        };
      }
      // file: "..." patterns common in players
      const file = body.match(/file\s*:\s*["'](https?:\/\/[^"']+)["']/i);
      if (file) {
        const u = file[1];
        return {
          url: u,
          mime: u.includes(".m3u8") ? "application/x-mpegURL" : "video/mp4",
          label: server.label,
          headers: { Referer: url },
        };
      }
      const sources = body.match(/sources\s*:\s*\[([\s\S]*?)\]/i);
      if (sources) {
        const src = sources[1].match(/["'](https?:\/\/[^"']+)["']/);
        if (src) {
          return {
            url: src[1],
            mime: src[1].includes(".m3u8") ? "application/x-mpegURL" : "video/mp4",
            label: server.label,
            headers: { Referer: url },
          };
        }
      }
    }
  } catch (_) {}

  // Fallback: return the embed URL itself (player may handle it) or use browser capture
  return null;
}

// ---------- Kino exports ----------

export async function search(query) {
  await Promise.resolve();
  const q = (query.q || "").trim();
  if (!q) return [];

  const page = query.cursor ? parseInt(query.cursor, 10) || 1 : 1;
  const encoded = encodeURIComponent(q).replace(/%20/g, "+");
  const html = await fetchHtml(`/buscar/${encoded}/${page}/`);
  let items = parseCards(html);
  items = rankItems(items, q);

  // Limit & pagination
  const next = items.length >= 12 ? String(page + 1) : undefined;
  if (items.length > 100) items = items.slice(0, 100);

  if (next) return { items, next };
  return items;
}

export async function home() {
  await Promise.resolve();
  const rows = [];

  // En emisión
  try {
    const html = await fetchHtml("/directorio/?filtro=fecha&tipo=TV&estado=1&fecha=none&temporada=none&orden=desc");
    const items = parseCards(html).slice(0, 24);
    if (items.length) {
      rows.push({
        id: "aire",
        title: "En emisión",
        items,
        ref: "dir:emision",
        genre: "anime",
      });
    }
  } catch (_) {}

  // Animes recientes (home page)
  try {
    const html = await fetchHtml("/");
    const items = parseCards(html).slice(0, 24);
    if (items.length) {
      rows.push({
        id: "recientes",
        title: "Animes recientes",
        items,
        ref: "dir:recientes",
        genre: "anime",
      });
    }
  } catch (_) {}

  // Películas
  try {
    const html = await fetchHtml("/directorio/peliculas/");
    const items = parseCards(html).slice(0, 20);
    if (items.length) {
      rows.push({
        id: "pelis",
        title: "Películas",
        items: items.map((i) => ({ ...i, kind: "movie" })),
        ref: "dir:peliculas",
        genre: "peliculas",
      });
    }
  } catch (_) {}

  // Directorio general
  try {
    const html = await fetchHtml("/directorio/animes/");
    const items = parseCards(html).slice(0, 20);
    if (items.length) {
      rows.push({
        id: "animes",
        title: "Directorio de animes",
        items,
        ref: "dir:animes",
        genre: "anime",
      });
    }
  } catch (_) {}

  return rows;
}

export async function browse(ref, cursor) {
  await Promise.resolve();
  const page = cursor ? parseInt(cursor, 10) || 1 : 1;
  let path = "/directorio/animes/";
  if (ref === "dir:emision") {
    path = "/directorio/?filtro=fecha&tipo=TV&estado=1&fecha=none&temporada=none&orden=desc";
  } else if (ref === "dir:peliculas") {
    path = "/directorio/peliculas/";
  } else if (ref === "dir:recientes") {
    path = "/";
  } else if (ref === "dir:animes") {
    path = "/directorio/animes/";
  }

  // Pagination for directorio: /directorio/animes/2/
  if (page > 1 && path.includes("/directorio/")) {
    path = path.replace(/\/?$/, "/") + page + "/";
  }

  const html = await fetchHtml(path);
  let items = parseCards(html);
  if (ref === "dir:peliculas") items = items.map((i) => ({ ...i, kind: "movie" }));

  const next = items.length >= 12 ? String(page + 1) : undefined;
  return { items, next };
}

export async function episodes(ref) {
  await Promise.resolve();
  // ref is the slug
  const slug = String(ref).replace(/\/+$/, "").split("/").pop();
  const html = await fetchHtml("/" + slug + "/");

  // Series info
  let title = slug.replace(/-/g, " ");
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) title = stripTags(h1[1]);

  let overview = "";
  const syn = html.match(/class=["'][^"']*(?:sinopsis|synopsis|description)[^"']*["'][^>]*>([\s\S]*?)<\//i);
  if (syn) overview = stripTags(syn[1]).slice(0, 800);

  let poster = "";
  const og = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (og) poster = absoluteUrl(og[1]);

  const episodeList = parseEpisodes(html, slug);
  if (episodeList.length === 0) {
    // Movie / single episode
    return {
      series: { title, poster: poster || undefined, overview: overview || undefined, genres: ["anime"] },
      episodes: [{ season: 1, number: 1, ref: slug + "/1", title: title }],
    };
  }

  return {
    series: {
      title,
      poster: poster || undefined,
      overview: overview || undefined,
      genres: ["anime"],
    },
    episodes: episodeList,
  };
}

export async function resolve(ref) {
  await Promise.resolve();
  // ref = "slug/ep" or "slug" or "server:slug/ep:index"
  let slugEp = String(ref);
  let forceIndex = -1;
  if (slugEp.startsWith("server:")) {
    const parts = slugEp.slice(7).split(":");
    slugEp = parts[0];
    forceIndex = parseInt(parts[1], 10);
  }

  const path = slugEp.includes("/") ? "/" + slugEp + "/" : "/" + slugEp + "/";
  const html = await fetchHtml(path);

  let servers = parseServers(html);
  servers = pickPreferred(servers);

  if (servers.length === 0) {
    // Last resort: hidden browser capture (needs "browser": true)
    if (typeof kino.browser === "object" && kino.browser && typeof kino.browser.capture === "function") {
      try {
        const cap = await kino.browser.capture(BASE + path, {
          timeoutMs: 25000,
          waitUntil: "networkidle",
        });
        if (cap && cap.url && /\.(m3u8|mp4)/i.test(cap.url)) {
          return {
            url: cap.url,
            mime: cap.url.includes(".m3u8") ? "application/x-mpegURL" : "video/mp4",
            headers: { Referer: BASE + path },
            label: "Captura",
          };
        }
        if (cap && cap.responses) {
          for (const resp of cap.responses) {
            if (resp.url && /\.m3u8/i.test(resp.url)) {
              return {
                url: resp.url,
                mime: "application/x-mpegURL",
                headers: { Referer: BASE + path },
                label: "HLS",
              };
            }
          }
        }
      } catch (_) {}
    }
    throw kino.error("not_found", "sin servidores", {
      userMessage: "No se encontraron servidores para este capítulo.",
    });
  }

  // Manual selection: first server resolved, rest as lazy alternatives
  const alternatives = [];
  let primary = null;

  const order = forceIndex >= 0 && forceIndex < servers.length
    ? [servers[forceIndex], ...servers.filter((_, i) => i !== forceIndex)]
    : servers;

  for (let i = 0; i < order.length; i++) {
    const s = order[i];
    const stream = await resolveServer(s);
    if (stream) {
      if (!primary) {
        primary = stream;
      } else {
        alternatives.push({
          label: s.label,
          ref: "server:" + slugEp + ":" + servers.indexOf(s),
        });
      }
    } else {
      // Keep as lazy alternative so user can pick it manually
      alternatives.push({
        label: s.label + " (embed)",
        ref: "server:" + slugEp + ":" + servers.indexOf(s),
      });
    }
  }

  if (!primary) {
    // No direct URL; return first embed as last resort with alternatives
    primary = {
      url: order[0].url,
      label: order[0].label,
      headers: { Referer: BASE + path },
    };
    for (let i = 1; i < order.length; i++) {
      alternatives.push({
        label: order[i].label,
        ref: "server:" + slugEp + ":" + servers.indexOf(order[i]),
      });
    }
  }

  if (alternatives.length) primary.alternatives = alternatives;
  return primary;
}
