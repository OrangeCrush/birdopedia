(function () {
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

  const carousels = document.querySelectorAll('.carousel');
  if (!carousels.length) {
    return;
  }

  const formatLocal = (value) => {
    if (!value) {
      return 'Unknown';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return 'Unknown';
    }
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(date);
  };

  const times = document.querySelectorAll('time[data-capture]');
  times.forEach((node) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const value = node.dataset.capture;
    node.textContent = formatLocal(value);
  });

  const preview = document.querySelector('[data-preview]');
  const previewController = window.Birdopedia?.createPreviewController
    ? window.Birdopedia.createPreviewController({ preview })
    : null;
  const getPreviewItemFromImage = (img) => {
    if (!img) {
      return null;
    }
    return {
      src: img.currentSrc || img.src,
      alt: img.alt || 'Photo preview',
      meta: {
        aperture: img.dataset.aperture || '',
        shutter: img.dataset.shutter || '',
        iso: img.dataset.iso || '',
        focal: img.dataset.focal || '',
        captureDate: formatLocal(img.dataset.captionDate),
        camera: img.dataset.captionCamera || '',
        lens: img.dataset.captionLens || ''
      }
    };
  };

  carousels.forEach((carousel) => {
    const images = Array.from(carousel.querySelectorAll('.carousel__image'));
    const dots = Array.from(carousel.querySelectorAll('.carousel__dot'));
    const viewport = carousel.querySelector('.carousel__viewport');
    const caption = carousel.querySelector('[data-caption]');
    const metaContainer = carousel.querySelector('[data-carousel-meta]');
    const mapLink = document.querySelector('[data-map-link]');
    let index = 0;

    const setMeta = (img) => {
      if (!metaContainer) {
        return;
      }
      const update = (key, value, suffix = '', label = '') => {
        const node = metaContainer.querySelector(`[data-meta="${key}"]`);
        if (!node) {
          return;
        }
        node.textContent = `${label}${value ? `${value}${suffix}` : 'Unknown'}`;
      };
      update('iso', img.dataset.iso || '', '', 'ISO: ');
      update('shutter', img.dataset.shutter || '', '', 'Shutter: ');
      update('aperture', img.dataset.aperture || '', '', 'Aperture: ');
      update('focal', img.dataset.focal || '', '', 'Focal: ');
    };

    const update = (nextIndex) => {
      if (!images.length) {
        return;
      }
      index = (nextIndex + images.length) % images.length;
      images.forEach((img, idx) => {
        img.classList.toggle('is-active', idx === index);
      });
      dots.forEach((dot, idx) => {
        dot.classList.toggle('is-active', idx === index);
      });
      if (caption) {
        const date = formatLocal(images[index].dataset.captionDate);
        const camera = images[index].dataset.captionCamera || '';
        const lens = images[index].dataset.captionLens || '';
        const parts = [date, camera, lens].filter(Boolean);
        caption.textContent = parts.join(' • ');
      }
      setMeta(images[index]);
      if (mapLink) {
        const species = mapLink.dataset.species || '';
        const filename = images[index].dataset.filename || '';
        const hasGps = images[index].dataset.hasGps === 'true';
        const params = new URLSearchParams();
        if (species) {
          params.set('species', species);
        }
        if (hasGps && filename) {
          params.set('focus', 'all');
          params.set('image', filename);
        } else {
          params.set('focus', 'latest');
        }
        mapLink.href = `/birdopedia/map/index.html?${params.toString()}`;
      }
    };

    const requestedImage = new URLSearchParams(window.location.search).get('image');
    if (requestedImage) {
      const targetIndex = images.findIndex((img) => img.dataset.filename === requestedImage);
      if (targetIndex >= 0) {
        update(targetIndex);
      }
    }

    setMeta(images[index]);
    const getActive = () => images[index] || null;

    carousel.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (target.matches('.carousel__btn')) {
        const dir = target.getAttribute('data-dir');
        update(dir === 'next' ? index + 1 : index - 1);
      }
      if (target.matches('.carousel__dot')) {
        const dotIndex = Number(target.getAttribute('data-index'));
        if (!Number.isNaN(dotIndex)) {
          update(dotIndex);
        }
      }
    });

    if (previewController && viewport) {
      viewport.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        if (target.closest('.carousel__btn') || target.closest('.carousel__dot')) {
          return;
        }
        previewController.open({
          count: images.length,
          getItem: () => getPreviewItemFromImage(getActive()),
          step: (dir) => update(dir === 'next' ? index + 1 : index - 1)
        });
      });
    }
  });

  const detailGrid = document.querySelector('.image-details .image-grid');
  if (previewController && detailGrid) {
    const detailImages = Array.from(detailGrid.querySelectorAll('.image-card__thumb img'));
    let detailIndex = 0;

    const updateDetail = (nextIndex) => {
      if (!detailImages.length) {
        return;
      }
      detailIndex = (nextIndex + detailImages.length) % detailImages.length;
    };

    const getDetailActive = () => detailImages[detailIndex] || null;

    detailGrid.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const thumb = target.closest('.image-card__thumb');
      if (!thumb) {
        return;
      }
      const img = thumb.querySelector('img');
      if (!img) {
        return;
      }
      const clickedIndex = detailImages.indexOf(img);
      if (clickedIndex === -1) {
        return;
      }
      updateDetail(clickedIndex);
      previewController.open({
        count: detailImages.length,
        getItem: () => getPreviewItemFromImage(getDetailActive()),
        step: (dir) => updateDetail(dir === 'next' ? detailIndex + 1 : detailIndex - 1)
      });
    });
  }

  applyImageLoadingEffects();
})();
