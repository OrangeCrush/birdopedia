(() => {
  const applyImageLoadingEffects = (root = document) => {
    const images = Array.from(root.querySelectorAll('img.media-image'));
    if (!images.length) {
      return;
    }
    images.forEach((img) => {
      const frame = img.closest('.media-frame');
      const markLoaded = () => {
        img.classList.add('is-loaded');
        if (frame) {
          frame.classList.add('is-loaded');
        }
      };
      if (img.complete && img.naturalWidth > 0) {
        markLoaded();
        return;
      }
      img.addEventListener('load', markLoaded, { once: true });
      img.addEventListener('error', markLoaded, { once: true });
    });
  };

  const dataNode = document.getElementById('map-data');
  if (!dataNode) {
    return;
  }
  let payload;
  try {
    payload = JSON.parse(dataNode.textContent || '{}');
  } catch (error) {
    return;
  }
  if (!payload || !Array.isArray(payload.points)) {
    return;
  }

  const mapEl = document.getElementById('field-map');
  if (!mapEl) {
    return;
  }

  const spotlight = document.querySelector('[data-spotlight]');
  const spotlightImage = spotlight ? spotlight.querySelector('img') : null;
  const spotlightTitle = spotlight ? spotlight.querySelector('h2') : null;
  const spotlightDate = spotlight ? spotlight.querySelector('.map-spotlight__date') : null;
  const spotlightMeta = spotlight ? spotlight.querySelector('.map-spotlight__meta') : null;
  const spotlightLink = spotlight ? spotlight.querySelector('a') : null;

  const speciesSelect = document.getElementById('map-species');
  const focusSelect = document.getElementById('map-toggle-latest');
  const params = new URLSearchParams(window.location.search);
  const requestedSpecies = params.get('species');
  const requestedFocus = params.get('focus');
  const requestedImage = params.get('image');

  const palette = [
    '#c56b2c',
    '#6e7b3f',
    '#3e6b71',
    '#7e4f8b',
    '#b2463b',
    '#2f6b9f',
    '#b5852a',
    '#4b7c5b',
    '#8a5a3a',
    '#46678f',
    '#9a7a4a',
    '#7b6a54'
  ];

  const hashSpecies = (value) => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  };

  const getColor = (species) => palette[hashSpecies(species) % palette.length];

  const map = L.map(mapEl, {
    zoomControl: true,
    scrollWheelZoom: false,
    tap: false
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  mapEl.addEventListener('mouseenter', () => {
    map.scrollWheelZoom.enable();
  });
  mapEl.addEventListener('mouseleave', () => {
    map.scrollWheelZoom.disable();
  });

  if (payload.bounds) {
    const bounds = L.latLngBounds([
      [payload.bounds.minLat, payload.bounds.minLon],
      [payload.bounds.maxLat, payload.bounds.maxLon]
    ]);
    map.fitBounds(bounds.pad(0.2));
  } else {
    map.setView([37.8, -96.9], 4);
  }

  const markers = new Map();

  const buildPopup = (point) => {
    const metaLine = [point.captureDate, point.camera, point.lens].filter(Boolean).join(' • ');
    const locationLine = point.locationLabel || '';
    const pointHref = point.filename
      ? `${point.speciesHref}?image=${encodeURIComponent(point.filename)}`
      : point.speciesHref;
    return `
      <div class="map-popup">
        <img src="/${point.src}" alt="${point.bird} photograph" loading="lazy" decoding="async" />
        <div class="map-popup__meta">
          <strong>${point.bird}</strong>
          <span>${metaLine || 'Metadata unavailable'}</span>
          ${locationLine ? `<span>${locationLine}</span>` : ''}
          <a href="${pointHref}">Open species page →</a>
        </div>
      </div>`;
  };

  const updateSpotlight = (point) => {
    if (!spotlight || !point) {
      return;
    }
    if (spotlightImage) {
      spotlightImage.src = `/${point.src}`;
      spotlightImage.alt = `${point.bird} photograph`;
    }
    if (spotlightTitle) {
      spotlightTitle.textContent = point.bird;
    }
    if (spotlightDate) {
      spotlightDate.textContent = point.captureDate || 'Unknown capture date';
    }
    if (spotlightMeta) {
      const parts = [
        point.camera,
        point.lens,
        point.aperture,
        point.exposure,
        point.iso,
        point.locationLabel
      ].filter(Boolean);
      spotlightMeta.textContent = parts.length ? parts.join(' • ') : 'Metadata unavailable';
    }
    if (spotlightLink) {
      spotlightLink.href = point.filename
        ? `${point.speciesHref}?image=${encodeURIComponent(point.filename)}`
        : point.speciesHref;
    }
    applyImageLoadingEffects(spotlight);
  };

  const clearMarkers = () => {
    markers.forEach((marker) => {
      map.removeLayer(marker);
    });
    markers.clear();
  };

  const applyFilters = () => {
    const selected = speciesSelect ? speciesSelect.value.trim().toLowerCase() : '';
    const focus = focusSelect ? focusSelect.value : 'all';

    let points = payload.points.slice();

    if (focus === 'latest') {
      const latestBySpecies = new Map();
      points.forEach((point) => {
        const existing = latestBySpecies.get(point.bird);
        if (!existing) {
          latestBySpecies.set(point.bird, point);
          return;
        }
        const currentDate = point.captureDateIso ? new Date(point.captureDateIso).getTime() : 0;
        const existingDate = existing.captureDateIso ? new Date(existing.captureDateIso).getTime() : 0;
        if (currentDate > existingDate) {
          latestBySpecies.set(point.bird, point);
        }
      });
      points = Array.from(latestBySpecies.values());
    }

    if (selected) {
      points = points.filter((point) => point.bird.toLowerCase() === selected);
    }

    clearMarkers();

    points.forEach((point) => {
      const color = getColor(point.bird);
      const marker = L.circleMarker([point.lat, point.lon], {
        radius: 6,
        weight: 2,
        color,
        fillColor: color,
        fillOpacity: 0.75
      });
      marker.bindPopup(buildPopup(point), { maxWidth: 260 });
      marker.on('click', () => updateSpotlight(point));
      marker.addTo(map);
      markers.set(point.id, marker);
    });

    if (points.length) {
      updateSpotlight(points[0]);
    }
    return points;
  };

  if (speciesSelect) {
    speciesSelect.addEventListener('change', applyFilters);
  }
  if (focusSelect) {
    focusSelect.addEventListener('change', applyFilters);
  }

  const recentButtons = Array.from(document.querySelectorAll('.map-recent__item'));
  recentButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.dataset.point);
      const marker = markers.get(id);
      const point = payload.points.find((entry) => entry.id === id);
      if (!point) {
        return;
      }
      if (marker) {
        marker.openPopup();
      }
      map.flyTo([point.lat, point.lon], 11, { duration: 0.8 });
      updateSpotlight(point);
    });
  });

  if (requestedSpecies && speciesSelect) {
    speciesSelect.value = requestedSpecies.trim().toLowerCase();
  }
  if (focusSelect) {
    if (requestedImage) {
      focusSelect.value = 'all';
    } else if (requestedFocus) {
      focusSelect.value = requestedFocus;
    }
  }
  const initialPoints = applyFilters();
  if (initialPoints.length) {
    let target = null;
    if (requestedImage) {
      target = initialPoints.find((point) => point.filename === requestedImage) || null;
    }
    if (!target && requestedSpecies) {
      const normalized = requestedSpecies.trim().toLowerCase();
      const matching = initialPoints.filter((point) => point.bird.toLowerCase() === normalized);
      target =
        matching
          .slice()
          .sort((a, b) => {
            const dateA = a.captureDateIso ? new Date(a.captureDateIso).getTime() : 0;
            const dateB = b.captureDateIso ? new Date(b.captureDateIso).getTime() : 0;
            return dateB - dateA;
          })[0] || matching[0] || null;
    }
    if (target) {
      map.flyTo([target.lat, target.lon], 11, { duration: 0.8 });
      updateSpotlight(target);
    }
  }
  applyImageLoadingEffects();
})();
