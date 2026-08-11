---
title: "Clipping an OSM Extract with a .poly Boundary"
description: "Cut a region out of a larger OSM file with osmium extract and an Osmosis .poly boundary — writing the boundary, simplifying it, choosing the strategy, and verifying the result is not silently empty."
pageTitle: "Clip an OSM Extract with a .poly Boundary File"
pageDescription: "Step-by-step: build a .poly boundary, simplify it, run osmium extract with the right strategy, and verify the output with osmium fileinfo before anything downstream reads it."
slug: clipping-an-osm-extract-with-a-poly-boundary
type: article
breadcrumb: "Clipping with a .poly Boundary"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Clipping an OSM Extract with a .poly Boundary

Cut a region out of a larger `.osm.pbf` using a real boundary rather than a bounding box, and end up with a file whose features are complete and whose extent you have actually checked.

## Prerequisites

- [ ] `osmium-tool` 1.14 or later on `PATH` (`osmium --version`)
- [ ] A parent extract that covers the region — a continent or country `.osm.pbf`
- [ ] A boundary as GeoJSON, or an administrative relation identifier to derive one from
- [ ] Python 3.10+ with `shapely` if you intend to simplify the boundary
- [ ] Free disk of roughly 1.2× the parent file size for the working copy

## Conceptual minimum

Clipping asks one question of every node — is it inside the polygon — and then asks a much harder question about every way and relation that references nodes on both sides. The `--strategy` flag answers the second question, and the [Extract Clipping & Boundary Polygons](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/) topic compares the four available answers in detail. For this procedure, use `smart`: it keeps relations intact, which is what makes multipolygon buildings and route relations survive the cut.

The boundary format is Osmosis `.poly`, a plain-text description of one or more rings. It is worth knowing precisely because it has no error detection at all.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 251" role="img" aria-labelledby="poly-format-t poly-format-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="poly-format-t">The three parts of the Osmosis .poly boundary format</title>
  <desc id="poly-format-d">Three panels. Structure: a name line, then one or more ring sections each opened by an identifier line, followed by coordinate pairs and closed by END, with a final END closing the file. Coordinates: longitude first then latitude, whitespace-separated, decimal or scientific notation, always WGS 84 degrees, with the first and last pair matching. Holes: a ring identifier prefixed with an exclamation mark marks an enclave subtracted from the outer ring; order does not matter and deeper nesting is undefined.</desc>
  <rect x="0" y="0" width="880" height="251" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The .poly format in full — there is not much of it</text>
  <rect x="26" y="52" width="258" height="157" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Structure</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Line 1: a name, any text</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Then one or more ring sections</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Each: an id line, then coordinates</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Each ring closed by END</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">File closed by a final END</text>
  <rect x="310" y="52" width="258" height="157" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="439" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Coordinates</text>
  <text x="324" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Longitude first, then latitude</text>
  <text x="324" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Whitespace-separated, any amount</text>
  <text x="324" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Decimal or scientific notation</text>
  <text x="324" y="167" font-size="10.5" fill="currentColor" opacity="0.92">WGS 84 degrees, always</text>
  <text x="324" y="188" font-size="10.5" fill="currentColor" opacity="0.92">First and last pair should match</text>
  <rect x="594" y="52" width="258" height="157" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="723" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Holes</text>
  <text x="608" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Ring id prefixed with !</text>
  <text x="608" y="125" font-size="10.5" fill="currentColor" opacity="0.92">e.g. `!2` for an enclave</text>
  <text x="608" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Subtracted from the outer ring</text>
  <text x="608" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Order does not matter</text>
  <text x="608" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Nesting deeper than one is undefined</text>
  <text x="440" y="235" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">There is no CRS declaration and no version marker, so a file in the wrong axis order is indistinguishable from a valid one until you look at the output.</text>
</svg>
<figcaption>The format carries no CRS and no version, which is why a file written latitude-first is accepted, cut, and produces an empty extract without complaint.</figcaption>
</figure>

Two properties of that format cause almost every problem people have with it. Coordinates are longitude first — the opposite of the order most people say aloud, and the same axis-order trap discussed in [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/). And there is no validation: a syntactically fine file describing a polygon in the wrong hemisphere cuts cleanly and produces nothing.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="poly-steps-t poly-steps-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="poly-steps-t">The five steps from a boundary to a verified regional extract</title>
  <desc id="poly-steps-d">A five-stage chain: obtain a boundary from an administrative relation or your own GeoJSON; simplify it at about a hundred metres tolerance, taking a typical 180 thousand vertices down to two thousand; write it as a .poly file with longitude then latitude, one pair per line, terminated by END twice; run osmium extract with the polygon and strategy flags in one pass; and verify with osmium fileinfo that the counts are non-zero and a bounding box is present.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="clp1" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Five steps, and only one of them is the extract command</text>
  <rect x="26" y="64" width="138" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="95" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">get a boundary</text>
  <text x="95" y="107" text-anchor="middle" font-size="8.5" fill="currentColor" opacity="0.85">admin relation or GeoJSON</text>
  <text x="95" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">from OSM or your own</text>
  <line x1="164" y1="96" x2="194" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#clp1)"/>
  <rect x="198" y="64" width="138" height="64" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="267" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">simplify</text>
  <text x="267" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">~100 m tolerance</text>
  <text x="267" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">180 k verts → 2 k</text>
  <line x1="336" y1="96" x2="366" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#clp1)"/>
  <rect x="370" y="64" width="138" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="439" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">write .poly</text>
  <text x="439" y="107" text-anchor="middle" font-size="8.5" fill="currentColor" opacity="0.85">lon lat, one pair per line</text>
  <text x="439" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">END, END</text>
  <line x1="508" y1="96" x2="538" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#clp1)"/>
  <rect x="542" y="64" width="138" height="64" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="611" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">osmium extract</text>
  <text x="611" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">--polygon --strategy</text>
  <text x="611" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">one pass</text>
  <line x1="680" y1="96" x2="710" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#clp1)"/>
  <rect x="714" y="64" width="138" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="783" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">verify</text>
  <text x="783" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">fileinfo counts</text>
  <text x="783" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">non-zero, has a bbox</text>
  <text x="440" y="158" text-anchor="middle" font-size="10.0" fill="currentColor" opacity="0.85">The two steps most often skipped are simplification and verification, and they are the two that cause the slow runs and the silently empty outputs.</text>
</svg>
<figcaption>Simplification and verification are the two steps teams skip, and they are exactly the ones that prevent an hour-long run and a silently empty file.</figcaption>
</figure>

## Runnable solution

The whole procedure, from a GeoJSON boundary to a verified extract:

```python
#!/usr/bin/env python3
"""Clip a regional extract from a parent .osm.pbf using a simplified .poly boundary."""
from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path

from shapely.geometry import shape, MultiPolygon, Polygon
from shapely.ops import unary_union

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

SIMPLIFY_DEGREES = 0.001   # ~100 m at mid latitudes — plenty for a clip boundary


def load_boundary(geojson_path: Path) -> MultiPolygon:
    """Read a GeoJSON Feature/FeatureCollection into one simplified MultiPolygon."""
    data = json.loads(geojson_path.read_text())
    features = data["features"] if data.get("type") == "FeatureCollection" else [data]
    geoms = [shape(f["geometry"] if "geometry" in f else f) for f in features]
    merged = unary_union(geoms)
    simplified = merged.simplify(SIMPLIFY_DEGREES, preserve_topology=True)
    if isinstance(simplified, Polygon):
        simplified = MultiPolygon([simplified])
    before = sum(len(p.exterior.coords) for p in merged.geoms) if hasattr(merged, "geoms") else len(merged.exterior.coords)
    after = sum(len(p.exterior.coords) for p in simplified.geoms)
    logger.info("boundary simplified: %d → %d exterior vertices", before, after)
    return simplified


def write_poly(mp: MultiPolygon, name: str, out: Path) -> Path:
    """Write a MultiPolygon as an Osmosis .poly file — longitude first, then latitude."""
    lines: list[str] = [name]
    ring_id = 0
    for poly in mp.geoms:
        ring_id += 1
        lines.append(str(ring_id))
        for lon, lat in poly.exterior.coords:
            lines.append(f"   {lon:.7E}   {lat:.7E}")
        lines.append("END")
        for interior in poly.interiors:          # holes are marked with a leading !
            ring_id += 1
            lines.append(f"!{ring_id}")
            for lon, lat in interior.coords:
                lines.append(f"   {lon:.7E}   {lat:.7E}")
            lines.append("END")
    lines.append("END")
    out.write_text("\n".join(lines) + "\n")
    logger.info("wrote %s (%d rings)", out, ring_id)
    return out


def clip(parent: Path, poly: Path, output: Path, base_url: str | None = None) -> None:
    """Run osmium extract with the smart strategy, carrying replication metadata."""
    cmd = [
        "osmium", "extract",
        "--polygon", str(poly),
        "--strategy", "smart",
        "--overwrite",
        "-o", str(output),
    ]
    if base_url:
        cmd[-3:-3] = ["--output-header", f"osmosis_replication_base_url={base_url}"]
    cmd.append(str(parent))
    logger.info("running: %s", " ".join(cmd))
    subprocess.run(cmd, check=True)


def verify(path: Path, boundary: MultiPolygon, tolerance_deg: float = 0.5) -> None:
    """Assert the extract is non-empty and its bbox overlaps the boundary we asked for."""
    info = json.loads(subprocess.run(
        ["osmium", "fileinfo", "--extended", "--json", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout)
    counts = info["data"]["count"]
    if counts["nodes"] == 0:
        raise ValueError(f"{path}: zero nodes — the boundary is probably inverted")
    bbox = info["data"]["bbox"]                       # left, bottom, right, top
    want = boundary.bounds                             # minx, miny, maxx, maxy
    for got, expected, label in zip(bbox, want, ("left", "bottom", "right", "top")):
        if abs(got - expected) > tolerance_deg + 1.0:  # +1° slack for complete_ways spill
            raise ValueError(f"{path}: {label} edge at {got:.3f}, expected near {expected:.3f}")
    logger.info("%s verified: %d nodes, %d ways, %d relations",
                path, counts["nodes"], counts["ways"], counts["relations"])


if __name__ == "__main__":
    boundary = load_boundary(Path("boundaries/ireland.geojson"))
    poly = write_poly(boundary, "ireland", Path("boundaries/ireland.poly"))
    clip(Path("europe-latest.osm.pbf"), poly, Path("extracts/ireland.osm.pbf"),
         base_url="https://planet.osm.org/replication/minute/")
    verify(Path("extracts/ireland.osm.pbf"), boundary)
```

## Step-by-step walkthrough

`load_boundary` merges every feature into a single geometry and simplifies it. The tolerance of 0.001 degrees is roughly a hundred metres, which is far finer than a clipping boundary needs and still removes the great majority of vertices from an administrative relation. `preserve_topology=True` guarantees the simplified ring stays valid and does not self-intersect — the defect class covered in [Detecting Self-Intersecting OSM Polygons with Shapely](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/detecting-self-intersecting-osm-polygons-with-shapely/).

`write_poly` emits the format exactly. Note the coordinate order in the loop: Shapely stores coordinates as `(x, y)`, which for geographic data is `(lon, lat)`, and that is also what `.poly` wants — so this is one of the few places where no swap is needed. Interior rings are written with a `!` prefix so they become holes rather than additional outer rings.

`clip` builds the command. The `--output-header` insertion is what keeps the extract catchable by the diff stream later; without it, the workflow in [Catching Up a Stale OSM Extract with pyosmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/catching-up-a-stale-osm-extract-with-pyosmium/) has no anchor to start from.

`verify` is the step that turns a hopeful run into a checked one. It reads the counts and the output bounding box from `osmium fileinfo` and asserts both. The one-degree slack allows for the `smart` strategy legitimately spilling past the boundary where a long way crosses it.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 278" role="img" aria-labelledby="poly-verify-t poly-verify-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="poly-verify-t">Four verification steps and the failure each one catches</title>
  <desc id="poly-verify-d">A grid of four checks. osmium fileinfo with the extended flag proves the file parses and gives counts, catching an empty or truncated cut. Comparing the output bounding box against the requested boundary proves the cut landed where asked and catches inverted axis order. Comparing counts against the parent file proves a plausible share and catches a boundary that is an order of magnitude wrong. Rendering a sample proves features look complete and catches a simple-strategy shred.</desc>
  <rect x="0" y="0" width="880" height="278" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What each verification command actually proves</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">proves</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">catches</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">osmium fileinfo -e</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">the file parses; counts</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">an empty or truncated cut</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">compare bbox to the boundary</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">the cut landed where asked</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">inverted axis order</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">count vs the parent</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">a plausible share of the parent</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">a boundary an order of magnitude wrong</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">render a sample</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">features look complete</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">a simple-strategy shred</text>
  <text x="440" y="260" text-anchor="middle" font-size="10.0" fill="currentColor" opacity="0.85">The bbox comparison is the one to automate: it is a four-number assertion and it catches the failure that produces a valid, empty, exit-zero file.</text>
</svg>
<figcaption>Automate the bounding-box comparison. It is four numbers and it catches the one failure that exits zero with a valid file containing nothing.</figcaption>
</figure>

## Verification

Run the script and expect three log lines: a vertex reduction of at least an order of magnitude, a ring count matching the number of separate landmasses in your boundary, and non-zero counts at the end. Then check the numbers by hand once:

```bash
osmium fileinfo --extended extracts/ireland.osm.pbf | grep -E 'Bounding box|Number of'
```

The bounding box should sit within about a degree of your boundary's bounds. Node counts on the order of tens of millions for a country and hundreds of thousands for a city are the right magnitude; a count in the hundreds means the boundary is wrong, not that the region is empty.

## Common errors and fixes

| Message or symptom | Root cause | Fix |
|---|---|---|
| `Zero nodes` from the verifier | Latitude and longitude swapped in the `.poly` | Write longitude first; the script above already does |
| `Open file ... exists` | `osmium` refuses to overwrite | Pass `--overwrite`, or remove the output first |
| Run takes over an hour on a small region | Boundary has tens of thousands of vertices | Simplify before writing the `.poly` |
| `Unknown file format` on the boundary | `.poly` written with a missing final `END` | Every ring ends with `END`, and the file ends with one more |
| Output far larger than expected | Boundary rings not closed, so the polygon is degenerate | Ensure the first and last coordinate pair match |
| Extract has no replication anchor | Parent had none and no header was set | Pass `--output-header` with the base URL |

## Specification reference

> The `.poly` format places the polygon name on the first line, then one section per ring: a section identifier, one coordinate pair per line as longitude then latitude, and `END`. A section identifier prefixed with `!` marks the ring as a hole. A final `END` closes the file. Coordinates are WGS 84 degrees; the format carries no coordinate-system declaration.

## Frequently Asked Questions

<details>
<summary>Can I use a GeoJSON boundary directly instead of converting to .poly?</summary>

Yes, on `osmium-tool` 1.11 and later — pass the GeoJSON file to `--polygon` and it is detected by extension. The conversion step above exists for two other reasons. It gives you a place to simplify, which is where the runtime saving comes from, and `.poly` is what most other OSM tooling accepts, so keeping the canonical boundary in that format avoids maintaining two. If your boundaries are generated fresh each run from a GIS source, skipping the conversion and simplifying in memory is perfectly reasonable.
</details>

<details>
<summary>How much should I simplify the boundary?</summary>

Enough that the vertex count drops by an order of magnitude, and no more. A tolerance of about a hundred metres takes a typical administrative relation from six figures of vertices to low thousands and moves the boundary by less than the width of the roads that cross it. Going coarser starts to cut across features you meant to include; going finer buys accuracy that a clipping operation cannot use, because the strategy already spills past the line wherever a way crosses it.
</details>

<details>
<summary>Why does the output bounding box extend past my boundary?</summary>

Because `smart` and `complete_ways` keep entire ways when any node of the way is inside. A motorway entering the region at its edge brings all of its nodes, including the ones far outside, and the header bounding box is computed from the nodes actually present. This is correct behaviour and the reason the verifier above allows a degree of slack. If you need output strictly bounded, clip the geometries in your own processing after loading them.
</details>

<details>
<summary>Should the boundary come from OSM or from an official source?</summary>

For clipping, from whichever is more stable. An OSM administrative relation is free and current but can be edited between runs, which means an extract cut last month and one cut today may not cover the same area — a difference that shows up as unexplained row-count drift. Pinning a boundary file in version control, whatever its origin, makes the cut reproducible, which usually matters more than the boundary being canonical.
</details>

## Related

- [Extract Clipping & Boundary Polygons](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/) — the topic that compares all four strategies.
- [Choosing complete_ways vs smart in osmium extract](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/choosing-complete-ways-vs-smart-in-osmium-extract/) — deciding between the two correct strategies.
- [Splitting a Planet File into Regional Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/splitting-a-planet-file-into-regional-extracts/) — many outputs from one pass.
- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — why the axis order bites here.
- [Extracting Metadata from OSM Planet Files](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/extracting-metadata-from-osm-planet-files/) — reading the header the verifier checks.

Up one level: [Extract Clipping & Boundary Polygons](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/).
