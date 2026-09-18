---
title: "Simplifying an OSMnx Graph Without Losing Geometry"
description: "Contract degree-two chains into single edges while keeping the full geometry on the edge, so routing stays fast and the drawn line still follows the road."
pageTitle: "Contracting an OSMnx Graph and Keeping the Road Shape"
pageDescription: "Simplify a routing graph by collapsing interstitial nodes into single edges that carry the original geometry, preserve length and attributes, and verify no junction was contracted away."
slug: simplifying-an-osmnx-graph-without-losing-geometry
type: article
breadcrumb: "Graph Simplification"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Simplifying an OSMnx Graph Without Losing Geometry

A routing graph built naively from OSM has a node at every shape point, which is ten times more nodes than junctions. Contracting them speeds routing enormously — and does so safely only if the geometry they described moves onto the edge rather than disappearing.

## Prerequisites

- [ ] Python 3.10+ with `osmnx` ≥ 1.9 and `networkx`.
- [ ] A graph built from OSM, per [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/).
- [ ] An understanding of what a junction is for your mode, since it differs between driving and walking.
- [ ] A metric projection if you intend to compare lengths.
- [ ] A routing consumer that can read geometry from an edge attribute.

## Conceptual minimum

An OSM way is a sequence of nodes, most of which exist only to describe the road's shape. A graph that keeps them all has a node of degree two wherever the road merely bends, and every routing algorithm pays for those nodes despite there being no decision to make at them.

**Contraction** removes a chain of degree-two nodes and replaces it with a single edge between the junctions at its ends. The speed-up is large because routing cost scales with node count.

Three things must survive the contraction.

**Geometry.** The removed nodes described the road's shape, and that shape is needed to draw the route and to measure distance honestly. It moves onto the edge as a linestring attribute.

**Length.** The contracted edge's length is the sum of the segments it replaced, not the straight-line distance between its endpoints. On a winding road the difference is substantial.

**Attributes.** A chain may span segments with different speed limits or surfaces. Contracting across such a change either loses information or requires the chain to be split at the change, and which you choose is a modelling decision.

The critical safety rule is that **a node is only contractable if it is genuinely degree two in the undirected sense and carries no routing-relevant tags**. A node with a traffic signal, a barrier or a turn restriction is a decision point even when only two ways meet there.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="sog1-t sog1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sog1-t">Three things a contraction must preserve, and what is lost without each</title>
  <desc id="sog1-d">Three panels. Geometry moves from the removed nodes onto the edge as a linestring; without it the route renders as straight lines between junctions and cuts across corners. Length becomes the sum of the replaced segments rather than the straight-line distance; without it every winding road is reported shorter than it is and routing prefers it wrongly. Attributes must be constant along the chain or the chain must be split; contracting across a speed limit change silently averages two different roads into one.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three things to preserve, three losses if not</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Geometry</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Moves onto the edge</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">A linestring attribute</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Without it: straight lines</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Routes cut corners</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Length</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Sum of the segments</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Not endpoint distance</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Without it: roads shorten</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Winding routes preferred</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Attributes</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Constant along the chain</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Or split the chain</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Without it: values merge</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Two roads become one</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The second loss is the one that changes routing decisions rather than merely the drawing, which makes it the most damaging.</text>
</svg>
<figcaption>All three are cheap to preserve and none of them is preserved by a contraction that only removes nodes.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
from collections.abc import Iterable

import networkx as nx
from shapely.geometry import LineString

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.graph.simplify")

# Tags that make a node a decision point even at degree two.
JUNCTION_TAGS = {"highway", "railway", "barrier", "traffic_calming",
                 "crossing", "stop", "give_way", "traffic_signals"}
# Edge attributes that must be constant across a contracted chain.
INVARIANT = ("highway", "oneway", "maxspeed", "access", "surface", "tunnel",
             "bridge")


def is_contractable(graph: nx.MultiDiGraph, node: int) -> bool:
    """Degree two in the undirected sense, and carrying no decision tags."""
    data = graph.nodes[node]
    if JUNCTION_TAGS & set(data):
        return False
    if data.get("street_count", 0) > 2:
        return False
    neighbours = set(graph.predecessors(node)) | set(graph.successors(node))
    neighbours.discard(node)
    # Exactly two distinct neighbours, and no self-loop.
    return len(neighbours) == 2


def edge_signature(data: dict) -> tuple:
    return tuple(str(data.get(key)) for key in INVARIANT)


def chain_from(graph: nx.MultiDiGraph, start: int,
               contractable: set[int]) -> list[int] | None:
    """Follow a chain of contractable nodes outward from a junction."""
    for first in graph.successors(start):
        if first not in contractable:
            continue
        chain = [start, first]
        while True:
            current = chain[-1]
            forward = [n for n in graph.successors(current) if n != chain[-2]]
            if not forward:
                return None                  # dangling; leave it alone
            nxt = forward[0]
            chain.append(nxt)
            if nxt not in contractable:
                return chain                 # reached the far junction
            if nxt in chain[:-1]:
                return None                  # a loop; contracting it is unsafe
    return None


def contract(graph: nx.MultiDiGraph) -> nx.MultiDiGraph:
    """Collapse degree-two chains, carrying geometry, length and attributes."""
    contractable = {n for n in graph.nodes if is_contractable(graph, n)}
    logger.info("%d of %d node(s) are contractable", len(contractable),
                graph.number_of_nodes())

    out = graph.copy()
    processed: set[int] = set()
    contracted = split = 0

    for junction in [n for n in graph.nodes if n not in contractable]:
        chain = chain_from(graph, junction, contractable)
        if chain is None or any(n in processed for n in chain[1:-1]):
            continue

        # Attributes must be constant along the chain, or it must be split.
        signatures = set()
        coords: list[tuple[float, float]] = []
        total_length = 0.0
        for a, b in zip(chain, chain[1:]):
            data = min(graph[a][b].values(), key=lambda d: d.get("length", 0.0))
            signatures.add(edge_signature(data))
            total_length += float(data.get("length", 0.0))
            geom = data.get("geometry")
            points = list(geom.coords) if geom else [
                (graph.nodes[a]["x"], graph.nodes[a]["y"]),
                (graph.nodes[b]["x"], graph.nodes[b]["y"])]
            coords.extend(points if not coords else points[1:])

        if len(signatures) > 1:
            # A speed limit or surface changes mid-chain: leave it alone rather
            # than averaging two genuinely different roads into one edge.
            split += 1
            continue

        first_edge = min(graph[chain[0]][chain[1]].values(),
                         key=lambda d: d.get("length", 0.0))
        attributes = {k: v for k, v in first_edge.items()
                      if k not in {"length", "geometry"}}
        attributes["length"] = total_length          # summed, not straight-line
        attributes["geometry"] = LineString(coords)  # the shape survives
        attributes["contracted_nodes"] = len(chain) - 2

        out.add_edge(chain[0], chain[-1], **attributes)
        out.remove_nodes_from(chain[1:-1])
        processed.update(chain[1:-1])
        contracted += 1

    logger.info("contracted %d chain(s); left %d chain(s) with varying "
                "attributes; %d node(s) remain", contracted, split,
                out.number_of_nodes())
    return out


if __name__ == "__main__":
    logger.info("contract, then verify junction count and total length")
```

## Step-by-step walkthrough

1. **Define contractable strictly.** Degree two in the undirected sense, no self-loop, and no tag that makes the node a decision point. A traffic signal between two road segments is a junction even though only two ways meet.
2. **Use the street count where available.** OSM graph builders record how many streets meet at a node, which is a better junction test than graph degree alone on a directed multigraph.
3. **Walk outward from junctions.** Starting a chain at a junction and following contractable nodes guarantees the chain ends at junctions on both sides.
4. **Refuse loops.** A chain that returns to a node it has already visited is a roundabout or a loop road, and contracting it produces an edge from a node to itself.
5. **Sum the lengths.** The contracted edge's length is the total of the segments replaced. Using the endpoint distance shortens every winding road and biases routing towards them.
6. **Concatenate geometry without duplicating shared points.** Each segment's first coordinate is the previous segment's last, and including both puts a zero-length step in the linestring.
7. **Refuse to contract across an attribute change.** A chain whose speed limit or surface varies describes two different roads, and merging them loses the distinction silently. Leaving it uncontracted costs a node and preserves the truth.
8. **Record how many nodes were removed.** That attribute is what lets somebody later confirm the contraction did what they think, and it costs one integer.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 248" role="img" aria-labelledby="sog2-t sog2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sog2-t">Node and edge counts before and after contraction on a city network</title>
  <desc id="sog2-d">Four counts for a city-scale drive network. The raw graph built from OSM holds a large number of nodes, most of which merely describe road shape. After contraction the node count falls by roughly eighty percent, leaving close to the number of real junctions. Edge count falls correspondingly. Routing time falls faster than node count because shortest-path cost grows worse than linearly with the number of nodes explored.</desc>
  <rect x="0" y="0" width="880" height="248" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Contraction on a city drive network</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Raw nodes</text>
  <rect x="236" y="60" width="498" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">baseline</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Contracted nodes</text>
  <rect x="236" y="100" width="105" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 21%</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Contracted edges</text>
  <rect x="236" y="140" width="129" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 26%</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Routing time</text>
  <rect x="236" y="180" width="70" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 14%</text>
  <text x="868" y="232" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Routing improves more than the node count alone suggests, because search cost grows faster than linearly with graph size.</text>
</svg>
<figcaption>The uncontracted graph is not wrong, merely ten times larger than the decisions it encodes require.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 306" role="img" aria-labelledby="sog3-t sog3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sog3-t">Whether a degree-two node may be contracted away</title>
  <desc id="sog3-d">A decision node examining one degree-two node, with three outcomes. A node carrying a tag that represents a decision or a constraint, such as traffic signals or a barrier, is a junction and must be kept regardless of its degree. A node where an edge attribute changes on either side marks a boundary between two different roads, so the chain is split there rather than contracted through it. A node that is merely a shape point, with no tags and identical attributes on both sides, is contracted away and its coordinate moves into the edge geometry.</desc>
  <defs><marker id="sog3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="306" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Is this degree-two node really just a shape point?</text>
  <rect x="26" y="117" width="250" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="151" y="145" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Tags, or an attribute change?</text>
  <text x="151" y="167" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Two checks before contracting</text>
  <text x="151" y="185" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Either one keeps the node</text>
  <line x1="276" y1="161" x2="314" y2="161" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="314" y2="239" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="353" y2="83" stroke="currentColor" stroke-width="1.4" marker-end="url(#sog3-a)"/>
  <rect x="356" y="52" width="498" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="370" y="77" font-size="12" font-weight="700" fill="currentColor">Keep: it is a junction</text>
  <text x="370" y="97" font-size="10.5" fill="currentColor" opacity="0.88">Carries signals, a barrier or another decision tag</text>
  <line x1="314" y1="161" x2="353" y2="161" stroke="currentColor" stroke-width="1.4" marker-end="url(#sog3-a)"/>
  <rect x="356" y="130" width="498" height="62" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="370" y="155" font-size="12" font-weight="700" fill="currentColor">Keep: attributes change</text>
  <text x="370" y="175" font-size="10.5" fill="currentColor" opacity="0.88">Speed limit or surface differs on either side</text>
  <line x1="314" y1="239" x2="353" y2="239" stroke="currentColor" stroke-width="1.4" marker-end="url(#sog3-a)"/>
  <rect x="356" y="208" width="498" height="62" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="370" y="233" font-size="12" font-weight="700" fill="currentColor">Contract it away</text>
  <text x="370" y="253" font-size="10.5" fill="currentColor" opacity="0.88">A pure shape point; its coordinate joins the edge geometry</text>
  <text x="868" y="290" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Both checks are cheap and both are commonly skipped, which is why contracted graphs so often lose signals and speed limits.</text>
</svg>
<figcaption>Only the third branch removes anything, and it removes nothing a router or a renderer needed.</figcaption>
</figure>

## Verification

- **Junction count is preserved.** Count nodes with a street count above two before and after; the two must match exactly.
- **Total length is preserved.** Summing edge lengths across the graph should give the same figure within floating-point tolerance.
- **Geometry is present on contracted edges.** Every edge with a non-zero contracted-node count must carry a linestring.
- **No self-loops appeared.** An edge from a node to itself means a loop was contracted.
- **A route matches.** Route between two points on both graphs; the geometry should be identical and the distance equal.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Routes cut across corners | Geometry not carried onto the edge | Concatenate segment geometry into a linestring attribute |
| Winding roads look shorter | Length taken as endpoint distance | Sum the replaced segments' lengths |
| Traffic signals disappear | Node tags not checked | Treat decision-carrying tags as junction markers |
| Speed limits averaged away | Contracted across an attribute change | Refuse chains whose invariant attributes vary |
| Self-loops in the output | A loop road contracted | Detect a repeated node and abandon the chain |
| Zero-length steps in geometry | Shared endpoints duplicated | Skip the first coordinate of each subsequent segment |
| Junction count changed | Degree tested on the directed graph | Test degree on the undirected neighbour set |

## Specification reference

> OSM ways contain both junction nodes and interstitial nodes that exist only to describe geometry. Graph simplification contracts chains of non-junction nodes into single edges, and a correct implementation transfers the removed geometry onto the edge and sums the segment lengths. See the [OSMnx simplification documentation](https://osmnx.readthedocs.io/) for the library's own implementation and the attributes it preserves.

## Frequently Asked Questions

<details>
<summary>Why is edge length not the distance between the endpoints?</summary>

Because the road between them is not straight. A contracted chain may follow a curve, a switchback or a winding valley road, and the straight-line distance between its junctions can be a fraction of the distance actually travelled. Using it makes every winding road look shorter than it is, which biases routing towards exactly the roads that take longest to drive.
</details>

<details>
<summary>What makes a degree-two node a junction anyway?</summary>

A tag that represents a decision or a constraint: traffic signals, a barrier, a gate, a crossing, a stop line. Two road segments meeting at a gate is still a place where something happens to a traveller, and contracting it away removes that from the graph entirely. Which tags count depends on the routing mode, so the list is a configuration rather than a constant.
</details>

<details>
<summary>Should I contract across a speed limit change?</summary>

No, unless you are prepared to lose the distinction. A chain spanning a change describes two roads with different properties, and one edge can carry only one value. Splitting the chain at the change keeps both, at the cost of one extra node; merging them silently applies one road's speed limit to the other. Refusing to contract is the conservative default, and the count of refusals tells you how often it matters.
</details>

<details>
<summary>How much does contraction actually speed up routing?</summary>

More than the node reduction alone suggests, because shortest-path search cost grows faster than linearly with the number of nodes explored. An eighty percent reduction in nodes typically produces a larger reduction in routing time, and the effect compounds when many routes are computed. It also reduces memory, which matters when a graph is held for a continent rather than a city.
</details>

## Related

- [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/) — the parent topic and building the graph this simplifies.
- [Exporting an OSMnx Graph to GeoPackage](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/exporting-an-osmnx-graph-to-geopackage/) — writing the simplified graph out with its geometry.
- [OSMnx vs Pyrosm Performance Benchmarks for Routing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/osmnx-vs-pyrosm-performance-benchmarks-for-routing/) — where graph size dominates the measurement.
- [Routing Graph Topology QA](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/) — checking the simplified graph is still connected.
- [Detecting Turn Restriction Errors in OSM](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/detecting-turn-restriction-errors-in-osm/) — restrictions that make a node uncontractable.

Up one level: [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Simplifying an OSMnx Graph Without Losing Geometry",
  "description": "Contract degree-two chains into single edges while keeping the full geometry on the edge, so routing stays fast and the drawn line still follows the road.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["graph contraction", "edge geometry", "routing performance"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Parsing & Tag Normalization Workflows", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/" },
    { "@type": "ListItem", "position": 3, "name": "OSMnx Graph Conversion Techniques", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/" },
    { "@type": "ListItem", "position": 4, "name": "Simplifying an OSMnx Graph Without Losing Geometry", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/simplifying-an-osmnx-graph-without-losing-geometry/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Contract a routing graph while preserving geometry",
  "description": "Identify genuinely contractable nodes, walk chains outward from junctions, refuse loops and attribute changes, sum segment lengths, and concatenate geometry onto the resulting edge.",
  "step": [
    { "@type": "HowToStep", "name": "Define contractable strictly", "text": "Require degree two on the undirected neighbour set, no self-loop, and no tag representing a decision point." },
    { "@type": "HowToStep", "name": "Walk outward from junctions", "text": "Start each chain at a junction and follow contractable nodes so both ends terminate at real junctions." },
    { "@type": "HowToStep", "name": "Refuse loops", "text": "Abandon a chain that revisits a node, since contracting it would produce an edge from a node to itself." },
    { "@type": "HowToStep", "name": "Check attribute invariance", "text": "Leave a chain uncontracted when a speed limit, surface or access value changes along it." },
    { "@type": "HowToStep", "name": "Sum the lengths", "text": "Set the contracted edge's length to the total of the replaced segments rather than the endpoint distance." },
    { "@type": "HowToStep", "name": "Concatenate geometry", "text": "Build a linestring from the segment coordinates, skipping the duplicated shared endpoints." },
    { "@type": "HowToStep", "name": "Record the contraction", "text": "Store how many nodes were removed so the result can be verified later." }
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
      "name": "Why is a contracted edge's length not the distance between its endpoints?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because the road between them is not straight. A contracted chain may follow a curve or a winding valley road, and the straight-line distance between its junctions can be a fraction of the distance travelled. Using it makes every winding road look shorter, biasing routing towards the roads that take longest to drive." }
    },
    {
      "@type": "Question",
      "name": "What makes a degree-two OSM node a junction?",
      "acceptedAnswer": { "@type": "Answer", "text": "A tag representing a decision or a constraint: traffic signals, a barrier, a gate, a crossing, a stop line. Two segments meeting at a gate is still a place where something happens to a traveller, and contracting it removes that from the graph. Which tags count depends on the routing mode." }
    },
    {
      "@type": "Question",
      "name": "Should I contract a graph across a speed limit change?",
      "acceptedAnswer": { "@type": "Answer", "text": "No, unless you are prepared to lose the distinction. A chain spanning a change describes two roads with different properties, and one edge can carry only one value. Splitting at the change keeps both at the cost of one node; merging silently applies one road's limit to the other." }
    },
    {
      "@type": "Question",
      "name": "How much does graph contraction speed up routing?",
      "acceptedAnswer": { "@type": "Answer", "text": "More than the node reduction alone suggests, because shortest-path search cost grows faster than linearly with nodes explored. An eighty percent node reduction typically produces a larger reduction in routing time, and it also reduces memory, which matters for a continental graph." }
    }
  ]
}
</script>
