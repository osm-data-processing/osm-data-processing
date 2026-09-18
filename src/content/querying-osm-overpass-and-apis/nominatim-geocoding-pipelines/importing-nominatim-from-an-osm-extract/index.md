---
title: "Importing Nominatim from an OSM Extract"
description: "Size, run and verify a private Nominatim import from a regional extract, including the flatnode file, the address interpolation pass, and keeping the instance current afterwards."
pageTitle: "Import Nominatim from a Regional OSM Extract"
pageDescription: "Plan disk and memory for a Nominatim import, run it from a regional PBF with a flatnode file, verify the place index, and decide between replication updates and periodic re-import."
slug: importing-nominatim-from-an-osm-extract
type: article
breadcrumb: "Importing Nominatim"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Importing Nominatim from an OSM Extract

Stand up a private geocoder from a regional `.osm.pbf` so a batch of a hundred thousand addresses becomes a twenty-minute job instead of a day of throttled requests against a shared service.

## Prerequisites

- [ ] A regional extract obtained reproducibly, with its checksum verified — see [Automating Geofabrik Extract Downloads with Checksums](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/automating-geofabrik-extract-downloads-with-checksums/).
- [ ] Disk space of roughly eight to fifteen times the extract size, on fast local storage — network volumes turn hours into days.
- [ ] At least 16 GB of RAM for a country-sized import; a continent needs considerably more.
- [ ] PostgreSQL with PostGIS, or the maintained Docker image that bundles them.
- [ ] A short list of addresses whose correct coordinates you already know, to verify the import against.

## Conceptual minimum

A Nominatim import is not a copy of the extract; it is a purpose-built search database derived from it. The import reads OSM elements, decides which are *places* worth indexing, computes an address hierarchy by working out which administrative and named areas contain each place, and writes a token index used to match query text.

Three parts of that pipeline dominate the runtime and the failure modes.

**Node location storage.** Building way and relation geometry requires the coordinates of every referenced node, and there are far more nodes than places. The import can either keep them in the database — slow and enormous — or in a *flatnode file*, a fixed-layout file indexed directly by node id. The flatnode file is essentially mandatory for anything country-sized and above, and it must be on fast local disk because access to it is random.

**Address computation.** Each place is assigned its containing hierarchy: the street, the suburb, the city, the state, the country. This is the stage that makes structured queries work, and it is the most compute-heavy part of the import.

**Interpolation.** Address ranges mapped as interpolation ways are expanded into individual addressable points. Skipping this pass makes the import faster and leaves entire streets ungeocodable in regions where interpolation is the dominant address mapping style.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="inm1-t inm1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="inm1-t">The stages of a Nominatim import and what each one produces</title>
  <desc id="inm1-d">Four stacked stages. Loading reads the extract and writes raw place rows, using a flatnode file to hold node coordinates outside the database. Ranking classifies each place by how specific it is, from country down to individual address point. Address computation assigns every place its containing hierarchy of street, suburb, city, state and country, and is the most compute-heavy stage. Indexing builds the token index that turns query text into candidate matches. A note observes that only the last stage is quick.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four stages, and the third one dominates the clock</text>
  <rect x="26" y="50" width="828" height="52" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="42" y="72" font-size="12.5" font-weight="700" fill="currentColor">Load</text>
  <text x="42" y="90" font-size="10.5" fill="currentColor" opacity="0.88">Read the extract, write place rows</text>
  <text x="838" y="82" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">needs a flatnode file</text>
  <rect x="26" y="112" width="828" height="52" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="42" y="134" font-size="12.5" font-weight="700" fill="currentColor">Rank</text>
  <text x="42" y="152" font-size="10.5" fill="currentColor" opacity="0.88">Classify places by specificity</text>
  <text x="838" y="144" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">country down to address</text>
  <rect x="26" y="174" width="828" height="52" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="42" y="196" font-size="12.5" font-weight="700" fill="currentColor">Address</text>
  <text x="42" y="214" font-size="10.5" fill="currentColor" opacity="0.88">Assign the containing hierarchy</text>
  <text x="838" y="206" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">the longest stage by far</text>
  <rect x="26" y="236" width="828" height="52" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="42" y="258" font-size="12.5" font-weight="700" fill="currentColor">Index</text>
  <text x="42" y="276" font-size="10.5" fill="currentColor" opacity="0.88">Build the query token index</text>
  <text x="838" y="268" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">comparatively quick</text>
  <text x="868" y="308" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Interrupting during the address stage means restarting it, which is why the import wants a machine nobody is going to reboot.</text>
</svg>
<figcaption>The address stage is where a country import spends most of its hours, and it is also the stage that makes structured queries work.</figcaption>
</figure>

## Runnable solution

```bash
#!/usr/bin/env bash
# Import a private Nominatim instance from a regional extract.
set -euo pipefail

EXTRACT="/data/poland-latest.osm.pbf"
PROJECT_DIR="/srv/nominatim"
FLATNODE="/fast-local/nominatim.flatnode"   # MUST be local, random-access disk
THREADS="$(nproc)"

mkdir -p "$PROJECT_DIR" "$(dirname "$FLATNODE")"

cat > "$PROJECT_DIR/.env" <<'ENV'
NOMINATIM_DATABASE_DSN=pgsql:dbname=nominatim
NOMINATIM_FLATNODE_FILE=/fast-local/nominatim.flatnode
# Keep interpolation: in many countries it is the dominant address style.
NOMINATIM_USE_US_TIGER_DATA=false
# The replication source must match the region of the extract, exactly.
NOMINATIM_REPLICATION_URL=https://download.geofabrik.de/europe/poland-updates/
ENV

cd "$PROJECT_DIR"
nominatim import --osm-file "$EXTRACT" --threads "$THREADS" 2>&1 | tee import.log

# Index freshness state so replication can start from the extract's timestamp.
nominatim replication --init

echo "import finished; run the verification script before trusting results"
```

Verification belongs in code, not in a manual spot check:

```python
from __future__ import annotations

import logging
from dataclasses import dataclass

import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.nominatim.verify")

LOCAL = "http://localhost:8080"
TOLERANCE_DEG = 0.01          # roughly a kilometre; an import check, not a precision one


@dataclass(frozen=True)
class Known:
    street: str
    city: str
    country: str
    lat: float
    lon: float


def lookup(sample: Known) -> dict | None:
    params = {
        "street": sample.street, "city": sample.city,
        "countrycodes": sample.country, "format": "jsonv2",
        "addressdetails": 1, "limit": 1,
    }
    response = requests.get(f"{LOCAL}/search", params=params, timeout=30)
    response.raise_for_status()
    results = response.json()
    return results[0] if results else None


def verify(samples: list[Known]) -> bool:
    ok = True
    for sample in samples:
        hit = lookup(sample)
        if hit is None:
            logger.error("no match for %s, %s — import may be incomplete",
                         sample.street, sample.city)
            ok = False
            continue
        dlat = abs(float(hit["lat"]) - sample.lat)
        dlon = abs(float(hit["lon"]) - sample.lon)
        rank = int(hit.get("place_rank", -1))
        if dlat > TOLERANCE_DEG or dlon > TOLERANCE_DEG:
            logger.error("%s: matched %.4f,%.4f, expected %.4f,%.4f",
                         sample.street, float(hit["lat"]), float(hit["lon"]),
                         sample.lat, sample.lon)
            ok = False
        elif rank < 26:
            # A coarse rank means the street did not match; the hierarchy
            # (address computation) stage probably did not complete.
            logger.warning("%s: matched at place_rank %d — street-level or coarser",
                           sample.street, rank)
        else:
            logger.info("%s: ok at place_rank %d", sample.street, rank)
    return ok


if __name__ == "__main__":
    known = [
        Known("Rynek Główny", "Kraków", "pl", 50.0617, 19.9373),
        Known("Krupówki", "Zakopane", "pl", 49.2969, 19.9490),
    ]
    logger.info("import verification %s", "PASSED" if verify(known) else "FAILED")
```

## Step-by-step walkthrough

1. **Put the flatnode file on local disk.** It is accessed randomly by node id throughout the load stage. On network storage the import can take an order of magnitude longer, and no amount of extra CPU compensates.
2. **Set the replication URL to match the extract's region.** A country database updated from a continent's diff directory receives changes for territory it does not contain. Nothing warns you.
3. **Give the import all the cores.** The load and address stages parallelise reasonably well; the index stage less so. Expect the machine to be busy for hours on a country extract.
4. **Initialise replication immediately after the import.** The state is derived from the extract's own timestamp, so doing it later means guessing, and guessing means either a gap or a redundant replay.
5. **Verify against coordinates you already know.** The verification script checks three things at once: that the address matched at all, that it matched near the right place, and that it matched at a fine enough rank to be a real street match rather than a fallback.
6. **Treat a coarse place rank as a failure signal.** A result that resolves to a city when a street was supplied usually means the address computation stage did not complete, which is a far more common outcome than a completely failed import.
7. **Keep the import log.** When results look wrong three weeks later, the stage timings in the log are the fastest way to see whether a stage was skipped or cut short.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 306" role="img" aria-labelledby="inm2-t inm2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="inm2-t">Choosing between replication updates and periodic re-import for a private geocoder</title>
  <desc id="inm2-d">A decision node about how fresh the geocoder must be, with three outcomes. If results only need to reflect the map within a month, a periodic re-import from a fresh extract is simplest and gives predictable performance. If daily freshness is needed, attaching the replication update loop keeps the database current at the cost of continuous background work. If the results must be reproducible for audit, pinning one import and never updating it is the only approach that guarantees the same input gives the same output.</desc>
  <defs><marker id="inm2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="306" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">How fresh, and how reproducible, must the answers be?</text>
  <rect x="26" y="117" width="250" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="151" y="145" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Freshness or reproducibility?</text>
  <text x="151" y="167" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">The two pull in opposite directions</text>
  <text x="151" y="185" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Pick one deliberately</text>
  <line x1="276" y1="161" x2="314" y2="161" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="314" y2="239" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="353" y2="83" stroke="currentColor" stroke-width="1.4" marker-end="url(#inm2-a)"/>
  <rect x="356" y="52" width="498" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="370" y="77" font-size="12" font-weight="700" fill="currentColor">Periodic re-import</text>
  <text x="370" y="97" font-size="10.5" fill="currentColor" opacity="0.88">Monthly freshness, predictable performance, simple to operate</text>
  <line x1="314" y1="161" x2="353" y2="161" stroke="currentColor" stroke-width="1.4" marker-end="url(#inm2-a)"/>
  <rect x="356" y="130" width="498" height="62" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="370" y="155" font-size="12" font-weight="700" fill="currentColor">Replication updates</text>
  <text x="370" y="175" font-size="10.5" fill="currentColor" opacity="0.88">Daily or better freshness, continuous background work</text>
  <line x1="314" y1="239" x2="353" y2="239" stroke="currentColor" stroke-width="1.4" marker-end="url(#inm2-a)"/>
  <rect x="356" y="208" width="498" height="62" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="370" y="233" font-size="12" font-weight="700" fill="currentColor">Pinned, never updated</text>
  <text x="370" y="253" font-size="10.5" fill="currentColor" opacity="0.88">Audit reproducibility: same input, same output, forever</text>
  <text x="868" y="290" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A geocoder used to produce numbers somebody will defend later belongs in the third branch, whatever the freshness argument says.</text>
</svg>
<figcaption>Most teams default to the middle branch without noticing that it makes last quarter's results impossible to reproduce.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="inm3-t inm3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="inm3-t">Roughly how a Nominatim database grows relative to the source extract</title>
  <desc id="inm3-d">Five bars showing storage multiples relative to the source extract size. The raw place rows are about three times the extract. The computed address hierarchy adds the largest single increment, taking it to around seven times. The search token index takes it to around ten. The flatnode file, sized by the highest node identifier rather than by the region, adds a further couple of multiples. Working headroom for the import itself takes the practical requirement to around fifteen.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Size the disk on the database, not on the file</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Source extract</text>
  <rect x="276" y="60" width="31" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">1x baseline</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Place rows</text>
  <rect x="276" y="100" width="92" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 3x</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Plus address hierarchy</text>
  <rect x="276" y="140" width="214" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 7x</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Plus search index</text>
  <rect x="276" y="180" width="305" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 10x</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">Plus flatnode and headroom</text>
  <rect x="276" y="220" width="458" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">plan for 15x</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The flatnode file is sized by the highest node id in the planet, so it is surprisingly large even for a small country extract.</text>
</svg>
<figcaption>Sizing a volume from the extract alone is the most common way an overnight import dies at four in the morning.</figcaption>
</figure>

## Verification

- **Known addresses resolve near their known coordinates.** Within a kilometre is a generous tolerance that still catches a wholesale import failure.
- **Street-level queries return a fine place rank.** A coarse rank across the board means address computation did not finish.
- **Interpolated addresses resolve.** Pick a house number known to exist only as part of an interpolation range; if it fails, that pass was skipped.
- **Reverse geocoding returns a sensible hierarchy.** A reverse lookup at a known city centre should return the city, not just the country.
- **Replication state is initialised.** The stored sequence must correspond to the extract's timestamp, not to the present moment.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Import runs for days | Flatnode file on network storage | Move it to local disk and restart the import |
| Every result is city-level | Address computation did not complete | Check the log for the stage; rerun the indexing step |
| House numbers never match | Interpolation pass skipped | Re-enable interpolation and re-run the import |
| Out of disk near the end | Sized on the extract, not the database | Provision eight to fifteen times the extract size |
| Results drift from the public instance | Replication points at the wrong region | Match the replication URL to the extract exactly |
| Replication replays months of diffs | State initialised after the import, from "now" | Initialise replication immediately post-import |
| Queries slow after months of updates | Index bloat from continuous updates | Schedule a periodic re-import |

## Specification reference

> The Nominatim import reads an OSM file into a PostgreSQL/PostGIS database in distinct stages — loading, ranking, address computation and indexing — and uses an optional flatnode file to store node coordinates outside the database, which is recommended for imports of a country or larger. Replication state is initialised from the imported data's timestamp. See the [Nominatim installation and import documentation](https://nominatim.org/release-docs/latest/admin/Installation/) for stage-by-stage requirements and the current sizing guidance.

## Frequently Asked Questions

<details>
<summary>How much disk does a Nominatim import really need?</summary>

Between eight and fifteen times the source extract, depending on how densely the region is addressed. The place and address tables dominate, the search index adds substantially, and the flatnode file is sized by the highest node identifier rather than by the region, so it is surprisingly large even for a small country. Provision the upper end: running out during the address stage means restarting a multi-hour job from the beginning.
</details>

<details>
<summary>Do I need a flatnode file for a single country?</summary>

In practice yes. Without it, node coordinates are stored in the database and accessed through it, which turns the load stage into a database-bound crawl and inflates the database size considerably. The flatnode file is indexed directly by node identifier and is much faster, provided it sits on local random-access storage. Putting it on a network volume gives you the worst of both approaches.
</details>

<details>
<summary>Why do all my results come back at city level?</summary>

Because the address computation stage did not complete. That stage assigns every place its containing hierarchy, and without it the geocoder can still match a settlement name but has nothing finer to offer for a street or a house number. Check the import log for the stage's timings, and re-run the indexing step rather than assuming the whole import failed — the earlier stages are usually intact.
</details>

<details>
<summary>Should I attach replication updates or re-import periodically?</summary>

It depends on whether freshness or reproducibility matters more. Replication keeps the database within hours of the live map but runs continuously and slowly degrades query performance. A periodic re-import gives predictable performance and a clean database, at the cost of being a batch job. If the geocoded results will ever be defended in an audit, consider pinning one import and never updating it, because that is the only way the same input keeps producing the same output.
</details>

## Related

- [Nominatim Geocoding Pipelines](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/) — the parent topic and the ranking model the import produces.
- [Batch Geocoding with Nominatim Without Getting Blocked](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/batch-geocoding-with-nominatim-without-getting-blocked/) — the workload that motivates this import.
- [Running a Local Overpass Instance for Bulk Queries](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/running-a-local-overpass-instance-for-bulk-queries/) — the sibling self-hosting decision for query workloads.
- [Replication Sequence Numbers & State](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) — the state model the update loop keeps.
- [Pinning a Reproducible OSM Snapshot by Sequence Number](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/pinning-a-reproducible-osm-snapshot-by-sequence-number/) — how to make the pinned-import option genuinely reproducible.

Up one level: [Nominatim Geocoding Pipelines](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Importing Nominatim from an OSM Extract",
  "description": "Size, run and verify a private Nominatim import from a regional extract, including the flatnode file, the address interpolation pass, and keeping the instance current afterwards.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Querying OSM: Overpass, Nominatim & APIs",
  "about": ["Nominatim import", "flatnode file", "geocoder self-hosting"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Querying OSM: Overpass, Nominatim & APIs", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/" },
    { "@type": "ListItem", "position": 3, "name": "Nominatim Geocoding Pipelines", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/" },
    { "@type": "ListItem", "position": 4, "name": "Importing Nominatim from an OSM Extract", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/importing-nominatim-from-an-osm-extract/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Import a private Nominatim geocoder from a regional OSM extract",
  "description": "Provision storage, configure a local flatnode file and a matching replication source, run the staged import, initialise replication, and verify against known coordinates.",
  "step": [
    { "@type": "HowToStep", "name": "Provision storage", "text": "Allocate eight to fifteen times the extract size on fast local disk, including room for the flatnode file and the search index." },
    { "@type": "HowToStep", "name": "Place the flatnode file locally", "text": "Configure the flatnode file on random-access local storage, because the load stage reads it by node identifier throughout." },
    { "@type": "HowToStep", "name": "Match the replication source", "text": "Point the replication URL at the diff directory for exactly the region the extract covers." },
    { "@type": "HowToStep", "name": "Run the staged import", "text": "Run the import with all available threads and keep the log, which records the timing of each stage." },
    { "@type": "HowToStep", "name": "Initialise replication state", "text": "Initialise replication immediately after the import so the starting sequence derives from the extract's own timestamp." },
    { "@type": "HowToStep", "name": "Verify against known coordinates", "text": "Query addresses whose coordinates you already know and assert both the position and a fine enough place rank to prove the address stage completed." }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "How much disk does a Nominatim import really need?",
      "acceptedAnswer": { "@type": "Answer", "text": "Between eight and fifteen times the source extract, depending on how densely the region is addressed. The place and address tables dominate, the search index adds substantially, and the flatnode file is sized by the highest node identifier rather than by the region. Provision the upper end: running out during the address stage means restarting a multi-hour job." }
    },
    {
      "@type": "Question",
      "name": "Do I need a flatnode file for a single country?",
      "acceptedAnswer": { "@type": "Answer", "text": "In practice yes. Without it, node coordinates are stored in the database and accessed through it, which turns the load stage into a database-bound crawl and inflates the database size considerably. The flatnode file is indexed directly by node identifier and is much faster, provided it sits on local random-access storage." }
    },
    {
      "@type": "Question",
      "name": "Why do all my Nominatim results come back at city level?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because the address computation stage did not complete. That stage assigns every place its containing hierarchy, and without it the geocoder can still match a settlement name but has nothing finer to offer for a street or a house number. Check the import log for the stage's timings and re-run the indexing step rather than assuming the whole import failed." }
    },
    {
      "@type": "Question",
      "name": "Should I attach replication updates or re-import periodically?",
      "acceptedAnswer": { "@type": "Answer", "text": "It depends on whether freshness or reproducibility matters more. Replication keeps the database within hours of the live map but runs continuously and slowly degrades query performance. A periodic re-import gives predictable performance and a clean database. If the geocoded results will ever be defended in an audit, consider pinning one import and never updating it." }
    }
  ]
}
</script>
