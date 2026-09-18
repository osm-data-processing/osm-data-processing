---
title: "Choosing Tile Extent and Buffer Values"
description: "Derive both tile constants from real inputs: the extent from the precision your zoom range needs, and the buffer from the widest styled line and the largest label the client will draw."
pageTitle: "Pick MVT Extent and Buffer from Style, Not by Habit"
pageDescription: "Compute a vector tile buffer from your widest styled line width and label box, size the extent from the precision each zoom can represent, and measure what both cost per tile."
slug: choosing-tile-extent-and-buffer-values
type: article
breadcrumb: "Extent & Buffer"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Choosing Tile Extent and Buffer Values

Replace the two numbers everybody copies from an example with two numbers derived from your own style sheet and zoom range — and know what each one costs per tile.

## Prerequisites

- [ ] The style the tiles will be rendered with, or at least its widest line width and largest label size in pixels.
- [ ] The zoom range the tile set will cover, and whether clients will overzoom beyond it.
- [ ] The geometry model from [The Mapbox Vector Tile Spec & Tile Geometry](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/).
- [ ] A sample of real tiles from a dense area, to measure the cost of each choice rather than guess it.
- [ ] A per-tile size budget agreed with whoever owns the client's performance.

## Conceptual minimum

**Extent** sets the resolution of the tile's internal grid. A tile is conventionally rendered at 512 screen pixels; with an extent of 4096 that is eight grid units per pixel, which is comfortably finer than any display can show. Raising the extent adds precision nobody can see while making every coordinate delta larger and therefore more expensive to encode. Lowering it saves bytes at the cost of visible quantisation.

**Buffer** sets how far beyond the tile edge geometry is retained. Its purpose is entirely about rendering: a line styled eight pixels wide extends four pixels either side of its centreline, so if the centreline is clipped exactly at the tile edge, the outer four pixels of the neighbouring tile have nothing to draw. The result is a hairline seam that appears and disappears as you pan.

The conversion between the two units is the whole calculation. With an extent \\(E\\) and a tile rendered at \\(P\\) pixels, one screen pixel is \\(E/P\\) grid units. A style whose widest stroke is \\(w\\) pixels therefore needs at least

$$b_{\text{line}} = \frac{w}{2} \cdot \frac{E}{P}$$

grid units of buffer. Labels need more, because a label anchored near the edge extends much further than a line: the half-width of the largest label box replaces \\(w/2\\).

<figure class="diagram-wrap">
<svg viewBox="0 0 880 226" role="img" aria-labelledby="ceb1-t ceb1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ceb1-t">What the buffer has to cover, measured outward from the tile edge</title>
  <desc id="ceb1-d">A band running outward from the tile edge divided into four zones by what must be retained. The first zone covers half the widest styled line, which is the minimum any base map needs. The second covers icon and symbol half-widths, which are typically larger than line widths. The third covers label text boxes, which extend furthest because a label anchored near the edge runs well past its anchor. The fourth is spare margin for client-side effects such as halos and blur. A note adds that the buffer is expressed in grid units, so the pixel figures must be converted.</desc>
  <rect x="0" y="0" width="880" height="226" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four things live in the buffer, and labels dominate</text>
  <rect x="26" y="56" width="162" height="54" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="107" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">line half-width</text>
  <text x="107" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">widest stroke / 2</text>
  <text x="107" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">the minimum</text>
  <text x="107" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">typically 4 to 8 px</text>
  <text x="107" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">cheapest to cover</text>
  <rect x="192" y="56" width="162" height="54" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="272" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">icon half-width</text>
  <text x="272" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">largest symbol / 2</text>
  <text x="272" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">usually bigger than lines</text>
  <text x="272" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">sprites are 16 to 32 px</text>
  <text x="272" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">cheap enough</text>
  <rect x="357" y="56" width="327" height="54" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="521" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">label box</text>
  <text x="521" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">longest label / 2</text>
  <text x="521" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">dominates the requirement</text>
  <text x="521" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">can exceed 100 px</text>
  <text x="521" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">the expensive term</text>
  <rect x="688" y="56" width="162" height="54" rx="6" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="769" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">effects</text>
  <text x="769" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">halos and blur</text>
  <text x="769" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">a few pixels</text>
  <text x="769" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">easy to forget</text>
  <text x="769" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">add a small margin</text>
  <text x="868" y="210" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Sizing the buffer from line widths alone is why labels near tile edges disappear on some pans and reappear on others.</text>
</svg>
<figcaption>Labels are the term that decides the buffer, and they are also the one most often left out of the calculation.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
from dataclasses import dataclass

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.mvt.buffer")

TILE_PIXELS = 512          # the size one tile is rendered at


@dataclass(frozen=True)
class StyleFacts:
    widest_line_px: float          # the thickest stroke in the style
    largest_icon_px: float         # the biggest sprite, edge to edge
    longest_label_px: float        # the widest label box you expect to render
    effect_margin_px: float = 4.0  # halos, blur, outline


def buffer_units(style: StyleFacts, extent: int = 4096,
                 tile_pixels: int = TILE_PIXELS) -> int:
    """Grid units of buffer needed so nothing is clipped mid-symbol."""
    units_per_pixel = extent / tile_pixels
    needed_px = max(
        style.widest_line_px / 2.0,
        style.largest_icon_px / 2.0,
        style.longest_label_px / 2.0,
    ) + style.effect_margin_px
    units = int(round(needed_px * units_per_pixel))
    logger.info("%.1f px of overhang -> %d grid unit(s) at extent %d",
                needed_px, units, extent)
    return units


def extent_for_precision(min_zoom: int, max_zoom: int,
                         target_metres: float) -> int:
    """Smallest conventional extent giving <= target_metres per unit at max_zoom."""
    circumference = 40_075_016.686
    for extent in (256, 512, 1024, 2048, 4096, 8192):
        unit_m = circumference / (2 ** max_zoom) / extent
        if unit_m <= target_metres:
            logger.info("extent %d gives %.2f m/unit at zoom %d (%.0f m at zoom %d)",
                        extent, unit_m, max_zoom,
                        circumference / (2 ** min_zoom) / extent, min_zoom)
            return extent
    logger.warning("no conventional extent reaches %.2f m at zoom %d",
                   target_metres, max_zoom)
    return 8192


def estimated_overhead(buffer: int, extent: int) -> float:
    """Fraction of tile AREA that is buffer, as a first-order cost proxy."""
    inner = extent
    outer = extent + 2 * buffer
    overhead = (outer ** 2 - inner ** 2) / inner ** 2
    logger.info("buffer %d at extent %d covers %.1f%% extra area",
                buffer, extent, overhead * 100)
    return overhead


if __name__ == "__main__":
    style = StyleFacts(widest_line_px=10, largest_icon_px=24,
                       longest_label_px=180)
    extent = extent_for_precision(min_zoom=0, max_zoom=14, target_metres=1.0)
    buf = buffer_units(style, extent=extent)
    estimated_overhead(buf, extent)
```

## Step-by-step walkthrough

1. **Take the maximum, not the sum.** Only the largest symbol needs to fit; a tile does not need a buffer wide enough for a line *and* an icon *and* a label stacked together.
2. **Include labels in the maximum.** A 180-pixel label box needs a 90-pixel overhang, which at extent 4096 and 512-pixel tiles is 720 grid units — many times what a line width alone would suggest.
3. **Add an effect margin.** Halos, outlines and blur extend a symbol past its nominal box, and a few pixels of slack costs almost nothing.
4. **Derive the extent from precision, not from habit.** `extent_for_precision` walks conventional values and returns the smallest that meets the ground resolution you actually need at the maximum zoom.
5. **Check the low-zoom end too.** The same function reports metres per unit at the minimum zoom, which is the figure that explains blocky low-zoom coastlines to whoever asks about them.
6. **Measure the cost as area.** The overhead calculation is a first-order proxy: a buffer of \\(b\\) around an extent \\(E\\) retains geometry over an area larger by \\(((E+2b)^2 - E^2)/E^2\\). At extent 4096 and buffer 64 that is about 6 percent; at buffer 720 it is over 90 percent.
7. **Reconcile the two numbers.** A label-driven buffer this large is a signal to reconsider: most production pipelines put labels in a separate layer with a larger buffer, or accept that labels near edges are placed by the client from point anchors rather than from clipped geometry.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="ceb2-t ceb2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ceb2-t">Extra geometry area retained at several buffer values, at extent 4096</title>
  <desc id="ceb2-d">Five buffer values with the proportion of additional area each retains beyond the tile itself. A buffer of sixteen grid units retains about one and a half percent extra. Sixty-four units retains about six percent. One hundred and twenty-eight units retains about thirteen percent. Two hundred and fifty-six units retains about twenty-seven percent. Seven hundred and twenty units, which is what a large label box demands, retains over ninety percent — nearly doubling the geometry in every tile.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What each buffer value costs in retained geometry</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">buffer 16</text>
  <rect x="226" y="60" width="9" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 1.6% more</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">buffer 64</text>
  <rect x="226" y="100" width="35" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 6% more</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">buffer 128</text>
  <rect x="226" y="140" width="71" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 13% more</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">buffer 256</text>
  <rect x="226" y="180" width="147" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 27% more</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">buffer 720</text>
  <rect x="226" y="220" width="508" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 92% more</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The last value is what a 180-pixel label box demands, which is why label anchors usually live in their own thin layer.</text>
</svg>
<figcaption>Cost grows roughly linearly in the buffer at small values and painfully faster once the buffer approaches the extent.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 306" role="img" aria-labelledby="ceb3-t ceb3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ceb3-t">What to do when the buffer a style demands is too expensive</title>
  <desc id="ceb3-d">A decision node about a buffer requirement driven by large labels, with three outcomes. Splitting labels into their own thin point layer lets that layer carry a generous buffer while the geometry layers keep a small one, which is the usual production answer. Reducing the largest label size in the style lowers the requirement directly and is worth checking with the designer. Accepting occasional clipped labels is defensible for a thematic map where labels are sparse and a missing one near an edge is not a serious defect.</desc>
  <defs><marker id="ceb3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="306" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The buffer the labels want is too expensive — now what?</text>
  <rect x="26" y="117" width="250" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="151" y="145" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Whose requirement can move?</text>
  <text x="151" y="167" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Three options, all legitimate</text>
  <text x="151" y="185" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Pick before generating tiles</text>
  <line x1="276" y1="161" x2="314" y2="161" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="314" y2="239" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="353" y2="83" stroke="currentColor" stroke-width="1.4" marker-end="url(#ceb3-a)"/>
  <rect x="356" y="52" width="498" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="370" y="77" font-size="12" font-weight="700" fill="currentColor">Split the label layer</text>
  <text x="370" y="97" font-size="10.5" fill="currentColor" opacity="0.88">Thin point layer carries the big buffer; geometry keeps a small one</text>
  <line x1="314" y1="161" x2="353" y2="161" stroke="currentColor" stroke-width="1.4" marker-end="url(#ceb3-a)"/>
  <rect x="356" y="130" width="498" height="62" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="370" y="155" font-size="12" font-weight="700" fill="currentColor">Reduce the label size</text>
  <text x="370" y="175" font-size="10.5" fill="currentColor" opacity="0.88">A style change lowers the requirement at its source</text>
  <line x1="314" y1="239" x2="353" y2="239" stroke="currentColor" stroke-width="1.4" marker-end="url(#ceb3-a)"/>
  <rect x="356" y="208" width="498" height="62" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="370" y="233" font-size="12" font-weight="700" fill="currentColor">Accept some clipping</text>
  <text x="370" y="253" font-size="10.5" fill="currentColor" opacity="0.88">Sparse labels on a thematic map; a rare miss is tolerable</text>
  <text x="868" y="290" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The first branch is the usual production answer because a point layer with a large buffer costs almost nothing in bytes.</text>
</svg>
<figcaption>Notice that two of the three options are conversations rather than code, which is why this decision belongs before generation.</figcaption>
</figure>

## Verification

- **Pan across a tile boundary at every zoom.** Seams appear at specific zooms where a styled width crosses the buffer; testing one zoom proves nothing.
- **Check the widest styled layer specifically.** A buffer adequate for roads may be inadequate for a casing or an outline drawn wider still.
- **Confirm labels near edges survive.** Find a label anchored within a few pixels of a tile boundary and confirm it renders rather than flickering as you pan.
- **Measure real tiles, not the formula.** Generate a dense area at two buffer values and compare actual byte sizes; the area proxy overstates the cost where geometry is sparse near edges.
- **Confirm extent does not exceed usefulness.** At your maximum zoom, one grid unit should be comfortably finer than the finest detail in the source data, and no finer.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Hairline seams on thick lines | Buffer sized from a thinner layer | Size from the widest styled stroke in the whole style |
| Labels flicker near tile edges | Buffer sized from line widths only | Include the largest label box in the maximum |
| Tiles nearly double in size | Label-driven buffer applied to every layer | Give labels their own layer with its own buffer |
| Blocky geometry at high zoom | Extent too low for the maximum zoom | Raise the extent until one unit is finer than the data |
| Deltas unexpectedly large | Extent raised far beyond the visible need | Lower the extent; precision nobody sees costs bytes |
| Seams only at one zoom | Line width scales with zoom in the style | Compute the buffer at the zoom with the widest rendering |
| Buffer ignored by the client | Client clamps geometry to the tile | Check the renderer honours out-of-extent coordinates |

## Specification reference

> The `extent` field of a layer declares the width and height of the layer's coordinate grid in tile-local units, and geometry coordinates are integers relative to the tile's top-left origin. Coordinates outside the range 0 to extent are permitted and represent geometry retained beyond the tile boundary for rendering continuity. See the [Mapbox Vector Tile specification](https://github.com/mapbox/vector-tile-spec) for the extent field and the treatment of out-of-bounds geometry.

## Frequently Asked Questions

<details>
<summary>Is 4096 always the right extent?</summary>

It is a sensible default and almost always adequate, because at the conventional 512-pixel tile rendering it gives eight grid units per pixel — finer than any display resolves. Raising it adds precision nobody sees while making deltas larger and tiles bigger. Lowering it is occasionally worth it for a deliberately coarse thematic layer, where quantisation is acceptable and every byte counts. Derive it from the ground resolution you need at your maximum zoom rather than adopting it reflexively.
</details>

<details>
<summary>How do I choose the buffer without knowing the final style?</summary>

Pick a defensible upper bound and record the assumption. A buffer of 64 grid units covers a stroke up to about sixteen screen pixels at the conventional extent, which is wider than most base-map lines. Write down what that buffer assumes, so when a designer later specifies a thirty-pixel casing, somebody can connect the resulting seams to the assumption rather than treating them as a mysterious rendering bug.
</details>

<details>
<summary>Why do labels need so much more buffer than lines?</summary>

Because a label extends outward from its anchor by half its rendered width, and a long place name is easily two hundred pixels wide where a line is ten. Sizing the buffer to accommodate labels can nearly double the geometry retained in every tile. The usual resolution is to separate concerns: keep label anchors as points in their own small layer with a generous buffer, and leave the geometry layers with a buffer sized for strokes.
</details>

<details>
<summary>Does a larger buffer always mean larger tiles?</summary>

In proportion to how much geometry actually sits near the edges, which varies enormously. A tile covering open countryside gains almost nothing from a wider buffer; a tile covering a dense city centre gains a lot, because every street near the boundary is retained further. That is why the area-based estimate is only a first-order proxy and why the decision should be confirmed by generating a dense sample at both values and comparing real bytes.
</details>

## Related

- [The Mapbox Vector Tile Spec & Tile Geometry](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/) — the parent topic and the grid these constants configure.
- [Debugging Features Clipped at Tile Edges](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/debugging-features-clipped-at-tile-edges/) — what to do when the buffer turns out to be wrong.
- [Encoding OSM Geometry into MVT with Python](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/encoding-osm-geometry-into-mvt-with-python/) — where these constants are applied.
- [Simplifying OSM Geometry per Zoom Level](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/simplifying-osm-geometry-per-zoom-level/) — choosing a tolerance in the same grid units.
- [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/) — the size budget these choices spend.

Up one level: [The Mapbox Vector Tile Spec & Tile Geometry](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Choosing Tile Extent and Buffer Values",
  "description": "Derive both tile constants from real inputs: the extent from the precision your zoom range needs, and the buffer from the widest styled line and the largest label the client will draw.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Vector Tiles & Rendering Pipelines",
  "about": ["tile extent", "tile buffer", "vector tile sizing"]
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
    { "@type": "ListItem", "position": 4, "name": "Choosing Tile Extent and Buffer Values", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/choosing-tile-extent-and-buffer-values/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Derive vector tile extent and buffer from a style",
  "description": "Convert the widest styled symbol into grid units to size the buffer, pick the smallest extent that meets the ground resolution needed at the maximum zoom, and measure both against real tiles.",
  "step": [
    { "@type": "HowToStep", "name": "Collect the style facts", "text": "Record the widest stroke, the largest icon and the longest label box in pixels, plus a margin for halos and outlines." },
    { "@type": "HowToStep", "name": "Convert pixels to grid units", "text": "Multiply the largest half-width by the ratio of the extent to the rendered tile size in pixels." },
    { "@type": "HowToStep", "name": "Take the maximum, not the sum", "text": "Size the buffer for the single largest symbol rather than for several stacked together." },
    { "@type": "HowToStep", "name": "Choose the extent from precision", "text": "Pick the smallest conventional extent whose grid unit is finer than the detail your maximum zoom must show." },
    { "@type": "HowToStep", "name": "Estimate the cost", "text": "Compute the proportion of extra area the buffer retains as a first-order size proxy before generating anything." },
    { "@type": "HowToStep", "name": "Confirm on real tiles", "text": "Generate a dense area at two buffer values and compare actual byte sizes, then pan across boundaries at every zoom." }
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
      "name": "Is 4096 always the right vector tile extent?",
      "acceptedAnswer": { "@type": "Answer", "text": "It is a sensible default and almost always adequate, because at the conventional 512-pixel tile rendering it gives eight grid units per pixel — finer than any display resolves. Raising it adds precision nobody sees while making deltas larger. Derive it from the ground resolution you need at your maximum zoom rather than adopting it reflexively." }
    },
    {
      "@type": "Question",
      "name": "How do I choose a tile buffer without knowing the final style?",
      "acceptedAnswer": { "@type": "Answer", "text": "Pick a defensible upper bound and record the assumption. A buffer of 64 grid units covers a stroke up to about sixteen screen pixels at the conventional extent. Write down what that buffer assumes, so when a designer later specifies a much wider casing, somebody can connect the resulting seams to the assumption rather than treating them as a mysterious rendering bug." }
    },
    {
      "@type": "Question",
      "name": "Why do labels need so much more buffer than lines?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because a label extends outward from its anchor by half its rendered width, and a long place name is easily two hundred pixels wide where a line is ten. Sizing the buffer to accommodate labels can nearly double the geometry retained in every tile. The usual resolution is to keep label anchors as points in their own small layer with a generous buffer." }
    },
    {
      "@type": "Question",
      "name": "Does a larger tile buffer always mean larger tiles?",
      "acceptedAnswer": { "@type": "Answer", "text": "In proportion to how much geometry actually sits near the edges, which varies enormously. A tile covering open countryside gains almost nothing from a wider buffer; a dense city tile gains a lot. That is why the area-based estimate is only a first-order proxy and the decision should be confirmed by generating a dense sample at both values." }
    }
  ]
}
</script>
