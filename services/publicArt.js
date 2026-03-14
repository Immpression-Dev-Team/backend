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
    sourceUrl: obj.id
      ? `https://www.artic.edu/artworks/${obj.id}`
      : null,
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

  const results = artworks.filter(
    (a) => a !== null && a.imageUrl
  );

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
    },
    timeout: 8000,
  });

  const results = (res.data.data || [])
    .map(normalizeChicago)
    .filter((a) => a.imageUrl);

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

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Search across one or both sources.
 * @param {string} query
 * @param {"met"|"chicago"|"all"} source
 * @param {number} limit  per-source limit
 */
export async function searchPublicArt(query, source = "all", limit = 20) {
  if (source === "met") return searchMet(query, limit);
  if (source === "chicago") return searchChicago(query, limit);

  // Fan out to both, merge, filter nulls
  const [metResults, chicagoResults] = await Promise.allSettled([
    searchMet(query, limit),
    searchChicago(query, limit),
  ]);

  return [
    ...(metResults.status === "fulfilled" ? metResults.value : []),
    ...(chicagoResults.status === "fulfilled" ? chicagoResults.value : []),
  ];
}

/**
 * Fetch a single artwork by source and original ID.
 * @param {"met"|"chicago"} source
 * @param {string|number} id
 */
export async function getPublicArtwork(source, id) {
  if (source === "met") return getMetArtwork(id);
  if (source === "chicago") return getChicagoArtwork(id);
  return null;
}

/**
 * Featured artworks — a curated set of well-known public domain works.
 * IDs are hardcoded to avoid an extra round-trip on first load.
 */
export async function getFeaturedArtworks() {
  const cacheKey = "featured";
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const featured = [
    { source: "met", id: 436535 },   // Monet - La Grenouillère
    { source: "met", id: 459123 },   // Van Gogh - Wheat Field with Cypresses
    { source: "met", id: 437984 },   // Degas - The Dance Class
    { source: "chicago", id: 27992 }, // Seurat - A Sunday on La Grande Jatte
    { source: "chicago", id: 14655 }, // El Greco - The Assumption of the Virgin
    { source: "chicago", id: 28560 }, // Rembrandt - Old Man with a Gold Chain
  ];

  const results = await Promise.allSettled(
    featured.map(({ source, id }) => getPublicArtwork(source, id))
  );

  const artworks = results
    .filter((r) => r.status === "fulfilled" && r.value)
    .map((r) => r.value);

  cacheSet(cacheKey, artworks);
  return artworks;
}
