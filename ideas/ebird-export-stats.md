# eBird Export Stats

Idea: Allow users to export their personal eBird data (My eBird -> Download data) and feed it into Birdopedia.

Potential enhancements:
- Enrich the index page with personal birding stats from the export.
- Show life list counts, year totals, and latest sightings alongside the photo collection.
- Add optional per-species notes from the export (last observed date, region, checklist link).

Implementation sketch:
- Add a parser script to ingest the CSV/ZIP export and output a normalized JSON file.
- Merge that JSON into the index template and bird pages.
- Keep the export file in a local-only folder and ignore it via .gitignore.
