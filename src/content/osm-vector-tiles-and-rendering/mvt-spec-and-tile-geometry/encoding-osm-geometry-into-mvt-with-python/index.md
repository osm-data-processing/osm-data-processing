---
title: "Encoding OSM Geometry into MVT with Python"
description: "Project, quantise and encode OSM features into a Mapbox Vector Tile by hand: tile-local integers, command and zigzag encoding, attribute tables, and winding enforced after rounding."
pageTitle: "Encode OSM Features into a Vector Tile in Python"
pageDescription: "Write a minimal MVT encoder in Python: Web Mercator projection, tile-local quantisation, MoveTo/LineTo command arrays, zigzag deltas, per-layer key and value tables, and post-quantisation winding."
slug: encoding-osm-geometry-into-mvt-with-python
type: article
breadcrumb: "Encoding MVT in Python"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Encoding OSM Geometry into MVT with Python

Turn a handful of OSM features into a valid vector tile from first principles, so that when a generator produces something unexpected you know exactly which stage to look at.

## Prerequisites

- [ ] Python 3.10+ with `shapely` ≥ 2.0 and `mapbox-vector-tile` installed, or `protobuf` if you prefer to drive the schema directly.
- [ ] Features already normalized and in WGS 84, as produced by [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/).
- [ ] The geometry model from [The Mapbox Vector Tile Spec & Tile Geometry](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/) — this guide implements it rather than re-explaining it.
- [ ] A target tile address: a zoom, an x and a y.
- [ ] A tile viewer or decoder to inspect the result; encoding without inspecting is how orientation bugs survive.

## Conceptual minimum

Encoding is four transformations applied in a fixed order, and getting the order wrong is the source of most defects.

**Project** geographic degrees to Web Mercator metres. **Locate** the tile: at zoom \\(z\\) the world spans \\(2^{z}\\) tiles in each direction, so a tile's origin in projected space follows from its x and y. **Quantise** the geometry into the tile's local grid by subtracting that origin and scaling by the extent. **Encode** the resulting integers as command and parameter arrays.

The reason order matters is that simplification and validity must happen *on the quantised coordinates*. A polygon simplified in degrees and then rounded onto a coarse grid can acquire zero-length segments; a ring whose orientation is checked before rounding can flip afterwards if two vertices collapse.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="emp1-t emp1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="emp1-t">The four encoding stages and what each one must not be moved past</title>
  <desc id="emp1-d">Four stacked stages in order. Projection converts geographic degrees into the Web Mercator plane and must happen before anything tile-specific. Tile location computes the tile's origin and span in projected units from its zoom and coordinates. Quantisation subtracts that origin, scales by the extent and rounds to integers, which is the only lossy step. Encoding writes command integers and zigzag deltas, and both validity checking and winding enforcement must happen after quantisation rather than before it.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four stages, and two checks that belong at the end</text>
  <rect x="26" y="50" width="828" height="52" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="42" y="72" font-size="12.5" font-weight="700" fill="currentColor">Project</text>
  <text x="42" y="90" font-size="10.5" fill="currentColor" opacity="0.88">Degrees to Web Mercator metres</text>
  <text x="838" y="82" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">before anything tile-local</text>
  <rect x="26" y="112" width="828" height="52" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="42" y="134" font-size="12.5" font-weight="700" fill="currentColor">Locate</text>
  <text x="42" y="152" font-size="10.5" fill="currentColor" opacity="0.88">Tile origin and span from z, x, y</text>
  <text x="838" y="144" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">pure arithmetic</text>
  <rect x="26" y="174" width="828" height="52" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="42" y="196" font-size="12.5" font-weight="700" fill="currentColor">Quantise</text>
  <text x="42" y="214" font-size="10.5" fill="currentColor" opacity="0.88">Subtract, scale, round to integers</text>
  <text x="838" y="206" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">the only lossy step</text>
  <rect x="26" y="236" width="828" height="52" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="42" y="258" font-size="12.5" font-weight="700" fill="currentColor">Encode</text>
  <text x="42" y="276" font-size="10.5" fill="currentColor" opacity="0.88">Commands, counts and zigzag deltas</text>
  <text x="838" y="268" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">validate here, not earlier</text>
  <text x="868" y="308" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Checking validity and winding before quantisation tests geometry that will not be the geometry actually stored in the tile.</text>
</svg>
<figcaption>Every correctness check belongs on the rounded integers, because those are the coordinates a client will read.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Any, Iterable

from shapely.geometry import LineString, Point, Polygon, mapping
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.mvt.encode")

EXTENT = 4096
EARTH_CIRCUMFERENCE = 40_075_016.686
ORIGIN_SHIFT = EARTH_CIRCUMFERENCE / 2.0

MOVE_TO, LINE_TO, CLOSE_PATH = 1, 2, 7


@dataclass(frozen=True)
class TileId:
    z: int
    x: int
    y: int

    def span(self) -> float:
        """Width of this tile in projected metres."""
        return EARTH_CIRCUMFERENCE / (2 ** self.z)

    def origin(self) -> tuple[float, float]:
        """Top-left corner of the tile in projected metres."""
        s = self.span()
        return (-ORIGIN_SHIFT + self.x * s, ORIGIN_SHIFT - self.y * s)


def to_mercator(lon: float, lat: float) -> tuple[float, float]:
    """WGS 84 degrees -> Web Mercator metres. Latitude is clamped at the poles."""
    lat = max(min(lat, 85.05112878), -85.05112878)
    x = lon * ORIGIN_SHIFT / 180.0
    y = math.log(math.tan((90.0 + lat) * math.pi / 360.0)) / (math.pi / 180.0)
    return x, y * ORIGIN_SHIFT / 180.0


def quantiser(tile: TileId, extent: int = EXTENT):
    """Return a function mapping projected metres onto the tile's integer grid."""
    ox, oy = tile.origin()
    span = tile.span()
    scale = extent / span

    def q(x: float, y: float) -> tuple[int, int]:
        # y increases downward in tile space, so it is subtracted, not added.
        return (round((x - ox) * scale), round((oy - y) * scale))

    return q


def command(cid: int, count: int) -> int:
    return (cid & 0x7) | (count << 3)


def zigzag(value: int) -> int:
    return (value << 1) ^ (value >> 31)


def encode_ring(points: list[tuple[int, int]], cursor: list[int],
                close: bool) -> list[int]:
    """Encode one ring or line, advancing the SHARED cursor."""
    out: list[int] = [command(MOVE_TO, 1)]
    dx, dy = points[0][0] - cursor[0], points[0][1] - cursor[1]
    out += [zigzag(dx), zigzag(dy)]
    cursor[0], cursor[1] = points[0]

    rest = points[1:-1] if close else points[1:]
    if rest:
        out.append(command(LINE_TO, len(rest)))
        for px, py in rest:
            out += [zigzag(px - cursor[0]), zigzag(py - cursor[1])]
            cursor[0], cursor[1] = px, py
    if close:
        out.append(command(CLOSE_PATH, 1))
    return out


def signed_area(points: list[tuple[int, int]]) -> float:
    """Shoelace on GRID coordinates; positive means clockwise in screen space."""
    total = 0.0
    for i in range(len(points) - 1):
        x1, y1 = points[i]
        x2, y2 = points[i + 1]
        total += (x2 - x1) * (y2 + y1)
    return total / 2.0


def encode_polygon(geom: Polygon, q) -> list[int]:
    cursor = [0, 0]
    out: list[int] = []
    rings = [list(geom.exterior.coords)] + [list(r.coords) for r in geom.interiors]
    for index, ring in enumerate(rings):
        grid = [q(x, y) for x, y in ring]
        # Drop consecutive duplicates created by rounding, or the ring is invalid.
        deduped = [grid[0]]
        for pt in grid[1:]:
            if pt != deduped[-1]:
                deduped.append(pt)
        if len(deduped) < 4:
            logger.warning("ring collapsed to %d point(s) at this zoom", len(deduped))
            continue
        if deduped[0] != deduped[-1]:
            deduped.append(deduped[0])
        # Exterior clockwise, interior counter-clockwise — checked AFTER rounding.
        want_clockwise = index == 0
        if (signed_area(deduped) > 0) != want_clockwise:
            deduped.reverse()
        out += encode_ring(deduped, cursor, close=True)
    return out


def encode_feature(geom: BaseGeometry, tile: TileId) -> list[int]:
    q = quantiser(tile)
    if isinstance(geom, Point):
        cursor = [0, 0]
        gx, gy = q(geom.x, geom.y)
        return [command(MOVE_TO, 1), zigzag(gx), zigzag(gy)]
    if isinstance(geom, LineString):
        cursor = [0, 0]
        return encode_ring([q(x, y) for x, y in geom.coords], cursor, close=False)
    if isinstance(geom, Polygon):
        return encode_polygon(geom, q)
    raise TypeError(f"unsupported geometry type {geom.geom_type}")


def build_layer(name: str, features: Iterable[tuple[BaseGeometry, dict[str, Any]]],
                tile: TileId) -> dict[str, Any]:
    """Assemble a layer with deduplicated key and value tables."""
    keys: list[str] = []
    values: list[Any] = []
    key_index: dict[str, int] = {}
    value_index: dict[Any, int] = {}
    encoded: list[dict[str, Any]] = []

    for geom, attrs in features:
        merc = transform(to_mercator, geom)
        pairs: list[int] = []
        for key, value in attrs.items():
            if key not in key_index:
                key_index[key] = len(keys)
                keys.append(key)
            if value not in value_index:
                value_index[value] = len(values)
                values.append(value)
            pairs += [key_index[key], value_index[value]]
        encoded.append({"geometry": encode_feature(merc, tile), "tags": pairs})

    logger.info("layer %s: %d feature(s), %d key(s), %d distinct value(s)",
                name, len(encoded), len(keys), len(values))
    return {"name": name, "extent": EXTENT, "version": 2,
            "keys": keys, "values": values, "features": encoded}


if __name__ == "__main__":
    tile = TileId(z=14, x=9111, y=5455)
    layer = build_layer("pois", [
        (Point(19.9373, 50.0617), {"class": "pharmacy", "rank": 2}),
    ], tile)
    logger.info("first feature geometry array: %s", layer["features"][0]["geometry"])
```

## Step-by-step walkthrough

1. **Clamp latitude before projecting.** Web Mercator is undefined at the poles; clamping at roughly 85.05 degrees is the standard convention and avoids an infinity in the logarithm.
2. **Compute the tile origin arithmetically.** The origin and span follow from the zoom and the tile coordinates alone, with no lookup table, which makes the encoder trivially testable.
3. **Invert the y axis during quantisation.** Tile space has its origin at the top-left with y increasing downwards, the opposite of projected space. Missing this mirrors every tile vertically, which looks plausible for a symmetric shape and obviously wrong for a coastline.
4. **Share one cursor across the whole feature.** `encode_ring` takes a mutable cursor and advances it. Resetting it per ring is the classic bug that scatters holes to the tile origin.
5. **Drop duplicates created by rounding.** Two source vertices a few centimetres apart round to the same grid point at low zoom; leaving both produces a zero-length segment that makes the ring invalid.
6. **Reject collapsed rings explicitly.** A ring reduced below four points no longer encloses anything and is logged and skipped rather than emitted as broken geometry.
7. **Enforce winding after rounding.** The shoelace test runs on grid coordinates, because that is where the orientation a client sees is decided.
8. **Deduplicate attributes into tables.** Keys and values are interned and features reference them by index, which is what keeps a layer with one repeated class value cheap regardless of feature count.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="emp2-t emp2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="emp2-t">Three encoder bugs, their symptom on the rendered map, and the check that catches each</title>
  <desc id="emp2-d">Three panels. A mirrored tile comes from forgetting that tile space has its y axis pointing downwards, and renders as geography flipped vertically within each tile, caught by comparing a known asymmetric coastline against a reference. Scattered holes come from resetting the geometry cursor between rings, and render as stray shapes near the tile corner, caught by decoding a polygon with a hole and checking the ring start positions. Inverted polygons come from checking ring orientation before rounding, and render as missing landmasses, caught by asserting signed area on the quantised ring.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three bugs that render as something, just not the right thing</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Mirrored tile</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Cause: y axis not inverted</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Renders flipped per tile</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Symmetric shapes look fine</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Check: an asymmetric coastline</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Scattered holes</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Cause: cursor reset per ring</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Holes appear at the corner</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Exterior ring looks correct</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Check: decode ring starts</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Inverted polygon</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Cause: winding checked early</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Landmass renders as a hole</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Rounding flipped the area sign</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Check: shoelace on the grid</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">All three produce output a decoder accepts without complaint, which is why each needs a positive assertion rather than an absence of errors.</text>
</svg>
<figcaption>A tile that decodes is not a tile that is correct; the decoder validates structure, not geography.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="emp3-t emp3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="emp3-t">What each geometry type contributes to a tile and what to watch on each</title>
  <desc id="emp3-d">A grid of three geometry types against three concerns. A point contributes a single move command and two parameters, has no winding or validity concern, and is the cheapest feature possible. A line contributes a move followed by one line command and two parameters per vertex, has no winding concern, and is watched for vertex ordering because unordered vertices inflate the deltas. A polygon contributes a move, a line and a close command per ring, has strict winding requirements, and is watched for rings collapsing to fewer than four points after rounding.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three geometry types, three different things to watch</text>
  <rect x="166" y="48" width="229" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="281" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Commands emitted</text>
  <rect x="395" y="48" width="229" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="510" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Winding</text>
  <rect x="625" y="48" width="229" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="739" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Watch for</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Point</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="281" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">one move</text>
  <text x="510" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">none</text>
  <text x="739" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">nothing</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Line</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="281" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">move plus line</text>
  <text x="510" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">none</text>
  <text x="739" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">vertex ordering</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Polygon</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="281" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">move, line, close</text>
  <text x="510" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">strict</text>
  <text x="739" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">collapsed rings</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Multi-part</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="281" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">repeat per part</text>
  <text x="510" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">per ring</text>
  <text x="739" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">shared cursor</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The bottom row is where the shared cursor matters most: each additional part continues from where the previous one ended.</text>
</svg>
<figcaption>Points are nearly free, lines are cheap if ordered, and polygons carry every rule the format has.</figcaption>
</figure>

## Verification

- **Round-trip a known point.** Encode a coordinate whose tile and grid position you computed by hand, decode it, and confirm the integers match.
- **A polygon with a hole decodes with two rings.** The interior ring must start near the exterior, not at the tile origin.
- **Signed areas have opposite signs.** Exterior and interior rings must wind oppositely on the quantised coordinates.
- **An asymmetric shape is not mirrored.** Encode a recognisable coastline and compare against a reference rendering; a flipped y axis is invisible on symmetric test data.
- **The value table is small.** For a layer with a closed vocabulary, distinct value count should be in the tens regardless of feature count; if it tracks feature count, something unique is being encoded per feature.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Geometry flipped vertically | y axis not inverted for tile space | Subtract from the tile origin rather than adding |
| Holes near the tile corner | Cursor reset between rings | Share one cursor across the whole feature |
| Ring reported invalid | Duplicate points after rounding | Drop consecutive duplicates before encoding |
| Landmass renders as a hole | Winding checked before quantisation | Run the shoelace test on grid coordinates |
| Enormous geometry arrays | Vertices not in spatial order | Order coordinates along the geometry before encoding |
| Huge value table | A unique attribute per feature | Remove identifiers from tile attributes |
| Decoder rejects parameters | Signed integers written without zigzag | Apply zigzag encoding to every delta |

## Specification reference

> Vector tile geometry is encoded as a sequence of unsigned integers holding commands and parameters. A command integer encodes a command identifier in its three least significant bits and a repeat count in the remaining bits; `MoveTo` and `LineTo` are followed by two parameters per repetition, and `ClosePath` by none. Parameters are zigzag-encoded deltas relative to the previous position, with the cursor initialised at the tile origin for each feature. See the [Mapbox Vector Tile specification](https://github.com/mapbox/vector-tile-spec) for the command values, the zigzag definition and the polygon winding rules.

## Frequently Asked Questions

<details>
<summary>Why does my tile render upside down?</summary>

Because tile coordinate space has its origin at the top-left with y increasing downwards, while projected coordinate space has y increasing northwards. Quantising by adding to the origin rather than subtracting from it mirrors every tile vertically. The bug is easy to miss because a symmetric test shape looks identical either way — use an asymmetric feature such as a real coastline to catch it.
</details>

<details>
<summary>Should the geometry cursor reset between rings?</summary>

No. The cursor is initialised once per feature at the tile origin and advances continuously through every ring of that feature. Resetting it between rings means each ring's first delta is measured from the origin instead of from the previous ring's last point, which places holes and subsequent parts of a multi-part geometry near the tile corner. The exterior ring still looks right, which is why the bug survives a quick visual check.
</details>

<details>
<summary>Why check winding after quantisation rather than before?</summary>

Because rounding can change it. A thin sliver whose vertices collapse onto the grid can end up with a signed area of the opposite sign, and a ring that was correctly wound in source coordinates is then wrongly wound in the tile. Since the client only ever sees the quantised coordinates, that is where the check has to happen — along with the duplicate-point removal that makes the ring valid in the first place.
</details>

<details>
<summary>How do I keep attribute tables small?</summary>

Encode a closed vocabulary rather than raw values, and never put a per-feature unique identifier in the tile attributes. Keys and values are interned per layer, so a class attribute with six possible values costs six entries no matter how many features carry it, while a name or an OSM identifier adds one entry per feature and can dominate the tile. If a client genuinely needs identifiers, weigh that cost explicitly rather than including them by habit.
</details>

## Related

- [The Mapbox Vector Tile Spec & Tile Geometry](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/) — the parent topic this encoder implements.
- [Choosing Tile Extent and Buffer Values](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/choosing-tile-extent-and-buffer-values/) — the two constants this code takes as given.
- [Simplifying OSM Geometry per Zoom Level](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/simplifying-osm-geometry-per-zoom-level/) — the step that should run before quantisation.
- [Converting OSM Coordinates to a Local CRS with pyproj](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/converting-osm-coordinates-to-local-crs-with-pyproj/) — a library-based alternative to the hand-written projection.
- [Building OSM Tiles with Tippecanoe](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/) — the production path once the model is understood.

Up one level: [The Mapbox Vector Tile Spec & Tile Geometry](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Encoding OSM Geometry into MVT with Python",
  "description": "Project, quantise and encode OSM features into a Mapbox Vector Tile by hand: tile-local integers, command and zigzag encoding, attribute tables, and winding enforced after rounding.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Vector Tiles & Rendering Pipelines",
  "about": ["MVT encoding", "Web Mercator projection", "geometry quantisation"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Vector Tiles & Rendering Pipelines", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/" },
    { "@type": "ListItem", "position": 3, "name": "The Mapbox Vector Tile Spec & Tile Geometry", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/" },
    { "@type": "ListItem", "position": 4, "name": "Encoding OSM Geometry into MVT with Python", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/encoding-osm-geometry-into-mvt-with-python/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Encode OSM features into a vector tile in Python",
  "description": "Project to Web Mercator, compute the tile origin, quantise onto the tile's integer grid with an inverted y axis, encode commands and zigzag deltas against a shared cursor, and enforce winding after rounding.",
  "step": [
    { "@type": "HowToStep", "name": "Project and clamp", "text": "Convert geographic coordinates to Web Mercator, clamping latitude near the poles where the projection is undefined." },
    { "@type": "HowToStep", "name": "Compute the tile frame", "text": "Derive the tile's origin and span in projected units from its zoom and coordinates using pure arithmetic." },
    { "@type": "HowToStep", "name": "Quantise with an inverted y axis", "text": "Subtract the origin, scale by the extent and round, remembering that tile space increases downwards." },
    { "@type": "HowToStep", "name": "Remove rounding duplicates", "text": "Drop consecutive identical grid points and skip rings that collapse below four points at this zoom." },
    { "@type": "HowToStep", "name": "Encode against a shared cursor", "text": "Emit command integers and zigzag deltas using one cursor that persists across every ring of the feature." },
    { "@type": "HowToStep", "name": "Enforce winding on the grid", "text": "Run a shoelace test on the quantised ring and reverse it when the orientation does not match the exterior or interior requirement." },
    { "@type": "HowToStep", "name": "Intern attributes", "text": "Build per-layer key and value tables and reference them by index so repeated values are stored once." }
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
      "name": "Why does my vector tile render upside down?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because tile coordinate space has its origin at the top-left with y increasing downwards, while projected coordinate space has y increasing northwards. Quantising by adding to the origin rather than subtracting from it mirrors every tile vertically. The bug is easy to miss because a symmetric test shape looks identical either way — use an asymmetric feature such as a real coastline." }
    },
    {
      "@type": "Question",
      "name": "Should the MVT geometry cursor reset between rings?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. The cursor is initialised once per feature at the tile origin and advances continuously through every ring of that feature. Resetting it between rings means each ring's first delta is measured from the origin instead of from the previous ring's last point, which places holes and subsequent parts near the tile corner." }
    },
    {
      "@type": "Question",
      "name": "Why check polygon winding after quantisation rather than before?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because rounding can change it. A thin sliver whose vertices collapse onto the grid can end up with a signed area of the opposite sign, and a ring correctly wound in source coordinates is then wrongly wound in the tile. Since the client only ever sees the quantised coordinates, that is where the check has to happen." }
    },
    {
      "@type": "Question",
      "name": "How do I keep vector tile attribute tables small?",
      "acceptedAnswer": { "@type": "Answer", "text": "Encode a closed vocabulary rather than raw values, and never put a per-feature unique identifier in the tile attributes. Keys and values are interned per layer, so a class attribute with six possible values costs six entries no matter how many features carry it, while a name or identifier adds one entry per feature and can dominate the tile." }
    }
  ]
}
</script>
