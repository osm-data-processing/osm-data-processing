---
title: "Designing a Star Schema for OSM Features"
description: "A worked warehouse schema for OSM: a feature fact table with a surrogate key, a hybrid tag model, materialised class and area dimensions, and the joins each query shape uses."
pageTitle: "A Star Schema for OpenStreetMap Feature Analytics"
pageDescription: "Lay out an OSM warehouse as a feature fact table plus class, area and time dimensions, with promoted columns for common attributes and a map column for the open-ended remainder."
slug: designing-a-star-schema-for-osm-features
type: article
breadcrumb: "Star Schema"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Designing a Star Schema for OSM Features

A star schema over OSM is unusual in one respect: the fact table's grain is a thing rather than an event, and the measures are mostly counts and geometric quantities rather than sums of transactions. Everything else about the pattern transfers.

## Prerequisites

- [ ] A warehouse or query engine with a map or JSON column type and spatial support.
- [ ] Normalized features, per [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/).
- [ ] The modelling decisions from [Modelling OSM for Analytics Warehouses](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/).
- [ ] Surrogate keys, per [Building Stable Surrogate Keys for OSM Features](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/building-stable-surrogate-keys-for-osm-features/).
- [ ] A short list of the questions analysts actually ask, since the dimensions follow from them.

## Conceptual minimum

The schema has one fact table and three dimensions.

**The feature fact** has one row per feature, keyed on a surrogate. Its measures are geometric — area, length, a count of one — and its degenerate attributes are the promoted tags. Everything unpromoted lives in a map column on the same row.

**The class dimension** resolves OSM's primary tags into a hierarchy analysts can group by: a three-level class, subclass and detail, derived once from the tag set rather than parsed in every query.

**The area dimension** holds the administrative hierarchy, and the fact table carries a foreign key to the smallest containing area. That single precomputation removes a point-in-polygon join from every geographic query, which is usually the difference between a query that runs and one that does not.

**The time dimension** is the extract date, not an event date. It is what lets two snapshots be compared, and it is the only dimension whose grain is a decision rather than a fact.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 290" role="img" aria-labelledby="dss1-t dss1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dss1-t">The schema, with the joins each query shape uses</title>
  <desc id="dss1-d">A feature fact table sits at the centre, holding one row per feature with a surrogate key, geometry, promoted attribute columns and a map column for the remaining tags. Three dimensions hang off it. The class dimension resolves primary tags into a grouping hierarchy. The area dimension holds administrative containment, joined through a foreign key computed once at load time. The time dimension identifies which extract snapshot the row belongs to. Queries join the fact to whichever dimensions they group by, and reach into the map column only for unpromoted attributes.</desc>
  <defs><marker id="dss1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="290" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">One fact, three dimensions, one map column</text>
  <rect x="26" y="50" width="240" height="56" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="146" y="74" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">class dim</text>
  <text x="146" y="92" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">grouping hierarchy</text>
  <rect x="26" y="122" width="240" height="56" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="146" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">area dim</text>
  <text x="146" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">admin containment</text>
  <rect x="26" y="194" width="240" height="56" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="146" y="218" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">time dim</text>
  <text x="146" y="236" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">snapshot date</text>
  <rect x="320" y="122" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">feature fact</text>
  <text x="440" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">one row per feature</text>
  <rect x="614" y="122" width="240" height="56" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="734" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">map column</text>
  <text x="734" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">unpromoted tags</text>
  <line x1="266" y1="78" x2="293" y2="78" stroke="currentColor" stroke-width="1.4"/>
  <line x1="266" y1="150" x2="293" y2="150" stroke="currentColor" stroke-width="1.4"/>
  <line x1="266" y1="222" x2="293" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="293" y1="78" x2="293" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="293" y1="150" x2="317" y2="150" stroke="currentColor" stroke-width="1.4" marker-end="url(#dss1-a)"/>
  <line x1="560" y1="150" x2="587" y2="150" stroke="currentColor" stroke-width="1.4"/>
  <line x1="587" y1="150" x2="587" y2="150" stroke="currentColor" stroke-width="1.4"/>
  <line x1="587" y1="150" x2="611" y2="150" stroke="currentColor" stroke-width="1.4" marker-end="url(#dss1-a)"/>
  <text x="868" y="274" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The area foreign key is computed once at load; recomputing containment per query is the single largest avoidable cost here.</text>
</svg>
<figcaption>The map column is on the fact row rather than in a fourth table, which is what keeps wide scans affordable.</figcaption>
</figure>

## Runnable solution

```sql
-- A star schema for OSM features. Written for DuckDB; the shape transfers.

CREATE TABLE dim_class (
    class_key      INTEGER PRIMARY KEY,
    class          VARCHAR NOT NULL,      -- 'transportation'
    subclass       VARCHAR NOT NULL,      -- 'road'
    detail         VARCHAR NOT NULL,      -- 'residential'
    primary_key_tag VARCHAR NOT NULL,     -- 'highway'
    primary_value  VARCHAR NOT NULL       -- 'residential'
);

CREATE TABLE dim_area (
    area_key       INTEGER PRIMARY KEY,
    osm_relation_id BIGINT,
    name           VARCHAR NOT NULL,
    admin_level    SMALLINT NOT NULL,
    parent_area_key INTEGER,              -- the containing area, or NULL
    country_code   VARCHAR(2) NOT NULL
);

CREATE TABLE dim_snapshot (
    snapshot_key   INTEGER PRIMARY KEY,
    extract_date   DATE NOT NULL,
    source_digest  VARCHAR NOT NULL,      -- ties back to provenance
    sequence_number BIGINT
);

CREATE TABLE fact_feature (
    feature_key    VARCHAR PRIMARY KEY,   -- the surrogate, never an OSM id
    snapshot_key   INTEGER NOT NULL REFERENCES dim_snapshot,
    class_key      INTEGER NOT NULL REFERENCES dim_class,
    area_key       INTEGER REFERENCES dim_area,   -- smallest containing area
    osm_type       VARCHAR NOT NULL,      -- kept for traceability, not as a key
    osm_id         BIGINT NOT NULL,
    osm_version    INTEGER NOT NULL,
    -- Promoted attributes: present on most features, filtered on constantly.
    name           VARCHAR,
    addr_street    VARCHAR,
    addr_housenumber VARCHAR,
    -- Geometric measures.
    geom           GEOMETRY NOT NULL,
    area_m2        DOUBLE,                -- NULL for lines and points
    length_m       DOUBLE,                -- NULL for points and areas
    -- Everything else, without exception. No tag is ever dropped.
    tags           MAP(VARCHAR, VARCHAR) NOT NULL
);

-- Partition and cluster for the filters analysts actually apply.
CREATE INDEX idx_feature_area  ON fact_feature (area_key, class_key);
CREATE INDEX idx_feature_geom  ON fact_feature USING RTREE (geom);
```

```python
from __future__ import annotations

import logging

import duckdb

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.warehouse.star")

# Primary tag -> (class, subclass). Detail is the tag value itself.
CLASS_MAP: dict[str, tuple[str, str]] = {
    "highway": ("transportation", "road"),
    "railway": ("transportation", "rail"),
    "building": ("built", "building"),
    "landuse": ("land", "landuse"),
    "natural": ("land", "natural"),
    "amenity": ("poi", "amenity"),
    "shop": ("poi", "shop"),
    "waterway": ("water", "waterway"),
}
# Checked in order: the first matching key decides the class.
PRIORITY = ("highway", "railway", "waterway", "building", "amenity", "shop",
            "landuse", "natural")


def classify(tags: dict[str, str]) -> tuple[str, str, str, str, str] | None:
    """Resolve a feature's primary tag into the class hierarchy."""
    for key in PRIORITY:
        value = tags.get(key)
        if not value:
            continue
        klass, subclass = CLASS_MAP[key]
        return (klass, subclass, value, key, value)
    return None      # no primary tag: the feature is not a thing we model


def assign_area(conn: duckdb.DuckDBPyConnection) -> None:
    """Precompute the smallest containing area, once per load.

    Doing this here rather than per query is the single largest performance
    decision in the schema: a point-in-polygon join against a country's
    boundaries costs orders of magnitude more than a foreign key lookup.
    """
    conn.execute("""
        UPDATE fact_feature f
        SET area_key = (
            SELECT a.area_key
            FROM dim_area a
            JOIN area_geometry g ON g.area_key = a.area_key
            WHERE ST_Contains(g.geom, ST_Centroid(f.geom))
            ORDER BY a.admin_level DESC        -- smallest containing area
            LIMIT 1
        )
        WHERE f.area_key IS NULL
    """)
    missing, = conn.execute(
        "SELECT COUNT(*) FROM fact_feature WHERE area_key IS NULL").fetchone()
    if missing:
        # Features outside every mapped boundary: coastal, offshore, or a gap.
        logger.warning("%d feature(s) fall outside every area", missing)


def null_rate_report(conn: duckdb.DuckDBPyConnection) -> None:
    """Which promoted columns are earning their place?"""
    for column in ("name", "addr_street", "addr_housenumber"):
        rate, = conn.execute(
            f"SELECT 1.0 - COUNT({column}) * 1.0 / COUNT(*) FROM fact_feature"
        ).fetchone()
        verdict = "consider demoting" if rate > 0.8 else "keep"
        logger.info("%-18s %5.1f%% null — %s", column, rate * 100, verdict)


if __name__ == "__main__":
    logger.info("classify, load, assign areas, then review the null rates")
```

## Step-by-step walkthrough

1. **Key the fact on a surrogate.** The OSM type, identifier and version are kept as attributes for traceability, not as the key, so a split upstream does not change a row's identity.
2. **Resolve the class once.** Parsing a primary tag in every query is repeated work and, worse, repeated logic that drifts between queries. One dimension, one definition.
3. **Order the class priority explicitly.** A feature tagged both `highway` and `building` is a bridge or a covered way; which class wins is a modelling decision and it belongs in one visible list.
4. **Return nothing for unclassifiable features.** A feature with no primary tag is not a thing the schema models, and forcing it into a class invents a category.
5. **Assign the area at load time.** The containment join is expensive and the answer changes rarely; computing it once per load and storing a foreign key removes it from every subsequent query.
6. **Store the smallest containing area.** With a parent chain on the dimension, a query can roll up to any level, so the finest assignment is the most useful one.
7. **Keep every tag in the map column.** Promotion is an optimisation, never a filter — nothing is dropped, so no future question requires re-ingesting.
8. **Report null rates.** A promoted column that is ninety percent null is costing storage and confusion for an access pattern the map column would serve fine.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="dss2-t dss2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dss2-t">What each query shape touches in this schema</title>
  <desc id="dss2-d">A grid of four common query shapes against which parts of the schema each one reads. Counting features by class in an area reads the fact table, the class dimension and the area foreign key, and touches no geometry at all. Summing road length by area reads the same plus the length measure. Finding features with an unpromoted tag reads the fact table and the map column, with no dimension join. An arbitrary spatial filter reads the fact table's geometry through the spatial index and cannot use the area foreign key for pruning.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four query shapes, four different paths</text>
  <rect x="236" y="48" width="309" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="390" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Reads</text>
  <rect x="545" y="48" width="309" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="700" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Does not touch</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Count by class in an area</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="390" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">fact, class, area key</text>
  <text x="700" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">geometry</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Road length by area</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="390" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">plus the length measure</text>
  <text x="700" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">geometry</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Filter on a rare tag</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="390" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">fact and map column</text>
  <text x="700" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">dimensions</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Arbitrary spatial filter</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="390" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">geometry, spatial index</text>
  <text x="700" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">area key cannot prune</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The first two shapes are the common ones and neither reads geometry, which is why the area foreign key pays for itself so quickly.</text>
</svg>
<figcaption>The fourth shape is the one that argues for clustering by a spatial cell within each area partition.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="dss3-t dss3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dss3-t">What lives on the fact row, in four groups</title>
  <desc id="dss3-d">Four groups of columns on one fact row. The keys group holds the surrogate key plus foreign keys to the snapshot, class and area dimensions. The traceability group holds the OSM element type, identifier and version, which are attributes rather than keys so that an upstream split does not change row identity. The measures group holds geometry together with area and length, each null for the geometry types they do not apply to. The open group holds the map column containing every tag that was not promoted, which is what makes future questions answerable.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four groups, and only the last one is open-ended</text>
  <rect x="26" y="50" width="828" height="52" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="42" y="72" font-size="12.5" font-weight="700" fill="currentColor">Keys</text>
  <text x="42" y="90" font-size="10.5" fill="currentColor" opacity="0.88">Surrogate plus dimension foreign keys</text>
  <text x="838" y="82" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">never an OSM id</text>
  <rect x="26" y="112" width="828" height="52" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="42" y="134" font-size="12.5" font-weight="700" fill="currentColor">Traceability</text>
  <text x="42" y="152" font-size="10.5" fill="currentColor" opacity="0.88">OSM type, id and version</text>
  <text x="838" y="144" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">attributes, not keys</text>
  <rect x="26" y="174" width="828" height="52" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="42" y="196" font-size="12.5" font-weight="700" fill="currentColor">Measures</text>
  <text x="42" y="214" font-size="10.5" fill="currentColor" opacity="0.88">Geometry, area, length</text>
  <text x="838" y="206" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">nulls by geometry type</text>
  <rect x="26" y="236" width="828" height="52" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="42" y="258" font-size="12.5" font-weight="700" fill="currentColor">Open tags</text>
  <text x="42" y="276" font-size="10.5" fill="currentColor" opacity="0.88">Everything unpromoted</text>
  <text x="838" y="268" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">nothing is ever dropped</text>
  <text x="868" y="308" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The second group is what lets a row be traced back to the map without letting the map's identifier churn reach the schema.</text>
</svg>
<figcaption>Keeping traceability and identity separate is the one structural decision here that is expensive to change later.</figcaption>
</figure>

## Verification

- **Class assignment is total and unambiguous.** Every fact row must have a class key, and re-running the classifier must produce the same result.
- **Area assignment covers nearly everything.** A high count of null area keys means the boundary set is incomplete rather than the data being offshore.
- **No tag was dropped.** Compare the distinct key count in the map column against the distinct keys in the source extract.
- **Promoted columns earn their place.** Review the null rates; anything above eighty percent is a candidate for demotion.
- **Counts match the source.** Total fact rows should equal the count of classifiable features in the extract.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Row identity changes upstream | Fact keyed on an OSM identifier | Key on a surrogate; keep the OSM reference as an attribute |
| Class logic differs between queries | Primary tag parsed per query | Resolve the class once into a dimension |
| Geographic queries are slow | Containment computed per query | Assign an area foreign key at load time |
| Bridges classified inconsistently | Class priority implicit | Declare the priority order in one visible list |
| A new question needs a re-ingest | Unpromoted tags dropped | Keep every tag in the map column |
| Mostly null columns | Promotion decided without evidence | Report null rates and demote the worst |
| Rolling up by region is awkward | Only the finest area stored, with no parent chain | Give the area dimension a parent key |

## Specification reference

> A star schema places a fact table at the centre, joined to dimension tables by foreign keys, with the fact's grain defined by what one row represents. For feature data the grain is one row per feature rather than per event, and the measures are geometric quantities and counts. See [Modelling OSM for Analytics Warehouses](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/) for the modelling decisions this schema implements.

## Frequently Asked Questions

<details>
<summary>Why precompute the area foreign key?</summary>

Because a point-in-polygon join against a country's administrative boundaries is expensive, it is the same answer every time, and it appears in the majority of OSM analytics queries. Computing it once at load and storing a foreign key converts that join into a lookup, which is usually the difference between a geographic query returning in seconds and in minutes. The containment changes only when boundaries change, which is rare.
</details>

<details>
<summary>Should the map column be a separate table instead?</summary>

Only if your engine handles map types badly. A key-value table makes every tag predicate a join, which is fine for a lookup of a few features and painful for a scan across millions. Keeping the map on the fact row means a wide scan reads one table, and modern engines can filter on map keys without materialising the whole structure. The separate table is the older pattern and it survives mostly by habit.
</details>

<details>
<summary>How is a feature with several primary tags classified?</summary>

By an explicitly ordered priority list, which turns an ambiguity into a documented decision. A way tagged as both a highway and a building is a covered passage or a bridge, and whether it belongs in transportation or built environment depends on what your analysts expect. Declaring the order in one list means the answer is consistent and reviewable, rather than depending on dictionary iteration order.
</details>

<details>
<summary>What should happen to features with no primary tag?</summary>

They are not loaded into the fact table, because the schema models things and an untagged geometry carrier is not one. The nodes that exist only to give a way its shape are the overwhelming majority of this category, and including them would multiply the fact table by an order of magnitude for rows nobody queries. Keep the count, so the exclusion is visible rather than silent.
</details>

## Related

- [Modelling OSM for Analytics Warehouses](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/) — the parent topic and the decisions behind this layout.
- [Incremental OSM Loads into DuckDB](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/incremental-osm-loads-into-duckdb/) — keeping this schema current from the diff stream.
- [Choosing Partition Keys for an OSM Data Lake](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/choosing-partition-keys-for-an-osm-data-lake/) — physical layout for the query shapes above.
- [Building Stable Surrogate Keys for OSM Features](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/building-stable-surrogate-keys-for-osm-features/) — the key the fact table uses.
- [Mapping OSM Tags to a Fixed Schema with YAML](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/mapping-osm-tags-to-a-fixed-schema-with-yaml/) — expressing the class map as configuration.

Up one level: [Modelling OSM for Analytics Warehouses](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Designing a Star Schema for OSM Features",
  "description": "A worked warehouse schema for OSM: a feature fact table with a surrogate key, a hybrid tag model, materialised class and area dimensions, and the joins each query shape uses.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["star schema", "feature fact table", "dimension design"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Parsing & Tag Normalization Workflows", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/" },
    { "@type": "ListItem", "position": 3, "name": "Modelling OSM for Analytics Warehouses", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/" },
    { "@type": "ListItem", "position": 4, "name": "Designing a Star Schema for OSM Features", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/designing-a-star-schema-for-osm-features/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Lay out a star schema for OSM feature analytics",
  "description": "Key the fact on a surrogate, resolve class once into a dimension with an explicit priority order, precompute the containing area as a foreign key, keep every unpromoted tag in a map column, and review null rates.",
  "step": [
    { "@type": "HowToStep", "name": "Key on a surrogate", "text": "Use an owned key for the fact table and keep the OSM type, identifier and version as traceability attributes." },
    { "@type": "HowToStep", "name": "Resolve class into a dimension", "text": "Derive a class hierarchy from the primary tag once at load rather than parsing tags in every query." },
    { "@type": "HowToStep", "name": "Declare the class priority", "text": "Order the primary tags explicitly so a feature carrying several is classified consistently." },
    { "@type": "HowToStep", "name": "Assign the area at load", "text": "Compute the smallest containing administrative area once and store it as a foreign key." },
    { "@type": "HowToStep", "name": "Keep every tag", "text": "Store unpromoted tags in a map column on the fact row so nothing is ever dropped." },
    { "@type": "HowToStep", "name": "Review null rates", "text": "Measure how often each promoted column is populated and demote the ones that are mostly empty." }
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
      "name": "Why precompute an area foreign key in an OSM warehouse?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because a point-in-polygon join against administrative boundaries is expensive, gives the same answer every time, and appears in most OSM analytics queries. Computing it once at load converts that join into a lookup, which is usually the difference between a geographic query returning in seconds and in minutes." }
    },
    {
      "@type": "Question",
      "name": "Should OSM tags live in a map column or a separate table?",
      "acceptedAnswer": { "@type": "Answer", "text": "A map column, unless your engine handles map types badly. A key-value table makes every tag predicate a join, which is painful for a scan across millions of rows. Keeping the map on the fact row means a wide scan reads one table, and modern engines filter on map keys without materialising the structure." }
    },
    {
      "@type": "Question",
      "name": "How is an OSM feature with several primary tags classified?",
      "acceptedAnswer": { "@type": "Answer", "text": "By an explicitly ordered priority list, which turns an ambiguity into a documented decision. A way tagged as both a highway and a building is a covered passage or bridge, and which class wins depends on what analysts expect. Declaring the order in one list makes the answer consistent and reviewable." }
    },
    {
      "@type": "Question",
      "name": "What should happen to OSM features with no primary tag?",
      "acceptedAnswer": { "@type": "Answer", "text": "They are not loaded into the fact table, because the schema models things and an untagged geometry carrier is not one. Those nodes are the overwhelming majority of the category, and including them would multiply the fact table for rows nobody queries. Keep the count so the exclusion is visible." }
    }
  ]
}
</script>
