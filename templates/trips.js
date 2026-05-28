(() => {
  const dataNode = document.getElementById('trip-data');
  const preview = document.querySelector('[data-preview]');
  const previewController = window.Birdopedia?.createPreviewController
    ? window.Birdopedia.createPreviewController({ preview })
    : null;
  const stage = document.querySelector('.trips-stage');
  const nav = document.querySelector('[data-trip-nav]');
  const ROTATION_INTERVAL_MS = 15000;
  const FADE_DURATION_MS = 600;

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

  const getRandomImageIndex = (trip, currentIndex = -1) => {
    const imageCount = Array.isArray(trip?.images) ? trip.images.length : 0;
    if (imageCount < 2) {
      return 0;
    }
    let nextIndex = Math.floor(Math.random() * imageCount);
    if (nextIndex === currentIndex) {
      nextIndex = (nextIndex + 1) % imageCount;
    }
    return nextIndex;
  };

  const getHeroElements = (tripId) => {
    const panel = Array.from(stage.querySelectorAll('[data-trip-panel]')).find(
      (candidate) => candidate instanceof HTMLElement && candidate.getAttribute('data-trip-panel') === tripId
    );
    if (!(panel instanceof HTMLElement)) {
      return null;
    }
    const button = panel.querySelector('[data-trip-open]');
    const imageNode = panel.querySelector('[data-trip-hero-image]');
    if (!(button instanceof HTMLElement) || !(imageNode instanceof HTMLImageElement)) {
      return null;
    }
    return { button, imageNode };
  };

  const updateTripHero = (tripId, imageIndex, animate = true) => {
    const trip = tripsById.get(tripId);
    const image = trip?.images?.[imageIndex];
    const elements = trip ? getHeroElements(tripId) : null;
    if (!trip || !image?.src || !elements) {
      return;
    }

    const { button, imageNode } = elements;
    const nextSrc = '/' + image.src;
    button.setAttribute('data-image-index', String(imageIndex));
    imageNode.alt = image.bird ? image.bird + ' trip cover' : 'Trip cover';

    if (imageNode.getAttribute('src') === nextSrc) {
      imageNode.classList.add('is-loaded');
      return;
    }

    const loadNextImage = () => {
      imageNode.classList.remove('is-loaded');
      imageNode.addEventListener(
        'load',
        () => {
          imageNode.classList.add('is-loaded');
        },
        { once: true }
      );
      imageNode.addEventListener(
        'error',
        () => {
          imageNode.classList.add('is-loaded');
        },
        { once: true }
      );
      imageNode.src = nextSrc;
    };

    if (!animate) {
      loadNextImage();
      return;
    }

    imageNode.classList.remove('is-loaded');
    window.setTimeout(loadNextImage, FADE_DURATION_MS);
  };

  const randomizeTripHeroes = () => {
    trips.forEach((trip) => {
      if (!trip?.id || !Array.isArray(trip.images) || !trip.images.length) {
        return;
      }
      updateTripHero(trip.id, getRandomImageIndex(trip), false);
    });
  };

  const state = {
    activeTripId: null,
    tripId: null,
    imageIndex: -1
  };

  const rotateActiveTripHero = () => {
    const trip = state.activeTripId ? tripsById.get(state.activeTripId) : null;
    if (!trip || !Array.isArray(trip.images) || trip.images.length < 2) {
      return;
    }
    const elements = getHeroElements(trip.id);
    const currentIndex = Number(elements?.button.getAttribute('data-image-index'));
    const nextIndex = getRandomImageIndex(trip, Number.isNaN(currentIndex) ? -1 : currentIndex);
    updateTripHero(trip.id, nextIndex, true);
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
      src: '/' + image.src,
      alt: image.bird ? image.bird + ' trip image' : 'Trip image',
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

  randomizeTripHeroes();

  const firstTrip = trips[0]?.id || null;
  const requestedTrip = new URL(window.location.href).searchParams.get('trip');
  const initialTrip = requestedTrip && tripsById.has(requestedTrip) ? requestedTrip : firstTrip;
  if (initialTrip) {
    setActiveTrip(initialTrip);
  }

  window.setInterval(rotateActiveTripHero, ROTATION_INTERVAL_MS);

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
