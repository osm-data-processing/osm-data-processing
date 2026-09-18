---
title: "OSM Vector Tiles & Rendering Pipelines"
description: "Turning normalized OSM features into vector tiles: the MVT geometry model and its integer grid, tile pyramids and zoom budgets, the major generators, serving and invalidation, and zoom-aware generalization."
pageTitle: "OSM Vector Tiles: MVT, Generators, Serving & Generalization"
pageDescription: "Engineer a vector tile pipeline from OSM data — MVT tile-local integer geometry, extent and buffer choices, Tippecanoe and Planetiler, PMTiles serving, and generalization that survives zooming out."
slug: osm-vector-tiles-and-rendering
type: overview
breadcrumb: "Vector Tiles"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# OSM Vector Tiles & Rendering Pipelines

<figure class="diagram-wrap">
<svg viewBox="0 0 880 290" role="img" aria-labelledby="ovt1-t ovt1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ovt1-t">The stages between normalized OSM features and a tile a map client can draw</title>
  <desc id="ovt1-d">Normalized OSM features enter a layer assignment step that decides which tile layer each feature belongs to and at which zoom levels it should appear. A generalization step simplifies geometry and merges features for the zoom being produced. An encoding step projects coordinates into each tile's local integer grid and writes the vector tile. A packaging step assembles the tiles into an archive. A serving step delivers them to clients, where a style turns the abstract layers into pixels.</desc>
  <defs><marker id="ovt1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="290" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Five stages, and the style is not one of them</text>
  <rect x="26" y="122" width="240" height="56" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="146" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">normalized OSM</text>
  <text x="146" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">features and tags</text>
  <rect x="320" y="50" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="74" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">assign layers</text>
  <text x="440" y="92" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">which layer, which zooms</text>
  <rect x="320" y="122" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">generalize</text>
  <text x="440" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">simplify and merge</text>
  <rect x="320" y="194" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="218" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">encode MVT</text>
  <text x="440" y="236" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">tile-local integers</text>
  <rect x="614" y="122" width="240" height="56" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="734" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">serve</text>
  <text x="734" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">archive plus style</text>
  <line x1="266" y1="150" x2="293" y2="150" stroke="currentColor" stroke-width="1.4"/>
  <line x1="293" y1="78" x2="293" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="293" y1="78" x2="317" y2="78" stroke="currentColor" stroke-width="1.4" marker-end="url(#ovt1-a)"/>
  <line x1="293" y1="150" x2="317" y2="150" stroke="currentColor" stroke-width="1.4" marker-end="url(#ovt1-a)"/>
  <line x1="293" y1="222" x2="317" y2="222" stroke="currentColor" stroke-width="1.4" marker-end="url(#ovt1-a)"/>
  <line x1="560" y1="78" x2="587" y2="78" stroke="currentColor" stroke-width="1.4"/>
  <line x1="560" y1="150" x2="587" y2="150" stroke="currentColor" stroke-width="1.4"/>
  <line x1="560" y1="222" x2="587" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="587" y1="78" x2="587" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="587" y1="150" x2="611" y2="150" stroke="currentColor" stroke-width="1.4" marker-end="url(#ovt1-a)"/>
  <text x="868" y="274" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The style lives with the client, not the tiles: a tile carries abstract layers and attributes, never colours or widths.</text>
</svg>
<figcaption>Keeping styling out of the pipeline is what lets one tile set serve a dark map, a print map and a data inspector.</figcaption>
</figure>

Everything earlier on this site produces *data*: parsed elements, normalized tags, validated geometry, rows in a warehouse. This section covers the point at which that data has to be looked at — and the specific, unusual constraints that appear when a continent of geometry must be delivered to a browser a few hundred kilobytes at a time.

It serves mapping engineers building a tile pipeline, ETL developers whose normalized output feeds a map, and GIS analysts who need to understand why a feature visible at one zoom vanishes at the next. The unifying idea is that vector tiles are not a picture format and not a data format, but a *transport* format with its own geometry model, and most of the surprises come from treating them as either of the other two.

## The Tile Model

A tile set is a pyramid. At zoom 0 the whole world is one tile; each zoom level quadruples the tile count, so zoom 14 has over 268 million tiles and zoom 20 has more than a trillion. That growth is the central engineering fact of the whole section: you cannot render every tile at every zoom, so a tile pipeline is mostly a set of decisions about what to leave out.

Tiles are addressed by a zoom level and an x/y pair in a quadtree, which is the same structure discussed in [Spatial Index Selection: R-tree vs H3 vs Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/) — a quadkey is a tile address written as a single string, and the interchangeability is useful when you want to join tiles to indexed data.

Each tile carries **layers**, each layer carries **features**, and each feature carries geometry plus attributes. Crucially, the tile carries no styling: no colours, no line widths, no fonts. Those live in a style document applied by the client. A pipeline that bakes styling decisions into tile attributes has confused the two, and will need to regenerate the whole pyramid the first time a designer changes their mind.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 226" role="img" aria-labelledby="ovt2-t ovt2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ovt2-t">What lives inside one vector tile and what deliberately does not</title>
  <desc id="ovt2-d">A single tile broken into four parts. Layers are named groups such as roads, buildings and water, each with its own feature set. Features carry a geometry type and a tile-local integer geometry. Attributes are key-value pairs carried per feature, encoded against a per-layer key and value table so repeated values are stored once. The fourth part, styling, is shown as deliberately absent: colours, widths and fonts live in the client's style document, not in the tile.</desc>
  <rect x="0" y="0" width="880" height="226" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three things inside, one thing deliberately outside</text>
  <rect x="26" y="56" width="203" height="54" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="128" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">layers</text>
  <text x="128" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">named groups</text>
  <text x="128" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">roads, buildings, water</text>
  <text x="128" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">each with its own features</text>
  <text x="128" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">the style targets these names</text>
  <rect x="233" y="56" width="203" height="54" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="334" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">features</text>
  <text x="334" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">type plus geometry</text>
  <text x="334" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">point, line or polygon</text>
  <text x="334" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">tile-local integer coordinates</text>
  <text x="334" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">clipped to the tile plus buffer</text>
  <rect x="440" y="56" width="203" height="54" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="542" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">attributes</text>
  <text x="542" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">key-value pairs</text>
  <text x="542" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">deduplicated per layer</text>
  <text x="542" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">keys and values in tables</text>
  <text x="542" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">keep them few and small</text>
  <rect x="647" y="56" width="203" height="54" rx="6" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="748" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">not styling</text>
  <text x="748" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">lives in the client</text>
  <text x="748" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">no colours, no widths</text>
  <text x="748" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">no fonts, no z-order</text>
  <text x="748" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">changing style needs no rebuild</text>
  <text x="868" y="210" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Attribute bloat is the most common cause of oversized tiles, because every repeated string costs space in every tile that carries it.</text>
</svg>
<figcaption>The fourth column is the one that makes vector tiles worth the trouble: restyling is a client-side change, not a rebuild.</figcaption>
</figure>

## Geometry: the Tile-Local Integer Grid

The single most consequential detail of the Mapbox Vector Tile format is that geometry is not stored in geographic coordinates. Each tile defines an **extent** — conventionally 4096 — and all coordinates inside it are integers on a grid from 0 to that extent, relative to the tile's own corner.

Three things follow, and each one causes a recognisable class of bug.

**Precision is a function of zoom.** At the equator, a zoom-14 tile is roughly 2.4 kilometres across, so one grid unit at extent 4096 is about 60 centimetres. At zoom 8 the same grid spans a tile roughly 156 kilometres wide, and one unit is about 38 metres. Geometry is quantised to that grid, which is why a coastline traced to centimetre precision looks blocky at low zoom regardless of how carefully it was simplified.

**Features must be clipped.** A road crossing a tile boundary appears in both tiles, clipped at the edge. Clipping exactly at the boundary produces visible seams when the client draws a thick line, which is why tiles carry a **buffer**: geometry is kept slightly beyond the edge so the client has something to draw into the margin. Choosing that buffer is a real trade-off, developed in [Choosing Tile Extent and Buffer Values](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/choosing-tile-extent-and-buffer-values/).

**A feature can be split.** A long motorway is not one feature in the tile set; it is one feature per tile it passes through, each carrying the same identifier and attributes. Clients that assume feature uniqueness across tiles — for hover highlighting, for counting — get this wrong in ways that only appear at tile boundaries.

## Generators and What They Assume

Three tools dominate OSM tile production, and they differ less in output than in what they expect you to have already done.

**Tippecanoe** takes GeoJSON and produces an MBTiles archive. It is unopinionated about schema — whatever properties your features carry become tile attributes — and extremely good at the zoom-dependent decisions: dropping features as you zoom out, coalescing, and hitting a tile size budget automatically. It expects you to have already turned OSM into GeoJSON, which is a job for the export workflows in [Exporting OSM to GeoParquet & PostGIS](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/). [Building OSM Tiles with Tippecanoe](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/) covers its model.

**Planetiler** reads a PBF directly and produces a tile archive in one pass, with the schema expressed in code. It is built for planet-scale throughput and is the fastest route from an extract to a complete tile set, at the cost of a less flexible intermediate stage.

**Tilemaker** also reads PBF directly, with the schema expressed as a Lua profile plus a JSON configuration. It is lighter than Planetiler and the profile is easy to iterate on, which makes it a good fit for a custom schema over a regional extract. Both are covered in [Planetiler & Tilemaker Workflows](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/).

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="ovt3-t ovt3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ovt3-t">The three OSM tile generators compared on input, schema definition and scale</title>
  <desc id="ovt3-d">A grid comparing Tippecanoe, Planetiler and Tilemaker across four properties. Tippecanoe takes GeoJSON input, derives the schema from feature properties, excels at zoom-dependent feature dropping, and suits regional and thematic tile sets. Planetiler reads PBF directly, defines the schema in Java code, is built for planet-scale throughput, and suits complete base maps. Tilemaker reads PBF directly, defines the schema in a Lua profile, is moderate in throughput, and suits custom schemas over regional extracts.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Pick on where your schema lives, not on speed</text>
  <rect x="196" y="48" width="219" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="306" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Tippecanoe</text>
  <rect x="415" y="48" width="219" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="525" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Planetiler</text>
  <rect x="635" y="48" width="219" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="744" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Tilemaker</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Input</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">GeoJSON</text>
  <text x="525" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">PBF directly</text>
  <text x="744" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">PBF directly</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Schema lives in</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">feature properties</text>
  <text x="525" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">Java code</text>
  <text x="744" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a Lua profile</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Strongest at</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">zoom dropping</text>
  <text x="525" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">planet throughput</text>
  <text x="744" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">custom schemas</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Natural fit</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">thematic layers</text>
  <text x="525" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">complete base maps</text>
  <text x="744" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">regional maps</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">All three produce standards-compliant tiles, so the choice is about your workflow rather than about what clients can read.</text>
</svg>
<figcaption>The schema row is the one that decides: it determines who on your team can change what a layer contains.</figcaption>
</figure>

## Generalization: What to Draw When You Zoom Out

A base map at zoom 5 cannot contain every building in Europe, and the tile size budget will not permit it even if you wanted to. Generalization is the set of decisions that make a low-zoom tile both small and legible, and it has three distinct mechanisms.

**Selection** drops whole features below a zoom: minor roads disappear before major ones, small lakes before large ones. This is usually driven by a rank attribute computed once during layer assignment rather than recomputed per zoom.

**Simplification** reduces vertex counts. The important subtlety is that simplification tolerance should be expressed in *tile grid units*, not metres, because the grid is what the geometry will be quantised to anyway. Simplifying to a finer tolerance than the grid does nothing except cost time.

**Aggregation** merges adjacent features into one — a block of buildings into a built-up area, a cluster of small water bodies into a single polygon. This is the hardest of the three and the one that most improves low-zoom legibility. [Merging Adjacent OSM Polygons for Low Zoom](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/merging-adjacent-osm-polygons-for-low-zoom/) works through it, and [Simplifying OSM Geometry per Zoom Level](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/simplifying-osm-geometry-per-zoom-level/) covers the first two.

## Schema Design: the Contract Between Pipeline and Style

Between the OSM tag model and the map a reader sees sits a **tile schema**: the list of layer names, the attributes each layer carries, and the zoom range over which each feature type appears. It is the most under-appreciated artefact in the whole pipeline, because it is simultaneously a data contract and a design document, and the two audiences want different things from it.

The pipeline wants a schema that is cheap to produce: attributes derived directly from tags, few enough distinct values that the per-layer value tables stay small, and rules simple enough to evaluate per feature without a database lookup. The style wants a schema that is expressive: enough distinction between a motorway and a residential street to draw them differently, enough attributes to place labels, and stable layer names that do not change when the pipeline is refactored.

Three conventions keep both audiences satisfied. **Name layers by what they are, not by how they look** — a layer called `transportation` survives a redesign that a layer called `thick_orange_lines` does not. **Collapse tag values into a small closed vocabulary** rather than passing raw OSM values through: mapping several dozen `highway` values onto half a dozen classes shrinks the value table, makes the style simpler, and insulates the map from a new tag appearing upstream. And **version the schema explicitly**, because a style built against one version of a layer list will break silently against another — a feature that stops appearing is much harder to notice than one that errors.

Reusing an established schema rather than inventing one is usually the right call for a general-purpose base map, because it lets you adopt existing styles without writing one. A custom schema earns its keep when the map is thematic — a cycling map, an accessibility map, a utility network — and the attributes you need are precisely the ones a general schema discards. The tag-to-schema mapping itself is the same work as [Mapping OSM Tags to a Fixed Schema with YAML](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/mapping-osm-tags-to-a-fixed-schema-with-yaml/), applied with a cartographic rather than an analytic target.

## Counting the Pyramid Before You Build It

The arithmetic of tile counts is worth doing explicitly once, because it converts vague worries about scale into a number you can plan around. A zoom level \(z\) contains \(4^{z}\) tiles covering the whole world, so the cumulative count from zoom 0 to a maximum \(Z\) is

$$N(Z) = \sum_{z=0}^{Z} 4^{z} = \frac{4^{Z+1} - 1}{3}.$$

For \(Z = 14\) that is over 357 million tiles worldwide — but the great majority of them are ocean, and a generator that skips empty tiles produces a small fraction of that. For a single country the land-covering share is what matters, and it scales with area rather than with the world total.

Two planning rules follow. First, **the maximum zoom is the dominant cost decision**: each additional level roughly quadruples the tile count, so extending from zoom 14 to zoom 16 is a sixteen-fold increase for detail most readers reach by overzooming anyway. Second, **empty tiles must be genuinely skipped, not stored empty**, because three hundred million zero-byte objects is a storage problem in its own right regardless of the bytes involved. Both are decisions to make before the first full run, not after it has been going for six hours.

## Serving, Packaging and Invalidation

A generated tile set has to reach clients, and the packaging choice shapes the operational model.

**MBTiles** is a SQLite database of tiles, easy to generate and to query, requiring a server process to read it. **PMTiles** is a single file with an embedded index designed to be read by HTTP range requests, which means it can be served directly from object storage with no server at all — an operationally dramatic simplification covered in [Serving PMTiles from Object Storage](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/serving-pmtiles-from-object-storage/). **Loose directories** of individual tile files are simple but produce hundreds of millions of small objects, which most storage systems handle poorly.

Invalidation is where tiles meet the rest of this site. When an OSM diff arrives, some tiles are now wrong and most are not. Regenerating everything is wasteful; regenerating nothing is incorrect. The middle path is to compute a **dirty tile list** from the changed elements' coordinates, which is exactly what [Computing a Dirty Tile List from an .osc File](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/computing-a-dirty-tile-list-from-an-osc-file/) does, and then re-render only those — plus their ancestors, since a change at zoom 14 also affects the zoom 13 tile containing it. [Invalidating Tile Caches After an OSM Diff](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/invalidating-tile-caches-after-an-osm-diff/) covers the cache side.

## Validation and Error Handling

| Condition | Root cause | Detection | Remediation |
| --- | --- | --- | --- |
| Visible seams at tile edges | Buffer too small for the rendered line width | Gaps along tile boundaries at some zooms | Increase the buffer, or reduce the styled width |
| Tiles exceed the size budget | Too many features or attributes at that zoom | Generator warnings, or oversized tiles in the archive | Drop features by rank; prune attributes |
| Features vanish unpredictably | Automatic feature dropping to meet the budget | Missing features correlate with dense areas | Make the dropping explicit and rank-driven |
| Blocky geometry at low zoom | Grid quantisation, not simplification | Vertices snap to a coarse lattice | Expected; simplify in grid units and accept it |
| Duplicate features on hover | One feature split across several tiles | The same id appears in adjacent tiles | Deduplicate on feature id in the client |
| Restyling requires a rebuild | Styling baked into attributes | Colour or width values present in tile data | Move styling to the client style document |
| Stale tiles after an update | No invalidation from the diff stream | Old geometry persists in cached tiles | Compute dirty tiles and purge those keys |

## Performance and Scale

Two budgets govern a tile pipeline, and they pull against each other.

The **per-tile size budget** is what clients can fetch and decode quickly — a few hundred kilobytes is the usual working ceiling, and well under a hundred is a better target for a base map. Every feature and every attribute competes for it.

The **total generation cost** is the pyramid. Generating zoom 0 to 14 for a continent is a large batch job; generating zoom 0 to 20 is not feasible, which is why high-zoom detail is normally served by **overzooming** — the client scales a zoom-14 tile up rather than fetching a zoom-18 one that was never generated.

The practical consequences: choose a maximum zoom deliberately and accept overzoom above it; rank features once so zoom-dependent dropping is a lookup rather than a computation; and treat attribute count as a first-class budget line, because a string attribute repeated across a million features is measured in gigabytes.

## Licensing and Attribution

Vector tiles derived from OpenStreetMap are a derived database under the Open Database Licence, and the attribution obligation travels with them. Practically this means the map client must display attribution, and the tile set's metadata should record its source and the extract it came from. Because a tile set is typically served to many consumers who never see your pipeline, the attribution in the style document is the only place most people will encounter it — which makes it a required output of the pipeline rather than a courtesy. The obligations themselves are worked through in [OSM Licensing & ODbL Compliance](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/).

## Topics in This Section

- [The Mapbox Vector Tile Spec & Tile Geometry](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/) — the integer grid, command encoding, clipping and buffers, and the bugs each one produces.
- [Building OSM Tiles with Tippecanoe](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/) — GeoJSON in, MBTiles out, with zoom-dependent dropping under control.
- [Planetiler & Tilemaker Workflows](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/) — PBF-to-tiles in one pass, with the schema expressed in code or a profile.
- [Serving & Invalidating OSM Tiles](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/) — packaging formats, serverless delivery, and purging what a diff made wrong.
- [Cartographic Generalization of OSM Data](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/) — selection, simplification and aggregation as zoom decreases.

## Frequently Asked Questions

<details>
<summary>Why is my geometry blocky at low zoom even though I did not simplify it?</summary>

Because vector tile geometry is quantised to an integer grid defined by the tile's extent. At zoom 8 with the conventional extent, one grid unit is tens of metres, so every coordinate snaps to a lattice of that spacing regardless of the precision in your source data. This is inherent to the format rather than a defect, and it is why simplification tolerance should be expressed in grid units — simplifying finer than the grid costs time and changes nothing.
</details>

<details>
<summary>Why does the same road appear as several features?</summary>

Because features are clipped to tile boundaries, so a road crossing three tiles exists as three separate geometries, one per tile, each carrying the same identifier and attributes. This is how the format keeps tiles independent and cacheable. Clients that highlight on hover or count features need to deduplicate on the feature identifier, otherwise a long road appears once per tile it touches.
</details>

<details>
<summary>How do I stop features from disappearing as I zoom out?</summary>

Make the dropping explicit rather than leaving it to the generator's size-budget heuristic. Compute a rank attribute for every feature during layer assignment — road classification, water body area, settlement population — and drive minimum zoom from that rank. The generator then drops by your rule rather than by whichever features happened to be encountered when the tile ran out of room, which is what makes the result predictable and reviewable.
</details>

<details>
<summary>Do I need a tile server?</summary>

Not necessarily. A single-file archive with an embedded index can be served directly from object storage using HTTP range requests, which removes the server entirely and leaves you with a static file and a content delivery network. A server process is still worth having when you need per-request logic — access control, on-the-fly filtering, or dynamic layers — but for a static base map it is an operational cost with no corresponding benefit.
</details>

<details>
<summary>How do I update tiles after an OSM diff without regenerating everything?</summary>

Compute the set of tiles the changed elements touch, expand it to include ancestor tiles at lower zooms, and re-render only those. A minutely diff typically touches a tiny fraction of a continent's tiles, so the saving is enormous. The ancestors matter because a change at high zoom also alters the generalized representation at lower zooms, and forgetting them leaves a map that is correct when you zoom in and wrong when you zoom out.
</details>

## Related

- [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) — the normalized features a tile pipeline consumes.
- [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/) — the change stream that drives invalidation.
- [Spatial Index Selection: R-tree vs H3 vs Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/) — the quadtree addressing tiles share with quadkeys.
- [Exporting OSM to GeoParquet & PostGIS](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/) — producing the intermediate a GeoJSON-based generator needs.
- [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) — geometry problems are far more visible once rendered.
- [OSM Licensing & ODbL Compliance](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/) — the attribution a served tile set must carry.

Up one level: [OSM Data Processing & QA Pipelines](https://www.osm-data-processing.org/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "OSM Vector Tiles & Rendering Pipelines",
  "description": "Turning normalized OSM features into vector tiles: the MVT geometry model and its integer grid, tile pyramids and zoom budgets, the major generators, serving and invalidation, and zoom-aware generalization.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Vector Tiles & Rendering Pipelines",
  "about": ["vector tiles", "Mapbox Vector Tile spec", "map rendering pipelines"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Vector Tiles & Rendering Pipelines", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Build a vector tile pipeline from OpenStreetMap data",
  "description": "Assign layers and ranks, generalize per zoom, encode to the tile-local integer grid with an adequate buffer, package for serving, and invalidate from the diff stream.",
  "step": [
    { "@type": "HowToStep", "name": "Assign layers and ranks", "text": "Decide which layer each normalized feature belongs to and compute a rank attribute that will drive zoom-dependent dropping." },
    { "@type": "HowToStep", "name": "Generalize for each zoom", "text": "Select by rank, simplify in tile grid units rather than metres, and aggregate adjacent features where low-zoom legibility demands it." },
    { "@type": "HowToStep", "name": "Encode to the tile grid", "text": "Project geometry into each tile's local integer grid, clip to the tile, and keep a buffer wide enough for the styled line width." },
    { "@type": "HowToStep", "name": "Keep styling out", "text": "Emit abstract layer names and attributes only, leaving colours, widths and fonts to the client style document." },
    { "@type": "HowToStep", "name": "Package for the serving model", "text": "Choose a single indexed archive for serverless delivery or a database archive when a server process is needed." },
    { "@type": "HowToStep", "name": "Invalidate from diffs", "text": "Compute the tiles a change file touches, expand to ancestor zooms, and re-render and purge only those." }
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
      "name": "Why is my vector tile geometry blocky at low zoom even though I did not simplify it?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because vector tile geometry is quantised to an integer grid defined by the tile's extent. At zoom 8 with the conventional extent, one grid unit is tens of metres, so every coordinate snaps to a lattice of that spacing regardless of the precision in your source data. This is inherent to the format, and it is why simplification tolerance should be expressed in grid units." }
    },
    {
      "@type": "Question",
      "name": "Why does the same road appear as several features in vector tiles?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because features are clipped to tile boundaries, so a road crossing three tiles exists as three separate geometries, one per tile, each carrying the same identifier and attributes. This is how the format keeps tiles independent and cacheable. Clients that highlight on hover or count features need to deduplicate on the feature identifier." }
    },
    {
      "@type": "Question",
      "name": "How do I stop features from disappearing as I zoom out?",
      "acceptedAnswer": { "@type": "Answer", "text": "Make the dropping explicit rather than leaving it to the generator's size-budget heuristic. Compute a rank attribute for every feature during layer assignment and drive minimum zoom from that rank. The generator then drops by your rule rather than by whichever features happened to be encountered when the tile ran out of room." }
    },
    {
      "@type": "Question",
      "name": "Do I need a tile server for vector tiles?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not necessarily. A single-file archive with an embedded index can be served directly from object storage using HTTP range requests, which removes the server entirely. A server process is still worth having when you need per-request logic such as access control or on-the-fly filtering, but for a static base map it is an operational cost with no corresponding benefit." }
    },
    {
      "@type": "Question",
      "name": "How do I update tiles after an OSM diff without regenerating everything?",
      "acceptedAnswer": { "@type": "Answer", "text": "Compute the set of tiles the changed elements touch, expand it to include ancestor tiles at lower zooms, and re-render only those. A minutely diff typically touches a tiny fraction of a continent's tiles. The ancestors matter because a change at high zoom also alters the generalized representation at lower zooms." }
    }
  ]
}
</script>
