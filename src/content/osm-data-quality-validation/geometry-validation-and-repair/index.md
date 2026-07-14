---
title: "Geometry Validation & Repair"
description: "Detect and repair the geometry defects OSM reconstruction produces — self-intersections, unclosed rings, spikes, degenerate polygons, and bad winding — with Shapely validity checks, buffer(0), make_valid, and a quarantine discipline."
pageTitle: "OSM Geometry Validation and Repair with Shapely"
pageDescription: "Find and fix invalid OSM geometries: self-intersections, unclosed rings, duplicate nodes, degenerate polygons, and wrong winding, using Shapely is_valid, explain_validity, buffer(0), and make_valid."
slug: geometry-validation-and-repair
type: guide
breadcrumb: "Geometry Validation & Repair"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Geometry Validation & Repair

A way in OpenStreetMap carries no coordinates of its own — it is an ordered list of node references, and its geometry exists only after a parser resolves those references and closes the ring. That reconstruction step is where geometry goes wrong. A building traced as a figure-eight, a coastline way whose final node drifted a centimetre off its first, a multipolygon whose inner ring was digitised outside its outer: none of these are visible in the tag dictionary, and all of them pass straight through parsing to detonate later. The failure is rarely loud. An invalid polygon silently returns the wrong answer from a `contains` test, inflates or zeroes an area computation, or makes a PostGIS `ST_Union` abort an hours-long load with `TopologyException: side location conflict`. This guide sits inside the [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) section and treats geometry as a gate: every reconstructed feature is classified as valid, repairable, or quarantine-worthy before it is allowed downstream.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 470" role="img" aria-label="Taxonomy of OSM geometry defects flowing into a detect, then repair-or-quarantine decision. Six defect classes — self-intersection, unclosed ring, spike or duplicate node, degenerate under-four-node polygon, wrong ring winding, and inner ring outside outer — feed a detection stage using Shapely is_valid, explain_validity, and is_simple. Valid geometries pass through. Repairable defects go to buffer zero, make_valid, or ring re-closing and are re-checked. Ambiguous or area-changing repairs are quarantined for human review rather than auto-fixed." style="width:100%;max-width:1080px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>OSM geometry defect taxonomy feeding a detect then repair-or-quarantine flow</title>
  <desc>Six defect classes on the left feed a central detection stage built on Shapely is_valid, explain_validity and is_simple. Valid geometries pass through unchanged; repairable ones route to buffer(0), make_valid or ring re-closing and are re-validated; ambiguous or lossy cases route to a quarantine table for review.</desc>
  <defs>
    <marker id="gvr-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <text x="540" y="24" text-anchor="middle" font-size="15" fill="currentColor" font-weight="700">Classify every reconstructed feature: valid, repairable, or quarantine</text>
  <!-- Defect column -->
  <text x="150" y="52" text-anchor="middle" font-size="11.5" fill="currentColor" font-weight="700" opacity="0.8">DEFECT CLASSES</text>
  <g font-size="11" fill="currentColor">
    <rect x="30" y="62" width="240" height="40" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
    <text x="150" y="80" text-anchor="middle">Self-intersection</text>
    <text x="150" y="95" text-anchor="middle" font-size="9.5" opacity="0.8">bowtie / figure-eight ring</text>
    <rect x="30" y="110" width="240" height="40" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
    <text x="150" y="128" text-anchor="middle">Unclosed ring</text>
    <text x="150" y="143" text-anchor="middle" font-size="9.5" opacity="0.8">first node != last node</text>
    <rect x="30" y="158" width="240" height="40" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
    <text x="150" y="176" text-anchor="middle">Spike / duplicate node</text>
    <text x="150" y="191" text-anchor="middle" font-size="9.5" opacity="0.8">zero-length segment</text>
    <rect x="30" y="206" width="240" height="40" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
    <text x="150" y="224" text-anchor="middle">Degenerate polygon</text>
    <text x="150" y="239" text-anchor="middle" font-size="9.5" opacity="0.8">fewer than 4 nodes</text>
    <rect x="30" y="254" width="240" height="40" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
    <text x="150" y="272" text-anchor="middle">Wrong ring winding</text>
    <text x="150" y="287" text-anchor="middle" font-size="9.5" opacity="0.8">outer CW / inner CCW</text>
    <rect x="30" y="302" width="240" height="40" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
    <text x="150" y="320" text-anchor="middle">Inner outside outer</text>
    <text x="150" y="335" text-anchor="middle" font-size="9.5" opacity="0.8">hole not contained</text>
  </g>
  <!-- Detect stage -->
  <line x1="270" y1="202" x2="356" y2="202" stroke="currentColor" stroke-width="1.5" marker-end="url(#gvr-arr)"/>
  <rect x="360" y="150" width="210" height="104" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="465" y="178" text-anchor="middle" font-size="13.5" fill="currentColor" font-weight="700">Detect</text>
  <text x="465" y="200" text-anchor="middle" font-size="11" fill="currentColor">is_valid</text>
  <text x="465" y="218" text-anchor="middle" font-size="11" fill="currentColor">explain_validity</text>
  <text x="465" y="236" text-anchor="middle" font-size="11" fill="currentColor">is_simple</text>
  <!-- Valid pass-through -->
  <path d="M570,175 H660" fill="none" stroke="var(--osm-ok,#15803d)" stroke-width="1.6" marker-end="url(#gvr-arr)"/>
  <text x="615" y="167" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">valid</text>
  <rect x="662" y="150" width="180" height="50" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.6"/>
  <text x="752" y="172" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="600">Pass downstream</text>
  <text x="752" y="189" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.8">index · load · analyse</text>
  <!-- Repair branch -->
  <path d="M570,229 H660" fill="none" stroke="currentColor" stroke-width="1.6" marker-end="url(#gvr-arr)"/>
  <text x="615" y="221" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">invalid</text>
  <rect x="662" y="212" width="180" height="66" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="752" y="234" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="600">Repair</text>
  <text x="752" y="251" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">buffer(0) · make_valid</text>
  <text x="752" y="266" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">re-close ring · rewind</text>
  <!-- Re-check loop -->
  <path d="M752,278 V310 H465 V256" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="5 3" marker-end="url(#gvr-arr)"/>
  <text x="610" y="326" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">re-validate after repair</text>
  <!-- Quarantine branch -->
  <path d="M752,278 V360 H920" fill="none" stroke="var(--osm-warn,#a16207)" stroke-width="1.6" marker-end="url(#gvr-arr)"/>
  <text x="880" y="352" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">lossy / ambiguous</text>
  <rect x="922" y="338" width="140" height="60" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.6"/>
  <text x="992" y="362" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="600">Quarantine</text>
  <text x="992" y="379" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.8">human review</text>
  <text x="540" y="440" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.9">Auto-repair only what is unambiguous; when a fix changes area or drops a lobe, quarantine instead of guessing.</text>
</svg>

## Prerequisites

This guide assumes you can already turn OSM primitives into candidate geometries and that you have somewhere to send the ones that fail. Three foundations matter. Reconstruction correctness comes first: the ring-assembly and right-hand-rule winding described in [Understanding OSM Multipolygon Relations for GIS](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/) determine whether a relation even has a coherent geometry to validate. Second, you need a spatial index — the containment tests that decide whether an inner ring truly sits inside its outer, or whether two members overlap, run in acceptable time only against the [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) structures rather than an all-pairs scan. Third, geometry validation is a producer of failures, so it needs the quarantine and dead-letter discipline from [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/): a defective polygon must never abort the run, and a silently mangled repair is worse than an honest rejection.

## The Geometry Defects OSM Reconstruction Produces

Six defect classes account for nearly all invalid OSM geometry. They are worth naming precisely, because the correct remediation differs sharply between them and a blanket repair call papers over distinctions that matter.

- **Self-intersections.** A ring whose boundary crosses itself — the classic "bowtie" from a mapper who traced vertices out of order, or a "figure-eight" where a building outline loops back through its own edge. The ring has a well-defined vertex list but no consistent interior, so area and point-in-polygon tests are meaningless.
- **Unclosed rings.** A way tagged as an area (or used as a multipolygon member) whose first and last node references are not identical. Often the last node sits a nanodegree or two off the first — a near-miss from an editor that failed to snap — so the ring looks closed on screen but fails the closure invariant a polygon constructor demands.
- **Spikes and duplicate consecutive nodes.** Two identical consecutive coordinates create a zero-length segment; three collinear nodes with a back-and-forth create a zero-area spike. Neither changes the visible shape much, but both break topology operations and inflate vertex counts.
- **Degenerate polygons.** A linear ring needs at least four coordinates (three distinct corners plus the repeated closing node) to bound any area. A way with fewer collapses to a line or a point and cannot legally become a `Polygon`.
- **Wrong ring winding.** The OGC and GeoJSON conventions expect a specific orientation — exterior rings counter-clockwise, holes clockwise in the right-hand-rule world that GIS engines assume. OSM imposes no winding, so a reconstructed outer ring may arrive clockwise, which some consumers read as a hole.
- **Inner rings outside their outer.** In a multipolygon, an `inner` member must lie within an `outer` member to punch a hole. When role tags are wrong or ring assignment during reconstruction pairs the wrong rings, an "inner" ends up beside or overlapping its outer, producing an invalid polygon-with-hole.

These are structural defects in the reconstructed shape, distinct from attribute problems. Bad tags — a deprecated key, a malformed `maxspeed` — are handled elsewhere; here the concern is purely whether the coordinate sequence describes a lawful geometry under the [OGC Simple Features](https://www.ogc.org/standards/sfa) model.

## Validity Specification: What "Valid" Actually Means

Shapely implements the OGC Simple Features definition of validity, and it pays to know the exact predicate each method answers rather than treating them interchangeably.

| Predicate | Method | What it asserts | Typical OSM failure it catches |
|---|---|---|---|
| Validity | `geom.is_valid` | Rings are closed, simple, and properly nested per OGC SF | Self-intersection, inner outside outer, spike |
| Explanation | `shapely.validation.explain_validity(geom)` | Human-readable reason plus the offending coordinate | Locates the exact self-intersection point |
| Simplicity | `geom.is_simple` | No self-tangency or self-crossing in a `LineString` | A way that crosses itself before closure |
| Emptiness | `geom.is_empty` | Geometry has no coordinates at all | A repair that dissolved the shape entirely |
| Ring closure | `ring.is_ring` | A `LinearRing` is both closed and simple | Unclosed or self-touching candidate ring |

The distinction between `is_valid` and `is_simple` trips people up. `is_simple` applies to curves and asks whether a line self-intersects; `is_valid` applies to areal geometry and additionally enforces ring nesting and orientation-independent interior consistency. A `Polygon` built from a self-crossing shell is invalid; the same coordinates as a `LineString` are merely non-simple. For a polygon the OGC rules are strict: the exterior and every interior ring must be closed `LinearRing`s, rings may touch only at single points (never along a segment), and interior rings must lie inside the exterior and not nest inside one another. Any violation makes `is_valid` return `False`, and `explain_validity` names which rule broke and where.

$$
A_{\text{ring}} = \tfrac{1}{2}\left| \sum_{i=0}^{n-1} \left( x_i\,y_{i+1} - x_{i+1}\,y_i \right) \right|
$$

The signed form of that shoelace sum — dropping the absolute value — also gives winding: a positive signed area means counter-clockwise, negative means clockwise, which is exactly how a re-orientation step decides whether an outer ring needs flipping.

## Step-by-Step: Detect, Classify, Then Decide

The pattern below streams reconstructed geometries, classifies each one, and routes it to pass, repair, or quarantine. It uses Python 3.10+ type hints, Shapely 2.x, and the project logger convention. The key design choice is that classification precedes repair — you decide *what* is wrong before reaching for a fix, so the fix is targeted rather than a hopeful `buffer(0)` on everything.

1. **Fast-path the valid.** Check `is_valid` first; a valid geometry needs no work and most do not.
2. **Explain the invalid.** Call `explain_validity` to get the OGC reason string, and parse the leading token (`Self-intersection`, `Ring Self-intersection`, `Too few points`, `Interior is disconnected`) to classify the defect.
3. **Repair only the unambiguous.** Re-close near-closed rings, drop duplicate consecutive nodes, and run `make_valid` for self-intersections — then re-validate the result.
4. **Guard against lossy repair.** Compare pre- and post-repair area; if a repair drops or merges a lobe beyond a tolerance, or if it changes the geometry *type*, quarantine instead of accepting the silently altered shape.

```python
import logging
from dataclasses import dataclass, field

from shapely import make_valid
from shapely.geometry import Polygon
from shapely.geometry.base import BaseGeometry
from shapely.validation import explain_validity

logger = logging.getLogger("osm.geometry.validate")

AREA_TOLERANCE = 0.02  # 2% relative area change is the auto-repair ceiling


@dataclass
class GeometryReport:
    accepted: list[BaseGeometry] = field(default_factory=list)
    repaired: list[BaseGeometry] = field(default_factory=list)
    quarantined: list[dict] = field(default_factory=list)


def classify_reason(geom: BaseGeometry) -> str:
    """Reduce Shapely's explain_validity string to a defect class token."""
    reason = explain_validity(geom)
    head = reason.split("[", 1)[0].strip().lower()
    if "too few points" in head:
        return "degenerate"
    if "ring self-intersection" in head or "self-intersection" in head:
        return "self_intersection"
    if "interior is disconnected" in head or "holes are nested" in head:
        return "ring_nesting"
    if "nested shells" in head or "self-touching ring" in head:
        return "ring_nesting"
    return "other"


def repair(geom: BaseGeometry) -> BaseGeometry | None:
    """Attempt an unambiguous repair; return None if none is safe."""
    fixed = make_valid(geom)
    if fixed.is_empty:
        return None
    # make_valid can return a collection; keep only the dominant polygon.
    if fixed.geom_type == "GeometryCollection":
        polys = [g for g in fixed.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
        if not polys:
            return None
        fixed = max(polys, key=lambda g: g.area)
    return fixed


def validate_stream(geoms: list[BaseGeometry]) -> GeometryReport:
    report = GeometryReport()
    for i, geom in enumerate(geoms):
        if geom.is_valid and not geom.is_empty:
            report.accepted.append(geom)
            continue

        defect = classify_reason(geom)
        if defect == "degenerate":
            report.quarantined.append({"index": i, "defect": defect, "reason": explain_validity(geom)})
            continue

        fixed = repair(geom)
        if fixed is None or not fixed.is_valid:
            report.quarantined.append({"index": i, "defect": defect, "reason": explain_validity(geom)})
            continue

        # Reject repairs that silently change area or geometry type.
        base_area = geom.area if isinstance(geom, Polygon) else fixed.area
        if base_area > 0 and abs(fixed.area - base_area) / base_area > AREA_TOLERANCE:
            report.quarantined.append({"index": i, "defect": defect, "reason": "area drift on repair"})
            continue

        report.repaired.append(fixed)

    logger.info(
        "geometry validation: %d accepted, %d repaired, %d quarantined",
        len(report.accepted), len(report.repaired), len(report.quarantined),
    )
    return report
```

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Validate and repair reconstructed OSM geometries",
  "description": "Classify each reconstructed OSM geometry as valid, repairable, or quarantine-worthy using Shapely validity predicates, then apply only unambiguous repairs.",
  "step": [
    { "@type": "HowToStep", "name": "Fast-path valid geometries", "text": "Check is_valid first and pass any geometry that is already valid and non-empty straight downstream without modification." },
    { "@type": "HowToStep", "name": "Explain and classify the defect", "text": "Call explain_validity on invalid geometries and reduce the OGC reason string to a defect class such as self_intersection, degenerate, or ring_nesting." },
    { "@type": "HowToStep", "name": "Apply a targeted repair", "text": "Re-close near-closed rings, drop duplicate consecutive nodes, and run make_valid for self-intersections, then re-validate the repaired geometry." },
    { "@type": "HowToStep", "name": "Guard against lossy repair", "text": "Compare pre- and post-repair area and geometry type; quarantine any repair that drops a lobe, changes type, or shifts area beyond tolerance instead of accepting it." },
    { "@type": "HowToStep", "name": "Quarantine the rest", "text": "Route degenerate polygons and any geometry that stays invalid after repair to a quarantine table with the reason string for human review." }
  ]
}
</script>

## Validation & Remediation Matrix

Each row pairs a defect with its root cause in OSM editing, the predicate that surfaces it, and the safe remediation. The rule threading through the table is that repair is warranted only when the mapper's intent is unambiguous; everything else is a review item.

| Error | Root cause | Detection | Remediation |
|---|---|---|---|
| Self-intersecting ring | Vertices traced out of order; figure-eight outline | `is_valid` false; `explain_validity` says `Self-intersection` | `make_valid`; quarantine if it splits into multiple polygons |
| Unclosed ring | Editor failed to snap last node to first | Polygon construction raises, or `is_ring` false | Re-close by appending the first coordinate if the gap is sub-tolerance |
| Near-miss closure | Last node a nanodegree off the first | Distance(first, last) tiny but non-zero | Snap last to first, then rebuild the ring |
| Duplicate consecutive nodes | Double-click or import artefact | Equal adjacent coordinates | Drop the duplicate before constructing the ring |
| Spike | Node backtracks then returns | Zero-area sliver; `is_simple` false on the line | Remove the spike vertex; re-validate |
| Degenerate polygon | Way tagged `area` with <4 nodes | `explain_validity` says `Too few points` | Quarantine — no lawful polygon exists |
| Wrong winding | OSM imposes no orientation | Signed ring area sign is unexpected | Re-orient exterior CCW, interiors CW |
| Inner outside outer | Wrong member role or bad ring pairing | Inner ring not `contains`-ed by outer | Reassign roles by containment; quarantine if ambiguous |

The area-drift guard in the code deserves emphasis: `buffer(0)` and `make_valid` are powerful precisely because they can restructure a geometry, and that same power lets them quietly delete a lobe of a pathological polygon. Comparing area before and after — the discipline detailed for defective records in [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — turns a silent corruption into an explicit quarantine decision.

## Repair Strategies and Their Trade-offs

Three repair tools cover the field, and choosing between them is not arbitrary.

**`buffer(0)`** exploits a side effect of the buffer algorithm: buffering a polygon by zero distance re-runs the overlay engine, which reconstructs a valid geometry from the input's segments. It is fast and available in every Shapely version, and for a simple bowtie it produces the two triangles most people expect. Its weakness is unpredictability on complex rings — it can dissolve slivers, merge touching lobes, or return an empty geometry, and it gives no explanation. Treat it as a heuristic, never as a guarantee.

**`make_valid`** (Shapely 2.x, backed by GEOS `MakeValid`) is the principled successor. It is designed to return a valid geometry that preserves as much of the input as possible, and crucially it is honest about ambiguity: a self-intersecting polygon may come back as a `MultiPolygon` or a `GeometryCollection` mixing polygons and lines. That collection *is* the signal to inspect — it means the original shape had no single unambiguous interpretation. The code above extracts the dominant polygon and quarantines when nothing polygonal survives, rather than pretending the collection is a clean fix.

**Ring re-closing and re-orientation** are surgical, not heuristic. When the only defect is a near-miss closure or a wrong winding, you do not need the overlay engine at all — snap the last coordinate to the first, or reverse the ring, and rebuild. These operations are lossless and reversible, so they are always preferable to a general repair when the defect class permits them. The full ring-assembly and closure workflow for multipolygon members is walked through in [repairing unclosed ways and broken multipolygons](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/repairing-unclosed-ways-and-broken-multipolygons/).

## When to Quarantine Instead of Auto-Repair

Auto-repair is appropriate for defects with a single obvious correct answer: a near-miss closure has one intended ring, a wrong winding has one correct orientation, a duplicate node has one shape without it. Quarantine is the right call whenever the fix requires guessing what the mapper meant. A degenerate polygon has no lawful area to recover. A `make_valid` that returns three disconnected polygons from one "building" means the source geometry was nonsense, and picking the largest lobe discards real information. An inner ring that overlaps rather than nests inside its outer could be a mis-tagged role or a genuinely broken relation, and only a human — or a downstream rule that consults the tags — can tell which. The governing principle is that a rejected feature is recoverable (someone can fix the source in OSM), whereas a silently mangled feature poisons every downstream computation invisibly. Route quarantined geometries to a dead-letter table keyed on `(type, id)` with the `explain_validity` reason attached, and surface them in the review queue rather than dropping them.

## Performance & Scale Considerations

Validity checking is cheap per feature but runs across every reconstructed geometry in a continental extract, so constant factors matter. `is_valid` is O(n log n) in the vertex count for the sweep-line intersection test, which dominates on dense coastline and boundary polygons with tens of thousands of vertices. Two levers help. First, **short-circuit**: call `is_valid` before `explain_validity`, because the explanation is markedly more expensive and most geometries are valid. Second, **prepare geometries you test repeatedly**: when validation involves containment checks — inner-in-outer, member-in-relation — use Shapely's prepared geometries or the spatial index from [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) so you filter candidate pairs by bounding box before running the exact predicate. Validating an unindexed all-pairs containment across a country's buildings is the classic accidental quadratic that turns a ten-minute job into an overnight one.

## Failure Modes & Gotchas

- **`buffer(0)` can return empty.** On a fully degenerate input the zero-buffer collapses to an empty polygon. Always test `is_empty` after repair and treat empty as a quarantine, not a success.
- **`make_valid` changes type.** A valid repair of a self-touching polygon is often a `MultiPolygon`; downstream code expecting a single `Polygon` will break. Normalise the type explicitly and decide whether a multi-part result is acceptable.
- **Winding is not validity.** A clockwise exterior ring is still *valid* under OGC SF — orientation does not affect `is_valid`. If a downstream consumer (GeoJSON, some tile pipelines) requires right-hand-rule winding, you must re-orient explicitly; validation alone will not flag it.
- **Coordinate precision creates phantom self-intersections.** Two segments that "should" meet at a vertex can cross by a floating-point epsilon after reprojection. Snap-round coordinates to a consistent grid before validating so precision noise does not masquerade as a real defect.
- **Relations are not free geometry.** A multipolygon is only a geometry after its member ways are assembled into rings; validate the assembled polygon, not the individual member ways, or you will flag correctly-open rings as broken.
- **Empty geometries are silently valid.** An empty `Polygon` returns `True` from `is_valid`. Guard `is_empty` separately, because an empty geometry is almost never what you want downstream.

## Integration Points: Feeding the Next Stage

Validated geometry is the contract every later stage depends on. The accepted and repaired outputs flow into the spatial index — an R-tree insert assumes `geometry.bounds` is meaningful, which it is not for an invalid ring — and from there into topology and attribute checks. The wiring below routes a validation report into an index build and a quarantine sink, keeping the two streams cleanly separated:

```python
def route_report(report: GeometryReport, index, quarantine_sink) -> None:
    """Feed valid + repaired geometries to the index; defective ones to quarantine."""
    fid = 0
    for geom in (*report.accepted, *report.repaired):
        index.insert(fid, geom.bounds, obj=geom)
        fid += 1
    for item in report.quarantined:
        quarantine_sink.write(item)  # dead-letter table keyed on (type, id)
    logger.info("indexed %d geometries; quarantined %d", fid, len(report.quarantined))
```

Downstream of a clean geometry set, routing-graph topology and tag-consistency checks can assume every feature is a lawful shape, which is why geometry validation runs first in the quality gate. For the specific mechanisms, the two references below drill into detection and repair respectively.

## Geometry Validation & Repair in Depth

- [Detecting Self-Intersecting OSM Polygons with Shapely](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/detecting-self-intersecting-osm-polygons-with-shapely/) — batch-flag bowtie and figure-eight polygons across reconstructed areas, classify each with `explain_validity`, and emit a report before any repair.
- [Repairing Unclosed Ways and Broken Multipolygons](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/repairing-unclosed-ways-and-broken-multipolygons/) — assemble relation members into closed rings, close near-miss ways, and fix outer/inner assignment and winding.

## Frequently Asked Questions

<details>
<summary>Should I always repair invalid OSM geometry, or reject it?</summary>

Repair only defects with a single unambiguous correct answer: near-miss ring closure, wrong winding, or a duplicate consecutive node. Quarantine anything where the fix requires guessing the mapper's intent — degenerate polygons, geometries that make_valid splits into disconnected parts, and inner rings that overlap rather than nest. A rejected feature can be fixed at the source, while a silently mangled one corrupts every downstream computation invisibly.
</details>

<details>
<summary>What is the difference between is_valid and is_simple in Shapely?</summary>

is_simple applies to curves like LineString and asks whether the line crosses or touches itself. is_valid applies to areal geometry and additionally enforces OGC ring rules: rings must be closed, may touch only at single points, and interior rings must lie inside the exterior. A self-crossing shape is a valid LineString but an invalid Polygon, so the predicate you choose depends on whether you are checking a line or an area.
</details>

<details>
<summary>Is buffer(0) or make_valid the better repair?</summary>

Prefer make_valid on Shapely 2.x. It is designed to preserve as much of the input as possible and it is honest about ambiguity, returning a MultiPolygon or GeometryCollection when the input has no single valid interpretation — which is itself a signal to inspect. buffer(0) is a fast heuristic that works for simple bowties but can silently dissolve slivers, merge lobes, or return empty with no explanation.
</details>

<details>
<summary>Why does my repaired polygon have a different area than the original?</summary>

buffer(0) and make_valid reconstruct geometry from its segments and can drop a self-overlapping lobe or merge touching parts, which changes area. Always compare pre- and post-repair area and quarantine repairs that shift it beyond a tolerance. An area change is the clearest signal that the repair guessed at an ambiguous shape rather than losslessly fixing a mechanical defect.
</details>

<details>
<summary>Does fixing ring winding make an invalid polygon valid?</summary>

No. Ring orientation does not affect OGC validity, so is_valid returns the same result whether an exterior ring is clockwise or counter-clockwise. Winding matters only for consumers like GeoJSON that mandate right-hand-rule orientation. Re-orient rings explicitly for those consumers, but do not expect re-winding to repair a self-intersection or a nesting error.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Should I always repair invalid OSM geometry, or reject it?",
      "acceptedAnswer": { "@type": "Answer", "text": "Repair only defects with a single unambiguous correct answer: near-miss ring closure, wrong winding, or a duplicate consecutive node. Quarantine anything where the fix requires guessing the mapper's intent, such as degenerate polygons, geometries that make_valid splits into disconnected parts, and inner rings that overlap rather than nest. A rejected feature can be fixed at the source, while a silently mangled one corrupts every downstream computation invisibly." }
    },
    {
      "@type": "Question",
      "name": "What is the difference between is_valid and is_simple in Shapely?",
      "acceptedAnswer": { "@type": "Answer", "text": "is_simple applies to curves like LineString and asks whether the line crosses or touches itself. is_valid applies to areal geometry and additionally enforces OGC ring rules: rings must be closed, may touch only at single points, and interior rings must lie inside the exterior. A self-crossing shape is a valid LineString but an invalid Polygon, so the predicate you choose depends on whether you are checking a line or an area." }
    },
    {
      "@type": "Question",
      "name": "Is buffer(0) or make_valid the better repair?",
      "acceptedAnswer": { "@type": "Answer", "text": "Prefer make_valid on Shapely 2.x. It is designed to preserve as much of the input as possible and it is honest about ambiguity, returning a MultiPolygon or GeometryCollection when the input has no single valid interpretation, which is itself a signal to inspect. buffer(0) is a fast heuristic that works for simple bowties but can silently dissolve slivers, merge lobes, or return empty with no explanation." }
    },
    {
      "@type": "Question",
      "name": "Why does my repaired polygon have a different area than the original?",
      "acceptedAnswer": { "@type": "Answer", "text": "buffer(0) and make_valid reconstruct geometry from its segments and can drop a self-overlapping lobe or merge touching parts, which changes area. Always compare pre- and post-repair area and quarantine repairs that shift it beyond a tolerance. An area change is the clearest signal that the repair guessed at an ambiguous shape rather than losslessly fixing a mechanical defect." }
    },
    {
      "@type": "Question",
      "name": "Does fixing ring winding make an invalid polygon valid?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. Ring orientation does not affect OGC validity, so is_valid returns the same result whether an exterior ring is clockwise or counter-clockwise. Winding matters only for consumers like GeoJSON that mandate right-hand-rule orientation. Re-orient rings explicitly for those consumers, but do not expect re-winding to repair a self-intersection or a nesting error." }
    }
  ]
}
</script>

## Related

- [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) — the section this geometry gate belongs to, alongside topology and tag-consistency checks.
- [Understanding OSM Multipolygon Relations for GIS](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/) — ring assembly and winding that produce the geometries validated here.
- [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) — the index that keeps containment checks out of accidental-quadratic territory.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — the quarantine and dead-letter discipline for geometries this stage rejects.
- [Detecting Self-Intersecting OSM Polygons with Shapely](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/detecting-self-intersecting-osm-polygons-with-shapely/) — the focused detection walkthrough for bowtie polygons.
- [Repairing Unclosed Ways and Broken Multipolygons](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/repairing-unclosed-ways-and-broken-multipolygons/) — the focused repair walkthrough for rings and relations.

Up one level: [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Geometry Validation & Repair",
  "description": "Detect and repair the geometry defects OSM reconstruction produces — self-intersections, unclosed rings, spikes, degenerate polygons, and bad winding — with Shapely validity checks, buffer(0), make_valid, and a quarantine discipline.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Data Quality & Validation",
  "about": ["OSM geometry validation", "Shapely make_valid repair", "OGC Simple Features validity"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Quality & Validation", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/" },
    { "@type": "ListItem", "position": 3, "name": "Geometry Validation & Repair", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/" }
  ]
}
</script>
