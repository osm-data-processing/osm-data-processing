---
title: "Handling Multipolygon Members with No Role"
description: "Reconstruct a multipolygon whose members carry no outer or inner role by assembling rings first and deciding containment geometrically, the way the spec says consumers must."
pageTitle: "Assembling OSM Multipolygons When Roles Are Missing"
pageDescription: "Rebuild an OSM multipolygon relation with empty member roles: ring the ways, test containment geometrically, assign outer and inner by nesting depth, and log where the data disagrees."
slug: handling-multipolygon-members-with-no-role
type: article
breadcrumb: "Role-less Members"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Handling Multipolygon Members with No Role

A multipolygon relation whose members have no role is not broken data — the specification says a consumer must work out containment geometrically anyway. Code that trusts the roles works on most relations and fails on exactly the ones that needed care.

## Prerequisites

- [ ] Python 3.10+ with `shapely` ≥ 2.0.
- [ ] Relation members already resolved to way geometry, per [Node, Way & Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/).
- [ ] Familiarity with ring assembly from [Understanding OSM Multipolygon Relations for GIS](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/).
- [ ] A validity checker for the result, per [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/).
- [ ] A relation with empty roles to test against; they are common enough to find quickly.

## Conceptual minimum

The multipolygon specification is explicit that member roles are advisory. A conforming consumer assembles the member ways into closed rings and then determines, geometrically, which rings are outer and which are inner. Roles, where present, are a hint and may be wrong.

That turns assembly into three steps rather than one.

**Ring the ways.** Members are arbitrary fragments; consecutive ones share endpoints and must be stitched until each ring closes. A fragment that cannot be joined is a data error worth reporting rather than silently dropping.

**Nest the rings.** Every ring is tested for containment within every other. A ring contained by an even number of others is an outer ring; one contained by an odd number is a hole. That parity rule handles the awkward and legitimate case of an island inside a lake inside an island.

**Assemble.** Each outer ring becomes a polygon, with the odd-depth rings directly inside it as its holes.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="hmm1-t hmm1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="hmm1-t">Three steps from role-less members to a valid multipolygon</title>
  <desc id="hmm1-d">Four steps. The stitch step joins member way fragments end to end until each forms a closed ring, reporting any fragment that cannot be joined. The nest step tests every ring for containment inside every other, producing a depth for each. The parity step assigns rings at even depth as outer boundaries and rings at odd depth as holes, which handles an island inside a lake inside an island correctly. The assemble step builds one polygon per outer ring with the odd-depth rings immediately inside it as its interior rings.</desc>
  <defs><marker id="hmm1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Stitch, nest, parity, assemble</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">stitch</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">join fragments</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">report what will not close</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#hmm1-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">nest</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">containment tests</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">a depth per ring</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#hmm1-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">parity</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">even outer, odd hole</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">handles islands in lakes</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#hmm1-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">assemble</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">polygon per outer</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">holes are its children</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Roles are consulted only afterwards, as a check on the geometric result rather than as the basis for it.</text>
</svg>
<figcaption>Deriving containment geometrically is what the specification requires, not a workaround for missing roles.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
from collections import defaultdict

from shapely.geometry import LinearRing, LineString, MultiPolygon, Polygon
from shapely.ops import linemerge

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.relations.multipolygon")


class UnclosedRing(ValueError):
    """Member ways could not be stitched into closed rings."""


def stitch_rings(ways: list[LineString]) -> list[LinearRing]:
    """Join member fragments end to end until each ring closes."""
    merged = linemerge(ways)
    parts = list(merged.geoms) if merged.geom_type == "MultiLineString" \
        else [merged]

    rings: list[LinearRing] = []
    open_parts: list[LineString] = []
    for part in parts:
        coords = list(part.coords)
        if len(coords) >= 4 and coords[0] == coords[-1]:
            rings.append(LinearRing(coords))
        else:
            open_parts.append(part)

    if open_parts:
        # An unclosed fragment is a data error worth naming, not dropping.
        raise UnclosedRing(
            f"{len(open_parts)} fragment(s) did not close; "
            f"first gap between {open_parts[0].coords[0]} and "
            f"{open_parts[0].coords[-1]}")
    return rings


def nesting_depth(rings: list[LinearRing]) -> list[int]:
    """How many other rings each ring sits inside."""
    polys = [Polygon(r) for r in rings]
    depths = []
    for i, inner in enumerate(polys):
        # A representative point is guaranteed inside; a centroid is not.
        probe = inner.representative_point()
        depth = sum(1 for j, outer in enumerate(polys)
                    if j != i and outer.contains(probe))
        depths.append(depth)
    return depths


def assemble(rings: list[LinearRing]) -> MultiPolygon:
    """Even depth is an outer ring; odd depth is a hole in its parent."""
    depths = nesting_depth(rings)
    polys = [Polygon(r) for r in rings]

    holes_of: dict[int, list[LinearRing]] = defaultdict(list)
    for i, depth in enumerate(depths):
        if depth % 2 == 0:
            continue
        # The parent is the smallest even-depth ring containing this one.
        probe = polys[i].representative_point()
        candidates = [(polys[j].area, j) for j, d in enumerate(depths)
                      if d == depth - 1 and polys[j].contains(probe)]
        if not candidates:
            logger.warning("ring %d at depth %d has no parent; treating as outer",
                           i, depth)
            continue
        holes_of[min(candidates)[1]].append(rings[i])

    built = [Polygon(rings[i], holes_of.get(i, []))
             for i, d in enumerate(depths) if d % 2 == 0]
    result = MultiPolygon([p for p in built if p.is_valid and not p.is_empty])
    logger.info("assembled %d ring(s) into %d polygon(s) with %d hole(s)",
                len(rings), len(result.geoms), sum(len(v) for v in holes_of.values()))
    return result


def check_roles(rings: list[LinearRing], roles: list[str]) -> None:
    """Compare the geometric answer against the declared roles, for reporting."""
    depths = nesting_depth(rings)
    for i, (depth, role) in enumerate(zip(depths, roles)):
        derived = "outer" if depth % 2 == 0 else "inner"
        if role and role != derived:
            logger.warning("member %d declares role %r; geometry says %s",
                           i, role, derived)


if __name__ == "__main__":
    outer = LineString([(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)])
    hole = LineString([(3, 3), (6, 3), (6, 6), (3, 6), (3, 3)])
    rings = stitch_rings([outer, hole])
    logger.info("%s", assemble(rings))
```

## Step-by-step walkthrough

1. **Merge before closing.** Members arrive as fragments in arbitrary order and direction; a line-merge joins them without requiring the caller to sort anything.
2. **Raise on an unclosed fragment.** A ring that will not close means the relation is incomplete or a member is missing from the extract, and naming the gap coordinates is what makes it fixable.
3. **Probe with a representative point.** A polygon's centroid can lie outside it for a crescent shape; a representative point is guaranteed inside, which matters because the containment test is the whole algorithm.
4. **Count containment, do not assume two levels.** An island in a lake on an island is depth 2, and a rule that only distinguishes inside from outside gets it exactly backwards.
5. **Attach each hole to its smallest containing parent.** With nested rings, several outer rings can contain a given hole; the smallest is the immediate parent.
6. **Warn rather than fail on an orphan.** A hole with no parent indicates inconsistent geometry, and treating it as an outer ring produces something usable while flagging the problem.
7. **Check roles afterwards, for reporting only.** Comparing the declared roles against the geometric result finds mistagged relations without ever letting a wrong role affect the output.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="hmm2-t hmm2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="hmm2-t">What nesting depth means for each ring, with a worked nesting</title>
  <desc id="hmm2-d">A grid of four rings from one relation against their nesting depth, the role the geometry implies, and what they represent in a worked example of an island in a lake on an island. The outermost ring is at depth zero and is an outer boundary, representing the main island. The lake ring is at depth one and is a hole, cut out of the island. The island within the lake is at depth two and is an outer boundary again. A pond on that inner island is at depth three and is a hole once more.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Depth parity, worked through an island in a lake</text>
  <rect x="206" y="48" width="216" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="314" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Depth</text>
  <rect x="422" y="48" width="216" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="530" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Implies</text>
  <rect x="638" y="48" width="216" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="746" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">In the example</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Outermost ring</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="314" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">0</text>
  <text x="530" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">outer</text>
  <text x="746" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">the main island</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Lake ring</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="314" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">1</text>
  <text x="530" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">hole</text>
  <text x="746" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">water on the island</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Inner island</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="314" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">2</text>
  <text x="530" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">outer</text>
  <text x="746" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">land in the lake</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Pond ring</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="314" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">3</text>
  <text x="530" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">hole</text>
  <text x="746" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">water on that land</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A two-level rule handles the first two rows and turns the third into a hole, erasing the island inside the lake entirely.</text>
</svg>
<figcaption>Parity generalises to any nesting depth, which is why it is the rule rather than a special case.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="hmm3-t hmm3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="hmm3-t">Three ways a role-trusting assembler produces wrong geometry</title>
  <desc id="hmm3-d">Three panels. A missing role makes the assembler treat the ring as an outer boundary by default, producing two overlapping polygons where one polygon with a hole was intended. A wrong role makes the assembler cut a hole where land should be or fill an area that should be water, which renders convincingly and is wrong. A nested case defeats the two-level model entirely, because an island inside a lake needs a ring that is both inside another ring and an outer boundary in its own right.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three failures, all from trusting the roles</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Missing role</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Defaults to outer</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Two overlapping polygons</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Area roughly doubles</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Renders as a solid block</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Wrong role</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Hole where land should be</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Or land where water is</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Renders convincingly</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Only area checks catch it</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Nested rings</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Island inside a lake</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Inside another, and outer</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Two-level model cannot</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Island vanishes entirely</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the second failure is detectable by looking at the result; the other two produce geometry that appears entirely reasonable.</text>
</svg>
<figcaption>Each of these is avoided by the same change: derive containment from the geometry and treat roles as a report.</figcaption>
</figure>

## Verification

- **A simple polygon with one hole assembles correctly.** Area should equal the outer area minus the hole.
- **Nested cases survive.** Build an island-in-a-lake-on-an-island and confirm four rings produce two polygons.
- **Unclosed input raises.** Remove a member fragment and confirm the error names the gap.
- **Role disagreements are reported.** Feed correct geometry with deliberately wrong roles and confirm warnings appear without the output changing.
- **The result is valid.** Every assembled polygon should pass a validity check, per [Detecting Self-Intersecting OSM Polygons with Shapely](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/detecting-self-intersecting-osm-polygons-with-shapely/).

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Islands inside lakes disappear | Two-level inside/outside rule | Use nesting parity, not a binary test |
| Holes attached to the wrong polygon | First containing ring chosen | Attach to the smallest containing parent |
| Containment test wrong on crescents | Centroid used as the probe | Use a representative point, guaranteed inside |
| Assembly silently drops members | Unclosed fragments ignored | Raise and name the gap coordinates |
| Output follows a wrong role | Roles trusted over geometry | Derive containment geometrically; check roles after |
| Members in the wrong order break it | Manual stitching assumed ordering | Use a line merge, which is order-independent |
| Relation incomplete in the extract | Members outside the cut boundary | Cut with a strategy that keeps relation members |

## Specification reference

> In the multipolygon relation, member roles `outer` and `inner` are used by many consumers but the geometry is authoritative: rings are formed from the member ways and their containment relationships determine which rings bound areas and which bound holes. Members with an empty role are valid and must be handled by geometric assembly. See the [multipolygon relation documentation](https://wiki.openstreetmap.org/wiki/Relation:multipolygon) for the assembly algorithm and the treatment of roles.

## Frequently Asked Questions

<details>
<summary>Is a multipolygon with empty roles invalid?</summary>

No. The specification treats roles as advisory and requires consumers to determine containment from the geometry, so a relation whose members carry no role is entirely conforming. Code that depends on roles is the thing out of specification, and it fails not only on role-less relations but on the more troublesome case of relations whose roles are present and wrong.
</details>

<details>
<summary>Why use nesting parity rather than a simple inside test?</summary>

Because nesting genuinely goes deeper than two levels. An island in a lake on an island is four rings at depths zero to three, and a binary inside-or-outside rule turns the inner island into a hole, erasing it. Parity generalises to any depth with no extra cases, which makes it both more correct and simpler than the special-cased alternative.
</details>

<details>
<summary>What should happen when a ring will not close?</summary>

Raise, naming the coordinates of the gap. An unclosed ring means either that the relation is genuinely broken or, far more often, that a member way is missing because the extract was cut without keeping relation members. Silently dropping the fragment produces a polygon that looks plausible and is wrong; naming the gap lets somebody check which of the two causes applies.
</details>

<details>
<summary>Should I ever use the declared roles at all?</summary>

As a check on your result, never as its basis. Comparing the geometric answer against the declared roles is a cheap and useful quality signal: a relation where the two disagree is one a mapper should look at. But the output must follow the geometry, because that is what the specification says and because a wrong role is at least as common as a missing one.
</details>

## Related

- [Node, Way & Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — the parent topic and the relation model this assembles.
- [Understanding OSM Multipolygon Relations for GIS](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/) — the wider multipolygon picture.
- [Traversing Nested OSM Relations Safely](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/traversing-nested-osm-relations-safely/) — relations containing relations, which this deliberately does not.
- [Repairing Unclosed Ways and Broken Multipolygons](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/repairing-unclosed-ways-and-broken-multipolygons/) — what to do when the stitch genuinely fails.
- [Choosing Complete Ways vs Smart in osmium extract](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/choosing-complete-ways-vs-smart-in-osmium-extract/) — the cut strategy that keeps relation members present.

Up one level: [Node, Way & Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Handling Multipolygon Members with No Role",
  "description": "Reconstruct a multipolygon whose members carry no outer or inner role by assembling rings first and deciding containment geometrically, the way the spec says consumers must.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["multipolygon assembly", "ring nesting", "member roles"]
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
    { "@type": "ListItem", "position": 4, "name": "Handling Multipolygon Members with No Role", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/handling-multipolygon-members-with-no-role/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Assemble an OSM multipolygon without relying on member roles",
  "description": "Merge member fragments into closed rings, raise on anything that will not close, compute nesting depth with representative points, assign outer and inner by parity, and check roles only afterwards.",
  "step": [
    { "@type": "HowToStep", "name": "Merge the fragments", "text": "Join member ways end to end with a line merge, which does not require them to arrive in order or direction." },
    { "@type": "HowToStep", "name": "Raise on unclosed rings", "text": "Report the coordinates of any gap rather than dropping the fragment, since a gap usually means a missing member." },
    { "@type": "HowToStep", "name": "Compute nesting depth", "text": "Count how many other rings contain each ring, probing with a representative point that is guaranteed inside." },
    { "@type": "HowToStep", "name": "Assign by parity", "text": "Treat even depths as outer boundaries and odd depths as holes, which generalises to any nesting level." },
    { "@type": "HowToStep", "name": "Attach holes to the smallest parent", "text": "Give each hole to the smallest containing ring of the next lower depth." },
    { "@type": "HowToStep", "name": "Check the roles last", "text": "Compare declared roles against the geometric result and report disagreements without letting them change the output." }
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
      "name": "Is an OSM multipolygon with empty member roles invalid?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. The specification treats roles as advisory and requires consumers to determine containment from the geometry, so a relation whose members carry no role is entirely conforming. Code that depends on roles is the thing out of specification, and it fails on relations whose roles are present and wrong as well." }
    },
    {
      "@type": "Question",
      "name": "Why use nesting parity rather than a simple inside test?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because nesting genuinely goes deeper than two levels. An island in a lake on an island is four rings at depths zero to three, and a binary inside-or-outside rule turns the inner island into a hole, erasing it. Parity generalises to any depth with no extra cases." }
    },
    {
      "@type": "Question",
      "name": "What should happen when a multipolygon ring will not close?",
      "acceptedAnswer": { "@type": "Answer", "text": "Raise, naming the coordinates of the gap. An unclosed ring means either the relation is broken or, far more often, a member way is missing because the extract was cut without keeping relation members. Silently dropping the fragment produces a polygon that looks plausible and is wrong." }
    },
    {
      "@type": "Question",
      "name": "Should I use the declared multipolygon roles at all?",
      "acceptedAnswer": { "@type": "Answer", "text": "As a check on your result, never as its basis. Comparing the geometric answer against the declared roles is a useful quality signal, since a relation where the two disagree is one a mapper should look at. But the output must follow the geometry, because a wrong role is at least as common as a missing one." }
    }
  ]
}
</script>
