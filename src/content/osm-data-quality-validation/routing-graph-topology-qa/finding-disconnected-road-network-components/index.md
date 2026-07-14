---
title: "Finding Disconnected Road-Network Components"
description: "Locate isolated subgraphs in a routable OSM road network with networkx: build a DiGraph, compute weakly and strongly connected components, rank them by size, and report the unreachable islands."
pageTitle: "Find Disconnected Components in an OSM Road Network"
pageDescription: "A runnable networkx and osmnx procedure to compute weak and strong connected components of an OSM road graph, rank them by size, and flag the small isolated subgraphs that make areas unreachable."
slug: finding-disconnected-road-network-components
type: article
breadcrumb: "Disconnected Components"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Finding Disconnected Road-Network Components

Given a routable OSM road network, list every isolated subgraph — the clusters of roads that share no path with the main network — so you can flag the areas a router will report as unreachable.

## Prerequisites

Tick each box before running the code; a missing projection or the wrong component function is the usual reason the report is empty or nonsensical.

- [ ] `osmnx` ≥ 1.9 and `networkx` ≥ 3.2 installed (`pip install "osmnx>=1.9" "networkx>=3.2"`).
- [ ] A place name or bounding box you can download, or a saved `graphml` file produced earlier by [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/).
- [ ] Python 3.10+ for the `list[set[int]]` and structural typing used below.
- [ ] Enough RAM to hold the target network as a graph — a metro area is comfortable; clip a country down first.
- [ ] Familiarity with why a component is "disconnected," covered in the parent [Routing-Graph Topology QA](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/) reference.

## Conceptual minimum

A road network loaded as a graph is almost never a single connected whole. Extract clips sever roads at the boundary, a mapper forgets to join a new estate road to the trunk it feeds, and a ferry route or a service road ends up floating with no link to anything. Each of those leaves a **connected component** — a maximal set of nodes mutually reachable within the set — that is separate from the rest. In a healthy network one giant component holds the overwhelming majority of nodes and everything else is a handful of tiny islands; the job here is to measure that distribution and surface the islands.

Because a road graph is directed, "connected" has two meanings, and the [Routing-Graph Topology QA](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/) section leans on the distinction. A **weakly** connected component treats every edge as undirected — it answers "is this cluster of roads attached to the network at all?" A **strongly** connected component honours one-way direction — it answers "can a vehicle actually enter *and* leave following the arrows?" Ranking components by node count turns both questions into a single sorted list: the first entry is your main network, and every entry after it, weighted against the total, is a candidate defect. A weak island means physically severed roads; a small strong island that is *not* weakly isolated means a one-way orientation fault, reachable but inescapable.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 320" role="img" aria-label="A road graph split into components. A large main component of many connected nodes dominates the left. Two small isolated clusters sit apart: a three-node island and a two-node island, both unreachable from the main network. On the right, a size-ranked bar list shows the main component as a long bar and the two islands as short bars flagged for review." style="width:100%;max-width:960px;display:block;margin:1.5rem auto;font-family:inherit">
  <title>Ranking road-network components by size to surface isolated islands</title>
  <desc>Left: a dense main component of connected nodes, plus a separate three-node cluster and a separate two-node cluster that share no edge with it. Right: a horizontal bar chart ranking components by node count, with the main component as a long bar and the two islands as short flagged bars.</desc>
  <text x="480" y="24" text-anchor="middle" font-size="15" fill="currentColor" font-weight="700">One giant component, a few flagged islands</text>
  <!-- main component -->
  <g stroke="currentColor" stroke-width="1.6">
    <line x1="70" y1="90" x2="130" y2="70"/><line x1="130" y1="70" x2="180" y2="110"/>
    <line x1="70" y1="90" x2="95" y2="150"/><line x1="95" y1="150" x2="160" y2="165"/>
    <line x1="160" y1="165" x2="180" y2="110"/><line x1="180" y1="110" x2="240" y2="90"/>
    <line x1="240" y1="90" x2="250" y2="155"/><line x1="250" y1="155" x2="160" y2="165"/>
  </g>
  <g fill="currentColor">
    <circle cx="70" cy="90" r="5"/><circle cx="130" cy="70" r="5"/><circle cx="180" cy="110" r="5"/><circle cx="95" cy="150" r="5"/><circle cx="160" cy="165" r="5"/><circle cx="240" cy="90" r="5"/><circle cx="250" cy="155" r="5"/>
  </g>
  <text x="160" y="205" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.85">main component</text>
  <!-- island 1 -->
  <g stroke="var(--osm-warn,#a16207)" stroke-width="1.8">
    <line x1="90" y1="250" x2="140" y2="240"/><line x1="140" y1="240" x2="120" y2="285"/>
  </g>
  <g fill="var(--osm-warn,#a16207)"><circle cx="90" cy="250" r="5"/><circle cx="140" cy="240" r="5"/><circle cx="120" cy="285" r="5"/></g>
  <text x="115" y="308" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">island · 3 nodes</text>
  <!-- island 2 -->
  <line x1="250" y1="255" x2="300" y2="278" stroke="var(--osm-warn,#a16207)" stroke-width="1.8"/>
  <g fill="var(--osm-warn,#a16207)"><circle cx="250" cy="255" r="5"/><circle cx="300" cy="278" r="5"/></g>
  <text x="275" y="308" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">island · 2 nodes</text>
  <!-- divider -->
  <line x1="380" y1="50" x2="380" y2="300" stroke="currentColor" stroke-width="1" opacity="0.3"/>
  <!-- ranked bars -->
  <text x="430" y="80" text-anchor="start" font-size="11.5" fill="currentColor" opacity="0.85">rank by node count</text>
  <rect x="430" y="95" width="470" height="34" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.4"/>
  <text x="440" y="117" text-anchor="start" font-size="12" fill="currentColor" font-weight="600">#1 main — keep</text>
  <rect x="430" y="145" width="150" height="34" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.4"/>
  <text x="440" y="167" text-anchor="start" font-size="12" fill="currentColor" font-weight="600">#2 island — flag</text>
  <rect x="430" y="195" width="110" height="34" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.4"/>
  <text x="440" y="217" text-anchor="start" font-size="12" fill="currentColor" font-weight="600">#3 island — flag</text>
  <text x="430" y="262" text-anchor="start" font-size="11" fill="currentColor" opacity="0.8">threshold = fraction of total nodes</text>
</svg>

## Runnable solution

This module builds (or loads) a drivable graph, computes both weak and strong components, ranks them by node count, and writes the isolated islands to a GeoJSON report with a centroid per island so a reviewer can jump straight to the location on the map. It targets `osmnx>=1.9`, `networkx>=3.2`, and Python 3.10+.

```python
from __future__ import annotations

import json
import logging
from pathlib import Path

import networkx as nx
import osmnx as ox

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.disconnected_components")


def build_graph(place: str | None = None, graphml: str | None = None) -> nx.MultiDiGraph:
    """Load a drivable graph from a place name or a saved GraphML file."""
    if graphml is not None:
        graph = ox.load_graphml(graphml)
        logger.info("loaded graph from %s", graphml)
    elif place is not None:
        graph = ox.graph_from_place(place, network_type="drive")
        logger.info("downloaded graph for %r", place)
    else:
        raise ValueError("provide either a place name or a graphml path")
    logger.info("graph: %d nodes, %d edges", graph.number_of_nodes(), graph.number_of_edges())
    return graph


def rank_components(
    graph: nx.MultiDiGraph, strong: bool = False
) -> list[set[int]]:
    """Return components sorted largest-first."""
    finder = nx.strongly_connected_components if strong else nx.weakly_connected_components
    components = sorted(finder(graph), key=len, reverse=True)
    logger.info(
        "%s components: %d total, largest = %d nodes",
        "strong" if strong else "weak", len(components), len(components[0]),
    )
    return components


def isolated_islands(
    components: list[set[int]], total_nodes: int, max_fraction: float = 0.01
) -> list[set[int]]:
    """Every component after the largest that holds less than max_fraction of nodes."""
    islands = [c for c in components[1:] if len(c) < max_fraction * total_nodes]
    logger.warning("%d isolated islands below %.1f%% of the network",
                   len(islands), max_fraction * 100)
    return islands


def island_report(graph: nx.MultiDiGraph, islands: list[set[int]]) -> dict:
    """Build a GeoJSON FeatureCollection, one point per island at its centroid."""
    features = []
    for rank, nodes in enumerate(islands, start=1):
        lons = [graph.nodes[n]["x"] for n in nodes]
        lats = [graph.nodes[n]["y"] for n in nodes]
        centroid = [sum(lons) / len(lons), sum(lats) / len(lats)]
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": centroid},
            "properties": {
                "island_rank": rank,
                "node_count": len(nodes),
                "sample_node": next(iter(nodes)),
            },
        })
    return {"type": "FeatureCollection", "features": features}


def find_disconnected(place: str, out: str = "islands.geojson") -> list[set[int]]:
    """End-to-end: build, rank, flag, and write a report of disconnected islands."""
    graph = build_graph(place=place)
    total = graph.number_of_nodes()
    weak = rank_components(graph, strong=False)
    islands = isolated_islands(weak, total)

    # A one-way orientation fault: reachable in the undirected graph but its own
    # small strong component. These are not weakly isolated, so surface separately.
    strong = rank_components(graph, strong=True)
    one_way_islands = [c for c in strong[1:] if 1 < len(c) < 25]
    logger.info("%d candidate one-way islands", len(one_way_islands))

    report = island_report(graph, islands)
    Path(out).write_text(json.dumps(report, indent=2), encoding="utf-8")
    logger.info("wrote %d islands to %s", len(islands), out)
    return islands


if __name__ == "__main__":
    find_disconnected("Piedmont, California, USA")
```

## Step-by-step walkthrough

1. **Flexible input** — `build_graph` accepts either a live place name or a previously saved GraphML file, so the same audit runs against a fresh download or a pinned snapshot from an earlier build without re-hitting the Overpass API.
2. **One ranking function, two modes** — `rank_components` swaps `weakly_connected_components` for `strongly_connected_components` behind a boolean, because the two share the "sort by length, largest first" shape. The largest entry is always the main network.
3. **Fraction, not a fixed count** — `isolated_islands` compares each component against a fraction of the *total* node count rather than an absolute size, so the same threshold works on a village and a metropolis. Everything after index 0 that falls below the fraction is flagged.
4. **Two classes of island** — the driver computes weak islands (physically severed roads) and, separately, small strong components that are not weakly isolated (one-way orientation faults). Reporting them apart tells the reviewer whether to add a missing road or fix a direction tag.
5. **Actionable geometry** — `island_report` reduces each island to a centroid point with its rank and node count, producing GeoJSON that drops straight onto a map so the reviewer navigates to the defect instead of reading node IDs.
6. **Deterministic output** — components are sorted by size before writing, so two runs over the same graph produce the same ranked report, which matters when the file is diffed in review.

## Verification

Confirm the report is trustworthy before acting on it:

- **The main component dominates.** `len(weak[0]) / graph.number_of_nodes()` should be close to 1.0 (often above 0.98) for a well-connected extract; a low value means the network is fragmented and the threshold needs attention, not the data.
- **Island count is plausible.** A metro extract typically yields a handful to a few dozen islands. Hundreds usually signals an over-tight clip or a parsing problem upstream, not that many genuine breaks.
- **Centroids land on real roads.** Open `islands.geojson` on a base map; each point should sit on or beside a road segment. A centroid in open water or off the extract edge points to a coordinate or projection error.
- **Strong ⊇ weak counts.** There are always at least as many strong components as weak ones, because direction can only split a component further. If strong count is lower, the component functions were swapped.
- **Re-run is stable.** Running twice over a saved GraphML must produce byte-identical GeoJSON, proving the sort and centroid math are deterministic.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| `islands.geojson` is empty | Threshold too low for a fragmented graph | Raise `max_fraction`, or fix the upstream clip that severed roads. |
| Everything flagged as an island | Graph loaded undirected or edges dropped | Confirm `graph_from_place(..., network_type="drive")` returned a `MultiDiGraph`. |
| `KeyError: 'x'` in centroid | Node lacks coordinates after simplification | Load with geometry intact, or read `x`/`y` from the unsimplified graph. |
| Strong components equal weak | Passed `strong=False` for both calls | Pass `strong=True` when you want direction-aware components. |
| Hundreds of tiny islands | Extract clipped mid-road at the boundary | Re-clip a larger area so boundary roads keep their far endpoints. |
| `EmptyOverpassResponse` | Place name did not geocode | Use a bounding box or a saved GraphML instead of the place string. |

## Specification reference

> `networkx` defines a connected component as a maximal set of nodes such that each pair is connected by a path. For directed graphs, `weakly_connected_components` treats edges as undirected while `strongly_connected_components` requires a directed path in both directions; both return sets of nodes and are documented under Algorithms → Components in the official [networkx components reference](https://networkx.org/documentation/stable/reference/algorithms/component.html). Graph construction and coordinate storage follow the [osmnx documentation](https://osmnx.readthedocs.io/), where nodes carry `x` (longitude) and `y` (latitude) attributes.

## Frequently Asked Questions

<details>
<summary>Should I use weak or strong components to find unreachable areas?</summary>

Start with weak components to find roads physically severed from the network, then add strong components to catch one-way orientation faults. A weak island is unreachable from any direction; a small strong component that is not weakly isolated is reachable but cannot be left, or vice versa. Reporting both, ranked by size, gives a complete picture of what a router cannot serve.
</details>

<details>
<summary>What size threshold marks a component as a defect?</summary>

Use a fraction of the total node count rather than a fixed number, so the rule scales from a village to a city. Anything after the largest component that holds less than about one percent of nodes is a reasonable default candidate. Tune the fraction to your extract: dense urban networks tolerate a smaller threshold, sparse rural ones may need a larger one to avoid flagging legitimate small clusters.
</details>

<details>
<summary>Why does a component appear disconnected when the roads clearly connect on the map?</summary>

The most common cause is an extract clip that cut a road at the boundary, removing the node that linked the island to the main network. The second is a near-miss endpoint where two ways were digitized without a shared node. The graph only joins edges at shared nodes, so a visual overlap without a shared node leaves the cluster isolated regardless of how it renders.
</details>

<details>
<summary>How do I turn the report into something a mapper can act on?</summary>

Reduce each island to a centroid point carrying its rank and node count, and write it as GeoJSON. That drops onto any base map so the reviewer navigates directly to the location instead of decoding node IDs, and the rank orders their attention toward the largest unreachable clusters first.
</details>

## Related

- [Routing-Graph Topology QA](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/) — the parent reference framing components alongside near-miss endpoints, one-way traps, and turn restrictions.
- [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/) — building the directed graph this procedure consumes.
- [Geometry Validation and Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/) — the geometry-level checks that run alongside connectivity analysis.
- [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — why edges join only at shared nodes.
- [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) — the section that gathers every validation discipline.

Up one level: [Routing-Graph Topology QA](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Finding Disconnected Road-Network Components",
  "description": "Locate isolated subgraphs in a routable OSM road network with networkx: build a DiGraph, compute weakly and strongly connected components, rank them by size, and report the unreachable islands.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Data Quality & Validation",
  "about": ["connected components", "OSM road network", "networkx graph analysis"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Quality & Validation", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/" },
    { "@type": "ListItem", "position": 3, "name": "Routing-Graph Topology QA", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/" },
    { "@type": "ListItem", "position": 4, "name": "Finding Disconnected Road-Network Components", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/finding-disconnected-road-network-components/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Find disconnected components in an OSM road network",
  "description": "Build a routable graph, compute weak and strong connected components, rank them by size, and report the small isolated islands that make areas unreachable.",
  "step": [
    { "@type": "HowToStep", "name": "Build or load the graph", "text": "Download a drivable graph from a place name with osmnx or load a saved GraphML snapshot, confirming it is a directed MultiDiGraph." },
    { "@type": "HowToStep", "name": "Rank components by size", "text": "Compute weakly connected components and sort them largest-first so the main network is index zero and everything after it is a candidate island." },
    { "@type": "HowToStep", "name": "Flag islands against a fraction", "text": "Keep components after the largest that hold less than a fixed fraction of the total node count, so the threshold scales across network sizes." },
    { "@type": "HowToStep", "name": "Separate one-way faults", "text": "Compute strongly connected components and surface small strong components that are not weakly isolated as one-way orientation faults." },
    { "@type": "HowToStep", "name": "Write an actionable report", "text": "Reduce each island to a centroid point with its rank and node count and write GeoJSON so a reviewer can navigate straight to the defect." }
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
      "name": "Should I use weak or strong components to find unreachable areas?",
      "acceptedAnswer": { "@type": "Answer", "text": "Start with weak components to find roads physically severed from the network, then add strong components to catch one-way orientation faults. A weak island is unreachable from any direction; a small strong component that is not weakly isolated is reachable but cannot be left, or vice versa. Reporting both, ranked by size, gives a complete picture of what a router cannot serve." }
    },
    {
      "@type": "Question",
      "name": "What size threshold marks a component as a defect?",
      "acceptedAnswer": { "@type": "Answer", "text": "Use a fraction of the total node count rather than a fixed number, so the rule scales from a village to a city. Anything after the largest component that holds less than about one percent of nodes is a reasonable default candidate. Tune the fraction to your extract: dense urban networks tolerate a smaller threshold, sparse rural ones may need a larger one." }
    },
    {
      "@type": "Question",
      "name": "Why does a component appear disconnected when the roads clearly connect on the map?",
      "acceptedAnswer": { "@type": "Answer", "text": "The most common cause is an extract clip that cut a road at the boundary, removing the node that linked the island to the main network. The second is a near-miss endpoint where two ways were digitized without a shared node. The graph only joins edges at shared nodes, so a visual overlap without a shared node leaves the cluster isolated." }
    },
    {
      "@type": "Question",
      "name": "How do I turn the report into something a mapper can act on?",
      "acceptedAnswer": { "@type": "Answer", "text": "Reduce each island to a centroid point carrying its rank and node count, and write it as GeoJSON. That drops onto any base map so the reviewer navigates directly to the location instead of decoding node IDs, and the rank orders their attention toward the largest unreachable clusters first." }
    }
  ]
}
</script>
