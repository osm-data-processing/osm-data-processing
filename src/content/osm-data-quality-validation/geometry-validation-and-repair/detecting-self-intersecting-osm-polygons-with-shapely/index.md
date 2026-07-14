---
title: "Detecting Self-Intersecting OSM Polygons with Shapely"
description: "Batch-flag bowtie and figure-eight polygons across reconstructed OSM areas with Shapely is_valid and explain_validity, classify each defect, and emit a report before any repair touches the data."
pageTitle: "Detect Self-Intersecting OSM Polygons in Shapely"
pageDescription: "Find self-intersecting OSM polygons at batch scale using Shapely is_valid and explain_validity, extract the crossing coordinate, and write a triage report without mutating the source geometry."
slug: detecting-self-intersecting-osm-polygons-with-shapely
type: article
breadcrumb: "Detecting Self-Intersections"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Detecting Self-Intersecting OSM Polygons with Shapely

Scan a batch of reconstructed OSM area geometries and flag every self-intersecting one — the bowtie building, the figure-eight lake — recording *where* each ring crosses itself, without altering a single coordinate.

## Prerequisites

- [ ] `shapely` ≥ 2.0 installed (`pip install "shapely>=2.0"`) — `explain_validity` and the 2.x geometry API are assumed throughout.
- [ ] Python 3.10+ for the union type hints and `match` used below.
- [ ] A batch of candidate `Polygon` / `MultiPolygon` objects already reconstructed from ways and relations — the assembly step covered in [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/).
- [ ] A writable path for the CSV report, and a `logging` config so warnings surface.
- [ ] Optional: `geopandas` ≥ 0.14 if your batch arrives as a `GeoDataFrame` rather than a plain list.

## Conceptual minimum

A self-intersection is a polygon whose boundary crosses itself, so the ring no longer separates a coherent inside from an outside. Two shapes dominate in OSM. The **bowtie** is a four-node quad whose two diagonal node pairs were traced in the wrong order, pinching the ring at a central crossing into two opposed triangles. The **figure-eight** is a longer outline that loops back through one of its own earlier edges. Both arise from ordinary mapping mistakes — a vertex dragged past its neighbour, an import that concatenated two rings — and both are invisible in the tags, so they surface only when a geometry engine tries to compute area, run a `contains` test, or union the feature into a coverage.

Shapely, following the [OGC Simple Features](https://www.ogc.org/standards/sfa) model, exposes this through `is_valid`: a self-intersecting polygon returns `False`. The companion function `shapely.validation.explain_validity` returns a human-readable string naming the defect and, for a self-intersection, the coordinate where the boundary crosses — for example `Self-intersection[13.402 52.518]`. That coordinate is the payload worth capturing, because it points a reviewer straight at the offending vertex in an editor. This page is deliberately a *detection* step: it classifies and reports but never mutates, because deciding how to repair a bowtie — covered in the parent [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/) guide — is a separate decision that should follow, not accompany, discovery.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 340" role="img" aria-label="How a self-intersection is detected. On the left, a bowtie polygon whose two diagonal edges cross at a central point marked as the self-intersection coordinate. In the middle, Shapely is_valid returns false and explain_validity returns the reason string with that crossing coordinate. On the right, the geometry is appended to a report as flagged, with its index, the defect class, and the coordinate, while the source geometry is left unchanged." style="width:100%;max-width:900px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Detecting a self-intersecting OSM polygon and reporting the crossing coordinate</title>
  <desc>A bowtie polygon crosses itself at a central point; Shapely is_valid returns false and explain_validity yields the reason plus that coordinate; the feature is written to a report unchanged.</desc>
  <defs>
    <marker id="ssi-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <text x="450" y="26" text-anchor="middle" font-size="14" fill="currentColor" font-weight="700">Detect, locate the crossing, report — do not mutate</text>
  <!-- Bowtie glyph -->
  <rect x="30" y="56" width="230" height="240" rx="8" fill="none" stroke="currentColor" stroke-width="1.3" opacity="0.5"/>
  <text x="145" y="80" text-anchor="middle" font-size="12" fill="currentColor" font-weight="600">Bowtie polygon</text>
  <!-- two triangles crossing -->
  <line x1="70" y1="110" x2="220" y2="250" stroke="var(--osm-warn,#a16207)" stroke-width="2"/>
  <line x1="220" y1="110" x2="70" y2="250" stroke="var(--osm-warn,#a16207)" stroke-width="2"/>
  <line x1="70" y1="110" x2="220" y2="110" stroke="var(--osm-warn,#a16207)" stroke-width="2"/>
  <line x1="70" y1="250" x2="220" y2="250" stroke="var(--osm-warn,#a16207)" stroke-width="2"/>
  <circle cx="145" cy="180" r="6" fill="var(--osm-warn,#a16207)"/>
  <text x="145" y="204" text-anchor="middle" font-size="10.5" fill="currentColor">self-intersection</text>
  <text x="145" y="284" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.8">edges cross at centre</text>
  <!-- arrow to detect -->
  <line x1="262" y1="176" x2="322" y2="176" stroke="currentColor" stroke-width="1.5" marker-end="url(#ssi-arr)"/>
  <!-- detect box -->
  <rect x="326" y="120" width="230" height="112" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="441" y="146" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="700">Shapely check</text>
  <text x="441" y="170" text-anchor="middle" font-size="11" fill="currentColor">is_valid -&gt; False</text>
  <text x="441" y="190" text-anchor="middle" font-size="10.5" fill="currentColor">explain_validity</text>
  <text x="441" y="212" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">"Self-intersection[x y]"</text>
  <!-- arrow to report -->
  <line x1="558" y1="176" x2="618" y2="176" stroke="currentColor" stroke-width="1.5" marker-end="url(#ssi-arr)"/>
  <!-- report box -->
  <rect x="622" y="120" width="248" height="112" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.6"/>
  <text x="746" y="146" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="700">Flag row</text>
  <text x="746" y="168" text-anchor="middle" font-size="10.5" fill="currentColor">index · defect class</text>
  <text x="746" y="186" text-anchor="middle" font-size="10.5" fill="currentColor">crossing coordinate</text>
  <text x="746" y="212" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.8">source geometry untouched</text>
</svg>

## Runnable solution

The module below iterates a batch, tests validity, classifies invalid geometries, extracts the crossing coordinate from the `explain_validity` string, and writes a CSV triage report. It is read-only by design — nothing here calls `buffer(0)` or `make_valid`; the closest it comes to repair is a commented note on the side effects of doing so.

```python
from __future__ import annotations

import csv
import logging
import re
from dataclasses import dataclass
from pathlib import Path

from shapely.geometry.base import BaseGeometry
from shapely.validation import explain_validity

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.geometry.detect_self_intersection")

# explain_validity returns e.g. "Self-intersection[13.402 52.518]".
_REASON_RE = re.compile(r"^([A-Za-z ]+?)\s*(?:\[([-\d.]+)\s+([-\d.]+)\])?$")


@dataclass(frozen=True)
class Flag:
    index: int
    feature_id: object
    defect: str
    at_x: float | None
    at_y: float | None
    reason: str


def classify(geom: BaseGeometry) -> tuple[str, float | None, float | None, str]:
    """Return (defect_class, x, y, raw_reason) for an invalid geometry."""
    reason = explain_validity(geom)
    match = _REASON_RE.match(reason.strip())
    label = match.group(1).strip().lower() if match else reason.lower()
    x = float(match.group(2)) if match and match.group(2) else None
    y = float(match.group(3)) if match and match.group(3) else None

    if "ring self-intersection" in label:
        defect = "ring_self_intersection"
    elif "self-intersection" in label:
        defect = "self_intersection"
    elif "too few points" in label:
        defect = "degenerate"
    else:
        defect = "other"
    return defect, x, y, reason


def scan_batch(
    geoms: list[BaseGeometry],
    feature_ids: list[object] | None = None,
) -> list[Flag]:
    """Flag every self-intersecting (or otherwise invalid) geometry in a batch.

    The source geometries are never modified. A self-intersection surfaces as
    ``is_valid`` being False with an ``explain_validity`` reason beginning
    "Self-intersection" or "Ring Self-intersection".
    """
    ids = feature_ids if feature_ids is not None else list(range(len(geoms)))
    flags: list[Flag] = []
    for i, (geom, fid) in enumerate(zip(geoms, ids)):
        if geom is None or geom.is_empty:
            flags.append(Flag(i, fid, "empty", None, None, "empty or null geometry"))
            continue
        if geom.is_valid:
            continue  # valid geometries need no report row
        defect, x, y, reason = classify(geom)
        flags.append(Flag(i, fid, defect, x, y, reason))
        logger.warning("feature %s invalid: %s", fid, reason)
    return flags


def write_report(flags: list[Flag], dst: Path) -> None:
    """Write the flagged geometries to a CSV triage report."""
    with dst.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["index", "feature_id", "defect", "at_x", "at_y", "reason"])
        for f in flags:
            writer.writerow([f.index, f.feature_id, f.defect, f.at_x, f.at_y, f.reason])
    logger.info("wrote %d flagged features to %s", len(flags), dst)


# Note on repair side effects (intentionally NOT applied here):
#   geom.buffer(0) will "fix" a bowtie by splitting it into two triangles, but
#   it also silently changes area and can drop a lobe on complex rings. Detect
#   first, review the report, then repair deliberately in a separate pass.


if __name__ == "__main__":
    from shapely.geometry import Polygon

    batch = [
        Polygon([(0, 0), (2, 2), (2, 0), (0, 2), (0, 0)]),  # bowtie
        Polygon([(0, 0), (0, 1), (1, 1), (1, 0), (0, 0)]),  # valid unit square
    ]
    result = scan_batch(batch, feature_ids=["way/101", "way/102"])
    write_report(result, Path("self_intersection_report.csv"))
```

## Step-by-step walkthrough

1. **Read-only contract** — `scan_batch` takes geometries and returns `Flag` records; it never assigns back to the input list. Detection and repair are separated so a review can happen between them, which is the whole point of a triage pass.
2. **Skip the valid fast** — `geom.is_valid` short-circuits before the more expensive `explain_validity` call, so a batch that is mostly clean spends almost no time in the classifier.
3. **Guard empties** — a `None` or empty geometry is flagged as `empty` rather than crashing `explain_validity`; an empty polygon is technically valid but is almost never intended.
4. **Parse the reason string** — `_REASON_RE` splits `explain_validity` output into a label and an optional `[x y]` coordinate. The regex tolerates reasons with no coordinate (like `Too few points`) by making the bracket group optional.
5. **Distinguish ring from shell self-intersection** — GEOS reports `Ring Self-intersection` when a single ring crosses itself and `Self-intersection` when two rings of a polygon cross; the classifier keeps them separate because they hint at different mapping errors.
6. **Capture the crossing coordinate** — the `[x y]` pair is the reviewer's shortcut to the offending vertex; storing it in the report turns "this polygon is broken" into "this polygon is broken *here*".
7. **Emit a stable CSV** — the report is deterministic and keyed on the feature id, so two runs over the same batch produce byte-identical output and the file diffs cleanly in review.
8. **Leave repair to a later pass** — the trailing comment documents exactly why `buffer(0)` is not called here: it mutates area and can drop geometry, so it belongs in a deliberate repair step, not a scan.

## Verification

Confirm the detector behaves before trusting its report:

- **Known bowtie flags.** The example `Polygon([(0,0),(2,2),(2,0),(0,2),(0,0)])` must appear in the report with defect `self_intersection` or `ring_self_intersection` and a crossing coordinate near `(1, 1)`.
- **Valid square is silent.** The unit square must produce no report row; if it does, `is_valid` is being bypassed.
- **Row count matches log lines.** The number of `feature ... invalid` warnings must equal the report row count minus any `empty` rows.
- **Coordinate parses.** For any self-intersection row, `at_x` and `at_y` must be non-null floats; a null there means the `explain_validity` format changed and `_REASON_RE` needs updating.
- **Source is unchanged.** Re-run `scan_batch` on the same list twice — identical output proves nothing was mutated between passes.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| `AttributeError: 'NoneType' object has no attribute 'is_valid'` | A `None` slipped into the batch | The `geom is None` guard handles it; ensure reconstruction yields `None`, not a bare exception |
| Every row has null `at_x` | GEOS version formats the reason without coordinates | Update `_REASON_RE`, or fall back to `shapely.validation.make_valid` diffing to locate the crossing |
| Valid polygons appear in the report | `is_valid` check removed or inverted | Restore the `if geom.is_valid: continue` fast path |
| `TopologyException` during scan | Calling a predicate like `area` on the invalid geom | Only call `is_valid` and `explain_validity` on unvalidated input; both are safe on invalid geometry |
| Bowtie not flagged | Constructed as a `LineString`, not a `Polygon` | Self-crossing is valid for lines; build a `Polygon` (or check `is_simple` for lines) |
| Report differs between runs | Iterating an unordered set of geometries | Feed an ordered list and pass explicit `feature_ids` |

## Specification reference

> Shapely's `object.is_valid` returns `True` if a geometry is valid in the OGC Simple Features sense, and `shapely.validation.explain_validity(geometry)` returns a string explaining the validity or invalidity, including the location of the problem for a self-intersection. See the Shapely documentation on [predicates and validation](https://shapely.readthedocs.io/) for the exact semantics of `is_valid`, `is_simple`, and `explain_validity`, and the [OGC Simple Features](https://www.ogc.org/standards/sfa) specification for the underlying ring-validity rules a self-intersection breaks.

## Frequently Asked Questions

<details>
<summary>Why not just call buffer(0) and skip detection?</summary>

Because buffer(0) mutates silently. On a simple bowtie it produces the two triangles you expect, but on a complex ring it can drop a lobe, merge touching parts, or return an empty geometry, all without telling you. Detecting first gives you a report to review, so the later repair is a deliberate decision per feature rather than a blanket transform that may quietly corrupt data.
</details>

<details>
<summary>What is the difference between "Self-intersection" and "Ring Self-intersection"?</summary>

GEOS reports "Ring Self-intersection" when a single ring crosses itself, such as a figure-eight outline, and "Self-intersection" when two separate rings of a polygon cross, such as an inner ring poking through its outer. Both make the polygon invalid, but they hint at different mapping errors, so the classifier keeps them as distinct defect classes in the report.
</details>

<details>
<summary>Can a self-intersecting shape ever be valid?</summary>

As a Polygon, no — self-intersection violates the OGC ring rules and is_valid returns False. As a LineString the same coordinates are simply non-simple, and is_simple returns False while the geometry is still a legal line. So whether self-crossing is an error depends entirely on whether the feature is meant to bound an area or trace a path.
</details>

<details>
<summary>How do I find which vertex causes the crossing?</summary>

The explain_validity string embeds the coordinate of the self-intersection in brackets, for example Self-intersection[13.402 52.518]. Parse that pair out and store it in the report; it points a reviewer straight at the location in a JOSM or iD editor. If your GEOS build omits the coordinate, upgrade Shapely or locate the crossing by testing consecutive edge pairs for intersection.
</details>

## Related

- [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/) — the parent guide covering the full defect taxonomy and the repair decisions that follow detection.
- [Repairing Unclosed Ways and Broken Multipolygons](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/repairing-unclosed-ways-and-broken-multipolygons/) — the sibling walkthrough for closing rings and fixing relation assembly.
- [Understanding OSM Multipolygon Relations for GIS](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/) — how the polygons you are scanning were assembled from members.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — where flagged features go when detection routes them to quarantine.
- [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) — the broader quality section this detection step belongs to.

Up one level: [Geometry Validation & Repair](https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Detecting Self-Intersecting OSM Polygons with Shapely",
  "description": "Batch-flag bowtie and figure-eight polygons across reconstructed OSM areas with Shapely is_valid and explain_validity, classify each defect, and emit a report before any repair touches the data.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Data Quality & Validation",
  "about": ["self-intersecting polygons", "Shapely explain_validity", "OSM geometry detection"]
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
    { "@type": "ListItem", "position": 4, "name": "Detecting Self-Intersecting OSM Polygons with Shapely", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/geometry-validation-and-repair/detecting-self-intersecting-osm-polygons-with-shapely/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Detect self-intersecting OSM polygons with Shapely",
  "description": "Scan a batch of reconstructed OSM polygons, flag self-intersections with Shapely validity predicates, extract the crossing coordinate, and write a triage report without mutating the source.",
  "step": [
    { "@type": "HowToStep", "name": "Test validity fast", "text": "Call is_valid on each geometry and skip the valid ones before running the more expensive explain_validity classifier." },
    { "@type": "HowToStep", "name": "Explain the invalid", "text": "Call explain_validity on invalid geometries to get the OGC reason string and the bracketed coordinate of the self-intersection." },
    { "@type": "HowToStep", "name": "Classify the defect", "text": "Parse the reason into a defect class, distinguishing ring self-intersection from shell self-intersection and degenerate rings." },
    { "@type": "HowToStep", "name": "Capture the crossing location", "text": "Extract the [x y] coordinate from the reason string so a reviewer can jump straight to the offending vertex in an editor." },
    { "@type": "HowToStep", "name": "Write a stable report", "text": "Emit a deterministic CSV keyed on feature id, leaving all source geometries unmodified for a later deliberate repair pass." }
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
      "name": "Why not just call buffer(0) and skip detection?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because buffer(0) mutates silently. On a simple bowtie it produces the two triangles you expect, but on a complex ring it can drop a lobe, merge touching parts, or return an empty geometry, all without telling you. Detecting first gives you a report to review, so the later repair is a deliberate decision per feature rather than a blanket transform that may quietly corrupt data." }
    },
    {
      "@type": "Question",
      "name": "What is the difference between Self-intersection and Ring Self-intersection?",
      "acceptedAnswer": { "@type": "Answer", "text": "GEOS reports Ring Self-intersection when a single ring crosses itself, such as a figure-eight outline, and Self-intersection when two separate rings of a polygon cross, such as an inner ring poking through its outer. Both make the polygon invalid, but they hint at different mapping errors, so the classifier keeps them as distinct defect classes in the report." }
    },
    {
      "@type": "Question",
      "name": "Can a self-intersecting shape ever be valid?",
      "acceptedAnswer": { "@type": "Answer", "text": "As a Polygon, no, because self-intersection violates the OGC ring rules and is_valid returns False. As a LineString the same coordinates are simply non-simple, and is_simple returns False while the geometry is still a legal line. So whether self-crossing is an error depends entirely on whether the feature is meant to bound an area or trace a path." }
    },
    {
      "@type": "Question",
      "name": "How do I find which vertex causes the crossing?",
      "acceptedAnswer": { "@type": "Answer", "text": "The explain_validity string embeds the coordinate of the self-intersection in brackets, for example Self-intersection at 13.402 52.518. Parse that pair out and store it in the report; it points a reviewer straight at the location in a JOSM or iD editor. If your GEOS build omits the coordinate, upgrade Shapely or locate the crossing by testing consecutive edge pairs for intersection." }
    }
  ]
}
</script>
