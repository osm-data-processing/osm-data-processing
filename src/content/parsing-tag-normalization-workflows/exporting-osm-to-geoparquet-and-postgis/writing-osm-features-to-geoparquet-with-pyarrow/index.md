---
title: "Writing OSM Features to GeoParquet with PyArrow"
description: "Write a GeoParquet file that spatial readers actually recognise: the geo metadata block, WKB encoding, CRS declaration, row-group sizing, and sorting rows so bounding-box filters prune."
pageTitle: "Write OSM Features to GeoParquet with PyArrow"
pageDescription: "A complete PyArrow GeoParquet writer for OSM features — geo metadata, WKB geometry, CRS, row groups and spatial sorting — with the checks that prove readers can use it."
slug: writing-osm-features-to-geoparquet-with-pyarrow
type: article
breadcrumb: "GeoParquet with PyArrow"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Writing OSM Features to GeoParquet with PyArrow

Turn a stream of normalised OSM features into a GeoParquet file that GeoPandas, DuckDB and GDAL all open as spatial data, and that a bounding-box filter can read a fraction of.

## Prerequisites

- [ ] Python 3.10+ with `pyarrow` 14+, `shapely` 2.0+ and `h3` 4.x
- [ ] A stream of features with geometry and tags, as produced in [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/)
- [ ] A decision about which tags become typed columns
- [ ] Geometry already validated — see [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/)

## Conceptual minimum

GeoParquet is Parquet with a convention. There is no new file format, no new encoding, and no new library — just a `geo` key in the file's metadata declaring where the geometry is and what coordinate system it is in.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="gpq-anatomy-t gpq-anatomy-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="gpq-anatomy-t">What turns a Parquet file into a GeoParquet file</title>
  <desc id="gpq-anatomy-d">A four-stage chain. An Arrow table carries typed columns plus a well-known-binary blob for geometry. A geo metadata key declares the version, the primary geometry column, the CRS and the geometry types present. write_table writes it with zstd compression, a row-group size and statistics enabled. Any spatial reader such as GeoPandas, DuckDB or GDAL then finds the geometry.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="gpq" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Parquet plus one metadata key is the whole specification</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Arrow table</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">typed columns + WKB blob</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">geometry as bytes</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#gpq)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">geo metadata</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">version · primary_column</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">crs · geometry_types</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#gpq)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">write_table</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">zstd · row groups</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">statistics on</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#gpq)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">any spatial reader</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">GeoPandas · DuckDB · GDAL</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">finds the geometry</text>
  <text x="440" y="158" text-anchor="middle" font-size="11.0" fill="currentColor" opacity="0.85">Omit the metadata key and the same file is a Parquet table with an unreadable blob column — valid, loadable, and spatially invisible.</text>
</svg>
<figcaption>The metadata key is the entire difference. Without it the file still loads, still contains every byte of geometry, and no spatial tool will recognise it.</figcaption>
</figure>

Geometry itself is stored as well-known binary in an ordinary binary column. Everything a spatial reader needs to interpret that column lives in the metadata block, and every interoperability problem people have with GeoParquet is a problem with that block.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 278" role="img" aria-labelledby="gpq-meta-t gpq-meta-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="gpq-meta-t">Four GeoParquet metadata mistakes and their effect on readers</title>
  <desc id="gpq-meta-d">A grid of four mistakes. No geo key at all makes readers treat the file as a plain table with an unreadable blob column. A primary_column naming a missing column causes an error or a silent fallback and a no-geometry-column message. A null CRS on projected data makes readers assume CRS84 degrees so everything plots near zero, zero. Omitting geometry_types is read fine but loses a planning optimisation.</desc>
  <rect x="0" y="0" width="880" height="278" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four metadata mistakes and what each reader does with them</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">what readers do</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">how it looks</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">no geo key at all</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">treat it as a plain table</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">blob column, no geometry</text>
  <text x="198" y="144" text-anchor="end" font-size="9.0" fill="currentColor">primary_column names a missing column</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">error, or fall back to none</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">"no geometry column found"</text>
  <text x="198" y="184" text-anchor="end" font-size="11.0" fill="currentColor">crs null but data is projected</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">assume CRS84 degrees</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">everything plots near 0,0</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">geometry_types omitted</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">read it, no optimisation</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">works, slower planning</text>
  <text x="440" y="260" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Only the last is harmless. The third is the dangerous one, because the file loads, plots, and is wrong by the width of a continent.</text>
</svg>
<figcaption>A null CRS is not "unspecified" — the specification defines it as OGC:CRS84. Writing projected coordinates under it produces a file every reader misreads confidently.</figcaption>
</figure>

The CRS field deserves particular care. A `null` CRS is not an omission — the specification defines it to mean OGC:CRS84, longitude then latitude in WGS 84, which is exactly what unprojected OSM data is. That makes `null` the correct value for a file straight out of an OSM pipeline, and a serious error for one that has been reprojected, which is the trap discussed in [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/).

## Runnable solution

```python
#!/usr/bin/env python3
"""Write normalised OSM features as GeoParquet that spatial readers recognise."""
from __future__ import annotations

import json
import logging
from typing import Iterable, Sequence

import h3
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
from shapely import to_wkb
from shapely.geometry.base import BaseGeometry

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

ROW_GROUP_ROWS = 250_000
SORT_RESOLUTION = 6          # coarse H3 cell, used only as a locality-preserving sort key


def geo_metadata(geometry_types: Sequence[str], bbox: Sequence[float]) -> bytes:
    """The `geo` key. A null crs means OGC:CRS84 — correct for unprojected OSM."""
    return json.dumps({
        "version": "1.1.0",
        "primary_column": "geometry",
        "columns": {
            "geometry": {
                "encoding": "WKB",
                "geometry_types": list(geometry_types),
                "crs": None,
                "bbox": list(bbox),
            }
        },
    }).encode()


def build_table(features: Iterable[dict]) -> pa.Table:
    """Typed columns for what we query, a map column for everything else."""
    osm_ids, names, kinds, geoms, extra, cells = [], [], [], [], [], []
    for f in features:
        geom: BaseGeometry = f["geometry"]
        tags: dict[str, str] = f["tags"]
        osm_ids.append(f["osm_id"])
        names.append(tags.get("name"))
        kinds.append(tags.get("building"))
        geoms.append(to_wkb(geom, output_dimension=2))
        # Everything not promoted to a column survives in the map, so nothing is lost.
        extra.append([(k, v) for k, v in tags.items() if k not in ("name", "building")])
        centroid = geom.representative_point()
        cells.append(h3.latlng_to_cell(centroid.y, centroid.x, SORT_RESOLUTION))
    return pa.table({
        "osm_id": pa.array(osm_ids, pa.int64()),
        "name": pa.array(names, pa.string()),
        "building": pa.array(kinds, pa.string()),
        "tags": pa.array(extra, pa.map_(pa.string(), pa.string())),
        "h3_r6": pa.array(cells, pa.string()),
        "geometry": pa.array(geoms, pa.binary()),
    })


def write_geoparquet(table: pa.Table, path: str, geometry_types: Sequence[str],
                     bbox: Sequence[float]) -> None:
    """Sort for locality, attach the geo metadata, write with statistics on."""
    ordered = table.sort_by([("h3_r6", "ascending"), ("osm_id", "ascending")])
    meta = dict(ordered.schema.metadata or {})
    meta[b"geo"] = geo_metadata(geometry_types, bbox)
    ordered = ordered.replace_schema_metadata(meta)
    pq.write_table(
        ordered, path,
        compression="zstd", compression_level=3,
        row_group_size=ROW_GROUP_ROWS,
        write_statistics=True,
    )
    groups = -(-ordered.num_rows // ROW_GROUP_ROWS)
    logger.info("wrote %s: %d rows in %d row group(s)", path, ordered.num_rows, groups)


def verify(path: str) -> None:
    """Assert the file is readable as spatial data before anything downstream sees it."""
    pf = pq.ParquetFile(path)
    meta = pf.schema_arrow.metadata or {}
    if b"geo" not in meta:
        raise ValueError(f"{path}: no `geo` metadata — readers will not see the geometry")
    geo = json.loads(meta[b"geo"])
    primary = geo["primary_column"]
    if primary not in pf.schema_arrow.names:
        raise ValueError(f"{path}: primary_column {primary!r} is not in the schema")
    logger.info("%s: %d row group(s), primary column %r, crs %r",
                path, pf.num_row_groups, primary, geo["columns"][primary]["crs"])
```

## Step-by-step walkthrough

`build_table` implements the hybrid schema the parent topic recommends: `name` and `building` become real typed columns because they are what queries filter on, and everything else goes into a `map<string,string>` so the long tail of OSM tagging survives without inflating the schema to thousands of mostly-null columns.

The `h3_r6` column is not there to be queried — it is a sort key. A coarse H3 cell groups geographically nearby features into adjacent rows, which is what makes the per-row-group min/max statistics selective. The same job can be done with a quadkey or a Hilbert index; the property that matters is locality preservation, discussed in [Spatial Index Selection](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/).

`write_geoparquet` sorts, then attaches metadata, then writes. The order matters: `replace_schema_metadata` returns a new table, and sorting after attaching would carry the metadata forward anyway, but writing before sorting would produce a file whose statistics are useless.

`verify` reads the file back and asserts the two things that actually break readers. It costs milliseconds and it catches the failure that otherwise appears as "this file has no geometry" in someone else's notebook a week later.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="gpq-rowgroups-t gpq-rowgroups-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="gpq-rowgroups-t">Bytes read by a spatial filter at four row-group sizes</title>
  <desc id="gpq-rowgroups-d">A bar chart of bytes read for a bounding-box query selecting about 0.4 percent of 14.2 million sorted building features. A single row group reads all 980 megabytes in 2.10 seconds. One million rows per group reads 172 megabytes in 0.41 seconds. A quarter of a million rows per group reads 61 megabytes in 0.17 seconds. Fifty thousand rows per group reads 38 megabytes in 0.19 seconds but adds seven percent to file size. The same quarter-million grouping on unsorted rows reads 812 megabytes in 1.78 seconds.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Row-group size against a bounding-box query</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">14.2 M building features sorted by H3 cell, filter selecting ~0.4% of rows</text>
  <line x1="250" y1="68" x2="250" y2="270" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">one row group (no pruning)</text>
  <rect x="250" y="74" width="470" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="730" y="89" font-size="11" fill="currentColor" opacity="0.9">980 MB read · 2.10 s</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">1 M rows per group</text>
  <rect x="250" y="116" width="82" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="342" y="131" font-size="11" fill="currentColor" opacity="0.9">172 MB read · 0.41 s</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">250 k rows per group</text>
  <rect x="250" y="158" width="29" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="289" y="173" font-size="11" fill="currentColor" opacity="0.9">61 MB read · 0.17 s</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">50 k rows per group</text>
  <rect x="250" y="200" width="18" height="21" rx="3" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="278" y="215" font-size="11" fill="currentColor" opacity="0.9">38 MB read · 0.19 s · +7% file size</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">unsorted, 250 k rows</text>
  <rect x="250" y="242" width="389" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="649" y="257" font-size="11" fill="currentColor" opacity="0.9">812 MB read · 1.78 s</text>
  <text x="440" y="306" text-anchor="middle" font-size="8.5" fill="currentColor" opacity="0.85">The last row is the same row-group size with the rows in arrival order — sorting is what makes the statistics selective, and without it the groups barely prune at all.</text>
</svg>
<figcaption>Sorting and row-group size only work together. Small groups over unsorted rows prune almost nothing, because every group spans the whole extent.</figcaption>
</figure>

## Verification

Open the file with a reader that was not involved in writing it:

```python
import geopandas as gpd
gdf = gpd.read_parquet("buildings.parquet")
print(gdf.crs, len(gdf), gdf.geometry.geom_type.value_counts().to_dict())
```

Three things should be true. The CRS prints as `EPSG:4326` (readers resolve a null CRS to CRS84, which is equivalent). The row count matches what was written. And the geometry types match what the metadata declared — a mismatch means the declaration was copied rather than derived.

Then check the pruning actually works:

```python
import duckdb
duckdb.sql("INSTALL spatial; LOAD spatial;")
duckdb.sql("""
  SELECT count(*) FROM 'buildings.parquet'
  WHERE h3_r6 BETWEEN '861f8d4ffffffff' AND '861f8d5ffffffff'
""").show()
```

Compare the bytes read for that query against a full scan. A well-sorted file with quarter-million-row groups should read single-digit percentages of the file for a small area.

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| GeoPandas: "no geometry column" | `geo` metadata missing | Attach it before writing |
| Everything plots off West Africa | Projected coords with a null CRS | Set the PROJJSON CRS, or write CRS84 |
| Filter reads the whole file | Rows unsorted, or one row group | Sort by a locality key; set `row_group_size` |
| `ArrowInvalid` on the tags column | Mixed types in the tag map | Coerce every tag value to `str` first |
| File much larger than expected | `compression=None`, the default | Pass `compression="zstd"` |
| Geometry column is all nulls | `to_wkb` given a Shapely 1.x geometry | Upgrade to Shapely 2.0+, or use `geom.wkb` |

## Frequently Asked Questions

<details>
<summary>Should I write one file or many?</summary>

Many, partitioned by something with a few hundred distinct values — a country, a region, a coarse cell. One enormous file cannot be read in parallel by row-range and forces every consumer through one metadata footer; millions of tiny files make listing the dataset slower than reading it. Aim for partitions in the low hundreds of megabytes.
</details>

<details>
<summary>Is WKB the only geometry encoding allowed?</summary>

WKB is the encoding every reader supports and the safe default. GeoParquet 1.1 also permits a native Arrow geometry encoding which is faster to read because it avoids parsing WKB per row, but support is not yet universal. Write WKB unless you control every consumer.
</details>

<details>
<summary>Do I need to write the bbox in the metadata?</summary>

It is optional and worth including. Readers use it to skip a file entirely when it cannot intersect a query, which for a partitioned dataset means most files are never opened. Compute it from the data rather than from the boundary you cut with, since the two differ wherever a clipping strategy kept features that spill past the line.
</details>

<details>
<summary>How do I add a column later without rewriting everything?</summary>

You cannot, within a file — Parquet is immutable. What you can do is write the new column as a separate dataset keyed on `osm_id` and join at read time, or accept the rewrite for the partitions that need it. This is the practical argument for keeping the tag map: promoting a tag to a column later becomes a schema change rather than a re-extract from the PBF.
</details>

## Writing incrementally

Building the whole table in memory before writing works up to a few million features and stops working somewhere below a country-sized layer. `pq.ParquetWriter` takes the schema up front and accepts batches, which keeps peak memory at one batch rather than one layer:

```python
writer = pq.ParquetWriter(path, schema, compression="zstd",
                          compression_level=3, write_statistics=True)
for batch in batches:
    writer.write_table(batch, row_group_size=ROW_GROUP_ROWS)
writer.close()
```

There is a real trade here, and it is worth stating plainly. Streaming batches means you cannot sort globally, because sorting needs every row at once — so the locality that makes row-group statistics selective is lost unless the batches already arrive in spatial order. Two ways out: sort each batch and accept coarse, per-batch locality, which recovers most of the pruning when batches are large; or write unsorted and run a compaction pass afterwards that reads, sorts and rewrites, which costs one extra full pass and gives the ideal layout.

Which is right depends on how often the file is read. For a dataset written nightly and queried thousands of times a day, the compaction pass pays for itself before breakfast. For an intermediate artefact read once by the next pipeline stage, per-batch sorting is enough and the extra pass is waste.

The schema must be identical across every batch — a column that is all-null in one batch and typed in another will raise on the second write, which is the usual reason an incremental writer fails halfway through a long run. Build the schema once from the promoted-column list rather than inferring it per batch.

## Related

- [Exporting OSM to GeoParquet & PostGIS](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/) — the topic this writer belongs to.
- [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/) — where the promoted-column list is decided.
- [Spatial Index Selection: R-tree, H3 or Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/) — picking the sort key.
- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — why the CRS field must match the data.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — feeding the writer without holding the layer in memory.

Up one level: [Exporting OSM to GeoParquet & PostGIS](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/).
