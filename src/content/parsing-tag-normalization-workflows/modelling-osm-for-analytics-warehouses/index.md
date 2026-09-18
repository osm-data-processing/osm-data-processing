---
title: "Modelling OSM for Analytics Warehouses"
description: "Turning OSM's tag soup into a warehouse schema: what becomes a dimension, how to model tags that will not fit columns, partitioning choices, and keeping history without a full reload."
pageTitle: "Modelling OpenStreetMap Data for an Analytics Warehouse"
pageDescription: "Design a warehouse schema over OSM: a feature fact table with stable keys, a tag model that survives open-ended keys, deliberate partitioning, and incremental loads driven by the diff stream."
slug: modelling-osm-for-analytics-warehouses
type: guide
breadcrumb: "Analytics Warehouses"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Modelling OSM for Analytics Warehouses

OSM resists warehouse modelling for one specific reason: the tag set is open. There is no fixed list of attributes, new keys appear continuously, and any schema built by enumerating columns is out of date before it ships.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 290" role="img" aria-labelledby="moa1-t moa1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="moa1-t">How OSM elements become a warehouse schema</title>
  <desc id="moa1-d">Normalized OSM features enter three parallel modelling decisions. The feature table holds one row per feature with a stable surrogate key, its geometry, and the small set of attributes every consumer needs. The tag model holds the open-ended remainder, either as a key-value table or as a semi-structured column. The dimension tables hold the classifications and administrative hierarchy that queries group by. All three are keyed consistently so a query can join across them without knowing which decision a given attribute fell under.</desc>
  <defs><marker id="moa1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="290" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">One feature, three modelling decisions</text>
  <rect x="26" y="122" width="240" height="56" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="146" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">normalized features</text>
  <text x="146" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">tags and geometry</text>
  <rect x="320" y="50" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="74" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">feature table</text>
  <text x="440" y="92" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">key, geometry, core</text>
  <rect x="320" y="122" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">tag model</text>
  <text x="440" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">the open remainder</text>
  <rect x="320" y="194" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="218" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">dimensions</text>
  <text x="440" y="236" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">class and hierarchy</text>
  <rect x="614" y="122" width="240" height="56" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="734" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">consistent keys</text>
  <text x="734" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">joinable across all three</text>
  <line x1="266" y1="150" x2="293" y2="150" stroke="currentColor" stroke-width="1.4"/>
  <line x1="293" y1="78" x2="293" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="293" y1="78" x2="317" y2="78" stroke="currentColor" stroke-width="1.4" marker-end="url(#moa1-a)"/>
  <line x1="293" y1="150" x2="317" y2="150" stroke="currentColor" stroke-width="1.4" marker-end="url(#moa1-a)"/>
  <line x1="293" y1="222" x2="317" y2="222" stroke="currentColor" stroke-width="1.4" marker-end="url(#moa1-a)"/>
  <line x1="560" y1="78" x2="587" y2="78" stroke="currentColor" stroke-width="1.4"/>
  <line x1="560" y1="150" x2="587" y2="150" stroke="currentColor" stroke-width="1.4"/>
  <line x1="560" y1="222" x2="587" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="587" y1="78" x2="587" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="587" y1="150" x2="611" y2="150" stroke="currentColor" stroke-width="1.4" marker-end="url(#moa1-a)"/>
  <text x="868" y="274" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The middle column is the whole design: which attributes are promoted to columns and which stay in the open model.</text>
</svg>
<figcaption>Getting the split wrong is recoverable; getting the key inconsistent across the three is not.</figcaption>
</figure>

## The Problem This Topic Solves

You need OSM data in a warehouse so analysts can query it alongside everything else, and the obvious approach — a wide table with a column per interesting tag — fails predictably. It fails when a new key matters, when a region uses a tagging convention nobody anticipated, and when somebody asks a question about a tag that was dropped because it was not in the original list.

The failure scenario is a schema that ossifies. Twenty columns were chosen, the pipeline drops everything else, and eighteen months later answering a new question means re-running the whole ingestion because the data needed was never stored. Meanwhile the twenty columns are mostly null, because most features carry only a handful of tags.

## Prerequisites

Have normalized features from [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/), and understand the identity problem from [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/) — a warehouse key that is an OSM identifier inherits every instability that topic describes.

## The Three Modelling Decisions

**Which attributes become columns.** Promote an attribute when most features have it, when queries filter or group on it, and when its type is stable. Feature class, name, administrative area and geometry qualify almost always. A tag carried by two percent of features does not, however interesting it is.

**How the remaining tags are stored.** Three options, each with a real cost. A **key-value table** with one row per tag is flexible and makes every tag query a join, which for wide scans is expensive. A **semi-structured column** — a map or JSON type — keeps everything on the feature row and is queryable in most modern warehouses, at the cost of type discipline. A **hybrid** promotes a small set and keeps the rest semi-structured, which is what most production schemas converge on.

**What the dimensions are.** Feature class, administrative hierarchy and time are the three that recur. The administrative hierarchy in particular is worth materialising as a dimension rather than computed per query, because a point-in-polygon join over a country's boundaries is expensive and the answer changes rarely.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="moa2-t moa2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="moa2-t">Three ways to store the open-ended tag set, compared</title>
  <desc id="moa2-d">A grid of four properties against three tag storage models. A key-value table stores one row per tag, handles any key, requires a join for every tag predicate, and scans poorly for wide queries. A semi-structured map column stores all tags on the feature row, handles any key, requires no join, and scans well but offers weak type guarantees. A hybrid promotes frequently used tags to real columns and keeps the rest in a map, which gives typed fast access to the common cases and full flexibility for the rest at the cost of two places to look.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three tag models, and most schemas end at the third</text>
  <rect x="196" y="48" width="219" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="306" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Key-value table</text>
  <rect x="415" y="48" width="219" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="525" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Map column</text>
  <rect x="635" y="48" width="219" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="744" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Hybrid</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Any key</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">yes</text>
  <text x="525" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">yes</text>
  <text x="744" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">yes</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Join needed</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">always</text>
  <text x="525" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">never</text>
  <text x="744" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">for the map only</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Wide scans</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">poor</text>
  <text x="525" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">good</text>
  <text x="744" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">good</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Type safety</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">none</text>
  <text x="525" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">weak</text>
  <text x="744" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">strong where promoted</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The hybrid's cost is that an analyst must know which attributes are columns, which is solved by a view rather than by a schema change.</text>
</svg>
<figcaption>Starting with the second model and promoting columns as query patterns emerge is the least regrettable path.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 328" role="img" aria-labelledby="moa3-t moa3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="moa3-t">How many features carry each candidate attribute, on a country extract</title>
  <desc id="moa3-d">Six candidate attributes with the share of features carrying each, which is the evidence for deciding what to promote to a column. Geometry is present on every feature by definition. A feature class derived from the primary tag is present on nearly all. A name is present on a minority. An address is present on fewer still. Opening hours and a website are each present on a small fraction. A note observes that promoting anything below roughly a fifth produces a column that is mostly null.</desc>
  <rect x="0" y="0" width="880" height="328" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Presence rate decides what becomes a column</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Geometry</text>
  <rect x="226" y="60" width="508" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">100%</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Feature class</text>
  <rect x="226" y="100" width="493" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 97%</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Name</text>
  <rect x="226" y="140" width="157" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 31%</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Address</text>
  <rect x="226" y="180" width="71" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 14%</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">Opening hours</text>
  <rect x="226" y="220" width="15" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 3%</text>
  <text x="26" y="274" font-size="11.5" font-weight="600" fill="currentColor">Website</text>
  <rect x="226" y="260" width="10" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="274" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 2%</text>
  <text x="868" y="312" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Below roughly a fifth, a promoted column is mostly null and costs more in storage and confusion than the join it avoids.</text>
</svg>
<figcaption>Measuring presence on your own extract is a minute's work and settles an argument that otherwise runs for weeks.</figcaption>
</figure>

## Partitioning Is a Query Decision

Partitioning an OSM warehouse table wrongly is the difference between a query scanning a gigabyte and a terabyte, and the choice follows from how it is queried rather than from how the data arrives.

**By administrative area** suits queries that are almost always scoped to a country or region, which is the common case for OSM analytics. It partitions unevenly — some countries are enormous — but it matches the filter analysts actually apply.

**By feature class** suits queries that look at one kind of thing across a wide area. It partitions very unevenly, since buildings and roads dominate.

**By a spatial cell** — an H3 cell or a quadkey prefix, as compared in [Spatial Index Selection: R-tree vs H3 vs Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/) — partitions evenly and suits arbitrary spatial filters, at the cost of every query needing to translate its region into cells.

**By load date** suits nothing about the queries and everything about the loading, which is why it is so often chosen and so often regretted.

Most production schemas partition by area and cluster or sort within a partition by a spatial cell, which serves both the common filter and the arbitrary one. The details are worked through in [Choosing Partition Keys for an OSM Data Lake](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/choosing-partition-keys-for-an-osm-data-lake/).

## Geometry in a Warehouse

Geometry is the one column that behaves unlike everything else, and how it is stored decides which questions are answerable at all.

**Store it, do not derive it.** A table holding only a centroid can answer "how many" and "where roughly", and cannot answer anything about shape, adjacency or overlap. Since a warehouse is where questions arrive that nobody anticipated, dropping geometry to save space is the single most regretted storage decision in this area.

**Store it once, in one projection.** Geographic coordinates are the right storage form because they are what the source uses and what every consumer can reproject from. Storing a second projected copy for convenience doubles the column and creates the possibility of the two disagreeing after an update.

**Keep the derived measures alongside.** Area and length computed correctly at load, as described in [Measuring Area Accurately on OSM Polygons](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/measuring-area-accurately-on-osm-polygons/), are far cheaper to store than to recompute per query, and they remove the most common opportunity for an analyst to compute them wrongly.

**Expect geometry to dominate the bytes.** On a feature table, geometry is routinely most of the storage and most of the scan cost, which is why a query that does not need it should not read it. Columnar formats make that free; row-oriented ones do not, and that difference alone often decides the storage engine.

The practical consequence is that a warehouse table over OSM should carry full geometry, a small number of correctly computed measures, and a column layout that lets the common non-spatial queries avoid reading the geometry at all.

## Incremental Loading and History

A full reload of a continental extract is hours of work to change a fraction of a percent of rows, which is why the diff stream matters here as much as it does for tiles. The pattern is the one in [Incremental Updates for Derived Datasets](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/): read the change file, resolve the affected features, and merge them into the table.

History raises a separate question: does the warehouse hold the current state or the history of states? A **current-state table** is simpler and answers "what is there now". A **slowly changing dimension** keeps validity dates per row and answers "what was there in March", at the cost of a table several times larger and every query needing a date predicate.

The honest answer for most analytics is current state plus a snapshot: keep the live table current, and write a dated copy periodically. It answers the historical questions people actually ask — comparing quarters — without the cost of row-level history nobody queries.

## Validation and Error Handling

| Condition | Root cause | Detection | Remediation |
| --- | --- | --- | --- |
| New question needs a re-ingest | Tags dropped at load time | The data was never stored | Keep unpromoted tags in a semi-structured column |
| Table mostly null columns | Columns enumerated optimistically | Column null rates above ninety percent | Demote rarely used columns back into the map |
| Queries scan everything | Partitioned by load date | Partition pruning never applies | Partition by the dimension queries filter on |
| Row counts drift after edits | Keyed on a bare OSM identifier | Duplicates across element types | Key on the type and identifier pair, or a surrogate |
| Joins to areas are slow | Administrative hierarchy computed per query | Repeated point-in-polygon work | Materialise the hierarchy as a dimension |
| Historical comparison impossible | Only current state retained | No past rows exist | Write dated snapshots on a schedule |
| Load takes hours for a small change | Full reload on every run | Runtime independent of change size | Drive loading from the diff stream |

## Performance and Scale

Three things dominate.

**Scan volume**, governed by partitioning and by how wide the rows are. A semi-structured tag column keeps rows compact when most features carry few tags, which is the common case.

**Join cost**, governed by whether tags require a join and whether the administrative hierarchy is materialised. Both are avoidable.

**Load cost**, governed by whether the load is incremental. A full reload is simple and becomes untenable exactly when the dataset becomes valuable.

The measurement worth instrumenting is **bytes scanned per query**, because it is the number that both explains cost and responds to the partitioning decision. It is also, in most cloud engines, what the query is billed at, which makes it the rare technical metric a finance team already understands. A query pattern whose scan volume does not fall when a partition key is added is filtering on something the partitioning does not express.

One further practice is worth adopting early: record, for each promoted column, why it was promoted. A column list assembled over two years by several people accumulates entries nobody can justify, and the review that would remove them stalls on nobody being sure what depended on them. A one-line note per promotion — the query pattern that motivated it — turns that review into a reading.

## Guides in This Topic

- [Designing a Star Schema for OSM Features](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/designing-a-star-schema-for-osm-features/) — the fact table, the dimensions and the tag model in one worked schema.
- [Incremental OSM Loads into DuckDB](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/incremental-osm-loads-into-duckdb/) — merging a change file into an existing table rather than reloading.
- [Choosing Partition Keys for an OSM Data Lake](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/choosing-partition-keys-for-an-osm-data-lake/) — deriving partitioning from measured query patterns.

## Frequently Asked Questions

<details>
<summary>Should tags be columns or a semi-structured field?</summary>

Both, in a hybrid. Promote the handful of attributes that most features carry and that queries filter on — class, name, area, geometry — to real typed columns, and keep everything else in a map or JSON column. That gives fast typed access to the common cases without ever dropping a tag, which is what makes a new question answerable without re-ingesting. Starting with everything semi-structured and promoting as patterns emerge is the least regrettable order.
</details>

<details>
<summary>What should the warehouse key be?</summary>

Not a bare OSM identifier, since those are scoped by element type and collide across them. At minimum, the type and identifier together. Better, a surrogate key your pipeline owns, mapped to OSM objects through a versioned table — that insulates downstream models from the splits and merges that ordinary mapping produces, which otherwise show up as unexplainable changes in counts.
</details>

<details>
<summary>How should the table be partitioned?</summary>

By whatever analysts actually filter on, which for OSM is usually an administrative area. Partitioning by load date is common because it matches how data arrives, and it is almost always wrong because no query filters on it. Clustering within a partition by a spatial cell serves the arbitrary spatial filters that area partitioning alone cannot prune.
</details>

<details>
<summary>Do I need row-level history?</summary>

Rarely. Most historical questions are comparisons between periods — how many cafés this quarter against last — which dated snapshots answer at a fraction of the cost. Row-level validity dates make every query carry a date predicate and multiply the table size, and they are worth it only when somebody genuinely needs to reconstruct an arbitrary past moment rather than compare two known ones.
</details>

<details>
<summary>Is a full reload ever acceptable?</summary>

For a small region, yes, and it is simpler than anything else. It stops being acceptable exactly when the dataset becomes large enough to be valuable, because the reload time grows with the data while the change per day stays roughly constant. Building the incremental path early is cheap; retrofitting it to a pipeline whose consumers now depend on a nightly full refresh is not.
</details>

## Related

- [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) — the parent section producing the features this models.
- [Exporting OSM to GeoParquet & PostGIS](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/) — the sinks this schema is expressed in.
- [Incremental Updates for Derived Datasets](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/) — the change stream that drives incremental loads.
- [Building Stable Surrogate Keys for OSM Features](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/building-stable-surrogate-keys-for-osm-features/) — the key this schema should use.
- [Spatial Index Selection: R-tree vs H3 vs Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/) — the cell schemes partitioning can use.
- [Mapping OSM Tags to a Fixed Schema with YAML](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/mapping-osm-tags-to-a-fixed-schema-with-yaml/) — producing the promoted columns.

Up one level: [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Modelling OSM for Analytics Warehouses",
  "description": "Turning OSM's tag soup into a warehouse schema: what becomes a dimension, how to model tags that will not fit columns, partitioning choices, and keeping history without a full reload.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["warehouse modelling", "semi-structured tags", "partitioning"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Parsing & Tag Normalization Workflows", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/" },
    { "@type": "ListItem", "position": 3, "name": "Modelling OSM for Analytics Warehouses", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Model OpenStreetMap data for an analytics warehouse",
  "description": "Promote only frequently queried attributes to columns, keep the open tag set semi-structured, materialise the administrative hierarchy as a dimension, partition by what queries filter on, and load incrementally.",
  "step": [
    { "@type": "HowToStep", "name": "Choose a stable key", "text": "Key on element type and identifier together, or on a surrogate key mapped through a versioned table." },
    { "@type": "HowToStep", "name": "Promote selectively", "text": "Give real typed columns only to attributes most features carry and queries filter on." },
    { "@type": "HowToStep", "name": "Keep the remainder open", "text": "Store every unpromoted tag in a map or JSON column so no question requires a re-ingest." },
    { "@type": "HowToStep", "name": "Materialise the hierarchy", "text": "Precompute administrative containment as a dimension rather than joining polygons per query." },
    { "@type": "HowToStep", "name": "Partition by the query filter", "text": "Partition on the dimension analysts actually filter on, and cluster within it by a spatial cell." },
    { "@type": "HowToStep", "name": "Load from the diff stream", "text": "Merge changes rather than reloading, so runtime tracks the size of the change instead of the dataset." },
    { "@type": "HowToStep", "name": "Snapshot rather than version rows", "text": "Write dated copies periodically instead of carrying row-level validity dates nobody queries." }
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
      "name": "Should OSM tags be columns or a semi-structured field?",
      "acceptedAnswer": { "@type": "Answer", "text": "Both, in a hybrid. Promote the handful of attributes most features carry and queries filter on to real typed columns, and keep everything else in a map or JSON column. That gives fast typed access without ever dropping a tag, which is what makes a new question answerable without re-ingesting." }
    },
    {
      "@type": "Question",
      "name": "What should an OSM warehouse key be?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not a bare OSM identifier, since those are scoped by element type and collide across them. At minimum, the type and identifier together. Better, a surrogate key your pipeline owns, mapped through a versioned table, which insulates downstream models from the splits and merges ordinary mapping produces." }
    },
    {
      "@type": "Question",
      "name": "How should an OSM warehouse table be partitioned?",
      "acceptedAnswer": { "@type": "Answer", "text": "By whatever analysts actually filter on, which for OSM is usually an administrative area. Partitioning by load date is common because it matches how data arrives, and is almost always wrong because no query filters on it. Clustering within a partition by a spatial cell serves arbitrary spatial filters." }
    },
    {
      "@type": "Question",
      "name": "Do I need row-level history in an OSM warehouse?",
      "acceptedAnswer": { "@type": "Answer", "text": "Rarely. Most historical questions are comparisons between periods, which dated snapshots answer at a fraction of the cost. Row-level validity dates make every query carry a date predicate and multiply the table size, and are worth it only when somebody needs to reconstruct an arbitrary past moment." }
    },
    {
      "@type": "Question",
      "name": "Is a full reload of an OSM warehouse ever acceptable?",
      "acceptedAnswer": { "@type": "Answer", "text": "For a small region, yes, and it is simpler than anything else. It stops being acceptable exactly when the dataset becomes large enough to be valuable, because reload time grows with the data while the daily change stays roughly constant. Building the incremental path early is cheap; retrofitting it is not." }
    }
  ]
}
</script>
