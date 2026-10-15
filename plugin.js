/// <reference path="./kino.d.ts" />
/**
 * JKAnime plugin for Kino v1.1.0
 * - AJAX search (/ajax/ajax_search/)
 * - Episode pagination via /ajax/pagination_episodes/
 * - Servers from var servers = [{remote: base64}]
 * - Manual server selection via alternatives
 * - browser: "pages" for Cloudflare bypass when needed
 */

const DEFAULT_HOST = "jkanime.net";
const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";

function base() {
  const h = (kino.config && kino.config.get("baseHost")) || DEFAULT_HOST;
  return "https://" + h;
}

function headers(extra) {
  return Object.assign(
    {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      Referer: base() + "/",
      "X-Requested-With": "XMLHttpRequest",
    },
    extra || {}
  );
}

async function fetchText(pathOrUrl, opts) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : base() + pathOrUrl;
  const r = await kino.fetch(url, {
    headers: headers(opts && opts.headers),
    timeoutMs: (opts && opts.timeoutMs) || 20000,
    method: (opts && opts.method) || "GET",
    body: opts && opts.body,
  });
  if (!r.ok) {
    const err = new Error("http " + r.status);
    err.status = r.status;
    throw err;
  }
  return await r.text();
}

async function fetchJson(pathOrUrl) {
  const text = await fetchText(pathOrUrl);
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

/** Fallback: open page with hidden browser when Cloudflare blocks fetch */
async function browserHtml(pathOrUrl) {
  if (!kino.browser || typeof kino.browser.page !== "function") return null;
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : base() + pathOrUrl;
  try {
    const page = await kino.browser.page(url, { timeoutMs: 25000 });
    if (page && page.html) return page.html;
    if (page && typeof page.content === "function") return await page.content();
    if (typeof page === "string") return page;
  } catch (_) {}
  return null;
}

async function getHtml(pathOrUrl) {
  try {
    const t = await fetchText(pathOrUrl);
    // Cloudflare challenge page?
    if (t.includes("Just a moment") || t.includes("cf-challenge") || t.includes("cf-browser-verification")) {
      const b = await browserHtml(pathOrUrl);
      if (b) return b;
    }
    return t;
  } catch (e) {
    const b = await browserHtml(pathOrUrl);
    if (b) return b;
    throw e;
  }
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

function absUrl(href) {
  if (!href) return "";
  if (href.startsWith("//")) return "https:" + href;
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return base() + href;
  return base() + "/" + href;
}

function b64decode(s) {
  try {
    return atob(s);
  } catch (_) {
    try {
      return decodeURIComponent(escape(atob(s)));
    } catch (__) {
      return "";
    }
  }
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
  if (n.includes("desu") || n.includes("nozomi") || n.includes("um2") || n.includes("um.php")) return "Desu";
  if (n.includes("jkmedia") || n.includes("xtreme")) return "Xtreme";
  return name ? String(name).charAt(0).toUpperCase() + String(name).slice(1) : "Servidor";
}

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
        score = hit * 120;
      }
      return { it, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.it);
}

function itemFromAjax(a) {
  const slug = a.slug || a.id || "";
  if (!slug) return null;
  const title = a.title || slug;
  const type = String(a.type || "").toLowerCase();
  const kind = type.includes("movie") || type.includes("pelicula") || type.includes("película") ? "movie" : "series";
  let poster = a.image || a.thumbnail || "";
  if (poster && !poster.startsWith("http")) {
    poster = "https://cdn.jkdesu.com/assets/images/animes/image/" + poster.replace(/^.*\//, "");
  }
  return {
    id: "jk:" + slug,
    ref: slug,
    title: stripTags(title),
    kind,
    poster: poster || undefined,
    overview: a.synopsis ? stripTags(a.synopsis).slice(0, 400) : undefined,
    genres: ["anime"],
  };
}

/** Parse HTML cards (fallback) */
function parseCards(html) {
  const items = [];
  const seen = new Set();

  // anime__item blocks
  const reBlock =
    /<div[^>]*class=["'][^"']*anime__item[^"']*["'][^>]*>[\s\S]*?(?=<div[^>]*class=["'][^"']*anime__item|<\/div><\/div><\/div>|$)/gi;
  let blocks = html.match(reBlock) || [];
  if (blocks.length === 0) {
    // g-0 / let-post style
    blocks =
      html.match(
        /<div[^>]*class=["'][^"']*(?:g-0|let-post|anime-card)[^"']*["'][^>]*>[\s\S]{0,1200}?<\/div>/gi
      ) || [];
  }

  for (const block of blocks) {
    const hrefM = block.match(/href=["']([^"']+)["']/i);
    if (!hrefM) continue;
    const href = hrefM[1];
    if (/\/buscar\/|\/directorio\/|\/genero\//i.test(href)) continue;
    let slug = "";
    try {
      const u = new URL(href, base());
      const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
      slug = parts[0] || "";
    } catch (_) {
      continue;
    }
    if (!slug || slug.length < 2 || seen.has(slug)) continue;
    if (["buscar", "directorio", "genero", "letra", "horario"].includes(slug)) continue;
    seen.add(slug);

    let title = "";
    const t1 = block.match(/class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\//i);
    if (t1) title = stripTags(t1[1]);
    if (!title) {
      const h = block.match(/<h[1-5][^>]*>([\s\S]*?)<\/h[1-5]>/i);
      if (h) title = stripTags(h[1]);
    }
    if (!title) title = slug.replace(/-/g, " ");

    let poster = "";
    const bg = block.match(/data-setbg=["']([^"']+)["']/i);
    if (bg) poster = absUrl(bg[1]);
    else {
      const img = block.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/i);
      if (img) poster = absUrl(img[1]);
    }

    const typeText = (block.match(/(Serie|Pelicula|Película|OVA|Especial|ONA|Movie)/i) || [])[1] || "";
    const kind = /pelicula|movie/i.test(typeText) ? "movie" : "series";

    items.push({
      id: "jk:" + slug,
      ref: slug,
      title,
      kind,
      poster: poster || undefined,
      genres: ["anime"],
    });
  }

  // last episodes on home: a.bloqq
  if (items.length === 0) {
    const re = /href=["'](https?:\/\/[^"']+\/([a-z0-9-]+)\/(?:\d+\/)?)["'][^>]*>[\s\S]{0,300}?<h5[^>]*>([\s\S]*?)<\/h5>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const slug = m[2];
      if (seen.has(slug)) continue;
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

  return items;
}

function parseServersFromHtml(html) {
  const servers = [];

  // Pattern 1: var servers = [{...}];
  const m1 = html.match(/var\s+servers\s*=\s*(\[[\s\S]*?\]);/);
  if (m1) {
    try {
      const arr = JSON.parse(m1[1]);
      for (const s of arr) {
        const remote = s.remote || s.url || s.file || "";
        const name = s.server || s.name || s.slug || "server";
        let url = remote;
        if (remote && !remote.startsWith("http")) {
          url = b64decode(remote);
        }
        if (url && url.startsWith("http")) {
          servers.push({ name: String(name).toLowerCase(), url, label: prettyServer(name) });
        }
      }
    } catch (_) {}
  }

  // Pattern 2: JSON array with "remote"
  const m2 = html.match(/\[\s*\{\s*"remote"\s*:\s*"[^"]+"[\s\S]*?\}\s*\]/);
  if (m2 && servers.length === 0) {
    try {
      const arr = JSON.parse(m2[0]);
      for (const s of arr) {
        const url = b64decode(s.remote || "");
        if (url && url.startsWith("http")) {
          servers.push({ name: "remote", url, label: prettyServer("remote") });
        }
      }
    } catch (_) {}
  }

  // Pattern 3: c4.php?u=BASE64&s=name
  for (const m of html.matchAll(
    /(?:href|src|data-url)=["']([^"']*c4\.php\?u=([^&"']+)[^"']*s=([^&"']+)[^"']*)["']/gi
  )) {
    const url = b64decode(m[2]);
    const name = decodeURIComponent(m[3] || "server");
    if (url && url.startsWith("http") && !servers.some((x) => x.url === url)) {
      servers.push({ name: name.toLowerCase(), url, label: prettyServer(name) });
    }
  }

  // Pattern 4: classic video[] iframes
  if (html.includes("var video = []") || html.includes("player_conte")) {
    const replaced = html
      .replace(/\\u0026/g, "&")
      .replace(/\\\//g, "/")
      .replace(/jkanime\.net\/jkfembed\.php\?u=/g, "embedsito.com/v/")
      .replace(/jkanime\.net\/jkokru\.php\?u=/g, "ok.ru/videoembed/")
      .replace(/jkanime\.net\/jkvmixdrop\.php\?u=/g, "mixdrop.co/e/");
    for (const m of replaced.matchAll(/src=["'](https?:\/\/[^"']+)["']/gi)) {
      const url = m[1];
      if (/ads|google|facebook|twitter|cloudflare/i.test(url)) continue;
      let host = "embed";
      try {
        host = new URL(url).hostname.replace(/^www\./, "");
      } catch (_) {}
      if (!servers.some((x) => x.url === url)) {
        servers.push({ name: host, url, label: prettyServer(host) });
      }
    }
  }

  // iframes
  for (const m of html.matchAll(/<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/gi)) {
    const url = m[1];
    if (/ads|google|facebook|twitter|cloudflare/i.test(url)) continue;
    let host = "embed";
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch (_) {}
    if (!servers.some((x) => x.url === url)) {
      servers.push({ name: host, url, label: prettyServer(host) });
    }
  }

  return servers;
}

function pickPreferred(servers) {
  const prefer = (kino.config && kino.config.get("preferServer")) || "auto";
  if (!prefer || prefer === "auto") return servers;
  const idx = servers.findIndex(
    (s) => s.name.includes(prefer) || s.label.toLowerCase().includes(prefer)
  );
  if (idx > 0) {
    const [p] = servers.splice(idx, 1);
    servers.unshift(p);
  }
  return servers;
}

async function resolveOneServer(server, referer) {
  const url = server.url;

  // Direct media
  if (/\.(m3u8|mp4|mkv|webm)(\?|$)/i.test(url)) {
    return {
      url,
      mime: /\.m3u8/i.test(url) ? "application/x-mpegURL" : "video/mp4",
      label: server.label,
      headers: { Referer: referer || base() + "/", "User-Agent": UA },
    };
  }

  // um.php / Desu style – page contains m3u8
  if (/\/um\.php|\/um2\.php|jkmedia/i.test(url) || /desu|nozomi/i.test(server.name)) {
    try {
      const body = await fetchText(url, {
        headers: { Referer: referer || base() + "/" },
        timeoutMs: 15000,
      });
      const m3u = body.match(/(https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*)/i);
      if (m3u) {
        return {
          url: m3u[1].replace(/\\u0026/g, "&").replace(/\\/g, ""),
          mime: "application/x-mpegURL",
          label: server.label,
          headers: { Referer: url, "User-Agent": UA },
        };
      }
    } catch (_) {}
  }

  // Generic embed page scrape
  try {
    const body = await fetchText(url, {
      headers: { Referer: referer || base() + "/", "User-Agent": UA },
      timeoutMs: 15000,
    });
    const candidates = [];
    const m3u = body.match(/(https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*)/i);
    if (m3u) candidates.push(m3u[1]);
    const mp4 = body.match(/(https?:\/\/[^"'\s<>\\]+\.mp4[^"'\s<>\\]*)/i);
    if (mp4) candidates.push(mp4[1]);
    const file = body.match(/file\s*:\s*["'](https?:\/\/[^"']+)["']/i);
    if (file) candidates.push(file[1]);
    const src = body.match(/sources?\s*:\s*\[[\s\S]*?["'](https?:\/\/[^"']+)["']/i);
    if (src) candidates.push(src[1]);
    const source = body.match(/<source[^>]+src=["'](https?:\/\/[^"']+)["']/i);
    if (source) candidates.push(source[1]);

    for (const c of candidates) {
      const clean = c.replace(/\\u0026/g, "&").replace(/\\/g, "").replace(/&amp;/g, "&");
      if (clean.startsWith("http")) {
        return {
          url: clean,
          mime: /\.m3u8/i.test(clean) ? "application/x-mpegURL" : "video/mp4",
          label: server.label,
          headers: { Referer: url, "User-Agent": UA },
        };
      }
    }
  } catch (_) {}

  // browser capture for this embed
  if (kino.browser && typeof kino.browser.capture === "function") {
    try {
      const cap = await kino.browser.capture(url, { timeoutMs: 20000, referer: referer || base() });
      if (cap && cap.url && /\.(m3u8|mp4)/i.test(cap.url)) {
        return {
          url: cap.url,
          mime: /\.m3u8/i.test(cap.url) ? "application/x-mpegURL" : "video/mp4",
          label: server.label,
          headers: { Referer: url, "User-Agent": UA },
        };
      }
      if (cap && Array.isArray(cap.responses)) {
        for (const resp of cap.responses) {
          if (resp.url && /\.m3u8/i.test(resp.url)) {
            return {
              url: resp.url,
              mime: "application/x-mpegURL",
              label: server.label,
              headers: { Referer: url, "User-Agent": UA },
            };
          }
        }
      }
    } catch (_) {}
  }

  return null;
}

// ===================== EXPORTS =====================

export async function search(query) {
  await Promise.resolve();
  const q = (query.q || "").trim();
  if (!q) return [];

  let items = [];

  // 1) AJAX search (preferred)
  try {
    const data = await fetchJson(
      "/ajax/ajax_search/?" + "q=" + encodeURIComponent(q)
    );
    if (data && Array.isArray(data.animes)) {
      for (const a of data.animes) {
        const it = itemFromAjax(a);
        if (it) items.push(it);
      }
    } else if (data && Array.isArray(data)) {
      for (const a of data) {
        const it = itemFromAjax(a);
        if (it) items.push(it);
      }
    }
  } catch (_) {}

  // 2) HTML search pages
  if (items.length === 0) {
    const page = query.cursor ? parseInt(query.cursor, 10) || 1 : 1;
    const encoded = encodeURIComponent(q).replace(/%20/g, "+");
    try {
      const html = await getHtml("/buscar/" + encoded + "/" + page + "/");
      items = parseCards(html);
    } catch (_) {}
  }

  items = rankItems(items, q);
  if (items.length > 100) items = items.slice(0, 100);

  // Dedupe
  const map = new Map();
  for (const it of items) if (!map.has(it.ref)) map.set(it.ref, it);
  items = Array.from(map.values());

  return items;
}

export async function home() {
  await Promise.resolve();
  const rows = [];

  async function row(id, title, path, genre) {
    try {
      const html = await getHtml(path);
      let items = parseCards(html).slice(0, 24);
      if (id === "pelis") items = items.map((i) => ({ ...i, kind: "movie" }));
      if (items.length) {
        rows.push({ id, title, items, ref: "dir:" + id, genre: genre || "anime" });
      }
    } catch (_) {}
  }

  // Últimos episodios from home
  try {
    const html = await getHtml("/");
    const items = parseCards(html).slice(0, 24);
    if (items.length) {
      rows.push({
        id: "ultimos",
        title: "Últimos episodios",
        items,
        ref: "dir:ultimos",
        genre: "anime",
      });
    }
  } catch (_) {}

  await row(
    "aire",
    "En emisión",
    "/directorio/?filtro=fecha&tipo=TV&estado=1&fecha=none&temporada=none&orden=desc",
    "anime"
  );
  await row("animes", "Animes", "/directorio/animes/", "anime");
  await row("pelis", "Películas", "/directorio/peliculas/", "peliculas");

  if (rows.length === 0) {
    // Soft empty – avoid hard fail so plugin stays usable for search
    return [
      {
        id: "info",
        title: "JKAnime",
        items: [],
        genre: "anime",
      },
    ];
  }
  return rows;
}

export async function browse(ref, cursor) {
  await Promise.resolve();
  const page = cursor ? parseInt(cursor, 10) || 1 : 1;
  let path = "/directorio/animes/";
  if (ref === "dir:aire" || ref === "dir:emision") {
    path =
      "/directorio/?filtro=fecha&tipo=TV&estado=1&fecha=none&temporada=none&orden=desc";
  } else if (ref === "dir:pelis" || ref === "dir:peliculas") {
    path = "/directorio/peliculas/";
  } else if (ref === "dir:ultimos") {
    path = "/";
  } else if (ref === "dir:animes") {
    path = "/directorio/animes/";
  }

  if (page > 1 && path.includes("/directorio/") && !path.includes("?")) {
    path = path.replace(/\/?$/, "/") + page + "/";
  }

  const html = await getHtml(path);
  let items = parseCards(html);
  if (ref === "dir:pelis" || ref === "dir:peliculas") {
    items = items.map((i) => ({ ...i, kind: "movie" }));
  }
  const next = items.length >= 12 ? String(page + 1) : undefined;
  return { items, next };
}

export async function episodes(ref) {
  await Promise.resolve();
  const slug = String(ref).replace(/\/+$/, "").split("/").filter(Boolean).pop();
  const html = await getHtml("/" + slug + "/");

  let title = slug.replace(/-/g, " ");
  const h3 = html.match(/anime__details__title[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/i)
    || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h3) title = stripTags(h3[1]);

  let overview = "";
  const syn =
    html.match(/anime__details__text[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i) ||
    html.match(/class=["'][^"']*sinopsis[^"']*["'][^>]*>([\s\S]*?)<\//i);
  if (syn) overview = stripTags(syn[1]).slice(0, 800);

  let poster = "";
  const og =
    html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
    html.match(/data-setbg=["']([^"']+)["']/i);
  if (og) poster = absUrl(og[1]);

  // anime id for ajax pagination
  const idM =
    html.match(/data-anime=["'](\d+)["']/i) ||
    html.match(/pagination_episodes\/(\d+)\//i) ||
    html.match(/anime_id["']?\s*[:=]\s*["']?(\d+)/i);
  const animeId = idM ? idM[1] : null;

  const episodes = [];
  const nums = new Set();

  if (animeId) {
    // Discover pages: a.numbers href="#pagN"
    const pags = [];
    for (const m of html.matchAll(/#pag(\d+)/gi)) pags.push(m[1]);
    if (pags.length === 0) pags.push("1");

    for (const pag of pags.slice(0, 30)) {
      try {
        const text = await fetchText(
          "/ajax/pagination_episodes/" + animeId + "/" + pag + "/"
        );
        let list = null;
        try {
          list = JSON.parse(text);
        } catch (_) {
          // sometimes wrapped
          const mm = text.match(/\[[\s\S]*\]/);
          if (mm) list = JSON.parse(mm[0]);
        }
        if (Array.isArray(list)) {
          for (const ep of list) {
            const n = parseInt(ep.number || ep.episode || ep, 10);
            if (n > 0 && !nums.has(n)) {
              nums.add(n);
              let still = ep.image || "";
              if (still && !still.startsWith("http")) {
                still =
                  "https://cdn.jkdesu.com/assets/images/animes/video/image_thumb/" +
                  still;
              }
              episodes.push({
                season: 1,
                number: n,
                ref: slug + "/" + n,
                title: ep.title ? stripTags(ep.title) : "Episodio " + n,
                still: still || undefined,
              });
            }
          }
        }
      } catch (_) {}
    }
  }

  // Fallback: links on page
  if (episodes.length === 0) {
    const re = new RegExp(
      "href=[\"'](?:https?:\\/\\/[^\"']+)?\\/" +
        slug.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") +
        "\\/(\\d+)\\/?[\"']",
      "gi"
    );
    let m;
    while ((m = re.exec(html)) !== null) {
      const n = parseInt(m[1], 10);
      if (n > 0) nums.add(n);
    }
    for (const m2 of html.matchAll(/data-number=["'](\d+)["']/gi)) {
      nums.add(parseInt(m2[1], 10));
    }
    const sorted = Array.from(nums).filter((n) => n > 0 && n < 5000).sort((a, b) => a - b);
    for (const n of sorted) {
      episodes.push({
        season: 1,
        number: n,
        ref: slug + "/" + n,
        title: "Episodio " + n,
      });
    }
  }

  episodes.sort((a, b) => a.number - b.number);

  if (episodes.length === 0) {
    // Movie or single
    return {
      series: {
        title,
        poster: poster || undefined,
        overview: overview || undefined,
        genres: ["anime"],
      },
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

  // slugEp = "slug/num"
  const path = "/" + slugEp.replace(/^\/+|\/+$/g, "") + "/";
  const pageUrl = base() + path;
  const html = await getHtml(path);

  let servers = parseServersFromHtml(html);
  servers = pickPreferred(servers);

  if (servers.length === 0) {
    // browser capture whole episode page
    if (kino.browser && typeof kino.browser.capture === "function") {
      try {
        const cap = await kino.browser.capture(pageUrl, { timeoutMs: 28000 });
        if (cap && cap.url && /\.(m3u8|mp4)/i.test(cap.url)) {
          return {
            url: cap.url,
            mime: /\.m3u8/i.test(cap.url) ? "application/x-mpegURL" : "video/mp4",
            headers: { Referer: pageUrl, "User-Agent": UA },
            label: "Captura",
          };
        }
      } catch (_) {}
    }
    throw kino.error("not_found", "sin servidores", {
      userMessage: "No se encontraron servidores para este capítulo. Prueba otro dominio en Ajustes.",
    });
  }

  const order =
    forceIndex >= 0 && forceIndex < servers.length
      ? [servers[forceIndex], ...servers.filter((_, i) => i !== forceIndex)]
      : servers;

  let primary = null;
  const alternatives = [];

  for (let i = 0; i < order.length; i++) {
    const s = order[i];
    const stream = await resolveOneServer(s, pageUrl);
    if (stream) {
      if (!primary) primary = stream;
      else {
        alternatives.push({
          label: s.label,
          ref: "server:" + slugEp + ":" + servers.indexOf(s),
        });
      }
    } else {
      alternatives.push({
        label: s.label,
        ref: "server:" + slugEp + ":" + servers.indexOf(s),
      });
    }
  }

  if (!primary) {
    // Return first embed URL as last resort – some players accept it
    primary = {
      url: order[0].url,
      label: order[0].label,
      headers: { Referer: pageUrl, "User-Agent": UA },
    };
  }

  if (alternatives.length) primary.alternatives = alternatives;
  return primary;
}
