---
title: "The Mapbox Vector Tile Spec & Tile Geometry"
description: "How MVT actually stores geometry: the tile-local integer grid, the MoveTo/LineTo/ClosePath command encoding, zigzag parameters, winding order, clipping and buffers."
pageTitle: "MVT Geometry: Integer Grids, Commands & Clipping"
pageDescription: "Understand the Mapbox Vector Tile geometry model — extent-relative integers, command and parameter encoding, polygon winding, clipping at tile edges — and the bugs each detail produces."
slug: mvt-spec-and-tile-geometry
type: guide
breadcrumb: "MVT Spec & Geometry"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# The Mapbox Vector Tile Spec & Tile Geometry

Every confusing thing about vector tiles traces back to one design decision: geometry is stored as small integers on a grid that belongs to the tile, not as coordinates on the Earth. Understanding that grid — how positions are encoded onto it, what happens at its edges, and what precision it actually offers — explains the blocky coastlines, the seams, the duplicated roads and the surprising file sizes all at once.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 226" role="img" aria-labelledby="mtg1-t mtg1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mtg1-t">How a geographic coordinate becomes an integer pair inside one tile</title>
  <desc id="mtg1-d">A four-stage transformation. A geographic longitude and latitude pair is first projected into Web Mercator metres. Those metres are converted to a fraction of the world at the target zoom, giving a position within the tile pyramid. The position is then made relative to the containing tile's own corner. Finally it is scaled by the tile extent and rounded to an integer on a grid running from zero to that extent, which is the value actually stored.</desc>
  <rect x="0" y="0" width="880" height="226" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four transforms, and the last one loses precision on purpose</text>
  <rect x="26" y="56" width="203" height="54" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="128" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">lon, lat</text>
  <text x="128" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">WGS 84 degrees</text>
  <text x="128" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">what OSM stores</text>
  <text x="128" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">nanodegree precision</text>
  <text x="128" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">nothing tile-specific yet</text>
  <rect x="233" y="56" width="203" height="54" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="334" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Web Mercator</text>
  <text x="334" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">projected metres</text>
  <text x="334" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">the projection tiles use</text>
  <text x="334" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">poles are excluded</text>
  <text x="334" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">distortion grows with latitude</text>
  <rect x="440" y="56" width="203" height="54" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="542" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">tile-relative</text>
  <text x="542" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">fraction of a tile</text>
  <text x="542" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">subtract the tile corner</text>
  <text x="542" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">now in range zero to one</text>
  <text x="542" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">zoom decides the tile size</text>
  <rect x="647" y="56" width="203" height="54" rx="6" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="748" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">grid integer</text>
  <text x="748" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">0 to extent</text>
  <text x="748" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">multiply and round</text>
  <text x="748" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">this is what is stored</text>
  <text x="748" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">precision follows zoom</text>
  <text x="868" y="210" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the final rounding is lossy, and how lossy it is depends entirely on how much ground the tile covers at that zoom.</text>
</svg>
<figcaption>The same source coordinate becomes a different integer in every tile that contains it, which is why tiles are independent.</figcaption>
</figure>

## The Problem This Topic Solves

You are writing or debugging something that produces or consumes vector tiles, and the behaviour does not match a mental model built on GeoJSON. Coordinates come back as small integers. A polygon that was valid in the source is reported as invalid by a tile reader. A feature you know exists appears twice. A line that should be continuous shows a hairline gap at a tile boundary.

The failure scenario worth naming is the silent one: a pipeline that encodes geometry without accounting for the grid produces tiles that *render* acceptably at the zoom the developer tested and fall apart elsewhere — self-intersections at low zoom where rounding collapsed two vertices onto the same grid point, invisible slivers at high zoom, and polygons whose winding order flipped so a client renders them as holes.

## Prerequisites

Understand projection basics from [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/), because the tile grid sits on top of Web Mercator and inherits its distortions. Know the parent section's tile pyramid model from [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/). And a working knowledge of protocol buffers helps, since MVT is a protobuf schema — the same encoding dissected in [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/).

## The Grid and Its Precision

A tile's `extent` declares the size of its local coordinate grid; 4096 is conventional and nearly universal. Coordinates run from 0 to extent across the tile, with the origin at the top-left corner.

The ground distance represented by one grid unit is therefore the tile's ground width divided by the extent. At the equator a zoom-\\(z\\) tile spans

$$w_{\text{tile}}(z) = \frac{40\,075\,017\ \text{m}}{2^{z}}$$

so one grid unit at extent 4096 covers

$$u(z) = \frac{40\,075\,017}{2^{z} \cdot 4096}\ \text{metres}.$$

At zoom 14 that is about 0.6 metres; at zoom 8, about 38 metres; at zoom 4, about 600 metres. Away from the equator the figure shrinks by a factor of \\(\cos(\varphi)\\), so the same grid is finer at high latitudes.

Two practical rules fall out. **Do not simplify below the grid**: a tolerance finer than \\(u(z)\\) produces vertices that round onto the same grid point, costing time and, worse, sometimes creating zero-length segments that make a polygon invalid. And **expect quantisation artefacts at low zoom**: they are the format working as designed, not a bug in your simplifier.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="mtg3-t mtg3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mtg3-t">Ground distance represented by one tile grid unit at each zoom, at the equator</title>
  <desc id="mtg3-d">Five zoom levels with the ground size of a single grid unit at the conventional extent of four thousand and ninety six. At zoom four a unit spans roughly six hundred metres. At zoom eight it is about thirty eight metres. At zoom eleven it is about five metres. At zoom fourteen it is about sixty centimetres. At zoom sixteen it is about fifteen centimetres. A note observes that the figure shrinks with the cosine of latitude, so the same grid is finer away from the equator.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">One grid unit, by zoom, at the equator</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">zoom 4</text>
  <rect x="216" y="60" width="518" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 600 m</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">zoom 8</text>
  <rect x="216" y="100" width="33" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 38 m</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">zoom 11</text>
  <rect x="216" y="140" width="6" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 4.8 m</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">zoom 14</text>
  <rect x="216" y="180" width="6" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 0.6 m</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">zoom 16</text>
  <rect x="216" y="220" width="6" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 0.15 m</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Away from the equator every figure shrinks by the cosine of the latitude, so a Nordic tile resolves finer than a tropical one.</text>
</svg>
<figcaption>Simplifying below the figure for your target zoom costs processing time and buys nothing the grid can represent.</figcaption>
</figure>

## Command and Parameter Encoding

Geometry inside a feature is a flat array of unsigned integers holding interleaved *commands* and *parameters*.

A command integer packs an identifier in its low three bits and a repeat count in the remaining bits: `command_integer = (id & 0x7) | (count << 3)`. Three commands exist — `MoveTo` (1), `LineTo` (2) and `ClosePath` (7). Each `MoveTo` or `LineTo` is followed by `2 × count` parameter integers; `ClosePath` takes none.

Parameters are **relative to the previous point** and zigzag-encoded so small negative deltas stay small: `parameter = (value << 1) ^ (value >> 31)`. Relative encoding is what keeps a detailed coastline compact, since consecutive vertices differ by a handful of grid units even when the absolute position is large.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="mtg2-t mtg2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mtg2-t">Decoding one geometry array, command by command</title>
  <desc id="mtg2-d">Four steps in decoding. Read a command integer and split it into a three-bit command identifier and a repeat count held in the upper bits. For a move or line command, read twice the count parameter integers. Undo the zigzag encoding on each parameter to recover a signed delta. Add each delta pair to a running cursor, which starts at the tile origin, to obtain absolute grid coordinates. A close-path command emits no parameters and returns the cursor to the ring's first point.</desc>
  <defs><marker id="mtg2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Command, count, deltas, cursor</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">read command</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">low 3 bits is the id</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">upper bits are the count</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#mtg2-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">read params</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">two per repetition</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">none for close path</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#mtg2-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">un-zigzag</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">recover signed deltas</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">small values stay small</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#mtg2-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">advance cursor</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">add to the running point</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">absolute grid position</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The cursor persists across commands within a feature, so a decoder that resets it between rings scatters the geometry.</text>
</svg>
<figcaption>Everything about the encoding is chosen so that a dense line costs a byte or two per vertex rather than eight.</figcaption>
</figure>

## Winding, Validity and Polygons

Polygon rings in MVT version 2 carry meaning in their **winding order**: an exterior ring is clockwise in the tile's screen coordinate system, and an interior ring — a hole — is counter-clockwise. A polygon feature's geometry is a sequence of rings where each exterior ring begins a new polygon and the counter-clockwise rings following it are its holes.

This is a frequent source of bugs for anyone coming from the OGC world, where the convention is the opposite way round and where hole membership is structural rather than inferred from winding. Encoding a ring with the wrong orientation produces a polygon a client renders as a hole in nothing, which typically shows up as a mysteriously missing landmass.

Validity is also affected by the grid. A ring that is valid in source coordinates can become invalid after quantisation, because two nearly-coincident vertices round to the same grid point and produce a zero-length segment or a spike. Encoders should therefore validate *after* quantisation, not before — the detection techniques in [Detecting Self-Intersecting OSM Polygons with Shapely](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/detecting-self-intersecting-osm-polygons-with-shapely/) apply directly, just on the rounded coordinates.

## Clipping and the Buffer

Geometry that extends beyond the tile must be clipped, and clipping exactly at the boundary is almost never what you want. A road drawn eight pixels wide needs geometry to continue past the edge, or the client has nothing to draw into the outer four pixels and a hairline seam appears.

The buffer is expressed in grid units and geometry is clipped to `[-buffer, extent + buffer]`. Coordinates outside 0..extent are legal in the format precisely for this reason. Larger buffers cost bytes in every tile; too-small buffers cost visible seams. The trade-off, and how to pick a value from your styled line widths, is in [Choosing Tile Extent and Buffer Values](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/choosing-tile-extent-and-buffer-values/), and the debugging workflow when it goes wrong is in [Debugging Features Clipped at Tile Edges](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/debugging-features-clipped-at-tile-edges/).

## Validation and Error-Handling Matrix

| Condition | Root cause | Detection | Remediation |
| --- | --- | --- | --- |
| Geometry scattered across the tile | Cursor reset between rings | Rings start at the tile origin | Keep one cursor for the whole feature |
| Landmass renders as a hole | Exterior ring wound the wrong way | Ring is counter-clockwise where clockwise expected | Enforce winding after quantisation |
| Polygon invalid only in tiles | Vertices collapsed by rounding | Validity fails on grid coordinates, passes on source | Simplify to at least one grid unit first |
| Hairline seams at tile edges | Buffer smaller than half the styled width | Gaps along boundaries at specific zooms | Increase the buffer for the widest styled layer |
| Coordinates outside 0..extent | Buffer geometry, not corruption | Values slightly negative or above extent | Expected; clamp only when rendering, never when encoding |
| Enormous tiles at high zoom | Deltas large because points are unordered | Parameter values far from zero | Order vertices along the geometry before encoding |
| Attributes missing on some features | Key or value index out of range | Decoder error naming the index | Build the key and value tables before encoding features |

## Performance and Scale

The encoding's efficiency depends almost entirely on **delta size**, and delta size depends on vertex ordering. Geometry traversed in spatial order produces deltas of a few grid units, which zigzag and varint encoding store in one byte. The same vertices in arbitrary order produce deltas spanning the tile, costing two or three bytes each and defeating the design.

Attributes are the other half of the budget. Keys and values live in per-layer tables and features reference them by index, so a repeated string costs one entry plus a small index per feature rather than a full copy. That makes *distinct* value count the number to watch: a layer with ten distinct values across a million features is cheap, and one with a million distinct names is not.

Finally, tile size scales with feature count and vertex count, not with geographic area. A dense city tile at zoom 14 can be fifty times the size of a rural tile at the same zoom, which is why size budgets must be enforced per tile rather than assumed from the zoom.

## Failure Modes and Gotchas

- **The cursor is per feature, not per ring.** Resetting it between rings is the most common decoder bug and produces geometry scattered from the origin.
- **Winding is opposite to the OGC convention.** Exterior rings are clockwise in screen coordinates here, and hole membership is inferred from orientation rather than declared.
- **Validate after quantisation.** A polygon valid in source coordinates can be invalid on the grid.
- **Coordinates outside the extent are normal.** They are buffer geometry; clamping them at encode time is what creates seams.
- **Extent is per layer.** Nothing requires every layer in a tile to share one extent, and a decoder that assumes 4096 will misplace geometry in a layer that chose otherwise.
- **A feature identifier is not unique in the tile set.** The same road carries the same identifier in every tile it crosses.
- **Zigzag is not two's complement.** Decoding parameters as signed integers directly produces enormous wrong values rather than an obvious error.

## Integration Points

Upstream, the geometry entering an encoder should already be projected, simplified for the target zoom and valid — the generalization decisions in [Cartographic Generalization of OSM Data](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/) happen before encoding, not during it. Downstream, the encoded tiles are packaged and served as described in [Serving & Invalidating OSM Tiles](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/).

When you are writing the encoder yourself rather than using a generator, [Encoding OSM Geometry into MVT with Python](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/encoding-osm-geometry-into-mvt-with-python/) puts the whole model into working code.

## Guides in This Topic

- [Encoding OSM Geometry into MVT with Python](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/encoding-osm-geometry-into-mvt-with-python/) — projection, quantisation, command encoding and attribute tables in working code.
- [Choosing Tile Extent and Buffer Values](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/choosing-tile-extent-and-buffer-values/) — deriving both numbers from styled line widths and a size budget.
- [Debugging Features Clipped at Tile Edges](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/debugging-features-clipped-at-tile-edges/) — isolating whether a seam comes from the buffer, the style or the source geometry.

## Frequently Asked Questions

<details>
<summary>Why are vector tile coordinates integers rather than degrees?</summary>

Because integers on a small grid compress dramatically better and decode faster. A tile-local grid of a few thousand units means most coordinate deltas fit in a single byte after zigzag and variable-length encoding, where geographic degrees would need eight bytes each. The cost is that precision is fixed by the grid and therefore by the zoom level, which is exactly the trade a transport format should make.
</details>

<details>
<summary>What does a coordinate outside the tile extent mean?</summary>

It is buffer geometry, and it is entirely normal. Features are clipped to the tile plus a margin so that a client drawing a thick line has geometry to draw into the outer pixels rather than leaving a seam. Coordinates slightly below zero or slightly above the extent are the format working as intended; clamping them during encoding is what produces the hairline gaps people then try to fix by increasing the buffer.
</details>

<details>
<summary>Why did my polygon become invalid only after encoding?</summary>

Because quantisation to the tile grid can collapse two nearly-coincident vertices onto the same point, producing a zero-length segment or a spike that makes the ring invalid. The source geometry was fine at full precision. The fix is to simplify with a tolerance of at least one grid unit before encoding, and to run validity checks on the quantised coordinates rather than on the originals.
</details>

<details>
<summary>Which way should polygon rings wind?</summary>

Exterior rings clockwise and interior rings counter-clockwise, in the tile's screen coordinate system where the origin is top-left and y increases downwards. This is the opposite of the convention most geospatial libraries use, and hole membership is inferred from the orientation rather than declared structurally. An exterior ring wound the wrong way is typically rendered as a hole, which looks like a missing feature rather than an orientation bug.
</details>

<details>
<summary>Can different layers in one tile use different extents?</summary>

Yes. The extent is declared per layer, so nothing prevents a detailed layer from using a finer grid than a coarse one. In practice almost everything uses the conventional value, which is why decoders that hard-code it usually work — right up until they encounter a tile that does not, and silently misplace every coordinate in that layer by the ratio between the assumed and actual extents.
</details>

## Related

- [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/) — the parent section and the pipeline this encoding sits inside.
- [Cartographic Generalization of OSM Data](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/) — the simplification that must precede quantisation.
- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — the projection the tile grid is built on.
- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — the same protobuf and delta-encoding techniques in OSM's own format.
- [Detecting Self-Intersecting OSM Polygons with Shapely](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/detecting-self-intersecting-osm-polygons-with-shapely/) — validity checking, applied to quantised coordinates.
- [Spatial Index Selection: R-tree vs H3 vs Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/) — the quadtree addressing tiles share.

Up one level: [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "The Mapbox Vector Tile Spec & Tile Geometry",
  "description": "How MVT actually stores geometry: the tile-local integer grid, the MoveTo/LineTo/ClosePath command encoding, zigzag parameters, winding order, clipping and buffers.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Vector Tiles & Rendering Pipelines",
  "about": ["MVT specification", "tile geometry encoding", "polygon winding order"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Vector Tiles & Rendering Pipelines", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/" },
    { "@type": "ListItem", "position": 3, "name": "The Mapbox Vector Tile Spec & Tile Geometry", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Encode geometry correctly into a Mapbox Vector Tile",
  "description": "Project and quantise coordinates onto the tile's local integer grid, encode commands and zigzag deltas against a running cursor, enforce ring winding, and clip to the tile plus a buffer.",
  "step": [
    { "@type": "HowToStep", "name": "Project to Web Mercator", "text": "Convert geographic coordinates into the projection the tile pyramid is defined in before any tile-local work." },
    { "@type": "HowToStep", "name": "Make coordinates tile-relative", "text": "Subtract the containing tile's corner and scale by the layer's declared extent." },
    { "@type": "HowToStep", "name": "Simplify to the grid", "text": "Simplify with a tolerance of at least one grid unit so quantisation does not collapse vertices into invalid geometry." },
    { "@type": "HowToStep", "name": "Encode commands and deltas", "text": "Emit command integers packing an identifier and a repeat count, followed by zigzag-encoded deltas relative to a cursor that persists across the whole feature." },
    { "@type": "HowToStep", "name": "Enforce winding after quantisation", "text": "Check ring orientation on the rounded coordinates, with exterior rings clockwise in screen space and holes counter-clockwise." },
    { "@type": "HowToStep", "name": "Clip to tile plus buffer", "text": "Retain geometry within the extent plus a margin so clients have something to draw into the outer pixels." }
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
      "name": "Why are vector tile coordinates integers rather than degrees?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because integers on a small grid compress dramatically better and decode faster. A tile-local grid of a few thousand units means most coordinate deltas fit in a single byte after zigzag and variable-length encoding, where geographic degrees would need eight bytes each. The cost is that precision is fixed by the grid and therefore by the zoom level." }
    },
    {
      "@type": "Question",
      "name": "What does a coordinate outside the tile extent mean?",
      "acceptedAnswer": { "@type": "Answer", "text": "It is buffer geometry, and it is entirely normal. Features are clipped to the tile plus a margin so that a client drawing a thick line has geometry to draw into the outer pixels rather than leaving a seam. Clamping those coordinates during encoding is what produces the hairline gaps people then try to fix by increasing the buffer." }
    },
    {
      "@type": "Question",
      "name": "Why did my polygon become invalid only after encoding to MVT?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because quantisation to the tile grid can collapse two nearly-coincident vertices onto the same point, producing a zero-length segment or a spike that makes the ring invalid. Simplify with a tolerance of at least one grid unit before encoding, and run validity checks on the quantised coordinates rather than on the originals." }
    },
    {
      "@type": "Question",
      "name": "Which way should MVT polygon rings wind?",
      "acceptedAnswer": { "@type": "Answer", "text": "Exterior rings clockwise and interior rings counter-clockwise, in the tile's screen coordinate system where the origin is top-left and y increases downwards. This is the opposite of the convention most geospatial libraries use, and hole membership is inferred from orientation rather than declared structurally." }
    },
    {
      "@type": "Question",
      "name": "Can different layers in one vector tile use different extents?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes. The extent is declared per layer, so nothing prevents a detailed layer from using a finer grid than a coarse one. In practice almost everything uses the conventional value, which is why decoders that hard-code it usually work until they encounter a tile that does not, and then silently misplace every coordinate in that layer." }
    }
  ]
}
</script>
