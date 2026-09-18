---
title: "Simplifying OSM Geometry per Zoom Level"
description: "Derive a simplification tolerance from the tile grid at each zoom, simplify shared boundaries once so adjacent areas stay stitched, and validate the result before it reaches an encoder."
pageTitle: "Per-Zoom Simplification Tolerance for OSM Geometry"
pageDescription: "Compute simplification tolerance from the tile grid unit at each zoom, simplify shared edges topologically to avoid slivers, and fall back safely when simplification invalidates a polygon."
slug: simplifying-osm-geometry-per-zoom-level
type: article
breadcrumb: "Per-Zoom Simplification"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Simplifying OSM Geometry per Zoom Level

Replace one hand-picked tolerance with a number derived from the tile grid at each zoom — and stop adjacent polygons drifting apart along boundaries they were supposed to share.

## Prerequisites

- [ ] Python 3.10+ with `shapely` ≥ 2.0; `geopandas` if your features arrive as a frame.
- [ ] The grid arithmetic from [The Mapbox Vector Tile Spec & Tile Geometry](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/).
- [ ] Features already validated, per [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/) — simplifying invalid geometry produces worse invalid geometry.
- [ ] The zoom range the tile set will cover.
- [ ] A polygon coverage with shared boundaries to test the topological path against.

## Conceptual minimum

Two facts drive everything here.

**Geometry is quantised anyway.** Encoding rounds every coordinate onto a grid of \\(E\\) units across the tile, so detail finer than one grid unit cannot survive. A tolerance below that is pure waste: it costs processing time and removes nothing the encoder would not have removed.

**Tolerance must vary with zoom.** One grid unit at zoom 14 is well under a metre; at zoom 6 it is hundreds of metres. A single tolerance expressed in metres either does nothing at low zoom or destroys geometry at high zoom.

The third fact is topological rather than arithmetic. Douglas-Peucker on two polygons that share a boundary simplifies that boundary twice, independently, and the two results differ — leaving slivers and gaps along every shared edge. The fix is to simplify the *edges*, once each, and rebuild the polygons from them.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="sgz1-t sgz1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sgz1-t">Two simplification paths and where they diverge</title>
  <desc id="sgz1-d">Four stages. Both paths start from validated input features. The independent path simplifies each polygon on its own, which is fast and correct for isolated features but produces slivers wherever two polygons shared a boundary. The topological path first decomposes the coverage into unique shared edges, simplifies each edge exactly once, then rebuilds every polygon from its simplified edges so adjacent areas continue to match exactly. Both paths end by validating the result and falling back to the original where simplification produced invalid geometry.</desc>
  <defs><marker id="sgz1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Isolated features one way, coverages the other</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">validate in</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">reject broken input</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">simplify makes it worse</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#sgz1-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">choose a path</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">isolated or coverage</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">adjacency decides</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#sgz1-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">simplify</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">per feature or per edge</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">once each, either way</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#sgz1-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">validate out</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">fall back if invalid</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">keep the original</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The second step is the whole decision: running the fast path on a coverage is what puts gaps between every pair of adjacent areas.</text>
</svg>
<figcaption>Both paths are correct for their own input, and neither is correct for the other's.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
from dataclasses import dataclass

from shapely.geometry import LineString, MultiLineString, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import linemerge, polygonize, unary_union

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.tiles.simplify")

EARTH_CIRCUMFERENCE = 40_075_016.686
EXTENT = 4096


@dataclass(frozen=True)
class ZoomTolerance:
    zoom: int
    grid_units: float = 2.0     # 1 removes only invisible detail; 2-4 is a base map

    def metres(self, latitude_deg: float = 0.0) -> float:
        """Ground size of `grid_units` grid units at this zoom and latitude."""
        import math
        unit = EARTH_CIRCUMFERENCE / (2 ** self.zoom) / EXTENT
        return self.grid_units * unit * math.cos(math.radians(latitude_deg))

    def degrees(self, latitude_deg: float = 0.0) -> float:
        """The same tolerance expressed in degrees, for geographic geometry."""
        return self.metres(latitude_deg) / (EARTH_CIRCUMFERENCE / 360.0)


def simplify_isolated(geom: BaseGeometry, tolerance: float) -> BaseGeometry:
    """Simplify one feature, falling back to the original if it breaks."""
    reduced = geom.simplify(tolerance, preserve_topology=True)
    if reduced.is_empty or not reduced.is_valid:
        logger.warning("simplification produced invalid geometry; keeping original")
        return geom
    # A polygon reduced below three distinct vertices is no longer an area.
    if geom.geom_type == "Polygon" and len(reduced.exterior.coords) < 4:
        logger.warning("polygon collapsed at tolerance %.6f; keeping original",
                       tolerance)
        return geom
    return reduced


def simplify_coverage(polygons: list[Polygon], tolerance: float) -> list[Polygon]:
    """Simplify a set of adjacent polygons without opening gaps between them.

    Each boundary shared by two polygons is simplified EXACTLY ONCE, so both
    sides continue to match; simplifying the polygons independently would
    reduce the shared edge twice, differently, leaving slivers.
    """
    # 1. Reduce the coverage to its unique edges.
    boundaries = unary_union([p.boundary for p in polygons])
    merged = linemerge(boundaries) if boundaries.geom_type != "LineString" \
        else boundaries
    edges = list(merged.geoms) if isinstance(merged, MultiLineString) else [merged]
    logger.info("coverage of %d polygon(s) decomposed into %d edge(s)",
                len(polygons), len(edges))

    # 2. Simplify each edge once.
    reduced_edges: list[LineString] = []
    for edge in edges:
        reduced = edge.simplify(tolerance, preserve_topology=True)
        reduced_edges.append(reduced if reduced.is_valid and not reduced.is_empty
                             else edge)

    # 3. Rebuild areas from the simplified edge network.
    rebuilt = list(polygonize(unary_union(reduced_edges)))
    logger.info("rebuilt %d polygon(s) from simplified edges", len(rebuilt))
    if len(rebuilt) < len(polygons) * 0.9:
        logger.warning("rebuild lost %d polygon(s) — tolerance may be too coarse",
                       len(polygons) - len(rebuilt))
    return rebuilt


def tolerance_table(min_zoom: int, max_zoom: int,
                    latitude_deg: float = 50.0) -> dict[int, float]:
    table = {}
    for z in range(min_zoom, max_zoom + 1):
        t = ZoomTolerance(z)
        table[z] = t.degrees(latitude_deg)
        logger.info("zoom %2d: %8.2f m  (%.7f deg)", z, t.metres(latitude_deg),
                    table[z])
    return table


if __name__ == "__main__":
    tolerance_table(4, 14)
```

## Step-by-step walkthrough

1. **Derive from the grid, not from taste.** `ZoomTolerance` computes the ground size of a grid unit at a zoom and multiplies by a small factor. Two units is a reasonable base-map default; one removes only what the encoder would have removed anyway.
2. **Adjust for latitude.** The grid is finer away from the equator by the cosine of the latitude. Using the equatorial figure over-simplifies a Nordic map by a factor of two or more.
3. **Preserve topology.** Shapely's topology-preserving mode avoids producing self-intersections in most cases, at a modest cost. It is not a guarantee, which is why the validity check follows.
4. **Fall back rather than repair.** If simplification produces something invalid or empty, keeping the original geometry is strictly better than shipping a broken one or attempting an automatic repair whose effect nobody reviewed.
5. **Guard against collapse.** A polygon reduced to fewer than three distinct vertices no longer bounds an area; catching that explicitly avoids a confusing empty feature downstream.
6. **Decompose coverages into edges.** Taking the union of all boundaries and merging the result yields each shared edge once, which is what makes the topological path work.
7. **Rebuild by polygonizing.** Reassembling areas from the simplified edge network guarantees adjacent polygons still share their boundaries exactly.
8. **Check the rebuild count.** Losing polygons during the rebuild means the tolerance closed a narrow area entirely; the warning names it rather than leaving a silent gap in the map.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 328" role="img" aria-labelledby="sgz2-t sgz2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sgz2-t">Ground size of the simplification tolerance at each zoom, at fifty degrees latitude</title>
  <desc id="sgz2-d">Six zoom levels with the tolerance in metres that two tile grid units corresponds to at fifty degrees north. At zoom four the tolerance is roughly seven hundred and seventy metres. At zoom six it is about one hundred and ninety metres. At zoom eight it is about forty eight metres. At zoom ten it is about twelve metres. At zoom twelve it is about three metres. At zoom fourteen it is under one metre. A note observes that the same factor at the equator would be about fifty percent larger.</desc>
  <rect x="0" y="0" width="880" height="328" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Two grid units, expressed in metres, by zoom</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">zoom 4</text>
  <rect x="206" y="60" width="528" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 770 m</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">zoom 6</text>
  <rect x="206" y="100" width="132" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 193 m</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">zoom 8</text>
  <rect x="206" y="140" width="33" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 48 m</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">zoom 10</text>
  <rect x="206" y="180" width="8" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 12 m</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">zoom 12</text>
  <rect x="206" y="220" width="6" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 3 m</text>
  <text x="26" y="274" font-size="11.5" font-weight="600" fill="currentColor">zoom 14</text>
  <rect x="206" y="260" width="6" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="274" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 0.8 m</text>
  <text x="868" y="312" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">At the equator each figure is roughly fifty percent larger, which is why latitude belongs in the derivation rather than in a comment.</text>
</svg>
<figcaption>A single tolerance in metres would be invisible at the top of this table and destructive at the bottom.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 239" role="img" aria-labelledby="sgz3-t sgz3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sgz3-t">Three ways simplification damages geometry and what each looks like on the map</title>
  <desc id="sgz3-d">Three panels. A sliver appears where two polygons that shared a boundary were simplified independently, leaving a thin wedge of unclaimed space visible as a hairline of background colour. A self-intersection appears where a narrow neck collapsed, producing a bowtie that renders unpredictably and fails validity checks. A collapse appears where a small feature was reduced below three distinct vertices, so the area vanishes entirely and nothing marks its absence.</desc>
  <rect x="0" y="0" width="880" height="239" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three damage modes, only one of them errors</text>
  <rect x="26" y="52" width="259" height="153" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Sliver</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Between two adjacent areas</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Shared edge reduced twice</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Hairline of background shows</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Validity check passes</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Fix: simplify edges once</text>
  <rect x="311" y="52" width="259" height="153" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Self-intersection</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">A narrow neck collapsed</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Ring crosses itself</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Renders unpredictably</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Validity check catches it</text>
  <text x="325" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Fix: validate, fall back</text>
  <rect x="595" y="52" width="259" height="153" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Collapse</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Feature below three vertices</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Area becomes nothing</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Silently absent from the map</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">No check catches it alone</text>
  <text x="609" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Fix: guard on vertex count</text>
  <text x="868" y="223" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the middle panel is caught by a validity check, which is why the other two need their own explicit guards.</text>
</svg>
<figcaption>A simplification pass that only checks validity ships the first and third of these into production.</figcaption>
</figure>

## Verification

- **Adjacent polygons still share boundaries.** Union two neighbours after simplification; the result must have no interior gap.
- **No geometry became invalid.** Run a validity check over the simplified set; the count of fallbacks should be small and explainable.
- **The polygon count survives.** A coverage rebuild that returns noticeably fewer polygons has closed small areas entirely.
- **Vertex reduction is substantial.** Compare total vertex counts before and after; at low zoom a reduction of ninety percent or more is normal.
- **Visual shape survives.** Overlay simplified and original geometry at the target zoom; the difference should be invisible at that scale and obvious at full zoom.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Slivers between adjacent areas | Polygons simplified independently | Decompose into shared edges and simplify each once |
| Self-intersections after simplifying | Topology preservation disabled | Enable topology preservation and validate afterwards |
| Small areas disappear | Tolerance exceeds the feature's size | Guard on vertex count and fall back to the original |
| No visible reduction | Tolerance far below the grid unit | Derive tolerance from the grid at the target zoom |
| High-zoom geometry destroyed | One tolerance used at every zoom | Compute a tolerance per zoom level |
| Nordic maps over-simplified | Equatorial grid size assumed | Scale the tolerance by the cosine of the latitude |
| Rebuild returns fewer polygons | Narrow areas closed by simplification | Lower the tolerance, or exclude small features from it |

## Specification reference

> The Douglas-Peucker algorithm reduces a polyline to a subset of its vertices such that no removed vertex lies further than a given tolerance from the retained line. Shapely's `simplify` implements it, and its topology-preserving mode avoids producing self-intersections in the simplified result, though it does not guarantee validity for all inputs. See the [Shapely documentation](https://shapely.readthedocs.io/) for `simplify`, `linemerge` and `polygonize`, which together implement the topological path used here.

## Frequently Asked Questions

<details>
<summary>Why do gaps appear between areas that used to touch?</summary>

Because each polygon was simplified on its own, so the boundary they shared was reduced twice and the two results differ. The only reliable fix is topological: reduce the coverage to its unique edges, simplify each edge exactly once, and rebuild the polygons from the simplified network. Any per-feature approach, however careful, produces slivers along every shared boundary.
</details>

<details>
<summary>How do I choose the tolerance factor?</summary>

Start from the tile grid unit at the target zoom and multiply by a small factor. One unit removes only detail the encoder would have quantised away, which is free but not much of a reduction. Two to four units is the usual base-map range: real detail disappears while shapes stay recognisable. Beyond about eight units corner-cutting on curves becomes obvious, and a reader will notice that coastlines have gone polygonal.
</details>

<details>
<summary>Should I simplify before or after projecting?</summary>

Either works provided the tolerance is expressed in the same units as the geometry, but deriving the tolerance from the tile grid is easier in projected space, because the grid is defined there. If you simplify in geographic degrees, convert the grid-derived metric tolerance to degrees using the latitude of the data, not a global constant — a degree of longitude at sixty degrees north is half its equatorial length.
</details>

<details>
<summary>What should happen when simplification breaks a polygon?</summary>

Keep the original. An automatic repair changes the geometry in a way nobody reviewed, and shipping an invalid polygon produces unpredictable rendering. Falling back preserves correctness at the cost of a slightly larger tile, and counting the fallbacks gives you a signal: a handful is normal, a large number means the tolerance is too coarse for that feature class.
</details>

## Related

- [Cartographic Generalization of OSM Data](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/) — the parent topic and the other four operators.
- [Merging Adjacent OSM Polygons for Low Zoom](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/merging-adjacent-osm-polygons-for-low-zoom/) — the aggregation that usually follows simplification.
- [The Mapbox Vector Tile Spec & Tile Geometry](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/) — the grid the tolerance is derived from.
- [Detecting Self-Intersecting OSM Polygons with Shapely](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/detecting-self-intersecting-osm-polygons-with-shapely/) — the validity check applied after simplifying.
- [Measuring Area Accurately on OSM Polygons](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/measuring-area-accurately-on-osm-polygons/) — why latitude belongs in every metric derivation.

Up one level: [Cartographic Generalization of OSM Data](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Simplifying OSM Geometry per Zoom Level",
  "description": "Derive a simplification tolerance from the tile grid at each zoom, simplify shared boundaries once so adjacent areas stay stitched, and validate the result before it reaches an encoder.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Vector Tiles & Rendering Pipelines",
  "about": ["Douglas-Peucker simplification", "topological simplification", "zoom-dependent tolerance"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Vector Tiles & Rendering Pipelines", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/" },
    { "@type": "ListItem", "position": 3, "name": "Cartographic Generalization of OSM Data", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/" },
    { "@type": "ListItem", "position": 4, "name": "Simplifying OSM Geometry per Zoom Level", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/simplifying-osm-geometry-per-zoom-level/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Simplify OSM geometry per zoom level without opening gaps",
  "description": "Derive a tolerance from the tile grid unit at each zoom and latitude, choose an isolated or topological path by whether features share boundaries, simplify once per edge, and fall back on invalidity.",
  "step": [
    { "@type": "HowToStep", "name": "Derive the tolerance", "text": "Compute the ground size of one tile grid unit at the target zoom and multiply by a small factor, scaling for latitude." },
    { "@type": "HowToStep", "name": "Choose the path", "text": "Use per-feature simplification for isolated geometry and the topological path for any coverage with shared boundaries." },
    { "@type": "HowToStep", "name": "Decompose into edges", "text": "Union and merge the coverage's boundaries so each shared edge appears exactly once." },
    { "@type": "HowToStep", "name": "Simplify each edge once", "text": "Reduce each unique edge with topology preservation, keeping the original where the result is invalid." },
    { "@type": "HowToStep", "name": "Rebuild the areas", "text": "Polygonize the simplified edge network so adjacent polygons continue to match exactly." },
    { "@type": "HowToStep", "name": "Validate and fall back", "text": "Check validity and vertex counts, keeping the original geometry wherever simplification broke or collapsed a feature." }
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
      "name": "Why do gaps appear between OSM areas that used to touch?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because each polygon was simplified on its own, so the boundary they shared was reduced twice and the two results differ. The only reliable fix is topological: reduce the coverage to its unique edges, simplify each edge exactly once, and rebuild the polygons from the simplified network." }
    },
    {
      "@type": "Question",
      "name": "How do I choose a simplification tolerance factor?",
      "acceptedAnswer": { "@type": "Answer", "text": "Start from the tile grid unit at the target zoom and multiply by a small factor. One unit removes only detail the encoder would have quantised away. Two to four units is the usual base-map range: real detail disappears while shapes stay recognisable. Beyond about eight units corner-cutting on curves becomes obvious." }
    },
    {
      "@type": "Question",
      "name": "Should I simplify OSM geometry before or after projecting?",
      "acceptedAnswer": { "@type": "Answer", "text": "Either works provided the tolerance is expressed in the same units as the geometry, but deriving the tolerance from the tile grid is easier in projected space. If you simplify in geographic degrees, convert the grid-derived metric tolerance using the latitude of the data rather than a global constant." }
    },
    {
      "@type": "Question",
      "name": "What should happen when simplification breaks a polygon?",
      "acceptedAnswer": { "@type": "Answer", "text": "Keep the original. An automatic repair changes the geometry in a way nobody reviewed, and shipping an invalid polygon produces unpredictable rendering. Falling back preserves correctness at the cost of a slightly larger tile, and counting the fallbacks gives you a signal about whether the tolerance is too coarse." }
    }
  ]
}
</script>
