---
title: "Joining OSM Roads to a Speed Limit Reference"
description: "Attach a linearly referenced road attribute to OSM ways whose segmentation does not match: project onto a shared network, transfer by overlap length, and record the coverage per way."
pageTitle: "Attach a Linear Road Attribute to OSM Ways"
pageDescription: "Transfer speed limits from a reference road network onto OSM ways with different segmentation, using buffered overlap, bearing agreement and length-weighted assignment with explicit coverage."
slug: joining-osm-roads-to-a-speed-limit-reference
type: article
breadcrumb: "Speed Limit Reference"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Joining OSM Roads to a Speed Limit Reference

Road attributes do not transfer between networks the way point attributes do: the two datasets cut their roads at different places, so a single OSM way may overlap four reference segments carrying three different values.

## Prerequisites

- [ ] An OSM road layer and a reference network, both as line geometry with a declared CRS.
- [ ] Python 3.10+ with `geopandas` ≥ 0.14 and `shapely` ≥ 2.0.
- [ ] A metric projection for the area, per [Picking a UTM Zone for an OSM Extract](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/picking-a-utm-zone-for-an-osm-extract/).
- [ ] The namespace and precedence discipline from [Attribute Enrichment from Authoritative Sources](https://www.osm-data-processing.org/osm-conflation-and-enrichment/attribute-enrichment-from-authoritative-sources/).
- [ ] The unit conventions from [Normalizing OSM Speed Limits and Units](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/normalizing-osm-speed-limits-and-units/), since the reference will use its own.

## Conceptual minimum

Linear conflation differs from point conflation in one structural way: **the unit of the match is a stretch of road, not an object**. Three consequences follow.

**Segmentation never agrees.** OSM splits ways at junctions, at tagging changes and at the whim of whoever drew them; a reference network splits at its own administrative boundaries. One OSM way commonly spans several reference segments and vice versa.

**Proximity is not enough.** Two roads running parallel twenty metres apart — a carriageway and its service road, a road and a parallel cycleway — are near each other everywhere along their length. Distance alone matches them confidently and wrongly. **Bearing agreement** is the signal that separates them, and it is cheap.

**The answer may be partial.** If sixty percent of an OSM way overlaps reference segments saying 50 and forty percent says 30, there is no single correct value. The honest output is the dominant value *plus the coverage and the agreement*, so a consumer can decide whether to use it.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="jsl1-t jsl1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="jsl1-t">How a linear attribute moves from one network to another</title>
  <desc id="jsl1-d">Four steps. The buffer step grows each OSM way slightly and intersects it with the reference network to find segments running alongside it. The bearing step discards overlaps whose direction differs beyond a tolerance, which is what separates a road from the parallel cycleway beside it. The measure step computes the overlapping length for each surviving reference segment. The assign step takes the value covering the greatest length, and reports both the coverage fraction and whether the overlapping segments agreed.</desc>
  <defs><marker id="jsl1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Overlap, filter by bearing, weight by length</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">buffer</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">grow and intersect</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">finds parallel too</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#jsl1-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">bearing</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">discard wrong direction</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">removes the cycleway</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#jsl1-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">measure</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">overlap length each</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">the weighting</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#jsl1-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">assign</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">dominant value</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">plus coverage</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Skipping the bearing filter is how a motorway ends up carrying the speed limit of the footpath running beside it.</text>
</svg>
<figcaption>The last step deliberately returns three things, because a value without its coverage is not interpretable.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import math
from collections import defaultdict
from dataclasses import dataclass

import geopandas as gpd
from shapely.geometry import LineString

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.enrich.linear")

BUFFER_M = 12.0          # half a carriageway plus positional error
BEARING_TOLERANCE = 25.0  # degrees; roads are directional, parallel ones are not
MIN_COVERAGE = 0.6        # below this, report but do not assign


@dataclass(frozen=True)
class Transfer:
    osm_key: str
    value: str | None
    coverage: float        # fraction of the way length covered by agreeing refs
    agreement: float       # fraction of covered length carrying the chosen value
    sources: int


def bearing(line: LineString) -> float:
    """Overall direction of a line in degrees, folded to 0..180.

    Folding removes direction-of-travel: a way drawn the other way round is
    the same road, and we are matching geometry rather than heading.
    """
    (x1, y1), (x2, y2) = line.coords[0], line.coords[-1]
    angle = math.degrees(math.atan2(y2 - y1, x2 - x1))
    return angle % 180.0


def bearing_delta(a: float, b: float) -> float:
    diff = abs(a - b) % 180.0
    return min(diff, 180.0 - diff)


def transfer_attribute(osm: gpd.GeoDataFrame, reference: gpd.GeoDataFrame,
                       epsg: int, value_column: str = "speed_kph",
                       osm_id: str = "osm_key") -> list[Transfer]:
    """Move a linear attribute from a reference network onto OSM ways."""
    left = osm.to_crs(epsg=epsg)
    right = reference.to_crs(epsg=epsg)

    probe = left.copy()
    probe["geometry"] = probe.geometry.buffer(BUFFER_M, cap_style=2)
    pairs = gpd.sjoin(probe[[osm_id, "geometry"]],
                      right[[value_column, "geometry"]],
                      how="inner", predicate="intersects")
    logger.info("%d OSM way(s) produced %d overlap candidate(s)",
                len(left), len(pairs))

    geom_by_id = left.set_index(osm_id).geometry
    ref_geom = right.geometry
    lengths: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    covered: dict[str, float] = defaultdict(float)

    for _, row in pairs.iterrows():
        way = geom_by_id.loc[row[osm_id]]
        ref = ref_geom.loc[row["index_right"]]
        # Direction filter: a parallel cycleway is close but not aligned.
        if bearing_delta(bearing(way), bearing(ref)) > BEARING_TOLERANCE:
            continue
        # Overlap length: intersect the reference with the way's buffer.
        piece = ref.intersection(way.buffer(BUFFER_M, cap_style=2))
        if piece.is_empty:
            continue
        length = piece.length
        lengths[row[osm_id]][str(row[value_column])] += length
        covered[row[osm_id]] += length

    results: list[Transfer] = []
    for key, geom in geom_by_id.items():
        by_value = lengths.get(key, {})
        if not by_value or geom.length == 0:
            results.append(Transfer(key, None, 0.0, 0.0, 0))
            continue
        best_value, best_length = max(by_value.items(), key=lambda kv: kv[1])
        coverage = min(1.0, covered[key] / geom.length)
        agreement = best_length / covered[key]
        # Below the coverage floor the value is reported but NOT assigned:
        # a fifth of a way agreeing is not evidence about the whole way.
        assigned = best_value if coverage >= MIN_COVERAGE else None
        results.append(Transfer(key, assigned, coverage, agreement, len(by_value)))

    assigned = sum(1 for r in results if r.value is not None)
    logger.info("assigned a value to %d of %d way(s); median coverage %.2f",
                assigned, len(results),
                sorted(r.coverage for r in results)[len(results) // 2]
                if results else 0.0)
    return results


if __name__ == "__main__":
    logger.info("store value, coverage and agreement — never the value alone")
```

## Step-by-step walkthrough

1. **Work in metres.** A buffer and a length are meaningless in degrees, and a road network spans enough latitude for the error to be substantial.
2. **Buffer with flat caps.** A flat cap stops the buffer extending past the end of a way and collecting overlaps from the road continuing beyond a junction.
3. **Fold bearings to 180 degrees.** A way drawn in the opposite direction is the same road; folding removes direction of travel while keeping alignment.
4. **Filter by bearing before measuring.** The bearing test is arithmetic and the intersection is geometry, so testing first discards most wrong pairs cheaply.
5. **Accumulate length per value, not per segment.** Several reference segments may carry the same value; what matters is the total length each *value* covers.
6. **Report coverage separately from agreement.** Coverage says how much of the way had any reference at all; agreement says how much of that agreed on the winning value. A way can have full coverage and poor agreement, which is a very different situation from partial coverage with perfect agreement.
7. **Refuse to assign below the coverage floor.** A value derived from a fifth of a way is not evidence about the way, and silently assigning it is how a reference value ends up on a road it never described.
8. **Return a null value, not a missing row.** Every OSM way appears in the output, with an explicit null where nothing could be assigned, so downstream counts are complete.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="jsl2-t jsl2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="jsl2-t">How coverage and agreement combine into four interpretations</title>
  <desc id="jsl2-d">A grid of two coverage levels against two agreement levels. High coverage with high agreement is a clean transfer that can be used directly. High coverage with low agreement means the reference genuinely changes value along the way, so the OSM way probably needs splitting rather than a single value. Low coverage with high agreement means only part of the way has reference data, and the value applies to that part rather than the whole. Low coverage with low agreement means there is no usable evidence and nothing should be assigned.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Two numbers, four very different situations</text>
  <rect x="216" y="48" width="319" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="376" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">High agreement</text>
  <rect x="535" y="48" width="319" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="694" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Low agreement</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">High coverage</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">clean: use it</text>
  <text x="694" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">value changes: split the way</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Low coverage</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">partial: applies to part</text>
  <text x="694" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">no usable evidence</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">What to store</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">the value</text>
  <text x="694" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">the conflict</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">What to review</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">nothing</text>
  <text x="694" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">the segmentation</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The top-right cell is the interesting one: it is not a matching failure, it is the reference telling you the OSM way is too long.</text>
</svg>
<figcaption>Collapsing these four into one number loses the distinction between a bad match and a real change along the road.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="jsl3-t jsl3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="jsl3-t">What each filter removes from the candidate overlaps on one urban road network</title>
  <desc id="jsl3-d">Five counts through the filtering pipeline for a city road layer. The raw buffer intersection produces a large number of candidate overlaps. Removing overlaps whose bearing disagrees beyond the tolerance discards roughly half of them, almost entirely parallel paths and service roads. Removing empty intersections discards a small further share. Accumulating by value rather than by segment collapses the remainder substantially, because several reference segments commonly share one value. The final assignments are fewer still, because ways below the coverage floor receive nothing.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Where the candidate overlaps go</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Raw buffer overlaps</text>
  <rect x="266" y="60" width="468" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">baseline</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">After the bearing filter</text>
  <rect x="266" y="100" width="243" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about half remain</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">After empty intersections</text>
  <rect x="266" y="140" width="225" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">slightly fewer</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Collapsed by value</text>
  <rect x="266" y="180" width="89" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">segments merge</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">Assigned above the floor</text>
  <rect x="266" y="220" width="66" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">final assignments</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The bearing filter removes the most and is the cheapest to compute, which is why it runs before any geometric intersection.</text>
</svg>
<figcaption>Half the raw overlaps are paths and service roads running alongside, which no distance-based rule can separate.</figcaption>
</figure>

## Verification

- **Parallel features are not matched.** Find a road with a parallel cycleway and confirm the cycleway did not receive the road's value.
- **Coverage is high on trunk roads.** A major road should be almost entirely covered by a national reference; low coverage there means the buffer or bearing tolerance is wrong.
- **Low-agreement ways are genuinely mixed.** Sample a few and confirm the reference really does change value along them.
- **Every way appears in the output.** Including those with no value; a shorter output than input means rows were dropped rather than nulled.
- **Values are in your units.** The reference's units are its own; convert explicitly rather than assuming they match the OSM convention.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Cycleways carry road speed limits | No bearing filter | Discard overlaps whose bearing differs beyond a tolerance |
| Values bleed past junctions | Round buffer caps | Use flat caps so the buffer stops at the way's end |
| Coverage always tiny | Buffer narrower than the positional offset | Widen the buffer to half a carriageway plus error |
| Buffers in the thousandths | Work done in a geographic CRS | Reproject both layers to a metric CRS |
| One value assigned to a mixed road | Agreement not reported | Store agreement alongside the value and review low ones |
| Output shorter than input | Unmatched ways dropped | Emit an explicit null row for every way |
| Speeds off by a factor | Reference in different units | Convert units explicitly at the boundary |

## Specification reference

> Linear referencing transfers attributes between networks whose segmentation differs by measuring the overlap between source and target geometry and assigning by length. Shapely provides the buffer, intersection and length operations used here; the bearing comparison is ordinary trigonometry over the endpoints. See the [Shapely documentation](https://shapely.readthedocs.io/) for `buffer` cap styles and `intersection` semantics on linear geometry.

## Frequently Asked Questions

<details>
<summary>Why is a bearing filter necessary?</summary>

Because proximity alone cannot distinguish a road from the things that run alongside it. A carriageway, its service road, a parallel cycleway and a footpath are all within a few metres of each other for their entire length, and a buffer-based overlap matches all of them equally well. Comparing overall direction, folded so that a way drawn backwards is still aligned, separates them almost perfectly and costs nothing.
</details>

<details>
<summary>What should happen when a way overlaps segments with different values?</summary>

Report it rather than resolve it. High coverage with low agreement is not a matching failure; it is the reference telling you that the attribute genuinely changes along that OSM way, which usually means the way should be split. Assigning the dominant value silently puts a single speed limit on a road that really has two, and nothing downstream will ever reveal that.
</details>

<details>
<summary>How wide should the buffer be?</summary>

Wide enough to cover half a carriageway plus the positional difference between the two networks, which is typically ten to fifteen metres for a road network. Too narrow and dual carriageways mapped as two ways match nothing; too wide and the buffer starts collecting genuinely different roads, at which point the bearing filter is doing all the work and doing it under more strain than it should.
</details>

<details>
<summary>Should a way with partial coverage get the value anyway?</summary>

Not automatically. A value derived from a fifth of a way's length is not evidence about the whole way, and assigning it anyway produces data that looks complete and is not. Report the value and the coverage together, set a floor below which nothing is assigned, and let a consumer who genuinely wants a low-coverage estimate opt into it explicitly.
</details>

## Related

- [Attribute Enrichment from Authoritative Sources](https://www.osm-data-processing.org/osm-conflation-and-enrichment/attribute-enrichment-from-authoritative-sources/) — the parent topic and the namespace discipline this output follows.
- [Normalizing OSM Speed Limits and Units](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/normalizing-osm-speed-limits-and-units/) — reconciling the two sources' units.
- [Nearest-Neighbour Matching with GeoPandas sjoin_nearest](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/nearest-neighbour-matching-with-geopandas-sjoin-nearest/) — the point-based equivalent of this join.
- [Routing Graph Topology QA](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/) — where a transferred speed limit is usually consumed.
- [Validating Oneway and Access Tags for Routing](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/validating-oneway-and-access-tags-for-routing/) — checking the attributes this produces.

Up one level: [Attribute Enrichment from Authoritative Sources](https://www.osm-data-processing.org/osm-conflation-and-enrichment/attribute-enrichment-from-authoritative-sources/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Joining OSM Roads to a Speed Limit Reference",
  "description": "Attach a linearly referenced road attribute to OSM ways whose segmentation does not match: project onto a shared network, transfer by overlap length, and record the coverage per way.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Conflation & Data Enrichment",
  "about": ["linear referencing", "road attribute transfer", "bearing filter"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Conflation & Data Enrichment", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/" },
    { "@type": "ListItem", "position": 3, "name": "Attribute Enrichment from Authoritative Sources", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/attribute-enrichment-from-authoritative-sources/" },
    { "@type": "ListItem", "position": 4, "name": "Joining OSM Roads to a Speed Limit Reference", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/attribute-enrichment-from-authoritative-sources/joining-osm-roads-to-a-speed-limit-reference/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Transfer a linear road attribute onto OSM ways",
  "description": "Reproject to metric coordinates, buffer each OSM way with flat caps, discard overlaps whose bearing disagrees, accumulate overlap length per value, and assign only above a coverage floor.",
  "step": [
    { "@type": "HowToStep", "name": "Reproject to metres", "text": "Convert both networks to a metric CRS so buffers and lengths are meaningful." },
    { "@type": "HowToStep", "name": "Buffer with flat caps", "text": "Grow each OSM way by half a carriageway plus positional error, using flat caps so the buffer stops at the way's end." },
    { "@type": "HowToStep", "name": "Filter by bearing", "text": "Compare overall directions folded to a half circle and discard overlaps beyond a tolerance, removing parallel paths and service roads." },
    { "@type": "HowToStep", "name": "Accumulate length per value", "text": "Sum the overlapping length for each distinct reference value rather than for each reference segment." },
    { "@type": "HowToStep", "name": "Report coverage and agreement", "text": "Record how much of the way had any reference and how much of that agreed on the winning value." },
    { "@type": "HowToStep", "name": "Assign only above a floor", "text": "Leave the value null below a coverage threshold, emitting an explicit row so downstream counts stay complete." }
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
      "name": "Why is a bearing filter necessary when transferring road attributes?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because proximity alone cannot distinguish a road from the things that run alongside it. A carriageway, its service road, a parallel cycleway and a footpath are all within a few metres of each other for their entire length, and a buffer-based overlap matches all of them equally well. Comparing overall direction separates them almost perfectly and costs nothing." }
    },
    {
      "@type": "Question",
      "name": "What should happen when an OSM way overlaps segments with different values?",
      "acceptedAnswer": { "@type": "Answer", "text": "Report it rather than resolve it. High coverage with low agreement is not a matching failure; it is the reference telling you the attribute genuinely changes along that way, which usually means the way should be split. Assigning the dominant value silently puts a single speed limit on a road that really has two." }
    },
    {
      "@type": "Question",
      "name": "How wide should the buffer be for a road attribute transfer?",
      "acceptedAnswer": { "@type": "Answer", "text": "Wide enough to cover half a carriageway plus the positional difference between the two networks, typically ten to fifteen metres. Too narrow and dual carriageways mapped as two ways match nothing; too wide and the buffer starts collecting genuinely different roads, leaving the bearing filter to do all the work." }
    },
    {
      "@type": "Question",
      "name": "Should a way with partial coverage get the transferred value anyway?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not automatically. A value derived from a fifth of a way's length is not evidence about the whole way, and assigning it anyway produces data that looks complete and is not. Report the value and the coverage together, set a floor below which nothing is assigned, and let a consumer opt into a low-coverage estimate explicitly." }
    }
  ]
}
</script>
