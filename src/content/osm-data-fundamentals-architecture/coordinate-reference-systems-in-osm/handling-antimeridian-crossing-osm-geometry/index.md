---
title: "Handling Antimeridian-Crossing OSM Geometry"
description: "Detect geometry that spans the 180th meridian, split it correctly rather than letting it wrap the world, and choose between splitting and unwrapping depending on the consumer."
pageTitle: "Antimeridian-Crossing Geometry in OSM Pipelines"
pageDescription: "Find OSM features that cross the antimeridian, distinguish them from genuinely world-spanning bounding boxes, and either split at the meridian or unwrap coordinates depending on the consumer."
slug: handling-antimeridian-crossing-osm-geometry
type: article
breadcrumb: "Antimeridian Crossing"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Handling Antimeridian-Crossing OSM Geometry

A ferry route from Fiji to Samoa, a country whose territory spans the date line, an exclusive economic zone around a scattered island group: each is ordinary geography and each produces a bounding box that appears to cover the entire planet.

## Prerequisites

- [ ] Python 3.10+ with `shapely` ≥ 2.0.
- [ ] Geometry in geographic coordinates, since the problem exists in degrees rather than in a projection.
- [ ] The projection background in [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/).
- [ ] A decision about the consumer: a renderer, a database and an analysis each want different handling.
- [ ] Test data from the Pacific, since nothing in Europe or the Americas exercises this.

## Conceptual minimum

Longitude is defined on a circle but stored as a number in the range from −180 to 180, and that mismatch is the entire problem. A line from longitude 179 to −179 is two degrees long going east; stored naively, it is 358 degrees long going west, and every derived computation follows the wrong interpretation.

Three consequences appear in a pipeline.

**Bounding boxes become global.** A feature spanning the meridian has a minimum longitude near −180 and a maximum near 180, so its box covers the world. Spatial indexes then return it as a candidate for every query on Earth.

**Lengths and areas are wildly wrong.** A two-degree route measured as 358 degrees is not slightly wrong; it is two orders of magnitude out and will pass any sanity check that only rejects negatives.

**Renderers draw a line across the world.** The visual symptom is unmistakable and is usually the first sign anybody notices.

The critical detection subtlety is that **a wide box and a crossing box are indistinguishable from the box alone**. A feature genuinely spanning most of the Pacific has the same bounding box as one crossing the meridian by a degree. Only the coordinate sequence distinguishes them.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="hac1-t hac1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="hac1-t">Three symptoms of an unhandled antimeridian crossing</title>
  <desc id="hac1-d">Three panels. A global bounding box appears because the minimum longitude is near minus one hundred and eighty and the maximum near one hundred and eighty, making spatial indexes return the feature for every query on Earth. A wrong length or area appears because the coordinate difference is measured the long way round, inflating a short route by two orders of magnitude. A line drawn across the map appears because renderers interpolate between the stored coordinates directly, producing a streak through every intervening longitude.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three symptoms, one cause</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Global bounding box</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Min near -180, max near 180</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Index returns it everywhere</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Query performance collapses</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Looks like a data error</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Wrong measurements</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Two degrees read as 358</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Two orders of magnitude out</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Passes a positivity check</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Fails nothing automatically</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">A line across the map</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Renderer interpolates directly</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Streak through every longitude</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">The symptom people notice</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Usually reported as a bug</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the third symptom is obvious, which is why the first two survive in pipelines that have no Pacific data to notice them with.</text>
</svg>
<figcaption>All three come from treating a circular coordinate as if it were a line segment on the real number line.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
from dataclasses import dataclass

from shapely.geometry import LineString, MultiPolygon, Polygon, box
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.crs.antimeridian")

CROSS_THRESHOLD = 180.0     # a step larger than this must be a wrap


def crosses_antimeridian(geom: BaseGeometry) -> bool:
    """A crossing shows as a longitude STEP of more than 180 degrees.

    The bounding box cannot distinguish a crossing feature from one that
    genuinely spans the Pacific; only consecutive coordinates can.
    """
    coords = _all_coords(geom)
    return any(abs(b[0] - a[0]) > CROSS_THRESHOLD
               for a, b in zip(coords, coords[1:]))


def _all_coords(geom: BaseGeometry) -> list[tuple[float, float]]:
    if geom.geom_type == "Point":
        return [(geom.x, geom.y)]
    if geom.geom_type in {"LineString", "LinearRing"}:
        return list(geom.coords)
    if geom.geom_type == "Polygon":
        out = list(geom.exterior.coords)
        for ring in geom.interiors:
            out.extend(ring.coords)
        return out
    out: list[tuple[float, float]] = []
    for part in getattr(geom, "geoms", []):
        out.extend(_all_coords(part))
    return out


def unwrap(geom: BaseGeometry) -> BaseGeometry:
    """Shift eastern-hemisphere coordinates past 180 so the geometry is contiguous.

    The result is NOT valid geographic coordinates — longitudes exceed 180 —
    but it is correct for measurement and for projecting to a local CRS.
    """
    coords = _all_coords(geom)
    if not coords:
        return geom
    reference = coords[0][0]

    def shift(x: float, y: float, z: float | None = None):
        # Move each point to the representation nearest the reference.
        adjusted = x
        while adjusted - reference > 180.0:
            adjusted -= 360.0
        while reference - adjusted > 180.0:
            adjusted += 360.0
        return (adjusted, y) if z is None else (adjusted, y, z)

    return transform(shift, geom)


def split_at_antimeridian(geom: BaseGeometry) -> BaseGeometry:
    """Cut the geometry into an eastern and a western part.

    This is what a renderer, a tile pipeline or a database with a
    longitude constraint wants; `unwrap` is what a measurement wants.
    """
    if not crosses_antimeridian(geom):
        return geom
    unwrapped = unwrap(geom)
    minx, miny, maxx, maxy = unwrapped.bounds

    west = unwrapped.intersection(box(-180.0, miny, 180.0, maxy))
    east = unwrapped.intersection(box(180.0, miny, maxx, maxy))
    # Bring the eastern part back into valid longitude range.
    east = transform(lambda x, y, z=None: (x - 360.0, y), east) \
        if not east.is_empty else east

    parts = [p for p in (west, east) if not p.is_empty]
    if not parts:
        return geom
    if len(parts) == 1:
        return parts[0]
    if all(p.geom_type in {"Polygon", "MultiPolygon"} for p in parts):
        polys: list[Polygon] = []
        for part in parts:
            polys.extend(getattr(part, "geoms", [part]))
        return MultiPolygon(polys)
    logger.info("split geometry into %d part(s)", len(parts))
    return parts[0].union(parts[1])


def true_bounds(geom: BaseGeometry) -> tuple[float, float, float, float]:
    """Bounds that describe the feature rather than the whole world."""
    return unwrap(geom).bounds if crosses_antimeridian(geom) else geom.bounds


if __name__ == "__main__":
    route = LineString([(179.0, -18.0), (-179.0, -17.0)])
    logger.info("crosses: %s", crosses_antimeridian(route))
    logger.info("naive bounds %s", route.bounds)
    logger.info("true bounds  %s", true_bounds(route))
```

## Step-by-step walkthrough

1. **Detect from coordinate steps, never from bounds.** A step larger than 180 degrees between consecutive points cannot be a real movement and must be a wrap; a wide bounding box proves nothing.
2. **Unwrap relative to the first coordinate.** Shifting every point to the representation nearest a reference produces a contiguous geometry, which is what measurement and projection need.
3. **Accept invalid longitudes in the unwrapped form.** Coordinates past 180 are deliberately outside the geographic range; the unwrapped geometry is an intermediate, not an output.
4. **Split for renderers and databases.** Anything that will draw the geometry, tile it, or store it under a longitude constraint needs two parts in valid range rather than one contiguous one.
5. **Shift the eastern part back.** After cutting at 180, the far side must be moved by a full turn to return to valid coordinates.
6. **Compute bounds from the unwrapped form.** That single change stops a Pacific feature being returned as a candidate for every spatial query worldwide.
7. **Choose per consumer.** A length calculation wants unwrapped; a tile pipeline wants split. Applying one treatment everywhere breaks whichever consumer wanted the other.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 306" role="img" aria-labelledby="hac2-t hac2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="hac2-t">Whether to unwrap or to split, decided by the consumer</title>
  <desc id="hac2-d">A decision node about what will consume the geometry, with three outcomes. A measurement such as a length, an area or a projection into a local coordinate system wants the unwrapped form, which is contiguous even though its longitudes exceed the valid range. A renderer, a tile pipeline or a database enforcing a longitude constraint wants the split form, which is two valid parts. A spatial index wants neither the naive bounds nor a transformed geometry, but bounds computed from the unwrapped form so the feature is not returned for every query.</desc>
  <defs><marker id="hac2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="306" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Who is consuming this geometry?</text>
  <rect x="26" y="117" width="250" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="151" y="145" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Measure, draw or index?</text>
  <text x="151" y="167" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Three consumers, three forms</text>
  <text x="151" y="185" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Applying one everywhere breaks two</text>
  <line x1="276" y1="161" x2="314" y2="161" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="314" y2="239" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="353" y2="83" stroke="currentColor" stroke-width="1.4" marker-end="url(#hac2-a)"/>
  <rect x="356" y="52" width="498" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="370" y="77" font-size="12" font-weight="700" fill="currentColor">Unwrap it</text>
  <text x="370" y="97" font-size="10.5" fill="currentColor" opacity="0.88">Lengths, areas, projection to a local CRS</text>
  <line x1="314" y1="161" x2="353" y2="161" stroke="currentColor" stroke-width="1.4" marker-end="url(#hac2-a)"/>
  <rect x="356" y="130" width="498" height="62" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="370" y="155" font-size="12" font-weight="700" fill="currentColor">Split it</text>
  <text x="370" y="175" font-size="10.5" fill="currentColor" opacity="0.88">Rendering, tiling, a longitude-constrained column</text>
  <line x1="314" y1="239" x2="353" y2="239" stroke="currentColor" stroke-width="1.4" marker-end="url(#hac2-a)"/>
  <rect x="356" y="208" width="498" height="62" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="370" y="233" font-size="12" font-weight="700" fill="currentColor">Unwrapped bounds only</text>
  <text x="370" y="253" font-size="10.5" fill="currentColor" opacity="0.88">Spatial indexing: fix the box, keep the geometry</text>
  <text x="868" y="290" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The third branch is the cheapest fix and the one that resolves the query-performance symptom without touching any geometry.</text>
</svg>
<figcaption>Treating this as one problem with one answer is why a fix for the renderer usually breaks the length calculation.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 226" role="img" aria-labelledby="hac3-t hac3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="hac3-t">One short route across the meridian, in four representations</title>
  <desc id="hac3-d">A single two-degree route shown in four forms. As stored, its coordinates run from longitude one hundred and seventy nine to minus one hundred and seventy nine, which reads as a 358 degree span. Its naive bounding box therefore covers the whole world. Unwrapped, the second coordinate becomes one hundred and eighty one, the geometry is contiguous and the span reads as two degrees. Split, the route becomes two short segments meeting at the meridian, both within valid longitude range.</desc>
  <rect x="0" y="0" width="880" height="226" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The same two-degree route, four ways</text>
  <rect x="26" y="56" width="203" height="54" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="128" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">as stored</text>
  <text x="128" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">179 to -179</text>
  <text x="128" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">reads as 358 degrees</text>
  <text x="128" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">both ends of the range</text>
  <text x="128" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">correct data</text>
  <rect x="233" y="56" width="203" height="54" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="334" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">naive bounds</text>
  <text x="334" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">-180 to 180</text>
  <text x="334" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">covers the world</text>
  <text x="334" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">every query matches</text>
  <text x="334" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">the index symptom</text>
  <rect x="440" y="56" width="203" height="54" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="542" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">unwrapped</text>
  <text x="542" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">179 to 181</text>
  <text x="542" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">contiguous, 2 degrees</text>
  <text x="542" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">outside valid range</text>
  <text x="542" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">for measurement only</text>
  <rect x="647" y="56" width="203" height="54" rx="6" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="748" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">split</text>
  <text x="748" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">two parts</text>
  <text x="748" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">both in valid range</text>
  <text x="748" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">meet at the meridian</text>
  <text x="748" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">for rendering and storage</text>
  <text x="868" y="210" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The first column is correct data; everything wrong in the second follows from reading a circular coordinate as a line segment.</text>
</svg>
<figcaption>Two of these four forms are outputs and two are diagnoses, which is why naming them separately is worth doing.</figcaption>
</figure>

## Verification

- **A short crossing route measures short.** A two-degree route across the meridian must not report hundreds of degrees.
- **Bounds are local.** The true bounds of a Pacific feature should span degrees, not the world.
- **A genuinely wide feature is not split.** Something spanning the Pacific without crossing must pass through unchanged.
- **Split parts are in valid range.** Every coordinate of a split result must lie between −180 and 180.
- **Round-tripping is stable.** Unwrapping and re-splitting should return the same parts.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Feature returned for every query | Naive bounding box spans the world | Compute bounds from the unwrapped geometry |
| Route length two orders too large | Longitude difference taken the long way | Unwrap before measuring |
| Line drawn across the map | Unsplit geometry handed to a renderer | Split at the meridian for anything that draws |
| Wide Pacific features wrongly split | Crossing detected from the bounding box | Detect from consecutive coordinate steps |
| Database rejects the geometry | Unwrapped coordinates exceed 180 | Split before storing under a range constraint |
| Split parts still invalid | Eastern part not shifted back | Subtract a full turn after cutting at 180 |
| Fix for one consumer breaks another | One treatment applied everywhere | Choose unwrap or split per consumer |

## Specification reference

> Geographic coordinates place longitude in the range −180 to 180 degrees, with the antimeridian at both extremes, so a feature spanning it has coordinates at both ends of the range. The GeoJSON specification recommends splitting such geometries at the antimeridian for interchange. See [RFC 7946 on the antimeridian](https://datatracker.ietf.org/doc/html/rfc7946) for the interchange recommendation and [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) for the projection context.

## Frequently Asked Questions

<details>
<summary>Why can I not detect a crossing from the bounding box?</summary>

Because a feature genuinely spanning most of the Pacific produces the same box as one crossing the meridian by a single degree — both have a minimum near −180 and a maximum near 180. The distinction lives in the coordinate sequence: a crossing geometry contains a step of more than 180 degrees between consecutive points, which cannot represent real movement. That step test is the only reliable detector.
</details>

<details>
<summary>Should I unwrap or split?</summary>

It depends entirely on the consumer, which is why this cannot be solved once in the pipeline. Measurements and projections want the unwrapped form, which is contiguous but has longitudes outside the valid range. Renderers, tile pipelines and databases with a range constraint want the split form, which is two valid parts. Spatial indexes want neither — just bounds computed from the unwrapped geometry.
</details>

<details>
<summary>Is it acceptable to store longitudes beyond 180?</summary>

As an in-memory intermediate, yes, and it is the simplest way to make measurement correct. As stored or interchanged data, no: it is outside the coordinate reference system's defined range, and any consumer that validates will reject it while any that does not will place the feature somewhere wrong. Unwrap for a computation and split before anything leaves the process.
</details>

<details>
<summary>How do I test this without Pacific data?</summary>

Construct it. A two-point line from longitude 179 to −179 exercises every part of the detection and both transformations, and takes one line to write. Real Pacific extracts are worth testing against eventually, but the synthetic case catches the logic errors and can live in a test suite where anybody will run it, which is more than can be said for a Fiji extract.
</details>

## Related

- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — the parent topic and the projection context.
- [Measuring Area Accurately on OSM Polygons](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/measuring-area-accurately-on-osm-polygons/) — another measurement that degrees get wrong.
- [Converting OSM Coordinates to a Local CRS with pyproj](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/converting-osm-coordinates-to-local-crs-with-pyproj/) — projecting geometry that must be unwrapped first.
- [The Mapbox Vector Tile Spec & Tile Geometry](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/) — the tile grid that requires the split form.
- [Detecting Self-Intersecting OSM Polygons with Shapely](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/detecting-self-intersecting-osm-polygons-with-shapely/) — validity checking after a split.

Up one level: [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Handling Antimeridian-Crossing OSM Geometry",
  "description": "Detect geometry that spans the 180th meridian, split it correctly rather than letting it wrap the world, and choose between splitting and unwrapping depending on the consumer.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["antimeridian", "longitude wrapping", "geometry splitting"]
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
    { "@type": "ListItem", "position": 4, "name": "Handling Antimeridian-Crossing OSM Geometry", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/handling-antimeridian-crossing-osm-geometry/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Handle OSM geometry that crosses the antimeridian",
  "description": "Detect a crossing from coordinate steps rather than bounds, unwrap relative to a reference point for measurement, split at the meridian for rendering and storage, and compute bounds from the unwrapped form.",
  "step": [
    { "@type": "HowToStep", "name": "Detect from coordinate steps", "text": "Flag a geometry whose consecutive longitudes differ by more than half a turn, since bounds cannot distinguish a crossing from a wide feature." },
    { "@type": "HowToStep", "name": "Unwrap for measurement", "text": "Shift every coordinate to the representation nearest a reference point, producing a contiguous geometry with longitudes outside the valid range." },
    { "@type": "HowToStep", "name": "Split for rendering and storage", "text": "Cut the unwrapped geometry at the meridian and return the far part to valid range by subtracting a full turn." },
    { "@type": "HowToStep", "name": "Fix the bounds for indexing", "text": "Compute bounding boxes from the unwrapped geometry so the feature is not a candidate for every query worldwide." },
    { "@type": "HowToStep", "name": "Keep unwrapped forms internal", "text": "Never store or interchange coordinates beyond the valid range; split before the geometry leaves the process." },
    { "@type": "HowToStep", "name": "Choose per consumer", "text": "Apply unwrapping for computations and splitting for renderers, rather than one treatment throughout the pipeline." }
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
      "name": "Why can I not detect an antimeridian crossing from the bounding box?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because a feature genuinely spanning most of the Pacific produces the same box as one crossing the meridian by a single degree. The distinction lives in the coordinate sequence: a crossing geometry contains a step of more than half a turn between consecutive points, which cannot represent real movement." }
    },
    {
      "@type": "Question",
      "name": "Should I unwrap or split antimeridian-crossing geometry?",
      "acceptedAnswer": { "@type": "Answer", "text": "It depends on the consumer. Measurements and projections want the unwrapped form, which is contiguous but has longitudes outside the valid range. Renderers, tile pipelines and range-constrained databases want the split form. Spatial indexes want neither — just bounds computed from the unwrapped geometry." }
    },
    {
      "@type": "Question",
      "name": "Is it acceptable to store longitudes beyond 180 degrees?",
      "acceptedAnswer": { "@type": "Answer", "text": "As an in-memory intermediate, yes. As stored or interchanged data, no: it is outside the coordinate reference system's defined range, and any consumer that validates will reject it while any that does not will place the feature somewhere wrong. Split before the geometry leaves the process." }
    },
    {
      "@type": "Question",
      "name": "How do I test antimeridian handling without Pacific data?",
      "acceptedAnswer": { "@type": "Answer", "text": "Construct it. A two-point line from longitude 179 to minus 179 exercises the detection and both transformations, and takes one line to write. Real Pacific extracts are worth testing against eventually, but the synthetic case catches the logic errors and can live in a test suite anybody will run." }
    }
  ]
}
</script>
