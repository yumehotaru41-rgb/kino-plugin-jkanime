/// <reference path="./kino.d.ts" />
/**
 * JKAnime plugin for Kino — v1.2.1
 * jkanime.bz — ids sin ":" (Kino descarta id con caracteres fuera de [A-Za-z0-9._~-])
 */

const BASE = "https://jkanime.bz";
const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";

function hdr() {
  return {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9",
    Referer: BASE + "/",
  };
}

async function get(path) {
  const url = path.startsWith("http") ? path : BASE + path;
  const r = await kino.fetch(url, { headers: hdr(), timeoutMs: 18000 });
  if (!r.ok) {
    throw kino.error("unavailable", "jkanime " + r.status, {
      userMessage: "jkanime.bz no respondió (" + r.status + ").",
    });
  }
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
    var t = String(s).replace(/\s/g, "");
    while (t.length % 4) t += "=";
    return atob(t);
  } catch (e) {
    return "";
  }
}

function abs(u) {
  if (!u) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.indexOf("http") === 0) return u;
  if (u.charAt(0) === "/") return BASE + u;
  return BASE + "/" + u;
}

function pretty(name) {
  var n = String(name || "").toLowerCase();
  if (n.indexOf("streamwish") >= 0 || n.indexOf("sfastwish") >= 0) return "StreamWish";
  if (n.indexOf("voe") >= 0) return "VOE";
  if (n.indexOf("mixdrop") >= 0) return "MixDrop";
  if (n.indexOf("mp4upload") >= 0) return "Mp4Upload";
  if (n.indexOf("filemoon") >= 0) return "Filemoon";
  if (n.indexOf("streamtape") >= 0) return "Streamtape";
  if (n.indexOf("vidhide") >= 0) return "Vidhide";
  if (n.indexOf("mega") >= 0) return "Mega";
  if (n.indexOf("mediafire") >= 0) return "Mediafire";
  if (n.indexOf("ok") >= 0) return "OK.ru";
  if (n.indexOf("desu") >= 0 || n.indexOf("jkplayer") >= 0) return "JKPlayer";
  return name ? String(name) : "Servidor";
}

/** Solo [A-Za-z0-9._~-] — sin ":" ni otros símbolos */
function makeId(slug) {
  return String(slug || "x").replace(/[^A-Za-z0-9._~-]/g, "-").slice(0, 120);
}

function norm(s) {
  // sin String.normalize (puede faltar en QuickJS)
  return String(s || "")
    .toLowerCase()
    .replace(/[áàäâ]/g, "a")
    .replace(/[éèëê]/g, "e")
    .replace(/[íìïî]/g, "i")
    .replace(/[óòöô]/g, "o")
    .replace(/[úùüû]/g, "u")
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rank(items, q) {
  var nq = norm(q);
  if (!nq) return items;
  var scored = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var nt = norm(it.title);
    var score = 0;
    if (nt === nq) score = 1000;
    else if (nt.indexOf(nq) === 0) score = 800;
    else if (nt.indexOf(nq) >= 0) score = 500;
    else {
      var words = nq.split(" ");
      var hit = 0;
      for (var w = 0; w < words.length; w++) {
        if (words[w].length > 1 && nt.indexOf(words[w]) >= 0) hit++;
      }
      score = hit * 120;
    }
    if (score > 0) scored.push({ it: it, score: score });
  }
  scored.sort(function (a, b) {
    return b.score - a.score;
  });
  var out = [];
  for (var j = 0; j < scored.length; j++) out.push(scored[j].it);
  return out;
}

function parseAnimeItems(html) {
  var items = [];
  var seen = {};
  // Partir por anime__item (con o sin comillas extra)
  var parts = html.split(/anime__item/);
  for (var i = 1; i < parts.length; i++) {
    var block = parts[i].slice(0, 2500);
    var hrefM = block.match(/href=["']https?:\/\/[^"']+\/([a-z0-9-]+)\/?["']/i);
    if (!hrefM) continue;
    var slug = hrefM[1];
    if (!slug || seen[slug]) continue;
    if (
      slug === "buscar" ||
      slug === "directorio" ||
      slug === "dash" ||
      slug === "genero" ||
      slug === "horario" ||
      slug === "peliculas" ||
      slug === "ovas"
    )
      continue;
    seen[slug] = true;

    var title = "";
    var h5 = block.match(/<h5[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
    if (h5) title = strip(h5[1]);
    if (!title) {
      var h5b = block.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i);
      if (h5b) title = strip(h5b[1]);
    }
    if (!title) title = slug.replace(/-/g, " ");

    var poster = "";
    var bg = block.match(/data-setbg=["']([^"']+)["']/i);
    if (bg) poster = abs(bg[1]);

    var kind = /pelicula|movie/i.test(block) ? "movie" : "series";

    items.push({
      id: makeId(slug),
      ref: slug,
      title: title,
      kind: kind,
      poster: poster || undefined,
      genres: ["anime"],
    });
  }
  return items;
}

function parseHomeCards(html) {
  var items = [];
  var seen = {};
  var re =
    /href=["']https?:\/\/jkanime\.bz\/([a-z0-9-]+)\/?["'][^>]*>[\s\S]{0,120}?(?:class="[^"]*card-title[^"]*"|<h5)/gi;
  // Más robusto: card-title con enlace
  var re2 =
    /<h5[^>]*class="[^"]*card-title[^"]*"[^>]*>\s*<a[^>]+href=["']https?:\/\/[^"']+\/([a-z0-9-]+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re2.exec(html)) !== null) {
    var slug = m[1];
    if (seen[slug]) continue;
    if (slug === "buscar" || slug === "directorio" || slug === "dash") continue;
    seen[slug] = true;
    var poster = "";
    var before = html.slice(Math.max(0, m.index - 900), m.index);
    var img = before.match(/src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
    if (img) poster = img[1];
    items.push({
      id: makeId(slug),
      ref: slug,
      title: strip(m[2]),
      kind: "series",
      poster: poster || undefined,
      genres: ["anime"],
    });
  }
  return items;
}

function parseServers(html) {
  var servers = [];
  var m = html.match(/var\s+servers\s*=\s*(\[[\s\S]*?\]);/);
  if (m) {
    try {
      var arr = JSON.parse(m[1]);
      for (var i = 0; i < arr.length; i++) {
        var s = arr[i];
        var url = s.remote || "";
        if (url && url.indexOf("http") !== 0) url = b64(url).replace(/\n/g, "").trim();
        if (!url || url.indexOf("http") !== 0) continue;
        var name = String(s.server || "server");
        servers.push({
          name: name.toLowerCase(),
          url: url,
          label: pretty(name) + (s.size ? " (" + s.size + ")" : ""),
        });
      }
    } catch (e) {}
  }

  // iframes jkplayer
  var re = /src=["'](https?:\/\/[^"']*jkplayer[^"']+)["']/gi;
  var m2;
  while ((m2 = re.exec(html)) !== null) {
    var u = m2[1];
    var exists = false;
    for (var j = 0; j < servers.length; j++) if (servers[j].url === u) exists = true;
    if (!exists) servers.push({ name: "jkplayer", url: u, label: "JKPlayer" });
  }

  return servers;
}

function preferOrder(servers) {
  var prefer = "streamwish";
  try {
    if (kino.config && kino.config.get) prefer = kino.config.get("preferServer") || prefer;
  } catch (e) {}
  if (prefer && prefer !== "auto") {
    for (var i = 0; i < servers.length; i++) {
      if (
        servers[i].name.indexOf(prefer) >= 0 ||
        servers[i].label.toLowerCase().indexOf(prefer) >= 0
      ) {
        var p = servers.splice(i, 1)[0];
        servers.unshift(p);
        break;
      }
    }
  }
  var playable = [];
  var downloads = [];
  for (var k = 0; k < servers.length; k++) {
    if (/mega|mediafire|google/.test(servers[k].name)) downloads.push(servers[k]);
    else playable.push(servers[k]);
  }
  return playable.concat(downloads);
}

async function resolveServer(server, referer) {
  var url = server.url;
  if (/\.(m3u8|mp4)(\?|$)/i.test(url)) {
    return {
      url: url,
      mime: /\.m3u8/i.test(url) ? "application/x-mpegURL" : "video/mp4",
      label: server.label,
      headers: { Referer: referer || BASE + "/", "User-Agent": UA },
    };
  }
  if (/mega\.nz|mediafire\.com/i.test(url)) return null;

  try {
    var body = await get(url);
    var patterns = [
      /(https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*)/i,
      /(https?:\/\/[^"'\s\\]+\.mp4[^"'\s\\]*)/i,
      /file\s*:\s*["'](https?:\/\/[^"']+)["']/i,
      /sources?\s*:\s*\[[\s\S]*?["'](https?:\/\/[^"']+)["']/i,
      /<source[^>]+src=["'](https?:\/\/[^"']+)["']/i,
    ];
    for (var i = 0; i < patterns.length; i++) {
      var mm = body.match(patterns[i]);
      if (mm) {
        var u = mm[1]
          .replace(/\\\//g, "/")
          .replace(/\\u0026/g, "&")
          .replace(/&amp;/g, "&");
        if (u.indexOf("http") === 0 && !/google|facebook|ads/i.test(u)) {
          return {
            url: u,
            mime: /\.m3u8/i.test(u) ? "application/x-mpegURL" : "video/mp4",
            label: server.label,
            headers: { Referer: url, "User-Agent": UA },
          };
        }
      }
    }
  } catch (e) {}
  return null;
}

function dedupe(items) {
  var map = {};
  var out = [];
  for (var i = 0; i < items.length; i++) {
    if (!map[items[i].ref]) {
      map[items[i].ref] = true;
      out.push(items[i]);
    }
  }
  return out;
}

// -------------------- exports --------------------

export async function search(query) {
  await Promise.resolve();
  var q = ((query && query.q) || "").trim();
  if (!q) return [];

  var html = await get("/buscar/?q=" + encodeURIComponent(q));
  var items = parseAnimeItems(html);
  if (items.length === 0) items = parseHomeCards(html);
  items = rank(items, q);
  items = dedupe(items);
  if (items.length > 100) items = items.slice(0, 100);
  return items;
}

export async function home() {
  await Promise.resolve();
  var rows = [];

  var html = await get("/");
  var cards = parseHomeCards(html);

  // Últimos episodios (enlaces /slug/N/)
  var latest = [];
  var seen = {};
  var reEp = /href=["']https?:\/\/jkanime\.bz\/([a-z0-9-]+)\/(\d+)\/?["']/gi;
  var m;
  while ((m = reEp.exec(html)) !== null) {
    var slug = m[1];
    if (seen[slug]) continue;
    if (slug === "buscar" || slug === "directorio") continue;
    seen[slug] = true;
    // buscar título en cards si existe
    var title = slug.replace(/-/g, " ");
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].ref === slug) {
        title = cards[i].title;
        break;
      }
    }
    latest.push({
      id: makeId(slug),
      ref: slug,
      title: title,
      kind: "series",
      poster: undefined,
      genres: ["anime"],
    });
    if (latest.length >= 24) break;
  }
  if (latest.length) {
    rows.push({
      id: "ultimos",
      title: "Ultimos episodios",
      items: latest,
      ref: "dir-ultimos",
      genre: "anime",
    });
  }

  if (cards.length) {
    rows.push({
      id: "recientes",
      title: "Animes recientes",
      items: cards.slice(0, 30),
      ref: "dir-recientes",
      genre: "anime",
    });
  }

  try {
    var html2 = await get(
      "/directorio/?filtro=fecha&tipo=TV&estado=1&fecha=none&temporada=none&orden=desc"
    );
    var items2 = parseAnimeItems(html2);
    if (items2.length === 0) items2 = parseHomeCards(html2);
    if (items2.length) {
      rows.push({
        id: "aire",
        title: "En emision",
        items: items2.slice(0, 24),
        ref: "dir-aire",
        genre: "anime",
      });
    }
  } catch (e) {}

  try {
    var html3 = await get("/directorio/peliculas/");
    var items3 = parseAnimeItems(html3);
    if (items3.length === 0) items3 = parseHomeCards(html3);
    if (items3.length) {
      var movies = [];
      for (var k = 0; k < items3.length && k < 20; k++) {
        var it = items3[k];
        movies.push({
          id: it.id,
          ref: it.ref,
          title: it.title,
          kind: "movie",
          poster: it.poster,
          genres: ["anime"],
        });
      }
      rows.push({
        id: "pelis",
        title: "Peliculas",
        items: movies,
        ref: "dir-pelis",
        genre: "peliculas",
      });
    }
  } catch (e) {}

  return rows;
}

export async function browse(ref, cursor) {
  await Promise.resolve();
  var path = "/";
  if (ref === "dir-aire") {
    path =
      "/directorio/?filtro=fecha&tipo=TV&estado=1&fecha=none&temporada=none&orden=desc";
  } else if (ref === "dir-pelis") {
    path = "/directorio/peliculas/";
  }

  var html = await get(path);
  var items = parseAnimeItems(html);
  if (items.length === 0) items = parseHomeCards(html);
  if (ref === "dir-pelis") {
    for (var i = 0; i < items.length; i++) items[i].kind = "movie";
  }
  return { items: items };
}

export async function episodes(ref) {
  await Promise.resolve();
  var slug = String(ref)
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean)
    .pop();
  var html = await get("/" + slug + "/");

  var title = slug.replace(/-/g, " ");
  var h3s = html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/gi) || [];
  for (var i = 0; i < h3s.length; i++) {
    var t = strip(h3s[i].replace(/<\/?h3[^>]*>/gi, ""));
    if (t && t.length > 1 && !/buscado|temporada|relacionado/i.test(t)) {
      title = t;
      break;
    }
  }

  var overview = "";
  var p = html.match(/<p class="scroll">([\s\S]*?)<\/p>/i);
  if (p) overview = strip(p[1]).slice(0, 800);

  var poster = "";
  var og = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (!og) og = html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (og) poster = abs(og[1]);

  var total = 1;
  var epCount = html.match(/Episodios:<\/span>\s*(\d+)/i);
  if (epCount) total = parseInt(epCount[1], 10) || 1;
  if (total > 2000) total = 2000;

  var episodes = [];
  for (var n = 1; n <= total; n++) {
    episodes.push({
      season: 1,
      number: n,
      ref: slug + "/" + n,
      title: "Episodio " + n,
    });
  }

  return {
    series: {
      title: title,
      poster: poster || undefined,
      overview: overview || undefined,
      genres: ["anime"],
    },
    episodes: episodes,
  };
}

export async function resolve(ref) {
  await Promise.resolve();
  var slugEp = String(ref);
  var forceIndex = -1;
  if (slugEp.indexOf("server-") === 0) {
    // server-slug-ep-index  (sin ":")
    var rest = slugEp.slice(7);
    var lastDash = rest.lastIndexOf("-");
    if (lastDash > 0) {
      forceIndex = parseInt(rest.slice(lastDash + 1), 10);
      slugEp = rest.slice(0, lastDash);
    }
  }

  var path = "/" + slugEp.replace(/^\/+|\/+$/g, "") + "/";
  var html = await get(path);
  var servers = preferOrder(parseServers(html));

  if (servers.length === 0) {
    throw kino.error("not_found", "sin servidores", {
      userMessage: "No hay servidores para este capitulo.",
    });
  }

  var order = servers;
  if (forceIndex >= 0 && forceIndex < servers.length) {
    order = [servers[forceIndex]].concat(
      servers.filter(function (_, i) {
        return i !== forceIndex;
      })
    );
  }

  var primary = null;
  var alternatives = [];

  for (var i = 0; i < order.length && i < 6; i++) {
    var s = order[i];
    var stream = await resolveServer(s, BASE + path);
    var idx = servers.indexOf(s);
    var altRef = "server-" + slugEp + "-" + idx;
    if (stream) {
      if (!primary) primary = stream;
      else alternatives.push({ label: s.label.slice(0, 48), ref: altRef });
    } else {
      alternatives.push({ label: s.label.slice(0, 48), ref: altRef });
    }
  }

  if (!primary) {
    var s0 = order[0];
    for (var j = 0; j < order.length; j++) {
      if (!/mega|mediafire/i.test(order[j].name)) {
        s0 = order[j];
        break;
      }
    }
    primary = {
      url: s0.url,
      label: s0.label.slice(0, 48),
      headers: { Referer: BASE + path, "User-Agent": UA },
    };
  }

  if (alternatives.length) primary.alternatives = alternatives.slice(0, 8);
  return primary;
}
