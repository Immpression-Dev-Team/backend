// services/publicArt.js
// Proxy layer for public domain artwork from external museum APIs.
// No data is stored in MongoDB — all results are fetched and returned live.

import axios from "axios";

// ─── In-memory cache ────────────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// ─── Institution display names ─────────────────────────────────────────────

export const INSTITUTION_NAMES = {
  met: "The Metropolitan Museum of Art",
  chicago: "Art Institute of Chicago",
  cleveland: "Cleveland Museum of Art",
  wikimedia: "Wikimedia Commons",
  rijksmuseum: "Rijksmuseum",
};

// ─── Reusable artwork field cleaner ─────────────────────────────────────────
//
// Wikimedia Commons embeds machine-readable Wikidata "QuickStatements" inside
// hidden markup on nearly every structured field (date, title/label, creator):
//   between 1503 and 1506<div style="display:none">date QS:P571,+1503-00-00T00:00:00Z/8,P1319,...</div>
// A plain HTML-tag strip removes the tags but leaves that inner text behind,
// which is exactly the "...date QS:P571,..." garbage that was leaking into the UI.
// This cleaner removes the hidden elements (and their text) first, then strips
// any remaining tags/entities. It is source-agnostic (safe/idempotent on
// already-clean Met/Chicago/Cleveland text) so it is used both per-field when
// normalizing a fresh Wikimedia response, and as a defensive re-clean pass
// over any already-persisted artwork record (see sanitizeArtworkRecord below —
// artworks curated via the admin panel and saved to MongoDB before this fix
// existed still carry the raw, unclean values on disk).
function cleanArtworkText(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw);
  if (!s.trim()) return null;

  // Remove entire hidden elements (Commons' Wikidata QuickStatement blocks,
  // and any other display:none template output) — content included, not just tags.
  s = s.replace(
    /<(div|span)\b[^>]*\bstyle\s*=\s*["'][^"']*display\s*:\s*none[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi,
    " "
  );

  // Safety net: a bare Wikidata quickstatement fragment even without a wrapper,
  // e.g. "date QS:P571,+1503-00-00T00:00:00Z/8,P1319,+1503-00-00T00:00:00Z/9".
  // No leading \b: text saved by the old (pre-fix) cleaner often has the
  // keyword glued directly onto the preceding word with no space at all
  // (e.g. "1506date QS:P571,...", from stripping a tag with no surrounding
  // whitespace), so a strict word-boundary would never match it.
  s = s.replace(/(?:date|title|label|creator|depicts)\s+QS:P?\d*(?:,[^\s<]+)*/gi, " ");
  s = s.replace(/\bQS:P?\d+(?:,[^\s<]+)*/gi, " ");

  // Strip remaining HTML tags
  s = s.replace(/<[^>]*>/g, " ");

  // Decode the handful of entities Commons actually uses in these fields
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

  s = s.replace(/\s+/g, " ").trim();
  s = collapseTrailingDuplicate(s);
  return s || null;
}

// Commons sometimes concatenates the same phrase twice in one field (e.g. a
// per-language title block followed by the default-language block ends up as
// "Polish: Mona Lisa Mona Lisa" once hidden markup is removed). Generically
// collapse an exact, case-insensitive whole-word-phrase repeated at the end
// of the string — "X Y Y" -> "X Y" — without touching normal prose.
function collapseTrailingDuplicate(s) {
  const words = s.split(" ");
  const maxPhraseLen = Math.floor(words.length / 2);
  for (let phraseLen = maxPhraseLen; phraseLen >= 1; phraseLen--) {
    const tail = words.slice(-phraseLen).join(" ").toLowerCase();
    const beforeTail = words.slice(-(phraseLen * 2), -phraseLen).join(" ").toLowerCase();
    if (tail && tail === beforeTail) {
      return words.slice(0, -phraseLen).join(" ");
    }
  }
  return s;
}

// Extra guard for the title specifically: Commons' ObjectName field can carry
// dozens of hidden per-language "label QS:L**" blocks. If cleaning couldn't
// fully recover a plausible short title, treat it as unusable rather than
// risking a residual wall of text becoming the page <h1>.
function cleanArtworkTitle(raw) {
  const cleaned = cleanArtworkText(raw);
  if (!cleaned) return null;
  if (cleaned.length > 150 || /\bQS:|wikidata/i.test(cleaned)) return null;
  return cleaned;
}

// Defensive re-clean of an already-normalized artwork record. Fresh fetches
// from the museum APIs are already clean via the normalizers above; this
// exists for records that were saved to MongoDB (via the admin panel's
// "featured" picker) before this cleanup existed, or from any other path
// that hands us a full artwork object without re-normalizing it. Never
// invents values — a field that cleans to nothing is simply dropped (null).
function sanitizeArtworkRecord(a) {
  if (!a || typeof a !== "object") return a;
  return {
    ...a,
    title: cleanArtworkTitle(a.title) || cleanArtworkText(a.title) || "Untitled",
    artist: cleanArtworkText(a.artist) || "Unknown Artist",
    year: cleanArtworkText(a.year),
    medium: cleanArtworkText(a.medium),
    dimensions: cleanArtworkText(a.dimensions),
    culture: cleanArtworkText(a.culture),
    period: cleanArtworkText(a.period),
    classification: cleanArtworkText(a.classification),
    department: cleanArtworkText(a.department),
    creditLine: cleanArtworkText(a.creditLine),
    description: cleanArtworkText(a.description),
  };
}

// ─── Normalizers ────────────────────────────────────────────────────────────

function normalizeMet(obj) {
  return {
    id: `met:${obj.objectID}`,
    source: "met",
    institution: INSTITUTION_NAMES.met,
    title: obj.title || "Untitled",
    artist: obj.artistDisplayName || "Unknown Artist",
    year: obj.objectDate || null,
    medium: obj.medium || null,
    dimensions: obj.dimensions || null,
    culture: obj.culture || null,
    period: obj.period || null,
    classification: obj.classification || null,
    imageUrl: obj.primaryImage || null,
    thumbnailUrl: obj.primaryImageSmall || null,
    description: obj.creditLine || null,
    department: obj.department || null,
    creditLine: obj.creditLine || null,
    sourceUrl: obj.objectURL || null,
  };
}

function normalizeChicago(obj) {
  const imageUrl = obj.image_id
    ? `https://www.artic.edu/iiif/2/${obj.image_id}/full/843,/0/default.jpg`
    : null;
  const thumbnailUrl = obj.image_id
    ? `https://www.artic.edu/iiif/2/${obj.image_id}/full/200,/0/default.jpg`
    : null;

  return {
    id: `chicago:${obj.id}`,
    source: "chicago",
    institution: INSTITUTION_NAMES.chicago,
    title: obj.title || "Untitled",
    artist: obj.artist_display || obj.artist_title || "Unknown Artist",
    year: obj.date_display || null,
    medium: obj.medium_display || null,
    dimensions: obj.dimensions || null,
    culture: obj.place_of_origin || null,
    period: null,
    classification: obj.classification_title || null,
    imageUrl,
    thumbnailUrl,
    description: obj.description || obj.short_description || null,
    department: obj.department_title || null,
    creditLine: obj.credit_line || null,
    sourceUrl: obj.id ? `https://www.artic.edu/artworks/${obj.id}` : null,
  };
}

function normalizeCleveland(obj) {
  const image = obj.images?.web?.url || obj.images?.print?.url || null;
  const thumb = obj.images?.web?.url || image;
  return {
    id: `cleveland:${obj.id}`,
    source: "cleveland",
    institution: INSTITUTION_NAMES.cleveland,
    title: obj.title || "Untitled",
    artist: obj.creators?.map((c) => c.description).join(", ") || "Unknown Artist",
    year: obj.creation_date || null,
    medium: obj.technique || null,
    dimensions: obj.measurements || null,
    culture: Array.isArray(obj.culture) ? obj.culture.filter(Boolean).join(", ") || null : obj.culture || null,
    period: obj.period || null,
    classification: obj.type || null,
    imageUrl: image,
    thumbnailUrl: thumb,
    description: obj.wall_description || obj.did_you_know || null,
    department: obj.department || null,
    creditLine: obj.creditline || null,
    sourceUrl: obj.url || null,
  };
}

function normalizeWikimedia(page) {
  const info = page.imageinfo?.[0];
  if (!info?.url) return null;
  const meta = info.extmetadata || {};

  return {
    id: `wikimedia:${page.pageid}`,
    source: "wikimedia",
    institution: INSTITUTION_NAMES.wikimedia,
    title: cleanArtworkTitle(meta.ObjectName?.value) ||
      (page.title || "").replace(/^File:/, "").replace(/\.[^/.]+$/, ""),
    artist: cleanArtworkText(meta.Artist?.value) || "Unknown Artist",
    year: cleanArtworkText(meta.DateTimeOriginal?.value || meta.Date?.value) || null,
    medium: cleanArtworkText(meta.Medium?.value) || null,
    dimensions: null,
    culture: null,
    period: null,
    classification: null,
    imageUrl: info.url,
    thumbnailUrl: info.thumburl || info.url,
    description: cleanArtworkText(meta.ImageDescription?.value) || null,
    department: null,
    creditLine: cleanArtworkText(meta.Credit?.value) || null,
    sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title || "")}`,
  };
}

function normalizeRijksmuseum(obj) {
  return {
    id: `rijksmuseum:${obj.objectNumber}`,
    source: "rijksmuseum",
    institution: INSTITUTION_NAMES.rijksmuseum,
    title: obj.title || "Untitled",
    artist: obj.principalOrFirstMaker || "Unknown Artist",
    year: obj.dating?.presentingDate || null,
    medium: obj.materials?.join(", ") || null,
    dimensions: null,
    culture: obj.productionPlaces?.[0] || null,
    period: null,
    classification: obj.objectTypes?.[0] || null,
    imageUrl: obj.webImage?.url || null,
    thumbnailUrl: obj.webImage?.url || null,
    description: obj.plaqueDescriptionEnglish || null,
    department: null,
    creditLine: null,
    sourceUrl: obj.links?.web || null,
  };
}

// ─── MET API ────────────────────────────────────────────────────────────────

const MET_BASE = "https://collectionapi.metmuseum.org/public/collection/v1";

async function searchMet(query, limit = 20) {
  const cacheKey = `met:search:${query}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const searchRes = await axios.get(`${MET_BASE}/search`, {
    params: { q: query, isPublicDomain: true },
    timeout: 8000,
  });

  const objectIDs = (searchRes.data.objectIDs || []).slice(0, limit);
  if (!objectIDs.length) return [];

  const artworks = await Promise.all(
    objectIDs.map((id) =>
      axios
        .get(`${MET_BASE}/objects/${id}`, { timeout: 8000 })
        .then((r) => normalizeMet(r.data))
        .catch(() => null)
    )
  );

  const results = artworks.filter((a) => a !== null && a.imageUrl);
  cacheSet(cacheKey, results);
  return results;
}

async function getMetArtwork(id) {
  const cacheKey = `met:object:${id}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const res = await axios.get(`${MET_BASE}/objects/${id}`, { timeout: 8000 });
  if (!res.data.isPublicDomain) return null;

  const result = normalizeMet(res.data);
  cacheSet(cacheKey, result);
  return result;
}

// ─── Art Institute of Chicago API ───────────────────────────────────────────

const CHICAGO_BASE = "https://api.artic.edu/api/v1";
const CHICAGO_FIELDS =
  "id,title,artist_display,artist_title,date_display,medium_display,dimensions,image_id,description,short_description,department_title,credit_line,classification_title,place_of_origin";

async function searchChicago(query, limit = 20) {
  const cacheKey = `chicago:search:${query}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const res = await axios.get(`${CHICAGO_BASE}/artworks/search`, {
    params: {
      q: query,
      limit,
      fields: CHICAGO_FIELDS,
      "query[term][is_public_domain]": true,
      "boost[title]": 3,
    },
    timeout: 8000,
  });

  const results = (res.data.data || []).map(normalizeChicago).filter((a) => a.imageUrl);
  cacheSet(cacheKey, results);
  return results;
}

async function getChicagoArtwork(id) {
  const cacheKey = `chicago:object:${id}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const res = await axios.get(`${CHICAGO_BASE}/artworks/${id}`, {
    params: { fields: CHICAGO_FIELDS },
    timeout: 8000,
  });

  const artwork = res.data.data;
  if (!artwork) return null;

  const result = normalizeChicago(artwork);
  cacheSet(cacheKey, result);
  return result;
}

// ─── Cleveland Museum of Art API ─────────────────────────────────────────────

const CLEVELAND_BASE = "https://openaccess.clevelandart.org/api";

async function searchCleveland(query, limit = 20) {
  const cacheKey = `cleveland:search:${query}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const res = await axios.get(`${CLEVELAND_BASE}/artworks/`, {
    params: { q: query, has_image: 1, cc0: 1, limit },
    timeout: 10000,
  });

  const results = (res.data.data || [])
    .map(normalizeCleveland)
    .filter((a) => a.imageUrl);

  cacheSet(cacheKey, results);
  return results;
}

async function getClevelandArtwork(id) {
  const cacheKey = `cleveland:object:${id}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const res = await axios.get(`${CLEVELAND_BASE}/artworks/${id}`, { timeout: 8000 });
  const artwork = res.data.data;
  if (!artwork) return null;

  const result = normalizeCleveland(artwork);
  cacheSet(cacheKey, result);
  return result;
}

// ─── Wikimedia Commons API ───────────────────────────────────────────────────

const WIKIMEDIA_API = "https://commons.wikimedia.org/w/api.php";

const WIKIMEDIA_HEADERS = {
  "User-Agent": "Immpression/1.0 (https://immpression.art; contact@immpression.art) axios",
};

async function searchWikimedia(query, limit = 20) {
  const cacheKey = `wikimedia:search:${query}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const res = await axios.get(WIKIMEDIA_API, {
    headers: WIKIMEDIA_HEADERS,
    params: {
      action: "query",
      generator: "search",
      gsrsearch: `${query} painting`,
      gsrnamespace: 6,
      gsrlimit: Math.min(limit * 2, 40),
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: 600,
      format: "json",
    },
    timeout: 12000,
  });

  // format=json (v1) returns pages as an object keyed by pageid
  const pages = Object.values(res.data?.query?.pages || {});
  const results = pages
    .map(normalizeWikimedia)
    .filter((a) => a && a.imageUrl && /\.(jpg|jpeg|png|gif)$/i.test(a.imageUrl))
    .slice(0, limit);

  cacheSet(cacheKey, results);
  return results;
}

async function getWikimediaArtwork(pageId) {
  const cacheKey = `wikimedia:object:${pageId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const res = await axios.get(WIKIMEDIA_API, {
    headers: WIKIMEDIA_HEADERS,
    params: {
      action: "query",
      pageids: pageId,
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: 600,
      format: "json",
    },
    timeout: 8000,
  });

  const pages = res.data?.query?.pages || {};
  const page = Object.values(pages)[0];
  if (!page) return null;

  const result = normalizeWikimedia(page);
  if (result) cacheSet(cacheKey, result);
  return result;
}

// ─── Rijksmuseum API (optional — requires RIJKSMUSEUM_API_KEY in env) ────────

const RIJKS_KEY = process.env.RIJKSMUSEUM_API_KEY;
const RIJKS_BASE = "https://www.rijksmuseum.nl/api/en/collection";

async function searchRijksmuseum(query, limit = 20) {
  if (!RIJKS_KEY) return [];
  const cacheKey = `rijksmuseum:search:${query}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const res = await axios.get(RIJKS_BASE, {
    params: { key: RIJKS_KEY, q: query, imgonly: true, ps: limit, s: "relevance" },
    timeout: 10000,
  });

  const results = (res.data.artObjects || [])
    .map(normalizeRijksmuseum)
    .filter((a) => a.imageUrl);

  cacheSet(cacheKey, results);
  return results;
}

async function getRijksmuseumArtwork(objectNumber) {
  if (!RIJKS_KEY) return null;
  const cacheKey = `rijksmuseum:object:${objectNumber}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const res = await axios.get(`${RIJKS_BASE}/${objectNumber}`, {
    params: { key: RIJKS_KEY },
    timeout: 8000,
  });

  const obj = res.data.artObject;
  if (!obj) return null;

  const result = normalizeRijksmuseum(obj);
  cacheSet(cacheKey, result);
  return result;
}

// ─── Relevance scoring ───────────────────────────────────────────────────────

function relevanceScore(artwork, query) {
  const title = (artwork.title || "").toLowerCase();
  const artist = (artwork.artist || "").toLowerCase();
  const q = query.toLowerCase();
  const terms = q.split(/\s+/);

  if (title === q) return 100;
  if (title.startsWith(q)) return 90;
  if (title.includes(q)) return 80;
  if (terms.every((t) => title.includes(t))) return 70;
  const titleHits = terms.filter((t) => title.includes(t)).length;
  if (titleHits > 0) return 50 + (titleHits / terms.length) * 20;
  const artistHits = terms.filter((t) => artist.includes(t)).length;
  if (artistHits > 0) return artistHits * 10;
  return 0;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const VALID_SOURCES = ["met", "chicago", "cleveland", "wikimedia", "rijksmuseum"];

/**
 * Search across sources, sorted by title relevance.
 */
export async function searchPublicArt(query, source = "all", limit = 20) {
  let results;

  if (source === "met")         results = await searchMet(query, limit);
  else if (source === "chicago")     results = await searchChicago(query, limit);
  else if (source === "cleveland")   results = await searchCleveland(query, limit);
  else if (source === "wikimedia")   results = await searchWikimedia(query, limit);
  else if (source === "rijksmuseum") results = await searchRijksmuseum(query, limit);
  else {
    // "all" — fan out to all sources in parallel
    const settled = await Promise.allSettled([
      searchMet(query, limit),
      searchChicago(query, limit),
      searchCleveland(query, limit),
      searchWikimedia(query, limit),
      searchRijksmuseum(query, limit),
    ]);
    results = settled
      .filter((r) => r.status === "fulfilled")
      .flatMap((r) => r.value);
  }

  return results.sort((a, b) => relevanceScore(b, query) - relevanceScore(a, query));
}

/**
 * Fetch a single artwork by source and ID.
 */
export async function getPublicArtwork(source, id) {
  if (source === "met")         return getMetArtwork(id);
  if (source === "chicago")     return getChicagoArtwork(id);
  if (source === "cleveland")   return getClevelandArtwork(id);
  if (source === "wikimedia")   return getWikimediaArtwork(id);
  if (source === "rijksmuseum") return getRijksmuseumArtwork(id);
  return null;
}

/**
 * Lightweight "More Public Domain Art" recommendations for the detail page.
 * Reuses the existing per-source search (querying by artist name) rather than
 * adding a new external integration or a heavy similarity system, then ranks
 * candidates by shared metadata. Falls back to the curated featured pool
 * (already cached) when the artist search doesn't return enough results.
 */
export async function getRelatedArtworks(source, id, limit = 7) {
  const base = await getPublicArtwork(source, id);
  if (!base) return [];

  const candidates = new Map(); // id -> artwork, de-duplicated, excludes base

  const addAll = (list) => {
    for (const a of list || []) {
      if (!a || !a.id || a.id === base.id) continue;
      if (!candidates.has(a.id)) candidates.set(a.id, a);
    }
  };

  if (base.artist && base.artist !== "Unknown Artist") {
    try {
      addAll(await searchPublicArt(base.artist, source, limit * 2));
    } catch {
      // external API hiccup — fall through to the featured pool below
    }
  }

  if (candidates.size < limit) {
    try {
      addAll(await getFeaturedArtworks());
    } catch {
      // ignore — worst case the sidebar shows fewer items
    }
  }

  const score = (a) => {
    let s = 0;
    if (a.artist && base.artist && a.artist === base.artist) s += 40;
    if (a.institution && base.institution && a.institution === base.institution) s += 20;
    if (a.department && base.department && a.department === base.department) s += 15;
    if (a.culture && base.culture && a.culture === base.culture) s += 15;
    if (a.period && base.period && a.period === base.period) s += 15;
    if (a.classification && base.classification && a.classification === base.classification) s += 15;
    if (a.medium && base.medium && a.medium === base.medium) s += 10;
    return s;
  };

  return [...candidates.values()]
    .filter((a) => a.imageUrl || a.thumbnailUrl)
    .sort((a, b) => score(b) - score(a))
    .slice(0, limit);
}

const FALLBACK_FEATURED = [
  { source: "met", id: 436535 },
  { source: "met", id: 459123 },
  { source: "met", id: 437984 },
  { source: "chicago", id: 27992 },
  { source: "chicago", id: 14655 },
  { source: "chicago", id: 28560 },
];

/**
 * Featured artworks — reads full artwork objects directly from DB.
 * Falls back to fetching hardcoded defaults from external APIs only if DB is empty.
 *
 * DB-stored records were saved verbatim by the admin panel and may predate
 * the field-cleaning fix in the normalizers above, so every record — DB or
 * fallback — is passed through sanitizeArtworkRecord before being cached and
 * returned. The stored Mongo document itself is never modified.
 */
export async function getFeaturedArtworks() {
  const cacheKey = "featured";
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const FeaturedPublicArt = (await import("../models/featuredPublicArt.js")).default;
    const doc = await FeaturedPublicArt.findOne({ key: "default" }).lean();

    if (doc && doc.artworks.length > 0) {
      const cleaned = doc.artworks.map(sanitizeArtworkRecord);
      cacheSet(cacheKey, cleaned);
      return cleaned;
    }
  } catch {
    // fall through to hardcoded defaults
  }

  // No DB list yet — fetch hardcoded defaults from external APIs
  const results = await Promise.allSettled(
    FALLBACK_FEATURED.map(({ source, id }) => getPublicArtwork(source, String(id)))
  );

  const artworks = results
    .filter((r) => r.status === "fulfilled" && r.value)
    .map((r) => sanitizeArtworkRecord(r.value));

  cacheSet(cacheKey, artworks);
  return artworks;
}

/**
 * Save the full curated artwork objects to DB and bust the featured cache.
 * The admin panel sends complete artwork objects so we never need to re-fetch.
 */
export async function saveFeaturedArtworks(artworks, updatedBy) {
  const FeaturedPublicArt = (await import("../models/featuredPublicArt.js")).default;
  const cleaned = (artworks || []).map(sanitizeArtworkRecord);
  await FeaturedPublicArt.findOneAndUpdate(
    { key: "default" },
    { artworks: cleaned, updatedBy },
    { upsert: true, new: true }
  );
  cache.delete("featured");
}
