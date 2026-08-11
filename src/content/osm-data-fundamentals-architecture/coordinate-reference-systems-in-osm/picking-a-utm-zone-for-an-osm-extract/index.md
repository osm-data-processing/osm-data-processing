---
title: "Picking a UTM Zone for an OSM Extract"
description: "Derive the projected CRS for a regional extract from its own bounds, measure the resulting scale error, and recognise the extracts too wide for any single UTM zone."
pageTitle: "Pick the Right UTM Zone for an OSM Extract"
pageDescription: "Choose a projected CRS from an OSM extract bounding box — zone arithmetic, hemisphere EPSG codes, a span check that vetoes UTM, and a measured scale-error verification."
slug: "picking-a-utm-zone-for-an-osm-extract"
type: "article"
breadcrumb: "Picking a UTM Zone"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Picking a UTM Zone for an OSM Extract

Choose the projected coordinate system for a regional extract by deriving it from the data — and recognise the extracts where UTM is the wrong answer entirely.

## Prerequisites

- [ ] Python 3.10+ with `pyproj` 3.6+
- [ ] An extract whose bounding box you can read — see [Extracting Metadata from OSM Planet Files](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/extracting-metadata-from-osm-planet-files/)
- [ ] A reason to project at all: distances, areas or buffers in metres
- [ ] Familiarity with the axis-order trap in [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/)

## Conceptual minimum

UTM divides the world into sixty six-degree-wide zones, each with its own transverse Mercator projection centred on the middle of the zone. Within its zone the projection is accurate to well under a metre per kilometre; outside it, accuracy falls away quickly and quietly.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="utm-error-t utm-error-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="utm-error-t">Scale error of a UTM projection against distance from its central meridian</title>
  <desc id="utm-error-d">A bar chart of scale error in parts per million at 52 degrees north. On the central meridian the error is minus 400 parts per million, the deliberate 0.9996 scale factor. At 1.5 degrees away it is minus 100, about ten centimetres per kilometre. At the 3-degree zone edge it is plus 400, about 40 centimetres per kilometre. One zone over at 5 degrees it is plus 1400, about 1.4 metres per kilometre. Two zones over at 8 degrees it is plus 4100, about 4.1 metres per kilometre.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Distortion against distance from the central meridian</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">transverse Mercator scale error, as parts per million, at 52°N</text>
  <line x1="250" y1="68" x2="250" y2="270" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">on the central meridian</text>
  <rect x="250" y="74" width="46" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="306" y="89" font-size="11" fill="currentColor" opacity="0.9">−400 ppm (the 0.9996 scale factor)</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">1.5° away (zone edge, inner)</text>
  <rect x="250" y="116" width="11" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="271" y="131" font-size="11" fill="currentColor" opacity="0.9">−100 ppm ≈ 10 cm/km</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">3° away (zone edge)</text>
  <rect x="250" y="158" width="46" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="306" y="173" font-size="11" fill="currentColor" opacity="0.9">+400 ppm ≈ 40 cm/km</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">5° away (one zone over)</text>
  <rect x="250" y="200" width="160" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="420" y="215" font-size="11" fill="currentColor" opacity="0.9">+1 400 ppm ≈ 1.4 m/km</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">8° away (two zones over)</text>
  <rect x="250" y="242" width="470" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="730" y="257" font-size="11" fill="currentColor" opacity="0.9">+4 100 ppm ≈ 4.1 m/km</text>
  <text x="440" y="306" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">Inside its own zone a UTM projection is accurate to under half a metre per kilometre. Two zones out it is metres, and nothing warns you.</text>
</svg>
<figcaption>The 0.9996 scale factor is why the error is negative in the middle: it spreads the distortion so the worst case at the zone edge is smaller.</figcaption>
</figure>

The scale factor of 0.9996 applied at the central meridian is deliberate. It makes the projection slightly too small in the middle so that it is slightly too large at the edges, halving the worst-case error compared with an unscaled projection. That is why the error in the table is negative in the centre and positive at the edge.

Nothing enforces the zone boundary. Projecting Warsaw with the zone for Berlin produces coordinates, plausible ones, wrong by metres per kilometre.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="utm-pick-t utm-pick-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="utm-pick-t">Deriving a UTM zone from an extract, with the span check that vetoes it</title>
  <desc id="utm-pick-d">A four-stage chain. Read the extract bounds from the PBF header, which is free. Take the centroid longitude of those bounds rather than of a chosen city. Compute the zone as the floor of longitude plus 180 divided by 6, plus one, combined with a hemisphere to give an EPSG code in the 32600 or 32700 range. Then check the span: an extract wider than about four degrees means UTM is the wrong projection family.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="utm" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Pick the zone from the data, not from the country</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">extract bounds</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">from the PBF header</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">free, one block read</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#utm)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">centroid longitude</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">of the bounds, not of a city</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">the honest centre</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#utm)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">zone = ⌊(lon+180)/6⌋+1</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">plus a hemisphere</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">EPSG 326xx / 327xx</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#utm)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">span check</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">more than ~4° wide?</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">then UTM is the wrong family</text>
  <text x="440" y="158" text-anchor="middle" font-size="8.5" fill="currentColor" opacity="0.85">The last step is the one that saves you: an extract spanning three zones cannot be projected into one of them accurately, and the fix is a different projection rather than a different zone.</text>
</svg>
<figcaption>Deriving the zone is three lines. Knowing when not to use a zone at all is the part that needs a decision.</figcaption>
</figure>

## Runnable solution

```python
#!/usr/bin/env python3
"""Derive the right projected CRS for an OSM extract from its own bounds."""
from __future__ import annotations

import json
import logging
import math
import subprocess
from dataclasses import dataclass

from pyproj import CRS, Transformer

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

#: Beyond this span a single transverse Mercator zone cannot cover the extract
#: without unacceptable edge distortion.
MAX_UTM_SPAN_DEGREES = 4.0


@dataclass(frozen=True)
class Bounds:
    west: float
    south: float
    east: float
    north: float

    @property
    def centre_lon(self) -> float:
        return (self.west + self.east) / 2

    @property
    def centre_lat(self) -> float:
        return (self.south + self.north) / 2

    @property
    def span_lon(self) -> float:
        return self.east - self.west


def bounds_from_pbf(path: str) -> Bounds:
    """The header carries the bbox — one block read, no full pass."""
    info = json.loads(subprocess.run(
        ["osmium", "fileinfo", "--extended", "--json", path],
        capture_output=True, text=True, check=True).stdout)
    box = info["data"]["bbox"]
    return Bounds(west=box[0], south=box[1], east=box[2], north=box[3])


def utm_zone(lon: float) -> int:
    """Zone 1 starts at 180°W; each zone spans 6°."""
    return int(math.floor((lon + 180.0) / 6.0) % 60) + 1


def utm_epsg(lon: float, lat: float) -> int:
    """326xx for the northern hemisphere, 327xx for the southern."""
    return (32600 if lat >= 0 else 32700) + utm_zone(lon)


def choose_crs(bounds: Bounds) -> CRS:
    """UTM when the extract fits a zone; an equal-area projection when it does not."""
    if bounds.span_lon <= MAX_UTM_SPAN_DEGREES:
        epsg = utm_epsg(bounds.centre_lon, bounds.centre_lat)
        crs = CRS.from_epsg(epsg)
        logger.info("extract spans %.2f° — using %s (%s)",
                    bounds.span_lon, crs.name, f"EPSG:{epsg}")
        return crs

    # Too wide for one zone: a Lambert azimuthal equal-area projection centred on
    # the extract distorts shape a little everywhere instead of a lot at the edges.
    crs = CRS.from_proj4(
        f"+proj=laea +lat_0={bounds.centre_lat:.4f} +lon_0={bounds.centre_lon:.4f} "
        f"+x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs")
    logger.warning("extract spans %.2f° — too wide for UTM; using LAEA centred on "
                   "%.3f, %.3f", bounds.span_lon, bounds.centre_lat, bounds.centre_lon)
    return crs


def make_transformer(bounds: Bounds) -> Transformer:
    """always_xy keeps the argument order (lon, lat) on both sides."""
    return Transformer.from_crs(CRS.from_epsg(4326), choose_crs(bounds), always_xy=True)


def scale_error_ppm(crs: CRS, lon: float, lat: float) -> float:
    """Measured, not assumed: project a 1 km east-west line and compare its length."""
    fwd = Transformer.from_crs(CRS.from_epsg(4326), crs, always_xy=True)
    geod = CRS.from_epsg(4326).get_geod()
    delta = 0.01                                         # ~700 m at 52°N
    x1, y1 = fwd.transform(lon, lat)
    x2, y2 = fwd.transform(lon + delta, lat)
    projected = math.hypot(x2 - x1, y2 - y1)
    _, _, true_distance = geod.inv(lon, lat, lon + delta, lat)
    return (projected / true_distance - 1.0) * 1e6


if __name__ == "__main__":
    b = bounds_from_pbf("ireland.osm.pbf")
    crs = choose_crs(b)
    for lon in (b.west, b.centre_lon, b.east):
        logger.info("scale error at lon %.2f: %+.0f ppm", lon,
                    scale_error_ppm(crs, lon, b.centre_lat))
```

<figure class="diagram-wrap">
<svg viewBox="0 0 880 318" role="img" aria-labelledby="utm-alternatives-t utm-alternatives-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="utm-alternatives-t">Which projection suits which extract shape</title>
  <desc id="utm-alternatives-d">A grid of five extract shapes. A city or metro area sits well inside one zone and should use UTM for that zone. A country under about four degrees wide fits one zone and can use UTM or its national grid. A country spanning three or more zones is too wide and should use Lambert conformal conic or Lambert azimuthal equal-area. A continent is far too wide and should use an equal-area projection centred on the extract. Anything global should stay in EPSG:4326 and project per query.</desc>
  <rect x="0" y="0" width="880" height="318" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">When UTM is right, and what to use instead</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">extract shape</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">use</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">a city or metro area</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">well inside one zone</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">UTM for that zone</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">a country under ~4° wide</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">fits one zone</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">UTM, or the national grid</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">a country spanning 3+ zones</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">too wide</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">Lambert conformal conic, or LAEA</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">a continent</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">far too wide</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">LAEA centred on the extract</text>
  <text x="198" y="264" text-anchor="end" font-size="11.5" fill="currentColor">anything global</text>
  <rect x="213" y="244" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">the whole sphere</text>
  <rect x="535" y="244" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">stay in EPSG:4326; project per query</text>
  <text x="440" y="300" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">A national grid, where one exists, usually beats UTM for a country: it is a projection someone chose specifically for that shape.</text>
</svg>
<figcaption>Where a national grid exists it usually wins, because it is a projection chosen for exactly that country rather than a slice of a global scheme.</figcaption>
</figure>

## Step-by-step walkthrough

`bounds_from_pbf` reads the header rather than scanning the file. The bounding box is one of the fields that comes free from the first block, so deriving a CRS costs a fraction of a second even on a planet file.

`utm_zone` uses the centroid of the *bounds*, not of a city or of the country's capital. A country whose data extends well past its populated centre — Norway, Chile, anywhere with a long coastline — has a data centroid quite different from its perceived one, and the zone should follow the data.

`choose_crs` refuses to pick a zone when the extract is too wide, and this is the part worth keeping. Without the span check, a Germany-wide extract silently gets zone 32, and everything from the Rhine westward is projected across a zone boundary. The Lambert azimuthal equal-area fallback distorts shape slightly everywhere rather than badly at the edges, which is the right trade for a wide area.

`scale_error_ppm` measures the distortion instead of trusting the theory. It projects a short east-west segment, compares its projected length against the true geodesic distance from `pyproj`'s geodesic solver, and returns the error in parts per million. Running it at the extract's western edge, centre and eastern edge is a three-line sanity check that catches a wrong zone immediately.

`always_xy=True` appears here for the same reason it appears everywhere on this site: without it, `pyproj` follows the authority axis order and the argument order silently changes meaning between CRS pairs.

## Verification

Run the scale-error check across the extract and read the three numbers:

```
scale error at lon -10.48: +112 ppm
scale error at lon  -8.00: -398 ppm
scale error at lon  -5.30: +121 ppm
```

That shape — negative in the middle, positive and roughly symmetric at the edges, all within a few hundred parts per million — is what a correctly chosen zone looks like. Errors in the thousands, or strongly asymmetric errors, mean the zone is wrong or the extract is too wide.

Then verify a round trip, which catches transformer misconfiguration:

```python
fwd = make_transformer(b)
inv = Transformer.from_crs(choose_crs(b), CRS.from_epsg(4326), always_xy=True)
for lon, lat in ((b.west, b.south), (b.centre_lon, b.centre_lat), (b.east, b.north)):
    x, y = fwd.transform(lon, lat)
    back_lon, back_lat = inv.transform(x, y)
    assert abs(back_lon - lon) < 1e-9 and abs(back_lat - lat) < 1e-9
```

Sub-nanodegree agreement is expected. Centimetre-level disagreement usually means a missing datum grid; larger disagreement means the two transformers are not inverses, typically because one was built without `always_xy`.

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Distances off by metres per kilometre | Wrong zone, or extract spans zones | Measure the scale error; widen to LAEA if needed |
| Northings around 10 000 000 in Europe | Southern-hemisphere EPSG used | 326xx north, 327xx south |
| Coordinates swapped | `always_xy` omitted | Set it on every transformer |
| Areas wrong but distances fine | Conformal projection used for area | Use an equal-area projection for areas |
| Round trip off by centimetres | Datum grid missing on this host | `pyproj sync`, or pin the transformation |
| Zone changes between runs | Zone derived from a data centroid that moves | Pin the CRS in configuration once chosen |

## Frequently Asked Questions

<details>
<summary>Should I use UTM or my country's national grid?</summary>

The national grid, where one exists and your consumers use it. British National Grid, RD New, Lambert-93 and their equivalents were designed for one country's shape, usually with a better-fitting projection and a local datum, and official data is published in them. UTM's advantage is being globally uniform, which matters when your pipeline handles many countries and nobody needs to interoperate with national datasets.
</details>

<details>
<summary>What about extracts that straddle a zone boundary?</summary>

If the span is under about four degrees, pick the zone containing the centroid and accept a slightly higher error on the far side — the measurement above shows that is still well under a metre per kilometre. If the span is larger, do not pick a zone; the honest options are a conic or equal-area projection covering the whole extract, or projecting per-zone and handling the seams, which is considerably more work than it sounds.
</details>

<details>
<summary>Does the zone matter for point-in-polygon or rendering?</summary>

No. Containment is topological and works in degrees, and rendering only needs a consistent projection, which is why web maps use Web Mercator everywhere despite its area distortion. The zone matters when you measure — lengths, areas, buffers, nearest-neighbour distances.
</details>

<details>
<summary>Should the CRS be stored with the data or recomputed?</summary>

Stored. Deriving it from the extract's bounds is right the first time and wrong every time the bounds shift slightly, because a centroid that crosses a zone boundary silently changes the CRS between runs and makes two outputs incomparable. Derive it once, write it into the pipeline configuration, and treat a change as a deliberate migration.
</details>

## Specification reference

> UTM zone `n` covers longitudes from `6n − 186` to `6n − 180` degrees, with a central meridian at `6n − 183` and a scale factor of 0.9996. EPSG codes are `32600 + n` for the northern hemisphere and `32700 + n` for the southern. Coordinates are metres, with a false easting of 500 000 m and, in the southern hemisphere, a false northing of 10 000 000 m.

## Related

- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — the topic this choice belongs to.
- [Converting OSM Coordinates to a Local CRS with pyproj](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/converting-osm-coordinates-to-local-crs-with-pyproj/) — applying the CRS once it is chosen.
- [Extracting Metadata from OSM Planet Files](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/extracting-metadata-from-osm-planet-files/) — reading the bounds this derives from.
- [Accelerating Point-in-Polygon Joins on OSM Data](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/accelerating-point-in-polygon-joins-on-osm-data/) — a join that needs no projection at all.
- [Extract Clipping & Boundary Polygons](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/) — how the extract's shape gets decided in the first place.

Up one level: [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/).
