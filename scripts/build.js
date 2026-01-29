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
  if (!exif || Object.keys(exif).length === 0) {
    console.warn(`EXIF: no metadata found for ${path.join(birdName, filename)}.`);
  }
  const ext = path.extname(filename).toLowerCase();
  const avifName = ext === '.jpg' || ext === '.jpeg'
    ? `${path.basename(filename, ext)}.avif`
    : null;
  const imageSrc = avifName
    ? toWebPath('img', birdName, avifName)
    : toWebPath('img', birdName, filename);
  const originalSrc = toWebPath('img', birdName, filename);
  const stat = fs.statSync(imagePath);
  const camera = [exif.Make, exif.Model].filter(Boolean).join(' ').trim();
  const gps = formatGps(
    firstNumber(exif.GPSLatitude, exif.latitude),
    firstNumber(exif.GPSLongitude, exif.longitude)
  );
  const captureDateRaw =
    exif.SubSecDateTimeOriginal ||
    exif.DateTimeOriginal ||
    exif.SubSecCreateDate ||
    exif.CreateDate ||
    exif.FileModifyDate ||
    exif.ModifyDate;
  const offset = exif.OffsetTimeOriginal || exif.OffsetTime || exif.OffsetTimeDigitized;
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
  const megapixelsRaw = Number.isFinite(exif.Megapixels)
    ? exif.Megapixels
    : width && height
      ? (width * height) / 1000000
      : null;

  return {
    filename,
    src: imageSrc,
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

function renderIndex(birds, collectionStats, featuredImage, featuredImages, recentCaptures) {
  const listing = birds
    .map((bird) => {
      const href = `/${toWebPath('birdopedia', bird.name, 'index.html')}`;
      const latestAttr = bird.latestIso ? ` data-latest-capture="${bird.latestIso}"` : '';
      return `
        <li class="bird-card"${latestAttr}>
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

  const authorLine = [config.authorName, config.authorLocation].filter(Boolean).join(' • ');
  const ebirdLink = config.ebirdProfileUrl
    ? `<a class="meta-link" href="${config.ebirdProfileUrl}">eBird profile</a>`
    : '';
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
              return `
              <a class="recent-captures__card" href="${capture.speciesHref}">
                <div class="recent-captures__thumb media-frame">
                  <img class="media-image media-fade" src="/${capture.src}" alt="${capture.bird} recent capture" loading="lazy" decoding="async" />
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
    <header class="site-hero">
      <div class="site-hero__content">
        <p class="eyebrow">Photographic Field Notes</p>
        <h1>Birdopedia</h1>
        <p class="lede">${bio}</p>
        <div class="hero-meta">
          <span>${authorLine || 'Author information missing'} ${ebirdLink ? `• ${ebirdLink}` : ''}</span>
          <span>${collectionStats.totalSpecies} species • ${collectionStats.totalPhotos} photographs</span>
        </div>
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
      const gpsSection = image.gps
        ? `<a class="meta-link" href="${image.gps.link}" target="_blank" rel="noopener noreferrer">${image.gps.display}</a>`
        : 'Unknown';
      const isJpeg = /\.(jpe?g)$/i.test(image.filename);
      const downloadLabel = isJpeg ? 'Full Size JPEG' : 'Download original';
      const downloadLink = image.originalSrc
        ? `<a class="meta-link meta-link--download" href="/${image.originalSrc}" download>${downloadLabel}</a>`
        : 'Unknown';

      return `
        <article class="image-card">
          <div class="image-card__thumb media-frame">
            <img
              class="media-image media-fade"
              src="/${image.src}"
              alt="${bird.name} photograph ${index + 1}"
              loading="lazy"
              decoding="async"
            />
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
    ['Mass (kg)', profile.mass],
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
      </div>`
    : `
      <div class="species-panel">
        <div class="section-title">
          <h2>Species Profile</h2>
          <p class="empty-note">Add species profile data in data/ebird.json to enrich this page.</p>
        </div>
      </div>`;

  const content = `
    <header class="bird-hero">
      <div class="bird-hero__summary">
        <a class="back-link" href="/birdopedia/index.html">← Back to index</a>
        <p class="eyebrow">${bird.images.length} photograph${bird.images.length === 1 ? '' : 's'}</p>
        <h1>${bird.name}</h1>
        <p class="lede">${profile.scientificName || 'Species profile pending.'}</p>
        <p class="species-code">eBird code: ${profile.speciesCode || 'Unknown'}</p>
        ${wikidataAudio ? `<div class="bird-audio">${wikidataAudio}</div>` : ''}
      </div>
      <div class="bird-hero__media">
        <div class="carousel" data-count="${bird.images.length}">
          ${bird.images.length > 1 ? '<button class="carousel__btn" data-dir="prev" aria-label="Previous image">‹</button>' : ''}
          <div class="carousel__viewport media-frame">
            ${carouselImages}
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
    </header>

    <section class="image-details">
      <div class="section-title">
        <h2>Image Details</h2>
        <p>Metadata extracted from the camera files.</p>
      </div>
      <div class="image-grid">
        ${imageCards}
      </div>
    </section>

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
  if (fs.existsSync(stylesSource)) {
    fs.copyFileSync(stylesSource, path.join(SITE_DIR, 'styles.css'));
  }
  if (fs.existsSync(scriptSource)) {
    fs.copyFileSync(scriptSource, path.join(SITE_DIR, 'bird.js'));
  }
  if (fs.existsSync(indexScriptSource)) {
    fs.copyFileSync(indexScriptSource, path.join(SITE_DIR, 'index.js'));
  }

  const allBirds = listBirds();
  const avifCandidates = allBirds.flatMap((birdName) =>
    listImages(birdName)
      .map((filename) => path.join(IMG_DIR, birdName, filename))
      .filter((imagePath) => avifTargetPath(imagePath))
  );
  const avifPending = avifCandidates.filter((imagePath) => needsAvifVariant(imagePath));
  const avifTotal = avifPending.length;
  const avifPendingSet = new Set(avifPending);
  console.log(`building ${avifTotal} avif file${avifTotal === 1 ? '' : 's'}`);
  let avifCreated = 0;
  let avifIndex = 0;
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
        continue;
      }
      if (!avifPendingSet.has(imagePath)) {
        continue;
      }
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
    latestIso: bird.latestIso
  }));

  const featuredImages = populatedBirds.length
    ? populatedBirds.flatMap((bird) => {
        const speciesHref = `/${toWebPath('birdopedia', bird.name, 'index.html')}`;
        return bird.images.map((image) => ({
          bird: bird.name,
          src: image.src,
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
        captureDate: latestImage.captureDate,
        captureDateIso: latestImage.captureDateIso,
        speciesHref
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.captureDateIso) - new Date(a.captureDateIso))
    .slice(0, 6);

  const indexHtml = renderIndex(birdSummaries, collectionStats, null, featuredImages, recentCaptures);
  fs.writeFileSync(path.join(SITE_DIR, 'index.html'), indexHtml);
  fs.writeFileSync(path.join(PUBLIC_DIR, 'index.html'), indexHtml);

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
  console.log(`Built ${populatedBirds.length} bird page(s).`);
}

build().catch((error) => {
  console.error('Build failed.', error);
  process.exitCode = 1;
});
