---
title: "Converting OSM Geometries to Quadkeys"
description: "Derive tile-aligned quadkeys from OSM coordinates so containment and roll-up become string operations, with the clamping real data needs and the latitude distortion it costs."
pageTitle: "Convert OSM Geometries to Quadkeys"
pageDescription: "Quadkeys for OSM features — bit interleaving, pole and edge clamping, bounded covers for extents, prefix containment in SQL, and the cell-size distortion by latitude."
slug: "converting-osm-geometries-to-quadkeys"
type: "article"
breadcrumb: "Converting to Quadkeys"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Converting OSM Geometries to Quadkeys

Attach a tile-aligned cell key to OSM features so containment, roll-up and range queries become plain string operations — and know what the latitude distortion costs.

## Prerequisites

- [ ] Python 3.10+ with `shapely` 2.0+ and `numpy`
- [ ] Geometry in EPSG:4326, as OSM supplies it
- [ ] A target zoom level, chosen from cell size at your working latitude
- [ ] The trade-offs in [Spatial Index Selection: R-tree, H3 or Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/)

## Conceptual minimum

A quadkey is the slippy-map tile address written as a base-4 string. Zoom level 3 tile (5, 3) becomes `"213"` — three digits, one per zoom level, each naming which quadrant of its parent the tile occupies.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="qk-derive-t qk-derive-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="qk-derive-t">Deriving a quadkey from a longitude and latitude</title>
  <desc id="qk-derive-d">A four-stage chain. Longitude and latitude in EPSG:4326 are the input. They become tile x and y at a zoom level through the Web Mercator tile grid, taking the floor of a projection. The x and y bits are interleaved into a Morton code. The code is read as base-4 digits, one per zoom level, giving the quadkey string.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="qk" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Interleaving is the whole trick</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">lon, lat</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">degrees, EPSG:4326</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">the input</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#qk)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">tile x, y at zoom z</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">Web Mercator tile grid</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">floor of a projection</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#qk)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">interleave the bits</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">x and y, alternating</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">a Morton code</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#qk)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">base-4 digits</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">one per zoom level</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">the quadkey string</text>
  <text x="440" y="158" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">Because each digit is one zoom level, a quadkey is its own prefix tree: truncating the string zooms out, and a string comparison is a containment test.</text>
</svg>
<figcaption>One digit per zoom level is what makes the string a prefix tree — truncate it to zoom out, compare prefixes to test containment.</figcaption>
</figure>

That one-digit-per-level structure is the whole reason to use them. Truncating a quadkey zooms out; testing containment is `child.startswith(parent)`; a range query over a prefix is a `BETWEEN` on a string column. None of that needs a spatial library, an index type, or a database extension.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 318" role="img" aria-labelledby="qk-vs-h3-t qk-vs-h3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="qk-vs-h3-t">Quadkeys compared with H3 cells</title>
  <desc id="qk-vs-h3-d">A grid of five properties. A quadkey maps exactly to a map tile while an H3 cell has no tile relationship. Quadkey containment is a string prefix test while H3 needs its library. Quadkey ground area shrinks with the cosine of latitude while H3 area is near-uniform worldwide. Quadkey neighbour distances differ between diagonal and orthogonal directions while hexagons are uniform. Both support range queries on one column.</desc>
  <rect x="0" y="0" width="880" height="318" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What a quadkey gives you that a cell id does not</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">quadkey</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">H3 cell</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">maps to a map tile</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">exactly — it is the tile</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">no relationship</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">containment by string prefix</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">yes — startswith()</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">no — needs the H3 library</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">equal ground area</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">no — shrinks as cos(lat)</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">near-uniform worldwide</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">neighbour distance uniform</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">no — diagonal ≠ orthogonal</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">yes — hexagons</text>
  <text x="198" y="264" text-anchor="end" font-size="11.5" fill="currentColor">range query on one column</text>
  <rect x="213" y="244" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">yes — BETWEEN on a string</text>
  <rect x="535" y="244" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="693" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">yes, at one resolution</text>
  <text x="440" y="300" text-anchor="middle" font-size="9.0" fill="currentColor" opacity="0.85">Quadkeys win when the answer has to line up with tiles or be queried with plain string operations. H3 wins when the cells have to be comparable to each other.</text>
</svg>
<figcaption>The prefix property is the reason to reach for quadkeys: containment, roll-up and range queries all become plain string operations in any database.</figcaption>
</figure>

The cost is that a quadkey cell is a Web Mercator tile, and Web Mercator tiles shrink toward the poles.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="qk-area-t qk-area-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="qk-area-t">Ground width of a zoom-14 quadkey cell by latitude</title>
  <desc id="qk-area-d">A bar chart of the ground width of one zoom-14 quadkey cell. At the equator and in Nairobi at one degree south it is 2445 metres. In Cairo at 30 degrees north it is 2118 metres, 87 percent of the equatorial width. In Berlin at 52 degrees north it is 1505 metres, 62 percent. In Reykjavík at 64 degrees north it is 1072 metres, 44 percent.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Cell size at the latitudes that matter</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">ground width of one zoom-14 quadkey cell</text>
  <line x1="250" y1="68" x2="250" y2="270" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">equator (0°)</text>
  <rect x="250" y="74" width="470" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="730" y="89" font-size="11" fill="currentColor" opacity="0.9">2 445 m</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">Nairobi (1°S)</text>
  <rect x="250" y="116" width="470" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="730" y="131" font-size="11" fill="currentColor" opacity="0.9">2 445 m</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">Cairo (30°N)</text>
  <rect x="250" y="158" width="407" height="21" rx="3" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="667" y="173" font-size="11" fill="currentColor" opacity="0.9">2 118 m · 87% of the equator</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">Berlin (52°N)</text>
  <rect x="250" y="200" width="289" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="549" y="215" font-size="11" fill="currentColor" opacity="0.9">1 505 m · 62%</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">Reykjavík (64°N)</text>
  <rect x="250" y="242" width="206" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="466" y="257" font-size="11" fill="currentColor" opacity="0.9">1 072 m · 44%</text>
  <text x="440" y="306" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">A density computed per quadkey cell is not comparable between Berlin and Nairobi, because the Berlin cell covers well under half the ground.</text>
</svg>
<figcaption>This is the cost of tile alignment. If cells are being compared to each other rather than to tiles, it is the wrong scheme.</figcaption>
</figure>

## Runnable solution

```python
#!/usr/bin/env python3
"""Attach quadkeys to OSM geometries: point cells, and covers for extents."""
from __future__ import annotations

import logging
import math
from typing import Iterator

import numpy as np
from shapely.geometry.base import BaseGeometry

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

MAX_LATITUDE = 85.05112878          # where Web Mercator is clipped


def lonlat_to_tile(lon: float, lat: float, zoom: int) -> tuple[int, int]:
    """Web Mercator tile containing a point. Latitude is clamped, not wrapped."""
    lat = max(-MAX_LATITUDE, min(MAX_LATITUDE, lat))
    n = 1 << zoom
    x = int((lon + 180.0) / 360.0 * n)
    sin_lat = math.sin(math.radians(lat))
    y = int((0.5 - math.log((1 + sin_lat) / (1 - sin_lat)) / (4 * math.pi)) * n)
    # A point exactly on the eastern or northern edge lands one tile out.
    return min(x, n - 1), min(y, n - 1)


def tile_to_quadkey(x: int, y: int, zoom: int) -> str:
    """Interleave the x and y bits, most significant first, as base-4 digits."""
    digits: list[str] = []
    for level in range(zoom, 0, -1):
        mask = 1 << (level - 1)
        digit = 0
        if x & mask:
            digit += 1
        if y & mask:
            digit += 2
        digits.append(str(digit))
    return "".join(digits)


def quadkey_to_tile(quadkey: str) -> tuple[int, int, int]:
    """The inverse — useful for turning a stored key back into a tile URL."""
    x = y = 0
    zoom = len(quadkey)
    for index, char in enumerate(quadkey):
        mask = 1 << (zoom - index - 1)
        digit = int(char)
        if digit & 1:
            x |= mask
        if digit & 2:
            y |= mask
    return x, y, zoom


def point_quadkey(lon: float, lat: float, zoom: int) -> str:
    return tile_to_quadkey(*lonlat_to_tile(lon, lat, zoom), zoom)


def cover(geom: BaseGeometry, zoom: int, max_cells: int = 4096) -> list[str]:
    """Every quadkey whose tile intersects the geometry's bounds.

    Bounds, not the geometry: this is a coarse cover, meant as a candidate filter.
    Refining it against the real geometry is the caller's job.
    """
    west, south, east, north = geom.bounds
    x0, y1 = lonlat_to_tile(west, south, zoom)      # south → larger y
    x1, y0 = lonlat_to_tile(east, north, zoom)
    count = (x1 - x0 + 1) * (y1 - y0 + 1)
    if count > max_cells:
        raise ValueError(
            f"cover would be {count} cells at zoom {zoom}; "
            f"use a coarser zoom or cover the parts separately")
    return [tile_to_quadkey(x, y, zoom)
            for x in range(x0, x1 + 1)
            for y in range(y0, y1 + 1)]


def parent(quadkey: str, levels: int = 1) -> str:
    """Zoom out by truncation — the property the whole scheme exists for."""
    if levels >= len(quadkey):
        return ""
    return quadkey[:-levels]


def contains(parent_key: str, child_key: str) -> bool:
    """Containment as a string operation, no geometry involved."""
    return child_key.startswith(parent_key)


def quadkeys_for_points(lons: np.ndarray, lats: np.ndarray, zoom: int) -> list[str]:
    """Vectorised tile arithmetic; only the digit assembly stays in Python."""
    lats = np.clip(lats, -MAX_LATITUDE, MAX_LATITUDE)
    n = 1 << zoom
    xs = np.clip(((lons + 180.0) / 360.0 * n).astype(np.int64), 0, n - 1)
    sin_lat = np.sin(np.radians(lats))
    ys = np.clip(
        ((0.5 - np.log((1 + sin_lat) / (1 - sin_lat)) / (4 * np.pi)) * n).astype(np.int64),
        0, n - 1)
    return [tile_to_quadkey(int(x), int(y), zoom) for x, y in zip(xs, ys)]
```

Using it as a partition and filter key:

```sql
-- Everything inside a zoom-8 area, with no spatial index at all.
SELECT count(*) FROM features WHERE quadkey LIKE '02313021%';

-- The same as a range scan, which an ordinary B-tree serves.
SELECT count(*) FROM features
WHERE quadkey >= '02313021' AND quadkey < '02313022';

-- Roll up to zoom 10 for a density surface.
SELECT left(quadkey, 10) AS cell, count(*) FROM features GROUP BY 1;
```

## Step-by-step walkthrough

`lonlat_to_tile` clamps latitude to the Web Mercator limit rather than letting the logarithm run away. Beyond about 85.05 degrees the projection goes to infinity, and OSM does contain nodes above that — research stations, sea-ice features — so an unclamped implementation raises or produces a nonsensical tile on real data.

Both coordinates are also clamped to `n - 1`. A point exactly on the eastern or northern edge of the world computes a tile index one past the last valid one, which is a one-in-a-million input that appears reliably in a planet-scale run.

`tile_to_quadkey` walks bits from most significant to least, which is what makes the resulting string a prefix tree: the first digit describes the coarsest subdivision, so shorter strings are ancestors of longer ones.

`cover` refuses to produce an unbounded number of cells. A bounding box covering a country at zoom 16 is tens of millions of tiles, and returning that list is never what the caller wanted — the guard turns a memory exhaustion into a clear error naming the fix.

`contains` and `parent` are string operations with no geometry, which is the payoff. Compare with the same operations on H3, which need the library on both sides of the query.

`quadkeys_for_points` vectorises the arithmetic but assembles digits in a Python loop, because base-4 string construction does not vectorise usefully in numpy. For very large batches, storing the interleaved integer instead of the string keeps everything in numpy — the string is only needed where prefix operations are.

## Verification

Check the round trip and the prefix property, which together validate the bit interleaving:

```python
def test_round_trip():
    for lon, lat, z in ((13.405, 52.520, 14), (-74.006, 40.713, 18), (0.0, 0.0, 1)):
        qk = point_quadkey(lon, lat, z)
        x, y, zoom = quadkey_to_tile(qk)
        assert (x, y) == lonlat_to_tile(lon, lat, z) and zoom == z

def test_prefix_is_containment():
    child = point_quadkey(13.405, 52.520, 16)
    for levels in range(1, 8):
        assert contains(parent(child, levels), child)

def test_poles_are_clamped():
    assert point_quadkey(0.0, 89.9, 10) == point_quadkey(0.0, MAX_LATITUDE, 10)
```

Then verify against an external reference — a quadkey is a Bing Maps tile address, so it can be checked visually:

```python
print(point_quadkey(13.405, 52.520, 14))   # → 12022332303121
# https://www.bing.com/maps?... or any quadkey→tile viewer
```

Finally, sanity-check the cell size at your working latitude before committing to a zoom level:

```python
def cell_width_m(lat: float, zoom: int) -> float:
    return 40_075_016.686 * math.cos(math.radians(lat)) / (1 << zoom)

for lat in (0, 30, 52, 64):
    print(f"{lat:>3}°  {cell_width_m(lat, 14):7.0f} m")
```

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| `math domain error` near the poles | Latitude not clamped | Clamp to ±85.05112878 |
| Tile index one past the maximum | Point exactly on the world edge | Clamp x and y to `n - 1` |
| Prefix test fails for a known parent | Bits interleaved least-significant first | Walk levels from `zoom` down to 1 |
| Cover returns millions of cells | Zoom too fine for the extent | Guard the count; use a coarser zoom |
| Densities differ between cities | Cell area shrinks with latitude | Use an equal-area scheme for comparison |
| Keys sort oddly in the database | Stored as an integer, losing leading zeros | Store as a fixed-length string |

## Frequently Asked Questions

<details>
<summary>Quadkey or H3?</summary>

Quadkey when the cells must line up with map tiles, or when you want containment and roll-up as string operations in a database with no extensions. H3 when the cells are compared with each other — densities, coverage percentages, anything aggregated across latitudes — because equal area is exactly what quadkeys do not offer.
</details>

<details>
<summary>Should I store the string or the integer?</summary>

The string, if you intend to use prefix operations, and pad it to a fixed length so lexical order matches spatial order. The interleaved integer is more compact and supports range queries just as well, but `LIKE 'prefix%'` is far more readable than the equivalent bit arithmetic, and readability wins in a column other people will query.
</details>

<details>
<summary>What zoom level should I use?</summary>

Pick from cell size at your working latitude, not from the zoom number. Zoom 14 is roughly 2.4 km at the equator and 1.5 km in Berlin; zoom 16 is roughly 600 m and 380 m. Choose the coarsest level at which the smallest thing you need to distinguish still lands in its own cell.
</details>

<details>
<summary>Can a quadkey index a polygon rather than a point?</summary>

Only as a cover — a set of keys whose tiles intersect it. That is a legitimate coarse filter, and it is exactly the filter half of the filter-then-refine pattern in [Building an R-tree Index over OSM Geometries](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/building-an-rtree-index-over-osm-geometries/). Storing a cover means one row per cell per polygon, which grows quickly; storing a single key for the polygon's centroid does not answer containment questions at all.
</details>

## Specification reference

> A quadkey of length `z` addresses a Web Mercator tile at zoom `z`. Digit `i` (from the left) encodes the tile's quadrant at level `i + 1`: bit 0 of the digit is the x bit, bit 1 the y bit, giving values 0 through 3. Tile `(x, y, z)` is derived from longitude and latitude with the standard slippy-map formulae, with latitude clamped to ±85.05112878 degrees.

## Related

- [Spatial Index Selection: R-tree, H3 or Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/) — the topic this scheme belongs to.
- [Choosing H3 Resolution for OSM Point Aggregation](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/choosing-h3-resolution-for-osm-point-aggregation/) — the equal-area alternative.
- [Building an R-tree Index over OSM Geometries](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/building-an-rtree-index-over-osm-geometries/) — the exact filter a cover feeds.
- [Partitioning a GeoParquet OSM Lake by H3 Cell](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/partitioning-a-geoparquet-osm-lake-by-h3-cell/) — the same idea applied to file layout.
- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — why Web Mercator distorts area.

Up one level: [Spatial Index Selection: R-tree, H3 or Quadkey](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-index-selection-rtree-h3-quadkey/).
