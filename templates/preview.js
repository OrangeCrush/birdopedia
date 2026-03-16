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
    let state = null;

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
