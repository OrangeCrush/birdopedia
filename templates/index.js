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

  const markRecentShots = (root = document) => {
    const cards = Array.from(root.querySelectorAll('.bird-card[data-latest-capture]'));
    if (!cards.length) {
      return;
    }
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 30);

    cards.forEach((card) => {
      const raw = card.getAttribute('data-latest-capture');
      if (!raw) {
        return;
      }
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) {
        return;
      }
      if (date >= cutoff) {
        card.classList.add('is-recent');
      }
    });
  };

  markRecentShots();
  applyImageLoadingEffects();

  const searchInput = document.getElementById('species-search');
  if (searchInput) {
    const cards = Array.from(document.querySelectorAll('.bird-card'));
    if (cards.length) {
      const emptyState = document.querySelector('.search-empty');
      const countNode = document.getElementById('search-count');
      const familySelect = document.getElementById('family-filter');
      const statusSelect = document.getElementById('status-filter');
      const clearButton = document.querySelector('.search-clear');
      const total = cards.length;

      const normalize = (value) => String(value).toLowerCase().trim();
      const updateSearch = () => {
        const query = normalize(searchInput.value);
        const family = normalize(familySelect ? familySelect.value : '');
        const status = normalize(statusSelect ? statusSelect.value : '');
        let visible = 0;

        cards.forEach((card) => {
          const name = card.dataset.name || '';
          const matchesName = !query || normalize(name).includes(query);
          const cardFamily = normalize(card.dataset.family || '');
          const matchesFamily = !family || cardFamily === family;
          const cardStatus = normalize(card.dataset.status || '');
          const matchesStatus = !status || cardStatus === status;
          const match = matchesName && matchesFamily && matchesStatus;
          card.hidden = !match;
          if (match) {
            visible += 1;
          }
        });

        if (countNode) {
          countNode.textContent = query ? `${visible} of ${total} species` : `${total} species`;
        }
        if (emptyState) {
          emptyState.hidden = visible !== 0;
        }
        if (clearButton) {
          clearButton.hidden = !query;
        }
      };

      searchInput.addEventListener('input', updateSearch);
      if (familySelect) {
        familySelect.addEventListener('change', updateSearch);
      }
      if (statusSelect) {
        statusSelect.addEventListener('change', updateSearch);
      }
      if (clearButton) {
        clearButton.addEventListener('click', () => {
          searchInput.value = '';
          searchInput.focus();
          updateSearch();
        });
      }
      updateSearch();
    }
  }

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
