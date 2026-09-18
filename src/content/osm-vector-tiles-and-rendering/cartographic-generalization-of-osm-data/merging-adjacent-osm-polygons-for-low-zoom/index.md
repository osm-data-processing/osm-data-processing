---
title: "Merging Adjacent OSM Polygons for Low Zoom"
description: "Class-aware aggregation of touching OSM areas into single low-zoom features, with a gap tolerance, a minimum output size, and attributes recomputed rather than inherited."
pageTitle: "Aggregate Adjacent OSM Areas into Low-Zoom Features"
pageDescription: "Merge touching OSM polygons of the same class into one low-zoom area using a buffer-based gap tolerance, drop results below a minimum size, and recompute attributes from the members."
slug: merging-adjacent-osm-polygons-for-low-zoom
type: article
breadcrumb: "Merging Adjacent Areas"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Merging Adjacent OSM Polygons for Low Zoom

Turn ten thousand individual residential parcels into forty built-up areas a reader can actually see, without merging a park into a car park or inventing an area that spans a river.

## Prerequisites

- [ ] Python 3.10+ with `shapely` ≥ 2.0 and `geopandas` ≥ 0.14.
- [ ] A validated polygon layer with a class attribute — the classification from [Mapping OSM Tags to a Fixed Schema with YAML](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/mapping-osm-tags-to-a-fixed-schema-with-yaml/) is the usual source.
- [ ] A target zoom, since both the gap tolerance and the minimum output size derive from it.
- [ ] The operator taxonomy from [Cartographic Generalization of OSM Data](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/).
- [ ] An agreed rule about which classes may merge with which — this is a cartographic decision, not a technical one.

## Conceptual minimum

Aggregation replaces several source features with one output feature that never existed in the data. That is a bigger step than simplification, and it needs three decisions made explicitly.

**What may merge.** Adjacency alone is not a reason to merge: a park touching an industrial estate is two things, and merging them produces an area that is neither. Grouping must be by class, with the permitted classes named rather than inferred.

**How close counts as adjacent.** Polygons in OSM rarely share exact boundaries; a road, a hedge or a sliver of unclassified land usually sits between them. A gap tolerance — buffer outwards, union, buffer back — bridges those gaps. The tolerance must come from the target zoom: at zoom 8 a twenty-metre gap is invisible and should be bridged; at zoom 14 it is a street and must not be.

**What the result is worth keeping.** A merged area smaller than a few pixels at the target zoom contributes nothing but bytes. A minimum-area threshold derived from the same zoom removes them.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="map1-t map1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="map1-t">The buffer, union, unbuffer sequence and what each step does</title>
  <desc id="map1-d">Four steps. The group step partitions features by class so only compatible areas can merge. The buffer step grows each polygon outwards by half the gap tolerance, closing the small gaps between neighbours that a road or hedge creates. The union step dissolves the overlapping buffered shapes into connected components. The unbuffer step shrinks the result back by the same distance, restoring approximately the original outline while keeping the members joined.</desc>
  <defs><marker id="map1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Grow, dissolve, shrink — grouped by class</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">group</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">partition by class</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">never merge across</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#map1-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">buffer out</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">half the gap tolerance</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">closes small gaps</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#map1-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">union</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">dissolve overlaps</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">connected components</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#map1-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">buffer in</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">same distance back</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">outline restored</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Buffering half the tolerance each way leaves the outline almost unchanged while gaps up to the full tolerance still close.</text>
</svg>
<figcaption>The symmetry of the two buffers is what keeps the merged outline honest rather than inflated.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import math
from dataclasses import dataclass

import geopandas as gpd
from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import unary_union

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.tiles.aggregate")

EARTH_CIRCUMFERENCE = 40_075_016.686
EXTENT = 4096
TILE_PIXELS = 512

# Which classes may merge with which. Anything absent merges only with itself.
MERGE_GROUPS: dict[str, str] = {
    "residential": "built_up", "retail": "built_up", "commercial": "built_up",
    "industrial": "industrial",
    "forest": "green", "wood": "green", "meadow": "green", "grass": "green",
    "park": "park",            # deliberately its own group: parks are not "green"
}


@dataclass(frozen=True)
class ZoomBudget:
    zoom: int

    def metres_per_pixel(self, latitude_deg: float = 50.0) -> float:
        tile_m = EARTH_CIRCUMFERENCE / (2 ** self.zoom)
        return tile_m / TILE_PIXELS * math.cos(math.radians(latitude_deg))

    def gap_tolerance_m(self) -> float:
        """Gaps narrower than about three pixels are invisible; bridge them."""
        return 3.0 * self.metres_per_pixel()

    def min_area_m2(self) -> float:
        """Areas smaller than about four pixels square are not worth a feature."""
        return (4.0 * self.metres_per_pixel()) ** 2


def aggregate(frame: gpd.GeoDataFrame, zoom: int,
              class_column: str = "class") -> gpd.GeoDataFrame:
    """Merge touching same-group polygons into low-zoom areas.

    `frame` must be in a metric projection: buffering in degrees is meaningless
    because a degree of longitude varies with latitude.
    """
    if frame.crs is None or frame.crs.is_geographic:
        raise ValueError("reproject to a metric CRS before aggregating")

    budget = ZoomBudget(zoom)
    gap = budget.gap_tolerance_m()
    floor = budget.min_area_m2()
    logger.info("zoom %d: bridging gaps under %.0f m, dropping areas under %.0f m2",
                zoom, gap, floor)

    frame = frame.copy()
    frame["_group"] = frame[class_column].map(MERGE_GROUPS).fillna(
        frame[class_column])

    rows: list[dict] = []
    for group, members in frame.groupby("_group"):
        # Grow, dissolve, shrink: half the tolerance each way keeps the outline honest.
        grown = [g.buffer(gap / 2.0, join_style=2) for g in members.geometry]
        dissolved = unary_union(grown).buffer(-gap / 2.0, join_style=2)
        parts = (list(dissolved.geoms)
                 if isinstance(dissolved, MultiPolygon) else [dissolved])

        kept = 0
        for part in parts:
            if part.is_empty or part.area < floor:
                continue
            # Attributes are RECOMPUTED from the members, never inherited from one.
            inside = members[members.geometry.intersects(part)]
            rows.append({
                "class": group,
                "member_count": int(len(inside)),
                "source_area_m2": float(inside.geometry.area.sum()),
                "merged_area_m2": float(part.area),
                "geometry": part,
            })
            kept += 1
        logger.info("group %-12s %5d member(s) -> %3d merged area(s)",
                    group, len(members), kept)

    out = gpd.GeoDataFrame(rows, geometry="geometry", crs=frame.crs)
    if not out.empty:
        inflation = out["merged_area_m2"].sum() / out["source_area_m2"].sum()
        logger.info("merged area is %.2fx the source area", inflation)
        if inflation > 1.35:
            logger.warning("aggregation inflated area by more than 35%% — the gap "
                           "tolerance is probably too large for this zoom")
    return out


if __name__ == "__main__":
    logger.info("reproject to a metric CRS, then call aggregate(frame, zoom=8)")
```

## Step-by-step walkthrough

1. **Refuse geographic coordinates.** Buffering by a distance requires a metric projection; buffering degrees produces a shape that is wrong by the cosine of the latitude and silently so.
2. **Map classes to merge groups.** The table is explicit, and a class not in it merges only with itself. Putting parks in their own group rather than lumping them with generic green space is the kind of decision that has to be visible.
3. **Derive both thresholds from the zoom.** Gap tolerance is a few screen pixels' worth of ground distance; minimum area is a small number of pixels squared. Both then scale correctly across the zoom range without a second table.
4. **Buffer by half in each direction.** Growing by half the tolerance and shrinking by the same amount closes gaps up to the full tolerance while leaving the outer boundary approximately where it started.
5. **Use a mitre join.** A round join adds vertices at every corner; a mitre join keeps the merged outline closer to the source shapes and produces far less geometry.
6. **Recompute attributes from members.** The merged feature carries a member count and the summed source area, which are meaningful. Inheriting the name or identifier of an arbitrary member is not.
7. **Drop results below the floor.** An area under a few pixels square at the target zoom costs bytes and contributes nothing.
8. **Watch the inflation ratio.** Merged area meaningfully larger than the sum of source areas means the buffer is bridging gaps that are real features, which is the characteristic failure of a tolerance set too high.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="map2-t map2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="map2-t">How the gap tolerance and minimum area change across zoom levels</title>
  <desc id="map2-d">A grid of four zoom levels against three derived quantities. At zoom six the ground size of one screen pixel is about a kilometre and a half, the gap tolerance is several kilometres and the minimum area covers tens of square kilometres. At zoom eight those fall to about four hundred metres, a kilometre and several square kilometres. At zoom ten they fall to about a hundred metres, three hundred metres and under a square kilometre. At zoom twelve they fall to about twenty five metres, eighty metres and a few hectares.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Both thresholds derive from one number: metres per pixel</text>
  <rect x="196" y="48" width="219" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="306" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">m per pixel</text>
  <rect x="415" y="48" width="219" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="525" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Gap bridged</text>
  <rect x="635" y="48" width="219" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="744" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Minimum area</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">zoom 6</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">about 1,500 m</text>
  <text x="525" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">about 4,500 m</text>
  <text x="744" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">about 36 km2</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">zoom 8</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">about 390 m</text>
  <text x="525" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">about 1,170 m</text>
  <text x="744" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">about 2.4 km2</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">zoom 10</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">about 98 m</text>
  <text x="525" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">about 294 m</text>
  <text x="744" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">about 0.15 km2</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">zoom 12</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">about 24 m</text>
  <text x="525" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">about 73 m</text>
  <text x="744" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">about 1 hectare</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">At zoom 12 the bridged gap is about the width of a wide street, which is the point at which aggregation should stop being applied at all.</text>
</svg>
<figcaption>Reading down the middle column shows exactly which real features each zoom is willing to ignore.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 248" role="img" aria-labelledby="map3-t map3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="map3-t">Feature and vertex reduction from aggregating a country land-use layer at zoom eight</title>
  <desc id="map3-d">Four measurements before and after aggregation for a country-sized land-use layer at zoom eight. The source layer holds several hundred thousand polygons. After grouping and merging, a few thousand areas remain. Source vertex count is in the tens of millions. Merged vertex count is in the hundreds of thousands, a reduction of roughly two orders of magnitude, because shared interior boundaries between merged members disappear entirely.</desc>
  <rect x="0" y="0" width="880" height="248" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Two orders of magnitude, mostly from vanished interior edges</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Source polygons</text>
  <rect x="256" y="60" width="112" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 420,000</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Merged areas</text>
  <rect x="256" y="100" width="6" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 5,000</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Source vertices</text>
  <rect x="256" y="140" width="478" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 18 million</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Merged vertices</text>
  <rect x="256" y="180" width="6" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 220,000</text>
  <text x="868" y="232" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Most of the saving is interior boundaries between merged members, which existed only to separate parcels a reader cannot distinguish.</text>
</svg>
<figcaption>Aggregation beats selection here because the removed geometry was never conveying anything at this zoom.</figcaption>
</figure>

## Verification

- **No cross-class merges.** Group the output by class and confirm every merged area's members share one group.
- **Inflation is modest.** Merged area should be within roughly a third of the summed source area; more means the tolerance is bridging real gaps.
- **Rivers and motorways still separate areas.** Pick a built-up area split by a river and confirm the merge did not jump it.
- **Member counts are plausible.** A merged area with one member is not an aggregation; a very large count at high zoom suggests the tolerance is too coarse.
- **The output is materially smaller.** Vertex and feature counts should fall by an order of magnitude at low zoom; if they do not, aggregation is not earning its cost.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| A park merged into an industrial area | Grouped on adjacency, not class | Map classes to explicit merge groups |
| Merged areas span rivers | Gap tolerance larger than the river | Derive the tolerance from metres per pixel at the zoom |
| Outlines visibly inflated | Buffer applied outwards only | Buffer out and back by the same distance |
| Enormous vertex counts | Round join style on every corner | Use a mitre join for the buffer operations |
| Results wrong by a latitude factor | Buffered in geographic degrees | Reproject to a metric CRS before buffering |
| Merged feature carries a random name | Attributes inherited from one member | Recompute attributes from all members |
| Tiny slivers in the output | No minimum-area threshold | Drop results below a few pixels squared |

## Specification reference

> A buffer operation offsets a geometry by a fixed distance, and a positive buffer followed by a negative buffer of the same magnitude — a morphological closing — joins shapes separated by less than twice that distance while approximately restoring the original outline. Shapely implements both through `buffer`, with the join style controlling corner treatment. See the [Shapely documentation](https://shapely.readthedocs.io/) for `buffer`, `unary_union` and the join-style options used here.

## Frequently Asked Questions

<details>
<summary>Why merge by class rather than by adjacency alone?</summary>

Because an area that is part park and part industrial estate describes nothing. Adjacency tells you two polygons touch; it says nothing about whether the thing they would become is a thing. Grouping by an explicit class map keeps merged areas meaningful and, just as importantly, makes the cartographic decision visible in one table a colleague can review rather than implicit in the geometry code.
</details>

<details>
<summary>How do I choose the gap tolerance?</summary>

Derive it from metres per pixel at the target zoom. A gap of a few pixels is invisible to a reader and should be bridged; a gap of many pixels is a real feature — a river, a motorway, a railway corridor — and must not be. Because metres per pixel changes by a factor of two per zoom level, one derived formula covers the whole range while a hand-picked distance is right at exactly one zoom.
</details>

<details>
<summary>Why buffer outwards and then inwards instead of just buffering out?</summary>

Because buffering outwards alone inflates every outline by the tolerance, so a merged built-up area spills across its real boundary by the same distance it used to bridge gaps. Applying the inverse buffer afterwards restores the outline to approximately where it began while leaving the members joined, which is the whole point of the closing operation.
</details>

<details>
<summary>What attributes should a merged feature carry?</summary>

Ones computed from the members: the class, how many members were merged, and the summed source area alongside the merged area. Those are meaningful and they support the verification. What it must not carry is a name or identifier taken from one arbitrary member, which implies the merged area is that feature when it is a new object representing many.
</details>

## Related

- [Cartographic Generalization of OSM Data](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/) — the parent topic and where aggregation sits among the operators.
- [Simplifying OSM Geometry per Zoom Level](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/simplifying-osm-geometry-per-zoom-level/) — the step that usually precedes aggregation.
- [Snapping Near-Duplicate OSM Nodes with a Tolerance](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/snapping-near-duplicate-osm-nodes-with-a-tolerance/) — the same tolerance-choosing discipline at vertex level.
- [Measuring Area Accurately on OSM Polygons](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/measuring-area-accurately-on-osm-polygons/) — why the metric projection matters before buffering.
- [Mapping OSM Tags to a Fixed Schema with YAML](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/mapping-osm-tags-to-a-fixed-schema-with-yaml/) — producing the class attribute the merge groups key on.

Up one level: [Cartographic Generalization of OSM Data](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Merging Adjacent OSM Polygons for Low Zoom",
  "description": "Class-aware aggregation of touching OSM areas into single low-zoom features, with a gap tolerance, a minimum output size, and attributes recomputed rather than inherited.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Vector Tiles & Rendering Pipelines",
  "about": ["polygon aggregation", "morphological closing", "low-zoom legibility"]
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
    { "@type": "ListItem", "position": 4, "name": "Merging Adjacent OSM Polygons for Low Zoom", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/merging-adjacent-osm-polygons-for-low-zoom/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Aggregate adjacent OSM polygons for a low-zoom map",
  "description": "Reproject to metric coordinates, group features by an explicit class map, close gaps with a symmetric buffer derived from metres per pixel, drop sub-threshold results, and recompute attributes from members.",
  "step": [
    { "@type": "HowToStep", "name": "Reproject to metric coordinates", "text": "Refuse to buffer geographic degrees, since a degree of longitude varies with latitude and the result would be silently wrong." },
    { "@type": "HowToStep", "name": "Group by an explicit class map", "text": "Assign each class to a named merge group so only compatible areas can combine, and leave unlisted classes merging only with themselves." },
    { "@type": "HowToStep", "name": "Derive both thresholds from the zoom", "text": "Compute the gap tolerance and the minimum output area from metres per pixel at the target zoom." },
    { "@type": "HowToStep", "name": "Close the gaps symmetrically", "text": "Buffer outwards by half the tolerance, dissolve, then buffer inwards by the same amount using a mitre join." },
    { "@type": "HowToStep", "name": "Drop sub-threshold parts", "text": "Discard merged areas smaller than a few pixels squared at the target zoom." },
    { "@type": "HowToStep", "name": "Recompute attributes", "text": "Carry a member count and summed source area rather than inheriting a name or identifier from one member." },
    { "@type": "HowToStep", "name": "Check the inflation ratio", "text": "Compare merged area against summed source area and treat a large excess as a tolerance set too high." }
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
      "name": "Why merge OSM polygons by class rather than by adjacency alone?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because an area that is part park and part industrial estate describes nothing. Adjacency tells you two polygons touch; it says nothing about whether the thing they would become is a thing. Grouping by an explicit class map keeps merged areas meaningful and makes the cartographic decision visible in one reviewable table." }
    },
    {
      "@type": "Question",
      "name": "How do I choose the gap tolerance for aggregation?",
      "acceptedAnswer": { "@type": "Answer", "text": "Derive it from metres per pixel at the target zoom. A gap of a few pixels is invisible to a reader and should be bridged; a gap of many pixels is a real feature such as a river or motorway and must not be. Because metres per pixel changes by a factor of two per zoom level, one derived formula covers the whole range." }
    },
    {
      "@type": "Question",
      "name": "Why buffer outwards and then inwards instead of just buffering out?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because buffering outwards alone inflates every outline by the tolerance, so a merged built-up area spills across its real boundary by the same distance it used to bridge gaps. Applying the inverse buffer afterwards restores the outline to approximately where it began while leaving the members joined." }
    },
    {
      "@type": "Question",
      "name": "What attributes should a merged polygon carry?",
      "acceptedAnswer": { "@type": "Answer", "text": "Ones computed from the members: the class, how many members were merged, and the summed source area alongside the merged area. What it must not carry is a name or identifier taken from one arbitrary member, which implies the merged area is that feature when it is a new object representing many." }
    }
  ]
}
</script>
