(() => {
  const dataNode = document.getElementById('trip-data');
  const preview = document.querySelector('[data-preview]');
  const previewController = window.Birdopedia?.createPreviewController
    ? window.Birdopedia.createPreviewController({ preview })
    : null;
  const stage = document.querySelector('.trips-stage');
  const nav = document.querySelector('[data-trip-nav]');

  if (!dataNode || !preview || !previewController || !stage) {
    return;
  }

  let trips = [];
  try {
    const parsed = JSON.parse(dataNode.textContent || '[]');
    trips = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    trips = [];
  }

  const tripsById = trips.reduce((acc, trip) => {
    if (trip?.id) {
      acc.set(trip.id, trip);
    }
    return acc;
  }, new Map());

  const applyImageLoadingEffects = (root = document) => {
    const images = Array.from(root.querySelectorAll('img.media-image'));
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

  const state = {
    activeTripId: null,
    tripId: null,
    imageIndex: -1
  };

  const currentTrip = () => (state.tripId ? tripsById.get(state.tripId) || null : null);

  const getPreviewItem = () => {
    const trip = currentTrip();
    if (!trip || !Array.isArray(trip.images) || !trip.images.length) {
      return null;
    }
    const normalized = ((state.imageIndex % trip.images.length) + trip.images.length) % trip.images.length;
    state.imageIndex = normalized;
    const image = trip.images[normalized];
    if (!image?.src) {
      return null;
    }
    return {
      src: `/${image.src}`,
      alt: image.bird ? `${image.bird} trip image` : 'Trip image',
      meta: {
        aperture: image.aperture || '',
        shutter: image.exposure || '',
        iso: image.iso || '',
        focal: image.focalLength || '',
        captureDate: image.captureDate || '',
        camera: image.camera || '',
        lens: image.lens || ''
      }
    };
  };

  const openPreview = (tripId, imageIndex) => {
    const trip = tripsById.get(tripId);
    if (!trip || !Array.isArray(trip.images) || !trip.images.length) {
      return;
    }
    state.tripId = tripId;
    state.imageIndex = Number.isInteger(imageIndex) ? imageIndex : 0;
    previewController.open({
      count: trip.images.length,
      getItem: getPreviewItem,
      step: (direction) => {
        state.imageIndex += direction === 'next' ? 1 : -1;
      },
      onClose: () => {
        state.tripId = null;
        state.imageIndex = -1;
      }
    });
  };

  const setActiveTrip = (tripId) => {
    if (!tripId || !tripsById.has(tripId)) {
      return;
    }
    state.activeTripId = tripId;
    const panels = Array.from(stage.querySelectorAll('[data-trip-panel]'));
    panels.forEach((panel) => {
      if (!(panel instanceof HTMLElement)) {
        return;
      }
      const active = panel.getAttribute('data-trip-panel') === tripId;
      panel.classList.toggle('is-active', active);
      panel.hidden = !active;
    });
    if (nav) {
      const buttons = Array.from(nav.querySelectorAll('[data-trip-select]'));
      buttons.forEach((button) => {
        if (!(button instanceof HTMLElement)) {
          return;
        }
        const active = button.getAttribute('data-trip-select') === tripId;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-current', active ? 'true' : 'false');
      });
    }
    const url = new URL(window.location.href);
    url.searchParams.set('trip', tripId);
    window.history.replaceState({}, '', url);
  };

  const firstTrip = trips[0]?.id || null;
  const requestedTrip = new URL(window.location.href).searchParams.get('trip');
  const initialTrip = requestedTrip && tripsById.has(requestedTrip) ? requestedTrip : firstTrip;
  if (initialTrip) {
    setActiveTrip(initialTrip);
  }

  stage.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const trigger = target.closest('[data-trip-open], [data-trip-thumb]');
    if (!(trigger instanceof HTMLElement)) {
      return;
    }
    const tripId = trigger.getAttribute('data-trip-id');
    const imageIndex = Number(trigger.getAttribute('data-image-index'));
    if (!tripId || Number.isNaN(imageIndex)) {
      return;
    }
    openPreview(tripId, imageIndex);
  });

  if (nav) {
    nav.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const button = target.closest('[data-trip-select]');
      if (!(button instanceof HTMLElement)) {
        return;
      }
      const tripId = button.getAttribute('data-trip-select');
      if (!tripId) {
        return;
      }
      setActiveTrip(tripId);
    });
  }

  applyImageLoadingEffects();
})();
