---
title: "Debugging Features Clipped at Tile Edges"
description: "Isolate whether a seam at a tile boundary comes from the buffer, the style, the source geometry or the client, using a decoder that inspects out-of-extent coordinates directly."
pageTitle: "Diagnose Vector Tile Seams at Boundaries"
pageDescription: "Trace a tile-edge seam to its real cause: decode the tile, measure how far geometry extends past the extent, compare against the styled width, and rule out client-side clamping."
slug: debugging-features-clipped-at-tile-edges
type: article
breadcrumb: "Debugging Edge Clipping"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Debugging Features Clipped at Tile Edges

A hairline gap appears along a tile boundary at one zoom and not another. Work out, in four checks, whether the tile, the style or the renderer is responsible — rather than raising the buffer and hoping.

## Prerequisites

- [ ] The tile in question, fetched from the archive or the server rather than from a browser cache.
- [ ] Python 3.10+ with `mapbox-vector-tile` installed to decode it.
- [ ] The style's width for the affected layer at the affected zoom.
- [ ] The buffer value the tile set was generated with, from [Choosing Tile Extent and Buffer Values](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/choosing-tile-extent-and-buffer-values/).
- [ ] The source geometry for at least one affected feature, so a genuine gap in the data can be ruled out.

## Conceptual minimum

A seam has exactly four possible causes, and they are distinguishable by evidence rather than by guesswork.

**The tile has no buffer geometry.** Decode it and look at the coordinate range: if no coordinate falls outside 0 to extent, the generator clipped exactly at the boundary, and no style change will fix it.

**The buffer is present but too narrow.** Geometry extends past the edge, but by fewer grid units than half the styled line width needs. This is arithmetic, not opinion.

**The style is wider than the buffer assumed.** The same evidence as above, read from the other side: the buffer was correct for the style it was designed against, and the style has since changed.

**The client is clamping.** The tile contains adequate buffer geometry and the renderer still draws a seam, which means it is discarding out-of-extent coordinates rather than drawing them.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 384" role="img" aria-labelledby="dfc1-t dfc1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dfc1-t">Four causes of a tile seam, distinguished by two measurements</title>
  <desc id="dfc1-d">A decision node taking the decoded coordinate range and the styled width as input, with four outcomes. If no coordinate lies outside the extent, the generator clipped at the boundary and must be re-run with a buffer. If geometry extends outside but by less than half the styled width, the buffer is too narrow for the current style. If the overhang exceeds the requirement and a seam still appears, the renderer is clamping out-of-extent geometry. If the same gap exists in the source geometry, there is no tile problem at all.</desc>
  <defs><marker id="dfc1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="384" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Two measurements separate all four causes</text>
  <rect x="26" y="156" width="250" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="151" y="184" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Overhang versus styled width?</text>
  <text x="151" y="206" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Decode first, then compare</text>
  <text x="151" y="224" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Do not raise the buffer yet</text>
  <line x1="276" y1="200" x2="314" y2="200" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="314" y2="317" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="353" y2="83" stroke="currentColor" stroke-width="1.4" marker-end="url(#dfc1-a)"/>
  <rect x="356" y="52" width="498" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="370" y="77" font-size="12" font-weight="700" fill="currentColor">No overhang at all</text>
  <text x="370" y="97" font-size="10.5" fill="currentColor" opacity="0.88">Generator clipped at the edge; regenerate with a buffer</text>
  <line x1="314" y1="161" x2="353" y2="161" stroke="currentColor" stroke-width="1.4" marker-end="url(#dfc1-a)"/>
  <rect x="356" y="130" width="498" height="62" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="370" y="155" font-size="12" font-weight="700" fill="currentColor">Overhang too small</text>
  <text x="370" y="175" font-size="10.5" fill="currentColor" opacity="0.88">Buffer is narrower than half the current styled width</text>
  <line x1="314" y1="239" x2="353" y2="239" stroke="currentColor" stroke-width="1.4" marker-end="url(#dfc1-a)"/>
  <rect x="356" y="208" width="498" height="62" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="370" y="233" font-size="12" font-weight="700" fill="currentColor">Overhang sufficient</text>
  <text x="370" y="253" font-size="10.5" fill="currentColor" opacity="0.88">Renderer is clamping; the tile is fine</text>
  <line x1="314" y1="317" x2="353" y2="317" stroke="currentColor" stroke-width="1.4" marker-end="url(#dfc1-a)"/>
  <rect x="356" y="286" width="498" height="62" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.5"/>
  <text x="370" y="311" font-size="12" font-weight="700" fill="currentColor">Gap in the source</text>
  <text x="370" y="331" font-size="10.5" fill="currentColor" opacity="0.88">Not a tile problem: the geometry is genuinely broken</text>
  <text x="868" y="368" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Raising the buffer fixes exactly one of these four, and makes every tile larger in the three cases where it was never the cause.</text>
</svg>
<figcaption>The last branch is worth ruling out early: a real gap in the source data looks identical to a clipping artefact.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

import mapbox_vector_tile

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.mvt.debug")

TILE_PIXELS = 512


@dataclass(frozen=True)
class Overhang:
    layer: str
    extent: int
    min_x: int
    min_y: int
    max_x: int
    max_y: int

    @property
    def units(self) -> int:
        """How far geometry reaches beyond the tile, in grid units."""
        return max(-self.min_x, -self.min_y,
                   self.max_x - self.extent, self.max_y - self.extent, 0)

    def pixels(self, tile_pixels: int = TILE_PIXELS) -> float:
        return self.units * tile_pixels / self.extent


def _walk(geometry) -> list[tuple[int, int]]:
    """Flatten any nesting depth of decoded coordinates into a point list."""
    points: list[tuple[int, int]] = []
    stack = [geometry]
    while stack:
        item = stack.pop()
        if (isinstance(item, (list, tuple)) and len(item) == 2
                and all(isinstance(v, (int, float)) for v in item)):
            points.append((int(item[0]), int(item[1])))
        elif isinstance(item, (list, tuple)):
            stack.extend(item)
    return points


def measure(tile_bytes: bytes) -> list[Overhang]:
    decoded = mapbox_vector_tile.decode(tile_bytes)
    results: list[Overhang] = []
    for name, layer in decoded.items():
        extent = layer.get("extent", 4096)
        xs: list[int] = []
        ys: list[int] = []
        for feature in layer["features"]:
            for x, y in _walk(feature["geometry"]["coordinates"]):
                xs.append(x)
                ys.append(y)
        if not xs:
            continue
        results.append(Overhang(name, extent, min(xs), min(ys), max(xs), max(ys)))
    return results


def diagnose(tile_path: Path, layer: str, styled_width_px: float) -> str:
    for over in measure(tile_path.read_bytes()):
        if over.layer != layer:
            continue
        needed_px = styled_width_px / 2.0
        actual_px = over.pixels()
        logger.info("%s: coords %d..%d (extent %d) = %.1f px of overhang, "
                    "style needs %.1f px",
                    layer, min(over.min_x, over.min_y),
                    max(over.max_x, over.max_y), over.extent,
                    actual_px, needed_px)
        if over.units == 0:
            return "GENERATOR: no buffer geometry — regenerate with a buffer"
        if actual_px < needed_px:
            return (f"BUFFER: {actual_px:.1f} px of overhang, "
                    f"{needed_px:.1f} px needed for this style")
        return "CLIENT: tile has adequate buffer — the renderer is clamping"
    return f"LAYER: {layer!r} not present in this tile"


if __name__ == "__main__":
    verdict = diagnose(Path("14-9111-5455.mvt"), layer="transportation",
                       styled_width_px=10.0)
    logger.info("verdict: %s", verdict)
```

## Step-by-step walkthrough

1. **Fetch the tile from the source of truth.** A browser cache can hold a tile generated before the last pipeline change, which sends you debugging a problem that no longer exists.
2. **Read the extent from the layer.** It is declared per layer and need not be the conventional value; assuming it turns every measurement into a wrong measurement.
3. **Flatten geometry generically.** Decoded coordinates nest differently for points, lines, polygons and multi-part geometries. A generic walk avoids a type-by-type traversal that will miss a case.
4. **Measure overhang in all four directions.** A tile can have buffer geometry on one side and none on another, typically because the source data simply stops there.
5. **Convert to pixels before comparing.** The style is specified in pixels and the tile in grid units; comparing them without converting is the most common analytical error here.
6. **Return a verdict, not a number.** The function names which component to change, because the point of the exercise is to stop people raising the buffer reflexively.
7. **Rule out the source separately.** If the verdict says the tile is fine and the renderer still shows a gap, check the source geometry before blaming the client — a genuinely disconnected way looks identical to a clipping artefact.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="dfc2-t dfc2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dfc2-t">The order to check things in when a seam appears</title>
  <desc id="dfc2-d">Four checks in order. First confirm the tile being examined is the one actually being rendered, by fetching from the archive rather than a browser cache. Second decode the tile and measure how far geometry extends past the extent in each direction. Third convert that overhang into pixels and compare it against half the styled line width at the affected zoom. Fourth, if the tile is adequate, inspect the source geometry for a genuine gap before concluding the renderer is at fault.</desc>
  <defs><marker id="dfc2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four checks, cheapest first</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">fetch fresh</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">bypass the cache</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">rules out a stale tile</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dfc2-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">measure overhang</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">per layer, per side</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">read the real extent</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dfc2-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">convert and compare</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">grid units to pixels</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">against half the width</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dfc2-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">check the source</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">before blaming the client</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">a real gap looks the same</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The first check costs seconds and resolves a surprising share of reported seams, because tile caches are long-lived by design.</text>
</svg>
<figcaption>Each step is cheaper than the one after it, and each can end the investigation on its own.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 239" role="img" aria-labelledby="dfc3-t dfc3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dfc3-t">How each of the four seam causes behaves under three diagnostic probes</title>
  <desc id="dfc3-d">Three panels describing what changes and what does not for each cause. The zoom probe asks whether the seam moves with zoom: tile-caused seams follow the tile boundaries and move, while a real gap in the source stays at one geographic position. The decode probe asks whether the tile contains geometry past the extent: absent for a generator problem, present but short for a buffer problem, and ample when the client is at fault. The regenerate probe asks whether raising the buffer helps: it helps only in the buffer case and costs bytes in every other.</desc>
  <rect x="0" y="0" width="880" height="239" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three probes, and each cause answers them differently</text>
  <rect x="26" y="52" width="259" height="153" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Zoom probe</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Move the zoom, watch the gap</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Tile causes: it moves</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Source gap: it stays put</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Cheapest possible test</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Do this one first</text>
  <rect x="311" y="52" width="259" height="153" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Decode probe</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Look past the extent</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">No overhang: generator</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Short overhang: buffer</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Ample overhang: client</text>
  <text x="325" y="188" font-size="10.5" fill="currentColor" opacity="0.92">One decode answers it</text>
  <rect x="595" y="52" width="259" height="153" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Regenerate probe</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Raise the buffer, rebuild</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Helps: it was the buffer</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">No change: it was not</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Costs bytes either way</text>
  <text x="609" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Do this one last</text>
  <text x="868" y="223" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The third probe is the one people reach for first, and it is both the slowest and the only one that makes things worse when wrong.</text>
</svg>
<figcaption>Running the probes in this order means most reported seams are explained before anything is regenerated.</figcaption>
</figure>

## Verification

- **The verdict changes when you change the input.** Run the diagnosis against a deliberately unbuffered tile and confirm it reports the generator rather than the buffer.
- **Overhang is reported per side.** A tile at the edge of your data coverage legitimately has no overhang on the outward side.
- **Pixel conversion matches the extent.** Change the extent in a test tile and confirm the reported pixel figure scales inversely.
- **A known-good tile passes.** Diagnose a boundary where no seam is visible; it should report adequate buffer, confirming the threshold is calibrated.
- **Source geometry is genuinely continuous.** Load the affected feature from the extract and confirm it has no gap of its own.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Diagnosis disagrees with the map | Tile fetched from a browser cache | Fetch from the archive or with cache headers disabled |
| Overhang reported as zero everywhere | Extent assumed rather than read | Read the extent from each decoded layer |
| Some geometries not measured | Coordinate nesting handled per type | Flatten generically rather than by geometry type |
| Verdict blames the client wrongly | Comparison made in grid units | Convert grid units to pixels before comparing |
| Seam persists after raising the buffer | Cause was the renderer, not the tile | Re-run the diagnosis; only one cause responds to buffer |
| Only one side shows a seam | Data coverage genuinely ends there | Expected at the edge of an extract; not a tile defect |

## Specification reference

> Vector tile geometry coordinates may fall outside the range 0 to extent. Such coordinates represent geometry retained beyond the tile boundary so that renderers can draw features continuously across tile edges, and clients are expected to render them rather than discard them. See the [Mapbox Vector Tile specification](https://github.com/mapbox/vector-tile-spec) for the coordinate range and the note on geometry extending past the tile.

## Frequently Asked Questions

<details>
<summary>Should I just increase the buffer when I see a seam?</summary>

Only if the measurement says the buffer is the cause, which it is in about one case in four. Raising it in the other three makes every tile in the set larger while leaving the seam exactly where it was. Decoding one tile and comparing its overhang against half the styled width takes a minute and tells you which of the four causes you are looking at.
</details>

<details>
<summary>Why does the seam appear at only one zoom level?</summary>

Because styled widths usually vary with zoom, while the buffer is fixed in grid units. A road drawn four pixels wide at zoom 12 and twelve pixels wide at zoom 16 needs three times the overhang at the higher zoom from the same tile buffer. Compute the requirement at the zoom where the style is widest, not at whichever zoom you happened to be looking at.
</details>

<details>
<summary>Can the renderer really be at fault?</summary>

Yes, though it is the least common cause. A client that clips geometry to the tile boundary rather than to the tile plus its buffer produces seams no amount of buffer will fix. The diagnosis is unambiguous: if the decoded tile contains geometry extending further past the edge than the style needs and a gap still renders, the tile has done its part.
</details>

<details>
<summary>How do I tell a clipping artefact from a real gap in the data?</summary>

Load the feature from the source extract and look at it there. A clipping artefact is always exactly on a tile boundary and disappears at a different zoom, because the boundaries move. A genuine gap in the source sits at the same geographic position at every zoom, which is the distinguishing test and also the reason to check the source before concluding anything about the renderer.
</details>

## Related

- [Choosing Tile Extent and Buffer Values](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/choosing-tile-extent-and-buffer-values/) — deriving the buffer this diagnosis measures against.
- [The Mapbox Vector Tile Spec & Tile Geometry](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/) — the parent topic and the out-of-extent coordinate rule.
- [Encoding OSM Geometry into MVT with Python](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/encoding-osm-geometry-into-mvt-with-python/) — the encoder whose clipping behaviour is under test.
- [Finding Disconnected Road Network Components](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/finding-disconnected-road-network-components/) — confirming whether a gap is real in the source.
- [Invalidating Tile Caches After an OSM Diff](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/invalidating-tile-caches-after-an-osm-diff/) — why a stale tile is a plausible first suspect.

Up one level: [The Mapbox Vector Tile Spec & Tile Geometry](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Debugging Features Clipped at Tile Edges",
  "description": "Isolate whether a seam at a tile boundary comes from the buffer, the style, the source geometry or the client, using a decoder that inspects out-of-extent coordinates directly.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Vector Tiles & Rendering Pipelines",
  "about": ["tile seams", "vector tile debugging", "geometry clipping"]
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
    { "@type": "ListItem", "position": 4, "name": "Debugging Features Clipped at Tile Edges", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/debugging-features-clipped-at-tile-edges/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Diagnose a vector tile seam at a boundary",
  "description": "Fetch the tile fresh, decode it and measure how far geometry extends past the extent per layer and per side, convert to pixels, compare against half the styled width, and rule out the source before blaming the renderer.",
  "step": [
    { "@type": "HowToStep", "name": "Fetch the tile fresh", "text": "Retrieve the tile from the archive or server rather than a browser cache, so the tile you measure is the tile being rendered." },
    { "@type": "HowToStep", "name": "Read the layer extent", "text": "Take the extent from each decoded layer rather than assuming the conventional value." },
    { "@type": "HowToStep", "name": "Measure overhang per side", "text": "Flatten every feature's coordinates generically and record how far they reach beyond the tile in each direction." },
    { "@type": "HowToStep", "name": "Convert grid units to pixels", "text": "Scale the overhang by the rendered tile size divided by the extent before comparing it with anything from the style." },
    { "@type": "HowToStep", "name": "Compare against the styled width", "text": "Require at least half the widest styled stroke at the affected zoom, and report which component falls short." },
    { "@type": "HowToStep", "name": "Rule out the source", "text": "Inspect the feature in the source extract, because a genuine gap in the data renders identically to a clipping artefact." }
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
      "name": "Should I just increase the buffer when I see a tile seam?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only if the measurement says the buffer is the cause, which it is in about one case in four. Raising it in the other three makes every tile larger while leaving the seam exactly where it was. Decoding one tile and comparing its overhang against half the styled width takes a minute and tells you which of the four causes you are looking at." }
    },
    {
      "@type": "Question",
      "name": "Why does a tile seam appear at only one zoom level?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because styled widths usually vary with zoom, while the buffer is fixed in grid units. A road drawn four pixels wide at one zoom and twelve at another needs three times the overhang at the higher zoom from the same tile buffer. Compute the requirement at the zoom where the style is widest." }
    },
    {
      "@type": "Question",
      "name": "Can the map renderer really cause tile seams?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes, though it is the least common cause. A client that clips geometry to the tile boundary rather than to the tile plus its buffer produces seams no amount of buffer will fix. The diagnosis is unambiguous: if the decoded tile contains adequate geometry past the edge and a gap still renders, the tile has done its part." }
    },
    {
      "@type": "Question",
      "name": "How do I tell a clipping artefact from a real gap in the data?",
      "acceptedAnswer": { "@type": "Answer", "text": "Load the feature from the source extract and look at it there. A clipping artefact is always exactly on a tile boundary and disappears at a different zoom, because the boundaries move. A genuine gap in the source sits at the same geographic position at every zoom." }
    }
  ]
}
</script>
