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

  const dataNode = document.getElementById('featured-data');
  if (!dataNode) {
    return;
  }
  let payload = [];
  try {
    payload = JSON.parse(dataNode.textContent || '[]');
  } catch (error) {
    return;
  }
  if (!Array.isArray(payload) || payload.length === 0) {
    return;
  }

  const featured = document.querySelector('.featured-shot');
  if (!featured) {
    return;
  }
  if (!featured.hasAttribute('data-featured')) {
    return;
  }
  const media = featured.querySelector('.featured-shot__media');
  const img = featured.querySelector('.featured-shot__media img');
  const titleLink = featured.querySelector('.featured-shot__info h2 a');
  if (!media || !img || !titleLink) {
    return;
  }

  const choice = payload[Math.floor(Math.random() * payload.length)];
  if (!choice || !choice.src || !choice.speciesHref || !choice.bird) {
    return;
  }

  media.setAttribute('href', choice.speciesHref);
  img.setAttribute('src', `/${choice.src}`);
  img.setAttribute('alt', `${choice.bird} featured photograph`);
  titleLink.setAttribute('href', choice.speciesHref);
  titleLink.textContent = choice.bird;

  const dateNode = featured.querySelector('.featured-shot__date');
  if (dateNode) {
    dateNode.textContent = choice.captureDate || 'Capture date unknown';
  }

  applyImageLoadingEffects(featured);
})();
