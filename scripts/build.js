const fs = require('fs');
const path = require('path');
const exifr = require('exifr');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const IMG_DIR = path.join(PUBLIC_DIR, 'img');
const SITE_DIR = path.join(PUBLIC_DIR, 'birdopedia');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const EBIRD_PATH = path.join(ROOT, 'data', 'ebird.json');
const WIKIPEDIA_PATH = path.join(ROOT, 'data', 'wikipedia.json');
const GEOCODE_PATH = path.join(ROOT, 'data', 'geocode.json');

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

const config = readJson(CONFIG_PATH, {
  authorName: 'Your Name',
  authorLocation: '',
  authorBio: '',
  siteLede: 'A growing field guide built from days in the field.',
  ebirdProfileUrl: ''
});
const ebird = readJson(EBIRD_PATH, { species: {}, source: { name: 'eBird', url: 'https://ebird.org' } });
const wikidata = readJson(path.join(ROOT, 'data', 'wikidata.json'), { species: {}, source: { name: 'Wikidata', url: 'https://query.wikidata.org/' } });
const wikipedia = readJson(WIKIPEDIA_PATH, {
  species: {},
  source: {
    name: 'Wikipedia',
    url: 'https://en.wikipedia.org',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/'
  }
});
const geocodeCache = readJson(GEOCODE_PATH, {
  points: {},
  source: { name: 'Nominatim', url: 'https://nominatim.openstreetmap.org/' },
  updatedAt: null
});

function toWebPath(...parts) {
  return parts
    .map((part) => encodeURIComponent(String(part)).replace(/'/g, '%27'))
    .join('/');
}

function listBirds() {
  if (!fs.existsSync(IMG_DIR)) {
    return [];
  }
  return fs
    .readdirSync(IMG_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function listImages(birdDir) {
  const fullPath = path.join(IMG_DIR, birdDir);
  return fs
    .readdirSync(fullPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.(jpe?g|png|webp)$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
}

function avifTargetPath(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  if (ext !== '.jpg' && ext !== '.jpeg') {
    return null;
  }
  const base = imagePath.slice(0, -ext.length);
  return `${base}.avif`;
}

function thumbTargetPath(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  const base = imagePath.slice(0, -ext.length);
  return `${base}.thumb.avif`;
}

function needsAvifVariant(imagePath) {
  const target = avifTargetPath(imagePath);
  if (!target) {
    return false;
  }
  if (!fs.existsSync(target)) {
    return true;
  }
  const targetStat = fs.statSync(target);
  return targetStat.size === 0;
}

function needsThumbVariant(imagePath) {
  const target = thumbTargetPath(imagePath);
  if (!target) {
    return false;
  }
  if (!fs.existsSync(target)) {
    return true;
  }
  const targetStat = fs.statSync(target);
  return targetStat.size === 0;
}

async function ensureAvifVariant(imagePath) {
  const target = avifTargetPath(imagePath);
  if (!target) {
    return false;
  }
  try {
    if (fs.existsSync(target)) {
      const targetStat = fs.statSync(target);
      if (targetStat.size === 0) {
        console.warn(`AVIF: zero-byte file found, regenerating ${path.basename(target)}`);
      } else {
        return false;
      }
    }
    await sharp(imagePath)
      .avif({ quality: 60, effort: 4 })
      .toFile(target);
    const outputStat = fs.statSync(target);
    if (outputStat.size === 0) {
      console.warn(`AVIF: generated zero-byte file for ${path.basename(target)}`);
    }
    return true;
  } catch (error) {
    console.warn(`AVIF: failed to generate for ${imagePath}.`, error.message || error);
    return false;
  }
}

async function ensureThumbVariant(imagePath) {
  const target = thumbTargetPath(imagePath);
  if (!target) {
    return false;
  }
  try {
    if (fs.existsSync(target)) {
      const targetStat = fs.statSync(target);
      if (targetStat.size === 0) {
        console.warn(`Thumb: zero-byte file found, regenerating ${path.basename(target)}`);
      } else {
        return false;
      }
    }
    await sharp(imagePath)
      .resize({ width: 720, withoutEnlargement: true })
      .avif({ quality: 45, effort: 4 })
      .toFile(target);
    const outputStat = fs.statSync(target);
    if (outputStat.size === 0) {
      console.warn(`Thumb: generated zero-byte file for ${path.basename(target)}`);
    }
    return true;
  } catch (error) {
    console.warn(`Thumb: failed to generate for ${imagePath}.`, error.message || error);
    return false;
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return 'Unknown';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function isThreeTwo(width, height, tolerance = 0.02) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || height === 0) {
    return true;
  }
  const ratio = width / height;
  const target = 3 / 2;
  return Math.abs(ratio - target) <= tolerance;
}

function normalizeExifDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  let iso = value;
  if (/^\d{4}:\d{2}:\d{2}/.test(value)) {
    iso = value.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
  }
  if (iso.includes(' ')) {
    iso = iso.replace(' ', 'T');
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function formatDate(value) {
  const date = normalizeExifDate(value);
  if (!date) {
    return 'Unknown';
  }
  return formatDisplayDate(date);
}

function formatDisplayDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date);
}

function formatDisplayTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC'
  }).format(date);
}

function toLocalDayKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDisplayDateLocal(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: '2-digit',
    year: 'numeric'
  }).format(date);
}

function formatDisplayTimeLocal(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function formatDurationMinutes(totalMinutes) {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
    return '0m';
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) {
    return `${minutes}m`;
  }
  if (!minutes) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

function createTripsFromMapPoints(
  mapPoints,
  clusterRadiusKm = 30,
  dayExtraCaptures = new Map(),
  firstSeenDayBySpecies = {}
) {
  const normalizeLocationToken = (value) =>
    String(value || '')
      .replace(/[’‘`]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  const labelQuality = (value) => {
    const text = String(value || '');
    const upperCount = (text.match(/[A-Z]/g) || []).length;
    return upperCount * 10 + text.length;
  };
  const isGenericAdmin = (value) => {
    const token = normalizeLocationToken(value);
    return (
      token.startsWith('town of ') ||
      token.startsWith('city of ') ||
      token.endsWith(' county') ||
      token.endsWith(' township')
    );
  };
  const TITLE_APPEND_DISTANCE_MILES = 3;
  const KM_PER_MILE = 1.609344;

  const byDay = new Map();
  mapPoints.forEach((point) => {
    const captureDateObj = normalizeExifDate(point.captureDateIso);
    if (!captureDateObj) {
      return;
    }
    const dayKey = toLocalDayKey(captureDateObj);
    if (!dayKey) {
      return;
    }
    if (!byDay.has(dayKey)) {
      byDay.set(dayKey, []);
    }
    byDay.get(dayKey).push({ ...point, captureDateObj, dayKey });
  });

  const trips = [];

  Array.from(byDay.entries()).forEach(([dayKey, points]) => {
    points.sort((a, b) => a.captureDateObj - b.captureDateObj);
    const visited = new Array(points.length).fill(false);

    for (let i = 0; i < points.length; i += 1) {
      if (visited[i]) {
        continue;
      }
      const queue = [i];
      visited[i] = true;
      const component = [];

      while (queue.length) {
        const index = queue.pop();
        component.push(index);
        for (let j = 0; j < points.length; j += 1) {
          if (visited[j]) {
            continue;
          }
          const distance = haversineKm(points[index].lat, points[index].lon, points[j].lat, points[j].lon);
          if (distance <= clusterRadiusKm) {
            visited[j] = true;
            queue.push(j);
          }
        }
      }

      const geoCaptures = component.map((index) => points[index]).sort((a, b) => a.captureDateObj - b.captureDateObj);
      const centroid = geoCaptures.reduce(
        (acc, capture) => {
          acc.lat += capture.lat;
          acc.lon += capture.lon;
          return acc;
        },
        { lat: 0, lon: 0 }
      );
      centroid.lat /= geoCaptures.length;
      centroid.lon /= geoCaptures.length;

      const maxSpreadKm = geoCaptures.reduce((max, capture) => {
        const distance = haversineKm(centroid.lat, centroid.lon, capture.lat, capture.lon);
        return Math.max(max, distance);
      }, 0);

      const captures = geoCaptures.slice();
      const extraCaptures = dayExtraCaptures.get(dayKey) || [];
      const seenCaptureKeys = new Set(captures.map((capture) => `${capture.bird}::${capture.filename}`));
      extraCaptures.forEach((capture) => {
        const key = `${capture.bird}::${capture.filename}`;
        if (seenCaptureKeys.has(key)) {
          return;
        }
        const captureDateObj = normalizeExifDate(capture.captureDateIso);
        captures.push({ ...capture, captureDateObj, dayKey });
        seenCaptureKeys.add(key);
      });
      captures.sort((a, b) => a.captureDateObj - b.captureDateObj);

      const species = Array.from(new Set(captures.map((capture) => capture.bird))).sort((a, b) =>
        a.localeCompare(b, 'en', { sensitivity: 'base' })
      );
      const parkLabelsByKey = new Map();
      geoCaptures.forEach((capture) => {
        const value = (capture.park || capture.site || '').trim();
        const key = normalizeLocationToken(value);
        if (!value || !key) {
          return;
        }
        const existing = parkLabelsByKey.get(key);
        if (!existing || labelQuality(value) > labelQuality(existing)) {
          parkLabelsByKey.set(key, value);
        }
      });
      const parkEntries = Array.from(parkLabelsByKey.values()).map((label) => {
        const normalized = normalizeLocationToken(label);
        const matches = geoCaptures.filter(
          (capture) => normalizeLocationToken(capture.park || capture.site || '') === normalized
        );
        const centroid = matches.reduce(
          (acc, capture) => {
            acc.lat += capture.lat;
            acc.lon += capture.lon;
            return acc;
          },
          { lat: 0, lon: 0 }
        );
        centroid.lat /= matches.length || 1;
        centroid.lon /= matches.length || 1;
        return {
          label,
          normalized,
          count: matches.length,
          centroid
        };
      });
      parkEntries.sort((a, b) => b.count - a.count || labelQuality(b.label) - labelQuality(a.label));

      const parks = [];
      const selectedParkCentroids = [];
      parkEntries.forEach((entry) => {
        if (parks.length < 2) {
          parks.push(entry.label);
          selectedParkCentroids.push(entry.centroid);
          return;
        }
        const minMiles = selectedParkCentroids.reduce((min, center) => {
          const miles = haversineKm(entry.centroid.lat, entry.centroid.lon, center.lat, center.lon) / KM_PER_MILE;
          return Math.min(min, miles);
        }, Number.POSITIVE_INFINITY);
        if (minMiles >= TITLE_APPEND_DISTANCE_MILES) {
          parks.push(entry.label);
          selectedParkCentroids.push(entry.centroid);
        }
      });
      const cities = [];
      geoCaptures.forEach((capture) => {
        const value = (capture.city || '').trim();
        if (value && !cities.includes(value)) {
          cities.push(value);
        }
      });
      const cityEntriesByKey = new Map();
      geoCaptures.forEach((capture) => {
        const label = (capture.city || '').trim();
        const key = normalizeLocationToken(label);
        if (!label || !key || isGenericAdmin(label)) {
          return;
        }
        const current = cityEntriesByKey.get(key) || { label, points: [] };
        current.points.push(capture);
        if (labelQuality(label) > labelQuality(current.label)) {
          current.label = label;
        }
        cityEntriesByKey.set(key, current);
      });
      const cityEntries = Array.from(cityEntriesByKey.values()).map((entry) => {
        const centroid = entry.points.reduce(
          (acc, point) => {
            acc.lat += point.lat;
            acc.lon += point.lon;
            return acc;
          },
          { lat: 0, lon: 0 }
        );
        centroid.lat /= entry.points.length || 1;
        centroid.lon /= entry.points.length || 1;
        return {
          label: entry.label,
          normalized: normalizeLocationToken(entry.label),
          centroid,
          count: entry.points.length
        };
      });
      cityEntries.sort((a, b) => b.count - a.count || labelQuality(b.label) - labelQuality(a.label));
      const locations = Array.from(
        new Set(
          geoCaptures.map((capture) => {
            if (capture.locationLabel) {
              return capture.locationLabel;
            }
            const parts = [capture.city, capture.state, capture.country].filter(Boolean);
            return parts.join(', ') || `${capture.lat.toFixed(3)}, ${capture.lon.toFixed(3)}`;
          })
        )
      );

      const firstCapture = captures[0];
      const lastCapture = captures[captures.length - 1];
      const durationMinutes = Math.max(0, Math.round((lastCapture.captureDateObj - firstCapture.captureDateObj) / 60000));
      const durationLabel = formatDurationMinutes(durationMinutes);
      const dateLabel = formatDisplayDateLocal(firstCapture.captureDateObj);
      const timeRange = `${formatDisplayTimeLocal(firstCapture.captureDateObj)} - ${formatDisplayTimeLocal(lastCapture.captureDateObj)} local`;
      const speciesCounts = captures.reduce((acc, capture) => {
        acc[capture.bird] = (acc[capture.bird] || 0) + 1;
        return acc;
      }, {});
      const topSpeciesEntry = Object.entries(speciesCounts).sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en', { sensitivity: 'base' })
      )[0];
      const topSpeciesLabel = topSpeciesEntry ? `${topSpeciesEntry[0]} (${topSpeciesEntry[1]})` : 'Unknown';
      const newSpecies = species.filter((name) => firstSeenDayBySpecies[name] === dayKey);
      const hasNewSpecies = newSpecies.length > 0;
      const newSpeciesLabel = hasNewSpecies ? newSpecies.join(', ') : 'None';
      const countByValue = (items) =>
        items.reduce((acc, value) => {
          acc[value] = (acc[value] || 0) + 1;
          return acc;
        }, {});
      const topValue = (items) => {
        const entries = Object.entries(countByValue(items));
        const top = entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en', { sensitivity: 'base' }))[0];
        return top ? top[0] : null;
      };
      const cameraItems = captures.map((capture) => capture.camera).filter((value) => value && value !== 'Unknown');
      const lensItems = captures.map((capture) => capture.lens).filter((value) => value && value !== 'Unknown');
      const primaryCamera = topValue(cameraItems) || 'Unknown camera';
      const primaryLens = topValue(lensItems) || 'Unknown lens';
      const gearLabel = `${primaryCamera} + ${primaryLens}`;
      const titleLabels = parks.slice();
      const titleCenters = selectedParkCentroids.slice();
      if (titleLabels.length) {
        cityEntries.forEach((entry) => {
          if (titleLabels.length >= 4) {
            return;
          }
          if (titleLabels.some((label) => normalizeLocationToken(label) === entry.normalized)) {
            return;
          }
          const minMiles = titleCenters.reduce((min, center) => {
            const miles = haversineKm(entry.centroid.lat, entry.centroid.lon, center.lat, center.lon) / KM_PER_MILE;
            return Math.min(min, miles);
          }, Number.POSITIVE_INFINITY);
          if (minMiles >= TITLE_APPEND_DISTANCE_MILES) {
            titleLabels.push(entry.label);
            titleCenters.push(entry.centroid);
          }
        });
      }

      const preferredTitleLabels = titleLabels.filter((label) => !isGenericAdmin(label));
      const displayTitleLabels = preferredTitleLabels.length ? preferredTitleLabels : titleLabels;
      const locationTitle = displayTitleLabels.length
        ? displayTitleLabels.join(', ')
        : parks.length
        ? parks.slice(0, 2).join(', ')
        : cities.length
          ? cities.slice(0, 2).join(', ')
        : locations[0] || `${centroid.lat.toFixed(3)}, ${centroid.lon.toFixed(3)}`;

      const images = captures.map((capture) => ({
        src: capture.src,
        thumbSrc: capture.thumbSrc || capture.src,
        bird: capture.bird,
        speciesHref: capture.speciesHref,
        filename: capture.filename,
        captureDate: formatDisplayDateLocal(capture.captureDateObj || normalizeExifDate(capture.captureDateIso)),
        captureDateIso: capture.captureDateIso,
        lat: capture.lat,
        lon: capture.lon
      }));

      const coverIndex = images.length - 1;
      const cover = images[coverIndex];

      trips.push({
        id: `${dayKey}-${String(trips.length + 1).padStart(2, '0')}`,
        dayKey,
        locationTitle,
        dateLabel,
        durationLabel,
        timeRange,
        imageCount: images.length,
        speciesCount: species.length,
        topSpeciesLabel,
        hasNewSpecies,
        newSpeciesLabel,
        gearLabel,
        species,
        locations,
        centroid,
        maxSpreadKm,
        images,
        coverIndex,
        cover,
        mapHref: `/birdopedia/map/index.html?species=${encodeURIComponent(cover.bird)}&focus=all&image=${encodeURIComponent(
          cover.filename
        )}`
      });
    }
  });

  trips.sort((a, b) => {
    if (a.dayKey !== b.dayKey) {
      return b.dayKey.localeCompare(a.dayKey);
    }
    return b.imageCount - a.imageCount;
  });

  return trips.map((trip, index) => ({ ...trip, id: `trip-${index + 1}` }));
}

function buildBandingCode(name) {
  if (!name || typeof name !== 'string') {
    return null;
  }

  const words = name
    .replace(/-/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z]/g, ''))
    .filter(Boolean);

  if (words.length === 0) {
    return null;
  }
  if (words.length === 1) {
    return words[0].slice(0, 4).toUpperCase();
  }
  if (words.length === 2) {
    return `${words[0].slice(0, 2)}${words[1].slice(0, 2)}`.toUpperCase();
  }
  if (words.length === 3) {
    return `${words[0][0]}${words[1][0]}${words[2].slice(0, 2)}`.toUpperCase();
  }
  return `${words[0][0]}${words[1][0]}${words[2][0]}${words[3][0]}`.toUpperCase();
}

function formatMassDisplay(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return value;
  }

  if (numeric < 1) {
    const grams = numeric * 1000;
    const rounded = grams >= 100 ? Math.round(grams) : Number(grams.toFixed(1));
    return `${String(rounded).replace(/\.0$/, '')} g`;
  }

  const roundedKg = numeric >= 10 ? Number(numeric.toFixed(1)) : Number(numeric.toFixed(2));
  return `${String(roundedKg).replace(/\.0$/, '')} kg`;
}

function exifToIso(dateValue, offsetValue) {
  if (!dateValue || typeof dateValue !== 'string') {
    return null;
  }
  let base = dateValue;
  if (/^\d{4}:\d{2}:\d{2}/.test(base)) {
    base = base.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
  }
  if (base.includes(' ')) {
    base = base.replace(' ', 'T');
  }
  if (offsetValue && !/[+-]\d{2}:\d{2}$/.test(base)) {
    base = `${base}${offsetValue}`;
  }
  return base;
}

function geocodeKey(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

function formatExposure(value) {
  if (!Number.isFinite(value)) {
    return 'Unknown';
  }
  if (value >= 1) {
    return `${value.toFixed(1)} s`;
  }
  const reciprocal = Math.round(1 / value);
  return `1/${reciprocal} s`;
}

function formatFNumber(value) {
  if (!Number.isFinite(value)) {
    return 'Unknown';
  }
  return `f/${value.toFixed(1).replace(/\.0$/, '')}`;
}

function formatFocalLength(value) {
  if (!Number.isFinite(value)) {
    return 'Unknown';
  }
  return `${Math.round(value)} mm`;
}

function formatGps(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  const fixedLat = lat.toFixed(6);
  const fixedLon = lon.toFixed(6);
  return {
    lat,
    lon,
    display: `${fixedLat}, ${fixedLon}`,
    link: `https://www.openstreetmap.org/?mlat=${fixedLat}&mlon=${fixedLon}#map=12/${fixedLat}/${fixedLon}`
  };
}

async function getExif(imagePath) {
  try {
    const parsed = await exifr.parse(imagePath, { tiff: true, exif: true, gps: true, xmp: true });
    return parsed || {};
  } catch (error) {
    return {};
  }
}

async function getExifDateFields(imagePath) {
  try {
    const parsed = await exifr.parse(imagePath, {
      pick: [
        'SubSecDateTimeOriginal',
        'DateTimeOriginal',
        'SubSecCreateDate',
        'CreateDate',
        'OffsetTimeOriginal',
        'OffsetTime',
        'OffsetTimeDigitized'
      ],
      reviveValues: false
    });
    return parsed || {};
  } catch (error) {
    return {};
  }
}

function firstNumber(...values) {
  for (const value of values) {
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

async function collectImageMetadata(birdName, filename) {
  const imagePath = path.join(IMG_DIR, birdName, filename);
  const exif = await getExif(imagePath);
  const exifDateFields = await getExifDateFields(imagePath);
  if (!exif || Object.keys(exif).length === 0) {
    console.warn(`EXIF: no metadata found for ${path.join(birdName, filename)}.`);
  }
  const ext = path.extname(filename).toLowerCase();
  const avifName = ext === '.jpg' || ext === '.jpeg'
    ? `${path.basename(filename, ext)}.avif`
    : null;
  const thumbName = `${path.basename(filename, ext)}.thumb.avif`;
  const imageSrc = avifName
    ? toWebPath('img', birdName, avifName)
    : toWebPath('img', birdName, filename);
  const thumbSrc = toWebPath('img', birdName, thumbName);
  const originalSrc = toWebPath('img', birdName, filename);
  const stat = fs.statSync(imagePath);
  const camera = [exif.Make, exif.Model].filter(Boolean).join(' ').trim();
  const gps = formatGps(
    firstNumber(exif.GPSLatitude, exif.latitude),
    firstNumber(exif.GPSLongitude, exif.longitude)
  );
  const captureDateRaw =
    exifDateFields.SubSecDateTimeOriginal ||
    exifDateFields.DateTimeOriginal ||
    exifDateFields.SubSecCreateDate ||
    exifDateFields.CreateDate ||
    exif.SubSecDateTimeOriginal ||
    exif.DateTimeOriginal ||
    exif.SubSecCreateDate ||
    exif.CreateDate ||
    exif.FileModifyDate ||
    exif.ModifyDate;
  const offset =
    exifDateFields.OffsetTimeOriginal ||
    exifDateFields.OffsetTime ||
    exifDateFields.OffsetTimeDigitized ||
    exif.OffsetTimeOriginal ||
    exif.OffsetTime ||
    exif.OffsetTimeDigitized;
  const captureDateIso =
    captureDateRaw instanceof Date
      ? captureDateRaw.toISOString()
      : exifToIso(typeof captureDateRaw === 'string' ? captureDateRaw : null, offset);
  if (!captureDateRaw) {
    console.warn(`EXIF: missing capture date for ${path.join(birdName, filename)}.`);
  }
  const width = firstNumber(
    exif.ImageWidth,
    exif.ExifImageWidth,
    exif.PixelXDimension,
    exif.Width
  );
  const height = firstNumber(
    exif.ImageHeight,
    exif.ExifImageHeight,
    exif.PixelYDimension,
    exif.Height
  );
  if (Number.isFinite(width) && Number.isFinite(height) && !isThreeTwo(width, height)) {
    const ratio = (width / height).toFixed(2);
    console.warn(`Aspect ratio: ${path.join(birdName, filename)} is ${width}x${height} (${ratio}:1), not 3:2.`);
  }
  const megapixelsRaw = Number.isFinite(exif.Megapixels)
    ? exif.Megapixels
    : width && height
      ? (width * height) / 1000000
      : null;

  return {
    filename,
    src: imageSrc,
    thumbSrc,
    originalSrc,
    width: width || 'Unknown',
    height: height || 'Unknown',
    megapixels: Number.isFinite(megapixelsRaw) ? megapixelsRaw.toFixed(1) : 'Unknown',
    fileSize: formatBytes(stat.size),
    captureDateRaw,
    captureDateIso,
    captureDate: formatDate(captureDateIso || captureDateRaw),
    camera: camera || 'Unknown',
    lens: exif.LensModel || exif.Lens || 'Unknown',
    exposure: formatExposure(exif.ExposureTime),
    aperture: formatFNumber(exif.FNumber),
    iso: Number.isFinite(exif.ISO) ? `${exif.ISO}` : 'Unknown',
    focalLength: formatFocalLength(exif.FocalLength),
    gps
  };
}

function renderLayout({ title, description, bodyClass, content, extraHead = '', extraScripts = '' }) {
  const siteTitle = 'Birdopedia';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} | ${siteTitle}</title>
    <meta name="description" content="${description}" />
    <link rel="stylesheet" href="/birdopedia/styles.css" />
    ${extraHead}
  </head>
  <body class="${bodyClass}">
    ${content}
    ${extraScripts}
  </body>
</html>`;
}

function getAuthorLine() {
  return [config.authorName, config.authorLocation].filter(Boolean).join(' • ');
}

function renderEbirdLink() {
  if (!config.ebirdProfileUrl) {
    return '';
  }
  return `<a class="meta-link" href="${config.ebirdProfileUrl}">eBird profile</a>`;
}

function renderSiteNav(activePage) {
  const links = [
    { key: 'index', label: 'Home', href: '/birdopedia/index.html' },
    { key: 'map', label: 'Field map', href: '/birdopedia/map/index.html' },
    { key: 'gallery', label: 'Gallery', href: '/birdopedia/gallery/index.html' },
    { key: 'trips', label: 'Trips', href: '/birdopedia/trips/index.html' }
  ];
  return links
    .map((link) => {
      if (link.key === activePage) {
        return `<span aria-current="page">${link.label}</span>`;
      }
      return `<a class="meta-link" href="${link.href}">${link.label}</a>`;
    })
    .join(' • ');
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;');
}

function renderIndex(
  birds,
  collectionStats,
  featuredImage,
  featuredImages,
  recentCaptures,
  families = [],
  statuses = []
) {
  const listing = birds
    .map((bird) => {
      const href = `/${toWebPath('birdopedia', bird.name, 'index.html')}`;
      const latestAttr = bird.latestIso ? ` data-latest-capture="${bird.latestIso}"` : '';
      const nameAttr = ` data-name="${escapeAttr(bird.name.toLowerCase())}"`;
      const familyAttr = ` data-family="${escapeAttr((bird.family || '').toLowerCase())}"`;
      const statusAttr = ` data-status="${escapeAttr((bird.status || '').toLowerCase())}"`;
      const countAttr = ` data-count="${bird.count}"`;
      return `
        <li class="bird-card"${latestAttr}${nameAttr}${familyAttr}${statusAttr}${countAttr}>
          <a class="bird-card__link" href="${href}">
            <span class="bird-card__name">
              ${bird.name}
              <span class="bird-card__badge" aria-hidden="true">New</span>
            </span>
            <span class="bird-card__meta">${bird.count} photo${bird.count === 1 ? '' : 's'} • ${bird.latest || 'Unknown date'}</span>
          </a>
        </li>`;
    })
    .join('');

  const authorLine = getAuthorLine();
  const ebirdLink = renderEbirdLink();
  const bio = config.siteLede || config.authorBio || 'A growing field guide built from days in the field.';
  const featuredSection = featuredImages?.length
    ? `
      <section class="featured-shot" data-featured>
        <a class="featured-shot__media media-frame" href="#">
          <img class="media-image media-fade" src="" alt="" loading="eager" decoding="async" />
        </a>
        <div class="featured-shot__info">
          <p class="eyebrow">Featured Moment</p>
          <h2><a href="#"></a></h2>
          <p class="featured-shot__date"></p>
        </div>
      </section>`
    : '';
  const featuredData = featuredImages?.length
    ? `<script type="application/json" id="featured-data">${JSON.stringify(featuredImages).replace(
        /</g,
        '\\u003c'
      )}</script>`
    : '';
  const recentSection = recentCaptures?.length
    ? `
      <section class="recent-captures">
        <div class="section-title">
          <h2>Recent captures</h2>
          <p>Newest photos added to the archive.</p>
        </div>
        <div class="recent-captures__grid">
          ${recentCaptures
            .map((capture) => {
              const imageParam = capture.filename ? `?image=${encodeURIComponent(capture.filename)}` : '';
              return `
              <a class="recent-captures__card" href="${capture.speciesHref}${imageParam}">
                <div class="recent-captures__thumb media-frame">
                  <img class="media-image media-fade" src="/${capture.thumbSrc || capture.src}" alt="${capture.bird} recent capture" loading="lazy" decoding="async" />
                </div>
                <div class="recent-captures__meta">
                  <span>${capture.bird}</span>
                  <span>${capture.captureDate || 'Unknown date'}</span>
                </div>
              </a>`;
            })
            .join('')}
        </div>
      </section>`
    : '';

  const content = `
    <header class="site-hero site-hero--home">
      <div class="site-hero__content">
        <p class="eyebrow">Photographic Field Notes</p>
        <h1>Birdopedia</h1>
        <p class="lede">${bio}</p>
        <div class="hero-meta">
          <span>${authorLine || 'Author information missing'}${ebirdLink ? ` • ${ebirdLink}` : ''} • ${collectionStats.totalSpecies} species • ${collectionStats.totalPhotos} photographs</span>
        </div>
        <p class="hero-nav">${renderSiteNav('index')}</p>
      </div>
    </header>

    <main class="index-main">
      <aside class="index-sidebar">
        ${featuredSection}
        <div class="site-hero__stats">
          <div class="section-title">
            <h2>Collection Highlights</h2>
            <p>Quick look at the overall archive.</p>
          </div>
          <div class="stat">
            <span class="stat__label">Total species</span>
            <span class="stat__value">${collectionStats.totalSpecies}</span>
          </div>
          <div class="stat">
            <span class="stat__label">Total photos</span>
            <span class="stat__value">${collectionStats.totalPhotos}</span>
          </div>
          <div class="stat">
            <span class="stat__label">Earliest capture</span>
            <span class="stat__value">${collectionStats.earliest || 'Unknown'}</span>
          </div>
          <div class="stat">
            <span class="stat__label">Latest capture</span>
            <span class="stat__value">${collectionStats.latest || 'Unknown'}</span>
          </div>
          <div class="stat">
            <span class="stat__label">Newest species</span>
            <span class="stat__value">${collectionStats.newestSpecies || 'Unknown'}</span>
          </div>
          <div class="stat">
            <span class="stat__label">Most photographed species</span>
            <span class="stat__value">${collectionStats.topSpecies || 'Unknown'}</span>
          </div>
          <div class="stat">
            <span class="stat__label">New species (30 days)</span>
            <span class="stat__value">${collectionStats.newSpeciesCount}</span>
          </div>
          <div class="stat">
            <span class="stat__label">Top month</span>
            <span class="stat__value">${collectionStats.topMonth || 'Unknown'}</span>
          </div>
          <div class="stat">
            <span class="stat__label">Days in the field</span>
            <span class="stat__value">${collectionStats.daysInField}</span>
          </div>
        </div>
        ${recentSection}
        ${featuredData}
      </aside>
      <section class="collection">
        <div class="section-title">
          <h2>Species Index</h2>
          <p>Alphabetical listings of every photographed species.</p>
        </div>
        <div class="collection-toolbar">
          <label class="search-field" for="species-search">
            <span>Search species</span>
            <input
              id="species-search"
              type="search"
              placeholder="Type a bird name"
              autocomplete="off"
              aria-describedby="search-count"
            />
          </label>
          <label class="family-field" for="family-filter">
            <span>Family</span>
            <select id="family-filter">
              <option value="">All families</option>
              ${families.map((family) => `<option value="${escapeAttr(family.toLowerCase())}">${escapeHtml(family)}</option>`).join('')}
            </select>
          </label>
          <label class="status-field" for="status-filter">
            <span>Conservation status</span>
            <select id="status-filter">
              <option value="">All statuses</option>
              ${statuses.map((status) => `<option value="${escapeAttr(status.toLowerCase())}">${escapeHtml(status)}</option>`).join('')}
            </select>
          </label>
          <label class="sort-field" for="sort-filter">
            <span>Sort</span>
            <select id="sort-filter">
              <option value="name" selected>A–Z</option>
              <option value="count">Photo count</option>
              <option value="latest">Latest capture</option>
            </select>
          </label>
          <div class="search-meta">
            <span id="search-count">${collectionStats.totalSpecies} species</span>
            <button class="search-clear" type="button" hidden>Clear</button>
          </div>
        </div>
        <p class="search-empty" hidden>No species match that search yet.</p>
        <ol class="bird-list">
          ${listing}
        </ol>
      </section>
    </main>

    <footer class="site-footer">
      <span>Built by ${config.authorName || 'the photographer'} • ${collectionStats.totalPhotos} moments captured in the wild.</span>
    </footer>`;

  return renderLayout({
    title: 'Home',
    description: 'A photographic encyclopedia of birds.',
    bodyClass: 'page-index',
    content,
    extraScripts: '<script src="/birdopedia/index.js"></script>'
  });
}

function renderBirdPage(bird, ebirdInfo) {
  const wikidataInfo = wikidata.species?.[bird.name] || {};
  const wikipediaInfo = wikipedia.species?.[bird.name] || {};
  const profile = { ...(ebirdInfo || {}), ...wikidataInfo };
  const bandingCode = buildBandingCode(bird.name);
  const profileItems = [
    ['Scientific name', profile.scientificName],
    ['Family', profile.family],
    ['Order', profile.order],
    ['Region', profile.region],
    ['Status', profile.status]
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<div class="profile-item"><span>${label}</span><strong>${value}</strong></div>`)
    .join('');

  const carouselImages = bird.images
    .map((image, index) => {
      return `
        <img
          class="carousel__image media-image${index === 0 ? ' is-active' : ''}"
          src="/${image.src}"
          alt="${bird.name} photograph ${index + 1}"
          loading="${index === 0 ? 'eager' : 'lazy'}"
          decoding="async"
          data-filename="${escapeAttr(image.filename)}"
          data-has-gps="${image.gps ? 'true' : 'false'}"
          data-caption-date="${image.captureDateIso || ''}"
          data-caption-camera="${image.camera}"
          data-caption-lens="${image.lens}"
          data-aperture="${image.aperture}"
          data-shutter="${image.exposure}"
          data-iso="${image.iso}"
          data-focal="${image.focalLength}"
        />`;
    })
    .join('');

  const dots = bird.images.length > 1
    ? bird.images
        .map((_, index) => `<button class="carousel__dot${index === 0 ? ' is-active' : ''}" data-index="${index}" aria-label="Go to image ${index + 1}"></button>`)
        .join('')
    : '';

  const imageCards = bird.images
    .map((image, index) => {
      const locationKey = image.gps ? geocodeKey(image.gps.lat, image.gps.lon) : null;
      const location = locationKey ? geocodeCache.points?.[locationKey] : null;
      const locationLabel = [location?.city, location?.state].filter(Boolean).join(', ');
      const mapLink =
        image.gps
          ? `/birdopedia/map/index.html?species=${encodeURIComponent(bird.name)}&focus=all&image=${encodeURIComponent(image.filename)}`
          : '';
      const gpsSection = image.gps && locationLabel
        ? `<a class="meta-link" href="${mapLink}">${escapeHtml(locationLabel)}</a>`
        : image.gps
          ? `<a class="meta-link" href="${mapLink}">${image.gps.display}</a>`
          : 'Unknown';
      const isJpeg = /\.(jpe?g)$/i.test(image.filename);
      const downloadLabel = isJpeg ? 'Full Size JPEG' : 'Download original';
      const downloadLink = image.originalSrc
        ? `<a class="meta-link meta-link--download" href="/${image.originalSrc}" download>${downloadLabel}</a>`
        : 'Unknown';

      return `
        <article class="image-card">
          <div class="image-card__thumb media-frame zoomable">
            <img
              class="media-image media-fade"
              src="/${image.src}"
              alt="${bird.name} photograph ${index + 1}"
              loading="lazy"
              decoding="async"
            />
            <span class="zoom-indicator" aria-hidden="true"></span>
          </div>
          <div class="image-card__body">
            <dl>
              <div><dt>Download</dt><dd>${downloadLink}</dd></div>
              <div><dt>Captured</dt><dd><time data-capture="${image.captureDateIso || ''}">${image.captureDate}</time></dd></div>
              <div><dt>Camera</dt><dd>${image.camera}</dd></div>
              <div><dt>Lens</dt><dd>${image.lens}</dd></div>
              <div><dt>Exposure</dt><dd>${image.exposure}</dd></div>
              <div><dt>Aperture</dt><dd>${image.aperture}</dd></div>
              <div><dt>ISO</dt><dd>${image.iso}</dd></div>
              <div><dt>Focal length</dt><dd>${image.focalLength}</dd></div>
              <div><dt>Dimensions</dt><dd>${image.width} × ${image.height}</dd></div>
              <div><dt>Megapixels</dt><dd>${image.megapixels}</dd></div>
              <div><dt>File size</dt><dd>${image.fileSize}</dd></div>
              <div><dt>Location</dt><dd>${gpsSection}</dd></div>
            </dl>
          </div>
        </article>`;
    })
    .join('');

  const narrativeBlocks = [
    ['Habitat', profile.habitat],
    ['Diet', profile.diet],
    ['Behavior', profile.behavior],
    ['Nesting', profile.nesting],
    ['Range', profile.range],
    ['Notes', profile.notes]
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<div class="profile-block"><h3>${label}</h3><p>${value}</p></div>`)
    .join('');

  const wikidataFacts = [
    ['Conservation status', profile.conservationStatus],
    ['Wingspan (m)', profile.wingspan],
    ['Mass', formatMassDisplay(profile.mass)],
    ['Lifespan (years)', profile.lifespan],
    ['Body length (m)', profile.bodyLength],
    ['Height (m)', profile.height],
    ['Native range', profile.nativeRange]
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<div class="profile-item"><span>${label}</span><strong>${value}</strong></div>`)
    .join('');

  const wikidataAudio = profile.audio
    ? `<audio class="bird-audio__player" controls src="${profile.audio}">Your browser does not support the audio element.</audio>`
    : '';

  const hasProfileItems = Boolean(profileItems);
  const hasNarrative = Boolean(narrativeBlocks);
  const fallbackProfile = !hasProfileItems && !hasNarrative
    ? '<p class="empty-note">Add species profile data in data/ebird.json to enrich this page.</p>'
    : '';

  const summaryParagraphs = wikipediaInfo.summary
    ? wikipediaInfo.summary
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => `<p>${paragraph}</p>`)
        .join('')
    : '';

  const summaryLabel = String(config.speciesSummaryLabel || 'Species notes').trim();

  const summaryBlock = summaryParagraphs
    ? `
      <div class="profile-summary">
        ${summaryLabel ? `<p class="summary-lede">${summaryLabel}</p>` : ''}
        ${summaryParagraphs}
      </div>`
    : '';

  const sourceLinks = [];
  if (ebird.source?.url) {
    sourceLinks.push(`<a class="meta-link" href="${ebird.source.url}" target="_blank" rel="noopener noreferrer">${ebird.source.name || 'eBird'}</a>`);
  }
  if (wikidata.source?.url) {
    sourceLinks.push(`<a class="meta-link" href="${wikidata.source.url}" target="_blank" rel="noopener noreferrer">${wikidata.source.name || 'Wikidata'}</a>`);
  }
  if (wikipediaInfo.summary) {
    const wikiUrl = wikipediaInfo.url || wikipedia.source?.url || 'https://en.wikipedia.org';
    const wikiLabel = wikipedia.source?.name || 'Wikipedia';
    const license = wikipedia.source?.license || 'CC BY-SA';
    sourceLinks.push(
      `<a class="meta-link" href="${wikiUrl}" target="_blank" rel="noopener noreferrer">${wikiLabel}</a> (${license})`
    );
  }

  const sourcesFootnote = sourceLinks.length
    ? ` • Sources: ${sourceLinks.join(' • ')}`
    : '';
  const audioBlock = wikidataAudio ? `<div class="bird-audio bird-audio--panel">${wikidataAudio}</div>` : '';
  const profileSection = hasProfileItems || hasNarrative || summaryBlock
    ? `
      <div class="species-panel">
        <div class="section-title">
          <h2>Species Profile</h2>
        </div>
        ${summaryBlock}
        <div class="profile-grid">${profileItems}${wikidataFacts}</div>
        ${narrativeBlocks}
        ${fallbackProfile}
        ${audioBlock}
      </div>`
    : `
      <div class="species-panel">
        <div class="section-title">
          <h2>Species Profile</h2>
          <p class="empty-note">Add species profile data in data/ebird.json to enrich this page.</p>
        </div>
        ${audioBlock}
      </div>`;

  const content = `
    <header class="site-hero page-hero">
      <div class="site-hero__content">
        <p class="eyebrow">Species Profile</p>
        <h1>${bird.name}</h1>
        <p class="lede">${profile.scientificName || 'Species profile pending.'}</p>
        <p class="species-code">Banding code: ${bandingCode || 'Unknown'}</p>
        <p class="hero-nav">${renderSiteNav('')}</p>
        <div class="hero-meta">
          <span>
            ${bird.images.length} photograph${bird.images.length === 1 ? '' : 's'} • ${bird.locationCount} tagged location${bird.locationCount === 1 ? '' : 's'}
            ${bird.locationCount > 0 ? ` • <a class="meta-link map-link" data-map-link data-species="${escapeAttr(bird.name)}" href="/birdopedia/map/index.html?species=${encodeURIComponent(bird.name)}&focus=latest">View field map</a>` : ''}
          </span>
        </div>
      </div>
    </header>

    <main class="bird-main">
      <section class="bird-hero bird-hero--details-only">
        <div class="bird-hero__media">
          <div class="carousel" data-count="${bird.images.length}">
            ${bird.images.length > 1 ? '<button class="carousel__btn" data-dir="prev" aria-label="Previous image">‹</button>' : ''}
            <div class="carousel__viewport media-frame zoomable">
              ${carouselImages}
              <span class="zoom-indicator" aria-hidden="true"></span>
            </div>
            ${bird.images.length > 1 ? '<button class="carousel__btn" data-dir="next" aria-label="Next image">›</button>' : ''}
            ${dots ? `<div class="carousel__dots">${dots}</div>` : ''}
            <p class="carousel__caption" data-caption>${bird.images[0]?.captureDate || ''} • ${bird.images[0]?.camera || ''} • ${bird.images[0]?.lens || ''}</p>
            <div class="carousel__meta" data-carousel-meta>
              <span data-meta="iso">ISO: ${bird.images[0]?.iso || 'Unknown'}</span>
              <span data-meta="shutter">Shutter: ${bird.images[0]?.exposure || 'Unknown'}</span>
              <span data-meta="aperture">Aperture: ${bird.images[0]?.aperture || 'Unknown'}</span>
              <span data-meta="focal">Focal: ${bird.images[0]?.focalLength || 'Unknown'}</span>
            </div>
          </div>
        </div>
        <div class="bird-hero__details">
          ${profileSection}
          <div class="species-panel">
            <div class="section-title">
              <h2>Photo Collection Overview</h2>
              <p>Photo capture coverage for this species.</p>
            </div>
            <div class="quick-facts">
              <div><span>Latest capture</span><strong>${bird.latest || 'Unknown'}</strong></div>
              <div><span>Earliest capture</span><strong>${bird.earliest || 'Unknown'}</strong></div>
              <div><span>Locations</span><strong>${bird.locationCount} tagged</strong></div>
            </div>
          </div>
        </div>
      </section>

      <section class="image-details">
        <div class="section-title">
          <h2>Image Details</h2>
          <p>Metadata extracted from the camera files.</p>
        </div>
        <div class="image-grid">
          ${imageCards}
        </div>
      </section>
    </main>

    <div class="preview-modal" data-preview role="dialog" aria-modal="true" aria-hidden="true">
      <button class="preview-modal__close" type="button" data-preview-close aria-label="Close preview">×</button>
      ${bird.images.length > 1 ? '<button class="preview-modal__nav" type="button" data-preview-dir="prev" aria-label="Previous photo">‹</button>' : ''}
      <img class="preview-modal__image" alt="" />
      ${bird.images.length > 1 ? '<button class="preview-modal__nav" type="button" data-preview-dir="next" aria-label="Next photo">›</button>' : ''}
    </div>

    <footer class="site-footer">
      <span>${config.authorName || 'The photographer'} • ${bird.images.length} frames of ${bird.name}${sourcesFootnote}</span>
    </footer>`;

  return renderLayout({
    title: bird.name,
    description: `Photography and field notes for ${bird.name}.`,
    bodyClass: 'page-bird',
    content,
    extraScripts: '<script src="/birdopedia/bird.js"></script>'
  });
}

function renderMapPage(mapPayload, mapStats, speciesList = []) {
  const speciesOptions = speciesList
    .map((birdName) => `<option value="${escapeAttr(birdName.toLowerCase())}">${escapeHtml(birdName)}</option>`)
    .join('');

  const recentList = mapPayload.recent?.length
    ? mapPayload.recent
        .map((capture) => {
          return `
            <button class="map-recent__item" type="button" data-point="${capture.pointId}">
              <span>${capture.bird}</span>
              <span>${capture.captureDate || 'Unknown date'}</span>
            </button>`;
        })
        .join('')
    : '<p class="empty-note">No geotagged captures yet.</p>';

  const content = `
    <header class="site-hero page-hero">
      <div class="site-hero__content">
        <p class="eyebrow">Field Atlas</p>
        <h1>Flight Map</h1>
        <p class="lede">Trace each capture across the landscape, with every geotagged frame pinned to the places you’ve explored.</p>
        <p class="hero-nav">${renderSiteNav('map')}</p>
        <div class="hero-meta">
          <span>${mapStats.totalGeoPhotos} geotagged photo${mapStats.totalGeoPhotos === 1 ? '' : 's'} • ${mapStats.totalGeoSpecies} species mapped</span>
        </div>
      </div>
    </header>

    <main class="map-main">
      <section class="site-hero__stats page-stats">
        <div class="section-title">
          <h2>Map highlights</h2>
          <p>Quick look at the geotagged archive.</p>
        </div>
        <div class="stat">
          <span class="stat__label">Mapped locations</span>
          <span class="stat__value">${mapStats.mappedLocations}</span>
        </div>
        <div class="stat">
          <span class="stat__label">Top country</span>
          <span class="stat__value">${mapStats.topCountry || 'Unknown'}</span>
        </div>
        <div class="stat">
          <span class="stat__label">Top city</span>
          <span class="stat__value">${mapStats.topCity || 'Unknown'}</span>
        </div>
        <div class="stat">
          <span class="stat__label">Top state/region</span>
          <span class="stat__value">${mapStats.topState || 'Unknown'}</span>
        </div>
        <div class="stat">
          <span class="stat__label">Most photographed species</span>
          <span class="stat__value">${mapStats.topSpecies || 'Unknown'}</span>
        </div>
        <div class="stat">
          <span class="stat__label">Distinct days mapped</span>
          <span class="stat__value">${mapStats.daysMapped}</span>
        </div>
      </section>
      <section class="map-panel">
        <div class="map-toolbar">
          <label class="family-field" for="map-species">
            <span>Species</span>
            <select id="map-species">
              <option value="">All species</option>
              ${speciesOptions}
            </select>
          </label>
          <label class="status-field" for="map-toggle-latest">
            <span>Focus</span>
            <select id="map-toggle-latest">
              <option value="all" selected>All captures</option>
              <option value="latest">Latest per species</option>
            </select>
          </label>
        </div>
        <div id="field-map" class="field-map" role="region" aria-label="Map of bird photograph locations"></div>
        <p class="map-attribution">Tiles © OpenStreetMap contributors</p>
      </section>
      <aside class="map-sidebar">
        <section class="map-spotlight" data-spotlight>
          <p class="eyebrow">Capture spotlight</p>
          <a class="map-spotlight__media media-frame" href="#">
            <img class="media-image media-fade" src="" alt="" loading="lazy" decoding="async" />
          </a>
          <div class="map-spotlight__info">
            <h2></h2>
            <p class="map-spotlight__date"></p>
            <p class="map-spotlight__meta"></p>
          </div>
        </section>
        <section class="map-recent">
          <div class="section-title">
            <h2>Recent map drops</h2>
            <p>Latest geotagged sightings.</p>
          </div>
          <div class="map-recent__list">
            ${recentList}
          </div>
        </section>
      </aside>
    </main>

    <footer class="site-footer">
      <span>Built by ${config.authorName || 'the photographer'} • ${mapStats.totalGeoPhotos} geotagged captures across the archive.</span>
    </footer>

    <script type="application/json" id="map-data">${JSON.stringify(mapPayload).replace(/</g, '\\u003c')}</script>`;

  return renderLayout({
    title: 'Field Map',
    description: 'Explore bird photography locations on an interactive map.',
    bodyClass: 'page-map',
    content,
    extraHead: '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />',
    extraScripts:
      '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script src="/birdopedia/map.js"></script>'
  });
}

function renderGalleryPage(filters = { cameras: [], lenses: [] }) {
  const cameraOptions = filters.cameras
    .map((camera) => `<option value="${escapeAttr(camera)}">${escapeHtml(camera)}</option>`)
    .join('');
  const lensOptions = filters.lenses
    .map((lens) => `<option value="${escapeAttr(lens)}">${escapeHtml(lens)}</option>`)
    .join('');
  const content = `
    <header class="site-hero page-hero">
      <div class="site-hero__content">
        <p class="eyebrow">Photo Archive</p>
        <h1>Gallery</h1>
        <p class="lede">An unbroken stream of field moments, curated for the images themselves.</p>
        <p class="hero-nav">${renderSiteNav('gallery')}</p>
      </div>
    </header>

    <main class="gallery-main">
      <div class="gallery-toolbar">
        <label class="sort-field" for="gallery-sort">
          <span>Sort</span>
          <select id="gallery-sort">
            <option value="random" selected>Random</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="species">Species A–Z</option>
          </select>
        </label>
        <label class="sort-field" for="gallery-camera">
          <span>Camera</span>
          <select id="gallery-camera">
            <option value="">All cameras</option>
            ${cameraOptions}
          </select>
        </label>
        <label class="sort-field" for="gallery-lens">
          <span>Lens</span>
          <select id="gallery-lens">
            <option value="">All lenses</option>
            ${lensOptions}
          </select>
        </label>
      </div>
      <div class="gallery-grid" data-gallery-grid></div>
      <button class="gallery-load" type="button" data-gallery-load>Load more</button>
    </main>

    <div class="preview-modal" data-preview role="dialog" aria-modal="true" aria-hidden="true">
      <button class="preview-modal__close" type="button" data-preview-close aria-label="Close preview">×</button>
      <button class="preview-modal__nav" type="button" data-preview-dir="prev" aria-label="Previous photo">‹</button>
      <img class="preview-modal__image" alt="" />
      <button class="preview-modal__nav" type="button" data-preview-dir="next" aria-label="Next photo">›</button>
    </div>
  `;

  return renderLayout({
    title: 'Gallery',
    description: 'A continuous gallery of bird photography.',
    bodyClass: 'page-gallery',
    content,
    extraScripts: '<script src="/birdopedia/gallery.js"></script>'
  });
}

function renderTripsPage(trips = []) {
  const totalTripPhotos = trips.reduce((sum, trip) => sum + trip.imageCount, 0);
  const totalTripSpecies = new Set(trips.flatMap((trip) => trip.species)).size;
  const tripDays = new Set(trips.map((trip) => trip.dayKey)).size;
  const largestTrip = trips.slice().sort((a, b) => b.imageCount - a.imageCount)[0] || null;
  const cards = trips
    .map((trip) => {
      const speciesLinks = trip.species
        .slice(0, 10)
        .map(
          (name) =>
            `<a class="trip-chip" href="/${toWebPath('birdopedia', name, 'index.html')}">${escapeHtml(name)}</a>`
        )
        .join('');
      const hiddenSpecies = trip.species.length > 10 ? `<span class="trip-chip">+${trip.species.length - 10} more</span>` : '';
      const locationLabel = trip.locations.slice(0, 3).join(' • ');
      const extraLocations = trip.locations.length > 3 ? ` • +${trip.locations.length - 3} more` : '';
      const thumbButtons = trip.images
        .slice()
        .reverse()
        .slice(0, 8)
        .map((image) => {
          const imageIndex = trip.images.findIndex((item) => item.filename === image.filename);
          return `
            <button class="trip-thumb" type="button" data-trip-thumb data-trip-id="${trip.id}" data-image-index="${imageIndex}">
              <img class="media-image media-fade" src="/${image.thumbSrc || image.src}" alt="${escapeAttr(image.bird)} trip image" loading="lazy" decoding="async" />
            </button>`;
        })
        .join('');

      return `
        <article class="trip-card${trip.id === trips[0]?.id ? ' is-active' : ''}" data-trip-panel="${trip.id}"${
          trip.id === trips[0]?.id ? '' : ' hidden'
        }>
          <button
            class="trip-card__hero media-frame zoomable"
            type="button"
            data-trip-open
            data-trip-id="${trip.id}"
            data-image-index="${trip.coverIndex}"
          >
            <img class="media-image media-fade" src="/${trip.cover.src || trip.cover.thumbSrc}" alt="${escapeAttr(trip.cover.bird)} trip cover" loading="lazy" decoding="async" />
            <span class="zoom-indicator" aria-hidden="true"></span>
            <span class="trip-card__badge">${trip.dateLabel}</span>
          </button>
          <div class="trip-card__body">
            <div class="trip-card__title">
              <h2>${escapeHtml(trip.locationTitle)}</h2>
              <p>${trip.dateLabel} • ${trip.durationLabel}</p>
            </div>
            <div class="trip-kpis">
              <div><span>Photos</span><strong>${trip.imageCount}</strong></div>
              <div><span>Species</span><strong>${trip.speciesCount}</strong></div>
              <div><span>Duration</span><strong>${trip.durationLabel}</strong></div>
              <div><span>Most photographed</span><strong class="trip-kpi__text">${escapeHtml(trip.topSpeciesLabel)}</strong></div>
              <div><span>Primary gear</span><strong class="trip-kpi__text">${escapeHtml(trip.gearLabel)}</strong></div>
            </div>
            <p class="trip-card__location">${escapeHtml(locationLabel || 'Unknown location')}${escapeHtml(extraLocations)}</p>
            <div class="trip-card__species">${speciesLinks}${hiddenSpecies}</div>
            <dl class="trip-facts">
              <div><dt>New species</dt><dd>${
                trip.hasNewSpecies
                  ? `<span class="trip-badge trip-badge--new">${escapeHtml(trip.newSpeciesLabel)}</span>`
                  : escapeHtml(trip.newSpeciesLabel)
              }</dd></div>
            </dl>
            <div class="trip-card__thumbs">${thumbButtons}</div>
            <div class="trip-card__actions">
              <a class="meta-link" href="${trip.mapHref}">View this trip on map</a>
            </div>
          </div>
        </article>`;
    })
    .join('');

  const tripList = trips
    .map((trip) => {
      return `<button class="trip-select${trip.id === trips[0]?.id ? ' is-active' : ''}" type="button" data-trip-select="${trip.id}" aria-current="${
        trip.id === trips[0]?.id ? 'true' : 'false'
      }">
        <span class="trip-select__date">${escapeHtml(trip.dateLabel)}</span>
        <span class="trip-select__title">${escapeHtml(trip.locationTitle)}</span>
        <span class="trip-select__meta">${trip.imageCount} photo${trip.imageCount === 1 ? '' : 's'} • ${trip.speciesCount} species</span>
      </button>`;
    })
    .join('');

  const emptyState = trips.length
    ? ''
    : `<section class="trips-empty"><p>No trips detected yet. Add geotagged photos taken on the same day in nearby locations.</p></section>`;

  const tripScriptData = trips.map((trip) => ({
    id: trip.id,
    images: trip.images.map((image) => ({
      src: image.src,
      bird: image.bird,
      captureDate: image.captureDate,
      speciesHref: image.speciesHref,
      filename: image.filename
    }))
  }));

  const content = `
    <header class="site-hero page-hero">
      <div class="site-hero__content">
        <p class="eyebrow">Field Expeditions</p>
        <h1>Trips</h1>
        <p class="lede">Automatically grouped photo days based on nearby locations and shared capture dates.</p>
        <p class="hero-nav">${renderSiteNav('trips')}</p>
        <div class="hero-meta">
          <span>${trips.length} trip${trips.length === 1 ? '' : 's'} • ${totalTripPhotos} photos • ${totalTripSpecies} species</span>
        </div>
      </div>
    </header>

    <main class="trips-main">
      <section class="trips-hero__stats site-hero__stats page-stats">
        <div class="stat"><span class="stat__label">Detected trips</span><span class="stat__value">${trips.length}</span></div>
        <div class="stat"><span class="stat__label">Trip photos</span><span class="stat__value">${totalTripPhotos}</span></div>
        <div class="stat"><span class="stat__label">Species across trips</span><span class="stat__value">${totalTripSpecies}</span></div>
        <div class="stat"><span class="stat__label">Trip days</span><span class="stat__value">${tripDays}</span></div>
        <div class="stat"><span class="stat__label">Largest trip</span><span class="stat__value">${
          largestTrip ? `${largestTrip.dateLabel} (${largestTrip.imageCount})` : 'None yet'
        }</span></div>
      </section>
      ${emptyState}
      <section class="trips-layout">
        <aside class="trips-nav" data-trip-nav>
          <h2>All trips</h2>
          <div class="trips-nav__list">
            ${tripList}
          </div>
        </aside>
        <section class="trips-stage">
          ${cards}
        </section>
      </section>
    </main>

    <div class="preview-modal" data-preview role="dialog" aria-modal="true" aria-hidden="true">
      <button class="preview-modal__close" type="button" data-preview-close aria-label="Close preview">×</button>
      <button class="preview-modal__nav" type="button" data-preview-dir="prev" aria-label="Previous photo">‹</button>
      <img class="preview-modal__image" alt="" />
      <button class="preview-modal__nav" type="button" data-preview-dir="next" aria-label="Next photo">›</button>
      <div class="trip-preview__meta">
        <strong data-preview-bird></strong>
        <span data-preview-date></span>
        <a class="meta-link" data-preview-link href="#">Open species page</a>
      </div>
    </div>

    <footer class="site-footer">
      <span>${config.authorName || 'The photographer'} • ${trips.length} trip${trips.length === 1 ? '' : 's'} discovered from field metadata.</span>
    </footer>

    <script type="application/json" id="trip-data">${JSON.stringify(tripScriptData).replace(/</g, '\\u003c')}</script>
  `;

  return renderLayout({
    title: 'Trips',
    description: 'Trip groupings inferred from date and geotag proximity.',
    bodyClass: 'page-trips',
    content,
    extraScripts: '<script src="/birdopedia/trips.js"></script>'
  });
}

async function build() {
  if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  }
  if (!fs.existsSync(SITE_DIR)) {
    fs.mkdirSync(SITE_DIR, { recursive: true });
  }

  const stylesSource = path.join(TEMPLATES_DIR, 'styles.css');
  const scriptSource = path.join(TEMPLATES_DIR, 'bird.js');
  const indexScriptSource = path.join(TEMPLATES_DIR, 'index.js');
  const mapScriptSource = path.join(TEMPLATES_DIR, 'map.js');
  const galleryScriptSource = path.join(TEMPLATES_DIR, 'gallery.js');
  const tripsScriptSource = path.join(TEMPLATES_DIR, 'trips.js');
  if (fs.existsSync(stylesSource)) {
    fs.copyFileSync(stylesSource, path.join(SITE_DIR, 'styles.css'));
  }
  if (fs.existsSync(scriptSource)) {
    fs.copyFileSync(scriptSource, path.join(SITE_DIR, 'bird.js'));
  }
  if (fs.existsSync(indexScriptSource)) {
    fs.copyFileSync(indexScriptSource, path.join(SITE_DIR, 'index.js'));
  }
  if (fs.existsSync(mapScriptSource)) {
    fs.copyFileSync(mapScriptSource, path.join(SITE_DIR, 'map.js'));
  }
  if (fs.existsSync(galleryScriptSource)) {
    fs.copyFileSync(galleryScriptSource, path.join(SITE_DIR, 'gallery.js'));
  }
  if (fs.existsSync(tripsScriptSource)) {
    fs.copyFileSync(tripsScriptSource, path.join(SITE_DIR, 'trips.js'));
  }

  const allBirds = listBirds();
  const avifCandidates = allBirds.flatMap((birdName) =>
    listImages(birdName)
      .map((filename) => path.join(IMG_DIR, birdName, filename))
      .filter((imagePath) => avifTargetPath(imagePath))
  );
  const thumbCandidates = allBirds.flatMap((birdName) =>
    listImages(birdName).map((filename) => path.join(IMG_DIR, birdName, filename))
  );
  const avifPending = avifCandidates.filter((imagePath) => needsAvifVariant(imagePath));
  const avifTotal = avifPending.length;
  const thumbPending = thumbCandidates.filter((imagePath) => needsThumbVariant(imagePath));
  const thumbTotal = thumbPending.length;
  const avifPendingSet = new Set(avifPending);
  const thumbPendingSet = new Set(thumbPending);
  console.log(`building ${avifTotal} avif file${avifTotal === 1 ? '' : 's'}`);
  console.log(`building ${thumbTotal} thumbnail file${thumbTotal === 1 ? '' : 's'}`);
  let avifCreated = 0;
  let thumbCreated = 0;
  let avifIndex = 0;
  let thumbIndex = 0;
  const birds = await Promise.all(allBirds.map(async (birdName) => {
    const imageFiles = listImages(birdName);
    if (imageFiles.length === 0) {
      console.warn(`Warning: No images found for ${birdName}.`);
      return null;
    }
    let birdAvifCandidates = 0;
    let birdAvifUpdated = 0;
    for (const filename of imageFiles) {
      const imagePath = path.join(IMG_DIR, birdName, filename);
      if (!avifTargetPath(imagePath)) {
        // Skip AVIF generation for non-JPEG files.
      } else if (avifPendingSet.has(imagePath)) {
        avifIndex += 1;
        birdAvifCandidates += 1;
        const targetPath = avifTargetPath(imagePath);
        console.log(`${avifIndex}/${avifTotal} started building ${path.basename(imagePath)}`);
        if (await ensureAvifVariant(imagePath)) {
          avifCreated += 1;
          birdAvifUpdated += 1;
          if (targetPath) {
            console.log(`${avifIndex}/${avifTotal} finished building ${path.basename(targetPath)}`);
          }
        }
      }
      if (thumbPendingSet.has(imagePath)) {
        thumbIndex += 1;
        console.log(`${thumbIndex}/${thumbTotal} started building thumb for ${path.basename(imagePath)}`);
        if (await ensureThumbVariant(imagePath)) {
          thumbCreated += 1;
          const thumbTarget = thumbTargetPath(imagePath);
          if (thumbTarget) {
            console.log(`${thumbIndex}/${thumbTotal} finished building ${path.basename(thumbTarget)}`);
          }
        }
      }
    }
    const images = await Promise.all(imageFiles.map((filename) => collectImageMetadata(birdName, filename)));
    images.sort((a, b) => {
      const dateA = normalizeExifDate(a.captureDateRaw);
      const dateB = normalizeExifDate(b.captureDateRaw);
      if (dateA && dateB) {
        return dateB - dateA;
      }
      if (dateA) {
        return -1;
      }
      if (dateB) {
        return 1;
      }
      return a.filename.localeCompare(b.filename);
    });
    const dates = images
      .map((image) => normalizeExifDate(image.captureDateRaw))
      .filter(Boolean)
      .sort((a, b) => a - b);

    const gpsCount = images.filter((image) => image.gps).length;

    const earliestDate = dates[0] || null;
    const latestDate = dates[dates.length - 1] || null;
    const earliest = earliestDate ? formatDisplayDate(earliestDate) : null;
    const latest = latestDate ? formatDisplayDate(latestDate) : null;

    return {
      name: birdName,
      images,
      count: images.length,
      earliest,
      earliestDate,
      latest,
      latestDate,
      latestIso: latestDate ? latestDate.toISOString() : null,
      locationCount: gpsCount
    };
  }));

  const populatedBirds = birds.filter(Boolean);

  const allDates = populatedBirds
    .flatMap((bird) => bird.images.map((image) => normalizeExifDate(image.captureDateRaw)))
    .filter(Boolean)
    .sort((a, b) => a - b);
  const uniqueDays = new Set(allDates.map((date) => date.toISOString().slice(0, 10)));
  const monthCounts = allDates.reduce((acc, date) => {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const topMonthEntry = Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0] || null;
  const topMonthLabel = topMonthEntry
    ? `${new Date(`${topMonthEntry[0]}-01T00:00:00Z`).toLocaleString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
      })} (${topMonthEntry[1]})`
    : null;

  const topSpecies = populatedBirds.slice().sort((a, b) => b.count - a.count)[0];
  const topSpeciesLabel = topSpecies ? `${topSpecies.name} (${topSpecies.count})` : null;

  const newestSpecies = populatedBirds
    .filter((bird) => bird.earliestDate)
    .sort((a, b) => b.earliestDate - a.earliestDate)[0];
  const newestSpeciesLabel = newestSpecies
    ? `${newestSpecies.name} (${formatDisplayDate(newestSpecies.earliestDate)})`
    : null;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const newSpeciesCount = populatedBirds.filter((bird) => bird.latestDate && bird.latestDate >= cutoff).length;

  const collectionStats = {
    totalSpecies: populatedBirds.length,
    totalPhotos: populatedBirds.reduce((sum, bird) => sum + bird.count, 0),
    earliest: allDates[0] ? formatDisplayDate(allDates[0]) : null,
    latest: allDates[allDates.length - 1] ? formatDisplayDate(allDates[allDates.length - 1]) : null,
    topSpecies: topSpeciesLabel,
    newestSpecies: newestSpeciesLabel,
    newSpeciesCount,
    daysInField: uniqueDays.size,
    topMonth: topMonthLabel
  };

  const birdSummaries = populatedBirds.map((bird) => ({
    name: bird.name,
    count: bird.count,
    latest: bird.latest,
    latestIso: bird.latestIso,
    family: ebird.species?.[bird.name]?.family || null,
    status: ebird.species?.[bird.name]?.status || wikidata.species?.[bird.name]?.conservationStatus || null
  }));

  const featuredImages = populatedBirds.length
    ? populatedBirds.flatMap((bird) => {
        const speciesHref = `/${toWebPath('birdopedia', bird.name, 'index.html')}`;
      return bird.images.map((image) => ({
          bird: bird.name,
          src: image.src,
          thumbSrc: image.thumbSrc,
          filename: image.filename,
          captureDate: image.captureDate,
          speciesHref
        }));
      })
    : [];

  const recentCaptures = populatedBirds
    .map((bird) => {
      const latestImage = bird.images.find((image) => image.captureDateIso);
      if (!latestImage) {
        return null;
      }
      const speciesHref = `/${toWebPath('birdopedia', bird.name, 'index.html')}`;
      return {
        bird: bird.name,
        src: latestImage.src,
        thumbSrc: latestImage.thumbSrc,
        filename: latestImage.filename,
        captureDate: latestImage.captureDate,
        captureDateIso: latestImage.captureDateIso,
        speciesHref
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.captureDateIso) - new Date(a.captureDateIso))
    .slice(0, 6);

  const families = Array.from(new Set(birdSummaries.map((bird) => bird.family).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'en', { sensitivity: 'base' })
  );
  const statuses = Array.from(new Set(birdSummaries.map((bird) => bird.status).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'en', { sensitivity: 'base' })
  );
  const indexHtml = renderIndex(
    birdSummaries,
    collectionStats,
    null,
    featuredImages,
    recentCaptures,
    families,
    statuses
  );
  fs.writeFileSync(path.join(SITE_DIR, 'index.html'), indexHtml);
  fs.writeFileSync(path.join(PUBLIC_DIR, 'index.html'), indexHtml);

  const firstSeenDayBySpecies = {};
  populatedBirds.forEach((bird) => {
    const firstDate = bird.images
      .map((image) => normalizeExifDate(image.captureDateRaw || image.captureDateIso))
      .filter(Boolean)
      .sort((a, b) => a - b)[0];
    const dayKey = firstDate ? toLocalDayKey(firstDate) : null;
    if (dayKey) {
      firstSeenDayBySpecies[bird.name] = dayKey;
    }
  });

  const mapPoints = [];
  const tripExtraCapturesByDay = new Map();
  populatedBirds.forEach((bird) => {
    const speciesHref = `/${toWebPath('birdopedia', bird.name, 'index.html')}`;
    const ebirdInfo = ebird.species?.[bird.name];
    bird.images.forEach((image) => {
      const captureDateObj = normalizeExifDate(image.captureDateRaw || image.captureDateIso);
      const dayKey = captureDateObj ? toLocalDayKey(captureDateObj) : null;
      if (!image.gps) {
        if (dayKey) {
          if (!tripExtraCapturesByDay.has(dayKey)) {
            tripExtraCapturesByDay.set(dayKey, []);
          }
          tripExtraCapturesByDay.get(dayKey).push({
            bird: bird.name,
            speciesHref,
            src: image.src,
            thumbSrc: image.thumbSrc,
            filename: image.filename,
            captureDate: image.captureDate,
            captureDateIso: image.captureDateIso,
            camera: image.camera,
            lens: image.lens,
            aperture: image.aperture,
            exposure: image.exposure,
            iso: image.iso,
            family: ebirdInfo?.family || null,
            status: ebirdInfo?.status || wikidata.species?.[bird.name]?.conservationStatus || null,
            locationLabel: null,
            park: null,
            site: null,
            city: null,
            state: null,
            country: null,
            lat: null,
            lon: null
          });
        }
        return;
      }
      const locationKey = geocodeKey(image.gps.lat, image.gps.lon);
      const location = locationKey ? geocodeCache.points?.[locationKey] : null;
      mapPoints.push({
        id: mapPoints.length,
        bird: bird.name,
        speciesHref,
        src: image.src,
        thumbSrc: image.thumbSrc,
        filename: image.filename,
        captureDate: image.captureDate,
        captureDateIso: image.captureDateIso,
        camera: image.camera,
        lens: image.lens,
        aperture: image.aperture,
        exposure: image.exposure,
        iso: image.iso,
        family: ebirdInfo?.family || null,
        status: ebirdInfo?.status || wikidata.species?.[bird.name]?.conservationStatus || null,
        locationLabel: location?.label || null,
        park: location?.park || null,
        site: location?.site || null,
        city: location?.city || null,
        state: location?.state || null,
        country: location?.country || null,
        lat: image.gps.lat,
        lon: image.gps.lon
      });
    });
  });

  const geoSpeciesSet = new Set(mapPoints.map((point) => point.bird));
  const geoDates = mapPoints
    .map((point) => normalizeExifDate(point.captureDateIso))
    .filter(Boolean)
    .sort((a, b) => a - b);
  const geoDays = new Set(geoDates.map((date) => date.toISOString().slice(0, 10)));
  const mappedLocations = new Set(mapPoints.map((point) => `${point.lat.toFixed(3)}, ${point.lon.toFixed(3)}`));
  const geoTopSpecies = mapPoints.reduce((acc, point) => {
    acc[point.bird] = (acc[point.bird] || 0) + 1;
    return acc;
  }, {});
  const geoTopEntry = Object.entries(geoTopSpecies).sort((a, b) => b[1] - a[1])[0];
  const geoTopLabel = geoTopEntry ? `${geoTopEntry[0]} (${geoTopEntry[1]})` : null;
  const locationCounts = (field) =>
    mapPoints.reduce((acc, point) => {
      const value = point[field];
      if (!value) {
        return acc;
      }
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});
  const topEntry = (entries) => Object.entries(entries).sort((a, b) => b[1] - a[1])[0] || null;
  const topCountryEntry = topEntry(locationCounts('country'));
  const topStateEntry = topEntry(locationCounts('state'));
  const topCityEntry = topEntry(locationCounts('city'));
  const topCountryLabel = topCountryEntry ? `${topCountryEntry[0]} (${topCountryEntry[1]})` : null;
  const topStateLabel = topStateEntry ? `${topStateEntry[0]} (${topStateEntry[1]})` : null;
  const topCityLabel = topCityEntry ? `${topCityEntry[0]} (${topCityEntry[1]})` : null;

  const mapStats = {
    totalGeoPhotos: mapPoints.length,
    totalGeoSpecies: geoSpeciesSet.size,
    earliest: geoDates[0] ? formatDisplayDate(geoDates[0]) : null,
    latest: geoDates[geoDates.length - 1] ? formatDisplayDate(geoDates[geoDates.length - 1]) : null,
    daysMapped: geoDays.size,
    mappedLocations: mappedLocations.size,
    topSpecies: geoTopLabel,
    topCountry: topCountryLabel,
    topState: topStateLabel,
    topCity: topCityLabel
  };

  const recentGeoCaptures = mapPoints
    .filter((point) => point.captureDateIso)
    .sort((a, b) => new Date(b.captureDateIso) - new Date(a.captureDateIso))
    .slice(0, 6)
    .map((point) => ({
      pointId: point.id,
      bird: point.bird,
      captureDate: point.captureDate
    }));

  const bounds = mapPoints.length
    ? mapPoints.reduce(
        (acc, point) => {
          acc.minLat = Math.min(acc.minLat, point.lat);
          acc.maxLat = Math.max(acc.maxLat, point.lat);
          acc.minLon = Math.min(acc.minLon, point.lon);
          acc.maxLon = Math.max(acc.maxLon, point.lon);
          return acc;
        },
        {
          minLat: mapPoints[0].lat,
          maxLat: mapPoints[0].lat,
          minLon: mapPoints[0].lon,
          maxLon: mapPoints[0].lon
        }
      )
    : null;

  const mapPayload = {
    points: mapPoints,
    recent: recentGeoCaptures,
    bounds
  };

  const mapHtml = renderMapPage(
    mapPayload,
    mapStats,
    Array.from(geoSpeciesSet).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
  );
  const mapDir = path.join(SITE_DIR, 'map');
  if (!fs.existsSync(mapDir)) {
    fs.mkdirSync(mapDir, { recursive: true });
  }
  fs.writeFileSync(path.join(mapDir, 'index.html'), mapHtml);

  const trips = createTripsFromMapPoints(mapPoints, 30, tripExtraCapturesByDay, firstSeenDayBySpecies);
  const tripsHtml = renderTripsPage(trips);
  const tripsDir = path.join(SITE_DIR, 'trips');
  if (!fs.existsSync(tripsDir)) {
    fs.mkdirSync(tripsDir, { recursive: true });
  }
  fs.writeFileSync(path.join(tripsDir, 'index.html'), tripsHtml);

  const galleryItems = populatedBirds.flatMap((bird) => {
    const speciesHref = `/${toWebPath('birdopedia', bird.name, 'index.html')}`;
    return bird.images.map((image) => ({
      id: `${bird.name}-${image.filename}`,
      src: image.src,
      thumbSrc: image.thumbSrc,
      bird: bird.name,
      speciesHref,
      filename: image.filename,
      camera: image.camera,
      lens: image.lens,
      captureDate: image.captureDate,
      captureDateIso: image.captureDateIso,
      width: Number.isFinite(image.width) ? image.width : null,
      height: Number.isFinite(image.height) ? image.height : null
    }));
  });
  galleryItems.sort((a, b) => {
    const dateA = a.captureDateIso ? new Date(a.captureDateIso).getTime() : 0;
    const dateB = b.captureDateIso ? new Date(b.captureDateIso).getTime() : 0;
    if (dateA && dateB && dateA !== dateB) {
      return dateB - dateA;
    }
    if (dateA !== dateB) {
      return dateB - dateA;
    }
    return a.bird.localeCompare(b.bird);
  });
  fs.writeFileSync(path.join(SITE_DIR, 'gallery.json'), JSON.stringify(galleryItems, null, 2));
  const galleryFilters = {
    cameras: Array.from(new Set(galleryItems.map((item) => item.camera).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'en', { sensitivity: 'base' })
    ),
    lenses: Array.from(new Set(galleryItems.map((item) => item.lens).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'en', { sensitivity: 'base' })
    )
  };
  const galleryHtml = renderGalleryPage(galleryFilters);
  const galleryDir = path.join(SITE_DIR, 'gallery');
  if (!fs.existsSync(galleryDir)) {
    fs.mkdirSync(galleryDir, { recursive: true });
  }
  fs.writeFileSync(path.join(galleryDir, 'index.html'), galleryHtml);

  populatedBirds.forEach((bird) => {
    const ebirdInfo = ebird.species?.[bird.name];
    const birdHtml = renderBirdPage(bird, ebirdInfo);
    const birdDir = path.join(SITE_DIR, bird.name);
    if (!fs.existsSync(birdDir)) {
      fs.mkdirSync(birdDir, { recursive: true });
    }
    fs.writeFileSync(path.join(birdDir, 'index.html'), birdHtml);
  });

  if (avifCreated > 0) {
    console.log(`Generated ${avifCreated} AVIF file(s).`);
  }
  if (thumbCreated > 0) {
    console.log(`Generated ${thumbCreated} thumbnail file(s).`);
  }
  console.log(`Built ${populatedBirds.length} bird page(s).`);
}

build().catch((error) => {
  console.error('Build failed.', error);
  process.exitCode = 1;
});
