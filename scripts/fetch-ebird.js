const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const IMG_DIR = path.join(ROOT, 'public', 'img');
const OUTPUT_PATH = path.join(ROOT, 'data', 'ebird.json');
const OVERRIDES_PATH = path.join(ROOT, 'data', 'ebird.overrides.json');
const ENV_PATH = path.join(ROOT, '.env');

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

function loadOverrides() {
  if (!fs.existsSync(OVERRIDES_PATH)) {
    return { byFolder: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'));
  } catch (error) {
    return { byFolder: {} };
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

function requestJson(url, headers) {
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

async function main() {
  const env = readEnvFile(ENV_PATH);
  const token = process.env.EBIRD_API_TOKEN || env.EBIRD_API_TOKEN;
  if (!token) {
    console.error('Missing EBIRD_API_TOKEN. Add it to .env or environment variables.');
    process.exit(1);
  }

  const taxonomyUrl = 'https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json&cat=species&locale=en';
  const taxonomy = await requestJson(taxonomyUrl, { 'X-eBirdApiToken': token });

  const taxonomyByName = taxonomy.reduce((acc, entry) => {
    acc[normalizeName(entry.comName)] = entry;
    return acc;
  }, {});

  const overrides = loadOverrides();
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

  const payload = {
    species,
    source: {
      name: 'eBird API',
      url: 'https://ebird.org',
      taxonomy: taxonomyUrl
    }
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${Object.keys(species).length} species to ${OUTPUT_PATH}`);

  if (missing.length) {
    console.warn('No eBird match for these folders:');
    missing.forEach((name) => console.warn(`- ${name}`));
    console.warn('Add overrides in data/ebird.overrides.json if needed.');
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
