(() => {
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
})();
