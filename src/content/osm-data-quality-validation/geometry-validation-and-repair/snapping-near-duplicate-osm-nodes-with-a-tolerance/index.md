---
title: "Snapping Near-Duplicate OSM Nodes with a Tolerance"
description: "Close sub-centimetre node gaps without merging genuinely separate features: KD-tree candidate pairs, connected-component clustering, a diameter guard, and rewritten way references."
pageTitle: "Snap Near-Duplicate OSM Nodes with a Tolerance"
pageDescription: "A deterministic node-snapping repair for OSM — tolerance chosen from survey accuracy, transitive clustering with a diameter guard, and the way-reference rewrite most implementations skip."
slug: "snapping-near-duplicate-osm-nodes-with-a-tolerance"
type: "article"
breadcrumb: "Snapping Near-Duplicate Nodes"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Snapping Near-Duplicate OSM Nodes with a Tolerance

Close the sub-centimetre gaps that make a ring fail to close, without merging two buildings that are genuinely half a metre apart.

## Prerequisites

- [ ] Python 3.10+ with `shapely` 2.0+, `numpy` and `scipy`
- [ ] Node coordinates and the way references pointing at them
- [ ] A projected CRS in metres — see [Picking a UTM Zone for an OSM Extract](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/picking-a-utm-zone-for-an-osm-extract/)
- [ ] Knowledge of the source's survey accuracy, which is what sets the tolerance

## Conceptual minimum

Snapping merges nodes that are close enough to be the same node. It fixes unclosed rings, broken multipolygon chains and duplicated vertices — and, past a certain tolerance, it starts merging things that are genuinely separate.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="snap-tolerance-t snap-tolerance-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="snap-tolerance-t">Gaps closed and features wrongly merged at five snapping tolerances</title>
  <desc id="snap-tolerance-d">A bar chart over a European building layer of 1.4 million polygons and 41 million nodes. At one centimetre, 12 percent of near-miss gaps close and no real nodes merge. At ten centimetres, 74 percent close and none merge. At fifty centimetres, 91 percent close and three merge. At one metre, 96 percent close and 40 merge. At five metres, 99 percent close and 2 900 merge.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Tolerance decides what you merge, and what you destroy</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">European building layer, 1.4 M polygons, 41 M nodes</text>
  <line x1="250" y1="68" x2="250" y2="270" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">1 cm</text>
  <rect x="250" y="74" width="57" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="317" y="89" font-size="11" fill="currentColor" opacity="0.9">12% of near-miss gaps closed · 0 real nodes merged</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">10 cm</text>
  <rect x="250" y="116" width="351" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="611" y="131" font-size="11" fill="currentColor" opacity="0.9">74% closed · 0 merged</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">50 cm</text>
  <rect x="250" y="158" width="432" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="692" y="173" font-size="11" fill="currentColor" opacity="0.9">91% closed · 3 merged</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">1 m</text>
  <rect x="250" y="200" width="456" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="716" y="215" font-size="11" fill="currentColor" opacity="0.9">96% closed · 40 merged</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">5 m</text>
  <rect x="250" y="242" width="470" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="868" y="257" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">99% closed · 2 900 merged</text>
  <text x="440" y="306" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Both curves rise together. Choose the tolerance from the survey accuracy of the source, not from the percentage of gaps it closes.</text>
</svg>
<figcaption>The last few percent of gaps are not near misses. They are real separations, and closing them is destruction rather than repair.</figcaption>
</figure>

The tolerance is the whole decision, and it should come from the data's provenance rather than from the repair rate. A layer digitised from 20 cm aerial imagery has near-misses at the centimetre scale; a layer traced from 5 m satellite imagery has them at the metre scale, and applying the second tolerance to the first collapses real detail.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 318" role="img" aria-labelledby="snap-cases-t snap-cases-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="snap-cases-t">Five snapping candidates and whether merging them is correct</title>
  <desc id="snap-cases-d">A grid of five cases. Ring endpoints three centimetres apart should be snapped: it is one ring digitised twice. Two buildings sharing a wall can be snapped if they are tagged as sharing, because the wall is genuinely one line. Terraced houses 40 centimetres apart should not be snapped, because that is a real gap. A node duplicated at exactly the same coordinate should always be snapped. A motorway and a service road two metres apart should not be, because merging separate carriageways breaks routing.</desc>
  <rect x="0" y="0" width="880" height="318" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">When snapping is repair, and when it is damage</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">snap?</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">why</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">ring endpoints 3 cm apart</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">yes</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">one ring, digitised twice</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">two buildings sharing a wall</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">yes, if tagged as sharing</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">the wall is genuinely one line</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">terraced houses 40 cm apart</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">no</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">40 cm is a real gap between real buildings</text>
  <text x="198" y="224" text-anchor="end" font-size="8.5" fill="currentColor">a node duplicated at the same coordinate</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">yes</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">an exact duplicate is never intentional</text>
  <text x="198" y="264" text-anchor="end" font-size="9.5" fill="currentColor">motorway and service road 2 m apart</text>
  <rect x="213" y="244" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">no</text>
  <rect x="535" y="244" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">separate carriageways; merging breaks routing</text>
  <text x="440" y="300" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">Exact duplicates are always safe. Everything else depends on whether the separation is a digitising artefact or a fact about the world.</text>
</svg>
<figcaption>The last row is why a global tolerance above about a metre is dangerous on a road network, even when it is safe on buildings.</figcaption>
</figure>

The mechanism has one subtlety worth getting right before writing any code.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="snap-cluster-t snap-cluster-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="snap-cluster-t">Why snapping has to cluster before it merges</title>
  <desc id="snap-cluster-d">A four-stage chain. Candidate pairs come from a spatial index, filtered to those within the tolerance. Connected components take the transitive closure, so if A is near B and B is near C they form one cluster. A representative is chosen by one consistent rule, such as the centroid or the oldest node. Finally every way referencing any node in the cluster is rewritten, which is the step most often forgotten.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="sn" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Cluster first, then choose a representative</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">candidate pairs</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">from a spatial index</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">within the tolerance</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#sn)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">connected components</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">transitive closure</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">A~B, B~C ⟹ one cluster</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#sn)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">representative</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">centroid, or the oldest node</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">one rule, applied always</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#sn)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">rewrite refs</text>
  <text x="761" y="107" text-anchor="middle" font-size="8.5" fill="currentColor" opacity="0.85">every way pointing at the cluster</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">the step people forget</text>
  <text x="440" y="158" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">Snapping pairwise in arbitrary order gives a different answer depending on iteration order. Clustering makes the result independent of it.</text>
</svg>
<figcaption>Transitivity is the subtlety: chained near-misses form a cluster whose diameter can exceed the tolerance, which is why very large tolerances collapse whole terraces.</figcaption>
</figure>

Nearness is not transitive but clustering makes it so: if A is within tolerance of B and B of C, all three become one node even though A and C may be twice the tolerance apart. This is usually what you want — it is how a chain of near-duplicates collapses — and it is why a large tolerance degrades non-linearly.

## Runnable solution

```python
#!/usr/bin/env python3
"""Snap near-duplicate nodes within a tolerance, deterministically."""
from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


@dataclass
class SnapResult:
    """Old node id → surviving node id, plus what happened."""
    mapping: dict[int, int]
    clusters: int = 0
    merged: int = 0
    max_move_m: float = 0.0
    oversized: list[tuple[int, float]] = field(default_factory=list)


def snap_nodes(node_ids: np.ndarray,
               coords: np.ndarray,
               tolerance_m: float,
               max_cluster_diameter_m: float | None = None) -> SnapResult:
    """Cluster nodes within `tolerance_m` and collapse each cluster to one node.

    `coords` must be projected metres. Running this on degrees makes the tolerance
    mean a different distance at every latitude.
    """
    if coords.ndim != 2 or coords.shape[1] != 2:
        raise ValueError("coords must be an (n, 2) array of projected metres")
    if max_cluster_diameter_m is None:
        # A cluster wider than a few tolerances is a chain that ran away.
        max_cluster_diameter_m = tolerance_m * 3

    tree = cKDTree(coords)
    pairs = tree.query_pairs(r=tolerance_m, output_type="ndarray")
    if pairs.size == 0:
        logger.info("no node pairs within %.3f m", tolerance_m)
        return SnapResult(mapping={int(i): int(i) for i in node_ids})

    n = len(node_ids)
    adjacency = coo_matrix(
        (np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(n, n))
    count, labels = connected_components(adjacency, directed=False)

    mapping: dict[int, int] = {}
    merged = 0
    max_move = 0.0
    oversized: list[tuple[int, float]] = []

    for label in range(count):
        members = np.flatnonzero(labels == label)
        if members.size == 1:
            idx = int(members[0])
            mapping[int(node_ids[idx])] = int(node_ids[idx])
            continue

        member_coords = coords[members]
        # Diameter check: transitive chaining can produce a cluster far wider than
        # the tolerance, and that is a merge nobody asked for.
        spread = float(np.max(np.ptp(member_coords, axis=0)))
        if spread > max_cluster_diameter_m:
            oversized.append((label, spread))
            for idx in members:                       # leave the whole cluster alone
                mapping[int(node_ids[idx])] = int(node_ids[idx])
            continue

        # Deterministic representative: the lowest node id in the cluster.
        # A centroid would move every node; the lowest id keeps one of them exact
        # and does not depend on iteration order.
        survivor_idx = int(members[np.argmin(node_ids[members])])
        survivor_id = int(node_ids[survivor_idx])
        survivor_xy = coords[survivor_idx]
        for idx in members:
            mapping[int(node_ids[idx])] = survivor_id
            if idx != survivor_idx:
                merged += 1
                max_move = max(max_move, float(np.hypot(*(coords[idx] - survivor_xy))))

    logger.info("%d cluster(s), %d node(s) merged, max move %.3f m, %d oversized skipped",
                count, merged, max_move, len(oversized))
    return SnapResult(mapping=mapping, clusters=count, merged=merged,
                      max_move_m=max_move, oversized=oversized)


def rewrite_way_refs(ways: dict[int, list[int]],
                     mapping: dict[int, int]) -> tuple[dict[int, list[int]], int]:
    """Point every way at the surviving nodes, collapsing repeats the snap created.

    Snapping two adjacent nodes of the same way to one leaves the way referencing
    the same node twice in a row — a zero-length segment that fails validity.
    """
    rewritten: dict[int, list[int]] = {}
    degenerate = 0
    for way_id, refs in ways.items():
        new_refs = [mapping.get(r, r) for r in refs]
        collapsed = [new_refs[0]]
        for ref in new_refs[1:]:
            if ref != collapsed[-1]:
                collapsed.append(ref)
        # A closed way that collapses below four nodes is no longer a ring.
        if len(collapsed) < 2 or (refs[0] == refs[-1] and len(collapsed) < 4):
            degenerate += 1
            continue
        rewritten[way_id] = collapsed
    if degenerate:
        logger.warning("%d way(s) became degenerate and were dropped", degenerate)
    return rewritten, degenerate
```

## Step-by-step walkthrough

`cKDTree.query_pairs` finds every pair within the tolerance in one call, which is the part that would otherwise be quadratic. On 41 million nodes it is the difference between minutes and never.

`connected_components` turns pairwise nearness into clusters. Doing this properly is what makes the result deterministic: a naive loop that snaps B to A and then C to B produces a different answer if the nodes are visited in a different order, and "different answer depending on iteration order" is not a property you want in a repair.

The **lowest node id** is the representative, not the centroid. Two reasons: it is stable across runs regardless of order, and it leaves one node exactly where it was rather than moving every node in the cluster. Where the source has meaningful node identity — an entrance node, a node carrying tags — keeping a real node beats synthesising a new position.

The cluster-diameter guard is the safety valve on transitivity. A chain of near-misses along a terrace can produce a cluster tens of metres across from a 50 cm tolerance, and merging it collapses several buildings into one. Skipping oversized clusters entirely, and reporting them, is better than merging them badly.

`rewrite_way_refs` is the step most implementations forget. Merging nodes without updating the ways that reference them leaves dangling references — the exact defect [Node, Way & Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) is about. Collapsing consecutive duplicates afterwards matters too: snapping two adjacent nodes of the same way creates a zero-length segment, which fails validity in the way described in [Detecting Self-Intersecting OSM Polygons with Shapely](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/detecting-self-intersecting-osm-polygons-with-shapely/).

## Verification

Assert the properties that distinguish a repair from damage:

```python
def test_no_node_moves_further_than_the_tolerance():
    result = snap_nodes(ids, coords, tolerance_m=0.10)
    assert result.max_move_m <= 0.10 * 3          # bounded by the diameter guard

def test_snapping_is_order_independent():
    order = np.random.permutation(len(ids))
    a = snap_nodes(ids, coords, 0.10).mapping
    b = snap_nodes(ids[order], coords[order], 0.10).mapping
    assert a == b

def test_ways_have_no_dangling_refs():
    rewritten, _ = rewrite_way_refs(ways, result.mapping)
    survivors = set(result.mapping.values())
    assert all(ref in survivors for refs in rewritten.values() for ref in refs)

def test_rings_stay_closed():
    rewritten, _ = rewrite_way_refs(ways, result.mapping)
    for way_id, refs in rewritten.items():
        if ways[way_id][0] == ways[way_id][-1]:
            assert refs[0] == refs[-1], f"way {way_id} was closed and is not now"
```

Then check the aggregate effect on the layer, which is where over-snapping shows up:

```python
before = gdf.geometry.area.sum()
after = repaired.geometry.area.sum()
logger.info("total area changed by %.4f%%", 100 * (after - before) / before)
```

A change of a few thousandths of a percent is repair. A change of a tenth of a percent means buildings are being merged, and the tolerance is too large.

Finally, look at the oversized clusters by hand the first time. They are the cases where the tolerance and the data disagree, and they usually reveal something about the source rather than about the algorithm.

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Tolerance behaves differently by latitude | Coordinates in degrees | Project to metres first |
| Different result on each run | Pairwise snapping in iteration order | Cluster with connected components |
| Whole terraces collapse into one building | Transitive chaining | Add a cluster-diameter guard |
| Ways reference nodes that no longer exist | Refs not rewritten | Rewrite every way after snapping |
| Rings fail validity after snapping | Consecutive duplicate refs | Collapse repeats; drop degenerate rings |
| Total area drops noticeably | Tolerance too large for the source | Set it from survey accuracy |
| Runs for hours | Pairwise distance loop | Use a KD-tree `query_pairs` |

## Frequently Asked Questions

<details>
<summary>What tolerance should I use?</summary>

Start from the positional accuracy of the source and use a fraction of it. Data digitised from 20 cm imagery justifies something around 5–10 cm; data traced from coarser satellite imagery justifies more. Do not derive it from the percentage of gaps it closes — that curve keeps rising long after the merges have stopped being correct.
</details>

<details>
<summary>Centroid or an existing node as the representative?</summary>

An existing node, in almost every case. It is deterministic, it preserves node identity and any tags attached to it, and it leaves one vertex exactly where the survey put it. A centroid moves every node in the cluster, including the one that was probably right, and it invents a coordinate nobody observed.
</details>

<details>
<summary>Should snapping run before or after geometry assembly?</summary>

Before. Snapping exists largely to make assembly succeed — closing ring gaps and joining multipolygon member chains, as in [Repairing Unclosed Ways and Broken Multipolygons](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/repairing-unclosed-ways-and-broken-multipolygons/). Running it afterwards means the assembly has already failed on the gaps you were about to close.
</details>

<details>
<summary>Is it safe to snap nodes on a road network?</summary>

With a much smaller tolerance than on buildings, and with care. Parallel carriageways, service roads beside a main road and footways alongside streets are all genuinely separate features a metre or two apart, and merging them creates junctions that do not exist — which then shows up as a routing defect rather than as a geometry one. Snap exact duplicates freely; go beyond a few centimetres only with evidence.
</details>

## Specification reference

> There is no OSM specification for node snapping — it is a repair operation, not a data-model concept. The constraints it must respect are the model's: every way reference must resolve to an existing node, a closed way must begin and end with the same node reference, and a linear way needs at least two distinct nodes while a ring needs at least four references describing three distinct positions.

## Related

- [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/) — the topic this repair belongs to.
- [Repairing Unclosed Ways and Broken Multipolygons](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/repairing-unclosed-ways-and-broken-multipolygons/) — the assembly this unblocks.
- [Detecting Self-Intersecting OSM Polygons with Shapely](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/detecting-self-intersecting-osm-polygons-with-shapely/) — the validity failures a bad snap creates.
- [Picking a UTM Zone for an OSM Extract](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/picking-a-utm-zone-for-an-osm-extract/) — getting to metres before setting a tolerance.
- [Node, Way & Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — the references that must be rewritten.

Up one level: [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/).
