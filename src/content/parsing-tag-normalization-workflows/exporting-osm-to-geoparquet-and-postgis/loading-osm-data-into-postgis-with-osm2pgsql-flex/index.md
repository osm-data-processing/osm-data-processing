---
title: "Loading OSM Data into PostGIS with osm2pgsql Flex"
description: "Write an osm2pgsql flex style file that produces your own PostGIS schema and stays updatable by minutely diffs — define_table, the ids block, per-type callbacks, and the load order that keeps it fast."
pageTitle: "Load OSM into PostGIS with osm2pgsql Flex"
pageDescription: "A complete osm2pgsql flex Lua style file for points, roads and buildings, with the ids declarations that keep every table updatable and the index order that keeps the load fast."
slug: "loading-osm-data-into-postgis-with-osm2pgsql-flex"
type: "article"
breadcrumb: "PostGIS with osm2pgsql Flex"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Loading OSM Data into PostGIS with osm2pgsql Flex

Define your own PostGIS schema in Lua and load an OSM extract into it, in a shape that a minutely diff can still update afterwards.

## Prerequisites

- [ ] `osm2pgsql` 1.9 or later, built with Lua support (`osm2pgsql --version`)
- [ ] PostgreSQL 14+ with PostGIS 3.2+, and a database you can create tables in
- [ ] An extract with a replication anchor — see [Extract Clipping & Boundary Polygons](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/)
- [ ] Disk for roughly 2.5× the extract size: output tables plus the slim middle tables
- [ ] `shared_buffers` and `maintenance_work_mem` raised for the load

## Conceptual minimum

`osm2pgsql` has two output backends. The legacy `pgsql` backend writes a fixed set of tables with a fixed column choice; the `flex` backend hands you a Lua file and executes it. Everything about the resulting schema comes from that file.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="flex-shape-t flex-shape-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="flex-shape-t">How an osm2pgsql flex style file produces and later updates a table</title>
  <desc id="flex-shape-d">A four-stage chain. define_table declares a name, an ids block and columns, and the ids block is what makes the table updatable. A process_node, process_way or process_relation callback runs once per object and decides what to insert. The insert call writes a row, or nothing at all, since silence is a valid outcome. Later, an append run applies a diff by finding the row by identifier, which only works when the ids block is present.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="flx" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The Lua style file is the schema — osm2pgsql only executes it</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">define_table</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">name · ids · columns</text>
  <text x="116" y="122" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.8">ids is what makes it updatable</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#flx)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="331" y="88" text-anchor="middle" font-size="11.5" font-weight="600" fill="currentColor">process_node/way/relation</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">one callback per type</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">you decide what inserts</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#flx)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">insert</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">a row, or nothing</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">silence is a valid outcome</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#flx)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">--append later</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">diff finds the row by id</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">only with an ids block</text>
  <text x="440" y="158" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">Everything about the resulting schema — table names, column types, which objects become rows — lives in the style file, not in the tool.</text>
</svg>
<figcaption>The tool contributes the streaming and the middle tables. Every decision about shape is yours, which is the point of flex and the reason a typo in a tag name looks exactly like an empty region.</figcaption>
</figure>

A style file does two things. It declares tables with `osm2pgsql.define_table`, and it supplies callbacks — `process_node`, `process_way`, `process_relation` — that run once per object and decide whether to insert a row. An object your callbacks ignore simply does not appear, which is the intended behaviour and the reason a misspelled tag key produces an empty table rather than an error.

The one declaration that is easy to treat as bookkeeping and is not is `ids`.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 318" role="img" aria-labelledby="flex-ids-t flex-ids-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="flex-ids-t">The five ids options in a flex table and what each permits</title>
  <desc id="flex-ids-d">A grid of five ids declarations. Omitting ids stores nothing and produces a write-once table an append run cannot update. Type node stores the node identifier and supports updates for node-derived rows. Type way stores the way identifier. Type area stores a way or relation identifier as a signed number and is the usual choice for polygon tables. Type any stores a type character plus the identifier and suits mixed-source tables.</desc>
  <rect x="0" y="0" width="880" height="318" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The ids block decides what a later diff can do</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">what it stores</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">can --append update it?</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">ids omitted</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">nothing</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">no — write-once table</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">type = 'node'</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">node id</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">yes, for node-derived rows</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">type = 'way'</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">way id</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">yes, for way-derived rows</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">type = 'area'</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">way or relation id, signed</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">yes — the usual choice for polygons</text>
  <text x="198" y="264" text-anchor="end" font-size="11.5" fill="currentColor">type = 'any'</text>
  <rect x="213" y="244" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">type char + id</text>
  <rect x="535" y="244" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="693" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">yes, mixed-source tables</text>
  <text x="440" y="300" text-anchor="middle" font-size="8.5" fill="currentColor" opacity="0.85">An area table stores relation identifiers as negative numbers, which is why osm_id on a polygon table is signed and why a naive join against a node table silently matches nothing.</text>
</svg>
<figcaption>Relation-derived areas are stored with a negative identifier. A join written without accounting for that returns nothing and raises nothing.</figcaption>
</figure>

Without an `ids` block the table is write-once: `osm2pgsql --append` has no way to find the rows belonging to a modified object, so it leaves the table alone and reports nothing. This is the single most common reason a diff-updated database stops tracking one of its tables while the others keep working.

## Runnable solution

A style file producing three tables — points of interest, a road network, and building polygons — all of them updatable:

```lua
-- osm.lua — flex style file. Every table here is updatable by --append.
local srid = 4326

local pois = osm2pgsql.define_table({
  name = 'poi',
  ids = { type = 'node', id_column = 'osm_id' },
  columns = {
    { column = 'name',     type = 'text' },
    { column = 'category', type = 'text', not_null = true },
    { column = 'tags',     type = 'jsonb' },
    { column = 'geom',     type = 'point', projection = srid, not_null = true },
  },
})

local roads = osm2pgsql.define_table({
  name = 'road',
  ids = { type = 'way', id_column = 'osm_id' },
  columns = {
    { column = 'name',     type = 'text' },
    { column = 'highway',  type = 'text', not_null = true },
    { column = 'oneway',   type = 'bool' },
    { column = 'maxspeed', type = 'int' },
    { column = 'tags',     type = 'jsonb' },
    { column = 'geom',     type = 'linestring', projection = srid, not_null = true },
  },
})

local buildings = osm2pgsql.define_table({
  -- 'area' covers both closed ways and multipolygon relations; relation ids
  -- arrive negative, which is why osm_id is signed.
  name = 'building',
  ids = { type = 'area', id_column = 'osm_id' },
  columns = {
    { column = 'name',    type = 'text' },
    { column = 'kind',    type = 'text', not_null = true },
    { column = 'levels',  type = 'int' },
    { column = 'tags',    type = 'jsonb' },
    { column = 'geom',    type = 'multipolygon', projection = srid, not_null = true },
  },
})

-- Tags that describe the object rather than the thing: never worth a column.
local uninteresting = {
  'source', 'source:date', 'attribution', 'created_by', 'note', 'fixme',
  'odbl', 'import', 'converted_by',
}

local function clean(tags)
  for _, key in ipairs(uninteresting) do tags[key] = nil end
  return tags
end

local POI_KEYS = { 'amenity', 'shop', 'tourism', 'healthcare', 'office' }

local function poi_category(tags)
  for _, key in ipairs(POI_KEYS) do
    if tags[key] then return key .. '=' .. tags[key] end
  end
  return nil
end

-- "30 mph" and "50" both have to become an integer in one unit.
local function speed_kmh(value)
  if not value then return nil end
  local n, unit = value:match('^(%d+%.?%d*)%s*(%a*)$')
  if not n then return nil end                        -- "walk", "RO:urban", ";50"
  n = tonumber(n)
  if unit:lower() == 'mph' then return math.floor(n * 1.609344 + 0.5) end
  if unit == '' or unit:lower() == 'km/h' then return math.floor(n + 0.5) end
  return nil
end

function osm2pgsql.process_node(object)
  local category = poi_category(object.tags)
  if not category then return end
  pois:insert({
    name     = object.tags.name,
    category = category,
    tags     = clean(object.tags),
    geom     = object:as_point(),
  })
end

function osm2pgsql.process_way(object)
  if object.tags.building and object.is_closed then
    buildings:insert({
      name   = object.tags.name,
      kind   = object.tags.building,
      levels = tonumber(object.tags['building:levels']),
      tags   = clean(object.tags),
      geom   = object:as_multipolygon(),
    })
    return
  end
  if object.tags.highway then
    roads:insert({
      name     = object.tags.name,
      highway  = object.tags.highway,
      oneway   = object.tags.oneway == 'yes' or object.tags.oneway == '1',
      maxspeed = speed_kmh(object.tags.maxspeed),
      tags     = clean(object.tags),
      geom     = object:as_linestring(),
    })
  end
end

function osm2pgsql.process_relation(object)
  if object.tags.type == 'multipolygon' and object.tags.building then
    buildings:insert({
      name   = object.tags.name,
      kind   = object.tags.building,
      levels = tonumber(object.tags['building:levels']),
      tags   = clean(object.tags),
      geom   = object:as_multipolygon(),
    })
  end
end
```

The load itself, then the indexes:

```bash
createdb osm && psql -d osm -c 'CREATE EXTENSION postgis;'

osm2pgsql --create --slim \
  --output=flex --style=osm.lua \
  --cache=8000 --number-processes=4 \
  -d osm ireland.osm.pbf

psql -d osm <<'SQL'
CREATE INDEX road_geom_idx     ON road     USING GIST (geom);
CREATE INDEX building_geom_idx ON building USING GIST (geom);
CREATE INDEX poi_geom_idx      ON poi      USING GIST (geom);
CREATE INDEX road_highway_idx  ON road     (highway);
ANALYZE road; ANALYZE building; ANALYZE poi;
SQL
```

## Step-by-step walkthrough

`define_table` is evaluated once, at startup, and creates the table if it does not exist. `not_null = true` on the geometry column is worth setting on every table: it turns "this object had no usable geometry" from a null row into a loud error at insert time, which is where you want to find out.

`process_way` handles the fact that a closed way tagged `building` is a polygon while a way tagged `highway` is a line, and that these are different tables. The `return` after the building insert matters — a closed way carrying both tags would otherwise land in both tables, which is occasionally what you want and usually a bug.

`speed_kmh` is the kind of normalisation that belongs in the style file rather than downstream, because it happens once at load rather than on every query. It also demonstrates the honest failure mode: values it cannot parse become null rather than a guess, following the same provenance discipline as [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/).

`process_relation` catches multipolygon buildings. Without it, every building with a courtyard is missing from the table, because a relation is not a way and `process_way` never sees it — the same asymmetry described in [Understanding OSM Multipolygon Relations for GIS](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/).

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="flex-cost-t flex-cost-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="flex-cost-t">Seconds per stage of an osm2pgsql flex import</title>
  <desc id="flex-cost-d">A bar chart of a 1.2 gigabyte country import into an empty PostGIS database. Reading and parsing the PBF takes 210 seconds. The Lua callbacks take 340 seconds. Bulk COPY into the tables takes 190 seconds. Writing the slim middle tables takes 420 seconds, the price of updatability. Index creation, clustering and analyze take 880 seconds and run after the load rather than during it.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Where the time goes in a flex import</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">country extract, 1.2 GB, into an empty PostGIS database</text>
  <line x1="250" y1="68" x2="250" y2="270" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">read + parse the PBF</text>
  <rect x="250" y="74" width="112" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="372" y="89" font-size="11" fill="currentColor" opacity="0.9">210 s · unavoidable</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">Lua callbacks</text>
  <rect x="250" y="116" width="182" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="442" y="131" font-size="11" fill="currentColor" opacity="0.9">340 s · your code, per object</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">COPY into the tables</text>
  <rect x="250" y="158" width="101" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="361" y="173" font-size="11" fill="currentColor" opacity="0.9">190 s · bulk path</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">middle tables (slim)</text>
  <rect x="250" y="200" width="224" height="21" rx="3" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="484" y="215" font-size="11" fill="currentColor" opacity="0.9">420 s · the price of updatability</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">index + cluster + analyze</text>
  <rect x="250" y="242" width="470" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="868" y="257" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">880 s · after the load, not during</text>
  <text x="440" y="306" text-anchor="middle" font-size="10.0" fill="currentColor" opacity="0.85">Index construction dominates and is the one stage that must not overlap the load — building it during the insert costs roughly three times as much.</text>
</svg>
<figcaption>Two of these five are optional. Dropping slim mode saves seven minutes and gives up the ability to apply a diff ever again.</figcaption>
</figure>

`--cache=8000` gives the node cache eight gigabytes; too little and the load thrashes, too much and the machine swaps. `--slim` writes the middle tables that make `--append` possible later.

## Verification

Three checks, in order of how quickly they fail:

```sql
-- 1. Every table has rows, and the geometry is the type you declared.
SELECT 'road' AS t, count(*), ST_GeometryType(geom) AS gt FROM road GROUP BY 1,3
UNION ALL SELECT 'building', count(*), ST_GeometryType(geom) FROM building GROUP BY 1,3
UNION ALL SELECT 'poi', count(*), ST_GeometryType(geom) FROM poi GROUP BY 1,3;

-- 2. The middle tables exist — without them --append is a no-op.
SELECT tablename FROM pg_tables WHERE tablename LIKE 'planet_osm_%';

-- 3. Relation-derived buildings arrived, and they are the negative ids.
SELECT count(*) FILTER (WHERE osm_id < 0) AS from_relations,
       count(*) FILTER (WHERE osm_id > 0) AS from_ways
FROM building;
```

The third query is the one that catches a missing `process_relation`: a real country extract has buildings from relations in the low single-digit percentages, and a count of exactly zero means they were never inserted.

Then prove the table is updatable before you rely on it:

```bash
osm2pgsql --append --slim --output=flex --style=osm.lua -d osm changes.osc.gz
```

## Common errors and fixes

| Message or symptom | Root cause | Fix |
|---|---|---|
| `Need slim mode to update` | Loaded without `--slim` | Reload with `--slim`; there is no retrofit |
| `--append` runs, row counts never change | Table declared without `ids` | Add the `ids` block and reload |
| A table is empty | Callback never inserts — tag key typo | Log a counter in Lua; do not trust silence |
| `NOT NULL violation` on `geom` | Way is not closed, or relation is broken | Guard with `object.is_closed`; quarantine the rest |
| Buildings with courtyards missing | No `process_relation` | Add it; multipolygons are relations |
| Import slows to a crawl part-way | Indexes present during load | Create indexes after, then `ANALYZE` |
| `maxspeed` column all null | Values carry units the parser rejects | Widen the parser, or keep the raw tag in `tags` |

## Frequently Asked Questions

<details>
<summary>Can I convert a non-slim import to slim later?</summary>

No. The middle tables are populated during the load from data that is discarded afterwards, so there is nothing to reconstruct them from short of re-reading the PBF — which is the reload. Decide before importing whether the database will ever need to track upstream, and if there is any doubt, use `--slim`; the cost is disk, and the alternative is a multi-hour reimport at the moment you discover you need it.
</details>

<details>
<summary>Why is osm_id negative on some building rows?</summary>

Because an `area` table can be fed by both closed ways and multipolygon relations, and the two identifier spaces overlap — way 12345 and relation 12345 are different objects. `osm2pgsql` disambiguates by storing relation-derived areas as negative numbers. Any join from this table to a way-keyed table must filter on `osm_id > 0`, and any join to a relation-keyed one must negate.
</details>

<details>
<summary>Should the raw tags column be jsonb or hstore?</summary>

`jsonb` unless you have an existing hstore schema. It indexes as well with a GIN index, it nests if you ever need it to, and every client library speaks JSON. The one argument for hstore is slightly smaller storage on tag-heavy tables, which rarely outweighs the interoperability.
</details>

<details>
<summary>How do I add a column without reimporting?</summary>

Add it in SQL and in the style file, then re-run with `--append` over a diff — but understand what that does: only objects touched by that diff get the new column populated, so the table ends up partly filled. For a column that must be complete, the honest options are a reimport or a one-off `UPDATE` that derives the value from the `tags` column you kept.
</details>

<details>
<summary>Is flex slower than the legacy pgsql output?</summary>

Marginally, because your Lua runs per object. On the measurements above the callbacks account for roughly a fifth of the load, and a style file that does heavy string work per object can push that much higher. It buys a schema you designed rather than one you have to work around, which is almost always the better trade.
</details>

## Specification reference

> `osm2pgsql.define_table({ name, ids, columns })` creates or attaches a table. The `ids` field declares how OSM object identifiers map to rows and is required for the table to be updatable in append mode. Valid `type` values are `node`, `way`, `relation`, `area` and `any`; `area` stores way identifiers positive and relation identifiers negative in a single signed column.

## Related

- [Exporting OSM to GeoParquet & PostGIS](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/) — the topic this loader belongs to.
- [Writing OSM Features to GeoParquet with PyArrow](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/writing-osm-features-to-geoparquet-with-pyarrow/) — the immutable sink, for comparison.
- [Applying Minutely Diffs to a PostGIS Database](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/applying-minutely-diffs-to-a-postgis-database/) — what the slim middle tables make possible.
- [Understanding OSM Multipolygon Relations for GIS](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/) — why `process_relation` is not optional.
- [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/) — where the tag-to-column decisions are recorded.

Up one level: [Exporting OSM to GeoParquet & PostGIS](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/).
