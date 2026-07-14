---
title: "Repairing Unclosed Ways and Broken Multipolygons"
description: "Assemble OSM multipolygon relation members into valid closed rings: close near-miss ways, chain fragmented members, fix outer/inner assignment by containment, and correct winding with Shapely make_valid."
pageTitle: "Repair Unclosed OSM Ways and Multipolygon Rings"
pageDescription: "Rebuild broken OSM multipolygons by chaining member ways into closed rings, snapping near-miss endpoints, assigning outer and inner by containment, and validating with Shapely make_valid."
slug: repairing-unclosed-ways-and-broken-multipolygons
type: article
breadcrumb: "Repairing Multipolygons"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Repairing Unclosed Ways and Broken Multipolygons

Take the member ways of an OSM multipolygon relation — some open, some fragmented across several ways, some digitised a nanodegree short of closing — and assemble them into valid, correctly nested `Polygon` geometry with the right outer/inner roles and winding.

## Prerequisites

- [ ] `shapely` ≥ 2.0 (`pip install "shapely>=2.0"`) for `make_valid`, `polygonize`, and `orient`.
- [ ] Python 3.10+ for the union types and structural code below.
- [ ] Member ways already resolved to coordinate sequences, with each member's `role` (`outer`/`inner`/empty) available — the reconstruction covered in [Understanding OSM Multipolygon Relations for GIS](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/).
- [ ] A closing tolerance in degrees appropriate to your data (a few `1e-7` for near-miss snapping).
- [ ] The parent [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/) guide's validity checks available for the post-repair gate.

## Conceptual minimum

An OSM multipolygon relation does not store rings — it stores *member ways*, and a ring often spans several of them. A large lake boundary might be split into four ways that only form a closed loop when chained end-to-end; a building might be a single closed way used directly as an outer ring. Three things routinely go wrong. A way meant to close on itself ends a hair short, because the editor never snapped the final node to the first — the endpoints differ by a nanodegree, so a `Polygon` constructor rejects it. Fragmented members fail to chain because their shared endpoints do not match exactly, or because a member is reversed relative to its neighbour. And the `outer`/`inner` role tags may be missing or wrong, so a ring that should punch a hole is treated as a second outer, or vice versa.

Repair is therefore a pipeline: **chain** members into rings by matching endpoints, **close** each ring by snapping near-miss endpoints, **classify** rings as outer or inner by containment rather than trusting the role tags blindly, and **orient** each ring to the right-hand-rule winding that the [OGC Simple Features](https://www.ogc.org/standards/sfa) model and GIS engines expect — exterior counter-clockwise, holes clockwise. Only then does `make_valid` get the last word, resolving any residual self-touch. This sits under [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/), which frames when to attempt this repair versus quarantine a relation whose members simply do not form coherent rings.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 940 360" role="img" aria-label="Multipolygon repair pipeline. Fragmented and near-miss member ways enter on the left. A chain stage links members by matching shared endpoints, reversing members where needed. A close stage snaps endpoints that fall within tolerance so each ring closes. A classify stage assigns outer versus inner rings by containment rather than trusting role tags. An orient stage sets exterior rings counter-clockwise and holes clockwise. The result is a valid nested polygon, and any ring that fails to close is routed to quarantine." style="width:100%;max-width:940px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Multipolygon repair pipeline: chain, close, classify, orient, validate</title>
  <desc>Member ways flow through chain, close, classify by containment, and orient stages into a valid nested polygon; rings that cannot be closed branch off to quarantine.</desc>
  <defs>
    <marker id="rmp-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <text x="470" y="24" text-anchor="middle" font-size="14" fill="currentColor" font-weight="700">Chain, close, classify by containment, orient, then validate</text>
  <!-- input -->
  <rect x="24" y="120" width="140" height="70" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="94" y="148" text-anchor="middle" font-size="12" fill="currentColor" font-weight="600">Member ways</text>
  <text x="94" y="166" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.82">open · fragmented</text>
  <text x="94" y="181" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.82">near-miss ends</text>
  <!-- stages -->
  <g>
    <line x1="164" y1="155" x2="196" y2="155" stroke="currentColor" stroke-width="1.5" marker-end="url(#rmp-arr)"/>
    <rect x="198" y="128" width="120" height="54" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
    <text x="258" y="150" text-anchor="middle" font-size="12" fill="currentColor" font-weight="600">Chain</text>
    <text x="258" y="167" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.82">match endpoints</text>
    <line x1="318" y1="155" x2="350" y2="155" stroke="currentColor" stroke-width="1.5" marker-end="url(#rmp-arr)"/>
    <rect x="352" y="128" width="120" height="54" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
    <text x="412" y="150" text-anchor="middle" font-size="12" fill="currentColor" font-weight="600">Close</text>
    <text x="412" y="167" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.82">snap to tolerance</text>
    <line x1="472" y1="155" x2="504" y2="155" stroke="currentColor" stroke-width="1.5" marker-end="url(#rmp-arr)"/>
    <rect x="506" y="128" width="120" height="54" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
    <text x="566" y="150" text-anchor="middle" font-size="12" fill="currentColor" font-weight="600">Classify</text>
    <text x="566" y="167" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.82">outer / inner</text>
    <line x1="626" y1="155" x2="658" y2="155" stroke="currentColor" stroke-width="1.5" marker-end="url(#rmp-arr)"/>
    <rect x="660" y="128" width="120" height="54" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
    <text x="720" y="150" text-anchor="middle" font-size="12" fill="currentColor" font-weight="600">Orient</text>
    <text x="720" y="167" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.82">CCW / CW</text>
  </g>
  <!-- output -->
  <line x1="780" y1="155" x2="812" y2="155" stroke="var(--osm-ok,#15803d)" stroke-width="1.6" marker-end="url(#rmp-arr)"/>
  <rect x="814" y="122" width="112" height="66" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.6"/>
  <text x="870" y="148" text-anchor="middle" font-size="11.5" fill="currentColor" font-weight="600">Valid nested</text>
  <text x="870" y="164" text-anchor="middle" font-size="11.5" fill="currentColor" font-weight="600">polygon</text>
  <text x="870" y="180" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.8">make_valid gate</text>
  <!-- quarantine branch off close -->
  <path d="M412,182 V250 H470" fill="none" stroke="var(--osm-warn,#a16207)" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#rmp-arr)"/>
  <text x="360" y="232" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">gap &gt; tolerance</text>
  <rect x="472" y="224" width="150" height="54" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="547" y="248" text-anchor="middle" font-size="12" fill="currentColor" font-weight="600">Quarantine</text>
  <text x="547" y="265" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.82">ring will not close</text>
  <text x="470" y="322" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.9">Trust containment over role tags; snap only sub-tolerance gaps; quarantine the rest.</text>
</svg>

## Runnable solution

The module chains member ways into rings, closes near-miss rings by snapping, classifies rings as outer or inner by containment, orients them, and validates the assembled polygon. It uses Shapely 2.x, Python 3.10+ type hints, and the project logger convention.

```python
from __future__ import annotations

import logging
from dataclasses import dataclass

from shapely import make_valid
from shapely.geometry import LinearRing, MultiPolygon, Point, Polygon
from shapely.geometry.polygon import orient

logger = logging.getLogger("osm.geometry.repair_multipolygon")

Coord = tuple[float, float]


@dataclass
class Member:
    role: str                 # "outer", "inner", or ""
    coords: list[Coord]       # resolved node coordinates in way order


def _endpoints_match(a: Coord, b: Coord, tol: float) -> bool:
    return abs(a[0] - b[0]) <= tol and abs(a[1] - b[1]) <= tol


def chain_members(members: list[Member], tol: float) -> list[list[Coord]]:
    """Chain member ways into ordered rings by matching shared endpoints."""
    pending = [list(m.coords) for m in members if len(m.coords) >= 2]
    rings: list[list[Coord]] = []
    while pending:
        ring = pending.pop(0)
        extended = True
        while extended and not _endpoints_match(ring[0], ring[-1], tol):
            extended = False
            for i, seg in enumerate(pending):
                if _endpoints_match(ring[-1], seg[0], tol):
                    ring.extend(seg[1:]); pending.pop(i); extended = True; break
                if _endpoints_match(ring[-1], seg[-1], tol):
                    ring.extend(reversed(seg[:-1])); pending.pop(i); extended = True; break
        rings.append(ring)
    return rings


def close_ring(ring: list[Coord], tol: float) -> list[Coord] | None:
    """Snap a near-miss ring closed; return None if the gap exceeds tolerance."""
    if len(ring) < 4:
        return None
    if ring[0] == ring[-1]:
        return ring
    if _endpoints_match(ring[0], ring[-1], tol):
        return [*ring[:-1], ring[0]]      # snap last onto first
    logger.warning("ring gap %.9f exceeds tolerance; cannot close", _gap(ring))
    return None


def _gap(ring: list[Coord]) -> float:
    return Point(ring[0]).distance(Point(ring[-1]))


def assemble(members: list[Member], tol: float = 5e-7) -> Polygon | MultiPolygon | None:
    """Assemble multipolygon members into a valid, correctly nested polygon."""
    closed: list[LinearRing] = []
    for ring in chain_members(members, tol):
        snapped = close_ring(ring, tol)
        if snapped is None:
            continue                      # send to quarantine upstream
        try:
            closed.append(LinearRing(snapped))
        except ValueError as exc:
            logger.warning("invalid ring discarded: %s", exc)

    if not closed:
        return None

    # Classify by containment: the largest ring not inside another is outer.
    polys = [Polygon(r) for r in closed]
    outers = [p for p in polys if not any(o.contains(p) and o is not p for o in polys)]
    result_parts: list[Polygon] = []
    for outer in outers:
        holes = [p.exterior.coords for p in polys if outer.contains(p) and p is not outer]
        poly = orient(Polygon(outer.exterior.coords, holes), sign=1.0)  # CCW shell
        result_parts.append(poly)

    assembled = result_parts[0] if len(result_parts) == 1 else MultiPolygon(result_parts)
    fixed = make_valid(assembled)
    if not fixed.is_valid or fixed.is_empty:
        logger.error("assembled multipolygon failed final validity gate")
        return None
    return fixed
```

## Step-by-step walkthrough

1. **Members carry their role and coordinates** — the `Member` dataclass keeps the OSM `role` tag beside the resolved geometry, but note the role is a hint, not the source of truth for nesting.
2. **Chaining tolerates reversal** — `chain_members` grows a ring by appending any member whose endpoint matches the ring's tail, reversing the member when only its far end matches. This handles the common case where members were digitised in inconsistent directions.
3. **Endpoint matching uses a tolerance** — `_endpoints_match` compares within `tol` rather than requiring exact equality, because shared nodes across ways can differ by a floating-point epsilon after coordinate reconstruction.
4. **Closing snaps only sub-tolerance gaps** — `close_ring` closes a ring by replacing its last coordinate with its first when the gap is within tolerance, and returns `None` (a quarantine signal) when the gap is too wide to close honestly.
5. **Degenerate rings are rejected early** — a ring with fewer than four coordinates cannot bound an area and is dropped before it reaches the `LinearRing` constructor.
6. **Nesting comes from containment, not tags** — `outers` are the rings not contained by any other ring, and each outer's holes are the rings it contains. This is what fixes a mislabelled `inner`/`outer` role: geometry decides.
7. **Orientation is set explicitly** — `orient(..., sign=1.0)` forces the exterior counter-clockwise and holes clockwise, the right-hand-rule winding GIS consumers assume, regardless of how the source ways wound.
8. **`make_valid` is the final gate** — after assembly, `make_valid` resolves any residual self-touch between a hole and its shell, and the validity check rejects the result rather than emitting a silently broken polygon.

## Verification

- **Closed and valid.** `assemble(members).is_valid` must be `True`, and `is_empty` must be `False`.
- **Holes are present.** For a relation with inner members, the result's `interiors` (or each part's `interiors`) must be non-empty; a lost hole means containment classification failed.
- **Winding is correct.** `assembled.exterior.is_ccw` must be `True` and each interior ring's `is_ccw` must be `False`.
- **Area is plausible.** Compare the assembled area against a rough expected value; a hole treated as a second outer inflates the area, a missing hole also inflates it.
- **Quarantine fires on a wide gap.** Feed a member set with a deliberately large end-to-end gap and confirm `assemble` logs the tolerance warning and returns `None` rather than a torn ring.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| `ValueError: A LinearRing must have at least 3 coordinate tuples` | Ring chained to fewer than 4 points | The `len(ring) < 4` guard drops it; verify members actually share endpoints |
| Hole rendered as a separate polygon | Containment check skipped; role tag trusted | Classify by `outer.contains(p)`, not by the `inner` role tag |
| Ring never closes | Endpoints differ beyond tolerance | Widen `tol` cautiously, or quarantine — a wide gap means a genuinely missing member |
| Polygon valid but hole is filled | Interior ring wound the same way as the shell | Use `orient` so holes are clockwise relative to a CCW shell |
| Members chain in the wrong order | Only forward matching attempted | Keep the reversed-endpoint branch in `chain_members` |
| `make_valid` returns a GeometryCollection | Rings self-touch after assembly | Extract polygonal parts; if none survive, quarantine the relation |

## Specification reference

> An OSM multipolygon relation carries member ways with `outer` and `inner` roles; the ways must be assembled into closed rings, and a single ring may be split across several member ways that share end nodes. The authoritative rules for ring assembly, role semantics, and the requirement that inner rings lie within outer rings are documented on the OSM Wiki at [Relation:multipolygon](https://wiki.openstreetmap.org/wiki/Relation:multipolygon). Ring closure and validity follow the [OGC Simple Features](https://www.ogc.org/standards/sfa) polygon rules that Shapely's `make_valid` enforces.

## Frequently Asked Questions

<details>
<summary>Should I trust the inner and outer role tags?</summary>

Treat them as hints, not truth. Roles are frequently missing or swapped in real OSM data, and a wrong role turns a hole into a second outer ring or drops it entirely. Classify nesting by geometric containment instead: the rings not contained by any other ring are outers, and each outer's holes are the rings it contains. Geometry is self-consistent in a way that hand-entered role tags are not.
</details>

<details>
<summary>How large should the closing tolerance be?</summary>

Small — a few times 1e-7 degrees, which is roughly a few centimetres at the equator, is enough to absorb the floating-point epsilon between nodes that should coincide. A larger tolerance risks snapping across a genuinely missing member and fabricating a ring that was never mapped. When the gap exceeds tolerance, quarantining the relation is safer than widening the tolerance to force closure.
</details>

<details>
<summary>Why chain member ways instead of polygonizing them directly?</summary>

A single ring is often split across several member ways, so no individual member is a closed ring on its own. Chaining links members by shared endpoints, handling members digitised in opposite directions, so the loop closes. Shapely's polygonize can help once you have a clean noded edge set, but explicit endpoint chaining gives you control over the reversal and tolerance behaviour that raw OSM members demand.
</details>

<details>
<summary>What if make_valid returns a GeometryCollection after assembly?</summary>

That means the assembled rings still self-touch or overlap in a way with no single valid interpretation. Extract the polygonal parts from the collection and keep those; if no polygon survives, the relation's members do not form coherent rings and the whole relation should be quarantined for review rather than forced into a shape the source data does not support.
</details>

## Related

- [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/) — the parent guide framing when to repair versus quarantine and the full defect taxonomy.
- [Detecting Self-Intersecting OSM Polygons with Shapely](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/detecting-self-intersecting-osm-polygons-with-shapely/) — the sibling detection pass that flags the crossings this repair may resolve.
- [Understanding OSM Multipolygon Relations for GIS](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/) — the relation model and role semantics behind member assembly.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — where relations that will not assemble are quarantined.
- [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) — the quality section this repair step belongs to.

Up one level: [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Repairing Unclosed Ways and Broken Multipolygons",
  "description": "Assemble OSM multipolygon relation members into valid closed rings: close near-miss ways, chain fragmented members, fix outer/inner assignment by containment, and correct winding with Shapely make_valid.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Data Quality & Validation",
  "about": ["OSM multipolygon repair", "unclosed way closure", "ring assembly and winding"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Quality & Validation", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/" },
    { "@type": "ListItem", "position": 3, "name": "Geometry Validation & Repair", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/" },
    { "@type": "ListItem", "position": 4, "name": "Repairing Unclosed Ways and Broken Multipolygons", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/repairing-unclosed-ways-and-broken-multipolygons/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Repair unclosed OSM ways and broken multipolygons",
  "description": "Assemble OSM multipolygon members into valid nested polygons by chaining ways, snapping near-miss closures, classifying rings by containment, and orienting winding.",
  "step": [
    { "@type": "HowToStep", "name": "Chain member ways into rings", "text": "Link members by matching shared endpoints within a tolerance, reversing members whose direction is inconsistent, until each ring closes on itself." },
    { "@type": "HowToStep", "name": "Close near-miss rings", "text": "Snap a ring's last coordinate onto its first when the gap is within tolerance, and quarantine any ring whose gap is too wide to close honestly." },
    { "@type": "HowToStep", "name": "Classify rings by containment", "text": "Treat rings not contained by any other ring as outers and each outer's contained rings as its holes, ignoring unreliable role tags." },
    { "@type": "HowToStep", "name": "Orient rings to right-hand rule", "text": "Force exterior rings counter-clockwise and interior rings clockwise so GIS consumers read holes correctly." },
    { "@type": "HowToStep", "name": "Validate the assembled polygon", "text": "Run make_valid as a final gate and reject any result that is empty or still invalid rather than emitting a silently broken polygon." }
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
      "name": "Should I trust the inner and outer role tags?",
      "acceptedAnswer": { "@type": "Answer", "text": "Treat them as hints, not truth. Roles are frequently missing or swapped in real OSM data, and a wrong role turns a hole into a second outer ring or drops it entirely. Classify nesting by geometric containment instead: the rings not contained by any other ring are outers, and each outer's holes are the rings it contains. Geometry is self-consistent in a way that hand-entered role tags are not." }
    },
    {
      "@type": "Question",
      "name": "How large should the closing tolerance be?",
      "acceptedAnswer": { "@type": "Answer", "text": "Small. A few times 1e-7 degrees, which is roughly a few centimetres at the equator, is enough to absorb the floating-point epsilon between nodes that should coincide. A larger tolerance risks snapping across a genuinely missing member and fabricating a ring that was never mapped. When the gap exceeds tolerance, quarantining the relation is safer than widening the tolerance to force closure." }
    },
    {
      "@type": "Question",
      "name": "Why chain member ways instead of polygonizing them directly?",
      "acceptedAnswer": { "@type": "Answer", "text": "A single ring is often split across several member ways, so no individual member is a closed ring on its own. Chaining links members by shared endpoints, handling members digitised in opposite directions, so the loop closes. Shapely polygonize can help once you have a clean noded edge set, but explicit endpoint chaining gives control over the reversal and tolerance behaviour that raw OSM members demand." }
    },
    {
      "@type": "Question",
      "name": "What if make_valid returns a GeometryCollection after assembly?",
      "acceptedAnswer": { "@type": "Answer", "text": "That means the assembled rings still self-touch or overlap in a way with no single valid interpretation. Extract the polygonal parts from the collection and keep those; if no polygon survives, the relation's members do not form coherent rings and the whole relation should be quarantined for review rather than forced into a shape the source data does not support." }
    }
  ]
}
</script>
