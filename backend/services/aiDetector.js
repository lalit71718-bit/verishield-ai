/**
 * Optional AI-image detection model (Sightengine "genai").
 *
 * Metadata can only catch AI images that still carry it. A detection model
 * looks at the pixels, so it also catches images whose metadata was stripped.
 * It is used only when SIGHTENGINE_API_USER and SIGHTENGINE_API_SECRET are set,
 * because it uploads the image to a third-party service.
 *
 * Returns { score: 0..1, name } or null when disabled or unavailable. It never
 * throws: a failed lookup falls back to metadata-only analysis.
 */
const ENDPOINT = 'https://api.sightengine.com/1.0/check.json';
const MAX_BYTES = 12 * 1024 * 1024;
const TIMEOUT_MS = 15000;

const isEnabled = () => !!(process.env.SIGHTENGINE_API_USER && process.env.SIGHTENGINE_API_SECRET);

async function detectAiImage(buffer, fileName, mimeType) {
  if (!isEnabled() || !buffer || buffer.length > MAX_BYTES) return null;
  if (typeof fetch !== 'function' || typeof FormData !== 'function') {
    console.warn('AI detector skipped: this Node.js version has no built-in fetch (18+ required).');
    return null;
  }

  try {
    const form = new FormData();
    form.append('media', new Blob([buffer], { type: mimeType || 'application/octet-stream' }), fileName || 'image');
    form.append('models', 'genai');
    form.append('api_user', process.env.SIGHTENGINE_API_USER);
    form.append('api_secret', process.env.SIGHTENGINE_API_SECRET);

    const res = await fetch(ENDPOINT, { method: 'POST', body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const data = await res.json();
    const score = data && data.type ? Number(data.type.ai_generated) : NaN;

    if (!res.ok || data.status !== 'success' || !Number.isFinite(score)) {
      const reason = (data && data.error && data.error.message) || `HTTP ${res.status}`;
      console.warn(`AI detector returned no score (${reason}); using metadata analysis only.`);
      return null;
    }
    return { score: Math.max(0, Math.min(1, score)), name: 'Sightengine' };
  } catch (err) {
    console.warn(`AI detector unavailable (${err.message}); using metadata analysis only.`);
    return null;
  }
}

module.exports = { detectAiImage, isEnabled };
