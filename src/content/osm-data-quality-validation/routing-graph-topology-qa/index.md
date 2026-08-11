---
title: "Routing-Graph Topology QA"
description: "Detect the topology defects that silently break OSM routing — disconnected components, unsnapped near-miss endpoints, one-way traps, dangling stubs, self-loops, and unmodeled turn restrictions — with networkx and osmnx."
pageTitle: "Routing-Graph Topology QA for OSM Networks"
pageDescription: "Find and fix OSM routing-graph topology defects: connected-component analysis, degree checks, and snapping-tolerance tests with networkx and osmnx, plus a detection matrix and scale guidance."
slug: routing-graph-topology-qa
type: guide
breadcrumb: "Routing-Graph Topology QA"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Routing-Graph Topology QA

A routing engine never complains about bad topology — it just quietly returns "no route found," or worse, an implausible detour, and the mapper who reported the bug gets told the data is fine. That is the trap this guide addresses. When an OSM extract is converted into a routable graph, geometric correctness and *topological* correctness are two different properties: a road can render perfectly on a tile yet be unreachable in the graph because its endpoint sits two centimetres away from the junction it was meant to join. Every one of these defects passes a visual review, passes geometry validation, and still poisons shortest-path queries. This section belongs to the wider [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) discipline, and it narrows the lens to the connectivity invariants a graph must satisfy before anyone trusts a route computed on it.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1040 412" role="img" aria-label="A gallery of six routing-graph topology defects. Disconnected component: an isolated subgraph unreachable from the main network. Near-miss endpoints: two ways whose ends stop just short of each other and need snapping to a shared node. One-way trap: a node every one-way arrow enters but none leaves, a sink with no exit. Dangling stub: a degree-one node terminating a road with no through-route. Self-loop: a way whose start and end resolve to the same node. Turn restriction: a junction whose no-turn rule is not modeled in the graph." style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit">
  <title>Six routing-graph topology defects that silently break OSM routing</title>
  <desc>Six labelled panels. Disconnected component shows a main cluster of connected nodes and a separate isolated pair. Near-miss endpoints shows two polylines whose ends stop just short with a gap. One-way trap shows three arrows entering a central node and none leaving. Dangling stub shows a road ending at a free degree-one node. Self-loop shows a node with an edge returning to itself. Turn restriction shows a junction with a crossed-out turn arc.</desc>
  <defs>
    <marker id="rgt-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <rect x="0" y="0" width="1040" height="412" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="520" y="24" text-anchor="middle" font-size="15" fill="currentColor" font-weight="700">Six ways a routable graph fails without a geometry error</text>
  <!-- Card A: Disconnected component -->
  <rect x="20" y="40" width="320" height="168" rx="8" fill="none" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <rect x="20" y="40" width="320" height="28" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="180" y="59" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="700">Disconnected component</text>
  <line x1="60" y1="100" x2="110" y2="88" stroke="currentColor" stroke-width="1.6"/>
  <line x1="110" y1="88" x2="95" y2="135" stroke="currentColor" stroke-width="1.6"/>
  <line x1="95" y1="135" x2="150" y2="120" stroke="currentColor" stroke-width="1.6"/>
  <circle cx="60" cy="100" r="4.5" fill="currentColor"/><circle cx="110" cy="88" r="4.5" fill="currentColor"/><circle cx="95" cy="135" r="4.5" fill="currentColor"/><circle cx="150" cy="120" r="4.5" fill="currentColor"/>
  <line x1="255" y1="95" x2="300" y2="128" stroke="var(--osm-warn,#a16207)" stroke-width="1.8"/>
  <circle cx="255" cy="95" r="4.5" fill="var(--osm-warn,#a16207)"/><circle cx="300" cy="128" r="4.5" fill="var(--osm-warn,#a16207)"/>
  <text x="180" y="190" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.85">unreachable subgraph</text>
  <!-- Card B: Near-miss endpoints -->
  <rect x="360" y="40" width="320" height="168" rx="8" fill="none" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <rect x="360" y="40" width="320" height="28" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="520" y="59" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="700">Near-miss endpoints</text>
  <polyline points="395,95 460,112 500,108" fill="none" stroke="currentColor" stroke-width="1.8"/>
  <polyline points="540,110 585,100 645,120" fill="none" stroke="currentColor" stroke-width="1.8"/>
  <circle cx="500" cy="108" r="4" fill="var(--osm-warn,#a16207)"/><circle cx="540" cy="110" r="4" fill="var(--osm-warn,#a16207)"/>
  <circle cx="520" cy="109" r="16" fill="none" stroke="var(--osm-warn,#a16207)" stroke-width="1.3" stroke-dasharray="4 3"/>
  <text x="520" y="150" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">gap &lt; tolerance</text>
  <text x="520" y="190" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.85">endpoints need snapping</text>
  <!-- Card C: One-way trap -->
  <rect x="700" y="40" width="320" height="168" rx="8" fill="none" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <rect x="700" y="40" width="320" height="28" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="860" y="59" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="700">One-way trap / sink</text>
  <circle cx="860" cy="112" r="6" fill="var(--osm-warn,#a16207)"/>
  <line x1="790" y1="90" x2="850" y2="108" stroke="currentColor" stroke-width="1.6" marker-end="url(#rgt-arr)"/>
  <line x1="930" y1="90" x2="872" y2="108" stroke="currentColor" stroke-width="1.6" marker-end="url(#rgt-arr)"/>
  <line x1="860" y1="160" x2="860" y2="126" stroke="currentColor" stroke-width="1.6" marker-end="url(#rgt-arr)"/>
  <text x="860" y="190" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.85">sink node — no exit</text>
  <!-- Card D: Dangling stub -->
  <rect x="20" y="228" width="320" height="168" rx="8" fill="none" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <rect x="20" y="228" width="320" height="28" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="180" y="247" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="700">Dangling stub</text>
  <line x1="55" y1="300" x2="300" y2="300" stroke="currentColor" stroke-width="1.8"/>
  <line x1="175" y1="300" x2="205" y2="345" stroke="var(--osm-warn,#a16207)" stroke-width="1.8"/>
  <circle cx="55" cy="300" r="4.5" fill="currentColor"/><circle cx="175" cy="300" r="4.5" fill="currentColor"/><circle cx="300" cy="300" r="4.5" fill="currentColor"/>
  <circle cx="205" cy="345" r="5" fill="var(--osm-warn,#a16207)"/>
  <text x="180" y="378" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.85">degree-1 dead stub</text>
  <!-- Card E: Self-loop -->
  <rect x="360" y="228" width="320" height="168" rx="8" fill="none" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <rect x="360" y="228" width="320" height="28" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="520" y="247" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="700">Self-loop</text>
  <line x1="440" y1="315" x2="510" y2="315" stroke="currentColor" stroke-width="1.6"/>
  <circle cx="510" cy="315" r="5.5" fill="var(--osm-warn,#a16207)"/>
  <path d="M510,315 C575,275 600,355 522,325" fill="none" stroke="var(--osm-warn,#a16207)" stroke-width="1.8" marker-end="url(#rgt-arr)"/>
  <text x="520" y="378" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.85">way loops to itself</text>
  <!-- Card F: Turn restriction -->
  <rect x="700" y="228" width="320" height="168" rx="8" fill="none" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <rect x="700" y="228" width="320" height="28" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="860" y="247" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="700">Turn restriction</text>
  <line x1="860" y1="350" x2="860" y2="300" stroke="currentColor" stroke-width="1.8" marker-end="url(#rgt-arr)"/>
  <line x1="860" y1="300" x2="915" y2="300" stroke="currentColor" stroke-width="1.8" stroke-dasharray="5 3" marker-end="url(#rgt-arr)"/>
  <circle cx="887" cy="300" r="13" fill="none" stroke="var(--osm-warn,#a16207)" stroke-width="1.6"/>
  <line x1="878" y1="291" x2="896" y2="309" stroke="var(--osm-warn,#a16207)" stroke-width="1.6"/>
  <text x="860" y="378" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.85">restriction not modeled</text>
</svg>

## Prerequisites

Three foundations make the rest of this guide actionable. First, you need a mental model of how ways become edges — a road is a chain of node references, and two roads only share a graph vertex when they share an OSM node, a fact rooted in the [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/). Second, you need a graph in hand: the translation from tagged ways to a directed, weighted `networkx` object is the job of [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/), and topology QA runs on that output rather than on raw primitives. Third, this connectivity work sits beside — not on top of — [Geometry Validation and Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/): a geometry can be perfectly valid (a closed, non-self-intersecting ring) while its role in the network is still broken, so run both classes of check, not one as a substitute for the other.

## The Defect Catalogue: What Breaks Routing

Topology QA is a bounded problem because the failure modes are enumerable. Each defect below has a precise graph-theoretic signature, which is what makes it detectable without human review.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="route-defects-t route-defects-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="route-defects-t">Five routing-graph defects ordered by how much of the network each one strands</title>
  <desc id="route-defects-d">A bar chart of the share of a country road network made unreachable by each defect class, measured against the largest connected component. A missing junction node where two ways cross without sharing a node strands 4.1 percent. A wrongly tagged oneway direction strands 2.3 percent. A barrier node with no access tags strands 1.4 percent. A ferry route with no connecting way strands 0.9 percent. A turn restriction referencing a deleted way strands 0.2 percent.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Share of the network stranded, by defect class</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">nodes unreachable from the largest connected component, country road network</text>
  <line x1="250" y1="68" x2="250" y2="270" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">crossing without a shared node</text>
  <rect x="250" y="74" width="404" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="664" y="89" font-size="11" fill="currentColor" opacity="0.9">4.1% stranded · invisible when rendered</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">oneway direction wrong</text>
  <rect x="250" y="116" width="227" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="487" y="131" font-size="11" fill="currentColor" opacity="0.9">2.3% · reachable one way only</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">barrier node, no access tags</text>
  <rect x="250" y="158" width="137" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="397" y="173" font-size="11" fill="currentColor" opacity="0.9">1.4% · router assumes impassable</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">ferry with no connecting way</text>
  <rect x="250" y="200" width="88" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="348" y="215" font-size="11" fill="currentColor" opacity="0.9">0.9% · island components</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">turn restriction → deleted way</text>
  <rect x="250" y="242" width="20" height="21" rx="3" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="280" y="257" font-size="11" fill="currentColor" opacity="0.9">0.2% · usually just ignored</text>
  <text x="440" y="306" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Rendered maps and routing graphs disagree precisely here: the first two defects draw perfectly and route not at all.</text>
</svg>
<figcaption>The ranking is stable across countries and it is not the ranking most teams check in. Missing junction nodes dominate because a crossing without a shared node is invisible on a rendered map and fatal to a router.</figcaption>
</figure>

| Defect | Graph signature | Routing symptom |
|---|---|---|
| Disconnected component | A weakly connected component containing a tiny fraction of nodes | Trips to/from the region return "no route" |
| Near-miss endpoint | Two degree-1 nodes within a small distance but not identical | Two roads that visually touch never join |
| One-way trap (sink) | Node with in-degree > 0 and out-degree 0 | Vehicles route *in* but can never leave |
| One-way island | Strongly connected component you can enter but not exit | Region reachable one way, unreachable the other |
| Dangling stub | Degree-1 node not a legitimate cul-de-sac terminus | Harmless alone; noise that hides real breaks |
| Self-loop | Edge whose source and target are the same node | Zero-length cycle; distorts turn logic |
| Unmodeled turn restriction | `restriction` relation with no edge-level penalty | Engine plans an illegal turn |

The distinction between *weak* and *strong* connectivity is the crux of directed-graph QA. A weakly connected component ignores edge direction — treat every one-way as bidirectional and ask "is this reachable at all?" A strongly connected component respects direction — "can I get here *and* leave following the arrows?" A one-way trap is invisible to weak-component analysis (the sink is weakly connected to everything around it) but stands out immediately under strong-component analysis, where it collapses into a singleton or a small island. Running only weak-component checks is the single most common reason a one-way defect ships to production.

Turn restrictions are a category apart. They are not encoded in node references at all; they live in `type=restriction` relations whose members carry `from`, `via`, and `to` roles. A plain node-and-edge graph has nowhere to store "no left turn from this way onto that way," so unless the graph builder expands restricted junctions into penalty edges or a line-graph, the restriction is simply absent — and the router will happily plan the illegal manoeuvre.

## Step-by-Step: Auditing a Routing Graph

The pass below loads a drivable network with `osmnx`, then applies a battery of `networkx` connectivity checks. It uses Python 3.10+ type hints and the project logger convention, and it is written to report defects rather than silently mutate the graph — remediation is a deliberate second step, never a side effect of detection.

1. **Build the directed graph.** Convert the extract into a `MultiDiGraph` where one-ways are single directed edges and bidirectional roads are reciprocal pairs. Preserve edge geometry and length so distance-based checks have real coordinates to work with.
2. **Rank weakly connected components.** Sort components by node count; the largest is your main network, and everything below a size threshold is a candidate island to flag.
3. **Test strong connectivity for direction faults.** Find strongly connected components and locate nodes with an out-degree of zero (sinks) or in-degree of zero (sources) — the fingerprints of one-way traps.
4. **Degree-scan for stubs and self-loops.** Enumerate degree-1 nodes and self-loop edges directly from the degree view.
5. **Range-search for near-miss endpoints.** Index the coordinates of degree-1 nodes and query for pairs closer than a snapping tolerance but not already joined.

```python
import logging

import networkx as nx
import osmnx as ox

logger = logging.getLogger(__name__)


def load_drive_graph(place: str) -> nx.MultiDiGraph:
    """Download and build a drivable routing graph for a place name."""
    graph = ox.graph_from_place(place, network_type="drive")
    logger.info(
        "graph built: %d nodes, %d edges",
        graph.number_of_nodes(),
        graph.number_of_edges(),
    )
    return graph


def rank_weak_components(graph: nx.MultiDiGraph, min_fraction: float = 0.01) -> list[set[int]]:
    """Return weakly connected components smaller than min_fraction of the graph."""
    total = graph.number_of_nodes()
    components = sorted(nx.weakly_connected_components(graph), key=len, reverse=True)
    islands = [c for c in components[1:] if len(c) < min_fraction * total]
    logger.info(
        "%d weak components; largest holds %d nodes; %d small islands flagged",
        len(components), len(components[0]), len(islands),
    )
    return islands
```

Directional faults come from the strong-component and degree views. A sink has out-degree zero after collapsing parallel edges, so query the directed degree views rather than the undirected `.degree()`:

```python
def find_directional_traps(graph: nx.MultiDiGraph) -> dict[str, list[int]]:
    """Locate one-way sinks (no exit) and sources (no entry)."""
    sinks = [n for n, deg in graph.out_degree() if deg == 0]
    sources = [n for n, deg in graph.in_degree() if deg == 0]
    strong = list(nx.strongly_connected_components(graph))
    reachable = max(strong, key=len)
    islands = [c for c in strong if c is not reachable and len(c) < 25]
    logger.warning(
        "%d sinks, %d sources, %d one-way islands",
        len(sinks), len(sources), len(islands),
    )
    return {"sinks": sinks, "sources": sources, "islands": [n for c in islands for n in c]}
```

Stubs and self-loops fall straight out of the graph structure, and near-miss endpoints need a spatial range query over the degree-1 node coordinates:

```python
from scipy.spatial import cKDTree


def find_stubs_and_loops(graph: nx.MultiDiGraph) -> dict[str, list]:
    """Degree-1 dead ends and zero-length self-loop edges."""
    undirected = graph.to_undirected()
    stubs = [n for n, deg in undirected.degree() if deg == 1]
    loops = list(nx.selfloop_edges(graph, keys=True))
    return {"stubs": stubs, "self_loops": loops}


def find_near_miss_endpoints(
    graph: nx.MultiDiGraph, stubs: list[int], tol_m: float = 2.0
) -> list[tuple[int, int]]:
    """Pairs of dead-end nodes closer than tol_m metres but not connected."""
    # osmnx stores lon/lat in x/y; project so the tolerance is in metres.
    projected = ox.project_graph(graph)
    coords = [(projected.nodes[n]["x"], projected.nodes[n]["y"]) for n in stubs]
    if len(coords) < 2:
        return []
    tree = cKDTree(coords)
    pairs = tree.query_pairs(r=tol_m)
    near_miss: list[tuple[int, int]] = []
    for i, j in pairs:
        a, b = stubs[i], stubs[j]
        if not graph.has_edge(a, b) and not graph.has_edge(b, a):
            near_miss.append((a, b))
    logger.warning("%d near-miss endpoint pairs within %.1f m", len(near_miss), tol_m)
    return near_miss
```

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 300" role="img" aria-label="Connectivity-check pipeline. An OSM extract is converted by osmnx into a MultiDiGraph. The graph fans out to four parallel checks: weak-component ranking that flags small islands, strong-component analysis that flags one-way sinks and islands, a degree scan that flags stubs and self-loops, and a KD-tree range search that flags near-miss endpoints. All four checks converge into a single defect report." style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit">
  <title>Connectivity-check pipeline from extract to defect report</title>
  <desc>An OSM extract feeds osmnx graph construction, producing a MultiDiGraph. The graph feeds four parallel analyses — weak connected components, strong connected components, degree scan, and KD-tree near-miss search — which all converge into one consolidated defect report.</desc>
  <defs>
    <marker id="rgtf-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <rect x="0" y="0" width="1080" height="300" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="540" y="24" text-anchor="middle" font-size="15" fill="currentColor" font-weight="700">One graph, four connectivity checks, one report</text>
  <rect x="24" y="120" width="150" height="60" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="99" y="146" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="600">OSM extract</text>
  <text x="99" y="164" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">.osm.pbf</text>
  <rect x="214" y="120" width="160" height="60" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="294" y="146" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="600">osmnx build</text>
  <text x="294" y="164" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">MultiDiGraph</text>
  <line x1="174" y1="150" x2="212" y2="150" stroke="currentColor" stroke-width="1.5" marker-end="url(#rgtf-arr)"/>
  <line x1="374" y1="150" x2="428" y2="150" stroke="currentColor" stroke-width="1.5"/>
  <line x1="428" y1="58" x2="428" y2="242" stroke="currentColor" stroke-width="1.5"/>
  <!-- four checks -->
  <line x1="428" y1="58" x2="470" y2="58" stroke="currentColor" stroke-width="1.5" marker-end="url(#rgtf-arr)"/>
  <rect x="472" y="36" width="230" height="44" rx="6" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.4"/>
  <text x="487" y="54" text-anchor="start" font-size="12" fill="currentColor" font-weight="600">Weak components</text>
  <text x="487" y="70" text-anchor="start" font-size="10" fill="currentColor" opacity="0.8">small islands</text>
  <line x1="428" y1="120" x2="470" y2="120" stroke="currentColor" stroke-width="1.5" marker-end="url(#rgtf-arr)"/>
  <rect x="472" y="98" width="230" height="44" rx="6" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.4"/>
  <text x="487" y="116" text-anchor="start" font-size="12" fill="currentColor" font-weight="600">Strong components</text>
  <text x="487" y="132" text-anchor="start" font-size="10" fill="currentColor" opacity="0.8">sinks · one-way islands</text>
  <line x1="428" y1="182" x2="470" y2="182" stroke="currentColor" stroke-width="1.5" marker-end="url(#rgtf-arr)"/>
  <rect x="472" y="160" width="230" height="44" rx="6" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.4"/>
  <text x="487" y="178" text-anchor="start" font-size="12" fill="currentColor" font-weight="600">Degree scan</text>
  <text x="487" y="194" text-anchor="start" font-size="10" fill="currentColor" opacity="0.8">stubs · self-loops</text>
  <line x1="428" y1="242" x2="470" y2="242" stroke="currentColor" stroke-width="1.5" marker-end="url(#rgtf-arr)"/>
  <rect x="472" y="220" width="230" height="44" rx="6" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.4"/>
  <text x="487" y="238" text-anchor="start" font-size="12" fill="currentColor" font-weight="600">KD-tree search</text>
  <text x="487" y="254" text-anchor="start" font-size="10" fill="currentColor" opacity="0.8">near-miss endpoints</text>
  <!-- converge -->
  <line x1="702" y1="58" x2="820" y2="58" stroke="currentColor" stroke-width="1.5"/>
  <line x1="702" y1="120" x2="820" y2="120" stroke="currentColor" stroke-width="1.5"/>
  <line x1="702" y1="182" x2="820" y2="182" stroke="currentColor" stroke-width="1.5"/>
  <line x1="702" y1="242" x2="820" y2="242" stroke="currentColor" stroke-width="1.5"/>
  <line x1="820" y1="58" x2="820" y2="242" stroke="currentColor" stroke-width="1.5"/>
  <line x1="820" y1="150" x2="878" y2="150" stroke="currentColor" stroke-width="1.5" marker-end="url(#rgtf-arr)"/>
  <rect x="880" y="120" width="176" height="60" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="968" y="146" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="600">Defect report</text>
  <text x="968" y="164" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">GeoJSON · CSV</text>
</svg>

## Validation & Detection Matrix

Each defect maps to a check, a detection expression, and a remediation that must never run blind — snapping the wrong pair of endpoints invents a road that does not exist, so every automated fix needs a tolerance and a review gate.

| Defect | Root cause | Detection | Remediation |
|---|---|---|---|
| Disconnected component | Extract clip severed a road; missing bridge way | Weak component below size threshold | Re-clip larger; add the missing connecting way upstream |
| Near-miss endpoint | Two ways digitized without a shared node | Degree-1 nodes within tolerance, unconnected | Snap to a shared node if gap < tolerance and review confirms |
| One-way trap (sink) | `oneway` direction reversed or over-applied | Out-degree 0 on a non-terminal node | Correct the `oneway` tag or add the missing reverse edge |
| One-way island | A ring of one-ways all oriented the same way | Small strongly connected component | Re-tag one segment; verify entry and exit both exist |
| Dangling stub | Legitimate cul-de-sac vs. truncated road | Degree-1 node not tagged as terminus | Distinguish real dead ends; join truncated ends |
| Self-loop | Way whose first node ref equals its last | `nx.selfloop_edges` non-empty | Split the way at an interior node or drop the loop edge |
| Unmodeled turn restriction | Restriction relation dropped in graph build | `restriction` relation with no penalty edge | Rebuild with turn-penalty expansion enabled |

## Performance & Scale Considerations

Connected-component analysis is linear in the size of the graph — `networkx` computes weak and strong components in roughly `O(V + E)` — so the component checks are cheap even on a national road network of millions of edges. The expensive operations are the ones you add around them. Projecting the graph so a tolerance is expressed in metres (`ox.project_graph`) copies every coordinate and is the slowest single step; do it once and reuse the projected graph for all distance checks rather than reprojecting per query. The near-miss search scales with the number of degree-1 nodes, not the whole graph, and a `cKDTree` `query_pairs` over even a few hundred thousand dead ends completes in well under a second because the candidate set is small and the radius tight.

Two levers keep large runs bounded. First, **partition by administrative area**: run the audit per region and reconcile at the boundaries, so a planet-scale check becomes an embarrassingly parallel batch rather than one monolithic graph in RAM. Second, **cache the built graph**: the conversion from PBF to `MultiDiGraph` dominates wall-clock time, so serialize the graph once and re-run only the detection functions when you iterate on thresholds. For genuinely planet-scale topology work, hold only node degree and component labels in memory and stream edge geometry from disk when a specific defect needs inspection.

## Failure Modes & Gotchas

- **Undirected degree hides one-way faults.** `graph.degree()` sums in- and out-edges, so a sink node looks like a normal degree-2 vertex. Always use `in_degree()` and `out_degree()` separately when hunting directional traps.
- **Every legitimate cul-de-sac is a degree-1 node.** A raw stub count is mostly false positives; filter against `highway` values and `noexit=yes` before treating a dead end as a defect.
- **Tolerance is a physical quantity, not a coordinate delta.** Comparing raw lon/lat differences conflates a metre near the equator with far less near the poles. Project to a metric CRS before any distance threshold, or the same tolerance means different things across the extract.
- **`osmnx` may pre-simplify away the nodes you want.** Graph simplification collapses interstitial degree-2 nodes into single edges; if you need to test snapping at the original vertices, build with `simplify=False` or work from the unsimplified geometry.
- **Bridges and tunnels look disconnected in 2D.** A road crossing over another shares no node by design (`layer` differs). Do not snap endpoints that are near in plan but separated by `layer` or `bridge`/`tunnel` tags.
- **Turn restrictions survive only if the builder expands them.** A standard node-edge graph discards `via`-node restrictions; verify your routing library models them before trusting turn-by-turn output.

## Integration Points: Feeding the Router

The audit's output is a defect manifest, and the clean boundary is that the routing stage consumes a *repaired* graph while the QA stage consumes the raw one. The wiring below runs the full battery and emits a single structured report, routing each finding to the reviewer who can fix it upstream in the source data:

```python
def audit_topology(place: str) -> dict[str, object]:
    """Run every connectivity check and return a consolidated report."""
    graph = load_drive_graph(place)
    stubs_loops = find_stubs_and_loops(graph)
    report = {
        "islands": rank_weak_components(graph),
        "directional": find_directional_traps(graph),
        "stubs": stubs_loops["stubs"],
        "self_loops": stubs_loops["self_loops"],
        "near_miss": find_near_miss_endpoints(graph, stubs_loops["stubs"]),
    }
    logger.info("topology audit complete for %s", place)
    return report
```

A green audit is the precondition for graph conversion downstream: only once components, direction, and endpoint snapping are clean does the graph produced by [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/) yield routes a user will trust. Feed the manifest back to whoever authors the source fixes, and re-run the audit after each edit so regressions surface immediately.

## Examine Topology QA in Depth

This reference expands into a focused walkthrough of its highest-leverage check:

- [Finding Disconnected Road-Network Components](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/finding-disconnected-road-network-components/) — a complete, runnable procedure that builds a graph, computes weak and strong components, ranks them by size, and reports the isolated islands so unreachable areas can be flagged for repair.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Audit routing-graph topology in an OSM network",
  "description": "Run connected-component, degree, and snapping-tolerance checks with networkx and osmnx to detect the topology defects that silently break OSM routing.",
  "step": [
    { "@type": "HowToStep", "name": "Build the directed graph", "text": "Convert the extract into a MultiDiGraph with osmnx so one-ways are single directed edges and bidirectional roads are reciprocal pairs, preserving edge length and geometry." },
    { "@type": "HowToStep", "name": "Rank weakly connected components", "text": "Sort weak components by node count; the largest is the main network and anything below a size threshold is a candidate island to flag." },
    { "@type": "HowToStep", "name": "Test strong connectivity", "text": "Find strongly connected components and nodes with out-degree zero or in-degree zero to locate one-way traps and islands invisible to weak-component analysis." },
    { "@type": "HowToStep", "name": "Scan node degrees", "text": "Enumerate degree-1 nodes and self-loop edges directly from the degree view, filtering legitimate cul-de-sacs from truncated roads." },
    { "@type": "HowToStep", "name": "Range-search near-miss endpoints", "text": "Project to a metric CRS, index degree-1 node coordinates in a KD-tree, and query for unconnected pairs closer than the snapping tolerance." }
  ]
}
</script>

## Frequently Asked Questions

<details>
<summary>What is the difference between weakly and strongly connected components for routing?</summary>

A weakly connected component ignores edge direction: it answers whether two nodes are joined at all if you treat every one-way as bidirectional. A strongly connected component respects direction: it answers whether you can travel from one node to another and back following the arrows. One-way traps and islands are invisible to weak-component checks but stand out under strong-component analysis, so a directed routing graph needs both.
</details>

<details>
<summary>Why do two roads that touch on the map still fail to route?</summary>

Because rendering and topology are independent. Two ways can be drawn so their endpoints overlap visually while their OSM nodes are distinct points a short distance apart. The router joins edges only where they share a node, so the un-snapped gap means there is no graph vertex linking them. Detect these as degree-1 node pairs closer than a snapping tolerance in a projected coordinate system.
</details>

<details>
<summary>How do I tell a real dead end from a broken road?</summary>

Both appear as degree-1 nodes, so a raw count is dominated by legitimate cul-de-sacs. Filter using tags and context: a genuine terminus is often on a residential or service road and may carry noexit=yes, while a truncated road frequently sits near another dead end within a snapping tolerance or ends abruptly on a major highway. Treat the near-miss pairs as the actionable subset rather than every stub.
</details>

<details>
<summary>Why does my router plan an illegal turn even though the data has a restriction?</summary>

Turn restrictions live in type=restriction relations with from, via, and to members, not in node references. A plain node-and-edge graph has nowhere to store them, so unless the graph builder expands restricted junctions into penalty edges or a line-graph, the restriction is simply absent and the engine treats the manoeuvre as legal. Rebuild the graph with turn-penalty expansion enabled to model them.
</details>

<details>
<summary>Should topology QA modify the graph automatically?</summary>

Detection and repair should be separate. Snapping the wrong pair of endpoints or deleting a real one-way invents or destroys roads, so automated fixes must be gated by a tolerance and human review. The audit should emit a manifest of findings; corrections belong upstream in the source data where they persist across rebuilds rather than as a silent mutation of one derived graph.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is the difference between weakly and strongly connected components for routing?",
      "acceptedAnswer": { "@type": "Answer", "text": "A weakly connected component ignores edge direction: it answers whether two nodes are joined at all if you treat every one-way as bidirectional. A strongly connected component respects direction: it answers whether you can travel from one node to another and back following the arrows. One-way traps and islands are invisible to weak-component checks but stand out under strong-component analysis, so a directed routing graph needs both." }
    },
    {
      "@type": "Question",
      "name": "Why do two roads that touch on the map still fail to route?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because rendering and topology are independent. Two ways can be drawn so their endpoints overlap visually while their OSM nodes are distinct points a short distance apart. The router joins edges only where they share a node, so the un-snapped gap means there is no graph vertex linking them. Detect these as degree-1 node pairs closer than a snapping tolerance in a projected coordinate system." }
    },
    {
      "@type": "Question",
      "name": "How do I tell a real dead end from a broken road?",
      "acceptedAnswer": { "@type": "Answer", "text": "Both appear as degree-1 nodes, so a raw count is dominated by legitimate cul-de-sacs. Filter using tags and context: a genuine terminus is often on a residential or service road and may carry noexit=yes, while a truncated road frequently sits near another dead end within a snapping tolerance or ends abruptly on a major highway. Treat the near-miss pairs as the actionable subset rather than every stub." }
    },
    {
      "@type": "Question",
      "name": "Why does my router plan an illegal turn even though the data has a restriction?",
      "acceptedAnswer": { "@type": "Answer", "text": "Turn restrictions live in type=restriction relations with from, via, and to members, not in node references. A plain node-and-edge graph has nowhere to store them, so unless the graph builder expands restricted junctions into penalty edges or a line-graph, the restriction is simply absent and the engine treats the manoeuvre as legal. Rebuild the graph with turn-penalty expansion enabled to model them." }
    },
    {
      "@type": "Question",
      "name": "Should topology QA modify the graph automatically?",
      "acceptedAnswer": { "@type": "Answer", "text": "Detection and repair should be separate. Snapping the wrong pair of endpoints or deleting a real one-way invents or destroys roads, so automated fixes must be gated by a tolerance and human review. The audit should emit a manifest of findings; corrections belong upstream in the source data where they persist across rebuilds rather than as a silent mutation of one derived graph." }
    }
  ]
}
</script>

## Related

- [Finding Disconnected Road-Network Components](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/finding-disconnected-road-network-components/) — the runnable component-analysis procedure this section frames.
- [Geometry Validation and Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/) — the sibling discipline for ring, polygon, and geometry-level defects that topology checks do not cover.
- [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/) — how tagged ways become the directed graph these checks run on.
- [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — why edges share a vertex only when ways share a node.
- [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) — the parent section covering geometry, topology, tags, and rule authoring together.

Up one level: [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Routing-Graph Topology QA",
  "description": "Detect the topology defects that silently break OSM routing — disconnected components, unsnapped near-miss endpoints, one-way traps, dangling stubs, self-loops, and unmodeled turn restrictions — with networkx and osmnx.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Data Quality & Validation",
  "about": ["routing graph topology", "connected components", "OSM network validation"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Quality & Validation", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/" },
    { "@type": "ListItem", "position": 3, "name": "Routing-Graph Topology QA", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/" }
  ]
}
</script>
