(() => {
  const dataNode = document.getElementById('trip-data');
  const preview = document.querySelector('[data-preview]');
  const previewImage = preview ? preview.querySelector('.preview-modal__image') : null;
  const closeButton = preview ? preview.querySelector('[data-preview-close]') : null;
  const prevButton = preview ? preview.querySelector('[data-preview-dir="prev"]') : null;
  const nextButton = preview ? preview.querySelector('[data-preview-dir="next"]') : null;
  const birdLabel = preview ? preview.querySelector('[data-preview-bird]') : null;
  const dateLabel = preview ? preview.querySelector('[data-preview-date]') : null;
  const speciesLink = preview ? preview.querySelector('[data-preview-link]') : null;
  const gallery = document.querySelector('.trips-grid');

  if (!dataNode || !preview || !previewImage || !gallery) {
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
    tripId: null,
    imageIndex: -1
  };

  const currentTrip = () => (state.tripId ? tripsById.get(state.tripId) || null : null);

  const updatePreview = () => {
    const trip = currentTrip();
    if (!trip || !Array.isArray(trip.images) || !trip.images.length) {
      return;
    }
    const normalized = ((state.imageIndex % trip.images.length) + trip.images.length) % trip.images.length;
    state.imageIndex = normalized;
    const image = trip.images[normalized];
    previewImage.src = `/${image.src}`;
    previewImage.alt = image.bird ? `${image.bird} trip image` : 'Trip image';
    if (birdLabel) {
      birdLabel.textContent = image.bird || 'Unknown species';
    }
    if (dateLabel) {
      dateLabel.textContent = image.captureDate || 'Unknown date';
    }
    if (speciesLink) {
      speciesLink.href = image.filename
        ? `${image.speciesHref}?image=${encodeURIComponent(image.filename)}`
        : image.speciesHref || '#';
    }
  };

  const openPreview = (tripId, imageIndex) => {
    const trip = tripsById.get(tripId);
    if (!trip || !Array.isArray(trip.images) || !trip.images.length) {
      return;
    }
    state.tripId = tripId;
    state.imageIndex = Number.isInteger(imageIndex) ? imageIndex : 0;
    updatePreview();
    preview.classList.add('is-active');
    preview.setAttribute('aria-hidden', 'false');
    document.body.classList.add('preview-open');
    const hideNav = trip.images.length <= 1;
    if (prevButton && nextButton) {
      prevButton.toggleAttribute('hidden', hideNav);
      nextButton.toggleAttribute('hidden', hideNav);
    }
  };

  const closePreview = () => {
    preview.classList.remove('is-active');
    preview.setAttribute('aria-hidden', 'true');
    previewImage.removeAttribute('src');
    document.body.classList.remove('preview-open');
    state.tripId = null;
    state.imageIndex = -1;
  };

  const step = (direction) => {
    const trip = currentTrip();
    if (!trip || trip.images.length <= 1) {
      return;
    }
    state.imageIndex += direction === 'next' ? 1 : -1;
    updatePreview();
  };

  gallery.addEventListener('click', (event) => {
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

  if (preview) {
    preview.addEventListener('click', (event) => {
      if (event.target === preview || event.target === closeButton) {
        closePreview();
      }
    });
  }

  if (closeButton) {
    closeButton.addEventListener('click', closePreview);
  }
  if (prevButton) {
    prevButton.addEventListener('click', () => step('prev'));
  }
  if (nextButton) {
    nextButton.addEventListener('click', () => step('next'));
  }

  document.addEventListener('keydown', (event) => {
    if (!preview.classList.contains('is-active')) {
      return;
    }
    if (event.key === 'Escape') {
      closePreview();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step('prev');
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      step('next');
    }
  });

  applyImageLoadingEffects();
})();
