---
title: "Measuring Area Accurately on OSM Polygons"
description: "Why area computed in degrees or in Web Mercator is wrong, how much wrong it is at each latitude, and which of an equal-area projection or a geodesic calculation to use."
pageTitle: "Computing Correct Areas for OSM Polygons"
pageDescription: "Avoid the two standard area mistakes — degrees and Web Mercator — and choose between a local equal-area projection and a geodesic computation based on feature size and spread."
slug: measuring-area-accurately-on-osm-polygons
type: article
breadcrumb: "Measuring Area"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Measuring Area Accurately on OSM Polygons

Area is the measurement people get wrong most often and notice least, because every wrong answer is a plausible number. A forest measured in Web Mercator at sixty degrees north is four times too large, and nothing about the figure looks unusual.

## Prerequisites

- [ ] Python 3.10+ with `shapely` ≥ 2.0 and `pyproj` ≥ 3.4.
- [ ] Polygons already validated, per [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/) — an invalid ring has no meaningful area.
- [ ] The projection background from [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/).
- [ ] Features whose true area you can check against an independent source.
- [ ] Antimeridian handling first, if any data reaches the Pacific.

## Conceptual minimum

OSM stores geographic coordinates, and **degrees are not a unit of distance**. A square degree near the equator covers roughly twelve thousand square kilometres; at sixty degrees north it covers about six thousand, because lines of longitude converge. Computing area from degree coordinates therefore produces a number whose unit varies with latitude.

**Web Mercator is worse, not better.** It is a conformal projection, preserving angles at the cost of area, and its area distortion grows as the square of the secant of the latitude. At sixty degrees it inflates area by a factor of four; at seventy-five, by about fifteen. Because Web Mercator is the projection everything renders in, it is the one people reach for, and it is the least suitable for measurement of any in common use.

Two approaches give correct answers.

**An equal-area projection** — a local one such as a Lambert Azimuthal Equal Area centred on the feature, or a regional standard — preserves area by construction. Accuracy is excellent for features within a few hundred kilometres of the projection centre.

**A geodesic computation** measures on the ellipsoid directly, with no projection at all. It is correct at any size and any location, marginally slower, and the right default when features are scattered.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="maa1-t maa1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="maa1-t">How much Web Mercator inflates area, by latitude</title>
  <desc id="maa1-d">Five latitudes with the factor by which a Web Mercator area calculation overstates the true area. At the equator the factor is one, so the result is correct. At thirty degrees it is about one point three. At forty five degrees it is two. At sixty degrees it is four. At seventy five degrees it is about fifteen. A note observes that the inflation grows as the square of the secant of the latitude, so it accelerates sharply towards the poles.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Web Mercator area inflation, by latitude</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">0 degrees</text>
  <rect x="196" y="60" width="36" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">correct</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">30 degrees</text>
  <rect x="196" y="100" width="48" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">1.3x too large</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">45 degrees</text>
  <rect x="196" y="140" width="72" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">2x too large</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">60 degrees</text>
  <rect x="196" y="180" width="143" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">4x too large</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">75 degrees</text>
  <rect x="196" y="220" width="538" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">15x too large</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Inflation grows as the square of the secant of latitude, so a dataset spanning Europe has errors varying by over a factor of two.</text>
</svg>
<figcaption>A single correction factor cannot fix this, because the error differs across any dataset large enough to matter.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import math
from dataclasses import dataclass

from pyproj import Geod, Transformer
from shapely.geometry import Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.crs.area")

GEOD = Geod(ellps="WGS84")
LOCAL_LIMIT_KM = 500.0      # beyond this, a local projection loses accuracy


@dataclass(frozen=True)
class AreaResult:
    square_metres: float
    method: str
    note: str = ""


def geodesic_area(geom: BaseGeometry) -> AreaResult:
    """Measure on the ellipsoid. Correct at any size, anywhere."""
    if geom.geom_type == "MultiPolygon":
        total = sum(geodesic_area(p).square_metres for p in geom.geoms)
        return AreaResult(total, "geodesic", "summed over parts")
    if geom.geom_type != "Polygon":
        raise TypeError(f"area is undefined for {geom.geom_type}")

    lons, lats = zip(*geom.exterior.coords)
    area, _perimeter = GEOD.polygon_area_perimeter(lons, lats)
    total = abs(area)
    for ring in geom.interiors:
        hole_lons, hole_lats = zip(*ring.coords)
        hole_area, _ = GEOD.polygon_area_perimeter(hole_lons, hole_lats)
        total -= abs(hole_area)
    return AreaResult(total, "geodesic")


def equal_area_projection_area(geom: BaseGeometry) -> AreaResult:
    """Project onto an equal-area plane centred on the feature, then measure."""
    centre = geom.centroid
    # Lambert Azimuthal Equal Area centred on the feature itself: distortion
    # is zero at the centre and grows slowly with distance from it.
    proj = (f"+proj=laea +lat_0={centre.y} +lon_0={centre.x} "
            f"+x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs")
    transformer = Transformer.from_crs("EPSG:4326", proj, always_xy=True)
    projected = transform(transformer.transform, geom)
    return AreaResult(projected.area, "equal-area projection")


def extent_km(geom: BaseGeometry) -> float:
    minx, miny, maxx, maxy = geom.bounds
    _, _, diagonal = GEOD.inv(minx, miny, maxx, maxy)
    return diagonal / 1000.0


def area_of(geom: BaseGeometry) -> AreaResult:
    """Pick a method from the feature's extent, and say which was used."""
    if geom.is_empty:
        return AreaResult(0.0, "none", "empty geometry")
    if not geom.is_valid:
        # An invalid ring has no well-defined area; do not guess one.
        raise ValueError("geometry is invalid; repair before measuring")

    span = extent_km(geom)
    if span > LOCAL_LIMIT_KM:
        result = geodesic_area(geom)
        return AreaResult(result.square_metres, result.method,
                          f"extent {span:.0f} km exceeds the local-projection limit")
    return equal_area_projection_area(geom)


def mercator_error_factor(latitude_deg: float) -> float:
    """How much a Web Mercator area calculation would overstate, here."""
    return 1.0 / (math.cos(math.radians(latitude_deg)) ** 2)


if __name__ == "__main__":
    square = Polygon([(19.9, 50.0), (20.0, 50.0), (20.0, 50.1), (19.9, 50.1)])
    for result in (area_of(square), geodesic_area(square)):
        logger.info("%-26s %12.1f m2 %s", result.method,
                    result.square_metres, result.note)
    logger.info("Web Mercator here would overstate by %.2fx",
                mercator_error_factor(50.0))
```

## Step-by-step walkthrough

1. **Refuse to measure invalid geometry.** A self-intersecting ring has no well-defined area, and the number a library returns for one is an artefact of the algorithm rather than a measurement.
2. **Subtract holes explicitly in the geodesic path.** The ellipsoid area function measures a single ring, so interior rings must be computed and subtracted rather than assumed handled.
3. **Take absolute values.** The sign of a geodesic ring area depends on winding direction, and OSM ring orientation is not guaranteed.
4. **Centre the projection on the feature.** An equal-area projection has zero distortion at its centre, so centring it per feature keeps accuracy high without needing a regional standard.
5. **Switch on extent, not on location.** A feature spanning more than a few hundred kilometres accumulates error in any local projection, and the geodesic path has no such limit.
6. **Report the method.** A stored area whose method is unknown cannot be compared against one computed differently, and the two can differ by a fraction of a percent, which matters when the numbers are summed.
7. **Keep the Mercator factor available.** Being able to say by how much a wrong calculation would have been wrong is what convinces somebody that the existing figures need recomputing.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="maa2-t maa2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="maa2-t">Four ways to compute area, and what each is good for</title>
  <desc id="maa2-d">A grid of four methods against their correctness and their appropriate use. Computing in degrees gives a number whose unit varies with latitude and is never correct. Computing in Web Mercator gives a number inflated by a latitude-dependent factor and is never correct for measurement. A local equal-area projection is accurate for features within a few hundred kilometres of its centre and is fast. A geodesic computation on the ellipsoid is accurate at any size and location and is the right default when features are scattered.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four methods, two of which are never right</text>
  <rect x="226" y="48" width="314" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="383" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Correct?</text>
  <rect x="540" y="48" width="314" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="697" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Use it for</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Degrees</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="383" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">never</text>
  <text x="697" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">nothing</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Web Mercator</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="383" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">never</text>
  <text x="697" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">rendering only</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Local equal-area</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="383" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">within ~500 km</text>
  <text x="697" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">most features</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Geodesic</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="383" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">always</text>
  <text x="697" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">large or scattered</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Web Mercator appears in the table only because it is what most pipelines are already using without having chosen to.</text>
</svg>
<figcaption>The bottom two rows agree to well within a percent on ordinary features, so either is a defensible default.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="maa3-t maa3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="maa3-t">The decision each area computation makes, in order</title>
  <desc id="maa3-d">Four steps. The validate step refuses invalid geometry, since a self-intersecting ring has no well-defined area and any number returned is an artefact. The size step measures the feature's diagonal extent, which is what decides whether a local projection remains accurate. The method step picks a feature-centred equal-area projection for ordinary features and a geodesic computation for large or scattered ones. The record step stores which method produced the figure, so areas computed at different times remain comparable.</desc>
  <defs><marker id="maa3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Validate, size, choose, record</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">validate</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">refuse invalid rings</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">no area is defined</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#maa3-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">size</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">diagonal extent</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">decides the method</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#maa3-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">choose</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">projection or geodesic</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">both are correct</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#maa3-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">record</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">store the method</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">keeps figures comparable</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Recording the method sounds pedantic until two datasets computed differently are summed and the total is defensible to nobody.</text>
</svg>
<figcaption>The first step is the one most often skipped, and it is the only one that can turn a wrong number into an error.</figcaption>
</figure>

## Verification

- **A known area matches.** Take a feature whose area is published independently and confirm agreement within a fraction of a percent.
- **The two correct methods agree.** For a moderate feature, the local projection and the geodesic computation should differ negligibly.
- **Latitude does not change the answer.** Move a test polygon of fixed geodesic size to several latitudes; the computed area should stay constant.
- **Holes are subtracted.** A polygon with a hole must measure less than the same outline without it.
- **Invalid geometry raises.** Feed a bowtie and confirm an error rather than a number.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Areas grow with latitude | Computed in Web Mercator | Use an equal-area projection or a geodesic method |
| Areas in the thousandths | Computed in degrees | Project or measure geodetically before reporting |
| Holes not subtracted | Only the exterior ring measured | Compute and subtract each interior ring |
| Negative areas | Ring winding taken as meaningful | Take absolute values; OSM winding is not guaranteed |
| Large features slightly off | Local projection used beyond its range | Switch to geodesic above a few hundred kilometres |
| Stored areas incomparable | Method not recorded | Record which method produced each figure |
| Nonsense area on a bowtie | Invalid geometry measured anyway | Validate before measuring and refuse invalid input |

## Specification reference

> Web Mercator preserves angles and inflates area by a factor equal to the square of the secant of the latitude, which reaches four at sixty degrees. Equal-area projections such as Lambert Azimuthal Equal Area preserve area exactly at the cost of shape, and geodesic polygon area computation on a reference ellipsoid is independent of any projection. See the [pyproj Geod documentation](https://pyproj4.github.io/pyproj/stable/api/geod.html) for the ellipsoidal computation and [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) for the projection background.

## Frequently Asked Questions

<details>
<summary>Why is Web Mercator so bad for area?</summary>

Because it is conformal: it preserves local angles, and the price of that is that scale varies with latitude. Area, being scale squared, is inflated by the square of the secant of the latitude — a factor of two at forty-five degrees and four at sixty. It is also the projection everything renders in, so it is the one already loaded in most pipelines, which is exactly why the mistake is so common.
</details>

<details>
<summary>Should I use an equal-area projection or a geodesic computation?</summary>

Either is correct for ordinary features, and they agree to well within a percent. A local equal-area projection centred on the feature is slightly faster and entirely adequate up to a few hundred kilometres of extent. A geodesic computation has no size limit and needs no per-feature projection setup, which makes it the simpler default when features are scattered across a continent.
</details>

<details>
<summary>Can I just apply a correction factor to Mercator areas?</summary>

Only for a single point, which is rarely what you have. The factor depends on latitude, so a polygon spanning several degrees has a different error at its north and south edges, and a dataset spanning a country has errors differing by tens of percent between its extremes. A single correction is exact nowhere except at the latitude it was derived for.
</details>

<details>
<summary>Does ring winding direction matter?</summary>

For the geodesic computation, yes, in that it determines the sign of the result — which is why absolute values are taken. OSM does not guarantee a winding direction on multipolygon rings, and the assembly discussed in [Handling Multipolygon Members with No Role](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/handling-multipolygon-members-with-no-role/) derives containment geometrically rather than from orientation, so the sign carries no information worth preserving.
</details>

## Related

- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — the parent topic and the projection model.
- [Converting OSM Coordinates to a Local CRS with pyproj](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/converting-osm-coordinates-to-local-crs-with-pyproj/) — the transformation this builds on.
- [Picking a UTM Zone for an OSM Extract](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/picking-a-utm-zone-for-an-osm-extract/) — a regional alternative to a per-feature projection.
- [Handling Antimeridian-Crossing OSM Geometry](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/handling-antimeridian-crossing-osm-geometry/) — the other measurement trap in geographic coordinates.
- [Merging Adjacent OSM Polygons for Low Zoom](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/merging-adjacent-osm-polygons-for-low-zoom/) — where an area threshold depends on this being right.

Up one level: [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Measuring Area Accurately on OSM Polygons",
  "description": "Why area computed in degrees or in Web Mercator is wrong, how much wrong it is at each latitude, and which of an equal-area projection or a geodesic calculation to use.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["area computation", "equal-area projection", "geodesic measurement"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Fundamentals & Architecture", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/" },
    { "@type": "ListItem", "position": 3, "name": "Coordinate Reference Systems in OSM", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/" },
    { "@type": "ListItem", "position": 4, "name": "Measuring Area Accurately on OSM Polygons", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/measuring-area-accurately-on-osm-polygons/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Compute a correct area for an OSM polygon",
  "description": "Validate first, choose between a feature-centred equal-area projection and a geodesic computation based on extent, subtract interior rings explicitly, take absolute values, and record the method used.",
  "step": [
    { "@type": "HowToStep", "name": "Validate before measuring", "text": "Refuse to compute an area for invalid geometry, since a self-intersecting ring has no well-defined area." },
    { "@type": "HowToStep", "name": "Measure the extent", "text": "Compute the feature's diagonal span to decide whether a local projection is adequate." },
    { "@type": "HowToStep", "name": "Project onto a feature-centred equal-area plane", "text": "For ordinary features, use an equal-area projection centred on the feature so distortion is near zero." },
    { "@type": "HowToStep", "name": "Use a geodesic method for large features", "text": "Measure directly on the ellipsoid when the extent exceeds a few hundred kilometres." },
    { "@type": "HowToStep", "name": "Subtract interior rings", "text": "Compute each hole separately and subtract it, since ellipsoidal area functions measure one ring at a time." },
    { "@type": "HowToStep", "name": "Take absolute values", "text": "Discard the sign, because OSM ring winding direction is not guaranteed and carries no meaning here." },
    { "@type": "HowToStep", "name": "Record the method", "text": "Store which computation produced each figure so areas from different runs remain comparable." }
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
      "name": "Why is Web Mercator so bad for computing area?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because it is conformal: it preserves local angles, and the price is that scale varies with latitude. Area, being scale squared, is inflated by the square of the secant of the latitude — a factor of two at forty-five degrees and four at sixty. It is also the projection everything renders in, which is why the mistake is so common." }
    },
    {
      "@type": "Question",
      "name": "Should I use an equal-area projection or a geodesic computation?",
      "acceptedAnswer": { "@type": "Answer", "text": "Either is correct for ordinary features, and they agree to well within a percent. A local equal-area projection centred on the feature is slightly faster and adequate up to a few hundred kilometres of extent. A geodesic computation has no size limit and needs no per-feature setup, making it the simpler default for scattered features." }
    },
    {
      "@type": "Question",
      "name": "Can I apply a correction factor to Web Mercator areas?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only for a single point, which is rarely what you have. The factor depends on latitude, so a polygon spanning several degrees has a different error at its north and south edges, and a dataset spanning a country has errors differing by tens of percent between its extremes." }
    },
    {
      "@type": "Question",
      "name": "Does OSM ring winding direction matter for area?",
      "acceptedAnswer": { "@type": "Answer", "text": "For a geodesic computation it determines the sign of the result, which is why absolute values are taken. OSM does not guarantee a winding direction on multipolygon rings, and correct assembly derives containment geometrically rather than from orientation, so the sign carries no information worth preserving." }
    }
  ]
}
</script>
