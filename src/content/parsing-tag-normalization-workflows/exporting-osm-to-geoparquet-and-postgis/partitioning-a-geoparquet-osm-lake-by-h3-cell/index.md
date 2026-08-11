---
title: "Partitioning a GeoParquet OSM Lake by H3 Cell"
description: "Choose a partition granularity that prunes without shattering the dataset: H3 cell keys, Hive-style directories, buffering to a target file size, and a sort key finer than the partition."
pageTitle: "Partition a GeoParquet OSM Lake by H3 Cell"
pageDescription: "Lay out GeoParquet OSM data so a city query reads megabytes: picking the H3 partition resolution, Hive directories, target file sizes, and in-file sorting that prunes further."
slug: "partitioning-a-geoparquet-osm-lake-by-h3-cell"
type: "article"
breadcrumb: "Partitioning by H3 Cell"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Partitioning a GeoParquet OSM Lake by H3 Cell

Lay out a multi-gigabyte GeoParquet dataset so a query over one city reads a few megabytes instead of the whole thing — without shattering it into a million files nobody can list.

## Prerequisites

- [ ] A working GeoParquet writer, as in [Writing OSM Features to GeoParquet with PyArrow](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/writing-osm-features-to-geoparquet-with-pyarrow/)
- [ ] Python 3.10+ with `pyarrow` 14+ and `h3` 4.x
- [ ] A rough idea of the smallest area a consumer will query
- [ ] Object storage or a filesystem where a directory of a few hundred entries is cheap to list

## Conceptual minimum

Partitioning is directory-level filtering: the key becomes part of the path, and a reader that can evaluate a predicate against the key skips whole files without opening them. It is coarse, free at query time, and completely separate from the row-group statistics that filter *within* a file.

The only real decision is granularity.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="part-count-t part-count-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="part-count-t">Partition count and file size at five H3 resolutions</title>
  <desc id="part-count-d">A bar chart of partition counts for 14.2 million European buildings. Resolution 2 gives 12 partitions of about 1.2 gigabytes each and barely prunes. Resolution 3 gives 84 partitions of 175 megabytes. Resolution 4 gives 512 partitions of 29 megabytes. Resolution 5 gives 3100 partitions of 4.8 megabytes, where directory listing starts to hurt. Resolution 6 gives 19400 partitions of 0.8 megabytes and is unusable.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Partition count is the dial, and both ends of it are bad</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">14.2 M European buildings, partitioned at five H3 resolutions</text>
  <line x1="250" y1="68" x2="250" y2="270" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">r2 — 12 partitions</text>
  <rect x="250" y="74" width="6" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="266" y="89" font-size="11" fill="currentColor" opacity="0.9">12 files · 1.2 GB each · barely prunes</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">r3 — 84 partitions</text>
  <rect x="250" y="116" width="6" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="266" y="131" font-size="11" fill="currentColor" opacity="0.9">84 files · 175 MB each · good</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">r4 — 512 partitions</text>
  <rect x="250" y="158" width="12" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="272" y="173" font-size="11" fill="currentColor" opacity="0.9">512 files · 29 MB each · good</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">r5 — 3 100 partitions</text>
  <rect x="250" y="200" width="75" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="335" y="215" font-size="11" fill="currentColor" opacity="0.9">3 100 files · 4.8 MB each · listing hurts</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">r6 — 19 400 partitions</text>
  <rect x="250" y="242" width="470" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="868" y="257" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">19 400 files · 0.8 MB each · unusable</text>
  <text x="440" y="306" text-anchor="middle" font-size="9.0" fill="currentColor" opacity="0.85">Aim for partitions in the tens to low hundreds of megabytes. The cost at the small end is not storage, it is the metadata read before a single row is returned.</text>
</svg>
<figcaption>The useful band is narrow and it is set by file size, not by how finely you would like to slice the world.</figcaption>
</figure>

Both ends of that dial are bad in different ways. Too few partitions and a query reads gigabytes to return kilobytes. Too many and the query spends longer listing and opening files than reading them — a Parquet file carries a metadata footer that must be read before any row can be returned, so a thousand tiny files means a thousand footer reads.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 251" role="img" aria-labelledby="part-keys-t part-keys-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="part-keys-t">Three partition-key strategies compared</title>
  <desc id="part-keys-d">Three panels. Partitioning by country is natural and human-readable and matches how questions are asked, but is wildly uneven between large and small countries, so the largest partition sets the memory floor and no pruning happens within a country. Partitioning by H3 cell gives even cells but uneven data, with empty ocean cells and enormous city cells; it prunes on any bounding-box query but directory names are opaque and the resolution is one global choice. Adaptive cells split only where density demands, keeping a parent cell until it exceeds a size threshold and then splitting to children, giving even file sizes and uneven resolution at the cost of a manifest.</desc>
  <rect x="0" y="0" width="880" height="251" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three partition keys, three different failure shapes</text>
  <rect x="26" y="52" width="258" height="157" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">By country</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Natural, human-readable</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Matches how people ask questions</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Wildly uneven: DE vs LI</text>
  <text x="40" y="167" font-size="10.0" fill="currentColor" opacity="0.92">Largest partition sets the memory floor</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Cannot prune within a country</text>
  <rect x="310" y="52" width="258" height="157" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="439" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">By H3 cell</text>
  <text x="324" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Even cells, uneven data</text>
  <text x="324" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Ocean cells empty, cities enormous</text>
  <text x="324" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Prunes on any bbox query</text>
  <text x="324" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Directory names are opaque</text>
  <text x="324" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Resolution is one global choice</text>
  <rect x="594" y="52" width="258" height="157" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="723" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">By adaptive cell</text>
  <text x="608" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Split only where density demands</text>
  <text x="608" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Parent cell until it exceeds a size</text>
  <text x="608" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Then split to children</text>
  <text x="608" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Even file sizes, uneven resolution</text>
  <text x="608" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Needs a manifest to resolve</text>
  <text x="440" y="235" text-anchor="middle" font-size="10.0" fill="currentColor" opacity="0.85">Uniform cells give uneven files because the data is uneven. Adaptive splitting inverts that at the cost of a manifest the reader has to consult.</text>
</svg>
<figcaption>Most OSM lakes are best served by a fixed cell resolution chosen from the densest region you care about, with the sparse partitions simply being small.</figcaption>
</figure>

For OSM specifically, a fixed H3 resolution is usually the right answer despite giving uneven file sizes, because the alternative — adaptive splitting — requires every reader to consult a manifest to know which resolution applies where, and that manifest becomes a piece of infrastructure you have to keep correct.

## Runnable solution

```python
#!/usr/bin/env python3
"""Write an OSM feature stream as an H3-partitioned GeoParquet dataset."""
from __future__ import annotations

import json
import logging
from collections import defaultdict
from pathlib import Path
from typing import Iterable

import h3
import pyarrow as pa
import pyarrow.parquet as pq

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

PARTITION_RES = 4        # directory granularity — one global choice
SORT_RES = 7             # in-file sort key, finer than the partition
ROW_GROUP_ROWS = 200_000
TARGET_PARTITION_BYTES = 128 * 1024 * 1024


def partition_key(lat: float, lon: float) -> str:
    return h3.latlng_to_cell(lat, lon, PARTITION_RES)


def sort_key(lat: float, lon: float) -> str:
    return h3.latlng_to_cell(lat, lon, SORT_RES)


def geo_metadata(bbox: list[float]) -> bytes:
    return json.dumps({
        "version": "1.1.0",
        "primary_column": "geometry",
        "columns": {"geometry": {"encoding": "WKB", "geometry_types": [],
                                 "crs": None, "bbox": bbox}},
    }).encode()


def write_partitioned(batches: Iterable[pa.Table], root: Path) -> dict[str, int]:
    """Route each row to its partition file, sorting within the partition on close.

    Rows arrive in whatever order the parser produced. Buffering per partition and
    flushing when a buffer is large enough keeps memory bounded while still letting
    each written chunk be sorted, which is what makes row-group statistics useful.
    """
    root.mkdir(parents=True, exist_ok=True)
    buffers: dict[str, list[pa.Table]] = defaultdict(list)
    buffered_rows: dict[str, int] = defaultdict(int)
    written: dict[str, int] = defaultdict(int)

    def flush(cell: str) -> None:
        if not buffers[cell]:
            return
        table = pa.concat_tables(buffers[cell])
        table = table.sort_by([("h3_sort", "ascending"), ("osm_id", "ascending")])
        meta = dict(table.schema.metadata or {})
        meta[b"geo"] = geo_metadata(list(h3.cell_to_boundary(cell)[0]) * 2)
        table = table.replace_schema_metadata(meta)
        out_dir = root / f"h3_r{PARTITION_RES}={cell}"
        out_dir.mkdir(exist_ok=True)
        part = out_dir / f"part-{written[cell]:05d}.parquet"
        pq.write_table(table, part, compression="zstd", compression_level=3,
                       row_group_size=ROW_GROUP_ROWS, write_statistics=True)
        written[cell] += 1
        buffers[cell].clear()
        buffered_rows[cell] = 0

    for batch in batches:
        for cell in set(batch.column("h3_part").to_pylist()):
            mask = pa.compute.equal(batch.column("h3_part"), cell)
            slice_ = batch.filter(mask)
            buffers[cell].append(slice_)
            buffered_rows[cell] += slice_.num_rows
            if buffered_rows[cell] * 400 > TARGET_PARTITION_BYTES:   # ~400 B/row estimate
                flush(cell)

    for cell in list(buffers):
        flush(cell)

    total_files = sum(written.values())
    logger.info("wrote %d file(s) across %d partition(s)", total_files, len(written))
    return dict(written)
```

Reading it back exercises the pruning:

```python
import pyarrow.dataset as ds
import pyarrow.compute as pc

dataset = ds.dataset("lake/", format="parquet", partitioning="hive")

# Resolve the query bbox to the partition cells it touches, then filter on the key.
cells = h3.geo_to_cells({"type": "Polygon", "coordinates": [BBOX_RING]}, PARTITION_RES)
table = dataset.to_table(filter=pc.field(f"h3_r{PARTITION_RES}").isin(list(cells)))
```

## Step-by-step walkthrough

`write_partitioned` buffers per partition rather than writing a file per batch. Writing immediately would produce one small file per partition per batch — the many-tiny-files failure, arrived at by accident. Buffering until a partition has roughly a target file's worth of rows, then flushing, gives files in the intended size band regardless of the order rows arrive in.

The two H3 resolutions do different jobs and should not be the same number. `PARTITION_RES` sets the directory granularity and therefore how many files exist. `SORT_RES` is finer and only orders rows inside a file, which is what makes the per-row-group min/max useful — the mechanism covered in the parent topic, [Exporting OSM to GeoParquet & PostGIS](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/). Using one resolution for both means every row in a file shares the sort key and the statistics distinguish nothing.

Hive-style directory names — `h3_r4=841f8d7ffffffff` — are what let `pyarrow.dataset` expose the key as a queryable column. A directory named just `841f8d7ffffffff` still partitions the data physically but the reader cannot filter on it without being told the schema.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 278" role="img" aria-labelledby="part-queries-t part-queries-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="part-queries-t">How four layouts serve three different query shapes</title>
  <desc id="part-queries-d">A grid of four layouts against three queries. A single file reads everything for all three. Country partitions read one country for a city bounding box and for a country aggregate, but everything for a global count. H3 resolution 4 partitions read two to six partitions for a city, about forty for a country aggregate, and everything for a global count. H3 resolution 4 with rows sorted inside each partition reads the same files but prunes within them, and answers a global count from metadata alone.</desc>
  <rect x="0" y="0" width="880" height="278" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What each layout does to the same three queries</text>
  <text x="317" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">bbox over one city</text>
  <text x="531" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">country-wide aggregate</text>
  <text x="745" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">global count by tag</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">single file</text>
  <rect x="213" y="84" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="317" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">reads everything</text>
  <rect x="427" y="84" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="531" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">reads everything</text>
  <rect x="641" y="84" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="745" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">reads everything</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">country partitions</text>
  <rect x="213" y="124" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="317" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">reads one country</text>
  <rect x="427" y="124" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="531" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">reads one country</text>
  <rect x="641" y="124" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="745" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">reads everything</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">H3 r4 partitions</text>
  <rect x="213" y="164" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="317" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">reads 2–6 partitions</text>
  <rect x="427" y="164" width="208" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="531" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">reads ~40 partitions</text>
  <rect x="641" y="164" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="745" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">reads everything</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">H3 r4 + sorted rows</text>
  <rect x="213" y="204" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="317" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">reads 2–6, prunes inside</text>
  <rect x="427" y="204" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="531" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">reads ~40, prunes inside</text>
  <rect x="641" y="204" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="745" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">metadata only for counts</text>
  <text x="440" y="260" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">The bottom row is the point: partitioning selects files and row-group statistics select within them, and you want both.</text>
</svg>
<figcaption>Partitioning and in-file sorting are not alternatives. One picks files, the other picks row groups, and a layout with only the first still reads far more than it needs.</figcaption>
</figure>

## Verification

Check the shape of the layout before checking the queries:

```bash
find lake -name '*.parquet' | wc -l
find lake -name '*.parquet' -printf '%s\n' | sort -n | awk '
  {a[NR]=$1; s+=$1} END {printf "min %.1f MB  median %.1f MB  max %.1f MB  total %.1f GB\n",
  a[1]/1e6, a[int(NR/2)]/1e6, a[NR]/1e6, s/1e9}'
```

A healthy layout has a median in the tens of megabytes and a maximum under a few hundred. A minimum in the kilobytes is fine — those are sparse cells — but a *median* in the kilobytes means the partition resolution is too fine.

Then confirm the pruning is real rather than assumed, by comparing bytes read:

```python
import pyarrow.dataset as ds
scanner = dataset.scanner(filter=pc.field("h3_r4").isin(["841f8d7ffffffff"]))
print(scanner.count_rows())          # rows returned
print(dataset.count_rows())          # rows in the whole lake
```

If the two numbers are close for a small-area filter, the filter is not being pushed down — usually because the partitioning scheme was not declared when the dataset was opened.

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Every query reads the whole lake | `partitioning="hive"` not passed when opening | Declare it, or use `ds.partitioning()` explicitly |
| Thousands of sub-megabyte files | Flushed per batch instead of per size | Buffer per partition to a target size |
| One partition is 4 GB | A dense city at a coarse resolution | Split that cell to children, or raise the global resolution |
| Reader cannot find the geometry | Metadata attached before the sort, then lost | Attach `geo` metadata to the table you actually write |
| `h3.latlng_to_cell` raises on some rows | Null or invalid geometry reached the keying step | Filter invalid geometry upstream |
| Partition column missing from results | Directory named without `key=value` | Use Hive-style names |

## Frequently Asked Questions

<details>
<summary>Which H3 resolution should I partition at?</summary>

Start from file size, not from geography. Estimate bytes per feature, multiply by the features in your densest region, and pick the coarsest resolution that keeps that region's partition under a few hundred megabytes. For continental OSM feature layers that usually lands at resolution 3 or 4; for a single country, 4 or 5.
</details>

<details>
<summary>Should I partition by country instead?</summary>

Only if consumers overwhelmingly ask country-shaped questions and you can tolerate Germany and Liechtenstein being one partition each. Country partitioning cannot prune within a country, so a query for one city still reads the whole of Germany. A cell scheme costs readability and gains uniform behaviour everywhere.
</details>

<details>
<summary>Can I repartition without rewriting everything?</summary>

Not really — the partition key is the directory path, so changing it means moving every row. What you can do cheaply is *split* an over-large partition: read that one cell, re-key its rows to child cells, write those, and delete the parent. Readers that filter on the parent key need to understand both, which is the manifest problem adaptive layouts have.
</details>

<details>
<summary>Do empty ocean cells cost anything?</summary>

No, because they never get created — a cell with no features produces no directory. What does cost is a cell with three features, which produces a file whose metadata footer is larger than its data. Those are harmless individually and worth watching in aggregate: if most partitions are tiny, the resolution is wrong.
</details>

## Living with the layout

A partition scheme is a long-lived decision, because changing it means rewriting every row. Two habits make that decision survivable.

Record the scheme alongside the data. A small manifest at the dataset root naming the partition key, its resolution, the sort key and the writer version costs nothing and answers the question every later reader has: what does this directory name mean, and can I rely on rows inside being sorted. Without it, the layout is discoverable only by inspection and the sort order is discoverable not at all.

Monitor the partition size distribution on every write. The layout that was right when the dataset was built drifts as the underlying data grows unevenly — a city that doubles its building coverage turns a well-sized partition into an outsized one, and nothing announces it. A single log line per run reporting the median and maximum partition size makes the drift visible while it is still cheap to fix by splitting one cell rather than by repartitioning everything.

## Specification reference

> Hive-style partitioning encodes each key as a `name=value` directory component. `pyarrow.dataset` discovers these when opened with `partitioning="hive"` and exposes them as columns, allowing a filter on the key to eliminate files before any Parquet footer is read.

## Related

- [Exporting OSM to GeoParquet & PostGIS](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/) — the topic this layout belongs to.
- [Writing OSM Features to GeoParquet with PyArrow](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/writing-osm-features-to-geoparquet-with-pyarrow/) — the writer this extends.
- [Choosing H3 Resolution for OSM Point Aggregation](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/choosing-h3-resolution-for-osm-point-aggregation/) — the same ladder, used for a different purpose.
- [Spatial Index Selection: R-tree, H3 or Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/) — why a cell scheme rather than a tree here.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — the batching the writer consumes.

Up one level: [Exporting OSM to GeoParquet & PostGIS](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/).
