(() => {
  const createPreviewController = ({ preview } = {}) => {
    if (!preview) {
      return {
        open: () => {},
        close: () => {},
        step: () => {},
        refresh: () => {},
        isOpen: () => false
      };
    }

    const previewImage = preview.querySelector('.preview-modal__image');
    const closeButton = preview.querySelector('[data-preview-close]');
    const previewPrev = preview.querySelector('[data-preview-dir="prev"]');
    const previewNext = preview.querySelector('[data-preview-dir="next"]');
    const infoPanel = preview.querySelector('[data-preview-info]');
    const statsPanel = preview.querySelector('[data-preview-stats]');
    const zoom = {
      scale: 1,
      x: 0,
      y: 0,
      dragging: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      originX: 0,
      originY: 0
    };
    let state = null;

    const isDesktopZoomEnabled = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    const clampZoomOffsets = () => {
      if (!previewImage) {
        return;
      }
      const width = previewImage.clientWidth;
      const height = previewImage.clientHeight;
      const maxX = Math.max(0, ((width * zoom.scale) - width) / 2);
      const maxY = Math.max(0, ((height * zoom.scale) - height) / 2);
      zoom.x = Math.max(-maxX, Math.min(maxX, zoom.x));
      zoom.y = Math.max(-maxY, Math.min(maxY, zoom.y));
    };

    const applyZoom = () => {
      if (!previewImage) {
        return;
      }
      clampZoomOffsets();
      previewImage.style.transform =
        zoom.scale > 1 ? `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` : '';
      preview.classList.toggle('is-zoomed', zoom.scale > 1);
      previewImage.classList.toggle('is-dragging', zoom.dragging);
    };

    const resetZoom = () => {
      zoom.scale = 1;
      zoom.x = 0;
      zoom.y = 0;
      zoom.dragging = false;
      zoom.pointerId = null;
      if (previewImage) {
        previewImage.classList.remove('is-dragging');
      }
      preview.classList.remove('is-zoomed');
      applyZoom();
    };

    const setZoomScale = (nextScale, clientX = null, clientY = null) => {
      if (!previewImage) {
        return;
      }
      const previousScale = zoom.scale;
      const clampedScale = Math.max(1, Math.min(5, nextScale));
      if (clampedScale === previousScale) {
        return;
      }
      if (clientX !== null && clientY !== null && previousScale > 0) {
        const rect = previewImage.getBoundingClientRect();
        const localX = clientX - (rect.left + rect.width / 2);
        const localY = clientY - (rect.top + rect.height / 2);
        const scaleRatio = clampedScale / previousScale;
        zoom.x -= localX * (scaleRatio - 1);
        zoom.y -= localY * (scaleRatio - 1);
      } else if (clampedScale === 1) {
        zoom.x = 0;
        zoom.y = 0;
      }
      zoom.scale = clampedScale;
      if (zoom.scale === 1) {
        zoom.x = 0;
        zoom.y = 0;
      }
      applyZoom();
    };

    const setNavVisibility = () => {
      if (!previewPrev || !previewNext) {
        return;
      }
      const hideNav = !state || (state.count || 0) <= 1;
      previewPrev.toggleAttribute('hidden', hideNav);
      previewNext.toggleAttribute('hidden', hideNav);
    };

    const setPreviewMeta = (item) => {
      if (!infoPanel) {
        return;
      }
      const meta = item?.meta || {};
      const fields = ['aperture', 'shutter', 'iso', 'focal'];
      let hasStats = false;

      fields.forEach((key) => {
        const row = preview.querySelector(`[data-preview-field="${key}"]`);
        const valueNode = preview.querySelector(`[data-preview-value="${key}"]`);
        const value = meta[key];
        const hasValue = Boolean(value && value !== 'Unknown');
        if (row) {
          row.hidden = !hasValue;
        }
        if (valueNode) {
          valueNode.textContent = hasValue ? value : '';
        }
        if (hasValue && ['aperture', 'shutter', 'iso', 'focal'].includes(key)) {
          hasStats = true;
        }
      });

      if (statsPanel) {
        statsPanel.hidden = !hasStats;
      }
      infoPanel.hidden = !hasStats;
    };

    const setPreviewItem = (item) => {
      if (!previewImage || !item) {
        return;
      }
      resetZoom();
      previewImage.src = item.src;
      previewImage.alt = item.alt || 'Photo preview';
      setPreviewMeta(item);
      if (typeof state?.onItem === 'function') {
        state.onItem(item);
      }
    };

    const open = (nextState = null) => {
      if (!previewImage || !nextState?.getItem) {
        return;
      }
      state = { ...nextState };
      const item = state.getItem();
      if (!item) {
        return;
      }
      setPreviewItem(item);
      preview.classList.add('is-active');
      preview.setAttribute('aria-hidden', 'false');
      document.body.classList.add('preview-open');
      setNavVisibility();
      if (typeof state.onOpen === 'function') {
        state.onOpen();
      }
    };

    const close = () => {
      if (!previewImage) {
        return;
      }
      resetZoom();
      preview.classList.remove('is-active');
      preview.setAttribute('aria-hidden', 'true');
      previewImage.removeAttribute('src');
      document.body.classList.remove('preview-open');
      if (infoPanel) {
        infoPanel.hidden = true;
      }
      if (typeof state?.onClose === 'function') {
        state.onClose();
      }
      state = null;
    };

    const step = (dir) => {
      if (!state || (state.count || 0) <= 1) {
        return;
      }
      if (typeof state.step === 'function') {
        state.step(dir);
      }
      const item = state.getItem?.();
      if (item) {
        setPreviewItem(item);
      }
    };

    const isOpen = () => preview.classList.contains('is-active');

    preview.addEventListener('click', (event) => {
      if (event.target === preview || event.target === closeButton) {
        close();
      }
    });

    if (closeButton) {
      closeButton.addEventListener('click', close);
    }
    if (previewPrev) {
      previewPrev.addEventListener('click', () => step('prev'));
    }
    if (previewNext) {
      previewNext.addEventListener('click', () => step('next'));
    }

    if (previewImage) {
      previewImage.setAttribute('draggable', 'false');

      previewImage.addEventListener(
        'wheel',
        (event) => {
          if (!isOpen() || !isDesktopZoomEnabled()) {
            return;
          }
          event.preventDefault();
          const delta = event.deltaY < 0 ? 0.6 : -0.6;
          setZoomScale(zoom.scale + delta, event.clientX, event.clientY);
        },
        { passive: false }
      );

      previewImage.addEventListener('dblclick', (event) => {
        if (!isOpen() || !isDesktopZoomEnabled()) {
          return;
        }
        event.preventDefault();
        const nextScale = zoom.scale > 1 ? 1 : 3.5;
        setZoomScale(nextScale, event.clientX, event.clientY);
      });

      previewImage.addEventListener('pointerdown', (event) => {
        if (!isOpen() || !isDesktopZoomEnabled() || zoom.scale <= 1) {
          return;
        }
        event.preventDefault();
        zoom.dragging = true;
        zoom.pointerId = event.pointerId;
        zoom.startX = event.clientX;
        zoom.startY = event.clientY;
        zoom.originX = zoom.x;
        zoom.originY = zoom.y;
        previewImage.setPointerCapture(event.pointerId);
        applyZoom();
      });

      previewImage.addEventListener('pointermove', (event) => {
        if (!zoom.dragging || zoom.pointerId !== event.pointerId) {
          return;
        }
        event.preventDefault();
        const panBoost = 1;
        zoom.x = zoom.originX + (event.clientX - zoom.startX) * panBoost;
        zoom.y = zoom.originY + (event.clientY - zoom.startY) * panBoost;
        applyZoom();
      });

      const endDrag = (event) => {
        if (!zoom.dragging || zoom.pointerId !== event.pointerId) {
          return;
        }
        zoom.dragging = false;
        zoom.pointerId = null;
        if (previewImage.hasPointerCapture(event.pointerId)) {
          previewImage.releasePointerCapture(event.pointerId);
        }
        applyZoom();
      };

      previewImage.addEventListener('pointerup', endDrag);
      previewImage.addEventListener('pointercancel', endDrag);
    }

    window.addEventListener('resize', () => {
      if (isOpen() && zoom.scale > 1) {
        applyZoom();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (!isOpen()) {
        return;
      }
      if (event.key === 'Escape') {
        close();
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

    return {
      open,
      close,
      step,
      refresh: () => {
        if (!state?.getItem) {
          return;
        }
        const item = state.getItem();
        if (item) {
          setPreviewItem(item);
        }
        setNavVisibility();
      },
      isOpen
    };
  };

  window.Birdopedia = window.Birdopedia || {};
  window.Birdopedia.createPreviewController = createPreviewController;
})();
