(() => {
  const grid = document.querySelector('[data-gallery-grid]');
  const loadButton = document.querySelector('[data-gallery-load]');
  const sortSelect = document.getElementById('gallery-sort');
  const cameraSelect = document.getElementById('gallery-camera');
  const lensSelect = document.getElementById('gallery-lens');
  const preview = document.querySelector('[data-preview]');
  const previewImage = preview ? preview.querySelector('.preview-modal__image') : null;
  const closeButton = preview ? preview.querySelector('[data-preview-close]') : null;
  const previewPrev = preview ? preview.querySelector('[data-preview-dir="prev"]') : null;
  const previewNext = preview ? preview.querySelector('[data-preview-dir="next"]') : null;
  if (!grid) {
    return;
  }

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

  let items = [];
  let sortedItems = [];
  let cursor = 0;
  const batchSize = 24;
  let previewIndex = -1;

  const setPreviewImageByIndex = (index) => {
    if (!previewImage || !sortedItems.length) {
      return;
    }
    const normalized = ((index % sortedItems.length) + sortedItems.length) % sortedItems.length;
    const item = sortedItems[normalized];
    if (!item?.src) {
      return;
    }
    previewIndex = normalized;
    previewImage.src = `/${item.src}`;
    previewImage.alt = `${item.bird || 'Bird'} photograph`;
  };

  const openPreview = (index) => {
    if (!preview || !previewImage || !sortedItems.length) {
      return;
    }
    setPreviewImageByIndex(index);
    preview.classList.add('is-active');
    preview.setAttribute('aria-hidden', 'false');
    document.body.classList.add('preview-open');
    if (previewPrev && previewNext) {
      const hideNav = sortedItems.length <= 1;
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
    previewIndex = -1;
  };

  const stepPreview = (dir) => {
    if (previewIndex < 0 || sortedItems.length <= 1) {
      return;
    }
    const nextIndex = dir === 'next' ? previewIndex + 1 : previewIndex - 1;
    setPreviewImageByIndex(nextIndex);
  };

  const renderBatch = () => {
    const slice = sortedItems.slice(cursor, cursor + batchSize);
    if (!slice.length) {
      if (loadButton) {
        loadButton.hidden = true;
      }
      return;
    }
    const fragment = document.createDocumentFragment();
    slice.forEach((item, indexInSlice) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'gallery-card';
      const imageSrc = item.thumbSrc || item.src;
      const ratio = item.width && item.height ? `${item.width} / ${item.height}` : '3 / 2';
      card.innerHTML = `
        <div class="gallery-card__media media-frame zoomable" style="aspect-ratio: ${ratio};">
          <img class="media-image media-fade" src="/${imageSrc}" alt="${item.bird} photograph" loading="lazy" decoding="async" />
          <span class="zoom-indicator" aria-hidden="true"></span>
          <div class="gallery-card__meta">
            <span>${item.bird}</span>
            <span>${item.captureDate || 'Unknown date'}</span>
          </div>
        </div>
      `;
      card.dataset.galleryIndex = String(cursor + indexInSlice);
      fragment.appendChild(card);
    });
    grid.appendChild(fragment);
    cursor += slice.length;
    applyImageLoadingEffects(grid);
    if (cursor >= sortedItems.length && loadButton) {
      loadButton.hidden = true;
    }
  };

  const initObserver = () => {
    if (!loadButton || !('IntersectionObserver' in window)) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          renderBatch();
        }
      });
    }, { rootMargin: '200px 0px' });
    observer.observe(loadButton);
  };

  const shuffle = (array) => {
    const result = array.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };

  const sortItems = (mode) => {
    const current = items.slice();
    if (mode === 'newest') {
      current.sort((a, b) => new Date(b.captureDateIso || 0) - new Date(a.captureDateIso || 0));
      return current;
    }
    if (mode === 'oldest') {
      current.sort((a, b) => new Date(a.captureDateIso || 0) - new Date(b.captureDateIso || 0));
      return current;
    }
    if (mode === 'species') {
      current.sort((a, b) => a.bird.localeCompare(b.bird));
      return current;
    }
    return shuffle(current);
  };

  const applyFilters = (list) => {
    const camera = cameraSelect ? cameraSelect.value : '';
    const lens = lensSelect ? lensSelect.value : '';
    return list.filter((item) => {
      const cameraMatch = !camera || item.camera === camera;
      const lensMatch = !lens || item.lens === lens;
      return cameraMatch && lensMatch;
    });
  };

  const resetGallery = (mode) => {
    const sorted = sortItems(mode);
    sortedItems = applyFilters(sorted);
    cursor = 0;
    grid.innerHTML = '';
    if (loadButton) {
      loadButton.hidden = false;
    }
    if (previewPrev && previewNext) {
      const hideNav = sortedItems.length <= 1;
      previewPrev.toggleAttribute('hidden', hideNav);
      previewNext.toggleAttribute('hidden', hideNav);
    }
    renderBatch();
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
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      stepPreview('next');
    }
  });

  grid.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const card = target.closest('.gallery-card');
    if (!(card instanceof HTMLElement)) {
      return;
    }
    const cardIndex = Number(card.dataset.galleryIndex);
    if (!Number.isInteger(cardIndex)) {
      return;
    }
    openPreview(cardIndex);
  });

  fetch('/birdopedia/gallery.json')
    .then((res) => res.json())
    .then((data) => {
      if (!Array.isArray(data)) {
        return;
      }
      items = data;
      resetGallery('random');
      initObserver();
      if (loadButton) {
        loadButton.addEventListener('click', renderBatch);
      }
      if (sortSelect) {
        sortSelect.addEventListener('change', (event) => {
          const value = event.target.value || 'random';
          resetGallery(value);
        });
      }
      if (cameraSelect) {
        cameraSelect.addEventListener('change', () => {
          const value = sortSelect ? sortSelect.value : 'random';
          resetGallery(value || 'random');
        });
      }
      if (lensSelect) {
        lensSelect.addEventListener('change', () => {
          const value = sortSelect ? sortSelect.value : 'random';
          resetGallery(value || 'random');
        });
      }
    })
    .catch(() => {
      if (loadButton) {
        loadButton.hidden = true;
      }
    });
})();
