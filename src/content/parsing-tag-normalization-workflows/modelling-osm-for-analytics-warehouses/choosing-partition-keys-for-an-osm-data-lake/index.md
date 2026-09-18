---
title: "Choosing Partition Keys for an OSM Data Lake"
description: "Derive partitioning from measured query predicates rather than from how data arrives, balance partition sizes against OSM's extreme skew, and cluster within partitions for spatial filters."
pageTitle: "Partitioning an OSM Data Lake by What Queries Filter On"
pageDescription: "Measure which predicates queries actually use, partition on those rather than on load date, handle the skew of country-sized partitions, and cluster by a spatial cell within each one."
slug: choosing-partition-keys-for-an-osm-data-lake
type: article
breadcrumb: "Partition Keys"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Choosing Partition Keys for an OSM Data Lake

Partitioning is the single largest lever on query cost in a lake, and it is routinely chosen by how the data arrives rather than by how it is read. The two almost never coincide.

## Prerequisites

- [ ] A lake format with partition pruning — Parquet with Hive-style directories, or a table format.
- [ ] A schema, per [Designing a Star Schema for OSM Features](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/designing-a-star-schema-for-osm-features/).
- [ ] A query log, or a week of patience collecting one.
- [ ] The cell schemes from [Spatial Index Selection: R-tree vs H3 vs Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/).
- [ ] A willingness to measure bytes scanned rather than wall-clock time.

## Conceptual minimum

Partition pruning works only when a query's predicate matches the partition key. Everything else follows from that one fact.

**Load date partitions nothing useful.** No analyst filters on when the data was ingested, so every query scans every partition. It is chosen because it matches how files arrive, which is a property of the writer rather than of any reader.

**Administrative area matches the common predicate.** Most OSM analytics is scoped to a country or region, so an area partition prunes hard. Its weakness is skew: some countries are two orders of magnitude larger than others, producing partitions that are both enormous and tiny in the same table.

**A spatial cell partitions evenly** and serves arbitrary spatial filters, at the cost that every query must translate its region into cells. It works best as a *clustering* key inside an area partition rather than as the partition key itself.

**Feature class partitions very unevenly.** Buildings and roads dominate any extract, so a class partition produces two enormous partitions and a long tail of small ones.

The measurement that decides all of this is **bytes scanned per query**, broken down by predicate. Wall-clock time confounds the partitioning with cluster size and caching; bytes scanned does not.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="cpk1-t cpk1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cpk1-t">Four partition keys against the properties that decide between them</title>
  <desc id="cpk1-d">A grid of four candidate partition keys against how well each prunes, how evenly it divides the data, and what it costs a query. Load date prunes for nothing, divides evenly, and forces every query to scan everything. Administrative area prunes for most queries, divides very unevenly because countries differ enormously in size, and costs nothing extra. A spatial cell prunes for spatial filters, divides evenly, and requires each query to translate its region into cells. Feature class prunes for class filters, divides extremely unevenly, and costs nothing extra.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four keys, and only one matches the common predicate</text>
  <rect x="196" y="48" width="219" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="306" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Prunes for</text>
  <rect x="415" y="48" width="219" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="525" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Evenness</text>
  <rect x="635" y="48" width="219" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="744" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Query cost</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Load date</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">nothing</text>
  <text x="525" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">even</text>
  <text x="744" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">scans all</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Admin area</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">most queries</text>
  <text x="525" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">very uneven</text>
  <text x="744" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">none</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Spatial cell</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">spatial filters</text>
  <text x="525" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">even</text>
  <text x="744" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">translate region</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Feature class</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">class filters</text>
  <text x="525" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">extremely uneven</text>
  <text x="744" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">none</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The first row is the most commonly chosen and the only one that prunes for no query anybody writes.</text>
</svg>
<figcaption>Area partitioning plus cell clustering combines the second row's pruning with the third row's evenness.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import re
from collections import Counter
from dataclasses import dataclass

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.lake.partition")

# Predicates worth counting, as they appear in a query log.
PREDICATE_PATTERNS = {
    "area": re.compile(r"\b(country_code|area_key|admin_\w+)\s*(=|IN)", re.I),
    "class": re.compile(r"\b(class|subclass|feature_class)\s*(=|IN)", re.I),
    "spatial": re.compile(r"\bST_(Intersects|Within|Contains|DWithin)\b", re.I),
    "name": re.compile(r"\bname\s+(=|LIKE|ILIKE)", re.I),
    "date": re.compile(r"\b(load_date|ingested_at|snapshot_date)\s*(=|>|<)", re.I),
}
SKEW_LIMIT = 20.0        # largest / median partition; above this, subdivide


@dataclass(frozen=True)
class PredicateProfile:
    counts: Counter
    total: int

    def share(self, name: str) -> float:
        return self.counts[name] / self.total if self.total else 0.0

    def recommend(self) -> str:
        area = self.share("area")
        spatial = self.share("spatial")
        if area >= 0.5:
            return ("partition by area; cluster by a spatial cell within it"
                    if spatial >= 0.2 else "partition by area")
        if spatial >= 0.5:
            return "partition by a spatial cell"
        if self.share("class") >= 0.5:
            return "partition by class, and expect heavy skew"
        return "no predicate dominates; partition by area as the safe default"


def profile_queries(queries: list[str]) -> PredicateProfile:
    counts: Counter = Counter()
    for query in queries:
        for name, pattern in PREDICATE_PATTERNS.items():
            if pattern.search(query):
                counts[name] += 1
    profile = PredicateProfile(counts, len(queries))
    for name in PREDICATE_PATTERNS:
        logger.info("%-8s appears in %5.1f%% of queries",
                    name, profile.share(name) * 100)
    logger.info("recommendation: %s", profile.recommend())
    return profile


def check_skew(partition_rows: dict[str, int]) -> dict[str, float]:
    """OSM partitions by area are extremely uneven; measure before committing."""
    if not partition_rows:
        return {}
    sizes = sorted(partition_rows.values())
    median = sizes[len(sizes) // 2] or 1
    largest = sizes[-1]
    skew = largest / median
    logger.info("%d partition(s): median %d row(s), largest %d, skew %.1fx",
                len(sizes), median, largest, skew)

    if skew > SKEW_LIMIT:
        offenders = [k for k, v in partition_rows.items()
                     if v > median * SKEW_LIMIT]
        logger.warning("subdivide these partition(s) by a spatial cell: %s",
                       sorted(offenders)[:5])
    return {"median": float(median), "largest": float(largest), "skew": skew}


def partition_path(country_code: str, cell: str | None) -> str:
    """Hive-style path. Cell subdivision only where the skew demands it."""
    base = f"country_code={country_code}"
    return f"{base}/cell={cell}" if cell else base


if __name__ == "__main__":
    sample = [
        "SELECT count(*) FROM fact_feature WHERE country_code = 'PL'",
        "SELECT * FROM fact_feature WHERE country_code IN ('DE','FR') "
        "AND class = 'poi'",
        "SELECT * FROM fact_feature WHERE ST_Intersects(geom, ?)",
    ]
    profile_queries(sample)
    check_skew({"PL": 42_000_000, "LU": 900_000, "DE": 310_000_000})
```

## Step-by-step walkthrough

1. **Profile the queries, do not guess.** A week of logs settles an argument that otherwise runs on intuition, and the answer is frequently not what the team expected.
2. **Count predicates, not queries.** One query can filter on several things, and each filter is a candidate partition key independently.
3. **Recommend a combination, not a single key.** Area partitioning plus spatial clustering serves both the common scoped query and the occasional arbitrary one; either alone serves half.
4. **Measure skew before committing.** OSM's area partitions differ by orders of magnitude, and a partition scheme whose largest member is a hundred times the median has not solved the scan problem for the queries that matter most.
5. **Subdivide only the offenders.** Adding a second partition level uniformly multiplies the file count everywhere; adding it only to the oversized partitions keeps the small ones simple.
6. **Use a stable path convention.** Hive-style key-value directories are readable by every engine and self-documenting, which matters when somebody inspects the lake directly.
7. **Re-profile periodically.** Query patterns change as consumers arrive, and a partitioning chosen two years ago for a workload nobody runs any more is a common finding.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 248" role="img" aria-labelledby="cpk2-t cpk2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cpk2-t">Bytes scanned for one typical query under four partitioning schemes</title>
  <desc id="cpk2-d">Four schemes measured on the same country-scoped query against a continental table. Partitioning by load date scans the whole table, because no predicate matches the key. Partitioning by feature class scans a large fraction, since the class filter prunes only two enormous partitions. Partitioning by administrative area scans a small fraction. Partitioning by area with spatial clustering inside it scans less still, because the spatial predicate prunes within the chosen partition.</desc>
  <rect x="0" y="0" width="880" height="248" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Bytes scanned for one country-scoped query</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">By load date</text>
  <rect x="266" y="60" width="468" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">the whole table</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">By feature class</text>
  <rect x="266" y="100" width="215" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about half</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">By admin area</text>
  <rect x="266" y="140" width="19" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">a few percent</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Area plus cell clustering</text>
  <rect x="266" y="180" width="7" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">under two percent</text>
  <text x="868" y="232" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Wall-clock time confounds partitioning with cluster size and caching; bytes scanned isolates the effect and transfers between environments.</text>
</svg>
<figcaption>The gap between the first and third bars is the whole argument, and it is decided before a single query is written.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="cpk3-t cpk3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cpk3-t">From a query log to a physical layout</title>
  <desc id="cpk3-d">Four steps. The profile step counts which predicates appear across a week of real queries, which settles the choice on evidence rather than intuition. The choose step picks the partition key matching the dominant predicate, with a clustering key for the second most common. The measure step compares the largest partition against the median to expose the skew that administrative partitioning always produces on OSM. The subdivide step adds a second level only to the partitions exceeding the skew limit, leaving the rest untouched.</desc>
  <defs><marker id="cpk3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Profile, choose, measure, subdivide</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">profile</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">a week of real queries</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">evidence, not intuition</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cpk3-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">choose</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">dominant predicate</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">plus a clustering key</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cpk3-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">measure</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">largest over median</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">skew is guaranteed</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cpk3-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">subdivide</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">only the offenders</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">small ones stay simple</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The fourth step is where selective subdivision beats a uniform second level, which multiplies file counts across the whole lake.</text>
</svg>
<figcaption>Every step produces a number, which is what makes the resulting layout defensible to whoever inherits it.</figcaption>
</figure>

## Verification

- **Pruning actually happens.** Check the query plan or the engine's scanned-bytes metric; a partition filter that does not reduce it is not pruning.
- **The skew ratio is bounded.** Largest over median should be within roughly an order of magnitude after subdivision.
- **File counts are sane.** Thousands of tiny files per partition is its own problem; target files in the hundreds of megabytes.
- **The profile matches reality.** Re-run the predicate profiling on a fresh log and confirm the recommendation is unchanged.
- **Small partitions stay simple.** Confirm subdivision was applied only where the skew demanded it.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Every query scans everything | Partitioned by load date | Partition on the predicate queries actually use |
| One partition dominates runtime | Extreme area skew | Subdivide the oversized partitions by a spatial cell |
| Tiny files everywhere | Subdivision applied uniformly | Subdivide only partitions above the skew limit |
| Spatial queries still scan widely | No clustering within partitions | Sort or cluster by a spatial cell inside each partition |
| Pruning silently absent | Predicate does not match the key type | Compare the filter's type against the partition column |
| Layout no longer fits the workload | Chosen once and never revisited | Re-profile the query log periodically |
| Time measurements inconclusive | Wall clock used as the metric | Measure bytes scanned instead |

## Specification reference

> Partition pruning allows a query engine to skip files whose partition values cannot satisfy the query's predicates, so it applies only when a predicate references the partition column directly. Hive-style partitioning encodes key-value pairs in directory names, which every common engine recognises. See [Partitioning a GeoParquet OSM Lake by H3 Cell](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/partitioning-a-geoparquet-osm-lake-by-h3-cell/) for the cell-based layout referenced here.

## Frequently Asked Questions

<details>
<summary>Why is partitioning by load date so common and so wrong?</summary>

Because it matches how data arrives: a daily job writes a day's files, and a date directory is the obvious place to put them. The problem is that no analyst filters on ingestion date, so the partition key matches no predicate and every query scans the whole table. It is a writer's convenience that costs every reader, which is exactly the trade partitioning exists to avoid.
</details>

<details>
<summary>How do I handle the skew between large and small countries?</summary>

Subdivide only the oversized partitions. Adding a second level uniformly multiplies the file count across the whole lake, which creates a small-files problem in every small partition to solve a large-files problem in a few. Measuring the ratio of the largest partition to the median, and subdividing anything above roughly an order of magnitude, keeps both ends healthy.
</details>

<details>
<summary>Should I partition or cluster by a spatial cell?</summary>

Cluster, in most cases. Partitioning by cell divides evenly but requires every query to translate its region into cells, and it loses the pruning that an area predicate would have given. Sorting or clustering by cell inside an area partition keeps the area pruning and adds intra-partition skipping for spatial predicates, which is the combination that serves both query shapes.
</details>

<details>
<summary>Why measure bytes scanned rather than query time?</summary>

Because wall-clock time mixes the effect of partitioning with cluster size, caching, concurrency and the weather. Bytes scanned isolates what the layout actually changed, transfers between environments, and in most cloud engines is also what the query costs. A partitioning change that halves bytes scanned has definitely helped; one that halves wall-clock time on a quiet cluster may have measured nothing.
</details>

## Related

- [Modelling OSM for Analytics Warehouses](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/) — the parent topic and the schema this lays out physically.
- [Partitioning a GeoParquet OSM Lake by H3 Cell](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/partitioning-a-geoparquet-osm-lake-by-h3-cell/) — the cell layout in detail.
- [Designing a Star Schema for OSM Features](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/designing-a-star-schema-for-osm-features/) — the logical model this partitions.
- [Spatial Index Selection: R-tree vs H3 vs Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/) — choosing the cell scheme.
- [Incremental OSM Loads into DuckDB](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/incremental-osm-loads-into-duckdb/) — how partitioning interacts with merge-based loading.

Up one level: [Modelling OSM for Analytics Warehouses](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Choosing Partition Keys for an OSM Data Lake",
  "description": "Derive partitioning from measured query predicates rather than from how data arrives, balance partition sizes against OSM's extreme skew, and cluster within partitions for spatial filters.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["partition pruning", "query predicate profiling", "partition skew"]
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
    { "@type": "ListItem", "position": 4, "name": "Choosing Partition Keys for an OSM Data Lake", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/choosing-partition-keys-for-an-osm-data-lake/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Choose partition keys for an OSM data lake",
  "description": "Profile the predicates real queries use, partition on the dominant one, measure partition skew, subdivide only the oversized partitions by a spatial cell, and verify with bytes scanned.",
  "step": [
    { "@type": "HowToStep", "name": "Profile the query log", "text": "Count which predicates appear across a week of real queries rather than assuming which ones matter." },
    { "@type": "HowToStep", "name": "Partition on the dominant predicate", "text": "Choose the key that the majority of queries actually filter on, which for OSM is usually an administrative area." },
    { "@type": "HowToStep", "name": "Measure the skew", "text": "Compare the largest partition against the median and treat a ratio above roughly an order of magnitude as a problem." },
    { "@type": "HowToStep", "name": "Subdivide selectively", "text": "Add a spatial cell level only to the oversized partitions, so small ones do not acquire a small-files problem." },
    { "@type": "HowToStep", "name": "Cluster within partitions", "text": "Sort by a spatial cell inside each partition so arbitrary spatial predicates can skip files." },
    { "@type": "HowToStep", "name": "Verify with bytes scanned", "text": "Confirm pruning by measuring scanned bytes rather than wall-clock time, which confounds other effects." }
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
      "name": "Why is partitioning by load date so common and so wrong?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because it matches how data arrives: a daily job writes a day's files. The problem is that no analyst filters on ingestion date, so the partition key matches no predicate and every query scans the whole table. It is a writer's convenience that costs every reader." }
    },
    {
      "@type": "Question",
      "name": "How do I handle partition skew between large and small countries?",
      "acceptedAnswer": { "@type": "Answer", "text": "Subdivide only the oversized partitions. Adding a second level uniformly multiplies the file count across the whole lake, creating a small-files problem everywhere to solve a large-files problem in a few places. Subdividing anything above roughly an order of magnitude above the median keeps both ends healthy." }
    },
    {
      "@type": "Question",
      "name": "Should I partition or cluster an OSM lake by a spatial cell?",
      "acceptedAnswer": { "@type": "Answer", "text": "Cluster, in most cases. Partitioning by cell divides evenly but requires every query to translate its region into cells and loses the pruning an area predicate would have given. Clustering by cell inside an area partition keeps the area pruning and adds intra-partition skipping for spatial predicates." }
    },
    {
      "@type": "Question",
      "name": "Why measure bytes scanned rather than query time?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because wall-clock time mixes partitioning with cluster size, caching and concurrency. Bytes scanned isolates what the layout changed, transfers between environments, and in most cloud engines is also what the query costs. A change that halves bytes scanned has definitely helped." }
    }
  ]
}
</script>
