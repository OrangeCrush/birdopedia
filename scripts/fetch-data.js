const fs = require('fs');
const path = require('path');
const https = require('https');
const exifr = require('exifr');

const ROOT = path.resolve(__dirname, '..');
const IMG_DIR = path.join(ROOT, 'public', 'img');
const DATA_DIR = path.join(ROOT, 'data');
const EBIRD_PATH = path.join(DATA_DIR, 'ebird.json');
const WIKIDATA_PATH = path.join(DATA_DIR, 'wikidata.json');
const WIKIPEDIA_PATH = path.join(DATA_DIR, 'wikipedia.json');
const GEOCODE_PATH = path.join(DATA_DIR, 'geocode.json');
const OVERRIDES_PATH = path.join(DATA_DIR, 'ebird.overrides.json');
const ENV_PATH = path.join(ROOT, '.env');
const HARD_REFRESH = process.argv.includes('--hard');
const WIKIPEDIA_MIN_SUMMARY_CHARS = 420;
const WIKIPEDIA_MAX_SUMMARY_CHARS = 1200;
const WIKIPEDIA_MAX_PARAGRAPHS = 5;
const CONFIG_PATH = path.join(ROOT, 'config.json');

const config = readJson(CONFIG_PATH, { authorName: 'Photographer' });

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  return lines.reduce((acc, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return acc;
    }
    const [key, ...rest] = trimmed.split('=');
    if (!key) {
      return acc;
    }
    acc[key] = rest.join('=').trim();
    return acc;
  }, {});
}

function ensureOverridesFile() {
  if (!fs.existsSync(OVERRIDES_PATH)) {
    fs.writeFileSync(OVERRIDES_PATH, JSON.stringify({ byFolder: {} }, null, 2));
  }
}


function listBirdFolders() {
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
  if (!fs.existsSync(fullPath)) {
    return [];
  }
  return fs
    .readdirSync(fullPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.(jpe?g|png|webp)$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
}

function firstNumber(...values) {
  for (const value of values) {
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function geocodeKey(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

function formatLocation(address = {}) {
  const city =
    address.city ||
    address.town ||
    address.village ||
    address.hamlet ||
    address.county ||
    null;
  const state =
    address.state ||
    address.region ||
    address.province ||
    address.state_district ||
    null;
  const country = address.country || null;
  const parts = [city, state, country].filter(Boolean);
  return {
    city,
    state,
    country,
    label: parts.join(', ')
  };
}

async function reverseGeocode(lat, lon, email, cache) {
  const key = geocodeKey(lat, lon);
  if (!key) {
    return 'failed';
  }
  if (cache.points?.[key]) {
    return 'cached';
  }
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lon),
    zoom: '14',
    addressdetails: '1'
  });
  if (email) {
    params.set('email', email);
  }
  const url = `https://nominatim.openstreetmap.org/reverse?${params.toString()}`;
  const headers = {
    'User-Agent': `Birdopedia/${config.authorName || 'Photographer'}`
  };
  try {
    const payload = await requestJson(url, headers);
    const location = formatLocation(payload.address || {});
    const entry = {
      key,
      lat,
      lon,
      label: location.label,
      city: location.city,
      state: location.state,
      country: location.country
    };
    cache.points[key] = entry;
    cache.updatedAt = new Date().toISOString();
    return 'fetched';
  } catch (error) {
    console.warn(`Geocode: failed for ${key}.`, error.message || error);
    return 'failed';
  }
}

function normalizeName(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function requestJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers }, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Request failed (${res.statusCode}): ${data}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', reject);
  });
}

function buildSummaryUrl(title) {
  const slug = encodeURIComponent(title.replace(/ /g, '_'));
  return `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`;
}

function buildParseLeadUrl(title) {
  const slug = encodeURIComponent(title.replace(/ /g, '_'));
  return `https://en.wikipedia.org/w/api.php?action=parse&page=${slug}&prop=text&section=0&format=json&redirects=1`;
}

function buildExtractUrl(title, maxChars) {
  const slug = encodeURIComponent(title.replace(/ /g, '_'));
  return `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&exchars=${maxChars}&titles=${slug}&format=json&redirects=1`;
}

function buildDescriptionUrl(title) {
  const slug = encodeURIComponent(title.replace(/ /g, '_'));
  return `https://en.wikipedia.org/w/api.php?action=query&prop=description&titles=${slug}&format=json&redirects=1`;
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function extractLeadParagraphs(html) {
  if (!html) {
    return [];
  }
  const paragraphs = [];
  const regex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = regex.exec(html))) {
    const raw = match[1]
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\[\d+]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const cleaned = decodeHtmlEntities(raw);
    if (cleaned) {
      paragraphs.push(cleaned);
    }
  }
  return paragraphs;
}

function sanitizeSummary(text) {
  if (!text) {
    return '';
  }
  return text
    .replace(/\[\d+]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSummaryFromParagraphs(paragraphs) {
  if (!paragraphs.length) {
    return '';
  }
  const picked = [];
  let total = 0;
  for (const paragraph of paragraphs.slice(0, WIKIPEDIA_MAX_PARAGRAPHS)) {
    const nextTotal = total + paragraph.length + (picked.length ? 2 : 0);
    if (nextTotal > WIKIPEDIA_MAX_SUMMARY_CHARS && total >= WIKIPEDIA_MIN_SUMMARY_CHARS) {
      break;
    }
    picked.push(paragraph);
    total = nextTotal;
  }
  return picked.join('\n\n');
}

function resolveOverride(folderName, overrideValue, taxonomy) {
  if (!overrideValue) {
    return null;
  }
  if (typeof overrideValue === 'string') {
    const byCode = taxonomy.find((entry) => entry.speciesCode === overrideValue);
    if (byCode) {
      return byCode;
    }
    const byName = taxonomy.find((entry) => entry.comName === overrideValue);
    if (byName) {
      return byName;
    }
    return null;
  }
  if (overrideValue.speciesCode) {
    return taxonomy.find((entry) => entry.speciesCode === overrideValue.speciesCode) || null;
  }
  if (overrideValue.commonName) {
    return taxonomy.find((entry) => entry.comName === overrideValue.commonName) || null;
  }
  console.warn(`Override for ${folderName} is invalid.`);
  return null;
}

async function fetchEbirdSpecies(token) {
  const taxonomyUrl = 'https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json&cat=species&locale=en';
  const existing = readJson(EBIRD_PATH, { species: {} });
  const existingSpecies = existing.species || {};
  let reusedCount = 0;
  let fetchedCount = 0;
  if (!token) {
    if (!HARD_REFRESH && Object.keys(existingSpecies).length) {
      console.warn('Missing EBIRD_API_TOKEN. Keeping existing data/ebird.json entries.');
      return { payload: existing, reusedCount: Object.keys(existingSpecies).length, fetchedCount: 0 };
    }
    console.warn('Missing EBIRD_API_TOKEN. Writing empty data/ebird.json.');
    return {
      payload: {
        species: {},
        source: {
          name: 'eBird API',
          url: 'https://ebird.org',
          taxonomy: taxonomyUrl
        }
      },
      reusedCount: 0,
      fetchedCount: 0
    };
  }

  const taxonomy = await requestJson(taxonomyUrl, { 'X-eBirdApiToken': token });
  const taxonomyByName = taxonomy.reduce((acc, entry) => {
    acc[normalizeName(entry.comName)] = entry;
    return acc;
  }, {});

  const overrides = readJson(OVERRIDES_PATH, { byFolder: {} });
  const birdFolders = listBirdFolders();
  const species = {};
  const missing = [];

  birdFolders.forEach((folder) => {
    if (!HARD_REFRESH && existingSpecies[folder]) {
      species[folder] = existingSpecies[folder];
      reusedCount += 1;
      return;
    }
    console.log(`eBird: fetching ${folder}...`);
    fetchedCount += 1;
    const overrideValue = overrides.byFolder?.[folder];
    const record = resolveOverride(folder, overrideValue, taxonomy) || taxonomyByName[normalizeName(folder)];

    if (!record) {
      missing.push(folder);
      return;
    }
    if (record.comName && record.comName !== folder) {
      console.warn(`Folder name "${folder}" does not match eBird common name "${record.comName}".`);
    }

    species[folder] = {
      scientificName: record.sciName,
      speciesCode: record.speciesCode,
      family: record.familyComName,
      order: record.order,
      region: '',
      status: '',
      habitat: '',
      diet: '',
      behavior: '',
      nesting: '',
      range: '',
      notes: ''
    };
  });

  if (missing.length) {
    console.warn('No eBird match for these folders:');
    missing.forEach((name) => console.warn(`- ${name}`));
    console.warn('Add overrides in data/ebird.overrides.json if needed.');
  }
  if (!birdFolders.length) {
    console.warn('No bird folders found in public/img. eBird data will be empty.');
  }

  return {
    payload: {
      species,
      source: {
        name: 'eBird API',
        url: 'https://ebird.org',
        taxonomy: taxonomyUrl
      }
    },
    reusedCount,
    fetchedCount
  };
}

function encodeQuery(query) {
  return encodeURIComponent(query.replace(/\s+/g, ' ').trim());
}

function extractValue(binding, key) {
  if (!binding[key]) {
    return null;
  }
  return binding[key].value || null;
}

function extractLabel(binding, key) {
  if (!binding[key]) {
    return null;
  }
  return binding[key].value || null;
}

function extractNumber(binding, key) {
  const value = extractValue(binding, key);
  if (value == null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractUnitHint(binding, unitKey, unitLabelKey) {
  const unitUri = extractValue(binding, unitKey);
  const unitLabel = (extractLabel(binding, unitLabelKey) || '').toLowerCase();
  const unitId = unitUri ? unitUri.split('/').pop() : '';
  return `${unitId} ${unitLabel}`.trim();
}

function roundFact(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const abs = Math.abs(value);
  let decimals = 3;
  if (abs >= 100) {
    decimals = 0;
  } else if (abs >= 10) {
    decimals = 1;
  } else if (abs >= 1) {
    decimals = 2;
  }
  return Number(value.toFixed(decimals));
}

function normalizeMassToKg(amount, unitHint) {
  if (!Number.isFinite(amount)) {
    return null;
  }
  const hint = (unitHint || '').toLowerCase();
  if (!hint || hint.includes('q11570') || hint.includes('kilogram')) {
    return amount;
  }
  if (hint.includes('q41803') || hint.includes('gram')) {
    return amount / 1000;
  }
  if (hint.includes('milligram')) {
    return amount / 1000000;
  }
  if (hint.includes('q100995') || hint.includes('pound')) {
    return amount * 0.45359237;
  }
  if (hint.includes('q483261') || hint.includes('ounce')) {
    return amount * 0.028349523125;
  }
  return null;
}

function normalizeLengthToMeters(amount, unitHint) {
  if (!Number.isFinite(amount)) {
    return null;
  }
  const hint = (unitHint || '').toLowerCase();
  if (!hint || hint.includes('q11573') || hint.includes('meter') || hint.includes('metre')) {
    return amount;
  }
  if (hint.includes('q174728') || hint.includes('centimeter') || hint.includes('centimetre')) {
    return amount / 100;
  }
  if (hint.includes('q174789') || hint.includes('millimeter') || hint.includes('millimetre')) {
    return amount / 1000;
  }
  if (hint.includes('q828224') || hint.includes('kilometer') || hint.includes('kilometre')) {
    return amount * 1000;
  }
  if (hint.includes('q218593') || hint.includes('inch')) {
    return amount * 0.0254;
  }
  if (hint.includes('q3710') || hint.includes('foot') || hint.includes('feet')) {
    return amount * 0.3048;
  }
  if (hint.includes('q482798') || hint.includes('yard')) {
    return amount * 0.9144;
  }
  return null;
}

function normalizeYears(amount, unitHint) {
  if (!Number.isFinite(amount)) {
    return null;
  }
  const hint = (unitHint || '').toLowerCase();
  if (!hint || hint.includes('q577') || hint.includes('year')) {
    return amount;
  }
  if (hint.includes('q5151') || hint.includes('month')) {
    return amount / 12;
  }
  if (hint.includes('q573') || hint.includes('day')) {
    return amount / 365.25;
  }
  return null;
}

function formatFact(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return String(roundFact(value));
}

function pickFirstNonEmpty(values) {
  for (const value of values) {
    if (value != null && value !== '') {
      return value;
    }
  }
  return null;
}

function pickLargest(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) {
    return null;
  }
  return Math.max(...finite);
}

function buildWikidataRecord(bindings) {
  const conservationStatuses = [];
  const audios = [];
  const nativeRanges = [];
  const wingspans = [];
  const masses = [];
  const lifespans = [];
  const bodyLengths = [];
  const heights = [];

  bindings.forEach((binding) => {
    conservationStatuses.push(extractLabel(binding, 'conservationStatusLabel'));
    audios.push(extractValue(binding, 'audio'));
    nativeRanges.push(extractLabel(binding, 'nativeRange'));

    wingspans.push(
      normalizeLengthToMeters(
        extractNumber(binding, 'wingspanAmount'),
        extractUnitHint(binding, 'wingspanUnit', 'wingspanUnitLabel')
      )
    );
    masses.push(
      normalizeMassToKg(
        extractNumber(binding, 'massAmount'),
        extractUnitHint(binding, 'massUnit', 'massUnitLabel')
      )
    );
    lifespans.push(
      normalizeYears(
        extractNumber(binding, 'lifespanAmount'),
        extractUnitHint(binding, 'lifespanUnit', 'lifespanUnitLabel')
      )
    );
    bodyLengths.push(
      normalizeLengthToMeters(
        extractNumber(binding, 'lengthAmount'),
        extractUnitHint(binding, 'lengthUnit', 'lengthUnitLabel')
      )
    );
    heights.push(
      normalizeLengthToMeters(
        extractNumber(binding, 'heightAmount'),
        extractUnitHint(binding, 'heightUnit', 'heightUnitLabel')
      )
    );
  });

  return {
    conservationStatus: pickFirstNonEmpty(conservationStatuses),
    wingspan: formatFact(pickLargest(wingspans)),
    mass: formatFact(pickLargest(masses)),
    audio: pickFirstNonEmpty(audios),
    lifespan: formatFact(pickLargest(lifespans)),
    bodyLength: formatFact(pickLargest(bodyLengths)),
    height: formatFact(pickLargest(heights)),
    nativeRange: pickFirstNonEmpty(nativeRanges)
  };
}

async function queryByScientificName(name) {
  const query = `
    SELECT ?item ?conservationStatusLabel ?audio
           ?wingspanAmount ?wingspanUnit ?wingspanUnitLabel
           ?massAmount ?massUnit ?massUnitLabel
           ?lifespanAmount ?lifespanUnit ?lifespanUnitLabel
           ?lengthAmount ?lengthUnit ?lengthUnitLabel
           ?heightAmount ?heightUnit ?heightUnitLabel
           (GROUP_CONCAT(DISTINCT ?nativeRangeLabel; separator=", ") AS ?nativeRange)
    WHERE {
      ?item wdt:P225 "${name}".
      OPTIONAL { ?item wdt:P141 ?conservationStatus. }
      OPTIONAL {
        ?item p:P2050 ?wingspanStatement.
        ?wingspanStatement psn:P2050 ?wingspanNode.
        ?wingspanNode wikibase:quantityAmount ?wingspanAmount;
                      wikibase:quantityUnit ?wingspanUnit.
      }
      OPTIONAL {
        ?item p:P2067 ?massStatement.
        ?massStatement psn:P2067 ?massNode.
        ?massNode wikibase:quantityAmount ?massAmount;
                  wikibase:quantityUnit ?massUnit.
      }
      OPTIONAL { ?item wdt:P51 ?audio. }
      OPTIONAL {
        ?item p:P2250 ?lifespanStatement.
        ?lifespanStatement psn:P2250 ?lifespanNode.
        ?lifespanNode wikibase:quantityAmount ?lifespanAmount;
                      wikibase:quantityUnit ?lifespanUnit.
      }
      OPTIONAL {
        ?item p:P2043 ?lengthStatement.
        ?lengthStatement psn:P2043 ?lengthNode.
        ?lengthNode wikibase:quantityAmount ?lengthAmount;
                    wikibase:quantityUnit ?lengthUnit.
      }
      OPTIONAL {
        ?item p:P2048 ?heightStatement.
        ?heightStatement psn:P2048 ?heightNode.
        ?heightNode wikibase:quantityAmount ?heightAmount;
                    wikibase:quantityUnit ?heightUnit.
      }
      OPTIONAL { ?item wdt:P183 ?nativeRange. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    GROUP BY ?item ?conservationStatusLabel ?audio
             ?wingspanAmount ?wingspanUnit ?wingspanUnitLabel
             ?massAmount ?massUnit ?massUnitLabel
             ?lifespanAmount ?lifespanUnit ?lifespanUnitLabel
             ?lengthAmount ?lengthUnit ?lengthUnitLabel
             ?heightAmount ?heightUnit ?heightUnitLabel
  `;
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeQuery(query)}`;
  const response = await requestJson(url, { 'User-Agent': 'birdopedia/1.0 (local script)' });
  return response.results?.bindings || [];
}

async function queryByCommonName(name) {
  const query = `
    SELECT ?item ?conservationStatusLabel ?audio
           ?wingspanAmount ?wingspanUnit ?wingspanUnitLabel
           ?massAmount ?massUnit ?massUnitLabel
           ?lifespanAmount ?lifespanUnit ?lifespanUnitLabel
           ?lengthAmount ?lengthUnit ?lengthUnitLabel
           ?heightAmount ?heightUnit ?heightUnitLabel
           (GROUP_CONCAT(DISTINCT ?nativeRangeLabel; separator=", ") AS ?nativeRange)
    WHERE {
      ?item rdfs:label "${name}"@en.
      ?item wdt:P31/wdt:P279* wd:Q16521.
      OPTIONAL { ?item wdt:P141 ?conservationStatus. }
      OPTIONAL {
        ?item p:P2050 ?wingspanStatement.
        ?wingspanStatement psn:P2050 ?wingspanNode.
        ?wingspanNode wikibase:quantityAmount ?wingspanAmount;
                      wikibase:quantityUnit ?wingspanUnit.
      }
      OPTIONAL {
        ?item p:P2067 ?massStatement.
        ?massStatement psn:P2067 ?massNode.
        ?massNode wikibase:quantityAmount ?massAmount;
                  wikibase:quantityUnit ?massUnit.
      }
      OPTIONAL { ?item wdt:P51 ?audio. }
      OPTIONAL {
        ?item p:P2250 ?lifespanStatement.
        ?lifespanStatement psn:P2250 ?lifespanNode.
        ?lifespanNode wikibase:quantityAmount ?lifespanAmount;
                      wikibase:quantityUnit ?lifespanUnit.
      }
      OPTIONAL {
        ?item p:P2043 ?lengthStatement.
        ?lengthStatement psn:P2043 ?lengthNode.
        ?lengthNode wikibase:quantityAmount ?lengthAmount;
                    wikibase:quantityUnit ?lengthUnit.
      }
      OPTIONAL {
        ?item p:P2048 ?heightStatement.
        ?heightStatement psn:P2048 ?heightNode.
        ?heightNode wikibase:quantityAmount ?heightAmount;
                    wikibase:quantityUnit ?heightUnit.
      }
      OPTIONAL { ?item wdt:P183 ?nativeRange. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    GROUP BY ?item ?conservationStatusLabel ?audio
             ?wingspanAmount ?wingspanUnit ?wingspanUnitLabel
             ?massAmount ?massUnit ?massUnitLabel
             ?lifespanAmount ?lifespanUnit ?lifespanUnitLabel
             ?lengthAmount ?lengthUnit ?lengthUnitLabel
             ?heightAmount ?heightUnit ?heightUnitLabel
  `;
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeQuery(query)}`;
  const response = await requestJson(url, { 'User-Agent': 'birdopedia/1.0 (local script)' });
  return response.results?.bindings || [];
}

async function fetchWikidata(ebirdPayload) {
  const existing = readJson(WIKIDATA_PATH, { species: {} });
  const existingSpecies = existing.species || {};
  let reusedCount = 0;
  let fetchedCount = 0;
  const speciesEntries = Object.entries(ebirdPayload.species || {});
  if (!speciesEntries.length) {
    if (!HARD_REFRESH && Object.keys(existingSpecies).length) {
      console.warn('No eBird species found. Keeping existing data/wikidata.json entries.');
      return { payload: existing, reusedCount: Object.keys(existingSpecies).length, fetchedCount: 0 };
    }
    console.warn('No eBird species found. Writing empty data/wikidata.json.');
    return {
      payload: {
        species: {},
        source: {
          name: 'Wikidata SPARQL',
          url: 'https://query.wikidata.org/'
        }
      },
      reusedCount: 0,
      fetchedCount: 0
    };
  }

  const results = {};
  for (const [commonName, info] of speciesEntries) {
    if (!HARD_REFRESH && existingSpecies[commonName]) {
      results[commonName] = existingSpecies[commonName];
      reusedCount += 1;
      continue;
    }
    console.log(`Wikidata: fetching ${commonName}...`);
    fetchedCount += 1;
    const scientificName = info.scientificName;
    let bindings = [];

    try {
      if (scientificName) {
        bindings = await queryByScientificName(scientificName);
      }
      if (!bindings.length) {
        bindings = await queryByCommonName(commonName);
      }
    } catch (error) {
      console.warn(`Wikidata request failed for ${commonName}: ${error.message || error}`);
      continue;
    }

    if (!bindings.length) {
      console.warn(`Wikidata: no match for ${commonName}.`);
      continue;
    }

    const record = buildWikidataRecord(bindings);
    const missingFields = Object.entries(record)
      .filter(([, value]) => value == null)
      .map(([key]) => key);
    if (missingFields.length) {
      console.warn(`Wikidata: missing ${missingFields.join(', ')} for ${commonName}.`);
    }
    results[commonName] = record;
  }

  return {
    payload: {
      species: results,
      source: {
        name: 'Wikidata SPARQL',
        url: 'https://query.wikidata.org/'
      }
    },
    reusedCount,
    fetchedCount
  };
}

async function fetchWikipedia(birdFolders, ebirdPayload) {
  const existing = readJson(WIKIPEDIA_PATH, { species: {} });
  const existingSpecies = existing.species || {};
  let reusedCount = 0;
  let fetchedCount = 0;

  if (!birdFolders.length) {
    if (!HARD_REFRESH && Object.keys(existingSpecies).length) {
      console.warn('No bird folders found. Keeping existing data/wikipedia.json entries.');
      return { payload: existing, reusedCount: Object.keys(existingSpecies).length, fetchedCount: 0 };
    }
    console.warn('No bird folders found. Writing empty data/wikipedia.json.');
    return {
      payload: {
        species: {},
        source: {
          name: 'Wikipedia',
          url: 'https://en.wikipedia.org',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/'
        }
      },
      reusedCount: 0,
      fetchedCount: 0
    };
  }

  const species = {};

  const resolveWikipediaEntry = async (title, label) => {
    let summarySource = 'rest';
    let summaryText = '';
    const payload = await requestJson(buildSummaryUrl(title), {
      'User-Agent': 'birdopedia/1.0 (local script)',
      Accept: 'application/json'
    });
    if (payload.type === 'disambiguation') {
      return { kind: 'disambiguation' };
    }
    if (!payload.extract) {
      return { kind: 'missing' };
    }
    summaryText = String(payload.extract || '').trim();
    if (summaryText.length < WIKIPEDIA_MIN_SUMMARY_CHARS) {
      const leadPayload = await requestJson(buildParseLeadUrl(title), {
        'User-Agent': 'birdopedia/1.0 (local script)',
        Accept: 'application/json'
      });
      const leadHtml = leadPayload.parse?.text?.['*'] || '';
      const leadParagraphs = extractLeadParagraphs(leadHtml);
      const leadSummary = buildSummaryFromParagraphs(leadParagraphs);
      if (leadSummary && leadSummary.length > summaryText.length) {
        summaryText = leadSummary;
        summarySource = 'lead';
      }
    }
    if (summaryText.length < WIKIPEDIA_MIN_SUMMARY_CHARS) {
      const extractPayload = await requestJson(buildExtractUrl(title, 1200), {
        'User-Agent': 'birdopedia/1.0 (local script)',
        Accept: 'application/json'
      });
      const pages = extractPayload.query?.pages || {};
      const page = Object.values(pages)[0];
      const extractText = page && page.extract ? String(page.extract).trim() : '';
      if (extractText && extractText.length > summaryText.length) {
        summaryText = extractText;
        summarySource = 'extracts';
      }
    }

    summaryText = sanitizeSummary(summaryText);

    let description = '';
    try {
      const descriptionPayload = await requestJson(buildDescriptionUrl(title), {
        'User-Agent': 'birdopedia/1.0 (local script)',
        Accept: 'application/json'
      });
      const descriptionPages = descriptionPayload.query?.pages || {};
      const descriptionPage = Object.values(descriptionPages)[0];
      if (descriptionPage && descriptionPage.description) {
        description = String(descriptionPage.description).trim();
      }
    } catch (error) {
      console.warn(`Wikipedia: description fetch failed for ${label || title}.`);
    }

    const pageUrl =
      (payload.content_urls && payload.content_urls.desktop && payload.content_urls.desktop.page) ||
      (payload.content_urls && payload.content_urls.mobile && payload.content_urls.mobile.page) ||
      '';

    return {
      kind: 'ok',
      entry: {
        title: payload.title || title,
        summary: summaryText,
        summarySource,
        description,
        url: pageUrl,
        timestamp: payload.timestamp || ''
      }
    };
  };

  for (const folderName of birdFolders) {
    if (!HARD_REFRESH && existingSpecies[folderName]) {
      species[folderName] = existingSpecies[folderName];
      reusedCount += 1;
      continue;
    }

    console.log(`Wikipedia: fetching ${folderName}...`);
    fetchedCount += 1;

    try {
      const scientificName = ebirdPayload?.species?.[folderName]?.scientificName;
      let result = null;

      if (scientificName) {
        const scientificResult = await resolveWikipediaEntry(scientificName, folderName);
        if (scientificResult.kind === 'ok') {
          result = scientificResult;
        } else if (scientificResult.kind === 'disambiguation' || scientificResult.kind === 'missing') {
          result = await resolveWikipediaEntry(folderName, folderName);
        } else {
          result = scientificResult;
        }
      } else {
        result = await resolveWikipediaEntry(folderName, folderName);
      }

      if (result && result.kind === 'ok') {
        species[folderName] = result.entry;
        continue;
      }

      if (result && result.kind === 'disambiguation') {
        console.warn(`Wikipedia: disambiguation page for ${folderName}.`);
      } else {
        console.warn(`Wikipedia: no summary extract for ${folderName}.`);
      }
    } catch (error) {
      console.warn(`Wikipedia request failed for ${folderName}: ${error.message || error}`);
    }
  }

  return {
    payload: {
      species,
      source: {
        name: 'Wikipedia',
        url: 'https://en.wikipedia.org',
        license: 'CC BY-SA 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/'
      }
    },
    reusedCount,
    fetchedCount
  };
}

async function fetchGeocodes(birdFolders, email) {
  const cache = readJson(GEOCODE_PATH, {
    points: {},
    source: { name: 'Nominatim', url: 'https://nominatim.openstreetmap.org/' },
    updatedAt: null
  });
  cache.points = cache.points || {};
  cache.source = cache.source || { name: 'Nominatim', url: 'https://nominatim.openstreetmap.org/' };

  const targets = new Map();
  for (const folderName of birdFolders) {
    const imageFiles = listImages(folderName);
    for (const filename of imageFiles) {
      const imagePath = path.join(IMG_DIR, folderName, filename);
      let exif = {};
      try {
        exif = await exifr.parse(imagePath, { gps: true });
      } catch (error) {
        console.warn(`Geocode: failed to read GPS for ${path.join(folderName, filename)}.`);
        continue;
      }
      const lat = firstNumber(exif?.GPSLatitude, exif?.latitude);
      const lon = firstNumber(exif?.GPSLongitude, exif?.longitude);
      const key = geocodeKey(lat, lon);
      if (key && !targets.has(key)) {
        targets.set(key, { lat, lon });
      }
    }
  }

  const missingKeys = Array.from(targets.keys()).filter((key) => !cache.points[key]);
  let fetchedCount = 0;
  let reusedCount = Object.keys(cache.points).length;
  if (missingKeys.length) {
    console.log(`Geocode: resolving ${missingKeys.length} location${missingKeys.length === 1 ? '' : 's'}.`);
    for (let index = 0; index < missingKeys.length; index += 1) {
      const key = missingKeys[index];
      const target = targets.get(key);
      if (!target) {
        continue;
      }
      const result = await reverseGeocode(target.lat, target.lon, email, cache);
      if (result === 'fetched') {
        fetchedCount += 1;
        if (index < missingKeys.length - 1) {
          await sleep(1100);
        }
      }
    }
  }

  return { cache, fetchedCount, reusedCount };
}

async function main() {
  ensureDir(DATA_DIR);
  ensureOverridesFile();
  if (HARD_REFRESH) {
    console.log('Running in --hard mode: refreshing all species data.');
  }

  const env = readEnvFile(ENV_PATH);
  const token = process.env.EBIRD_API_TOKEN || env.EBIRD_API_TOKEN;
  const geocodeEmail = process.env.GEOCODE_EMAIL || env.GEOCODE_EMAIL;

  const ebirdResult = await fetchEbirdSpecies(token);
  const ebirdPayload = ebirdResult.payload;
  const shouldWriteEbird = HARD_REFRESH || ebirdResult.fetchedCount > 0 || !fs.existsSync(EBIRD_PATH);
  if (shouldWriteEbird) {
    fs.writeFileSync(EBIRD_PATH, JSON.stringify(ebirdPayload, null, 2));
    console.log(
      `Wrote ${Object.keys(ebirdPayload.species || {}).length} species to ${EBIRD_PATH} (fetched ${ebirdResult.fetchedCount}, reused ${ebirdResult.reusedCount}).`
    );
  } else {
    console.log(`No eBird updates; reused ${ebirdResult.reusedCount} cached species.`);
  }

  const wikidataResult = await fetchWikidata(ebirdPayload);
  const wikidataPayload = wikidataResult.payload;
  const shouldWriteWikidata =
    HARD_REFRESH || wikidataResult.fetchedCount > 0 || !fs.existsSync(WIKIDATA_PATH);
  if (shouldWriteWikidata) {
    fs.writeFileSync(WIKIDATA_PATH, JSON.stringify(wikidataPayload, null, 2));
    console.log(
      `Wrote Wikidata facts for ${Object.keys(wikidataPayload.species || {}).length} species (fetched ${wikidataResult.fetchedCount}, reused ${wikidataResult.reusedCount}).`
    );
  } else {
    console.log(`No Wikidata updates; reused ${wikidataResult.reusedCount} cached species.`);
  }

  const birdFolders = listBirdFolders();
  const wikipediaResult = await fetchWikipedia(birdFolders, ebirdPayload);
  const wikipediaPayload = wikipediaResult.payload;
  const shouldWriteWikipedia =
    HARD_REFRESH || wikipediaResult.fetchedCount > 0 || !fs.existsSync(WIKIPEDIA_PATH);
  if (shouldWriteWikipedia) {
    fs.writeFileSync(WIKIPEDIA_PATH, JSON.stringify(wikipediaPayload, null, 2));
    console.log(
      `Wrote Wikipedia summaries for ${Object.keys(wikipediaPayload.species || {}).length} species (fetched ${wikipediaResult.fetchedCount}, reused ${wikipediaResult.reusedCount}).`
    );
  } else {
    console.log(`No Wikipedia updates; reused ${wikipediaResult.reusedCount} cached species.`);
  }

  const geocodeResult = await fetchGeocodes(birdFolders, geocodeEmail);
  const shouldWriteGeocode =
    HARD_REFRESH || geocodeResult.fetchedCount > 0 || !fs.existsSync(GEOCODE_PATH);
  if (shouldWriteGeocode) {
    fs.writeFileSync(GEOCODE_PATH, JSON.stringify(geocodeResult.cache, null, 2));
    console.log(
      `Wrote ${Object.keys(geocodeResult.cache.points || {}).length} geocoded location(s) (fetched ${geocodeResult.fetchedCount}, reused ${geocodeResult.reusedCount}).`
    );
  } else {
    console.log(`No geocode updates; reused ${geocodeResult.reusedCount} cached locations.`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
