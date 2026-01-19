const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const IMG_DIR = path.join(ROOT, 'public', 'img');
const DATA_DIR = path.join(ROOT, 'data');
const EBIRD_PATH = path.join(DATA_DIR, 'ebird.json');
const WIKIDATA_PATH = path.join(DATA_DIR, 'wikidata.json');
const OVERRIDES_PATH = path.join(DATA_DIR, 'ebird.overrides.json');
const ENV_PATH = path.join(ROOT, '.env');

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
  if (!token) {
    console.warn('Missing EBIRD_API_TOKEN. Writing empty data/ebird.json.');
    return {
      species: {},
      source: {
        name: 'eBird API',
        url: 'https://ebird.org',
        taxonomy: taxonomyUrl
      }
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
    const overrideValue = overrides.byFolder?.[folder];
    const record = resolveOverride(folder, overrideValue, taxonomy) || taxonomyByName[normalizeName(folder)];

    if (!record) {
      missing.push(folder);
      return;
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
    species,
    source: {
      name: 'eBird API',
      url: 'https://ebird.org',
      taxonomy: taxonomyUrl
    }
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

async function queryByScientificName(name) {
  const query = `
    SELECT ?item ?conservationStatusLabel ?wingspan ?mass ?audio
    WHERE {
      ?item wdt:P225 "${name}".
      OPTIONAL { ?item wdt:P141 ?conservationStatus. }
      OPTIONAL { ?item wdt:P2050 ?wingspan. }
      OPTIONAL { ?item wdt:P2067 ?mass. }
      OPTIONAL { ?item wdt:P51 ?audio. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 1
  `;
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeQuery(query)}`;
  const response = await requestJson(url, { 'User-Agent': 'birdopedia/1.0 (local script)' });
  return response.results.bindings[0] || null;
}

async function queryByCommonName(name) {
  const query = `
    SELECT ?item ?conservationStatusLabel ?wingspan ?mass ?audio
    WHERE {
      ?item rdfs:label "${name}"@en.
      ?item wdt:P31/wdt:P279* wd:Q16521.
      OPTIONAL { ?item wdt:P141 ?conservationStatus. }
      OPTIONAL { ?item wdt:P2050 ?wingspan. }
      OPTIONAL { ?item wdt:P2067 ?mass. }
      OPTIONAL { ?item wdt:P51 ?audio. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 1
  `;
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeQuery(query)}`;
  const response = await requestJson(url, { 'User-Agent': 'birdopedia/1.0 (local script)' });
  return response.results.bindings[0] || null;
}

async function fetchWikidata(ebirdPayload) {
  const speciesEntries = Object.entries(ebirdPayload.species || {});
  if (!speciesEntries.length) {
    console.warn('No eBird species found. Writing empty data/wikidata.json.');
    return {
      species: {},
      source: {
        name: 'Wikidata SPARQL',
        url: 'https://query.wikidata.org/'
      }
    };
  }

  const results = {};
  for (const [commonName, info] of speciesEntries) {
    const scientificName = info.scientificName;
    let binding = null;

    try {
      if (scientificName) {
        binding = await queryByScientificName(scientificName);
      }
      if (!binding) {
        binding = await queryByCommonName(commonName);
      }
    } catch (error) {
      console.warn(`Wikidata request failed for ${commonName}: ${error.message || error}`);
      continue;
    }

    if (!binding) {
      console.warn(`Wikidata: no match for ${commonName}.`);
      continue;
    }

    const record = {
      conservationStatus: extractLabel(binding, 'conservationStatusLabel'),
      wingspan: extractValue(binding, 'wingspan'),
      mass: extractValue(binding, 'mass'),
      audio: extractValue(binding, 'audio')
    };
    const missingFields = Object.entries(record)
      .filter(([, value]) => value == null)
      .map(([key]) => key);
    if (missingFields.length) {
      console.warn(`Wikidata: missing ${missingFields.join(', ')} for ${commonName}.`);
    }
    results[commonName] = record;
  }

  return {
    species: results,
    source: {
      name: 'Wikidata SPARQL',
      url: 'https://query.wikidata.org/'
    }
  };
}

async function main() {
  ensureDir(DATA_DIR);
  ensureOverridesFile();

  const env = readEnvFile(ENV_PATH);
  const token = process.env.EBIRD_API_TOKEN || env.EBIRD_API_TOKEN;

  const ebirdPayload = await fetchEbirdSpecies(token);
  fs.writeFileSync(EBIRD_PATH, JSON.stringify(ebirdPayload, null, 2));
  console.log(`Wrote ${Object.keys(ebirdPayload.species || {}).length} species to ${EBIRD_PATH}`);

  const wikidataPayload = await fetchWikidata(ebirdPayload);
  fs.writeFileSync(WIKIDATA_PATH, JSON.stringify(wikidataPayload, null, 2));
  console.log(`Wrote Wikidata facts for ${Object.keys(wikidataPayload.species || {}).length} species.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
