# Birdopedia

A static, photography-first bird encyclopedia built from your own images.

## Getting Started

1. Add your eBird API key to `.env`:

   ```bash
   EBIRD_API_TOKEN=your_key_here
   ```

2. Build the data + pages:

   ```bash
   node scripts/fetch-ebird.js
   node scripts/build.js
   ```

3. Run the local server:

   ```bash
   node server.js
   ```

Open `http://localhost:3000` in your browser.

## Adding a New Species

1. Create a folder under `public/img/` named exactly as the common name:

   ```text
   public/img/Red-breasted Nuthatch/
   ```

2. Add your photos into that folder.

3. Regenerate data and pages:

   ```bash
   node scripts/fetch-ebird.js
   node scripts/build.js
   ```

If the folder name does not match an eBird common name, add a mapping in `data/ebird.overrides.json` (copy from `data/ebird.overrides.example.json`).

## Adding New Photos to an Existing Species

1. Drop the new images into the existing species folder under `public/img/`.
2. Rebuild the pages:

   ```bash
   node scripts/build.js
   ```

If you also want to refresh eBird taxonomy data, run `node scripts/fetch-ebird.js` before rebuilding.

## Local Export Ideas

If you want to enrich the index page with your personal eBird stats, place export files in `data/exports/`. See `ideas/ebird-export-stats.md` for the concept.
