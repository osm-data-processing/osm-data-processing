---
title: "Planetiler & Tilemaker Workflows"
description: "PBF straight to tiles in one pass: how Planetiler and Tilemaker express a schema in code or a Lua profile, what each assumes about memory and disk, and when either beats a GeoJSON route."
pageTitle: "Planetiler and Tilemaker: PBF Straight to Vector Tiles"
pageDescription: "Compare Planetiler and Tilemaker for OSM tile generation — schema in Java versus a Lua profile, node-location storage, memory and disk profiles — and pick the right one for your map."
slug: planetiler-and-tilemaker-workflows
type: guide
breadcrumb: "Planetiler & Tilemaker"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Planetiler & Tilemaker Workflows

Both of these tools do something a GeoJSON-based pipeline cannot: they read an OSM extract and emit a finished tile archive in a single pass, never materialising the enormous text intermediate that dominates the alternative. That is the reason to reach for them, and the reason their schema model looks so different from a generator that just consumes features.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="ptw1-t ptw1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ptw1-t">Where the schema decision happens in a single-pass tile build</title>
  <desc id="ptw1-d">A PBF extract is read once. Each element passes through a profile, which is code or a Lua function that decides whether the element belongs in the output, which layer it goes to, which attributes it carries and at which zoom levels it appears. Elements the profile accepts are written to a temporary feature store on disk. The store is then read back per tile to produce the archive. The profile is the only place any cartographic decision is expressed.</desc>
  <defs><marker id="ptw1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">One pass, and the profile makes every decision</text>
  <rect x="26" y="86" width="240" height="56" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="146" y="110" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">PBF extract</text>
  <text x="146" y="128" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">read exactly once</text>
  <rect x="320" y="50" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="74" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">profile</text>
  <text x="440" y="92" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">layer, attrs, zooms</text>
  <rect x="320" y="122" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">feature store</text>
  <text x="440" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">temporary, on disk</text>
  <rect x="614" y="86" width="240" height="56" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="734" y="110" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">tile archive</text>
  <text x="734" y="128" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">written per tile</text>
  <line x1="266" y1="114" x2="293" y2="114" stroke="currentColor" stroke-width="1.4"/>
  <line x1="293" y1="78" x2="293" y2="150" stroke="currentColor" stroke-width="1.4"/>
  <line x1="293" y1="78" x2="317" y2="78" stroke="currentColor" stroke-width="1.4" marker-end="url(#ptw1-a)"/>
  <line x1="293" y1="150" x2="317" y2="150" stroke="currentColor" stroke-width="1.4" marker-end="url(#ptw1-a)"/>
  <line x1="560" y1="78" x2="587" y2="78" stroke="currentColor" stroke-width="1.4"/>
  <line x1="560" y1="150" x2="587" y2="150" stroke="currentColor" stroke-width="1.4"/>
  <line x1="587" y1="78" x2="587" y2="150" stroke="currentColor" stroke-width="1.4"/>
  <line x1="587" y1="114" x2="611" y2="114" stroke="currentColor" stroke-width="1.4" marker-end="url(#ptw1-a)"/>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Because the profile runs per element during the single read, it must be fast and must not need to look anything up elsewhere.</text>
</svg>
<figcaption>Everything a GeoJSON pipeline spreads across export, ranking and generation lives in one function here.</figcaption>
</figure>

## The Problem This Topic Solves

You need a complete base map from an OSM extract, and the GeoJSON route's intermediate files are the dominant cost — in disk, in time, or in both. Single-pass tools remove that intermediate entirely, which for a continent or the planet is the difference between a feasible build and an infeasible one.

The failure scenario is subtler than a crash. A team adopts a single-pass tool, copies an example profile, and gets a working map quickly. Six months later nobody can change what appears at zoom 10, because the cartographic rules are spread through a profile that was never read carefully and the tool rebuilds everything on every change. The trap is not the tool; it is treating the profile as configuration when it is the most important code in the pipeline.

## Prerequisites

Understand the tile model from [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/) and the generalization vocabulary from [Cartographic Generalization of OSM Data](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/). Know how OSM elements become geometry, from [Node, Way & Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — a profile sees elements, not ready-made features.

## The Two Tools, Honestly Compared

**Planetiler** is a Java application built for throughput. Its profile is Java code implementing an interface: a method called per element, returning the layers and attributes that element contributes. It uses memory-mapped node storage and a highly optimised feature store, and it will build a planet-wide tile set on a single large machine in hours rather than days. The cost of that speed is that the schema is a compiled artefact — changing a zoom threshold means rebuilding the profile.

**Tilemaker** is a C++ application whose profile is a Lua script plus a JSON layer configuration. The Lua functions are called per node and per way, and the JSON declares the layers with their zoom ranges. It is slower than Planetiler on very large inputs but far quicker to iterate on, because changing the schema is editing a script. For a regional map with a custom schema, that iteration speed usually matters more than raw throughput.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 342" role="img" aria-labelledby="ptw2-t ptw2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ptw2-t">Planetiler and Tilemaker compared on the properties that decide between them</title>
  <desc id="ptw2-d">A grid of five properties against the two tools. The schema lives in compiled Java for Planetiler and in a Lua script plus JSON for Tilemaker. Iteration requires a rebuild for Planetiler and only a file edit for Tilemaker. Throughput is built for planet scale for Planetiler and is comfortable at regional scale for Tilemaker. Memory demand is high for Planetiler and moderate for Tilemaker. The natural fit is a complete base map for Planetiler and a custom regional schema for Tilemaker.</desc>
  <rect x="0" y="0" width="880" height="342" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Two tools, and iteration speed is the real difference</text>
  <rect x="206" y="48" width="324" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="368" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Planetiler</text>
  <rect x="530" y="48" width="324" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="692" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Tilemaker</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Schema lives in</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">compiled Java</text>
  <text x="692" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">Lua plus JSON</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Changing it needs</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a rebuild</text>
  <text x="692" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a file edit</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Throughput</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">planet scale</text>
  <text x="692" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">regional scale</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Memory demand</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">high</text>
  <text x="692" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">moderate</text>
  <text x="30" y="289" font-size="11.5" font-weight="600" fill="currentColor">Natural fit</text>
  <line x1="26" y1="308" x2="854" y2="308" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">complete base map</text>
  <text x="692" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">custom schema</text>
  <text x="868" y="326" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Neither produces better tiles than the other; they differ in how quickly a cartographer can change what the tiles contain.</text>
</svg>
<figcaption>Choose on who will be editing the schema and how often, because that is the cost you pay every week.</figcaption>
</figure>

## Node Location Storage: the Shared Constraint

Both tools face the same fundamental problem as any OSM parser: building way geometry requires the coordinates of every referenced node, and there are far more nodes than features. The strategies are the ones discussed in [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/), applied at tile-building scale.

Planetiler defaults to a memory-mapped array indexed by node identifier, which is fast and demands either a lot of RAM or a fast local disk with generous page cache. Tilemaker offers a choice between an in-memory store and an on-disk one, with the on-disk option making a large region feasible on a modest machine at a throughput cost.

The practical rule is the same for both: **node storage is the thing that decides whether your build fits on the machine you have.** Estimate it first, before choosing zoom ranges or layers, because it is the constraint that does not negotiate.

## Validation and Error-Handling Matrix

| Condition | Root cause | Detection | Remediation |
| --- | --- | --- | --- |
| Build exhausts memory | Node store sized for a smaller region | Failure during the first read pass | Switch to on-disk node storage or add RAM |
| A layer is empty | Profile never matches its condition | Layer declared but no features written | Log match counts per layer during the profile run |
| Relations missing from output | Profile does not handle relation members | Multipolygons absent, ways present | Implement the relation handling the tool provides |
| Build succeeds, map is blank | Layer names differ from the style | Metadata declares unexpected layer names | Align profile layer names with the style |
| Attributes inconsistent | Profile writes different types per branch | Client reports mixed attribute types | Coerce every attribute to one type in the profile |
| Very slow build | Profile does expensive work per element | Throughput far below the tool's baseline | Move lookups out of the per-element path |
| Zoom ranges ignored | Range declared in the wrong place | Features appear outside their intended zooms | Declare ranges where the tool expects them |

## Performance and Scale

Three things dominate a single-pass build.

**The profile's per-element cost.** It runs hundreds of millions of times. A regular expression compiled inside it, a hash lookup against a large table, or anything touching the filesystem turns a two-hour build into a twelve-hour one. Precompute everything the profile needs into a small immutable structure before the run starts.

**Node storage.** As above: it is the constraint that decides feasibility rather than speed.

**The feature store's disk.** Both tools write an intermediate feature store to disk and read it back per tile. That store is written once and read in a spatially sorted order, so sequential throughput matters more than latency, but there must be room for it — typically a multiple of the extract size.

Neither tool parallelises the profile across machines, so scaling is vertical. For very large builds that means one big machine for a few hours rather than a cluster, which is usually simpler and cheaper.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="ptw3-t ptw3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ptw3-t">Where the wall-clock time goes in a typical single-pass build</title>
  <desc id="ptw3-d">Five phases of a single-pass build with their approximate share of total runtime. Reading the extract and running the profile over every element takes the largest share. Writing and sorting the intermediate feature store takes the next largest. Rendering tiles from the sorted store takes a moderate share. Writing the archive takes a small share. Computing metadata takes a negligible share. A note observes that profile cost lands entirely in the first phase, which is why per-element work dominates.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The first phase is where a slow profile shows up</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Read plus profile</text>
  <rect x="256" y="60" width="478" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 46%</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Sort feature store</text>
  <rect x="256" y="100" width="291" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 28%</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Render tiles</text>
  <rect x="256" y="140" width="187" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 18%</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Write archive</text>
  <rect x="256" y="180" width="73" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 7%</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">Metadata</text>
  <rect x="256" y="220" width="10" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 1%</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Profile cost lands entirely in the first bar, so a profile twice as slow makes the whole build roughly half again as long.</text>
</svg>
<figcaption>Optimising the later phases is optimising a quarter of the build; optimising the profile is optimising half of it.</figcaption>
</figure>

## What a Profile Cannot Easily Do

Both tools trade flexibility for the single pass, and it is worth naming what that costs before adopting one.

**It cannot look anything up.** The profile sees one element at a time, with no index of what came before and no way to query a database without destroying throughput. A rule such as "render this building only if it is inside a named settlement" needs the containment computed elsewhere and attached to the element beforehand, which usually means a preprocessing pass — at which point part of the advantage of the single pass has been given back.

**It cannot aggregate across features.** Merging a block of adjacent buildings into one built-up polygon, as described in [Merging Adjacent OSM Polygons for Low Zoom](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/merging-adjacent-osm-polygons-for-low-zoom/), needs all the members present at once. The tools provide limited coalescing of identical adjacent geometry at render time, but genuine cartographic aggregation is a preprocessing step.

**It cannot easily be tested in isolation.** A profile function depends on the host's tag-access API, so unit-testing it means either running the tool over a small fixture extract or building a harness that fakes those functions. Running against a single-city extract is usually the pragmatic answer, and it is fast enough to sit in a change workflow.

**It cannot update incrementally.** A schema change means a full rebuild. That is the operational fact that makes the invalidation work in [Serving & Invalidating OSM Tiles](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/) a separate concern rather than something the generator handles.

None of these is a reason to avoid single-pass tools for a base map, where the schema is stable and the input is large. They are reasons to keep thematic layers whose rules need context in a separate, GeoJSON-based pipeline, and to combine the two archives at serving time rather than forcing every layer through one tool.

## Failure Modes and Gotchas

- **The profile is code, not configuration.** It deserves tests, review and a changelog, because it is where every cartographic decision lives.
- **Per-element work is multiplied by hundreds of millions.** Anything not constant-time in the profile is a build-time problem.
- **Relations need explicit handling.** A profile that only implements the node and way callbacks silently drops every multipolygon.
- **Attribute types must be consistent.** A branch returning a number where another returns a string produces attributes clients cannot use reliably.
- **Layer names are a contract with the style.** Renaming a layer in the profile silently blanks part of the map.
- **Rebuilds are all-or-nothing.** Neither tool updates a tile set incrementally, so a schema change means a full rebuild — which is why invalidation is handled separately.

## Integration Points

Upstream, the input is a verified extract from [OSM Extract Providers & Automated Downloads](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/); no GeoJSON stage is involved. Downstream, the archive is served and invalidated exactly as a Tippecanoe-produced one is, per [Serving & Invalidating OSM Tiles](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/) — the tools differ in how tiles are produced, not in what they produce.

The two guides below take each tool in turn: [Running Planetiler on a Regional Extract](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/running-planetiler-on-a-regional-extract/) and [Writing a Tilemaker Lua Profile for OSM Tags](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/writing-a-tilemaker-lua-profile-for-osm-tags/).

## Guides in This Topic

- [Running Planetiler on a Regional Extract](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/running-planetiler-on-a-regional-extract/) — sizing memory and disk, running the build, and reading its progress output.
- [Writing a Tilemaker Lua Profile for OSM Tags](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/writing-a-tilemaker-lua-profile-for-osm-tags/) — layer assignment, attributes and zoom ranges in a profile you can iterate on.

## Frequently Asked Questions

<details>
<summary>Should I use a single-pass tool or a GeoJSON pipeline?</summary>

It depends on the size of the input and on who edits the schema. For a continent or the planet, the GeoJSON intermediate is often simply too large to materialise, and a single-pass tool is the only practical option. For a city or a small region with a schema a cartographer iterates on frequently, the GeoJSON route keeps each stage independently inspectable, which is worth a lot during development. Many teams use both: single-pass for the base map, GeoJSON for thematic overlays.
</details>

<details>
<summary>Why is my build so much slower than the tool's published numbers?</summary>

Almost always because the profile does expensive work per element. It runs once for every node, way and relation in the extract — hundreds of millions of times on a country file — so compiling a regular expression, allocating a collection or consulting a large lookup inside it multiplies that cost by the element count. Precompute everything into an immutable structure before the run and keep the per-element path to constant-time operations.
</details>

<details>
<summary>Why are my multipolygons missing?</summary>

Because the profile implements handling for nodes and ways but not for relations, which is the default state of a profile copied from a minimal example. Areas mapped as multipolygon relations — most large lakes, forests and complex buildings — arrive as relations and are silently dropped if nothing handles them. The symptom is a map that looks complete until you notice every large water body is absent.
</details>

<details>
<summary>Can these tools update an existing tile set incrementally?</summary>

Not on their own. Both are batch builders that produce a complete archive from an extract, so a change means a full rebuild. Keeping a tile set current after a diff is a separate concern handled by computing which tiles changed and re-rendering only those, which is why invalidation is treated as its own topic rather than as a feature of the generator.
</details>

<details>
<summary>How much disk does a single-pass build need?</summary>

Enough for the node store and the intermediate feature store on top of the output archive, which together are typically several times the extract size. The feature store is written once and read back in spatial order, so sequential throughput matters more than random latency. Size it before starting: both tools fail late, well into a build, when the disk fills.
</details>

## Related

- [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/) — the parent section and the schema decisions a profile encodes.
- [Building OSM Tiles with Tippecanoe](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/) — the GeoJSON-based alternative.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — the node-storage strategies both tools implement.
- [Serving & Invalidating OSM Tiles](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/) — what happens to the archive afterwards.
- [Understanding OSM Multipolygon Relations for GIS](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/) — the relation handling a profile must implement.
- [Cartographic Generalization of OSM Data](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/cartographic-generalization-of-osm-data/) — the decisions the profile is expressing.

Up one level: [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Planetiler & Tilemaker Workflows",
  "description": "PBF straight to tiles in one pass: how Planetiler and Tilemaker express a schema in code or a Lua profile, what each assumes about memory and disk, and when either beats a GeoJSON route.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Vector Tiles & Rendering Pipelines",
  "about": ["Planetiler", "Tilemaker", "single-pass tile generation"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Vector Tiles & Rendering Pipelines", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/" },
    { "@type": "ListItem", "position": 3, "name": "Planetiler & Tilemaker Workflows", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Choose and run a single-pass OSM tile generator",
  "description": "Estimate node storage first, pick between a compiled profile and a scripted one based on who edits the schema, keep per-element work constant-time, and handle relations explicitly.",
  "step": [
    { "@type": "HowToStep", "name": "Estimate node storage first", "text": "Size the node location store for the extract before choosing layers or zoom ranges, because it decides whether the build fits the machine." },
    { "@type": "HowToStep", "name": "Choose on iteration speed", "text": "Prefer a scripted profile when a cartographer will change the schema often, and a compiled one when planet-scale throughput dominates." },
    { "@type": "HowToStep", "name": "Precompute for the profile", "text": "Build every lookup the profile needs into an immutable structure before the run, keeping the per-element path constant-time." },
    { "@type": "HowToStep", "name": "Handle relations explicitly", "text": "Implement the relation callback so multipolygon areas are not silently dropped." },
    { "@type": "HowToStep", "name": "Keep attribute types consistent", "text": "Coerce each attribute to a single type across every branch of the profile." },
    { "@type": "HowToStep", "name": "Size the feature store disk", "text": "Provision several times the extract size for the intermediate feature store, on a volume with good sequential throughput." }
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
      "name": "Should I use a single-pass tile tool or a GeoJSON pipeline?",
      "acceptedAnswer": { "@type": "Answer", "text": "It depends on the size of the input and on who edits the schema. For a continent or the planet, the GeoJSON intermediate is often too large to materialise, and a single-pass tool is the only practical option. For a city or small region with a schema a cartographer iterates on frequently, the GeoJSON route keeps each stage independently inspectable." }
    },
    {
      "@type": "Question",
      "name": "Why is my single-pass tile build so much slower than published numbers?",
      "acceptedAnswer": { "@type": "Answer", "text": "Almost always because the profile does expensive work per element. It runs once for every node, way and relation — hundreds of millions of times on a country file — so compiling a regular expression or consulting a large lookup inside it multiplies that cost by the element count. Precompute everything into an immutable structure before the run." }
    },
    {
      "@type": "Question",
      "name": "Why are my multipolygons missing from generated tiles?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because the profile implements handling for nodes and ways but not for relations, which is the default state of a profile copied from a minimal example. Areas mapped as multipolygon relations are silently dropped if nothing handles them. The symptom is a map that looks complete until you notice every large water body is absent." }
    },
    {
      "@type": "Question",
      "name": "Can Planetiler or Tilemaker update a tile set incrementally?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not on their own. Both are batch builders that produce a complete archive from an extract, so a change means a full rebuild. Keeping a tile set current after a diff is a separate concern handled by computing which tiles changed and re-rendering only those." }
    },
    {
      "@type": "Question",
      "name": "How much disk does a single-pass tile build need?",
      "acceptedAnswer": { "@type": "Answer", "text": "Enough for the node store and the intermediate feature store on top of the output archive, which together are typically several times the extract size. The feature store is written once and read back in spatial order, so sequential throughput matters more than random latency. Size it before starting: both tools fail late when the disk fills." }
    }
  ]
}
</script>
