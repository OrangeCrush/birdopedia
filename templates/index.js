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
    const list = document.querySelector('.bird-list');
    const cards = Array.from(document.querySelectorAll('.bird-card'));
    if (cards.length && list) {
      const emptyState = document.querySelector('.search-empty');
      const countNode = document.getElementById('search-count');
      const familySelect = document.getElementById('family-filter');
      const statusSelect = document.getElementById('status-filter');
      const sortSelect = document.getElementById('sort-filter');
      const clearButton = document.querySelector('.search-clear');
      const total = cards.length;
      const originalOrder = cards.slice();

      const normalize = (value) => String(value).toLowerCase().trim();
      const updateSearch = () => {
        const query = normalize(searchInput.value);
        const family = normalize(familySelect ? familySelect.value : '');
        const status = normalize(statusSelect ? statusSelect.value : '');
        const sort = normalize(sortSelect ? sortSelect.value : 'name') || 'name';
        let visible = 0;
        const visibleCards = [];

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
            visibleCards.push(card);
          }
        });

        if (sort === 'name') {
          originalOrder.forEach((card) => {
            if (!card.hidden) {
              list.appendChild(card);
            }
          });
        } else {
          const sorted = visibleCards.slice().sort((a, b) => {
            if (sort === 'count') {
              const countA = Number(a.dataset.count || 0);
              const countB = Number(b.dataset.count || 0);
              return countB - countA;
            }
            if (sort === 'latest') {
              const dateA = a.dataset.latestCapture ? new Date(a.dataset.latestCapture).getTime() : 0;
              const dateB = b.dataset.latestCapture ? new Date(b.dataset.latestCapture).getTime() : 0;
              return dateB - dateA;
            }
            return 0;
          });
          sorted.forEach((card) => list.appendChild(card));
        }

        if (countNode) {
          const hasFilters = Boolean(query || family || status);
          countNode.textContent = hasFilters ? `${visible} species` : `${total} species`;
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
      if (sortSelect) {
        sortSelect.addEventListener('change', updateSearch);
      }
      if (clearButton) {
        clearButton.addEventListener('click', () => {
          searchInput.value = '';
          if (familySelect) {
            familySelect.value = '';
          }
          if (statusSelect) {
            statusSelect.value = '';
          }
          if (sortSelect) {
            sortSelect.value = 'name';
          }
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

  const featuredHref = choice.filename
    ? `${choice.speciesHref}?image=${encodeURIComponent(choice.filename)}`
    : choice.speciesHref;
  media.setAttribute('href', featuredHref);
  img.setAttribute('src', `/${choice.src}`);
  img.setAttribute('alt', `${choice.bird} featured photograph`);
  titleLink.setAttribute('href', featuredHref);
  titleLink.textContent = choice.bird;

  const dateNode = featured.querySelector('.featured-shot__date');
  if (dateNode) {
    dateNode.textContent = choice.captureDate || 'Capture date unknown';
  }

  applyImageLoadingEffects(featured);
})();
