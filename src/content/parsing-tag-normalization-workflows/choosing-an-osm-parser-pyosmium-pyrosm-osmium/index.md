---
title: "pyosmium vs pyrosm vs osmium-tool: Choosing the Right Parser"
description: "A decision guide for picking an OSM parser: pyosmium for streaming, pyrosm for GeoDataFrames, osmium-tool for whole-file ops, and osmx for random id access."
pageTitle: "pyosmium vs pyrosm vs osmium-tool: Choosing an OSM Parser"
pageDescription: "Map task and scale to the right OSM parser — pyosmium streaming, pyrosm GeoDataFrames, osmium-tool CLI transforms, osmx random access — with a decision matrix and code sketches."
slug: choosing-an-osm-parser-pyosmium-pyrosm-osmium
type: guide
breadcrumb: "Choosing an OSM Parser"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# pyosmium vs pyrosm vs osmium-tool: Choosing the Right Parser

Reaching for the wrong OSM reader is the quietest way to sink a pipeline. A team that prototypes on a city extract with pyrosm, loves how a `.osm.pbf` drops straight into a GeoDataFrame, and then points the same script at a continental file discovers the failure the hard way: the process climbs past available RAM and the kernel kills it mid-run, hours in, with nothing written. The inverse mistake is just as costly — hand-rolling a pyosmium streaming handler to clip a bounding box that `osmium extract` would have carved in a single fast pass, or looping a whole-file scan every time you need one object by id. None of these tools is wrong; each was built for a different access pattern, and the skill this guide teaches is matching the task and the scale to the reader before you write the first line. It belongs to the broader [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) stage, where ingestion sets the ceiling on everything downstream.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1040 480" role="img" aria-label="A decision tree that routes an OSM processing task to the right parser. First question: is it a whole-file transform such as clip, merge, dedup, or applying a diff? If yes, use osmium-tool, the command-line tool that is fastest for whole-file operations. If no, next question: do you need random access to a single object by its id? If yes, use osmx, an on-disk store built for point lookups. If no, next question: do you want a GeoDataFrame for city or region analysis? If yes, use pyrosm, which reads PBF straight into GeoDataFrames. Otherwise, use pyosmium for streaming filters and diffs with bounded, constant memory." xmlns:xlink="http://www.w3.org/1999/xlink" style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Decision tree mapping an OSM task and scale to pyosmium, pyrosm, osmium-tool, or osmx</title>
  <desc>Four sequential questions each branch right to a recommended tool. Whole-file transform such as clip, merge, dedup, or apply diff routes to osmium-tool. Random access by object id routes to osmx. Wanting a GeoDataFrame for city or region analysis routes to pyrosm. The default fall-through, a streaming filter or diff at planet scale with bounded memory, routes to pyosmium.</desc>
  <defs>
    <marker id="cop-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="1040" height="480" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="520" y="28" text-anchor="middle" font-size="15" fill="currentColor" font-weight="700">Match the task and the scale to the reader</text>
  <!-- Q1 -->
  <rect x="60" y="70" width="340" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="230" y="96" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">Whole-file transform?</text>
  <text x="230" y="116" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">clip · merge · dedup · apply diff</text>
  <rect x="620" y="70" width="360" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="800" y="96" text-anchor="middle" font-size="13" fill="currentColor" font-weight="700">osmium-tool (CLI)</text>
  <text x="800" y="116" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">fastest whole-file ops</text>
  <line x1="400" y1="102" x2="618" y2="102" stroke="currentColor" stroke-width="1.5" marker-end="url(#cop-arr)"/>
  <text x="500" y="94" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">yes</text>
  <!-- Q2 -->
  <rect x="60" y="170" width="340" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="230" y="196" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">Random access by id?</text>
  <text x="230" y="216" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">point lookups, not a scan</text>
  <rect x="620" y="170" width="360" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="800" y="196" text-anchor="middle" font-size="13" fill="currentColor" font-weight="700">osmx</text>
  <text x="800" y="216" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">on-disk store, id → element</text>
  <line x1="400" y1="202" x2="618" y2="202" stroke="currentColor" stroke-width="1.5" marker-end="url(#cop-arr)"/>
  <text x="500" y="194" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">yes</text>
  <!-- Q3 -->
  <rect x="60" y="270" width="340" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="230" y="296" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">Want a GeoDataFrame?</text>
  <text x="230" y="316" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">city / region analysis</text>
  <rect x="620" y="270" width="360" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="800" y="296" text-anchor="middle" font-size="13" fill="currentColor" font-weight="700">pyrosm</text>
  <text x="800" y="316" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">PBF → GeoDataFrame</text>
  <line x1="400" y1="302" x2="618" y2="302" stroke="currentColor" stroke-width="1.5" marker-end="url(#cop-arr)"/>
  <text x="500" y="294" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">yes</text>
  <!-- Default -->
  <rect x="60" y="370" width="340" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="230" y="396" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">Otherwise: stream / diff</text>
  <text x="230" y="416" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">planet scale, bounded RAM</text>
  <rect x="620" y="370" width="360" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="800" y="396" text-anchor="middle" font-size="13" fill="currentColor" font-weight="700">pyosmium</text>
  <text x="800" y="416" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">streaming callbacks, constant RSS</text>
  <line x1="400" y1="402" x2="618" y2="402" stroke="currentColor" stroke-width="1.5" marker-end="url(#cop-arr)"/>
  <text x="500" y="394" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">else</text>
  <!-- no chain -->
  <line x1="230" y1="134" x2="230" y2="168" stroke="currentColor" stroke-width="1.5" marker-end="url(#cop-arr)"/>
  <text x="252" y="156" text-anchor="start" font-size="10.5" fill="currentColor" opacity="0.9">no</text>
  <line x1="230" y1="234" x2="230" y2="268" stroke="currentColor" stroke-width="1.5" marker-end="url(#cop-arr)"/>
  <text x="252" y="256" text-anchor="start" font-size="10.5" fill="currentColor" opacity="0.9">no</text>
  <line x1="230" y1="334" x2="230" y2="368" stroke="currentColor" stroke-width="1.5" marker-end="url(#cop-arr)"/>
  <text x="252" y="356" text-anchor="start" font-size="10.5" fill="currentColor" opacity="0.9">no</text>
</svg>

The four candidates are not interchangeable layers of one stack; they occupy distinct points on the trade-off between memory and convenience. [pyosmium](https://docs.osmcode.org/pyosmium/latest/) is a thin Python binding over the libosmium C++ core that hands you elements one at a time through callback handlers, so a script's resident memory stays flat whether the input is a district or the whole planet. pyrosm sits at the opposite corner: it reads a PBF straight into a GeoDataFrame so you can filter, join, and plot in familiar pandas idioms, paying for that convenience with a memory footprint proportional to the result set. osmium-tool is the command-line workhorse for moving whole files around — clipping, merging, deduplicating, applying change files, filtering by time — and it is almost always faster than reimplementing those operations in Python. osmx is the outlier: it expands an extract into an on-disk key-value store so you can fetch a single node, way, or relation by id in roughly constant time, which no streaming reader can do.

## Prerequisites

This guide compares readers of the same byte streams, so a working mental model of those streams pays off. Read the [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/) first: every tool here prefers `.osm.pbf`, and knowing why the binary format is 5–10× smaller and block-framed explains why streaming is even possible. The [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) then details the dense, delta-encoded blocks that libosmium — the engine under both pyosmium and osmium-tool — decodes one at a time. Finally, the [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) governs the single hardest cross-cutting concern in parser choice: a way is only geometry once its node references are resolved to coordinates, and each tool resolves those references differently. If you already have a concrete how-to in mind rather than a choice to make, the ingestion pattern in [async PBF parsing with pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) shows one of these tools driven end to end.

## Decision Matrix: Tool Against Axis

The table below is the compressed form of the whole guide. Read down the column that names your binding constraint — memory, output shape, or scale — and the row it selects is your starting default. The prose after it explains the edges where the default flips.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 278" role="img" aria-labelledby="parser-fit-t parser-fit-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="parser-fit-t">Which parser fits which job, by the shape of the output you need</title>
  <desc id="parser-fit-d">A grid of four output shapes against the three tools. For a filtered PBF written back to disk, osmium-tool is the direct fit, pyosmium needs a writer and pyrosm cannot do it. For a GeoDataFrame of a layer, pyrosm is the direct fit, pyosmium needs geometry assembly by hand and osmium-tool cannot produce one. For custom per-object logic, pyosmium is the fit, pyrosm cannot express it and osmium-tool cannot either. For a one-off count or extract in a shell script, osmium-tool is the fit and both libraries are overkill.</desc>
  <rect x="0" y="0" width="880" height="278" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The right parser follows from the output shape, not from benchmarks</text>
  <text x="317" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">osmium-tool</text>
  <text x="531" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">pyosmium</text>
  <text x="745" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">pyrosm</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">filtered PBF back to disk</text>
  <rect x="213" y="84" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="317" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">direct fit</text>
  <rect x="427" y="84" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="531" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">needs a writer</text>
  <rect x="641" y="84" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="745" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">cannot</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">GeoDataFrame of a layer</text>
  <rect x="213" y="124" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="317" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">cannot</text>
  <rect x="427" y="124" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="531" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">assemble geometry yourself</text>
  <rect x="641" y="124" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="745" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">direct fit</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">custom per-object logic</text>
  <rect x="213" y="164" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="317" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">cannot</text>
  <rect x="427" y="164" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="531" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">direct fit</text>
  <rect x="641" y="164" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="745" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">cannot</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">a count in a shell script</text>
  <rect x="213" y="204" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="317" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">direct fit</text>
  <rect x="427" y="204" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="531" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">overkill</text>
  <rect x="641" y="204" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="745" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">overkill</text>
  <text x="440" y="260" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">A common and healthy combination: osmium-tool to cut and filter, pyrosm to load what is left into a frame.</text>
</svg>
<figcaption>The tools are not ranked; they answer different questions. Most pipelines end up using osmium-tool to prepare a file and one of the libraries to read it.</figcaption>
</figure>

| Tool | Access pattern | Memory profile | Output type | Best scale | Typical use |
|---|---|---|---|---|---|
| **pyosmium** | Sequential streaming; one callback per element | Bounded and roughly constant; a location store adds a fixed ceiling | Whatever your handler emits — counts, rows, filtered PBF | Regional to planet | Filtering, extraction, custom aggregation, applying diffs |
| **pyrosm** | Full-file single pass into memory | High; scales with the result GeoDataFrame, not the file | `geopandas.GeoDataFrame` with geometry reconstructed | City to region | Analytical convenience, direct handoff to GIS and plotting |
| **osmium-tool** | Whole-file transform, streamed internally | Bounded; libosmium streams blocks | New `.osm.pbf` / `.osc` files on disk | Regional to planet | Clip, merge, dedup, apply-changes, time and tag filtering |
| **osmx** | Random access by object id | On-disk, memory-mapped; only touched pages resident | Single node, way, or relation by id | Regional (after a one-time expand) | Point lookups, on-demand geometry rebuild, id joins |

Two axes dominate the choice. The first is whether you need the *whole* file transformed or a *subset* examined — the former is osmium-tool's home, the latter splits between streaming (pyosmium) and materializing (pyrosm). The second is the shape of the output: if the next stage wants a GeoDataFrame, pyrosm saves you the reconstruction code; if it wants counts, a filtered file, or your own records, pyosmium keeps memory flat while you build exactly that. osmx answers a third, orthogonal question — "give me object 240109189 and nothing else" — that the scanning tools answer only by reading everything.

## Step-by-Step: What Each Tool Looks Like in Practice

Seeing the same intent expressed four ways makes the trade-offs concrete. Each sketch below is minimal but runnable against a real extract.

### pyosmium — streaming, bounded memory

pyosmium's `SimpleHandler` dispatches a method per primitive type. Nothing accumulates unless you accumulate it, so counting every highway in a planet file costs the same memory as counting them in a town.

```python
import logging

import osmium

logger = logging.getLogger(__name__)


class HighwayCounter(osmium.SimpleHandler):
    """Count highway ways without holding the file in memory."""

    def __init__(self) -> None:
        super().__init__()
        self.count: int = 0

    def way(self, w: osmium.osm.Way) -> None:
        if "highway" in w.tags:
            self.count += 1


handler = HighwayCounter()
handler.apply_file("region.osm.pbf")  # one callback per element; flat RSS
logger.info("highway ways: %d", handler.count)
```

To turn ways into geometry, pass `locations=True` to `apply_file` so pyosmium maintains a node-location store — the same lever that appears throughout [memory-efficient chunk processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/), where the store choice (`flex_mem` versus a disk-backed array) is what keeps a continental run inside its budget.

### pyrosm — straight to a GeoDataFrame

pyrosm trades memory for zero reconstruction code. One call yields a GeoDataFrame with geometry already assembled, ready for a spatial join or a plot.

```python
from pyrosm import OSM

osm = OSM("city.osm.pbf")
roads = osm.get_network(network_type="driving")   # GeoDataFrame, geometry built
buildings = osm.get_buildings()                    # another full pass

print(roads[["highway", "maxspeed", "geometry"]].head())
```

Each `get_*` call re-reads the file, so extract the classes you need in as few calls as possible. This is the convenient front door for the analytical workflows in [async PBF parsing with pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) — which exists precisely because that convenience becomes a bottleneck at scale and has to be parallelized behind a bounded queue.

### osmium-tool — whole-file operations from the shell

For anything that reshapes a file rather than analyzing its contents, the CLI is the fast path. These operations stream internally and run in C++, so they routinely beat a Python reimplementation by an order of magnitude.

```bash
# Clip to a bounding box (west,south,east,north) — the fastest extraction path
osmium extract -b 13.30,52.42,13.55,52.62 planet.osm.pbf -o berlin.osm.pbf

# Merge several extracts into one sorted file
osmium merge north.osm.pbf south.osm.pbf -o combined.osm.pbf

# Apply a change file to roll an extract forward
osmium apply-changes berlin.osm.pbf 4021.osc.gz -o berlin-updated.osm.pbf

# Keep only objects matching a tag filter
osmium tags-filter planet.osm.pbf w/highway -o highways.osm.pbf
```

The `apply-changes` and time-filter subcommands are the entry point to replication work; a pipeline that keeps an extract current is built on exactly these primitives, sequenced and scheduled.

### osmx — random access by id

osmx expands an extract once into an on-disk store, after which any object is a direct lookup. The `expand` step is the cost; every read afterward is cheap.

```bash
# One-time: expand the extract into an on-disk store (osmx ships its own CLI)
osmx expand region.osm.pbf region.osmx
```

```python
import osmx

env = osmx.Environment("region.osmx")
with osmx.Transaction(env) as txn:
    locations = osmx.Locations(txn)
    node = locations.get(240109189)   # constant-time fetch by node id
    ways = osmx.Ways(txn)
    way = ways.get(4305005)           # random way lookup, no full scan
```

No scanning reader can serve that pattern: pyosmium and osmium-tool would each read the entire file to reach one object. When your workload is "resolve these 10,000 ids against a fixed extract," the one-time expand pays for itself immediately.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Choose an OSM parser for a processing task",
  "description": "Route an OpenStreetMap processing task to pyosmium, pyrosm, osmium-tool, or osmx by evaluating the access pattern, memory budget, output shape, and data scale.",
  "step": [
    { "@type": "HowToStep", "name": "Classify the operation", "text": "Decide whether the task transforms a whole file (clip, merge, dedup, apply diff) or examines a subset of its contents; whole-file transforms go to osmium-tool." },
    { "@type": "HowToStep", "name": "Check for random access", "text": "If the task fetches individual objects by id rather than scanning, expand the extract into an osmx store for constant-time lookups." },
    { "@type": "HowToStep", "name": "Decide the output shape", "text": "If the next stage needs a GeoDataFrame on a city or region extract, use pyrosm; if it needs counts, a filtered file, or custom records, use pyosmium." },
    { "@type": "HowToStep", "name": "Respect the memory budget", "text": "For continental or planet scale, prefer pyosmium streaming with an appropriate node-location store so resident memory stays bounded." },
    { "@type": "HowToStep", "name": "Measure before committing", "text": "Benchmark peak RSS and throughput of the shortlisted readers on the same extract and let the numbers settle any remaining tie." }
  ]
}
</script>

## Validation & Error-Handling Matrix

Most parser regrets show up as one of a handful of symptoms. Each row pairs a symptom with the tool mismatch that usually causes it and the corrective move.

| Symptom | Likely mismatch | Detection | Fix |
|---|---|---|---|
| `MemoryError` / OOM kill loading an extract | pyrosm on a continental or planet file | RSS climbs to the ceiling then the kernel kills the process | Stream with pyosmium, or pre-clip with `osmium extract` to a region pyrosm can hold |
| Way geometry has no coordinates | Streaming without a location store | `nr.location.valid()` is false in the `way` callback | Pass `locations=True` (and choose `flex_mem` or a disk-backed store) |
| `osmium extract` unexpectedly slow | `complete_ways` strategy re-reading the file | Two-pass I/O visible in progress output | Use `--strategy=smart` when boundary-spanning ways are not required |
| `KeyError` fetching an id from osmx | Store never fully expanded, or id absent | Lookup raises immediately | Re-run `osmx expand`; confirm the object exists in the source extract |
| Per-element Python callbacks dominate runtime | Heavy filtering logic inside a pyosmium handler | CPU pinned in Python, not libosmium | Pre-filter with `osmium tags-filter`, then stream the smaller file |
| GeoDataFrame missing expected feature classes | Wrong `get_*` call, or a sparse tile | `roads.empty` is true on a populated region | Confirm the network type and tag filters; re-read the correct feature class |
| Two runs disagree on element order | Assuming pyrosm preserves source id order | Diff of two outputs differs | Sort explicitly; do not rely on GeoDataFrame row order for reproducibility |

## Performance & Scale Considerations

The scaling behaviour of each reader is predictable once you know what it holds in memory. pyosmium holds one element plus, optionally, a node-location store whose size is a function of node count, not file size; that ceiling is fixed for a given planet, so a streaming filter's peak RSS is nearly independent of how much work it does per element. pyrosm holds the reconstructed GeoDataFrame for the feature classes you requested, so its peak scales with the *result*, which is why a dense urban extract can cost more than a sparse continental one covering ten times the area. osmium-tool streams blocks and buffers only a window of them, so its footprint is bounded regardless of input size — its cost is I/O and CPU, not memory. osmx front-loads all cost into the `expand` phase and then memory-maps the store, keeping only touched pages resident.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 282" role="img" aria-labelledby="parser-mem-t parser-mem-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="parser-mem-t">Peak memory of the three parsers on the same country extract</title>
  <desc id="parser-mem-d">A bar chart of peak resident memory reading a 1.2 gigabyte country extract. osmium-tool filtering to a new file uses 240 megabytes because it streams. pyosmium with a handler and no node cache uses 310 megabytes. pyosmium with a dense node cache for way geometries uses 3.4 gigabytes. pyrosm loading the road network as a GeoDataFrame uses 6.8 gigabytes because the whole layer is materialised.</desc>
  <rect x="0" y="0" width="880" height="282" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Memory follows what you materialise, not which library you chose</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">peak resident memory, 1.2 GB country extract</text>
  <line x1="250" y1="68" x2="250" y2="228" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">osmium-tool filter to file</text>
  <rect x="250" y="74" width="16" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="276" y="89" font-size="11" fill="currentColor" opacity="0.9">240 MB · pure stream</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">pyosmium handler, tags only</text>
  <rect x="250" y="116" width="20" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="280" y="131" font-size="11" fill="currentColor" opacity="0.9">310 MB · pure stream</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">pyosmium + node cache</text>
  <rect x="250" y="158" width="224" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="484" y="173" font-size="11" fill="currentColor" opacity="0.9">3.4 GB · way geometries</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">pyrosm → GeoDataFrame</text>
  <rect x="250" y="200" width="448" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="708" y="215" font-size="11" fill="currentColor" opacity="0.9">6.8 GB · whole layer in memory</text>
  <text x="440" y="264" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">If the last row does not fit, the fix is not a different library — it is filtering the extract down with the first row before loading it.</text>
</svg>
<figcaption>The split is between streaming and materialising, not between libraries. The moment you need way geometries you are holding node positions, and that is where the memory goes regardless of the tool.</figcaption>
</figure>

The practical rule of thumb: below roughly a country-sized extract, pyrosm's convenience usually wins and its memory cost is tolerable; above it, the reconstruction that made pyrosm pleasant becomes the thing that OOMs, and pyosmium streaming (or an osmium-tool pre-clip) takes over. But rules of thumb are no substitute for measurement on *your* extract and *your* machine — the sibling reference on [benchmarking OSM parser memory and throughput](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/benchmarking-osm-parser-memory-and-throughput/) gives a harness that records peak RSS and elements per second for pyosmium and pyrosm on the same file, so the crossover point stops being a guess.

## Failure Modes & Gotchas

- **pyrosm's memory is set by the result, not the file.** A 200 MB dense city extract can produce a larger GeoDataFrame than a 2 GB sparse rural one. Size the machine against the expected output, not the input on disk.
- **Streaming without a location store yields ways with no geometry.** The `way` callback sees node references, not coordinates, unless pyosmium is resolving locations for you. Forgetting `locations=True` is the most common "why is my geometry empty" bug.
- **osmium-tool's default extract strategy is not always what you want.** `complete_ways` and `smart` trade completeness at tile edges against speed and a second read pass; pick deliberately rather than accepting the default silently.
- **osmx's expand cost is real.** Building the store reads and rewrites the whole extract to disk. It only pays off when you will do many random lookups; for a single scan it is pure overhead.
- **Mixing tools means re-reading.** Handing a pyrosm GeoDataFrame to a pyosmium handler, or vice versa, usually means the file is parsed twice. Choose one reader per pass and design the pass to emit everything the next stage needs.
- **Version skew in the libosmium core.** pyosmium and osmium-tool wrap libosmium but can ship different versions; when a PBF quirk parses in one and not the other, check the underlying library versions before blaming the file.

## Integration Points: Where the Choice Feeds the Next Stage

The parser you pick shapes the interface to everything downstream. A pyosmium streaming pass is the natural producer for the windowed pipelines in [memory-efficient chunk processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/): the handler emits records, the chunker batches them to a memory budget, and nothing ever materializes the whole file. A pyrosm read, by contrast, hands a GeoDataFrame directly to normalization and analysis, which is why the async pattern in [async PBF parsing with pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) wraps it in workers and a bounded queue to keep that convenience affordable at scale. osmium-tool sits *before* the Python stage: it clips, merges, or rolls a file forward so the reader that follows sees a smaller, cleaner input.

```python
import logging

import osmium

logger = logging.getLogger(__name__)


class TagWriter(osmium.SimpleHandler):
    """Stream ways and emit normalized rows the next stage consumes."""

    def __init__(self, sink) -> None:
        super().__init__()
        self.sink = sink
        self.rows: int = 0

    def way(self, w: osmium.osm.Way) -> None:
        if "highway" not in w.tags:
            return
        self.sink.append({
            "id": w.id,
            "highway": w.tags.get("highway"),
            "name": w.tags.get("name"),
        })
        self.rows += 1
```

That handler is deliberately a producer, not a consumer: it decides *what* to emit but leaves batching, back-pressure, and writing to the chunk-processing stage, keeping ingestion and transformation cleanly separated.

## Explore the Benchmarking Reference in Depth

- [Benchmarking OSM Parser Memory and Throughput](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/benchmarking-osm-parser-memory-and-throughput/) — a runnable harness that measures peak RSS and elements-per-second for pyosmium and pyrosm on the same extract, so the crossover between streaming and materializing is evidence, not intuition.

## Frequently Asked Questions

<details>
<summary>When should I use pyrosm instead of pyosmium?</summary>

Use pyrosm when you want a GeoDataFrame on a city or region extract and the convenience of geometry reconstructed for you outweighs the memory cost. Use pyosmium when the input is continental or planet scale, when memory must stay bounded, or when you are emitting counts, a filtered file, or custom records rather than a table. The crossover is roughly a country-sized extract, but you should confirm it by measuring peak memory on your own file rather than trusting the rule of thumb.
</details>

<details>
<summary>Is osmium-tool a replacement for the Python libraries?</summary>

No — it is complementary. osmium-tool is the fastest way to transform whole files: clipping to a bounding box, merging extracts, deduplicating, applying change files, and filtering by tag or time. It does not build GeoDataFrames or run custom per-element Python logic. The common pattern is to use osmium-tool to prepare a smaller, cleaner input and then hand that file to pyosmium or pyrosm for the analytical work.
</details>

<details>
<summary>What is osmx for, and when is building the store worth it?</summary>

osmx expands an extract into an on-disk key-value store so you can fetch any node, way, or relation by id in roughly constant time. That is something no scanning reader can do without reading the whole file. The expand step is expensive because it rewrites the extract to disk, so osmx pays off only when your workload performs many random lookups against a fixed extract — resolving thousands of ids, rebuilding geometry on demand, or joining by id.
</details>

<details>
<summary>How do I choose between pyosmium and osmium-tool for extraction?</summary>

If you only need to carve out a bounding box or a tag subset and write it back to a file, osmium-tool's `extract` and `tags-filter` are faster and require no code. Reach for a pyosmium handler when the filtering logic is more than a tag match — conditional on geometry, on relationships between elements, or producing a non-PBF output such as aggregated counts. A useful hybrid is to pre-filter with osmium-tool, then stream the reduced file through pyosmium.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "When should I use pyrosm instead of pyosmium?",
      "acceptedAnswer": { "@type": "Answer", "text": "Use pyrosm when you want a GeoDataFrame on a city or region extract and the convenience of geometry reconstructed for you outweighs the memory cost. Use pyosmium when the input is continental or planet scale, when memory must stay bounded, or when you are emitting counts, a filtered file, or custom records rather than a table. The crossover is roughly a country-sized extract, but confirm it by measuring peak memory on your own file rather than trusting the rule of thumb." }
    },
    {
      "@type": "Question",
      "name": "Is osmium-tool a replacement for the Python libraries?",
      "acceptedAnswer": { "@type": "Answer", "text": "No, it is complementary. osmium-tool is the fastest way to transform whole files: clipping to a bounding box, merging extracts, deduplicating, applying change files, and filtering by tag or time. It does not build GeoDataFrames or run custom per-element Python logic. The common pattern is to use osmium-tool to prepare a smaller, cleaner input and then hand that file to pyosmium or pyrosm for the analytical work." }
    },
    {
      "@type": "Question",
      "name": "What is osmx for, and when is building the store worth it?",
      "acceptedAnswer": { "@type": "Answer", "text": "osmx expands an extract into an on-disk key-value store so you can fetch any node, way, or relation by id in roughly constant time, which no scanning reader can do without reading the whole file. The expand step is expensive because it rewrites the extract to disk, so osmx pays off only when your workload performs many random lookups against a fixed extract, such as resolving thousands of ids, rebuilding geometry on demand, or joining by id." }
    },
    {
      "@type": "Question",
      "name": "How do I choose between pyosmium and osmium-tool for extraction?",
      "acceptedAnswer": { "@type": "Answer", "text": "If you only need to carve out a bounding box or a tag subset and write it back to a file, osmium-tool extract and tags-filter are faster and require no code. Reach for a pyosmium handler when the filtering logic is more than a tag match, such as conditional on geometry, on relationships between elements, or producing a non-PBF output like aggregated counts. A useful hybrid is to pre-filter with osmium-tool and then stream the reduced file through pyosmium." }
    }
  ]
}
</script>

## Related

- [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) — the how-to that scales pyrosm's convenience with processes and a bounded queue once a single pass is too slow.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — the windowed, budget-bounded discipline a pyosmium streaming pass feeds.
- [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/) — the format decision that precedes the parser decision.
- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — the block-framed encoding that makes streaming and whole-file transforms possible.
- [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — the reference-resolution rules every reader handles differently.
- [Benchmarking OSM Parser Memory and Throughput](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/benchmarking-osm-parser-memory-and-throughput/) — turn the guidance here into numbers for your own extract.

This guide is part of [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) — return there to follow the data from ingestion through normalization, error triage, and routing-graph conversion.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "pyosmium vs pyrosm vs osmium-tool: Choosing the Right Parser",
  "description": "A decision guide for picking an OSM parser: pyosmium for streaming, pyrosm for GeoDataFrames, osmium-tool for whole-file ops, and osmx for random id access.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["OSM parser selection", "pyosmium and pyrosm", "osmium-tool and osmx"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Parsing & Tag Normalization Workflows", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/" },
    { "@type": "ListItem", "position": 3, "name": "Choosing an OSM Parser", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/" }
  ]
}
</script>
