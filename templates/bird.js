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
  const previewImage = preview ? preview.querySelector('.preview-modal__image') : null;
  const closeButton = preview ? preview.querySelector('[data-preview-close]') : null;
  const previewPrev = preview ? preview.querySelector('[data-preview-dir="prev"]') : null;
  const previewNext = preview ? preview.querySelector('[data-preview-dir="next"]') : null;
  let previewState = null;

  const setPreviewImage = (img) => {
    if (!previewImage || !img) {
      return;
    }
    previewImage.src = img.currentSrc || img.src;
    previewImage.alt = img.alt || 'Photo preview';
  };

  const openPreview = (img, state) => {
    if (!preview || !previewImage || !img) {
      return;
    }
    previewState = state || null;
    setPreviewImage(img);
    preview.classList.add('is-active');
    preview.setAttribute('aria-hidden', 'false');
    document.body.classList.add('preview-open');
    if (previewPrev && previewNext) {
      const hideNav = !previewState || previewState.count <= 1;
      previewPrev.toggleAttribute('hidden', hideNav);
      previewNext.toggleAttribute('hidden', hideNav);
    }
  };

  const closePreview = () => {
    if (!preview || !previewImage) {
      return;
    }
    preview.classList.remove('is-active');
    preview.setAttribute('aria-hidden', 'true');
    previewImage.removeAttribute('src');
    document.body.classList.remove('preview-open');
    previewState = null;
  };

  const stepPreview = (dir) => {
    if (!previewState) {
      return;
    }
    if (previewState.count <= 1) {
      return;
    }
    const { getActive, update } = previewState;
    const active = getActive();
    if (!active) {
      return;
    }
    update(dir === 'next' ? active.index + 1 : active.index - 1);
    const refreshed = getActive();
    if (refreshed?.img) {
      setPreviewImage(refreshed.img);
    }
  };

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
  if (previewPrev) {
    previewPrev.addEventListener('click', () => stepPreview('prev'));
  }
  if (previewNext) {
    previewNext.addEventListener('click', () => stepPreview('next'));
  }

  document.addEventListener('keydown', (event) => {
    if (!preview?.classList.contains('is-active')) {
      return;
    }
    if (event.key === 'Escape') {
      closePreview();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      stepPreview('prev');
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      stepPreview('next');
    }
  });

  carousels.forEach((carousel) => {
    const images = Array.from(carousel.querySelectorAll('.carousel__image'));
    const dots = Array.from(carousel.querySelectorAll('.carousel__dot'));
    const viewport = carousel.querySelector('.carousel__viewport');
    const caption = carousel.querySelector('[data-caption]');
    const metaContainer = carousel.querySelector('[data-carousel-meta]');
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
    };

    setMeta(images[index]);
    const getActive = () => ({ img: images[index], index });

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

    if (preview && viewport) {
      viewport.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        if (target.closest('.carousel__btn') || target.closest('.carousel__dot')) {
          return;
        }
        const active = images[index];
        if (active) {
          openPreview(active, { getActive, update, count: images.length });
        }
      });
    }
  });

  applyImageLoadingEffects();
})();
