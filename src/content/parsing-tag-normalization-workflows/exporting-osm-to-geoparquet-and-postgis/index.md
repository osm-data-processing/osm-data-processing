---
title: "Exporting OSM to GeoParquet & PostGIS"
description: "How to land normalised OpenStreetMap features in GeoParquet or PostGIS: schema shape, geometry encoding, partitioning, row groups, osm2pgsql flex output, and keeping the two sinks consistent."
pageTitle: "Exporting OSM Data to GeoParquet and PostGIS"
pageDescription: "Design the output side of an OSM pipeline: GeoParquet schema and partitioning, WKB geometry encoding, osm2pgsql flex tables, bulk COPY loading, and verification across both sinks."
slug: exporting-osm-to-geoparquet-and-postgis
type: guide
breadcrumb: "Exporting to GeoParquet & PostGIS"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Exporting OSM to GeoParquet & PostGIS

Every stage documented in [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) ends in the same place: a stream of normalised records that has to be written somewhere a consumer can query. That last stage gets far less attention than parsing does, and it decides more about how the data is used than any earlier choice. A schema that buries every tag in a JSON blob makes the fastest export and the slowest analytics. A partitioning scheme chosen without reference to the queries makes every filter a full scan. And a sink chosen without asking whether the data will be updated commits the pipeline to either full rebuilds or a middle-table layout, for its entire life.

This topic covers the two sinks that account for most OSM pipelines. GeoParquet is the columnar, immutable, object-storage-friendly option that analytics engines read directly. PostGIS is the mutable, indexed, transactional option that can be kept current with minutely diffs. They are not alternatives so much as different answers to "what happens on the next run", and a large fraction of mature pipelines run both.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="export-fork-t export-fork-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="export-fork-t">Where a normalised OSM stream forks into its two common sinks</title>
  <desc id="export-fork-d">A four-stage chain. Normalised records carrying kind, identifier, tags and geometry reach a schema decision that is made once per sink: fixed columns or a tag map. One branch writes GeoParquet as immutable partitioned files with row groups. The other loads PostGIS through osm2pgsql flex or COPY, producing a mutable database.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="exp" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">One normalised stream, two sinks, two different contracts</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">normalised records</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">kind · id · tags · geom</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">the pipeline output</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#exp)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">schema decision</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">columns vs a tag map</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">made once, per sink</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#exp)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">GeoParquet writer</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">row groups · partitions</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">immutable files</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#exp)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">PostGIS loader</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">osm2pgsql flex · COPY</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">a mutable database</text>
  <text x="440" y="158" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">The fork is not really about file formats. It is about whether the result is rewritten wholesale each run or updated in place by diffs.</text>
</svg>
<figcaption>Choosing a sink is choosing an update model. GeoParquet is rewritten; PostGIS is amended. Everything else follows from that.</figcaption>
</figure>

## Prerequisite concepts

Three things need to be settled before the export stage is designed. The tag vocabulary has to be stable, because the columns you promote out of the tag map are a schema commitment — the material in [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) is what makes that commitment safe. The geometry has to be assembled and valid, which is the subject of [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/); writing invalid geometry to either sink pushes the problem to whoever reads it. And the coordinate reference system has to be decided, because both formats record a CRS and neither will convert for you — see [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/).

## Choosing between the sinks

<figure class="diagram-wrap">
<svg viewBox="0 0 880 358" role="img" aria-labelledby="sink-fit-t sink-fit-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sink-fit-t">GeoParquet against PostGIS across six operational properties</title>
  <desc id="sink-fit-d">A grid comparing the two sinks. GeoParquet is very fast for full-scan analytics, needs a scan or a separate index for point lookups by identifier, has no built-in spatial index, requires rewriting a partition to apply diffs, supports unlimited concurrent readers because files are immutable, and costs almost nothing at rest in object storage. PostGIS is adequate for full scans, immediate for point lookups, has GiST spatial indexing built in, applies diffs with osm2pgsql append, is bounded by connection count, and requires a running server.</desc>
  <rect x="0" y="0" width="880" height="358" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The two sinks answer different questions well</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">GeoParquet</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">PostGIS</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">full-scan analytics</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">columnar, very fast</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">row store, fine</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">point queries by id</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">needs a full scan or an index file</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">index lookup, immediate</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">spatial joins</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">no index — bring your own engine</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">GiST, built in</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">applying minutely diffs</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">rewrite the partition</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">osm2pgsql --append</text>
  <text x="198" y="264" text-anchor="end" font-size="11.5" fill="currentColor">concurrent readers</text>
  <rect x="213" y="244" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">unlimited, files are immutable</text>
  <rect x="535" y="244" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="693" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">bounded by connections</text>
  <text x="198" y="304" text-anchor="end" font-size="11.5" fill="currentColor">cost at rest</text>
  <rect x="213" y="284" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="304" text-anchor="middle" font-size="10.5" fill="currentColor">object storage, pennies</text>
  <rect x="535" y="284" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="304" text-anchor="middle" font-size="10.5" fill="currentColor">a running server</text>
  <text x="440" y="340" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Many teams run both: PostGIS as the diff-updated system of record, GeoParquet exported from it nightly for analytics.</text>
</svg>
<figcaption>Neither is the better sink. The pairing that works is PostGIS as the diff-updated system of record with GeoParquet exported from it for analytics.</figcaption>
</figure>

The comparison resolves into one question: does this dataset get updated, or rebuilt? A dataset rebuilt nightly from a fresh extract has no use for the middle tables that make PostGIS updatable, and gains a great deal from immutable files that any number of readers can open at once without a server. A dataset that must reflect upstream edits within minutes needs the update path described in [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/), and that path leads to a database.

## GeoParquet: what the specification actually requires

GeoParquet is ordinary Apache Parquet plus a metadata convention. The requirements are modest and worth knowing exactly, because most interoperability failures come from omitting one of them.

Geometry lives in a binary column encoded as well-known binary. The file's key-value metadata carries a `geo` key whose value is a JSON document declaring the version, the name of the primary geometry column, and, per geometry column, the encoding, the geometry types present, and the CRS as a PROJJSON object. Omit the `geo` metadata and you have a Parquet file with a blob column that no spatial tool will recognise; get the column name wrong in the metadata and readers will not find the geometry they are looking at.

```python
import json
import logging
import pyarrow as pa
import pyarrow.parquet as pq
from shapely import to_wkb

logger = logging.getLogger(__name__)

GEO_META = {
    "version": "1.1.0",
    "primary_column": "geometry",
    "columns": {
        "geometry": {
            "encoding": "WKB",
            "geometry_types": ["Polygon", "MultiPolygon"],
            "crs": None,  # null means OGC:CRS84 — longitude, latitude in WGS 84
            "bbox": [-10.6, 51.4, -5.3, 55.5],
        }
    },
}

def write_geoparquet(table: pa.Table, path: str, row_group_rows: int = 250_000) -> None:
    """Write an Arrow table as GeoParquet with the metadata spatial readers expect."""
    meta = dict(table.schema.metadata or {})
    meta[b"geo"] = json.dumps(GEO_META).encode()
    table = table.replace_schema_metadata(meta)
    pq.write_table(
        table, path,
        compression="zstd", compression_level=3,
        row_group_size=row_group_rows,
        write_statistics=True,     # per-row-group min/max is what enables pruning
    )
    logger.info("wrote %s: %d rows, %d row groups", path, table.num_rows,
                -(-table.num_rows // row_group_rows))
```

A null CRS in the metadata is not an omission — it is the specification's way of saying OGC:CRS84, longitude then latitude in WGS 84, which is what unprojected OSM data is. Writing projected coordinates without replacing that null is the most common CRS mistake in OSM exports, and it produces a file every reader misinterprets confidently.

## Schema shape

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="parquet-schema-t parquet-schema-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="parquet-schema-t">Output size for five GeoParquet schema shapes over the same layer</title>
  <desc id="parquet-schema-d">A bar chart of file size for 14.2 million German building features. Storing all tags as one JSON string column takes 3.10 gigabytes and forces every query to parse JSON. A map of string to string takes 1.45 gigabytes. Twenty typed columns plus a tag map takes 980 megabytes and lets typed reads touch a single column. Twenty typed columns with tags dropped takes 610 megabytes but is lossy. Typed columns plus a map, sorted by H3 cell before writing, takes 890 megabytes and prunes better on spatial filters.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Schema shape decides file size and query speed together</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">German buildings layer, 14.2 M features, written five ways</text>
  <line x1="250" y1="68" x2="250" y2="270" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">one JSON string column of tags</text>
  <rect x="250" y="74" width="412" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="672" y="89" font-size="11" fill="currentColor" opacity="0.9">3.10 GB · every query parses JSON</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">MAP<string,string> tag column</text>
  <rect x="250" y="116" width="193" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="453" y="131" font-size="11" fill="currentColor" opacity="0.9">1.45 GB · scan the map, no parse</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">20 typed columns + tag map</text>
  <rect x="250" y="158" width="131" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="391" y="173" font-size="11" fill="currentColor" opacity="0.9">980 MB · typed reads hit one column</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">20 typed columns, tags dropped</text>
  <rect x="250" y="200" width="81" height="21" rx="3" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="341" y="215" font-size="11" fill="currentColor" opacity="0.9">610 MB · lossy, cannot re-derive</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">typed + map, sorted by H3 cell</text>
  <rect x="250" y="242" width="118" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="378" y="257" font-size="11" fill="currentColor" opacity="0.9">890 MB · better compression, prunes</text>
  <text x="440" y="306" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Sorting before writing costs one shuffle at export and pays back on every spatially filtered query afterwards.</text>
</svg>
<figcaption>The typed-columns-plus-map shape is the one to reach for: the columns you query become real columns, and nothing is thrown away.</figcaption>
</figure>

The measurements point clearly at a hybrid: promote the tags you actually filter and group by into real typed columns, and keep the remainder in a map column so nothing is lost. Typed columns compress well and let a reader touch one column instead of parsing a blob; the map column preserves the long tail described in [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) without inflating the schema to thousands of mostly-null columns.

Two details make a large difference. Row-group size sets the granularity of statistics-based pruning: too large and a filter reads more than it needs, too small and metadata overhead grows and compression suffers. A quarter of a million rows is a reasonable default for OSM features. And sorting rows before writing — by an H3 cell, a quadkey, or any locality-preserving key from [Spatial Index Selection](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/) — clusters spatially near features into the same row group, so a bounding-box filter skips most of the file on statistics alone.

## PostGIS: the flex output

`osm2pgsql` has two output backends and the difference matters. The legacy pgsql output writes a fixed set of tables with a fixed column choice and a hstore catch-all. The flex output lets you define tables and the mapping from OSM objects to rows in Lua, which means the schema is yours rather than the tool's.

```lua
local buildings = osm2pgsql.define_table({
  name = 'buildings',
  ids = { type = 'area', id_column = 'osm_id' },
  columns = {
    { column = 'name',        type = 'text' },
    { column = 'building',    type = 'text', not_null = true },
    { column = 'levels',      type = 'int' },
    { column = 'height_m',    type = 'real' },
    { column = 'tags',        type = 'jsonb' },
    { column = 'geom',        type = 'multipolygon', projection = 4326, not_null = true },
  }
})

function osm2pgsql.process_way(object)
  if not object.is_closed or not object.tags.building then return end
  buildings:insert({
    name     = object.tags.name,
    building = object.tags.building,
    levels   = tonumber(object.tags['building:levels']),
    height_m = tonumber((object.tags.height or ''):match('^%d+%.?%d*')),
    tags     = object.tags,
    geom     = object:as_multipolygon(),
  })
end
```

The `ids` declaration is what makes the table updatable: it tells `osm2pgsql` how to find the rows belonging to an OSM object when a diff modifies it. A flex table without an `ids` block is write-once, and `--append` will not touch it.

For data that does not come through `osm2pgsql` at all — a derived table your own pipeline produces — bulk loading goes through `COPY` rather than inserts, by roughly two orders of magnitude:

```python
import io
import logging
import psycopg

logger = logging.getLogger(__name__)

def copy_features(conn: psycopg.Connection, rows: list[tuple[int, str, bytes]]) -> int:
    """Bulk-load (osm_id, name, wkb_geometry) rows into a prepared table."""
    with conn.cursor() as cur, cur.copy(
        "COPY features (osm_id, name, geom) FROM STDIN (FORMAT BINARY)"
    ) as copy:
        copy.set_types(["int8", "text", "bytea"])
        for row in rows:
            copy.write_row(row)
    logger.info("copied %d rows", len(rows))
    return len(rows)
```

Build the spatial index *after* the load, not before. A GiST index maintained during a bulk load costs roughly three times what building it once at the end does.

## Validation and error-handling matrix

| Condition | Root cause | Detection | Action |
|---|---|---|---|
| Spatial tools see no geometry in the Parquet | `geo` metadata missing or names the wrong column | Read the file's key-value metadata | Write the metadata block explicitly |
| Coordinates plot in the Gulf of Guinea | Projected coordinates with a null CRS declared | Bounding box near 0,0 | Set the PROJJSON CRS, or reproject to CRS84 |
| Every filtered query reads the whole file | No statistics, or rows unsorted | Row-group count of 1, or min/max spans everything | Sort before writing; set a row-group size |
| `osm2pgsql --append` reports nothing to update | Flex table declared without `ids` | Row counts unchanged after a diff | Add the `ids` block and reimport |
| Load takes hours on a country extract | Index present during load, or row-by-row inserts | `pg_stat_activity` shows index maintenance | `COPY`, then create the index |
| Parquet and PostGIS row counts disagree | One sink filtered invalid geometry, the other did not | Compare counts per feature class | Apply the validity gate before the fork, not after |

That last row is the systemic one. When two sinks are fed by the same pipeline, every filtering decision must happen upstream of the fork, or the sinks drift apart and nobody can say which is right.

## Performance and scale considerations

Export cost is dominated by serialisation and compression, not by the sink. Writing 14 million features to GeoParquet with zstd level 3 runs at roughly 380 000 rows per second on one core; raising compression to level 9 costs three times the CPU for around eight percent more compression, which is rarely a good trade for data that is read often. Geometry encoding is the other large term: `shapely.to_wkb` over an array is vectorised and fast, while calling it per row in a Python loop is not, in the same way and for the same reason as the regex work in [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/).

For PostGIS, the dominant term is index construction and the write-ahead log. Loading with `COPY` into an unindexed table, then creating indexes, then running `ANALYZE`, is between five and ten times faster end to end than loading into an indexed table. On a bulk initial load where the data can be re-created, an `UNLOGGED` table during the load and a switch to logged afterwards removes the WAL cost as well.

## Failure modes and gotchas

Parquet has no schema evolution rules of its own, so two runs of the same pipeline that promote different tag columns produce files that a reader cannot union. Pin the promoted-column list in the mapping registry described in [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/) and version it with the data.

Partition cardinality is the other trap. Partitioning by country gives roughly two hundred directories and works well; partitioning by H3 resolution 8 gives millions of tiny files and makes every query slower than no partitioning at all. Aim for partitions of a few hundred megabytes.

Finally, `osm2pgsql` in flex mode silently drops objects your Lua returns without inserting. That is the intended behaviour and it makes a typo in a tag name look exactly like an area with no buildings. Count insertions in the Lua and log them.

## Keeping two sinks honest

Running both sinks is common and it introduces a failure the single-sink case does not have: the two can disagree, and neither knows it. The discipline that prevents it is to treat one as the system of record and derive the other from it, rather than feeding both from the pipeline in parallel.

Deriving GeoParquet from PostGIS costs a query and guarantees the two agree by construction, because there is only one copy of the filtering and normalisation logic. Feeding both in parallel means every validity gate, every tag rule and every fallback chain exists twice, and the moment one is changed without the other the exports diverge in a way that only shows up as a row-count difference somebody notices weeks later.

Where parallel feeding is genuinely necessary — usually because the export must not wait for the database — the mitigation is a reconciliation job: count rows by feature class in both sinks on a schedule and alert on any divergence beyond a small tolerance. It does not prevent the drift, but it bounds how long it can go unnoticed.

## In this section

- [Writing OSM Features to GeoParquet with PyArrow](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/writing-osm-features-to-geoparquet-with-pyarrow/) — the complete writer, metadata block and row-group sizing included.

## Frequently Asked Questions

<details>
<summary>Should I store tags as JSON, as a map, or as columns?</summary>

As columns for the tags you query, plus a map column for the rest. A JSON string column is the worst of the options because every reader pays a parse; a map column avoids the parse but still scans; typed columns let a columnar engine read one column and skip the rest. Keeping the map alongside the columns means promoting another tag later is a schema change rather than a re-extract.
</details>

<details>
<summary>Can GeoParquet be updated with minutely diffs?</summary>

Not in place. Parquet files are immutable, so applying a diff means rewriting the partitions the changed objects fall into, and identifying those partitions requires an identifier-to-partition index you have to maintain yourself. If the dataset must track upstream within minutes, use PostGIS as the system of record and export GeoParquet from it on a schedule.
</details>

<details>
<summary>What row-group size should I use?</summary>

Around a quarter of a million rows for OSM features is a reasonable starting point. The number that actually matters is the compressed row-group size — aim for roughly 64 to 256 megabytes. Smaller groups give finer pruning and more metadata overhead; larger groups compress better and read more than a selective filter needs.
</details>

<details>
<summary>Why does my PostGIS load slow down as it progresses?</summary>

Almost always index maintenance, sometimes compounded by autovacuum. Every inserted row updates every index on the table, and a GiST index on geometry is expensive to maintain incrementally. Drop or defer the indexes, load with COPY, then create the indexes and run ANALYZE.
</details>

<details>
<summary>Do I need PostGIS at all if I have GeoParquet?</summary>

Only if you need one of three things: updates applied in place from the diff stream, transactional reads and writes, or an indexed point lookup by identifier at low latency. Analytics over whole layers is a job GeoParquet does better and far more cheaply.
</details>

## Related

- [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) — the section this export stage terminates.
- [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/) — where the promoted-column list is decided and versioned.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — the chunking that feeds the writer.
- [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) — the update path that only the database sink supports.
- [Spatial Index Selection: R-tree, H3 or Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/) — how to pick the sort and partition key.
- [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/) — the gate that must sit upstream of the fork.

Up one level: [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Should I store OSM tags as JSON, as a map, or as columns?",
      "acceptedAnswer": { "@type": "Answer", "text": "As columns for the tags you query, plus a map column for the rest. A JSON string column is worst because every reader pays a parse. A map column avoids the parse but still scans. Typed columns let a columnar engine read one column and skip the rest, and keeping the map alongside means promoting another tag later is a schema change rather than a re-extract." }
    },
    {
      "@type": "Question",
      "name": "Can GeoParquet be updated with minutely OSM diffs?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not in place. Parquet files are immutable, so applying a diff means rewriting the partitions the changed objects fall into, and identifying those partitions needs an identifier-to-partition index you maintain yourself. If the dataset must track upstream within minutes, use PostGIS as the system of record and export GeoParquet from it on a schedule." }
    },
    {
      "@type": "Question",
      "name": "What Parquet row-group size should I use for OSM features?",
      "acceptedAnswer": { "@type": "Answer", "text": "Around a quarter of a million rows is a reasonable start. The number that matters is the compressed row-group size, and the target is roughly 64 to 256 megabytes. Smaller groups prune more finely with more metadata overhead; larger groups compress better and read more than a selective filter needs." }
    },
    {
      "@type": "Question",
      "name": "Why does a PostGIS load of OSM data slow down as it progresses?",
      "acceptedAnswer": { "@type": "Answer", "text": "Almost always index maintenance, sometimes compounded by autovacuum. Every inserted row updates every index, and a GiST index on geometry is expensive to maintain incrementally. Drop or defer the indexes, load with COPY, then create the indexes and run ANALYZE." }
    },
    {
      "@type": "Question",
      "name": "Do I need PostGIS if I already export OSM data to GeoParquet?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only if you need updates applied in place from the diff stream, transactional reads and writes, or a low-latency indexed point lookup by identifier. Analytics over whole layers is a job GeoParquet does better and far more cheaply." }
    }
  ]
}
</script>
