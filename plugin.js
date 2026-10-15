/// <reference path="./kino.d.ts" />
/**
 * JKAnime plugin for Kino — v1.2.0
 * Uses jkanime.bz (no Cloudflare). Parses anime__item cards and var servers JSON.
 */

const BASE = "https://jkanime.bz";
const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";

function hdr(extra) {
  return Object.assign(
    {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-ES,es;q=0.9",
      Referer: BASE + "/",
    },
    extra || {}
  );
}

async function get(path) {
  const url = path.startsWith("http") ? path : BASE + path;
  const r = await kino.fetch(url, { headers: hdr(), timeoutMs: 20000 });
  if (!r.ok) throw kino.error("unavailable", "http " + r.status);
  return await r.text();
}

function strip(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function b64(s) {
  try {
    let t = s.replace(/\s/g, "");
    // pad
    while (t.length % 4) t += "=";
    return atob(t);
  } catch (_) {
    return "";
  }
}

function abs(u) {
  if (!u) return "";
  if (u.startsWith("//")) return "https:" + u;
  if (u.startsWith("http")) return u;
  if (u.startsWith("/")) return BASE + u;
  return BASE + "/" + u;
}

function pretty(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("streamwish") || n.includes("sfastwish") || n === "sw") return "StreamWish";
  if (n.includes("voe")) return "VOE";
  if (n.includes("mixdrop")) return "MixDrop";
  if (n.includes("mp4upload")) return "Mp4Upload";
  if (n.includes("filemoon")) return "Filemoon";
  if (n.includes("streamtape")) return "Streamtape";
  if (n.includes("mega")) return "Mega";
  if (n.includes("mediafire")) return "Mediafire";
  if (n.includes("ok")) return "OK.ru";
  if (n.includes("desu") || n.includes("um") || n.includes("nozomi")) return "Desu";
  if (n.includes("jkmedia") || n.includes("xtreme")) return "Xtreme";
  return name ? String(name) : "Servidor";
}

function rank(items, q) {
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
        let hit = 0;
        for (const w of nq.split(" ")) if (w.length > 1 && nt.includes(w)) hit++;
        score = hit * 120;
      }
      return { it, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.it);
}

/** Parse .anime__item cards (search results) */
function parseAnimeItems(html) {
  const items = [];
  const seen = new Set();
  const blocks = html.split(/<div class="anime__item">/i).slice(1);
  for (const block of blocks) {
    const hrefM = block.match(/href=["'](https?:\/\/[^"']+\/([a-z0-9-]+)\/?)["']/i);
    if (!hrefM) continue;
    const slug = hrefM[2];
    if (!slug || seen.has(slug)) continue;
    if (["buscar", "directorio", "dash", "genero", "horario"].includes(slug)) continue;
    seen.add(slug);

    let title = "";
    const h5 = block.match(/<h5[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
    if (h5) title = strip(h5[1]);
    if (!title) {
      const t = block.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i);
      if (t) title = strip(t[1]);
    }
    if (!title) title = slug.replace(/-/g, " ");

    let poster = "";
    const bg = block.match(/data-setbg=["']([^"']+)["']/i);
    if (bg) poster = abs(bg[1]);

    const typeLi = (block.match(/<li class="anime">([\s\S]*?)<\/li>/i) || [])[1] || "";
    const kind = /pelicula|movie/i.test(typeLi + block) ? "movie" : "series";

    items.push({
      id: "jk:" + slug,
      ref: slug,
      title,
      kind,
      poster: poster || undefined,
      genres: ["anime"],
    });
  }
  return items;
}

/** Parse home page cards (card-title) */
function parseHomeCards(html) {
  const items = [];
  const seen = new Set();
  // <h5 class="card-title"><a href="...slug/">Title</a>
  const re =
    /<h5[^>]*class="[^"]*card-title[^"]*"[^>]*>\s*<a[^>]+href=["'](https?:\/\/[^"']+\/([a-z0-9-]+)\/?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const slug = m[2];
    if (seen.has(slug) || ["buscar", "directorio", "dash"].includes(slug)) continue;
    seen.add(slug);
    let poster = "";
    // look backwards for img
    const before = html.slice(Math.max(0, m.index - 800), m.index);
    const img = before.match(/src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
    if (img) poster = img[1];
    items.push({
      id: "jk:" + slug,
      ref: slug,
      title: strip(m[3]),
      kind: "series",
      poster: poster || undefined,
      genres: ["anime"],
    });
  }
  return items;
}

/** Parse var servers = [...] */
function parseServers(html) {
  const servers = [];
  const m = html.match(/var\s+servers\s*=\s*(\[[\s\S]*?\]);/);
  if (m) {
    try {
      const arr = JSON.parse(m[1]);
      for (const s of arr) {
        let url = s.remote || "";
        if (url && !url.startsWith("http")) url = b64(url).replace(/\n/g, "").trim();
        if (!url || !url.startsWith("http")) continue;
        // skip download-only hosts for primary play (mega/mediafire still listed as alt)
        const name = String(s.server || "server");
        servers.push({
          name: name.toLowerCase(),
          url,
          label: pretty(name) + (s.size ? " (" + s.size + ")" : ""),
        });
      }
    } catch (_) {}
  }

  // var video = [] iframes
  if (html.includes("var video = []") || html.includes("player_conte")) {
    for (const m2 of html.matchAll(/src=["'](https?:\/\/[^"']+)["']/gi)) {
      const url = m2[1];
      if (/jkplayer\//i.test(url) || /player_conte/i.test(html.slice(m2.index - 80, m2.index))) {
        if (!servers.some((x) => x.url === url)) {
          servers.push({ name: "jkplayer", url, label: "JKPlayer" });
        }
      }
    }
  }

  // plain iframes
  for (const m3 of html.matchAll(/<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/gi)) {
    const url = m3[1];
    if (/ads|google|facebook|twitter/i.test(url)) continue;
    if (!servers.some((x) => x.url === url)) {
      let host = "embed";
      try {
        host = new URL(url).hostname.replace(/^www\./, "");
      } catch (_) {}
      servers.push({ name: host, url, label: pretty(host) });
    }
  }

  return servers;
}

function preferOrder(servers) {
  const prefer = (kino.config && kino.config.get("preferServer")) || "streamwish";
  if (!prefer || prefer === "auto") return servers;
  const idx = servers.findIndex(
    (s) => s.name.includes(prefer) || s.label.toLowerCase().includes(prefer)
  );
  if (idx > 0) {
    const [p] = servers.splice(idx, 1);
    servers.unshift(p);
  }
  // Put stream hosts before pure download hosts
  const playable = [];
  const downloads = [];
  for (const s of servers) {
    if (/mega|mediafire|google.?drive/i.test(s.name)) downloads.push(s);
    else playable.push(s);
  }
  return playable.concat(downloads);
}

async function resolveServer(server, referer) {
  const url = server.url;

  if (/\.(m3u8|mp4)(\?|$)/i.test(url)) {
    return {
      url,
      mime: /\.m3u8/i.test(url) ? "application/x-mpegURL" : "video/mp4",
      label: server.label,
      headers: { Referer: referer || BASE + "/", "User-Agent": UA },
    };
  }

  // Skip mega/mediafire for auto (not streamable in-app easily)
  if (/mega\.nz|mediafire\.com/i.test(url)) return null;

  try {
    const body = await get(url.startsWith("http") ? url : BASE + url);
    // follow jkplayer internal
    if (/jkplayer/i.test(url) || /jkplayer/i.test(body.slice(0, 500))) {
      const m3u = body.match(/(https?:\\\/\\\/[^"'\s]+\\.m3u8[^"'\s]*|https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/i);
      if (m3u) {
        const u = m3u[1].replace(/\\\//g, "/").replace(/\\u0026/g, "&");
        return {
          url: u,
          mime: "application/x-mpegURL",
          label: server.label,
          headers: { Referer: url, "User-Agent": UA },
        };
      }
      const file = body.match(/file\s*:\s*["'](https?:\/\/[^"']+)["']/i);
      if (file) {
        return {
          url: file[1],
          mime: file[1].includes(".m3u8") ? "application/x-mpegURL" : "video/mp4",
          label: server.label,
          headers: { Referer: url, "User-Agent": UA },
        };
      }
      const src = body.match(/<source[^>]+src=["'](https?:\/\/[^"']+)["']/i);
      if (src) {
        return {
          url: src[1],
          mime: src[1].includes(".m3u8") ? "application/x-mpegURL" : "video/mp4",
          label: server.label,
          headers: { Referer: url, "User-Agent": UA },
        };
      }
      // redirect location style
      const loc = body.match(/location\.href\s*=\s*["'](https?:\/\/[^"']+)["']/i);
      if (loc) {
        return resolveServer({ name: server.name, url: loc[1], label: server.label }, url);
      }
    }

    // generic embed
    const patterns = [
      /(https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*)/i,
      /(https?:\/\/[^"'\s\\]+\.mp4[^"'\s\\]*)/i,
      /file\s*:\s*["'](https?:\/\/[^"']+)["']/i,
      /sources?\s*:\s*\[[\s\S]*?["'](https?:\/\/[^"']+)["']/i,
      /<source[^>]+src=["'](https?:\/\/[^"']+)["']/i,
    ];
    for (const p of patterns) {
      const mm = body.match(p);
      if (mm) {
        const u = mm[1].replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/&amp;/g, "&");
        if (u.startsWith("http") && !/google|facebook|ads/i.test(u)) {
          return {
            url: u,
            mime: /\.m3u8/i.test(u) ? "application/x-mpegURL" : "video/mp4",
            label: server.label,
            headers: { Referer: url, "User-Agent": UA },
          };
        }
      }
    }
  } catch (_) {}

  return null;
}

// -------------------- exports --------------------

export async function search(query) {
  await Promise.resolve();
  const q = (query.q || "").trim();
  if (!q) return [];

  // HTML search: /buscar/?q=
  const path = "/buscar/?q=" + encodeURIComponent(q);
  const html = await get(path);
  let items = parseAnimeItems(html);
  if (items.length === 0) items = parseHomeCards(html);

  items = rank(items, q);

  // dedupe
  const map = new Map();
  for (const it of items) if (!map.has(it.ref)) map.set(it.ref, it);
  items = Array.from(map.values()).slice(0, 100);

  return items;
}

export async function home() {
  await Promise.resolve();
  const rows = [];

  try {
    const html = await get("/");
    const cards = parseHomeCards(html);
    if (cards.length) {
      rows.push({
        id: "recientes",
        title: "Animes recientes",
        items: cards.slice(0, 30),
        ref: "dir:recientes",
        genre: "anime",
      });
    }
    // latest episode style links from home
    const latest = [];
    const seen = new Set();
    const re =
      /href=["'](https?:\/\/jkanime\.bz\/([a-z0-9-]+)\/(\d+)\/?)["'][^>]*>[\s\S]{0,200}?<h5[^>]*class="[^"]*card-title[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi;
    // simpler: unique slugs from episode links
    for (const m of html.matchAll(
      /href=["']https?:\/\/jkanime\.bz\/([a-z0-9-]+)\/(\d+)\/?["']/gi
    )) {
      const slug = m[1];
      if (seen.has(slug) || ["buscar", "directorio"].includes(slug)) continue;
      seen.add(slug);
      latest.push({
        id: "jk:" + slug,
        ref: slug,
        title: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        kind: "series",
        genres: ["anime"],
      });
      if (latest.length >= 24) break;
    }
    if (latest.length) {
      rows.unshift({
        id: "ultimos",
        title: "Últimos episodios",
        items: latest,
        ref: "dir:ultimos",
        genre: "anime",
      });
    }
  } catch (_) {}

  // Directorio animes – may be JS template; try search letter pages as fallback rows
  try {
    const html = await get("/directorio/?filtro=fecha&tipo=TV&estado=1&fecha=none&temporada=none&orden=desc");
    let items = parseAnimeItems(html);
    if (items.length === 0) items = parseHomeCards(html);
    if (items.length) {
      rows.push({
        id: "aire",
        title: "En emisión",
        items: items.slice(0, 24),
        ref: "dir:aire",
        genre: "anime",
      });
    }
  } catch (_) {}

  try {
    const html = await get("/directorio/peliculas/");
    let items = parseAnimeItems(html);
    if (items.length === 0) items = parseHomeCards(html);
    if (items.length) {
      rows.push({
        id: "pelis",
        title: "Películas",
        items: items.slice(0, 20).map((i) => ({ ...i, kind: "movie" })),
        ref: "dir:pelis",
        genre: "peliculas",
      });
    }
  } catch (_) {}

  if (rows.length === 0) {
    // still return something so Home is not empty-looking forever
    return [];
  }
  return rows;
}

export async function browse(ref, cursor) {
  await Promise.resolve();
  const page = cursor ? parseInt(cursor, 10) || 1 : 1;
  let path = "/";
  if (ref === "dir:aire") {
    path =
      "/directorio/?filtro=fecha&tipo=TV&estado=1&fecha=none&temporada=none&orden=desc";
  } else if (ref === "dir:pelis") {
    path = "/directorio/peliculas/";
  } else if (ref === "dir:recientes" || ref === "dir:ultimos") {
    path = "/";
  }

  const html = await get(path);
  let items = parseAnimeItems(html);
  if (items.length === 0) items = parseHomeCards(html);
  if (ref === "dir:pelis") items = items.map((i) => ({ ...i, kind: "movie" }));

  return { items, next: items.length >= 20 ? String(page + 1) : undefined };
}

export async function episodes(ref) {
  await Promise.resolve();
  const slug = String(ref).replace(/\/+$/, "").split("/").filter(Boolean).pop();
  const html = await get("/" + slug + "/");

  let title = slug.replace(/-/g, " ");
  const h3 = html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
  if (h3) {
    const t = strip(h3[1]);
    if (t && t.length > 1 && !/buscado|temporada/i.test(t)) title = t;
  }

  let overview = "";
  const p = html.match(/<p class="scroll">([\s\S]*?)<\/p>/i);
  if (p) overview = strip(p[1]).slice(0, 800);

  let poster = "";
  const og =
    html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (og) poster = abs(og[1]);
  if (!poster) {
    const img = html.match(/cdn\.jkdesa\.com\/assets\/images\/animes\/image\/[^"']+/i);
    if (img) poster = "https://" + img[0];
  }

  // Episode count from details: "Episodios:</span> 500"
  let total = 0;
  const epCount = html.match(/Episodios:<\/span>\s*(\d+)/i);
  if (epCount) total = parseInt(epCount[1], 10);

  // Also collect any explicit episode links
  const nums = new Set();
  const re = new RegExp(
    "href=[\"'](?:https?:\\/\\/[^\"']+)?\\/" +
      slug.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&") +
      "\\/(\\d+)\\/?[\"']",
    "gi"
  );
  let m;
  while ((m = re.exec(html)) !== null) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n < 10000) nums.add(n);
  }

  if (total <= 0 && nums.size) total = Math.max(...nums);
  if (total <= 0) total = 1;
  // Cap very large lists for UI performance; user can still open by number via browse
  if (total > 2000) total = 2000;

  const episodes = [];
  for (let n = 1; n <= total; n++) {
    episodes.push({
      season: 1,
      number: n,
      ref: slug + "/" + n,
      title: "Episodio " + n,
    });
  }

  return {
    series: {
      title,
      poster: poster || undefined,
      overview: overview || undefined,
      genres: ["anime"],
    },
    episodes,
  };
}

export async function resolve(ref) {
  await Promise.resolve();
  let slugEp = String(ref);
  let forceIndex = -1;
  if (slugEp.startsWith("server:")) {
    const parts = slugEp.slice(7).split(":");
    slugEp = parts[0];
    forceIndex = parseInt(parts[1], 10);
  }

  const path = "/" + slugEp.replace(/^\/+|\/+$/g, "") + "/";
  const html = await get(path);

  let servers = preferOrder(parseServers(html));

  if (servers.length === 0) {
    throw kino.error("not_found", "sin servidores", {
      userMessage: "No hay servidores para este capítulo.",
    });
  }

  const order =
    forceIndex >= 0 && forceIndex < servers.length
      ? [servers[forceIndex], ...servers.filter((_, i) => i !== forceIndex)]
      : servers;

  let primary = null;
  const alternatives = [];

  // Try up to 4 servers for a direct stream
  for (let i = 0; i < order.length && i < 6; i++) {
    const s = order[i];
    const stream = await resolveServer(s, BASE + path);
    if (stream) {
      if (!primary) primary = stream;
      else {
        alternatives.push({
          label: s.label,
          ref: "server:" + slugEp + ":" + servers.indexOf(s),
        });
      }
    } else if (i > 0 || primary) {
      alternatives.push({
        label: s.label,
        ref: "server:" + slugEp + ":" + servers.indexOf(s),
      });
    }
  }

  // remaining as alternatives
  for (let i = 0; i < servers.length; i++) {
    const s = servers[i];
    if (primary && alternatives.some((a) => a.label === s.label)) continue;
    if (!primary && i === 0) continue;
    if (!alternatives.some((a) => a.ref === "server:" + slugEp + ":" + i)) {
      alternatives.push({ label: s.label, ref: "server:" + slugEp + ":" + i });
    }
  }

  if (!primary) {
    // last resort: first non-download URL
    const s = order.find((x) => !/mega|mediafire/i.test(x.name)) || order[0];
    primary = {
      url: s.url,
      label: s.label,
      headers: { Referer: BASE + path, "User-Agent": UA },
    };
  }

  if (alternatives.length) primary.alternatives = alternatives.slice(0, 12);
  return primary;
}
