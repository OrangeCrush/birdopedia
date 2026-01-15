const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const EBIRD_PATH = path.join(ROOT, 'data', 'ebird.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'wikidata.json');

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'birdopedia/1.0 (local script)' } }, (res) => {
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
  const response = await requestJson(url);
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
  const response = await requestJson(url);
  return response.results.bindings[0] || null;
}

async function main() {
  const ebird = readJson(EBIRD_PATH, { species: {} });
  const speciesEntries = Object.entries(ebird.species || {});
  const results = {};

  for (const [commonName, info] of speciesEntries) {
    const scientificName = info.scientificName;
    let binding = null;

    if (scientificName) {
      binding = await queryByScientificName(scientificName);
    }
    if (!binding) {
      binding = await queryByCommonName(commonName);
    }

    if (!binding) {
      console.warn(`Wikidata: no match for ${commonName}.`);
      continue;
    }

    results[commonName] = {
      conservationStatus: extractLabel(binding, 'conservationStatusLabel'),
      wingspan: extractValue(binding, 'wingspan'),
      mass: extractValue(binding, 'mass'),
      audio: extractValue(binding, 'audio')
    };
  }

  const payload = {
    species: results,
    source: {
      name: 'Wikidata SPARQL',
      url: 'https://query.wikidata.org/'
    }
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`Wrote Wikidata facts for ${Object.keys(results).length} species.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
