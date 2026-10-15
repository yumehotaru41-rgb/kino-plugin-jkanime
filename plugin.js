/// <reference path="./kino.d.ts" />
/**
 * JKAnime plugin for Kino — v1.3.1
 * jkanime.bz — Desu/Nozomi/Mp4Upload + Home con miniaturas
 */

const BASE = "https://jkanime.bz";
const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";

function hdr(extra) {
  var h = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9",
    Referer: BASE + "/",
  };
  if (extra) {
    for (var k in extra) h[k] = extra[k];
  }
  return h;
}

async function get(path, referer) {
  var url = path.indexOf("http") === 0 ? path : BASE + path;
  var r = await kino.fetch(url, {
    headers: hdr(referer ? { Referer: referer } : null),
    timeoutMs: 18000,
  });
  if (!r.ok) {
    throw kino.error("unavailable", "http " + r.status, {
      userMessage: "No se pudo cargar la pagina (" + r.status + ").",
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

function makeId(slug) {
  return String(slug || "x").replace(/[^A-Za-z0-9._~-]/g, "-").slice(0, 120);
}

function norm(s) {
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
  var parts = html.split(/anime__item/);
  for (var i = 1; i < parts.length; i++) {
    var block = parts[i].slice(0, 2500);
    var hrefM = block.match(/href=["']https?:\/\/[^"']+\/([a-z0-9-]+)\/?["']/i);
    if (!hrefM) continue;
    var slug = hrefM[1];
    if (!slug || seen[slug]) continue;
    if (
      /^(buscar|directorio|dash|genero|horario|peliculas|ovas|comunidad)$/.test(slug)
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

    items.push({
      id: makeId(slug),
      ref: slug,
      title: title,
      kind: /pelicula|movie/i.test(block) ? "movie" : "series",
      poster: poster || posterFor(slug),
      genres: ["anime"],
    });
  }
  return items;
}

function posterFor(slug) {
  if (!slug) return undefined;
  return "https://cdn.jkdesa.com/assets/images/animes/image/" + slug + ".jpg";
}

function parseHomeCards(html) {
  var items = [];
  var seen = {};
  // custom_thumb_home: enlace + img (src/alt en cualquier orden)
  var re =
    /custom_thumb_home">\s*<a href="https?:\/\/[^"]+\/([a-z0-9-]+)\/?"[^>]*>\s*<img\b([^>]+)>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var slug = m[1];
    if (seen[slug] || /^(buscar|directorio|dash)$/.test(slug)) continue;
    seen[slug] = true;
    var imgTag = m[2] || "";
    var srcM = imgTag.match(/src=["']([^"']+)["']/i);
    var altM = imgTag.match(/alt=["']([^"']*)["']/i);
    var poster = (srcM && srcM[1]) || posterFor(slug);
    var title = altM ? strip(altM[1]) : "";
    if (!title) {
      var after = html.slice(m.index, m.index + 800);
      var t = after.match(/card-title[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
      if (t) title = strip(t[1]);
    }
    if (!title) title = slug.replace(/-/g, " ");
    items.push({
      id: makeId(slug),
      ref: slug,
      title: title,
      kind: "series",
      poster: poster,
      genres: ["anime"],
    });
  }
  // Fallback card-title
  if (items.length === 0) {
    var re2 =
      /<h5[^>]*class="[^"]*card-title[^"]*"[^>]*>\s*<a[^>]+href=["']https?:\/\/[^"']+\/([a-z0-9-]+)\/?"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = re2.exec(html)) !== null) {
      var slug2 = m[1];
      if (seen[slug2]) continue;
      seen[slug2] = true;
      items.push({
        id: makeId(slug2),
        ref: slug2,
        title: strip(m[2]),
        kind: "series",
        poster: posterFor(slug2),
        genres: ["anime"],
      });
    }
  }
  return items;
}

/** Ultimos episodios con miniatura de capitulo */
function parseLatestEpisodes(html) {
  var items = [];
  var seen = {};
  // href episodio seguido de img en ~400 chars
  var re =
    /href="https?:\/\/jkanime\.bz\/([a-z0-9-]+)\/(\d+)\/?"[\s\S]{0,500}?src="(https:\/\/cdn\.jkdesa\.com[^"]+)"/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var slug = m[1];
    var ep = m[2];
    if (seen[slug] || /^(buscar|directorio)$/.test(slug)) continue;
    seen[slug] = true;
    var poster = m[3];
    // titulo cerca
    var chunk = html.slice(Math.max(0, m.index - 100), m.index + 500);
    var title = "";
    var t = chunk.match(/<(?:h5|h6|span)[^>]*>([\s\S]*?)<\/(?:h5|h6|span)>/i);
    if (t) title = strip(t[1]);
    if (!title || title.length < 2) title = slug.replace(/-/g, " ");
    items.push({
      id: makeId(slug),
      ref: slug,
      title: title,
      kind: "series",
      poster: poster || posterFor(slug),
      quality: "Ep " + ep,
      genres: ["anime"],
    });
    if (items.length >= 30) break;
  }
  return items;
}

/** Destacados del slider */
function parseHero(html) {
  var items = [];
  var seen = {};
  var re =
    /data-setbg="(https:\/\/cdn\.jkdesa\.com[^"]+)"[\s\S]{0,1200}?href="https?:\/\/jkanime\.bz\/([a-z0-9-]+)\/?"/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var poster = m[1];
    var slug = m[2];
    if (seen[slug] || /^(buscar|directorio|dash)$/.test(slug)) continue;
    seen[slug] = true;
    var chunk = html.slice(m.index, m.index + 1200);
    var title = "";
    var t = chunk.match(/<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
    if (!t) t = chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (t) title = strip(t[1]);
    if (!title) title = slug.replace(/-/g, " ");
    items.push({
      id: makeId(slug),
      ref: slug,
      title: title,
      kind: "series",
      poster: poster,
      genres: ["anime"],
    });
    if (items.length >= 12) break;
  }
  return items;
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

/** Extrae lista de servidores del HTML del episodio */
function parseServers(html) {
  var servers = [];

  // 1) Desu / Nozomi vía jkplayer/um y umv (prioridad máxima)
  var ums = html.match(/https?:\/\/[^"'\s]*jkplayer\/um\?[^"'\s]+/gi) || [];
  var umvs = html.match(/https?:\/\/[^"'\s]*jkplayer\/umv\?[^"'\s]+/gi) || [];
  for (var i = 0; i < ums.length; i++) {
    servers.push({ name: "desu", url: ums[i].replace(/&amp;/g, "&"), label: "Desu", priority: 1 });
  }
  for (var j = 0; j < umvs.length; j++) {
    servers.push({ name: "nozomi", url: umvs[j].replace(/&amp;/g, "&"), label: "Nozomi", priority: 2 });
  }

  // 2) var servers JSON
  var m = html.match(/var\s+servers\s*=\s*(\[[\s\S]*?\]);/);
  if (m) {
    try {
      var arr = JSON.parse(m[1]);
      for (var k = 0; k < arr.length; k++) {
        var s = arr[k];
        var url = s.remote || "";
        if (url && url.indexOf("http") !== 0) url = b64(url).replace(/\n/g, "").trim();
        if (!url || url.indexOf("http") !== 0) continue;
        var name = String(s.server || "server").toLowerCase();
        // saltar descargas
        if (/mega|mediafire/.test(name)) continue;
        var priority = 50;
        if (/mp4upload/.test(name)) priority = 3;
        else if (/streamwish|sfastwish/.test(name)) priority = 10;
        else if (/voe/.test(name)) priority = 15;
        else if (/filemoon|bysekoze/.test(name)) priority = 20;
        else if (/mixdrop|mxdrop/.test(name)) priority = 25;
        else if (/streamtape/.test(name)) priority = 30;
        servers.push({
          name: name,
          url: url,
          label: labelOf(name),
          priority: priority,
        });
      }
    } catch (e) {}
  }

  // ordenar por prioridad
  servers.sort(function (a, b) {
    return (a.priority || 99) - (b.priority || 99);
  });

  // dedupe por url
  var seen = {};
  var out = [];
  for (var n = 0; n < servers.length; n++) {
    if (seen[servers[n].url]) continue;
    seen[servers[n].url] = true;
    out.push(servers[n]);
  }
  return out;
}

function labelOf(name) {
  if (/mp4upload/.test(name)) return "Mp4Upload";
  if (/streamwish|sfastwish/.test(name)) return "StreamWish";
  if (/voe/.test(name)) return "VOE";
  if (/mixdrop|mxdrop/.test(name)) return "MixDrop";
  if (/filemoon|bysekoze/.test(name)) return "Filemoon";
  if (/streamtape/.test(name)) return "Streamtape";
  if (/vidhide/.test(name)) return "Vidhide";
  if (/dood/.test(name)) return "Doodstream";
  if (/desu/.test(name)) return "Desu";
  if (/nozomi/.test(name)) return "Nozomi";
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Servidor";
}

/** Limpia URL de media encontrada en HTML */
function cleanMediaUrl(u) {
  if (!u) return "";
  u = u
    .replace(/\\\//g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/\\/g, "")
    .trim();
  // quitar comillas residuales
  u = u.replace(/^["']|["']$/g, "");
  return u;
}

/** Busca m3u8 o mp4 en el cuerpo de un embed */
function findMediaInBody(body) {
  var patterns = [
    /(https?:\/\/[^"'\s\\<>]+\.m3u8[^"'\s\\<>]*)/i,
    /(https?:\/\/[^"'\s\\<>]+:[0-9]+\/[^"'\s\\<>]+\.mp4[^"'\s\\<>]*)/i,
    /(https?:\/\/[^"'\s\\<>]+\.mp4[^"'\s\\<>]*)/i,
    /src:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i,
    /file:\s*["'](https?:\/\/[^"']+)["']/i,
    /url:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
    /url:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i,
    /video:\s*\{\s*url:\s*["'](https?:\/\/[^"']+)["']/i,
    /<source[^>]+src=["'](https?:\/\/[^"']+)["']/i,
  ];
  for (var i = 0; i < patterns.length; i++) {
    var mm = body.match(patterns[i]);
    if (mm) {
      var u = cleanMediaUrl(mm[1]);
      if (
        u.indexOf("http") === 0 &&
        !/\.(js|css)(\?|$)/i.test(u) &&
        !/google|facebook|ads/i.test(u)
      ) {
        return u;
      }
    }
  }
  return null;
}

async function resolveServer(server, pageReferer) {
  var url = server.url;

  // Ya es media directa
  if (/\.(m3u8|mp4)(\?|$)/i.test(url)) {
    return {
      url: url,
      mime: /\.m3u8/i.test(url) ? "application/x-mpegURL" : "video/mp4",
      label: server.label,
      headers: { Referer: pageReferer || BASE + "/", "User-Agent": UA },
    };
  }

  try {
    var body = await get(url, pageReferer);
    var media = findMediaInBody(body);
    if (media) {
      return {
        url: media,
        mime: /\.m3u8/i.test(media) ? "application/x-mpegURL" : "video/mp4",
        label: server.label,
        headers: {
          Referer: url.indexOf("jkanime") >= 0 ? BASE + "/" : url,
          "User-Agent": UA,
        },
      };
    }
  } catch (e) {}

  return null;
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

  var hero = parseHero(html);
  var latest = parseLatestEpisodes(html);
  var cards = parseHomeCards(html);

  if (hero.length) {
    rows.push({
      id: "destacados",
      title: "Destacados",
      items: hero,
      ref: "dir-destacados",
      genre: "anime",
    });
  }

  if (latest.length) {
    // completar poster si falta
    for (var i = 0; i < latest.length; i++) {
      if (!latest[i].poster) latest[i].poster = posterFor(latest[i].ref);
    }
    rows.push({
      id: "ultimos",
      title: "Ultimos episodios",
      items: latest,
      ref: "dir-ultimos",
      genre: "anime",
    });
  }

  if (cards.length) {
    for (var j = 0; j < cards.length; j++) {
      if (!cards[j].poster) cards[j].poster = posterFor(cards[j].ref);
    }
    rows.push({
      id: "recientes",
      title: "Animes recientes",
      items: cards.slice(0, 30),
      ref: "dir-recientes",
      genre: "anime",
    });
  }

  // En emision: reutilizar destacados/cards con badge si no hay directorio SSR
  try {
    var html2 = await get(
      "/directorio/?filtro=fecha&tipo=TV&estado=1&fecha=none&temporada=none&orden=desc"
    );
    var items2 = parseAnimeItems(html2);
    if (items2.length === 0) items2 = parseHomeCards(html2);
    if (items2.length === 0 && hero.length) items2 = hero.slice();
    for (var k = 0; k < items2.length; k++) {
      if (!items2[k].poster) items2[k].poster = posterFor(items2[k].ref);
    }
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
    // Fallback: filtrar cards de home con badge pelicula no disponible → usar slug search
    if (items3.length === 0) {
      // pagina buscar tipo pelicula no fiable; dejar vacio
    }
    var movies = [];
    for (var n = 0; n < items3.length && n < 24; n++) {
      movies.push({
        id: items3[n].id,
        ref: items3[n].ref,
        title: items3[n].title,
        kind: "movie",
        poster: items3[n].poster || posterFor(items3[n].ref),
        genres: ["anime"],
      });
    }
    if (movies.length) {
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
    var rest = slugEp.slice(7);
    var lastDash = rest.lastIndexOf("-");
    if (lastDash > 0) {
      forceIndex = parseInt(rest.slice(lastDash + 1), 10);
      slugEp = rest.slice(0, lastDash);
    }
  }

  var path = "/" + slugEp.replace(/^\/+|\/+$/g, "") + "/";
  var pageUrl = BASE + path;
  var html = await get(path);
  var servers = parseServers(html);

  // Preferencia del usuario
  try {
    var prefer = kino.config && kino.config.get ? kino.config.get("preferServer") : "";
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
  } catch (e) {}

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
  // Intentar Desu, Nozomi, Mp4Upload primero (hasta 5)
  for (var i = 0; i < order.length && i < 5; i++) {
    var s = order[i];
    var stream = await resolveServer(s, pageUrl);
    var idx = -1;
    for (var t = 0; t < servers.length; t++) if (servers[t].url === s.url) idx = t;
    var altRef = "server-" + slugEp.replace(/\//g, ".") + "-" + (idx >= 0 ? idx : i);
    if (stream && stream.url && /\.(m3u8|mp4)(\?|$)/i.test(stream.url)) {
      if (!primary) primary = stream;
      else alternatives.push({ label: s.label.slice(0, 48), ref: altRef });
    } else {
      alternatives.push({ label: s.label.slice(0, 48), ref: altRef });
    }
  }

  // Resto como alternativas sin resolver
  for (var j = 5; j < servers.length && alternatives.length < 8; j++) {
    alternatives.push({
      label: servers[j].label.slice(0, 48),
      ref: "server-" + slugEp.replace(/\//g, ".") + "-" + j,
    });
  }

  if (!primary) {
    throw kino.error("unavailable", "sin stream directo", {
      userMessage: "No se pudo obtener el video. Prueba otro servidor en el menu.",
    });
  }

  if (alternatives.length) primary.alternatives = alternatives.slice(0, 8);
  return primary;
}
