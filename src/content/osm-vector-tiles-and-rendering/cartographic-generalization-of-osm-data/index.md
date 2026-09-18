---
title: "Cartographic Generalization of OSM Data"
description: "Selection, simplification, aggregation, displacement and typification as zoom decreases — the five operators that make a low-zoom OSM map both small enough and legible."
pageTitle: "Generalizing OSM Data for Low-Zoom Maps"
pageDescription: "Apply the five cartographic generalization operators to OSM data: rank-driven selection, grid-aware simplification, aggregation of adjacent areas, displacement of collisions, and typification."
slug: cartographic-generalization-of-osm-data
type: guide
breadcrumb: "Generalization"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Cartographic Generalization of OSM Data

Zooming out is not the same as shrinking. A map at zoom 6 that contains everything a zoom 14 map contains, drawn smaller, is illegible long before it is too large — and OSM, which is mapped at maximum detail everywhere, makes this problem unusually acute.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 386" role="img" aria-labelledby="cgo1-t cgo1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cgo1-t">The five generalization operators, ordered by how aggressively each changes the data</title>
  <desc id="cgo1-d">Five stacked operators. Selection removes whole features below a zoom and changes nothing about the survivors. Simplification reduces vertex counts, changing shape slightly while keeping every feature. Aggregation merges adjacent features into one, replacing several objects with a new object that was never in the source. Displacement moves features apart so they remain distinguishable, changing position. Typification replaces a group with a representative sample, discarding most members while preserving the pattern.</desc>
  <rect x="0" y="0" width="880" height="386" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Five operators, from conservative to inventive</text>
  <rect x="26" y="50" width="828" height="52" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="42" y="72" font-size="12.5" font-weight="700" fill="currentColor">Selection</text>
  <text x="42" y="90" font-size="10.5" fill="currentColor" opacity="0.88">Drop whole features below a zoom</text>
  <text x="838" y="82" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">survivors unchanged</text>
  <rect x="26" y="112" width="828" height="52" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="42" y="134" font-size="12.5" font-weight="700" fill="currentColor">Simplification</text>
  <text x="42" y="152" font-size="10.5" fill="currentColor" opacity="0.88">Reduce vertex counts</text>
  <text x="838" y="144" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">shape changes slightly</text>
  <rect x="26" y="174" width="828" height="52" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="42" y="196" font-size="12.5" font-weight="700" fill="currentColor">Aggregation</text>
  <text x="42" y="214" font-size="10.5" fill="currentColor" opacity="0.88">Merge adjacent features into one</text>
  <text x="838" y="206" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">creates a new object</text>
  <rect x="26" y="236" width="828" height="52" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="42" y="258" font-size="12.5" font-weight="700" fill="currentColor">Displacement</text>
  <text x="42" y="276" font-size="10.5" fill="currentColor" opacity="0.88">Move features apart to stay distinct</text>
  <text x="838" y="268" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">position changes</text>
  <rect x="26" y="298" width="828" height="52" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.5"/>
  <text x="42" y="320" font-size="12.5" font-weight="700" fill="currentColor">Typification</text>
  <text x="42" y="338" font-size="10.5" fill="currentColor" opacity="0.88">Keep a representative sample</text>
  <text x="838" y="330" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">pattern over completeness</text>
  <text x="868" y="370" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The lower three invent something that was not in the source, which is why they need a rule a cartographer agreed to rather than a default.</text>
</svg>
<figcaption>Most OSM tile pipelines use the top two and stop, which is exactly why their low-zoom maps look crowded.</figcaption>
</figure>

## The Problem This Topic Solves

Your tile pipeline produces a legible map at high zoom and an unreadable smear at low zoom: buildings merged into a grey mass, road labels overlapping, every minor stream competing with every major river. The size budget forces features out, but it forces out the wrong ones, and the result is a map that is both too full and missing things.

The failure scenario is a map nobody trusts at continental scale. A reader zooms out to see the shape of a region and gets a uniform texture of detail that conveys nothing. They zoom back in, and the map is fine. The conclusion they draw is that the map "does not work zoomed out", which is a conclusion about cartography rather than about data volume — and no amount of tuning the size budget fixes it, because the problem is that nobody decided what a zoom-6 map is *for*.

## Prerequisites

Know the tile grid's precision from [The Mapbox Vector Tile Spec & Tile Geometry](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/mvt-spec-and-tile-geometry/), since simplification tolerance should be expressed in its units. Understand rank assignment from [Tuning Tippecanoe Zoom and Feature Dropping](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/tuning-tippecanoe-zoom-and-feature-dropping/). And be comfortable with geometry operations from [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/), because every operator below can produce invalid geometry if applied carelessly.

## The Five Operators

**Selection** removes whole features. It is the cheapest operator, the easiest to review, and the one that should do most of the work. Driven by a rank computed once, it is a lookup rather than a computation, and it is fully reversible in the sense that nothing about the surviving features changes.

**Simplification** reduces vertex counts while keeping the feature. The Douglas-Peucker family of algorithms is standard, and the important discipline is the tolerance: express it in tile grid units at the target zoom, because geometry is going to be quantised to that grid anyway. Simplifying finer than the grid is wasted work; simplifying much coarser produces visible corner-cutting.

**Aggregation** merges adjacent features into one. A hundred adjacent residential parcels become one built-up polygon; a cluster of small ponds becomes one water body. This is the operator that most improves low-zoom legibility and the one most pipelines skip, because it creates an object that does not exist in the source and therefore needs a rule somebody agreed to. [Merging Adjacent OSM Polygons for Low Zoom](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/merging-adjacent-osm-polygons-for-low-zoom/) works it through.

**Displacement** moves features apart so they remain distinguishable — a road and a parallel railway that would overlap at zoom 8, drawn slightly separated. It is genuinely changing position, which is acceptable in a map and unacceptable in data, so it belongs at the tile-generation stage and should never flow back into an analytic dataset.

**Typification** replaces a group with a representative subset that preserves the pattern: a dozen islands in an archipelago become four, arranged so the shape of the group survives. It is the most sophisticated operator and the least often automated, but the principle — preserve the pattern rather than the members — is worth knowing even when applied by hand.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="cgo2-t cgo2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cgo2-t">Which generalization operator suits which OSM feature class</title>
  <desc id="cgo2-d">A grid of four feature classes against the operators that matter most for each. Roads rely mainly on selection by classification with simplification as a secondary operator. Buildings rely on aggregation into built-up areas, with selection of only the largest individual buildings. Water bodies rely on selection by area with aggregation of adjacent small bodies. Land use relies almost entirely on aggregation, because adjacent parcels of the same class are visually one area at low zoom.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Different feature classes need different operators</text>
  <rect x="186" y="48" width="223" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="297" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Primary</text>
  <rect x="409" y="48" width="223" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="520" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Secondary</text>
  <rect x="631" y="48" width="223" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="743" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Rarely needed</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Roads</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="297" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">selection by class</text>
  <text x="520" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">simplification</text>
  <text x="743" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">aggregation</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Buildings</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="297" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">aggregation</text>
  <text x="520" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">selection by size</text>
  <text x="743" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">simplification</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Water</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="297" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">selection by area</text>
  <text x="520" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">aggregation</text>
  <text x="743" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">displacement</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Land use</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="297" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">aggregation</text>
  <text x="520" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">selection</text>
  <text x="743" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">simplification</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A pipeline applying only selection and simplification serves roads well and buildings and land use badly — the usual complaint.</text>
</svg>
<figcaption>Matching the operator to the class is why one global generalization setting never produces a good map.</figcaption>
</figure>

## Simplification Tolerance and the Grid

Tolerance should be derived, not guessed. At zoom \\(z\\) with extent \\(E\\), one grid unit covers

$$u(z) = \frac{40\,075\,017}{2^{z} \cdot E}\ \text{metres at the equator},$$

and geometry will be rounded to that grid during encoding regardless. A tolerance of roughly one grid unit removes vertices the grid cannot represent anyway, at no visible cost. A tolerance of two to four units removes visible detail but keeps recognisable shape, and is a reasonable default for a base map. Beyond about eight units, corner-cutting becomes obvious on curves.

The corollary is that **tolerance must vary with zoom**. A single tolerance in metres applied at every level either does nothing at low zoom or destroys high-zoom geometry. [Simplifying OSM Geometry per Zoom Level](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/simplifying-osm-geometry-per-zoom-level/) implements the per-zoom derivation.

## Deciding What a Zoom Level Is For

The operators above are mechanisms; choosing how hard to apply them is a question about purpose, and answering it explicitly is what separates a map that reads well from one that merely fits.

A useful exercise is to write one sentence per zoom band describing what a reader is doing there. At zoom 4 to 6 they are locating a country or a region and want coastlines, major water bodies and a handful of cities. At 7 to 9 they are orienting within a region: primary road network, settlement hierarchy, large land-use masses. At 10 to 12 they are navigating a city: street network down to residential, districts, parks and water. At 13 and above they are looking at a place: individual buildings, addresses, footpaths and points of interest.

Those four sentences determine every threshold in the pipeline. A feature class that appears in none of them should not be in the tile set at all; a class named in a band should be legible throughout it, not thinned out to meet a byte budget. When a reviewer says the map "looks wrong" at some zoom, the productive first question is which of those sentences it is failing, and the answer usually names one operator that was not applied.

The second thing worth writing down is what the map is allowed to lie about. Displacement moves things; aggregation invents things; typification discards most of a group. All three are legitimate and all three produce output that disagrees with the source data. Recording that decision — in the same document as the zoom-band sentences — is what lets somebody later distinguish a deliberate cartographic simplification from a bug in the pipeline, which is otherwise an extremely difficult distinction to make from the tiles alone.

## Validation and Error Handling

| Condition | Root cause | Detection | Remediation |
| --- | --- | --- | --- |
| Polygons invalid after simplification | Tolerance collapsed a narrow neck | Validity fails on the simplified geometry | Validate after simplifying; fall back to the original |
| Coastline develops gaps | Adjacent features simplified independently | Shared boundaries diverge | Simplify shared edges once, not per feature |
| Aggregated areas leak across classes | Merge grouped on geometry alone | A park merged into an industrial estate | Group by class before merging |
| Map still crowded at low zoom | Only selection and simplification applied | Buildings and land use dominate | Add aggregation for area classes |
| Features jump between zooms | Rank thresholds too coarse | A feature appears and vanishes on adjacent levels | Smooth the rank-to-zoom mapping |
| Displacement moved data | Operator applied before the analytic branch | Positions differ from the source | Displace only in the tile branch |
| Simplification slower than rendering | Tolerance far below the grid | Vertex counts barely change | Derive tolerance from the grid unit |

## Performance and Scale

Generalization is where a tile build spends its geometry time, and the costs are very unevenly distributed.

**Selection is free.** It is a comparison against a precomputed rank, and it should therefore run first, because every feature it removes is a feature the expensive operators never see.

**Simplification is linear** in vertex count and cheap per vertex. Running it after selection, on a per-zoom basis, keeps it well-behaved.

**Aggregation is the expensive one.** Merging adjacent polygons requires finding adjacency, which is a spatial join, and then a union, which is geometrically costly. For a country-sized land-use layer this can dominate the whole build, which is why it is usually precomputed per zoom and cached rather than recomputed on every run.

The practical structure is a precomputation pass that produces, for each zoom, a ready-made set of generalized features, and a generation pass that simply selects from them. That separation also makes the generalization reviewable independently of the tiles.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="cgo3-t cgo3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cgo3-t">Where geometry time goes in a generalization pass over a country land-use layer</title>
  <desc id="cgo3-d">Five operations with their approximate share of the generalization pass runtime. Finding adjacency between polygons, which is a spatial join, takes the largest share. Unioning the adjacent groups takes the next largest. Simplifying the merged boundaries takes a moderate share. Validating the results after simplification takes a smaller share. Selection by rank takes a negligible share because it is a comparison against a precomputed value.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Aggregation dominates; selection is free</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Find adjacency</text>
  <rect x="256" y="60" width="478" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 41%</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Union the groups</text>
  <rect x="256" y="100" width="385" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 33%</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Simplify boundaries</text>
  <rect x="256" y="140" width="187" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 16%</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Validate results</text>
  <rect x="256" y="180" width="105" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 9%</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">Select by rank</text>
  <rect x="256" y="220" width="12" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">under 1%</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Because the first two dominate and neither changes between runs, materialising the aggregation is worth far more than optimising it.</text>
</svg>
<figcaption>Selection costing nothing is why it runs first: every feature it drops is one the top two bars never see.</figcaption>
</figure>

## Failure Modes and Gotchas

- **Simplification can invalidate.** A narrow neck collapsing turns a valid polygon into a self-intersecting one; validate after, not before.
- **Shared boundaries diverge.** Two adjacent polygons simplified independently no longer share an edge, leaving slivers and gaps. Simplify the shared topology, not each polygon.
- **Aggregation must respect class.** Merging by adjacency alone produces an area that is part park and part car park, labelled as whichever won.
- **Displacement is not data.** It belongs only in the rendering branch; letting it reach an analytic output corrupts positions silently.
- **Rank thresholds want smoothing.** A feature that appears at zoom 9 and vanishes at zoom 10 signals thresholds that disagree between operators.
- **Tolerance in metres does not travel.** The same metric tolerance is wildly different relative to the grid at different zooms and latitudes.

## Integration Points

Generalization sits between normalization and tile encoding. Its input is the normalized feature set from [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/), with the rank attached; its output is a per-zoom feature set consumed by whichever generator you use. Because aggregation is expensive, that output is worth materialising — a per-zoom table in a warehouse, along the lines of [Modelling OSM for Analytics Warehouses](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/), makes the generalization reusable across tile builds and inspectable on its own.

## Guides in This Topic

- [Simplifying OSM Geometry per Zoom Level](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/simplifying-osm-geometry-per-zoom-level/) — deriving tolerance from the tile grid and keeping shared boundaries together.
- [Merging Adjacent OSM Polygons for Low Zoom](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/merging-adjacent-osm-polygons-for-low-zoom/) — class-aware aggregation that produces areas a reader recognises.

## Frequently Asked Questions

<details>
<summary>Why is my low-zoom map crowded even though tiles are within budget?</summary>

Because fitting the budget and being legible are different goals. The budget is met by removing features until the bytes fit, which produces a tile full of arbitrary survivors; legibility comes from deciding what a map at that zoom is for and keeping the features that serve it. The usual missing ingredient is aggregation: at low zoom a reader wants to see where the built-up areas are, not a thinned-out sample of individual buildings.
</details>

<details>
<summary>What simplification tolerance should I use?</summary>

Derive it from the tile grid rather than picking a distance. Geometry is quantised to the grid during encoding anyway, so a tolerance of about one grid unit removes vertices that could not have been represented, at no visible cost. Two to four units is a reasonable base-map default that keeps recognisable shape while removing real detail. Because the grid unit changes with zoom, the tolerance must change with it too.
</details>

<details>
<summary>Why do gaps appear between adjacent areas after simplification?</summary>

Because each polygon was simplified independently, so a boundary the two shared has been reduced differently on each side and they no longer meet. The fix is topological: extract the shared edges once, simplify each edge a single time, and rebuild both polygons from the simplified edges. Any approach that treats each polygon as an isolated geometry will produce slivers and gaps along every shared boundary.
</details>

<details>
<summary>Is it acceptable to move features to make a map readable?</summary>

In a map, yes — displacement is a legitimate and long-established cartographic operator, and a map that shows a road and a parallel railway as distinguishable at low zoom is more truthful about the world than one where they overlap into a single line. In data, no. The rule is that displacement happens in the tile-generation branch only, and that no analytic output is ever derived from displaced geometry.
</details>

<details>
<summary>Should generalization run during tile generation or before it?</summary>

Before it, and materialised. Aggregation in particular is expensive enough that recomputing it on every tile build is wasteful, and separating it makes the generalized features inspectable in their own right rather than only through the tiles they produce. A per-zoom generalized feature set is also reusable across several tile builds and across other consumers that need a simplified view.
</details>

## Related

- [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/) — the parent section and the size budget generalization serves.
- [Simplifying OSM Geometry per Zoom Level](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/simplifying-osm-geometry-per-zoom-level/) — the tolerance derivation in code.
- [Merging Adjacent OSM Polygons for Low Zoom](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/merging-adjacent-osm-polygons-for-low-zoom/) — class-aware aggregation.
- [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/) — catching the invalidity these operators can introduce.
- [Tuning Tippecanoe Zoom and Feature Dropping](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/tuning-tippecanoe-zoom-and-feature-dropping/) — the rank that drives selection.
- [Modelling OSM for Analytics Warehouses](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/) — where materialised per-zoom features naturally live.

Up one level: [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Cartographic Generalization of OSM Data",
  "description": "Selection, simplification, aggregation, displacement and typification as zoom decreases — the five operators that make a low-zoom OSM map both small enough and legible.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Vector Tiles & Rendering Pipelines",
  "about": ["cartographic generalization", "geometry simplification", "feature aggregation"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Vector Tiles & Rendering Pipelines", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/" },
    { "@type": "ListItem", "position": 3, "name": "Cartographic Generalization of OSM Data", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Generalize OSM data for low-zoom tiles",
  "description": "Apply selection first, derive simplification tolerance from the tile grid, aggregate adjacent features within a class, reserve displacement for the rendering branch, and materialise the result per zoom.",
  "step": [
    { "@type": "HowToStep", "name": "Select first", "text": "Remove whole features by rank before any geometric operator runs, since every feature dropped is one the expensive operators never touch." },
    { "@type": "HowToStep", "name": "Derive the tolerance", "text": "Express simplification tolerance in tile grid units at the target zoom rather than as a fixed distance." },
    { "@type": "HowToStep", "name": "Simplify shared edges once", "text": "Extract shared boundaries and simplify each once, rebuilding adjacent polygons from the result to avoid slivers." },
    { "@type": "HowToStep", "name": "Aggregate within a class", "text": "Merge adjacent features only when they share a class, so the merged area means something." },
    { "@type": "HowToStep", "name": "Keep displacement in rendering", "text": "Apply positional adjustments only in the tile branch and never in an analytic output." },
    { "@type": "HowToStep", "name": "Materialise per zoom", "text": "Precompute and store the generalized feature set for each zoom so tile builds select rather than recompute." }
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
      "name": "Why is my low-zoom map crowded even though tiles are within budget?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because fitting the budget and being legible are different goals. The budget is met by removing features until the bytes fit, which produces a tile full of arbitrary survivors; legibility comes from deciding what a map at that zoom is for. The usual missing ingredient is aggregation: at low zoom a reader wants to see where the built-up areas are, not a thinned-out sample of individual buildings." }
    },
    {
      "@type": "Question",
      "name": "What simplification tolerance should I use for vector tiles?",
      "acceptedAnswer": { "@type": "Answer", "text": "Derive it from the tile grid rather than picking a distance. Geometry is quantised to the grid during encoding anyway, so a tolerance of about one grid unit removes vertices that could not have been represented. Two to four units is a reasonable base-map default. Because the grid unit changes with zoom, the tolerance must change with it." }
    },
    {
      "@type": "Question",
      "name": "Why do gaps appear between adjacent areas after simplification?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because each polygon was simplified independently, so a boundary the two shared has been reduced differently on each side and they no longer meet. The fix is topological: extract the shared edges once, simplify each edge a single time, and rebuild both polygons from the simplified edges." }
    },
    {
      "@type": "Question",
      "name": "Is it acceptable to move features to make a map readable?",
      "acceptedAnswer": { "@type": "Answer", "text": "In a map, yes — displacement is a legitimate cartographic operator, and a map showing a road and a parallel railway as distinguishable at low zoom is more truthful than one where they overlap. In data, no. Displacement happens in the tile-generation branch only, and no analytic output should ever be derived from displaced geometry." }
    },
    {
      "@type": "Question",
      "name": "Should generalization run during tile generation or before it?",
      "acceptedAnswer": { "@type": "Answer", "text": "Before it, and materialised. Aggregation in particular is expensive enough that recomputing it on every tile build is wasteful, and separating it makes the generalized features inspectable in their own right. A per-zoom generalized feature set is also reusable across several tile builds and other consumers." }
    }
  ]
}
</script>
