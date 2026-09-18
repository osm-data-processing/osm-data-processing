---
title: "Reading OSM PBF with DuckDB Spatial"
description: "Query a PBF file directly in SQL without an ingestion step, understand what the reader gives you and what it does not, and know when to fall back to a real parser."
pageTitle: "Querying an OSM PBF Directly in DuckDB"
pageDescription: "Read an OSM PBF with DuckDB's spatial extension, work with the flat element rows it returns, assemble geometry yourself where needed, and recognise when a streaming parser is the better tool."
slug: reading-osm-pbf-with-duckdb-spatial
type: article
breadcrumb: "PBF in DuckDB"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Reading OSM PBF with DuckDB Spatial

Pointing SQL at a PBF file with no ingestion step is genuinely useful, and it is also the shortest route to a misunderstanding: the reader gives you OSM's element model, not features, and the gap between them is where most of the work lives.

## Prerequisites

- [ ] DuckDB with the spatial extension installed and loaded.
- [ ] A regional PBF file; the reader handles anything a parser would.
- [ ] The element model from [Node, Way & Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/).
- [ ] Realistic expectations, set by [Choosing an OSM Parser: pyosmium, pyrosm or osmium-tool](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/).
- [ ] Memory for the query, since a whole-file scan is a scan.

## Conceptual minimum

The reader exposes a PBF as a table of **elements**, not features. Each row is a node, a way or a relation, with its identifier, its tags as a map, and — for nodes — a coordinate. Ways carry a list of node references; relations carry members.

That model has three consequences.

**Nodes are mostly not features.** The overwhelming majority exist only to give ways their shape, and a query that selects all nodes selects ten times more rows than there are things in the world.

**Way geometry is not there.** A way row holds references, not coordinates, so building a line means joining back to the nodes and ordering by position — a self-join over the largest table in the file.

**Relations are harder still.** Assembling a multipolygon requires the ring logic described in [Handling Multipolygon Members with No Role](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/handling-multipolygon-members-with-no-role/), which is not expressible in a single query.

Where the reader is excellent is **tag-level questions about nodes**: counting amenities, finding value distributions, auditing a key's usage. Those are one filter over one table and they need no geometry assembly at all.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="rpd1-t rpd1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="rpd1-t">Which questions the direct reader answers well, and which need a parser</title>
  <desc id="rpd1-d">A grid of four question shapes against how well a direct SQL reader handles each. Counting tagged nodes by value is a single filter over one table and is answered excellently. Auditing which keys appear and how often is a map aggregation and is also answered excellently. Building way geometry requires a self-join against the node table ordered by position, which works but is expensive. Assembling multipolygon relations requires ring logic that a single query cannot express, so a parser is the right tool.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four question shapes, two the reader excels at</text>
  <rect x="226" y="48" width="314" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="383" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Reader handles it</text>
  <rect x="540" y="48" width="314" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="697" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Why</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Count tagged nodes</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="383" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">excellently</text>
  <text x="697" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">one filter, one table</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Audit key usage</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="383" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">excellently</text>
  <text x="697" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a map aggregation</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Build way geometry</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="383" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">expensively</text>
  <text x="697" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a self-join on nodes</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Assemble relations</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="383" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">not really</text>
  <text x="697" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">ring logic, not SQL</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The first two are the majority of ad hoc questions people actually have about an extract, which is why the reader is so useful.</text>
</svg>
<figcaption>Reaching for it to build features is where the frustration starts; reaching for it to ask about tags is where it shines.</figcaption>
</figure>

## Runnable solution

```sql
-- Query a PBF directly. No ingestion, no intermediate files.
INSTALL spatial;
LOAD spatial;

-- 1. What the reader gives you: one row per ELEMENT, tags as a map.
SELECT kind, count(*) AS elements
FROM st_readosm('poland-latest.osm.pbf')
GROUP BY kind
ORDER BY elements DESC;

-- 2. The reader's strongest use: a tag-level question over nodes.
SELECT tags['amenity'] AS amenity, count(*) AS n
FROM st_readosm('poland-latest.osm.pbf')
WHERE kind = 'node' AND tags['amenity'] IS NOT NULL
GROUP BY amenity
ORDER BY n DESC
LIMIT 20;

-- 3. Key usage audit: which keys exist, and how widely.
SELECT key, count(*) AS uses
FROM (
  SELECT unnest(map_keys(tags)) AS key
  FROM st_readosm('poland-latest.osm.pbf')
  WHERE tags IS NOT NULL AND len(tags) > 0
)
GROUP BY key
HAVING uses > 1000
ORDER BY uses DESC;

-- 4. Way geometry: possible, and a self-join against the largest table.
--    Worth doing once into a table, never repeatedly in an ad hoc query.
CREATE TABLE node_xy AS
SELECT id, lon, lat
FROM st_readosm('poland-latest.osm.pbf')
WHERE kind = 'node';

CREATE TABLE way_line AS
WITH refs AS (
  SELECT w.id AS way_id,
         unnest(w.refs) AS node_id,
         generate_subscripts(w.refs, 1) AS position,
         w.tags AS tags
  FROM st_readosm('poland-latest.osm.pbf') w
  WHERE w.kind = 'way' AND w.tags['highway'] IS NOT NULL
)
SELECT r.way_id,
       any_value(r.tags) AS tags,
       -- Ordering by position is essential: a line built from unordered
       -- coordinates is a scribble, and nothing about it errors.
       ST_MakeLine(list(ST_Point(n.lon, n.lat) ORDER BY r.position)) AS geom
FROM refs r
JOIN node_xy n ON n.id = r.node_id
GROUP BY r.way_id
HAVING count(*) >= 2;
```

```python
from __future__ import annotations

import logging

import duckdb

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.duckdb.pbf")


def key_audit(path: str, minimum: int = 1000) -> list[tuple[str, int]]:
    """Which tag keys appear often enough to be worth modelling?"""
    conn = duckdb.connect()
    conn.execute("INSTALL spatial; LOAD spatial;")
    rows = conn.execute("""
        SELECT key, count(*) AS uses
        FROM (SELECT unnest(map_keys(tags)) AS key
              FROM st_readosm(?) WHERE tags IS NOT NULL AND len(tags) > 0)
        GROUP BY key HAVING uses >= ? ORDER BY uses DESC
    """, [path, minimum]).fetchall()
    logger.info("%d key(s) used at least %d time(s)", len(rows), minimum)
    return rows


def geometry_cost_warning(path: str) -> None:
    """Report how large the node table is before anybody joins against it."""
    conn = duckdb.connect()
    conn.execute("INSTALL spatial; LOAD spatial;")
    nodes, tagged = conn.execute("""
        SELECT count(*) FILTER (WHERE kind = 'node'),
               count(*) FILTER (WHERE kind = 'node' AND len(tags) > 0)
        FROM st_readosm(?)
    """, [path]).fetchone()
    logger.info("%d node(s), of which %d carry tags (%.1f%%)",
                nodes, tagged, 100 * tagged / max(1, nodes))
    if nodes > 50_000_000:
        logger.warning("a way-geometry self-join against %d node(s) will be "
                       "slow and memory-hungry; materialise the node table "
                       "once or use a streaming parser", nodes)


if __name__ == "__main__":
    geometry_cost_warning("poland-latest.osm.pbf")
    for key, uses in key_audit("poland-latest.osm.pbf")[:15]:
        logger.info("%-24s %d", key, uses)
```

## Step-by-step walkthrough

1. **Understand the row shape first.** Grouping by element kind before anything else establishes that the table is elements, not features, and shows the ratio of nodes to everything else.
2. **Ask tag questions directly.** A filter on a map key over one table is exactly what the reader is good at, and it needs no joins, no geometry and no assembly.
3. **Audit keys with an unnest.** Expanding the tag map into rows makes "which keys exist and how often" a one-query answer, which is the fastest way to decide what a schema should promote.
4. **Materialise the node table once.** Every way-geometry query joins against it, and re-reading the file for each one is the difference between a minute and an hour.
5. **Order by position when building lines.** A way's node references are ordered and the order is the shape; aggregating without it produces a line that is geometrically nonsense and raises nothing.
6. **Filter ways before joining.** Restricting to the ways you actually want before the self-join keeps the join's left side small, which is the only lever that matters on that query.
7. **Warn about scale.** Reporting the node count before somebody writes a self-join is the difference between an informed wait and a confused one.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 248" role="img" aria-labelledby="rpd2-t rpd2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="rpd2-t">Relative cost of four query shapes against the same PBF file</title>
  <desc id="rpd2-d">Four query shapes measured against one country extract. Counting elements by kind is a single pass with no joins and is the baseline. A tag-level aggregation over nodes is a similar single pass with a filter. Building geometry for a filtered subset of ways requires a self-join against the node table and costs an order of magnitude more. Building geometry for every way costs another order of magnitude again and is where a streaming parser becomes the better tool.</desc>
  <rect x="0" y="0" width="880" height="248" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four query shapes against one country extract</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Count by element kind</text>
  <rect x="256" y="60" width="6" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">baseline</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Tag aggregation on nodes</text>
  <rect x="256" y="100" width="6" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 1.6x</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Geometry for filtered ways</text>
  <rect x="256" y="140" width="57" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 19x</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Geometry for all ways</text>
  <rect x="256" y="180" width="478" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 160x</text>
  <text x="868" y="232" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The jump between the second and third rows is the node self-join, and it is why materialising the node table once pays for itself immediately.</text>
</svg>
<figcaption>The first two shapes are the ones worth reaching for SQL to answer; the last is the one worth reaching for a parser.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="rpd3-t rpd3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="rpd3-t">What has to happen between an element row and a usable feature</title>
  <desc id="rpd3-d">Four stages showing the gap the reader leaves. The element row arrives with an identifier, a tag map and either a coordinate or a list of references. The resolve stage joins way references back to node coordinates, which is a self-join against the largest table in the file. The order stage arranges those coordinates by reference position, since the order is the geometry. The assemble stage builds rings and resolves containment for relations, which requires logic a query cannot express.</desc>
  <defs><marker id="rpd3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three stages the reader leaves to you</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">element row</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">tags plus references</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">what you get</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#rpd3-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">resolve</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">join to node coordinates</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">the expensive part</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#rpd3-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">order</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">by reference position</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">order is the shape</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#rpd3-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">assemble</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">rings and containment</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">not expressible in SQL</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A parser does all three internally, which is exactly the work you take on when reaching for SQL instead.</text>
</svg>
<figcaption>The trade is real in both directions: SQL gives you the tag questions for free and charges for the geometry ones.</figcaption>
</figure>

## Verification

- **Element counts match a reference.** Compare the counts by kind against `osmium fileinfo`.
- **Tagged node share is plausible.** Well under a fifth of nodes carrying tags is normal; a much higher figure suggests the file is not a general extract.
- **Line geometry follows the road.** Render a few built ways and confirm they trace roads rather than zig-zagging, which is the signature of a missing order clause.
- **Key audit agrees with expectations.** The most common keys should be the ones you would predict; a surprise near the top usually means an import in the region.
- **Memory stays bounded.** Watch the process during a geometry query; a spike to many gigabytes means the join is materialising more than expected.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Lines zig-zag randomly | Node order lost in aggregation | Order by the reference position inside the aggregate |
| Query runs for hours | Self-join over all nodes | Materialise the node table and filter ways first |
| Memory exhausted | Whole-file join materialised | Restrict the way set before joining |
| Ways have one point | Nodes missing from the extract | Require at least two matched references |
| Tag filter matches nothing | Map access on a null tag column | Guard for a null or empty tag map |
| Counts differ from a reference | Elements confused with features | Group by element kind and read the shape first |
| Relations look empty | Members present but geometry absent | Assemble relations with a parser, not in SQL |

## Specification reference

> DuckDB's spatial extension provides a reader that exposes an OSM PBF file as a table of elements, with identifier, kind, a tag map, node coordinates and way references or relation members. It does not assemble way or relation geometry, which remains the consumer's responsibility. See the [DuckDB spatial extension documentation](https://duckdb.org/docs/extensions/spatial) for the reader's columns and its limitations.

## Frequently Asked Questions

<details>
<summary>Can I use this instead of a parser?</summary>

For tag-level questions, yes, and it is often the better tool: no ingestion step, full SQL, and an answer in the time a parser would take to start. For anything needing geometry it depends on scale — a filtered subset of ways is entirely workable, and building geometry for every way in a country is where a streaming parser wins decisively on both time and memory.
</details>

<details>
<summary>Why do my lines look like scribbles?</summary>

Because the node order was lost. A way's references are an ordered list and that order is the road's shape; aggregating the joined coordinates without an explicit order produces whatever the engine happened to emit. Nothing errors, the geometry is valid, and it traces a path no road follows. An ordering clause inside the aggregate is the whole fix.
</details>

<details>
<summary>Why is the way-geometry query so slow?</summary>

Because it joins against the node table, which is the largest thing in the file by an order of magnitude. Materialising the nodes once rather than re-reading the file per query removes most of the cost, and filtering the ways before the join rather than after removes most of the rest. Both together turn an intolerable query into a slow but usable one.
</details>

<details>
<summary>What about relations?</summary>

The reader gives you members and roles, which is the input to assembly rather than the result of it. Building a multipolygon requires stitching member ways into rings and resolving containment geometrically, which is not something a single query expresses. Read the members in SQL if that helps you understand the data, and assemble in a parser.
</details>

## Related

- [Choosing an OSM Parser: pyosmium, pyrosm or osmium-tool](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/) — the parent topic and the alternatives.
- [Chaining osmium-tool Commands in a Shell Pipeline](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/chaining-osmium-tool-commands-in-a-shell-pipeline/) — the command-line route to the same filtering.
- [Node, Way & Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — the element model the reader exposes.
- [Handling Multipolygon Members with No Role](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/handling-multipolygon-members-with-no-role/) — the assembly SQL cannot do.
- [Modelling OSM for Analytics Warehouses](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/) — where a key audit feeds the schema decision.

Up one level: [Choosing an OSM Parser: pyosmium, pyrosm or osmium-tool](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Reading OSM PBF with DuckDB Spatial",
  "description": "Query a PBF file directly in SQL without an ingestion step, understand what the reader gives you and what it does not, and know when to fall back to a real parser.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["DuckDB spatial", "direct PBF query", "element model"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Parsing & Tag Normalization Workflows", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/" },
    { "@type": "ListItem", "position": 3, "name": "Choosing an OSM Parser: pyosmium, pyrosm or osmium-tool", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/" },
    { "@type": "ListItem", "position": 4, "name": "Reading OSM PBF with DuckDB Spatial", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/reading-osm-pbf-with-duckdb-spatial/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Query an OSM PBF file directly with SQL",
  "description": "Establish the element row shape, answer tag-level questions with single-table filters, materialise the node table once before any geometry work, order references when building lines, and fall back to a parser for relations.",
  "step": [
    { "@type": "HowToStep", "name": "Establish the row shape", "text": "Group by element kind first, so it is clear the table holds elements rather than features." },
    { "@type": "HowToStep", "name": "Ask tag questions directly", "text": "Filter and aggregate on the tag map over a single table, which is what the reader does best." },
    { "@type": "HowToStep", "name": "Audit keys with an unnest", "text": "Expand the tag map into rows to count key usage, which informs what a schema should promote." },
    { "@type": "HowToStep", "name": "Materialise the node table", "text": "Create a node coordinate table once rather than re-reading the file for every geometry query." },
    { "@type": "HowToStep", "name": "Filter ways before joining", "text": "Restrict the way set before the self-join, since that is the only lever that materially changes its cost." },
    { "@type": "HowToStep", "name": "Order references in the aggregate", "text": "Build lines with an explicit ordering by reference position, or the geometry traces no real road." },
    { "@type": "HowToStep", "name": "Use a parser for relations", "text": "Read members in SQL for understanding, and assemble multipolygons with code that can do ring logic." }
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
      "name": "Can DuckDB replace an OSM parser?",
      "acceptedAnswer": { "@type": "Answer", "text": "For tag-level questions, yes, and it is often the better tool: no ingestion step, full SQL, and an answer in the time a parser would take to start. For anything needing geometry it depends on scale — a filtered subset of ways is workable, and building geometry for every way in a country is where a streaming parser wins decisively." }
    },
    {
      "@type": "Question",
      "name": "Why do lines built from OSM ways in SQL look like scribbles?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because the node order was lost. A way's references are an ordered list and that order is the road's shape; aggregating joined coordinates without an explicit order produces whatever the engine emitted. Nothing errors and the geometry is valid, but it traces a path no road follows." }
    },
    {
      "@type": "Question",
      "name": "Why is a way-geometry query against a PBF so slow?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because it joins against the node table, the largest thing in the file by an order of magnitude. Materialising the nodes once rather than re-reading the file per query removes most of the cost, and filtering ways before the join removes most of the rest." }
    },
    {
      "@type": "Question",
      "name": "Can I assemble OSM relations in SQL?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not practically. The reader gives you members and roles, which is the input to assembly rather than its result. Building a multipolygon requires stitching member ways into rings and resolving containment geometrically, which a single query does not express. Read members in SQL for understanding and assemble in a parser." }
    }
  ]
}
</script>
