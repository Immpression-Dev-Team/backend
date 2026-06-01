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

// ─── Normalizers ────────────────────────────────────────────────────────────

function normalizeMet(obj) {
  return {
    id: `met:${obj.objectID}`,
    source: "met",
    title: obj.title || "Untitled",
    artist: obj.artistDisplayName || "Unknown Artist",
    year: obj.objectDate || null,
    medium: obj.medium || null,
    dimensions: obj.dimensions || null,
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
    title: obj.title || "Untitled",
    artist: obj.artist_display || obj.artist_title || "Unknown Artist",
    year: obj.date_display || null,
    medium: obj.medium_display || null,
    dimensions: obj.dimensions || null,
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
    title: obj.title || "Untitled",
    artist: obj.creators?.map((c) => c.description).join(", ") || "Unknown Artist",
    year: obj.creation_date || null,
    medium: obj.technique || null,
    dimensions: obj.measurements || null,
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

  const stripHtml = (s) => (s || "").replace(/<[^>]*>/g, "").trim();

  return {
    id: `wikimedia:${page.pageid}`,
    source: "wikimedia",
    title: stripHtml(meta.ObjectName?.value) ||
      (page.title || "").replace(/^File:/, "").replace(/\.[^/.]+$/, ""),
    artist: stripHtml(meta.Artist?.value) || "Unknown Artist",
    year: stripHtml(meta.DateTimeOriginal?.value || meta.Date?.value) || null,
    medium: stripHtml(meta.Medium?.value) || null,
    dimensions: null,
    imageUrl: info.url,
    thumbnailUrl: info.thumburl || info.url,
    description: stripHtml(meta.ImageDescription?.value) || null,
    department: null,
    creditLine: stripHtml(meta.Credit?.value) || null,
    sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title || "")}`,
  };
}

function normalizeRijksmuseum(obj) {
  return {
    id: `rijksmuseum:${obj.objectNumber}`,
    source: "rijksmuseum",
    title: obj.title || "Untitled",
    artist: obj.principalOrFirstMaker || "Unknown Artist",
    year: obj.dating?.presentingDate || null,
    medium: obj.materials?.join(", ") || null,
    dimensions: null,
    imageUrl: obj.webImage?.url || null,
    thumbnailUrl: obj.webImage?.url || null,
    description: obj.plaqueDescriptionEnglish || null,
    department: obj.productionPlaces?.[0] || null,
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
  "id,title,artist_display,artist_title,date_display,medium_display,dimensions,image_id,description,short_description,department_title,credit_line";

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

async function searchWikimedia(query, limit = 20) {
  const cacheKey = `wikimedia:search:${query}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const res = await axios.get(WIKIMEDIA_API, {
    params: {
      action: "query",
      generator: "search",
      gsrsearch: `${query} painting`,
      gsrnamespace: 6,       // File namespace only
      gsrlimit: Math.min(limit * 2, 40), // Fetch extra since some won't have images
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: 600,
      format: "json",
      formatversion: 2,
      origin: "*",
    },
    timeout: 10000,
  });

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
    params: {
      action: "query",
      pageids: pageId,
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: 600,
      format: "json",
      formatversion: 2,
      origin: "*",
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

const FALLBACK_FEATURED = [
  { source: "met", id: 436535 },
  { source: "met", id: 459123 },
  { source: "met", id: 437984 },
  { source: "chicago", id: 27992 },
  { source: "chicago", id: 14655 },
  { source: "chicago", id: 28560 },
];

/**
 * Featured artworks — reads the admin-curated list from DB.
 * Falls back to hardcoded defaults if no list has been saved yet.
 */
export async function getFeaturedArtworks() {
  const cacheKey = "featured";
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  let refs;
  try {
    const FeaturedPublicArt = (await import("../models/featuredPublicArt.js")).default;
    const doc = await FeaturedPublicArt.findOne({ key: "default" }).lean();
    refs = doc && doc.artworks.length > 0 ? doc.artworks : FALLBACK_FEATURED;
  } catch {
    refs = FALLBACK_FEATURED;
  }

  const results = await Promise.allSettled(
    refs.map(({ source, id }) => getPublicArtwork(source, String(id)))
  );

  const artworks = results
    .filter((r) => r.status === "fulfilled" && r.value)
    .map((r) => r.value);

  cacheSet(cacheKey, artworks);
  return artworks;
}

/**
 * Save the admin-curated list and bust the featured cache.
 */
export async function saveFeaturedArtworks(refs, updatedBy) {
  const FeaturedPublicArt = (await import("../models/featuredPublicArt.js")).default;
  await FeaturedPublicArt.findOneAndUpdate(
    { key: "default" },
    { artworks: refs, updatedBy },
    { upsert: true, new: true }
  );
  cache.delete("featured");
}
