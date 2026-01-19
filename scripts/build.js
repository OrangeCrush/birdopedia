const fs = require('fs');
const path = require('path');
const exifr = require('exifr');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const IMG_DIR = path.join(PUBLIC_DIR, 'img');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const EBIRD_PATH = path.join(ROOT, 'data', 'ebird.json');

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

function toWebPath(...parts) {
  const joined = parts.join('/');
  return encodeURI(joined.replace(/\\/g, '/'));
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
  return date.toISOString().replace('T', ' ').slice(0, 19);
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
    src: toWebPath('img', birdName, filename),
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
    <link rel="stylesheet" href="/styles.css" />
    ${extraHead}
  </head>
  <body class="${bodyClass}">
    ${content}
    ${extraScripts}
  </body>
</html>`;
}

function renderIndex(birds, collectionStats) {
  const listing = birds
    .map((bird) => {
      const href = `/${toWebPath('img', bird.name, 'index.html')}`;
      return `
        <li class="bird-card">
          <a class="bird-card__link" href="${href}">
            <span class="bird-card__name">${bird.name}</span>
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
      <div class="site-hero__panel">
        <div class="stat">
          <span class="stat__label">Earliest capture</span>
          <strong>${collectionStats.earliest || 'Unknown'}</strong>
        </div>
        <div class="stat">
          <span class="stat__label">Latest capture</span>
          <strong>${collectionStats.latest || 'Unknown'}</strong>
        </div>
        <div class="stat">
          <span class="stat__label">Camera kit</span>
          <strong>${collectionStats.topCamera || 'Unknown'}</strong>
        </div>
      </div>
    </header>

    <main class="index-main">
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
    content
  });
}

function renderBirdPage(bird, ebirdInfo) {
  const wikidataInfo = wikidata.species?.[bird.name] || {};
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
          class="carousel__image${index === 0 ? ' is-active' : ''}"
          src="/${image.src}"
          alt="${bird.name} photograph ${index + 1}"
          data-caption-date="${image.captureDateIso || ''}"
          data-caption-camera="${image.camera}"
          data-caption-lens="${image.lens}"
          data-aperture="${image.aperture}"
          data-shutter="${image.exposure}"
          data-iso="${image.iso}"
        />`;
    })
    .join('');

  const dots = bird.images.length > 1
    ? bird.images
        .map((_, index) => `<button class="carousel__dot${index === 0 ? ' is-active' : ''}" data-index="${index}" aria-label="Go to image ${index + 1}"></button>`)
        .join('')
    : '';

  const imageCards = bird.images
    .map((image) => {
      const gpsSection = image.gps
        ? `<a class="meta-link" href="${image.gps.link}">${image.gps.display}</a>`
        : 'Unknown';

      return `
        <article class="image-card">
          <div class="image-card__thumb" style="background-image: url('/${image.src}')"></div>
          <div class="image-card__body">
            <dl>
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
    ['Mass (kg)', profile.mass]
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

  const profileSection = hasProfileItems || hasNarrative
    ? `
      <div class="species-panel">
        <div class="section-title">
          <h2>Species Profile</h2>
          <p>Reference notes sourced from ${ebird.source?.name || 'eBird'} and ${wikidata.source?.name || 'Wikidata'}.</p>
        </div>
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
      <div class="bird-hero__info">
        <a class="back-link" href="/index.html">← Back to index</a>
        <p class="eyebrow">${bird.images.length} photograph${bird.images.length === 1 ? '' : 's'}</p>
        <h1>${bird.name}</h1>
        <p class="lede">${profile.scientificName || 'Species profile pending.'}</p>
        <p class="species-code">eBird code: ${profile.speciesCode || 'Unknown'}</p>
        ${wikidataAudio ? `<div class="bird-audio">${wikidataAudio}</div>` : ''}
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
      <div class="bird-hero__media">
        <div class="carousel" data-count="${bird.images.length}">
          ${bird.images.length > 1 ? '<button class="carousel__btn" data-dir="prev" aria-label="Previous image">‹</button>' : ''}
          <div class="carousel__viewport">
            ${carouselImages}
          </div>
          ${bird.images.length > 1 ? '<button class="carousel__btn" data-dir="next" aria-label="Next image">›</button>' : ''}
          ${dots ? `<div class="carousel__dots">${dots}</div>` : ''}
          <p class="carousel__caption" data-caption>${bird.images[0]?.captureDate || ''} • ${bird.images[0]?.camera || ''} • ${bird.images[0]?.lens || ''}</p>
          <div class="carousel__meta" data-carousel-meta>
            <span data-meta="iso">ISO: ${bird.images[0]?.iso || 'Unknown'}</span>
            <span data-meta="shutter">Shutter: ${bird.images[0]?.exposure || 'Unknown'}</span>
            <span data-meta="aperture">Aperture: ${bird.images[0]?.aperture || 'Unknown'}</span>
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

    <footer class="site-footer">
      <span>${config.authorName || 'The photographer'} • ${bird.images.length} frames of ${bird.name}</span>
    </footer>`;

  return renderLayout({
    title: bird.name,
    description: `Photography and field notes for ${bird.name}.`,
    bodyClass: 'page-bird',
    content,
    extraScripts: '<script src="/bird.js"></script>'
  });
}

async function build() {
  if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  }

  const stylesSource = path.join(TEMPLATES_DIR, 'styles.css');
  const scriptSource = path.join(TEMPLATES_DIR, 'bird.js');
  if (fs.existsSync(stylesSource)) {
    fs.copyFileSync(stylesSource, path.join(PUBLIC_DIR, 'styles.css'));
  }
  if (fs.existsSync(scriptSource)) {
    fs.copyFileSync(scriptSource, path.join(PUBLIC_DIR, 'bird.js'));
  }

  const birds = await Promise.all(listBirds().map(async (birdName) => {
    const imageFiles = listImages(birdName);
    if (imageFiles.length === 0) {
      console.warn(`Warning: No images found for ${birdName}.`);
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

    const earliest = dates[0] ? dates[0].toISOString().slice(0, 10) : null;
    const latest = dates[dates.length - 1] ? dates[dates.length - 1].toISOString().slice(0, 10) : null;

    return {
      name: birdName,
      images,
      count: images.length,
      earliest,
      latest,
      locationCount: gpsCount
    };
  }));

  const allDates = birds
    .flatMap((bird) => bird.images.map((image) => normalizeExifDate(image.captureDateRaw)))
    .filter(Boolean)
    .sort((a, b) => a - b);

  const cameraCounts = birds
    .flatMap((bird) => bird.images.map((image) => image.camera))
    .filter((camera) => camera && camera !== 'Unknown')
    .reduce((acc, camera) => {
      acc[camera] = (acc[camera] || 0) + 1;
      return acc;
    }, {});

  const topCamera = Object.entries(cameraCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const collectionStats = {
    totalSpecies: birds.length,
    totalPhotos: birds.reduce((sum, bird) => sum + bird.count, 0),
    earliest: allDates[0] ? allDates[0].toISOString().slice(0, 10) : null,
    latest: allDates[allDates.length - 1] ? allDates[allDates.length - 1].toISOString().slice(0, 10) : null,
    topCamera
  };

  const birdSummaries = birds.map((bird) => ({
    name: bird.name,
    count: bird.count,
    latest: bird.latest
  }));

  fs.writeFileSync(path.join(PUBLIC_DIR, 'index.html'), renderIndex(birdSummaries, collectionStats));

  birds.forEach((bird) => {
    const ebirdInfo = ebird.species?.[bird.name];
    const birdHtml = renderBirdPage(bird, ebirdInfo);
    fs.writeFileSync(path.join(IMG_DIR, bird.name, 'index.html'), birdHtml);
  });

  console.log(`Built ${birds.length} bird page(s).`);
}

build().catch((error) => {
  console.error('Build failed.', error);
  process.exitCode = 1;
});
