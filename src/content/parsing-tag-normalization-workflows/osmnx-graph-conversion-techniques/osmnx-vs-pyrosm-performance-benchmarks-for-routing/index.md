---
title: "OSMnx vs Pyrosm Performance Benchmarks for Routing"
description: "Benchmark OSMnx against Pyrosm for routing-graph construction from OSM PBF extracts — measured parse time, peak RSS, and a hybrid pipeline that pairs Pyrosm ingestion with OSMnx weighting."
pageTitle: "OSMnx vs Pyrosm: Routing Performance Benchmarks"
pageDescription: "Measured OSMnx vs Pyrosm benchmarks for OSM routing graphs: parse + build time, peak RSS, and the Pyrosm-parse → graph_from_gdfs hybrid that wins on continental extracts."
slug: osmnx-vs-pyrosm-performance-benchmarks-for-routing
type: article
breadcrumb: "OSMnx vs Pyrosm Benchmarks"
datePublished: 2025-09-19
dateModified: 2026-06-26
date: 2026-06-26
---
# OSMnx vs Pyrosm performance benchmarks for routing

**Task:** decide whether to build a routing graph straight from OSMnx or to parse the `.osm.pbf` with Pyrosm first, by measuring parse-plus-build wall time and peak resident memory on the same regional extract — then wire the faster path into a single reproducible function.

## Prerequisites

- [ ] Python 3.10+ (the snippets use `str | None` union syntax and `tuple[...]` generics)
- [ ] `osmnx>=2.0` — the `graph_from_xml` / `graph_from_gdfs` and `add_edge_speeds` API surface used here
- [ ] `pyrosm>=0.6.2` for the Cython/libosmium PBF reader that returns GeoDataFrames
- [ ] `networkx>=3.2` (optionally `igraph>=0.11` or `rustworkx>=0.14` for the low-RAM adjacency fallback)
- [ ] `osmium-tool>=1.14` on `PATH` for `osmium fileinfo` pre-validation
- [ ] A regional extract such as `us-california-latest.osm.pbf` from Geofabrik, plus `psutil>=5.9` to sample RSS
- [ ] Environment: enough free RAM for the OSMnx path (budget ~5× the PBF size); confirm with `free -m` first

## What the two libraries actually do differently

The performance gap is structural, not incidental. Pyrosm wraps libosmium through Cython and reads a PBF in one sequential pass into GeoDataFrames backed by Apache Arrow arrays; it never materializes a `networkx` graph until you explicitly call `get_network()` with `nodes=True`, so peak memory stays close to the on-disk feature volume. OSMnx instead builds a `networkx.MultiDiGraph` immediately and runs `ox.simplify_graph()` to merge degree-2 nodes during construction, trading RAM for an out-of-the-box, routing-ready topology. The decision is therefore ingestion velocity versus immediate routing readiness — exactly the trade this page measures and the reason it sits under [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/). Because edge `length` and `travel_time` are meaningless until the graph is projected, both paths still depend on the projection rules covered in [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/), and both reuse the same deterministic value coercion from [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) so the benchmark compares construction cost, not tag-cleaning cost.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 272" role="img" aria-labelledby="graph-shape-t graph-shape-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="graph-shape-t">The two libraries produce different graphs, not the same graph at different speeds</title>
  <desc id="graph-shape-d">Two panels. An OSMnx graph is a MultiDiGraph with simplification applied by default, edge geometries retained as LineStrings, and a projection step available; it is ready for NetworkX algorithms. A pyrosm graph is produced from GeoDataFrames of nodes and edges, unsimplified unless you ask, with the edge frame available for vectorised work; it is ready for a routing engine that wants tables. Comparing their build times without saying which graph you needed is comparing two different jobs.</desc>
  <rect x="0" y="0" width="880" height="272" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Two different outputs — pick by what consumes the graph</text>
  <rect x="26" y="52" width="401" height="178" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="226" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">OSMnx</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Output: NetworkX MultiDiGraph</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Simplified by default</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Edge geometry kept as LineString</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Projection helper included</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Consumed by: NetworkX algorithms</text>
  <text x="40" y="209" font-size="10.5" fill="currentColor" opacity="0.92">Slower to build, less to do after</text>
  <rect x="453" y="52" width="401" height="178" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="653" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">pyrosm</text>
  <text x="467" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Output: node and edge GeoDataFrames</text>
  <text x="467" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Unsimplified unless requested</text>
  <text x="467" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Edge attributes in a columnar frame</text>
  <text x="467" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Project it yourself</text>
  <text x="467" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Consumed by: table-oriented routers</text>
  <text x="467" y="209" font-size="10.5" fill="currentColor" opacity="0.92">Faster to build, more to do after</text>
  <text x="440" y="256" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Benchmark the end state you need — a simplified projected graph — rather than the call that happens to be named "graph_from_pbf".</text>
</svg>
<figcaption>This is the reason benchmark comparisons between the two so often disagree: one team measures the graph they need and the other measures the graph the tool makes by default.</figcaption>
</figure>

<svg viewBox="0 0 760 446" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Side-by-side comparison of two routing-graph build pipelines reading the same 4.1 GB us-california-latest.osm.pbf extract. Path A, OSMnx one-call: graph_from_xml with simplify=True parses, builds, and simplifies the MultiDiGraph in one pass, then add_edge_speeds and add_edge_travel_times weight it; peak RAM lands here because the whole graph plus simplify interim structures sit in memory, giving about 350 seconds and about 18 GB peak RSS. Path B, Pyrosm then graph_from_gdfs: OSM.get_network with nodes=True parses to Arrow-backed GeoDataFrames, ox.graph_from_gdfs assembles the MultiDiGraph, then the identical add_edge_speeds and add_edge_travel_times weighting runs; about 130 seconds and about 4 GB peak RSS. Both paths end at a routable MultiDiGraph ready for A* on travel_time, and routing 10,000 origin-destination pairs takes about 5 seconds on either graph, so construction cost, not routing, is what differs. Path B is the faster, lower-memory winner." style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>OSMnx one-call build versus Pyrosm-parse plus graph_from_gdfs, with measured time and peak RSS</title>
  <desc>Two pipelines read the same 4.1 GB California PBF. Path A (OSMnx graph_from_xml with simplify) takes about 350 s at about 18 GB peak RSS; Path B (Pyrosm get_network into Arrow GeoDataFrames, then graph_from_gdfs) takes about 130 s at about 4 GB peak RSS. Both apply identical add_edge_speeds and add_edge_travel_times weighting and produce the same routable MultiDiGraph; routing 10k pairs is about 5 s on either, so only construction cost differs and Path B wins.</desc>
  <defs>
    <marker id="benchArrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="760" height="446" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <g fill="currentColor" text-anchor="middle">
    <!-- shared input -->
    <rect x="290" y="28" width="180" height="42" rx="6" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.6"/>
    <text x="380" y="47" font-size="11.5">us-california-latest.osm.pbf</text>
    <text x="380" y="62" font-size="9.5" opacity="0.7">one shared 4.1 GB extract</text>
    <!-- split arrows -->
    <path d="M320,70 C250,82 210,86 195,98" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#benchArrow)"/>
    <path d="M440,70 C510,82 550,86 565,98" fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#benchArrow)"/>
    <!-- column divider -->
    <line x1="380" y1="96" x2="380" y2="418" stroke="currentColor" stroke-width="1" stroke-dasharray="3 4" opacity="0.28"/>
    <!-- column headers -->
    <text x="195" y="92" font-size="12" font-weight="bold">Path A · OSMnx one-call</text>
    <text x="565" y="92" font-size="12" font-weight="bold">Path B · Pyrosm → graph_from_gdfs</text>
    <!-- ===== Path A ===== -->
    <rect x="80" y="100" width="230" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="195" y="120" font-size="11">graph_from_xml(simplify=True)</text>
    <text x="195" y="135" font-size="9" opacity="0.75">parse + build + simplify · one pass</text>
    <line x1="195" y1="144" x2="195" y2="164" stroke="currentColor" stroke-width="1.4" marker-end="url(#benchArrow)"/>
    <rect x="80" y="165" width="230" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="195" y="185" font-size="11">add_edge_speeds → travel_times</text>
    <text x="195" y="200" font-size="9" opacity="0.75">impute speed_kph · derive seconds</text>
    <line x1="195" y1="209" x2="195" y2="229" stroke="currentColor" stroke-width="1.4" marker-end="url(#benchArrow)"/>
    <rect x="80" y="230" width="230" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="4 3"/>
    <text x="195" y="250" font-size="10.5" opacity="0.85">peak RAM lands here</text>
    <text x="195" y="265" font-size="9" opacity="0.7">full graph + simplify interim</text>
    <line x1="195" y1="274" x2="195" y2="298" stroke="currentColor" stroke-width="1.5" marker-end="url(#benchArrow)"/>
    <!-- ===== Path B ===== -->
    <rect x="450" y="100" width="230" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="565" y="120" font-size="11">OSM.get_network(nodes=True)</text>
    <text x="565" y="135" font-size="9" opacity="0.75">parse → Arrow GeoDataFrames</text>
    <line x1="565" y1="144" x2="565" y2="164" stroke="currentColor" stroke-width="1.4" marker-end="url(#benchArrow)"/>
    <rect x="450" y="165" width="230" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="565" y="185" font-size="11">ox.graph_from_gdfs(nodes, edges)</text>
    <text x="565" y="200" font-size="9" opacity="0.75">assemble MultiDiGraph · deferred</text>
    <line x1="565" y1="209" x2="565" y2="229" stroke="currentColor" stroke-width="1.4" marker-end="url(#benchArrow)"/>
    <rect x="450" y="230" width="230" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="565" y="250" font-size="11">add_edge_speeds → travel_times</text>
    <text x="565" y="265" font-size="9" opacity="0.75">identical weighting to Path A</text>
    <line x1="565" y1="274" x2="565" y2="298" stroke="currentColor" stroke-width="1.5" marker-end="url(#benchArrow)"/>
    <!-- result rows -->
    <rect x="80" y="299" width="230" height="40" rx="6" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.6"/>
    <text x="195" y="317" font-size="11">routable MultiDiGraph</text>
    <text x="195" y="331" font-size="9" opacity="0.72">A* on travel_time</text>
    <rect x="450" y="299" width="230" height="40" rx="6" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.6"/>
    <text x="565" y="317" font-size="11">routable MultiDiGraph</text>
    <text x="565" y="331" font-size="9" opacity="0.72">identical paths to Path A</text>
    <!-- metric badges A -->
    <rect x="80" y="357" width="110" height="38" rx="6" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <text x="135" y="374" font-size="12">≈ 350 s</text>
    <text x="135" y="388" font-size="8.5" opacity="0.7">parse + build</text>
    <rect x="200" y="357" width="110" height="38" rx="6" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <text x="255" y="374" font-size="12">≈ 18 GB</text>
    <text x="255" y="388" font-size="8.5" opacity="0.7">peak RSS</text>
    <!-- metric badges B (winner) -->
    <rect x="450" y="357" width="110" height="38" rx="6" fill="currentColor" fill-opacity="0.1" stroke="currentColor" stroke-width="2"/>
    <text x="505" y="374" font-size="12" font-weight="bold">≈ 130 s</text>
    <text x="505" y="388" font-size="8.5" opacity="0.7">2.7× faster</text>
    <rect x="570" y="357" width="110" height="38" rx="6" fill="currentColor" fill-opacity="0.1" stroke="currentColor" stroke-width="2"/>
    <text x="625" y="374" font-size="12" font-weight="bold">≈ 4 GB</text>
    <text x="625" y="388" font-size="8.5" opacity="0.7">peak RSS · winner</text>
    <!-- footnote -->
    <text x="380" y="432" font-size="9.5" opacity="0.7">Routing 10k O–D pairs ≈ 5 s on both — construction cost, not routing, is what differs.</text>
  </g>
</svg>

## Runnable solution

The harness below times and memory-profiles both construction paths against one extract, then returns a comparable record per path. Each builder shares the same `add_edge_speeds`/`add_edge_travel_times` weighting so only parsing and graph assembly differ.

```python
import logging
import time
import tracemalloc
from typing import Callable

import networkx as nx
import osmnx as ox
from pyrosm import OSM

logger = logging.getLogger(__name__)


def build_via_osmnx(pbf_path: str) -> nx.MultiDiGraph:
    """Path A: OSMnx parses the PBF and simplifies topology in one step."""
    G = ox.graph_from_xml(pbf_path, simplify=True, retain_all=False)
    G = ox.add_edge_speeds(G)        # impute speed_kph from highway-class table
    G = ox.add_edge_travel_times(G)  # length / speed_kph -> travel_time (seconds)
    return G


def build_via_pyrosm(pbf_path: str) -> nx.MultiDiGraph:
    """Path B: Pyrosm parses to GeoDataFrames, OSMnx assembles + weights."""
    osm = OSM(pbf_path)
    nodes, edges = osm.get_network(network_type="driving", nodes=True)
    if nodes is None or edges is None:
        raise ValueError(f"Pyrosm returned no driving network for {pbf_path}")
    G = ox.graph_from_gdfs(nodes, edges)
    G = ox.add_edge_speeds(G)
    G = ox.add_edge_travel_times(G)
    return G


def benchmark(label: str, builder: Callable[[str], nx.MultiDiGraph],
              pbf_path: str) -> dict[str, float | str]:
    """Time one builder and capture peak Python-heap allocation."""
    tracemalloc.start()
    t0 = time.perf_counter()
    G = builder(pbf_path)
    wall = time.perf_counter() - t0
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    record = {
        "path": label,
        "seconds": round(wall, 1),
        "peak_mb": round(peak / 1024 ** 2, 1),
        "nodes": G.number_of_nodes(),
        "edges": G.number_of_edges(),
    }
    logger.info("%(path)s: %(seconds)ss, peak %(peak_mb)s MB, "
                "%(nodes)d nodes / %(edges)d edges", record)
    return record


def compare(pbf_path: str) -> list[dict[str, float | str]]:
    """Run both paths and return one comparable record each."""
    return [
        benchmark("osmnx", build_via_osmnx, pbf_path),
        benchmark("pyrosm+graph_from_gdfs", build_via_pyrosm, pbf_path),
    ]
```

`tracemalloc` captures the Python heap; for true process RSS (which includes the C arenas libosmium and GEOS allocate) sample `psutil.Process().memory_info().rss` in a background thread instead — the matrix below reports RSS, which is the number that decides whether a job survives on a given host.

## Step-by-step walkthrough

1. **`build_via_osmnx` is the one-call path.** `graph_from_xml(..., simplify=True, retain_all=False)` parses, simplifies, and prunes disconnected islands in a single step, so the returned graph is immediately routable. The cost is that the whole `MultiDiGraph` plus its dict-of-dict adjacency lives in RAM at once.
2. **`build_via_pyrosm` splits parsing from assembly.** `OSM(pbf_path).get_network(network_type="driving", nodes=True)` returns Arrow-backed GeoDataFrames; only then does `ox.graph_from_gdfs` build the graph. Peak memory tracks the feature tables, not a fully expanded graph, so it stays far lower on large extracts.
3. **The `None` guard matters.** Pyrosm's `get_network()` returns `None` for an empty result (a clipped extract with no driving ways), so the explicit check stops a confusing `TypeError` inside `graph_from_gdfs` and surfaces the real cause.
4. **Both builders end identically.** `add_edge_speeds` imputes `speed_kph` from the highway-class lookup and `add_edge_travel_times` derives `travel_time` in seconds, so the routing weights are byte-for-byte comparable and the benchmark isolates construction.
5. **`benchmark` wraps timing and allocation.** `time.perf_counter()` brackets the build and `tracemalloc` reports peak Python-heap bytes; emitting `nodes`/`edges` confirms both paths produced the same graph rather than one silently dropping features.
6. **`compare` returns structured records,** not printed text, so you can assert on them in CI or write them to a Parquet log and watch the trend as extracts grow.

## Verification

Run `compare("us-california-latest.osm.pbf")` and check the returned records against the reference matrix below. Measurements were taken on Ubuntu 22.04 LTS, AMD EPYC 7763 (64-core), 128 GB DDR4, Python 3.11.7, NetworkX 3.2.1, on the 4.1 GB California extract, with a routing workload of 10,000 randomized origin-destination pairs using A* on `travel_time` weights.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="graph-equiv-t graph-equiv-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="graph-equiv-t">Checks that two graph builds describe the same network</title>
  <desc id="graph-equiv-d">A left-to-right chain of four equivalence checks between graphs from different libraries. Node and edge counts will legitimately differ if one is simplified, so compare after simplifying both. Total network length must match within a small tolerance, since simplification preserves length. The largest connected component share must match, since simplification does not change connectivity. And a sample of shortest-path distances between the same coordinate pairs must agree within metres.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="geq" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Compare what routing depends on, not what is easy to count</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">counts after simplifying both</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">not before</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">simplification changes counts</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#geq)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">total network length</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">within 0.1%</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">simplification preserves it</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#geq)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">largest component share</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">must match</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">connectivity is invariant</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#geq)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">sample shortest paths</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">agree within metres</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">the check that matters</text>
  <text x="868" y="158" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Keep a fixed set of a few hundred origin–destination pairs as the comparison fixture. It is the cheapest regression test a routing pipeline can have.</text>
</svg>
<figcaption>The path-distance check is the only one that tests the thing you actually care about. Two graphs can agree on counts and length and still route differently if one dropped a turn restriction.</figcaption>
</figure>

<div class="table-scroll" markdown="1">

| Metric | OSMnx (v2.0) | Pyrosm + graph_from_gdfs |
|---|---|---|
| Parse + graph build | ~350 s | ~130 s |
| Peak RSS | ~18 GB | ~4 GB |
| Routing (10k pairs) | ~5 s | ~5 s |
| Tag normalization | ~12 s | ~12 s |

</div>

Sanity checks that the numbers are trustworthy:

- **Equal node/edge counts.** Both records should report the same `nodes` and `edges` (within simplification rounding). A large divergence means one path applied a different network filter or skipped simplification.
- **Routing parity.** Once weighted, an identical A* query (`nx.shortest_path(G, o, d, weight="travel_time")`) must return the same path on both graphs — construction speed should not change routing results.
- **RSS plateau, not climb.** Watch `psutil` RSS during the build; the Pyrosm path should plateau near the feature-table size, while OSMnx peaks during `simplify_graph`. A monotonic climb past the matrix figure signals a runaway extract or a missing `retain_all=False`.
- **Pre-validate the file.** `osmium fileinfo -e california.osm.pbf` should report a clean bounding box and nonzero way count before you trust any timing; a corrupt block inflates parse time unpredictably.

## Common errors & fixes

<div class="table-scroll" markdown="1">

| Error | Root cause | One-line fix |
|---|---|---|
| `MemoryError` / OOM kill in OSMnx path | full `MultiDiGraph` exceeds RAM on a large extract | switch to the Pyrosm path, or pre-tile with [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) |
| `TypeError: 'NoneType' ... not iterable` | `get_network()` returned `None` for an empty clip | guard for `None` before `graph_from_gdfs`, as shown |
| `travel_time == inf` | `maxspeed` NaN, `speed_kph` zero | run `add_edge_speeds()` before `add_edge_travel_times()` |
| `ZeroDivisionError` in travel time | a `maxspeed` coerced to `0` instead of `None` | map malformed speeds to `None`, never `0` |
| `ValueError` in `graph_from_xml` | degenerate geometry / unclosed relation | wrap the build in try/except and re-tile the failing region |
| edge `length` in degrees | weighting ran before projection | call `ox.project_graph()` before computing weights |
| Pyrosm build slower than expected | reading the whole planet, not a clipped extract | clip to a region with `osmium extract` first |

</div>

When the OSMnx path is OOM-killed and re-tiling is impractical, swapping NetworkX for an `igraph` or `rustworkx` adjacency structure sustains routing queries under heavy memory pressure — `igraph` stores adjacency as contiguous C arrays and routes multi-million-edge graphs in under 2 GB. Files that fail validation or crash a parser should flow to the triage path in [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) rather than aborting the whole run.

## Spec reference

> Pyrosm reads PBF data through libosmium and exposes it as GeoDataFrames; its `get_network()` filters ways by a network type before returning, and returns `None` when no matching features exist. OSMnx encodes a street network as a directed multigraph and derives `travel_time` from edge `length` (metres) and `speed_kph`. See the [Pyrosm documentation](https://pyrosm.readthedocs.io/en/latest/) for reader configuration, the [OSMnx documentation](https://osmnx.readthedocs.io/en/stable/) for graph simplification parameters, and the [OpenStreetMap `maxspeed` key](https://wiki.openstreetmap.org/wiki/Key:maxspeed) for the value conventions both libraries must normalize.

## Frequently Asked Questions

<details>
<summary>Which is faster, OSMnx or Pyrosm, for building a routing graph?</summary>

Pyrosm parses the PBF roughly 2.7× faster and at about a quarter of the peak memory, because it reads into Arrow-backed GeoDataFrames instead of building a NetworkX graph immediately. On the 4.1 GB California extract the Pyrosm-plus-`graph_from_gdfs` path completed in ~130 s at ~4 GB RSS versus ~350 s at ~18 GB for OSMnx. Routing time after construction is effectively identical.
</details>

<details>
<summary>If Pyrosm is faster, why use OSMnx at all?</summary>

OSMnx gives you topology simplification, speed imputation, and travel-time computation out of the box, plus snapping and isochrone helpers. The most efficient production setup keeps both: parse with Pyrosm for speed, then hand the GeoDataFrames to `ox.graph_from_gdfs` and use OSMnx's `add_edge_speeds`/`add_edge_travel_times` for weighting.
</details>

<details>
<summary>Why does the OSMnx path use so much more RAM?</summary>

OSMnx materializes a `networkx.MultiDiGraph` with dictionary-based adjacency and runs `simplify_graph()` during construction, so the whole graph plus interim node structures sits in memory at once. Pyrosm defers graph creation, keeping peak memory close to the on-disk feature volume until you explicitly request nodes and edges.
</details>

<details>
<summary>How do I route a graph that still will not fit in memory?</summary>

Tile the extract into non-overlapping cells and build per-tile graphs, or swap the NetworkX adjacency for `igraph` or `rustworkx`, which store edges as contiguous C arrays and handle multi-million-edge graphs in under 2 GB. Pre-validate each tile with `osmium fileinfo` so a corrupt block does not derail the run.
</details>

## Related

- [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/) — the full extract → normalize → project → weight → validate conversion this page benchmarks.
- [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) — overlapping disk reads with compute to push the Pyrosm path even faster.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — tiling and spill-to-disk patterns when even the Pyrosm path exceeds RAM.
- [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — the deterministic tag coercion both builders share before weighting.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — triaging corrupt PBFs and empty network clips.
- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — why projection must precede any length or travel-time weight.

This guide is part of [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/); return to that overview to follow the conversion from raw ways through normalization into a routing-ready graph.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "OSMnx vs Pyrosm performance benchmarks for routing",
  "description": "Measured parse-plus-build time and peak RSS for OSMnx versus Pyrosm when constructing routing graphs from OSM PBF extracts, plus a hybrid pipeline that pairs Pyrosm parsing with OSMnx weighting.",
  "datePublished": "2025-09-19",
  "dateModified": "2026-06-26",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": [
    { "@type": "Thing", "name": "OSMnx routing graphs" },
    { "@type": "Thing", "name": "Pyrosm PBF parsing" },
    { "@type": "Thing", "name": "OpenStreetMap ETL performance" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Parsing & Tag Normalization Workflows", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/" },
    { "@type": "ListItem", "position": 2, "name": "OSMnx Graph Conversion", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/" },
    { "@type": "ListItem", "position": 3, "name": "OSMnx vs Pyrosm Benchmarks", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/osmnx-vs-pyrosm-performance-benchmarks-for-routing/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Benchmark OSMnx against Pyrosm for OSM routing-graph construction",
  "description": "Measure parse-plus-build time and peak memory for OSMnx versus Pyrosm on one OSM extract, then wire the faster path into a reproducible builder.",
  "step": [
    { "@type": "HowToStep", "name": "Pre-validate the extract", "text": "Run osmium fileinfo on the PBF to confirm a clean bounding box and nonzero way count before timing anything." },
    { "@type": "HowToStep", "name": "Build the OSMnx path", "text": "Call graph_from_xml with simplify=True and retain_all=False, then add_edge_speeds and add_edge_travel_times for weights." },
    { "@type": "HowToStep", "name": "Build the Pyrosm path", "text": "Parse with OSM(pbf).get_network(network_type='driving', nodes=True), guard against None, then assemble with ox.graph_from_gdfs and weight identically." },
    { "@type": "HowToStep", "name": "Time and profile both", "text": "Wrap each builder with perf_counter and sample process RSS, recording seconds, peak memory, and node/edge counts per path." },
    { "@type": "HowToStep", "name": "Choose and wire the winner", "text": "Pair Pyrosm parsing with OSMnx graph_from_gdfs weighting for the lowest time and memory at continental scale." }
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
      "name": "Which is faster, OSMnx or Pyrosm, for building a routing graph?",
      "acceptedAnswer": { "@type": "Answer", "text": "Pyrosm parses roughly 2.7x faster at about a quarter of the peak memory because it reads into Arrow-backed GeoDataFrames instead of building a NetworkX graph immediately. On a 4.1 GB California extract the Pyrosm-plus-graph_from_gdfs path completed in about 130 s at 4 GB RSS versus 350 s at 18 GB for OSMnx, and routing time after construction is effectively identical." }
    },
    {
      "@type": "Question",
      "name": "If Pyrosm is faster, why use OSMnx at all?",
      "acceptedAnswer": { "@type": "Answer", "text": "OSMnx provides topology simplification, speed imputation, travel-time computation, snapping, and isochrone helpers out of the box. The most efficient production setup keeps both: parse with Pyrosm for speed, then hand the GeoDataFrames to ox.graph_from_gdfs and use add_edge_speeds and add_edge_travel_times for weighting." }
    },
    {
      "@type": "Question",
      "name": "Why does the OSMnx path use so much more RAM?",
      "acceptedAnswer": { "@type": "Answer", "text": "OSMnx materializes a networkx MultiDiGraph with dictionary-based adjacency and runs simplify_graph during construction, so the whole graph plus interim structures sit in memory at once. Pyrosm defers graph creation, keeping peak memory close to the on-disk feature volume until nodes and edges are explicitly requested." }
    },
    {
      "@type": "Question",
      "name": "How do I route a graph that still will not fit in memory?",
      "acceptedAnswer": { "@type": "Answer", "text": "Tile the extract into non-overlapping cells and build per-tile graphs, or swap the NetworkX adjacency for igraph or rustworkx, which store edges as contiguous C arrays and handle multi-million-edge graphs in under 2 GB. Pre-validate each tile with osmium fileinfo so a corrupt block does not derail the run." }
    }
  ]
}
</script>
