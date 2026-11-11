/**
 * Image provenance analysis.
 *
 * Reads the container (PNG / JPEG / WebP) and its metadata instead of searching
 * the raw bytes, then classifies the image into one of four kinds:
 *
 *   ai            metadata names an AI generator, or a detection model scored it high
 *   edited        metadata names an image editor
 *   camera        EXIF describes a camera capture and nothing contradicts it
 *   inconclusive  no provenance at all: it cannot be called authentic or synthetic
 *
 * An image with no metadata is never reported as authentic. Stripped metadata is
 * the normal state of AI images that were downloaded, screenshotted or forwarded.
 */
const zlib = require('zlib');

/* ---------- Known tools ---------- */

// Matched against metadata text only, with word boundaries.
const AI_GENERATORS = [
  [/\b(openai|chatgpt|gpt-?4o|gpt-image|dall[-·. ]?e|sora)\b/i, 'OpenAI (ChatGPT / DALL·E)'],
  [/\b(made with google ai|google ai|imagen ?\d|gemini|synthid|nano banana)\b/i, 'Google AI (Gemini / Imagen)'],
  [/\b(adobe firefly|firefly)\b/i, 'Adobe Firefly'],
  [/\bmidjourney\b/i, 'Midjourney'],
  [/\b(stable diffusion|stability\.?ai|sdxl|automatic1111|comfyui|invokeai|novelai|fooocus|dreamstudio)\b/i, 'Stable Diffusion'],
  [/\b(bing image creator|microsoft designer|image creator from designer)\b/i, 'Microsoft Designer / Bing Image Creator'],
  [/\b(meta ai|imagined with ai|made with ai)\b/i, 'Meta AI'],
  [/\b(grok|black forest labs|flux\.1|ideogram|leonardo\.?ai|runwayml|recraft|playground ai)\b/i, 'AI image generator'],
  [/\b(trainedalgorithmicmedia|compositewithtrainedalgorithmicmedia)\b/i, 'IPTC digital source type: AI-generated'],
  [/\bsteps: \d+, sampler\b/i, 'Stable Diffusion generation parameters'],
  [/\b(deepfake|faceswap|face swap|deepfacelab)\b/i, 'Face-swap tool']
];

const EDITORS = [
  [/\bphotoshop\b/i, 'Adobe Photoshop'],
  [/\blightroom\b/i, 'Adobe Lightroom'],
  [/\bgimp\b/i, 'GIMP'],
  [/\bcanva\b/i, 'Canva'],
  [/\b(pixlr|photopea|paint\.net|coreldraw|affinity photo|pixelmator)\b/i, 'Image editor'],
  [/\b(snapseed|picsart|facetune|faceapp|remini|meitu)\b/i, 'Mobile retouching app']
];

// Output sizes that AI generators produce by default and cameras do not.
const GENERATOR_SIZES = new Set([
  '512x512', '768x768', '512x768', '768x512',
  '1024x1024', '2048x2048', '4096x4096',
  '1024x1536', '1536x1024', '1024x1792', '1792x1024',
  '1344x768', '768x1344', '1152x896', '896x1152', '1216x832', '832x1216', '1536x640', '640x1536',
  '1408x768', '768x1408', '1280x896', '896x1280',
  '1456x816', '816x1456', '1232x928', '928x1232', '1344x896', '896x1344',
  '1184x864', '864x1184', '1248x832', '832x1248', '1536x672', '672x1536'
]);

/* ---------- Helpers ---------- */

/** Printable runs from a binary block, like `strings`, with long base64 blobs dropped. */
function printable(buf) {
  if (!buf || !buf.length) return '';
  return buf
    .toString('latin1')
    .replace(/\0/g, '') // collapses UTF-16 text to ASCII
    .replace(/[^\x20-\x7E]+/g, ' ')
    .replace(/[A-Za-z0-9+/=]{60,}/g, ' ');
}

function matchAll(list, text) {
  const found = [];
  for (const [pattern, label] of list) {
    if (pattern.test(text) && !found.includes(label)) found.push(label);
  }
  return found;
}

/* ---------- EXIF (TIFF) ---------- */

function parseExif(tiff) {
  const out = { text: '' };
  if (!tiff || tiff.length < 8) return out;
  const le = tiff.toString('latin1', 0, 2) === 'II';
  if (!le && tiff.toString('latin1', 0, 2) !== 'MM') return out;
  const u16 = (o) => (o + 2 <= tiff.length ? (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o)) : 0);
  const u32 = (o) => (o + 4 <= tiff.length ? (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o)) : 0);

  const readIfd = (offset, handlers) => {
    if (!offset || offset + 2 > tiff.length) return;
    const count = Math.min(u16(offset), 512);
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12;
      if (entry + 12 > tiff.length) return;
      const tag = u16(entry);
      const type = u16(entry + 2);
      const n = u32(entry + 4);
      const handler = handlers[tag];
      if (!handler) continue;
      if (handler === 'pointer') { out[`ifd_${tag}`] = u32(entry + 8); continue; }
      if (handler.present) { out[handler.present] = true; continue; }
      // ASCII (2) or UNDEFINED (7, used by UserComment)
      if (type !== 2 && type !== 7) continue;
      const len = Math.min(n, 4096);
      const start = len <= 4 ? entry + 8 : u32(entry + 8);
      if (start + len > tiff.length) continue;
      const value = printable(tiff.subarray(start, start + len)).trim();
      if (value) {
        out[handler.name] = value;
        out.text += ` ${value}`;
      }
    }
  };

  readIfd(u32(4), {
    0x010e: { name: 'description' },
    0x010f: { name: 'make' },
    0x0110: { name: 'model' },
    0x0131: { name: 'software' },
    0x013b: { name: 'artist' },
    0x8769: 'pointer'
  });
  readIfd(out.ifd_34665, {
    0x9003: { name: 'dateTimeOriginal' },
    0xa434: { name: 'lensModel' },
    0x9286: { name: 'userComment' },
    0x829a: { present: 'hasExposure' },
    0x829d: { present: 'hasExposure' },
    0x8827: { present: 'hasExposure' },
    0x920a: { present: 'hasExposure' }
  });
  return out;
}

/* ---------- Containers ---------- */

function parsePng(buf, info) {
  info.format = 'PNG';
  let pos = 8;
  while (pos + 12 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, Math.min(pos + 8 + length, buf.length));

    if (type === 'IHDR' && data.length >= 8) {
      info.width = data.readUInt32BE(0);
      info.height = data.readUInt32BE(4);
    } else if (type === 'tEXt') {
      info.text += ` ${printable(data)}`;
      info.hasTextMetadata = true;
    } else if (type === 'zTXt' || type === 'iTXt') {
      info.hasTextMetadata = true;
      info.text += ` ${printable(data)}`;
      // Compressed payload follows the keyword (and, for iTXt, three more fields).
      const zStart = data.indexOf(0x78, data.indexOf(0) + 1);
      if (zStart > 0) {
        try { info.text += ` ${printable(zlib.inflateSync(data.subarray(zStart)))}`; } catch (e) { /* not compressed */ }
      }
    } else if (type === 'eXIf') {
      info.exif = parseExif(data);
    } else if (type === 'caBX') {
      info.hasC2pa = true;
      info.text += ` ${printable(data)}`;
    } else if (type === 'IDAT' || type === 'IEND') {
      break; // metadata chunks that matter come before the pixel data
    }
    pos += 12 + length;
  }
}

function parseJpeg(buf, info) {
  info.format = 'JPEG';
  let pos = 2;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) { pos++; continue; }
    const marker = buf[pos + 1];
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    if (marker === 0xff || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
    const length = buf.readUInt16BE(pos + 2);
    if (length < 2) break;
    const data = buf.subarray(pos + 4, Math.min(pos + 2 + length, buf.length));

    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc && data.length >= 5) {
      info.height = data.readUInt16BE(1);
      info.width = data.readUInt16BE(3);
    } else if (marker === 0xe1) {
      if (data.toString('latin1', 0, 4) === 'Exif') info.exif = parseExif(data.subarray(6));
      else { info.hasXmp = true; info.text += ` ${printable(data)}`; }
    } else if (marker === 0xeb) {
      const head = data.toString('latin1', 0, 64);
      if (head.includes('JP') || head.includes('jumb') || head.includes('c2pa')) info.hasC2pa = true;
      info.text += ` ${printable(data)}`;
    } else if (marker === 0xed || marker === 0xfe) {
      info.text += ` ${printable(data)}`; // IPTC / comment
    }
    pos += 2 + length;
  }
}

function parseWebp(buf, info) {
  info.format = 'WebP';
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const type = buf.toString('latin1', pos, pos + 4);
    const length = buf.readUInt32LE(pos + 4);
    const data = buf.subarray(pos + 8, Math.min(pos + 8 + length, buf.length));
    if (type === 'VP8X' && data.length >= 10) {
      info.width = 1 + data.readUIntLE(4, 3);
      info.height = 1 + data.readUIntLE(7, 3);
    } else if (type === 'VP8 ' && data.length >= 10 && !info.width) {
      info.width = data.readUInt16LE(6) & 0x3fff;
      info.height = data.readUInt16LE(8) & 0x3fff;
    } else if (type === 'VP8L' && data.length >= 5 && !info.width) {
      const bits = data.readUInt32LE(1);
      info.width = 1 + (bits & 0x3fff);
      info.height = 1 + ((bits >> 14) & 0x3fff);
    } else if (type === 'EXIF') {
      info.exif = parseExif(data.toString('latin1', 0, 4) === 'Exif' ? data.subarray(6) : data);
    } else if (type === 'XMP ') {
      info.hasXmp = true;
      info.text += ` ${printable(data)}`;
    }
    pos += 8 + length + (length % 2);
  }
}

function readContainer(buf) {
  const info = { format: null, width: 0, height: 0, text: '', exif: null, hasC2pa: false, hasXmp: false, hasTextMetadata: false };
  try {
    if (buf.length > 8 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') parsePng(buf, info);
    else if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) parseJpeg(buf, info);
    else if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') parseWebp(buf, info);
  } catch (e) {
    info.parseError = true; // truncated or malformed file: keep whatever was read
  }
  if (info.exif) info.text += ` ${info.exif.text}`;
  return info;
}

/* ---------- Classification ---------- */

/**
 * @param {Buffer} buffer        image bytes
 * @param {object} [options]
 * @param {number} [options.detectorScore]  0..1 from an external AI-image detection model
 * @param {string} [options.detectorName]
 */
function analyzeImage(buffer, options = {}) {
  const info = readContainer(buffer);
  const exif = info.exif || {};
  const size = info.width && info.height ? `${info.width}x${info.height}` : null;
  const sizeLabel = size ? `${info.width} × ${info.height}` : 'unknown size';

  const generators = matchAll(AI_GENERATORS, info.text);
  const editors = matchAll(EDITORS, info.text);
  const hasCamera = !!(exif.make && exif.model);
  const hasProvenance = hasCamera || info.hasC2pa || info.hasXmp || info.hasTextMetadata || !!exif.software;
  const generatorSize = !!size && GENERATOR_SIZES.has(size);
  const detector = typeof options.detectorScore === 'number' ? Math.round(options.detectorScore * 100) : null;

  const anomalies = [];
  const markers = [];
  let kind;
  let aiProbability;
  let harmRiskScore;

  if (info.format) markers.push(`${info.format} container parsed (${sizeLabel})`);
  else anomalies.push('File is not a recognised PNG, JPEG or WebP image');

  if (detector !== null) {
    const line = `AI-image detection model (${options.detectorName || 'external'}) score: ${detector}% likely AI-generated`;
    (detector >= 50 ? anomalies : markers).push(line);
  }

  if (generators.length) {
    kind = 'ai';
    aiProbability = Math.max(96, detector || 0);
    harmRiskScore = 80;
    anomalies.unshift(`AI generator named in image metadata: ${generators.join(', ')}`);
    if (info.hasC2pa) anomalies.push('Content Credentials (C2PA) manifest is embedded in the file');
  } else if (detector !== null && detector >= 60) {
    kind = 'ai';
    aiProbability = detector;
    harmRiskScore = Math.min(90, 40 + Math.round(detector / 2));
    if (!hasCamera) anomalies.push('No camera capture metadata (EXIF make / model) in the file');
  } else if (editors.length) {
    kind = 'edited';
    aiProbability = Math.max(70, detector || 0);
    harmRiskScore = 66;
    anomalies.unshift(`Image editor named in metadata: ${editors.join(', ')}`);
    anomalies.push('The file was saved by editing software after capture, so its content may have been altered');
  } else if (hasCamera) {
    kind = 'camera';
    aiProbability = detector !== null ? Math.max(5, detector) : 8;
    harmRiskScore = 6;
    markers.push(`Camera capture metadata present: ${exif.make} ${exif.model}`);
    if (exif.dateTimeOriginal) markers.push(`Capture time recorded: ${exif.dateTimeOriginal}`);
    if (exif.hasExposure) markers.push('Exposure settings recorded (shutter, aperture or ISO)');
    markers.push('No AI generator or editing software named in metadata');
  } else if (detector !== null) {
    // The model looked at the pixels and scored it low; metadata has nothing to add.
    kind = detector >= 35 ? 'inconclusive' : 'camera';
    aiProbability = Math.max(3, detector);
    harmRiskScore = kind === 'inconclusive' ? 35 : 10;
    markers.push('No AI generator or editing software named in metadata');
  } else if (generatorSize && !hasProvenance) {
    kind = 'ai';
    aiProbability = info.format === 'PNG' ? 78 : 74;
    harmRiskScore = 62;
    anomalies.push(`Dimensions ${sizeLabel} match a standard AI-generator output size`);
    anomalies.push('No camera capture metadata (EXIF make / model) in the file');
    anomalies.push('No provenance metadata of any kind, which is typical of downloaded or forwarded AI images');
  } else {
    kind = 'inconclusive';
    aiProbability = generatorSize ? 55 : 45;
    harmRiskScore = 35;
    anomalies.push('No camera capture metadata (EXIF make / model) in the file');
    if (!hasProvenance) anomalies.push('No provenance metadata of any kind: the origin of this image cannot be established');
    if (generatorSize) anomalies.push(`Dimensions ${sizeLabel} match a standard AI-generator output size`);
    anomalies.push('Metadata alone cannot tell a stripped photo from an AI image; a detection model is needed to decide');
  }

  if (info.parseError) anomalies.push('File structure is truncated or malformed');

  return {
    kind,
    aiProbability,
    harmRiskScore,
    anomalies,
    markers,
    format: info.format,
    width: info.width,
    height: info.height,
    generators,
    editors,
    hasCamera,
    hasC2pa: info.hasC2pa,
    detectorScore: detector
  };
}

module.exports = { analyzeImage };
