---
title: "Replacing an Overpass Query with an osmium Filter"
description: "Translate a production Overpass query into a local osmium pipeline clause by clause — spatial bound, tag filter, recursion, output — and verify the two agree before switching over."
pageTitle: "Translate an Overpass Query into an osmium Pipeline"
pageDescription: "Move a scheduled Overpass query onto a local extract: map the spatial bound, tag filters, recursion and output mode onto osmium commands, then reconcile both results before cutting over."
slug: replacing-an-overpass-query-with-an-osmium-filter
type: article
breadcrumb: "Query to osmium Filter"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Replacing an Overpass Query with an osmium Filter

Take a query that has outgrown the shared server and turn it into a local pipeline that answers the same question in seconds — then prove the two agree before you delete the old code.

## Prerequisites

- [ ] `osmium-tool` installed and on the path, plus a regional extract covering the query's area.
- [ ] The query you intend to replace, in its current production form, including its output statement.
- [ ] The extract obtained and verified per [Automating Geofabrik Extract Downloads with Checksums](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/automating-geofabrik-extract-downloads-with-checksums/).
- [ ] A `.poly` boundary file if the query used an area filter rather than a bounding box — see [Building a .poly File from an OSM Admin Relation](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/building-a-poly-file-from-an-osm-admin-relation/).
- [ ] One archived Overpass response to reconcile against.

## Conceptual minimum

A production Overpass query is almost always four things: a spatial bound, a tag filter, sometimes a recursion, and an output mode. Each maps onto a local equivalent.

The spatial bound becomes `osmium extract`, either with `--bbox` for a rectangle or `--polygon` for a boundary file. The tag filter becomes `osmium tags-filter`, whose expression syntax covers key existence (`n/amenity`), exact values (`w/highway=residential`) and value sets (`w/highway=primary,secondary`), with the leading letter selecting node, way, relation or any. The recursion becomes a flag rather than an operator: `osmium tags-filter` keeps referenced nodes by default so filtered ways remain drawable, which is the downward recursion most queries use. The output mode becomes a choice of output format and whether your reader resolves geometry.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 342" role="img" aria-labelledby="roq1-t roq1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="roq1-t">Overpass clauses and their osmium equivalents</title>
  <desc id="roq1-d">A grid mapping four Overpass constructs onto local commands. A bounding box filter becomes osmium extract with a bounding box argument. An area filter becomes osmium extract with a polygon boundary file. A tag filter becomes an osmium tags-filter expression using the same key existence, exact value and value set forms. A downward recursion becomes the default reference-completing behaviour of tags-filter, while an upward recursion has no direct equivalent and needs a short script.</desc>
  <rect x="0" y="0" width="880" height="342" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four constructs, four local equivalents</text>
  <rect x="206" y="48" width="324" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="368" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">osmium equivalent</text>
  <rect x="530" y="48" width="324" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="692" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Notes</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Bounding box filter</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">osmium extract --bbox</text>
  <text x="692" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">exact equivalent</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Area filter</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">osmium extract --polygon</text>
  <text x="692" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">needs a .poly file</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Tag filter</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">osmium tags-filter</text>
  <text x="692" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">same match forms</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Downward recursion</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">default in tags-filter</text>
  <text x="692" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">references kept</text>
  <text x="30" y="289" font-size="11.5" font-weight="600" fill="currentColor">Upward recursion</text>
  <line x1="26" y1="308" x2="854" y2="308" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">no direct command</text>
  <text x="692" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">short script needed</text>
  <text x="868" y="326" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the last row lacks a one-command translation, and it appears in a small minority of production queries.</text>
</svg>
<figcaption>The mapping is this clean because osmium and Overpass are filtering the same element model with the same vocabulary.</figcaption>
</figure>

The one real asymmetry is ordering. Overpass evaluates a query as a whole and the server decides how to execute it. A local pipeline is a chain of passes, and **you** choose the order — which means you can get it badly wrong. Filtering by tag before cutting spatially means reading and rewriting the whole region for features you are about to discard; cutting spatially first shrinks the input for every later pass.

## Runnable solution

```bash
#!/usr/bin/env bash
# Replace:
#   [out:json][timeout:180];
#   area["name"="Kraków"]["admin_level"="8"]->.a;
#   ( node["amenity"="pharmacy"](area.a);
#     way["amenity"="pharmacy"](area.a); );
#   out center tags;
set -euo pipefail

EXTRACT="/data/poland-latest.osm.pbf"
POLY="/data/krakow.poly"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1. Spatial bound FIRST: every later pass reads a far smaller file.
osmium extract --polygon "$POLY" --strategy=complete_ways \
  --output "$WORK/area.osm.pbf" "$EXTRACT"

# 2. Tag filter. Referenced nodes are kept by default, so the matched ways
#    remain drawable — this is the downward recursion the query relied on.
osmium tags-filter --output "$WORK/pharmacies.osm.pbf" \
  "$WORK/area.osm.pbf" n/amenity=pharmacy w/amenity=pharmacy r/amenity=pharmacy

# 3. Output. GeoJSON with centroids is the local analogue of `out center`.
osmium export --output-format=geojsonseq --add-unique-id=type_id \
  --output "$WORK/pharmacies.geojsonseq" "$WORK/pharmacies.osm.pbf"

wc -l < "$WORK/pharmacies.geojsonseq"
cp "$WORK/pharmacies.geojsonseq" ./pharmacies.geojsonseq
```

Reconciliation is the step that makes the switch safe:

```python
from __future__ import annotations

import json
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.migrate.reconcile")


def keys_from_overpass(path: Path) -> set[str]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {f"{el['type']}/{el['id']}" for el in payload["elements"]
            if el.get("tags")}


def keys_from_geojsonseq(path: Path) -> set[str]:
    keys: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        feature = json.loads(line)
        # --add-unique-id=type_id emits ids like "n123" / "w456".
        raw = str(feature.get("id", ""))
        prefix = {"n": "node", "w": "way", "r": "relation"}.get(raw[:1])
        if prefix:
            keys.add(f"{prefix}/{raw[1:]}")
    return keys


def reconcile(overpass: Path, local: Path) -> bool:
    a, b = keys_from_overpass(overpass), keys_from_geojsonseq(local)
    only_remote, only_local = a - b, b - a
    logger.info("overpass %d, local %d, shared %d", len(a), len(b), len(a & b))
    for label, missing in (("only in Overpass", only_remote),
                           ("only in local", only_local)):
        if missing:
            logger.warning("%d %s, e.g. %s", len(missing), label,
                           sorted(missing)[:5])
    # A handful of differences is expected: the two sources are different dates.
    drift = len(only_remote | only_local) / max(len(a | b), 1)
    logger.info("symmetric difference %.2f%%", drift * 100)
    return drift < 0.02


if __name__ == "__main__":
    ok = reconcile(Path("overpass_archive.json"), Path("pharmacies.geojsonseq"))
    logger.info("reconciliation %s", "PASSED" if ok else "FAILED")
```

## Step-by-step walkthrough

1. **Cut spatially first.** The extract pass runs over the country file once; every subsequent pass reads a city-sized file. Reversing this order costs minutes per run forever.
2. **Choose the cut strategy deliberately.** `complete_ways` keeps ways that cross the boundary intact along with their outside nodes, matching what an Overpass area filter effectively gives you for drawable geometry.
3. **Name all three element types.** The original query unioned nodes and ways; the filter lists node, way and relation prefixes explicitly, which is both clearer and cheaper than a catch-all.
4. **Rely on reference completion, not a separate pass.** `tags-filter` keeps the nodes a matched way references, so the output is drawable without a second step. That is the `>` recursion, done by default.
5. **Pick an output analogous to the query's mode.** `osmium export` with centroids corresponds to `out center`; exporting full geometry corresponds to `out geom`. Choosing the wrong one changes the file size by an order of magnitude, exactly as it does server-side.
6. **Emit stable ids.** `--add-unique-id=type_id` gives each feature a type-prefixed identifier, which is what makes the reconciliation below possible and what downstream joins need anyway.
7. **Reconcile against an archived response.** The two sources are different dates, so a small symmetric difference is expected and healthy. A large one means a clause was translated wrongly, and the sample identifiers in the log point straight at which.
8. **Set the drift threshold explicitly.** Two percent is a starting point for a daily extract against a live query; tighten it if your extract is fresh and loosen it if it is a week old.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="roq2-t roq2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="roq2-t">The order of passes in a local replacement and why it is not negotiable</title>
  <desc id="roq2-d">Four passes in order. The spatial cut runs once over the full regional file and produces a city-sized file, which every later pass reads instead. The tag filter runs over that smaller file and keeps referenced nodes so matched ways stay drawable. The export converts the filtered file to the output format with stable type-prefixed identifiers. The reconcile step compares the identifier set against an archived response from the query being replaced. A note warns that swapping the first two passes makes every run read the whole region.</desc>
  <defs><marker id="roq2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Cut, filter, export, reconcile — in that order</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">cut</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">spatial bound first</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">once over the region</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#roq2-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">filter</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">tags on a small file</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">references kept</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#roq2-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">export</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">format plus stable ids</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">mode matches out</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#roq2-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">reconcile</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">against an archive</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">threshold, not zero</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Filtering before cutting reads and rewrites the entire region for features that are about to be discarded anyway.</text>
</svg>
<figcaption>The server chose this order for you in Overpass; locally it is your decision, and it is the one that dominates runtime.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 248" role="img" aria-labelledby="roq3-t roq3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="roq3-t">Relative wall-clock cost of the two possible pass orderings on a country extract</title>
  <desc id="roq3-d">Four measurements comparing two orderings on a country-sized input. Cutting spatially and then filtering by tag spends most of its time in the single cut pass and almost none in the filter, because the filter reads a city-sized file. Filtering by tag and then cutting spends a long time in the filter, which reads and rewrites the entire country, and then a short time in the cut. The total for the second ordering is several times the first.</desc>
  <rect x="0" y="0" width="880" height="248" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Same two passes, several times the runtime</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Cut first: the cut</text>
  <rect x="286" y="60" width="187" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">reads the country</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Cut first: the filter</text>
  <rect x="286" y="100" width="25" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">reads a city</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Filter first: the filter</text>
  <rect x="286" y="140" width="448" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">rewrites it all</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Filter first: the cut</text>
  <rect x="286" y="180" width="162" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">reads the rewrite</text>
  <text x="868" y="232" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The second ordering pays the country-sized read twice and writes a country-sized intermediate file nobody ever looks at.</text>
</svg>
<figcaption>Nothing about the result differs between the two orderings — only the time, and the disk the intermediate file consumes.</figcaption>
</figure>

## Verification

- **The symmetric difference is small.** A few percent between a daily extract and a live query is normal; twenty percent means a clause is wrong.
- **Differences are dated, not structural.** Sample identifiers that appear only in the live response should be recently created objects, not a whole feature class.
- **The spatial cut runs once.** Time both orderings on a country extract; cutting first should be several times faster overall.
- **Matched ways are drawable.** Open the filtered output and confirm ways have coordinates rather than dangling references.
- **Identifiers are type-prefixed.** A numeric id alone collides across element types and will silently merge unrelated features in a later join.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Pipeline slower than the query | Tag filter runs before the spatial cut | Cut spatially first, always |
| Ways have no geometry | Reference completion disabled | Let `tags-filter` keep referenced nodes by default |
| Whole feature class missing | One element prefix omitted from the filter | List node, way and relation prefixes explicitly |
| Roads end at the boundary | Simple cut strategy used | Cut with `complete_ways` when geometry crosses the edge |
| Reconciliation shows huge drift | Area filter translated to a loose bounding box | Use a `.poly` boundary matching the original area |
| Duplicate features after a join | Numeric ids without a type prefix | Export with type-prefixed unique identifiers |
| Reconciliation never passes | Threshold set to exact equality | Expect drift; the two sources are different dates |

## Specification reference

> `osmium tags-filter` selects objects by expressions of the form `[nwr]/key=value`, where the leading characters restrict the object type and the value part may be omitted to match any value or given as a comma-separated list. By default the command also outputs the nodes referenced by matched ways and the members of matched relations, so that geometry can be reconstructed. See the [osmium-tool documentation](https://osmcode.org/osmium-tool/manual.html) for the full expression grammar and the reference-completion options.

## Frequently Asked Questions

<details>
<summary>Why does the order of passes matter so much?</summary>

Because each pass reads its whole input. Cutting spatially first means the expensive tag pass runs over a city-sized file; doing it the other way round means the tag pass reads and rewrites an entire country before the spatial cut discards most of it. Overpass hides this decision behind a query planner, so people migrating a query often do not realise they have inherited responsibility for it.
</details>

<details>
<summary>What replaces an upward recursion?</summary>

There is no single command for it, because finding the relations that reference a set of ways requires a pass over relations that you then intersect with your set. In practice it is a short script: read the relations, keep those with a member in your identifier set, then re-run reference completion so their members are present. It appears in a small minority of production queries, which is why the rest of the translation is as mechanical as it is.
</details>

<details>
<summary>How much difference between the two results is acceptable?</summary>

Enough to account for the age gap and no more. A daily extract compared against a live query will differ by whatever was edited in between, which for a city-sized area of interest is typically well under a couple of percent. What matters is the shape of the difference: objects that exist only in the live response should be recent creations scattered across the area, not an entire feature class, which would indicate a mistranslated clause.
</details>

<details>
<summary>Do I still need a boundary polygon, or is a bounding box enough?</summary>

If the original query used an area filter, use a polygon. A bounding box around a city includes neighbouring territory, and the surplus features it admits look exactly like a translation error when you reconcile. Extract the boundary once from the same administrative relation the query named, keep it in version control alongside the pipeline, and the two definitions stay aligned.
</details>

## Related

- [Choosing Between Overpass and a Local Extract](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/) — the parent topic and the decision this migration follows.
- [Estimating the Cost of an Overpass Query](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/estimating-the-cost-of-an-overpass-query/) — the measurement that usually triggers the move.
- [Chaining osmium-tool Commands in a Shell Pipeline](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/chaining-osmium-tool-commands-in-a-shell-pipeline/) — composing the passes efficiently.
- [Choosing Complete Ways vs Smart in osmium extract](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/choosing-complete-ways-vs-smart-in-osmium-extract/) — the cut strategy this pipeline depends on.
- [Clipping an OSM Extract with a .poly Boundary](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/clipping-an-osm-extract-with-a-poly-boundary/) — producing the boundary file the area filter becomes.

Up one level: [Choosing Between Overpass and a Local Extract](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Replacing an Overpass Query with an osmium Filter",
  "description": "Translate a production Overpass query into a local osmium pipeline clause by clause — spatial bound, tag filter, recursion, output — and verify the two agree before switching over.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Querying OSM: Overpass, Nominatim & APIs",
  "about": ["osmium tags-filter", "query migration", "result reconciliation"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Querying OSM: Overpass, Nominatim & APIs", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/" },
    { "@type": "ListItem", "position": 3, "name": "Choosing Between Overpass and a Local Extract", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/" },
    { "@type": "ListItem", "position": 4, "name": "Replacing an Overpass Query with an osmium Filter", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/replacing-an-overpass-query-with-an-osmium-filter/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Translate an Overpass query into a local osmium pipeline",
  "description": "Map each query clause onto an osmium command, run the spatial cut before the tag filter, export with stable type-prefixed identifiers, and reconcile against an archived response before cutting over.",
  "step": [
    { "@type": "HowToStep", "name": "Cut spatially first", "text": "Run osmium extract with a bounding box or boundary polygon so every later pass reads a far smaller file." },
    { "@type": "HowToStep", "name": "Choose the cut strategy", "text": "Use a strategy that keeps ways crossing the boundary intact when the consumer needs drawable or traversable geometry." },
    { "@type": "HowToStep", "name": "Translate the tag filter", "text": "Express the query's tag conditions as osmium tags-filter terms, naming each element type prefix explicitly." },
    { "@type": "HowToStep", "name": "Rely on reference completion", "text": "Let the filter keep the nodes referenced by matched ways, which reproduces the downward recursion most queries use." },
    { "@type": "HowToStep", "name": "Match the output mode", "text": "Export centroids where the query used centre output and full geometry where it inlined coordinates." },
    { "@type": "HowToStep", "name": "Emit stable identifiers", "text": "Add type-prefixed unique identifiers so features can be reconciled and joined without collisions across element types." },
    { "@type": "HowToStep", "name": "Reconcile before cutting over", "text": "Compare the identifier sets from an archived query response and the local output, and accept a small dated difference rather than exact equality." }
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
      "name": "Why does the order of osmium passes matter so much?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because each pass reads its whole input. Cutting spatially first means the expensive tag pass runs over a city-sized file; doing it the other way round means the tag pass reads and rewrites an entire country before the spatial cut discards most of it. Overpass hides this decision behind a query planner, so people migrating a query often do not realise they have inherited responsibility for it." }
    },
    {
      "@type": "Question",
      "name": "What replaces an upward recursion when migrating off Overpass?",
      "acceptedAnswer": { "@type": "Answer", "text": "There is no single command for it, because finding the relations that reference a set of ways requires a pass over relations that you then intersect with your set. In practice it is a short script: read the relations, keep those with a member in your identifier set, then re-run reference completion so their members are present." }
    },
    {
      "@type": "Question",
      "name": "How much difference between a query and a local filter is acceptable?",
      "acceptedAnswer": { "@type": "Answer", "text": "Enough to account for the age gap and no more. A daily extract compared against a live query will differ by whatever was edited in between, typically well under a couple of percent for a city-sized area. What matters is the shape of the difference: objects only in the live response should be recent creations scattered across the area, not an entire feature class." }
    },
    {
      "@type": "Question",
      "name": "Do I still need a boundary polygon, or is a bounding box enough?",
      "acceptedAnswer": { "@type": "Answer", "text": "If the original query used an area filter, use a polygon. A bounding box around a city includes neighbouring territory, and the surplus features it admits look exactly like a translation error when you reconcile. Extract the boundary once from the same administrative relation the query named and keep it in version control alongside the pipeline." }
    }
  ]
}
</script>
