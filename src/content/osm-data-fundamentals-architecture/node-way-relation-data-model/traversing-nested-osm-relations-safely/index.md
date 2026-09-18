---
title: "Traversing Nested OSM Relations Safely"
description: "Walk relations that contain relations without looping forever or exploding: cycle detection, a depth ceiling, a visited set, and a bounded result that fails loudly rather than quietly."
pageTitle: "Walk Nested OSM Relations Without Loops or Blowups"
pageDescription: "Traverse OSM super-relations with cycle detection, an explicit depth limit, a visited set and a member-count ceiling, so a malformed hierarchy fails with a clear message instead of hanging."
slug: traversing-nested-osm-relations-safely
type: article
breadcrumb: "Nested Relations"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Traversing Nested OSM Relations Safely

Relations can contain relations, nothing forbids a cycle, and nothing bounds the depth. A naive recursive walk over a route hierarchy works on every relation you test with and hangs on the one that matters.

## Prerequisites

- [ ] Python 3.10+; the traversal uses only the standard library.
- [ ] Relation members available by identifier, from a parsed extract or an API client.
- [ ] The relation model from [Node, Way & Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/).
- [ ] A memory budget, since the failure mode here is unbounded growth.
- [ ] A super-relation to test against — long-distance routes and administrative hierarchies both nest.

## Conceptual minimum

An OSM relation's members can be nodes, ways or *other relations*. That last case makes the structure a general directed graph rather than a tree, and three properties follow that a tree-shaped assumption gets wrong.

**Cycles are possible.** Relation A can contain B, which contains A. Nothing in the data model prevents it and mappers occasionally create it by accident. A recursive walk without a visited set recurses until the stack ends.

**Depth is unbounded in principle.** Route hierarchies nest three or four deep in practice; nothing guarantees that, and a walk with no ceiling has no bound on its work.

**The same relation can be reached by several paths.** A member may legitimately appear under two parents, and a walk that does not deduplicate will process it twice, producing doubled geometry or doubled counts.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="tnr1-t tnr1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="tnr1-t">Three structures a naive recursive walk gets wrong</title>
  <desc id="tnr1-d">Three panels. A cycle, where a relation eventually contains itself through a chain of members, makes an unguarded recursive walk recurse until the stack is exhausted. A diamond, where one relation is reached through two different parents, makes a walk without a visited set process it twice and double whatever it accumulates. Deep nesting, where route relations contain route relations several levels down, makes an unbounded walk do far more work than expected with no signal that anything is wrong.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three shapes, three different failures</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Cycle</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">A contains B contains A</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Rare but real</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Unguarded walk never ends</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Visited set fixes it</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Diamond</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">One child, two parents</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Entirely legitimate</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Processed twice</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Counts and geometry double</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Deep nesting</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Routes within routes</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Three or four levels</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">No bound in the model</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Work grows silently</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">All three are fixed by the same three lines: a visited set, a depth ceiling and a member-count cap.</text>
</svg>
<figcaption>None of these is malformed data; the data model simply permits structures a tree-shaped walk cannot handle.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.relations.traverse")

MAX_DEPTH = 8
MAX_MEMBERS = 250_000


class TraversalLimit(RuntimeError):
    """The traversal hit a guard rather than finishing naturally."""


@dataclass
class Result:
    ways: list[int] = field(default_factory=list)
    nodes: list[int] = field(default_factory=list)
    relations_visited: set[int] = field(default_factory=set)
    max_depth_seen: int = 0
    cycles: list[tuple[int, int]] = field(default_factory=list)


def traverse(root_id: int,
             members_of: Callable[[int], list[tuple[str, int, str]]],
             max_depth: int = MAX_DEPTH,
             max_members: int = MAX_MEMBERS) -> Result:
    """Breadth-first walk over a relation hierarchy, with every guard explicit.

    Iterative rather than recursive: a cycle in the data must not become a
    stack overflow, and an iterative walk makes the depth ceiling obvious.
    """
    result = Result()
    # (relation id, depth, parent id) — the parent is kept for cycle reporting.
    queue: deque[tuple[int, int, int | None]] = deque([(root_id, 0, None)])
    result.relations_visited.add(root_id)
    seen_members = 0

    while queue:
        relation_id, depth, parent = queue.popleft()
        result.max_depth_seen = max(result.max_depth_seen, depth)

        if depth >= max_depth:
            raise TraversalLimit(
                f"relation {relation_id} sits at depth {depth}; the ceiling is "
                f"{max_depth}. Either raise it deliberately or the hierarchy "
                f"is malformed.")

        for member_type, member_id, _role in members_of(relation_id):
            seen_members += 1
            if seen_members > max_members:
                raise TraversalLimit(
                    f"traversal exceeded {max_members} members after visiting "
                    f"{len(result.relations_visited)} relation(s)")

            if member_type == "way":
                result.ways.append(member_id)
            elif member_type == "node":
                result.nodes.append(member_id)
            elif member_type == "relation":
                if member_id in result.relations_visited:
                    # Already reached: either a diamond or a cycle. Record it
                    # and do NOT descend again.
                    result.cycles.append((relation_id, member_id))
                    continue
                result.relations_visited.add(member_id)
                queue.append((member_id, depth + 1, relation_id))

    # De-duplicate: a way can legitimately belong to several relations.
    result.ways = sorted(set(result.ways))
    result.nodes = sorted(set(result.nodes))
    logger.info("visited %d relation(s) to depth %d: %d way(s), %d node(s), "
                "%d repeat edge(s)", len(result.relations_visited),
                result.max_depth_seen, len(result.ways), len(result.nodes),
                len(result.cycles))
    return result


def detect_true_cycles(result: Result,
                       members_of: Callable[[int], list[tuple[str, int, str]]]
                       ) -> list[tuple[int, int]]:
    """Separate genuine cycles from harmless diamonds among the repeat edges."""
    genuine: list[tuple[int, int]] = []
    for parent, child in result.cycles:
        # A true cycle means the child can reach the parent again.
        reachable: set[int] = set()
        stack = [child]
        while stack:
            current = stack.pop()
            for t, i, _ in members_of(current):
                if t != "relation" or i in reachable:
                    continue
                reachable.add(i)
                stack.append(i)
        if parent in reachable:
            genuine.append((parent, child))
    if genuine:
        logger.error("%d genuine cycle(s): %s", len(genuine), genuine[:5])
    return genuine


if __name__ == "__main__":
    graph = {1: [("relation", 2, ""), ("way", 10, "")],
             2: [("way", 11, ""), ("relation", 1, "")]}
    result = traverse(1, lambda rid: graph.get(rid, []))
    detect_true_cycles(result, lambda rid: graph.get(rid, []))
```

## Step-by-step walkthrough

1. **Iterate, do not recurse.** A cycle in the data should produce a clear error, not a stack overflow whose traceback says nothing about relations.
2. **Mark visited on enqueue, not on dequeue.** Marking on dequeue lets the same relation be queued several times before any of them is processed, which reintroduces the duplication the set exists to prevent.
3. **Cap the depth explicitly.** Eight levels is far beyond anything legitimate; hitting it means the hierarchy is malformed and the message says so rather than leaving somebody to guess.
4. **Cap the member count.** Depth alone does not bound the work, because a shallow hierarchy can still fan out enormously. A member ceiling is the guard that actually bounds memory.
5. **Record repeat edges rather than ignoring them.** A relation reached twice is either a diamond or a cycle, and recording the edge lets the two be distinguished afterwards without slowing the main walk.
6. **Deduplicate the results.** A way belonging to three route relations appears three times; a consumer counting kilometres will triple them.
7. **Separate cycles from diamonds after the fact.** Only a genuine cycle is a data error worth reporting to mappers, and the reachability check that distinguishes them is too expensive to run inline.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="tnr2-t tnr2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="tnr2-t">The four guards and what each one bounds</title>
  <desc id="tnr2-d">Four guards applied in order. The visited set bounds the number of relations processed, ensuring each is handled exactly once regardless of how many paths reach it. The depth ceiling bounds how far the hierarchy can nest before the traversal refuses, catching malformed structures. The member cap bounds total work, which depth alone cannot because a shallow hierarchy can fan out widely. The result deduplication bounds the output, because a way belonging to several relations would otherwise be counted once per membership.</desc>
  <defs><marker id="tnr2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four guards, four different things bounded</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">visited set</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">bounds relations</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">each one once</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#tnr2-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">depth ceiling</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">bounds nesting</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">catches malformed</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#tnr2-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">member cap</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">bounds total work</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">depth cannot</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#tnr2-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">dedupe output</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">bounds the result</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">a way counted once</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Omitting any one of the four leaves a structure that the other three permit and that still produces a wrong or unbounded result.</text>
</svg>
<figcaption>The third guard is the one usually missing, because a depth limit feels like it should be enough and is not.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="tnr3-t tnr3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="tnr3-t">What each guard costs and what it prevents</title>
  <desc id="tnr3-d">A grid of four guards against their runtime cost and the failure each prevents. A visited set costs one hash set of relation identifiers and prevents infinite recursion on a cycle. A depth ceiling costs one integer comparison per relation and prevents unbounded descent through a malformed hierarchy. A member cap costs one counter increment per member and prevents memory exhaustion from a wide fan-out. Output deduplication costs one pass over the collected identifiers and prevents counts and geometry being multiplied by membership.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four guards, all of them cheap</text>
  <rect x="206" y="48" width="324" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="368" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Costs</text>
  <rect x="530" y="48" width="324" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="692" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Prevents</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Visited set</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a hash set</text>
  <text x="692" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">infinite recursion</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Depth ceiling</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">one comparison</text>
  <text x="692" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">unbounded descent</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Member cap</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">one counter</text>
  <text x="692" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">memory exhaustion</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Output dedupe</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">one final pass</text>
  <text x="692" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">multiplied counts</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Together they add a few lines and a set, which is negligible against the cost of the traversal they are protecting.</text>
</svg>
<figcaption>None of these is an optimisation trade-off; they are all cheap enough to be unconditional.</figcaption>
</figure>

## Verification

- **A cycle terminates.** Build a two-relation cycle and confirm the walk finishes and reports a repeat edge.
- **A diamond is not reported as a cycle.** Build one and confirm the repeat edge is recorded but the genuine-cycle check returns nothing.
- **The depth ceiling fires.** Construct a hierarchy deeper than the limit and confirm the error names the depth.
- **The member cap fires.** Lower the cap and confirm the traversal stops with a count rather than exhausting memory.
- **Results are deduplicated.** A way in two child relations must appear once in the output.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Traversal never finishes | Cycle with no visited set | Mark relations visited as they are enqueued |
| Stack overflow on deep data | Recursive implementation | Use an iterative queue with an explicit depth |
| Same relation processed twice | Visited marked on dequeue | Mark on enqueue instead |
| Geometry or counts doubled | Results not deduplicated | Collapse way and node identifiers to a set |
| Memory exhausted at shallow depth | Only depth bounded | Add a member-count ceiling |
| Every repeat edge reported as a cycle | Diamonds and cycles conflated | Run a reachability check to separate them |
| Limits hit on legitimate data | Ceilings set too tight | Raise them deliberately, with the reason recorded |

## Specification reference

> A relation's members may be nodes, ways or other relations, and the data model places no restriction on nesting depth or on a relation being a member of one it transitively contains. Consumers are therefore responsible for cycle detection and for bounding traversal. See the [relation documentation](https://wiki.openstreetmap.org/wiki/Relation) for the member model and the [super-relation discussion](https://wiki.openstreetmap.org/wiki/Relation:superroute) for how route hierarchies nest in practice.

## Frequently Asked Questions

<details>
<summary>Are cycles in OSM relations actually possible?</summary>

Yes. Nothing in the data model or the editing API prevents relation A from containing relation B while B contains A, and mappers create such structures occasionally by accident when reorganising route hierarchies. They are rare, which is why an unguarded traversal survives testing, and they are catastrophic when encountered, which is why the visited set is not optional.
</details>

<details>
<summary>Is a depth limit enough on its own?</summary>

No, because depth does not bound breadth. A hierarchy three levels deep whose top relation has five thousand children, each with five thousand members, stays well inside any reasonable depth ceiling while producing tens of millions of members. A member-count cap is the guard that actually bounds memory, and it is the one most often omitted because the depth limit feels sufficient.
</details>

<details>
<summary>How do I tell a cycle from a legitimate shared member?</summary>

By checking reachability after the walk. Reaching the same relation twice is ordinary — a way or a sub-relation can belong to several parents, and that diamond shape is entirely valid. It is only a cycle if the child can reach the parent again by following member links. That check is too expensive to run during the traversal and cheap enough to run afterwards on the handful of repeat edges recorded.
</details>

<details>
<summary>Should the traversal be breadth-first or depth-first?</summary>

Breadth-first, for two practical reasons. It makes the depth of each relation directly available, which is what the ceiling is checked against, and it naturally uses a queue rather than a call stack, so a pathological structure produces a clear error instead of a stack overflow. The traversal order itself rarely matters for the result, since the output is deduplicated anyway.
</details>

## Related

- [Node, Way & Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — the parent topic and the member model this walks.
- [Handling Multipolygon Members with No Role](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/handling-multipolygon-members-with-no-role/) — assembly for the flat relation case.
- [Resolving Way Node References Without a Full Node Cache](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/resolving-way-node-references-without-a-full-node-cache/) — resolving the ways this traversal collects.
- [Understanding OSM Multipolygon Relations for GIS](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/) — the most common relation type in a pipeline.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — where a traversal limit failure should be routed.

Up one level: [Node, Way & Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Traversing Nested OSM Relations Safely",
  "description": "Walk relations that contain relations without looping forever or exploding: cycle detection, a depth ceiling, a visited set, and a bounded result that fails loudly rather than quietly.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["relation traversal", "cycle detection", "super-relations"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Fundamentals & Architecture", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/" },
    { "@type": "ListItem", "position": 3, "name": "Node, Way & Relation Data Model", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/" },
    { "@type": "ListItem", "position": 4, "name": "Traversing Nested OSM Relations Safely", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/traversing-nested-osm-relations-safely/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Traverse a nested OSM relation hierarchy safely",
  "description": "Walk iteratively with a queue, mark relations visited on enqueue, cap both depth and total member count, deduplicate the collected identifiers, and separate genuine cycles from diamonds afterwards.",
  "step": [
    { "@type": "HowToStep", "name": "Iterate rather than recurse", "text": "Use an explicit queue so a cycle produces a clear error instead of a stack overflow." },
    { "@type": "HowToStep", "name": "Mark visited on enqueue", "text": "Add each relation to the visited set as it is queued, not as it is processed, to prevent duplicate queueing." },
    { "@type": "HowToStep", "name": "Cap the depth", "text": "Refuse to descend past an explicit ceiling and name the depth in the error, since exceeding it indicates malformed data." },
    { "@type": "HowToStep", "name": "Cap the member count", "text": "Bound total work with a member ceiling, because a shallow hierarchy can still fan out beyond memory." },
    { "@type": "HowToStep", "name": "Record repeat edges", "text": "Note every relation reached more than once without descending again, so cycles and diamonds can be told apart later." },
    { "@type": "HowToStep", "name": "Deduplicate the output", "text": "Collapse collected way and node identifiers to sets, since a member can belong to several relations." },
    { "@type": "HowToStep", "name": "Check reachability afterwards", "text": "Run a reachability test over the recorded repeat edges to identify genuine cycles worth reporting." }
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
      "name": "Are cycles in OSM relations actually possible?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes. Nothing in the data model or the editing API prevents relation A from containing relation B while B contains A, and mappers create such structures occasionally when reorganising route hierarchies. They are rare, which is why an unguarded traversal survives testing, and catastrophic when encountered." }
    },
    {
      "@type": "Question",
      "name": "Is a depth limit enough on its own for relation traversal?",
      "acceptedAnswer": { "@type": "Answer", "text": "No, because depth does not bound breadth. A hierarchy three levels deep whose top relation has thousands of children stays well inside any reasonable depth ceiling while producing tens of millions of members. A member-count cap is the guard that actually bounds memory." }
    },
    {
      "@type": "Question",
      "name": "How do I tell a relation cycle from a legitimate shared member?",
      "acceptedAnswer": { "@type": "Answer", "text": "By checking reachability after the walk. Reaching the same relation twice is ordinary, because a member can belong to several parents. It is only a cycle if the child can reach the parent again by following member links, and that check is cheap enough to run afterwards on the recorded repeat edges." }
    },
    {
      "@type": "Question",
      "name": "Should relation traversal be breadth-first or depth-first?",
      "acceptedAnswer": { "@type": "Answer", "text": "Breadth-first. It makes each relation's depth directly available for the ceiling check, and it naturally uses a queue rather than a call stack, so a pathological structure produces a clear error instead of a stack overflow. The order rarely matters for the result, since the output is deduplicated anyway." }
    }
  ]
}
</script>
