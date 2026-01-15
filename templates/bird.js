(function () {
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

  carousels.forEach((carousel) => {
    const images = Array.from(carousel.querySelectorAll('.carousel__image'));
    const dots = Array.from(carousel.querySelectorAll('.carousel__dot'));
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
  });
})();
