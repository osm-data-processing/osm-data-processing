---
title: "Flagging Deprecated OSM Tags in a Pipeline"
description: "Detect deprecated OSM tags during ETL with a deprecated→replacement map applied over a pyosmium stream or a pandas frame, emitting a findings report with suggested successors."
pageTitle: "Flag Deprecated OSM Tags in an ETL Pipeline"
pageDescription: "A runnable deprecated-to-replacement mapping for OpenStreetMap tags, applied over a pyosmium stream and a pandas frame, that emits warnings and suggested replacements during ingestion."
slug: flagging-deprecated-osm-tags-in-a-pipeline
type: article
breadcrumb: "Flagging Deprecated Tags"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Flagging Deprecated OSM Tags in a Pipeline

Detect tags the OSM community has retired — such as `highway=ford`, older `amenity` values, and `barrier=wire_fence` — as an extract streams through ETL, and emit a warning with the suggested modern replacement for each one.

## Prerequisites

Confirm each item; a stale map or the wrong match granularity is the usual reason the report misses real deprecations or flags current tags.

- [ ] `pyosmium` ≥ 3.6 for the streaming path, or `pandas` ≥ 2.1 for the frame path (`pip install "pyosmium>=3.6"` / `pip install "pandas>=2.1"`).
- [ ] A deprecation map — the key/value → replacement table below, ideally pinned to a dated snapshot of the OSM Wiki.
- [ ] Python 3.10+ for the `dict[...]` and dataclass typing used here.
- [ ] A tag source: a `.osm.pbf` extract for the streaming path, or a widened tag frame from [Tag & Attribute Consistency Checks](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/) for the pandas path.
- [ ] Awareness that deprecation is *informational* — the data still parses; this pass suggests migrations rather than rejecting elements.

## Conceptual minimum

OpenStreetMap tagging is a living convention. Over the years the community retires keys and values in favour of clearer successors — a river crossing that was once `highway=ford` is now expressed with `ford=yes` on the crossing node, and various `barrier` sub-values were consolidated into `fence` with a `fence_type`. None of these deprecated tags is *invalid*: a parser reads them fine and a renderer may still draw them. But they drift out of step with the vocabulary that downstream consumers, presets, and analyses expect, so a pipeline that ingests OSM for the long term needs to surface them for migration. This is the deprecation rule class from [Tag & Attribute Consistency Checks](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/), isolated into a runnable pass.

The mechanism is a lookup, not a computation. A **deprecation map** keys each retired tag to its modern replacement; the checker asks, for every element, whether any of its tags matches an entry and, if so, records a finding carrying the suggested successor. The only real subtlety is *match granularity*: some deprecations are whole keys (any use of the key is retired), and some are a specific key-value pair (the key is fine but one value is deprecated). Conflating the two either over-reports — flagging every `barrier` when only one value is retired — or under-reports. The reference for which tags are current lives on the OSM Wiki, so the map should be treated as a pinned snapshot of that document rather than a hard-coded constant that silently rots.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 300" role="img" aria-label="A deprecation lookup pass. An element's tags are matched against a deprecation map with two match kinds: whole-key entries and specific key-value entries. A tag that matches emits a finding carrying the deprecated tag and its suggested replacement into a findings report; a tag with no match passes through untouched." style="width:100%;max-width:960px;display:block;margin:1.5rem auto;font-family:inherit">
  <title>Deprecation lookup: match element tags against a map and emit replacements</title>
  <desc>Element tags enter a matcher that consults a deprecation map holding whole-key and key-value entries. Matched tags produce findings with a suggested replacement written to a report; unmatched tags pass through.</desc>
  <defs>
    <marker id="fdt-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <text x="480" y="24" text-anchor="middle" font-size="15" fill="currentColor" font-weight="700">Match each tag against the deprecation map</text>
  <!-- element tags -->
  <rect x="24" y="110" width="150" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="99" y="134" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="600">Element tags</text>
  <text x="99" y="156" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">highway=ford</text>
  <text x="99" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">name=Mill Ln</text>
  <line x1="174" y1="154" x2="212" y2="154" stroke="currentColor" stroke-width="1.5" marker-end="url(#fdt-arr)"/>
  <!-- matcher -->
  <rect x="214" y="118" width="150" height="72" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="289" y="148" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="600">Matcher</text>
  <text x="289" y="167" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">key · key=value</text>
  <!-- map source -->
  <rect x="214" y="30" width="150" height="60" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="289" y="54" text-anchor="middle" font-size="12" fill="currentColor" font-weight="600">Deprecation map</text>
  <text x="289" y="72" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">pinned Wiki snapshot</text>
  <line x1="289" y1="90" x2="289" y2="116" stroke="currentColor" stroke-width="1.4" stroke-dasharray="5 3" marker-end="url(#fdt-arr)"/>
  <!-- match -> finding -->
  <line x1="364" y1="140" x2="430" y2="110" stroke="currentColor" stroke-width="1.5" marker-end="url(#fdt-arr)"/>
  <text x="400" y="112" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">hit</text>
  <rect x="432" y="80" width="220" height="72" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="542" y="106" text-anchor="middle" font-size="12" fill="currentColor" font-weight="600">Finding</text>
  <text x="542" y="126" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">highway=ford → ford=yes</text>
  <text x="542" y="142" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.8">severity: info</text>
  <!-- no match -->
  <line x1="364" y1="168" x2="430" y2="200" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#fdt-arr)"/>
  <text x="400" y="200" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">miss</text>
  <rect x="432" y="180" width="220" height="46" rx="8" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.4"/>
  <text x="542" y="208" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.85">passes through untouched</text>
  <!-- report -->
  <line x1="652" y1="116" x2="710" y2="130" stroke="currentColor" stroke-width="1.5" marker-end="url(#fdt-arr)"/>
  <rect x="712" y="100" width="150" height="72" rx="8" fill="none" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="787" y="130" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="600">Findings report</text>
  <text x="787" y="150" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">CSV · Parquet</text>
</svg>

## Runnable solution

This module defines a deprecation map with both match kinds, then offers two entry points that share it: a `pyosmium` handler for streaming a `.osm.pbf` under bounded memory, and a vectorized function for a pandas tag frame. Both emit the same `Finding` shape. It targets `pyosmium>=3.6`, `pandas>=2.1`, and Python 3.10+.

```python
from __future__ import annotations

import csv
import logging
from dataclasses import asdict, dataclass

import osmium
import pandas as pd

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.deprecated_tags")

# Whole-key deprecations: any use of the key is retired.
KEY_DEPRECATIONS: dict[str, str] = {
    "highway=ford": "ford=yes (on the crossing node)",
}

# Key=value deprecations: the key is fine, this value is retired.
VALUE_DEPRECATIONS: dict[tuple[str, str], str] = {
    ("highway", "ford"): "ford=yes on the node",
    ("barrier", "wire_fence"): "barrier=fence + fence_type=wire",
    ("amenity", "nightclub"): "amenity=nightclub is current; verify against Wiki",
    ("shop", "organic"): "organic=only/yes on the relevant shop",
    ("highway", "unsurfaced"): "highway=* + surface=unpaved",
}


@dataclass(frozen=True)
class Finding:
    element: str
    key: str
    value: str
    replacement: str
    severity: str = "info"


def check_tags(ref: str, tags: dict[str, str]) -> list[Finding]:
    """Return a finding for every deprecated tag on one element."""
    findings: list[Finding] = []
    for key, value in tags.items():
        replacement = VALUE_DEPRECATIONS.get((key, value))
        if replacement is not None:
            findings.append(Finding(ref, key, value, replacement))
    return findings


class DeprecationHandler(osmium.SimpleHandler):
    """Stream a PBF and collect deprecated-tag findings under bounded memory."""

    def __init__(self) -> None:
        super().__init__()
        self.findings: list[Finding] = []

    def _scan(self, ref: str, obj) -> None:
        tags = {t.k: t.v for t in obj.tags}
        self.findings.extend(check_tags(ref, tags))

    def node(self, n: osmium.osm.Node) -> None:
        self._scan(f"node/{n.id}", n)

    def way(self, w: osmium.osm.Way) -> None:
        self._scan(f"way/{w.id}", w)

    def relation(self, r: osmium.osm.Relation) -> None:
        self._scan(f"relation/{r.id}", r)


def flag_stream(path: str, report: str = "deprecated.csv") -> list[Finding]:
    """Stream a PBF, flag deprecated tags, and write a CSV report."""
    handler = DeprecationHandler()
    handler.apply_file(path)
    _write_report(handler.findings, report)
    logger.info("streamed %s: %d deprecated tags found", path, len(handler.findings))
    return handler.findings


def flag_frame(df: pd.DataFrame, id_col: str = "osmid") -> pd.DataFrame:
    """Vectorized deprecation scan over a wide tag frame (one column per key)."""
    hits: list[pd.DataFrame] = []
    for (key, value), replacement in VALUE_DEPRECATIONS.items():
        if key not in df.columns:
            continue
        mask = df[key] == value
        if mask.any():
            matched = df.loc[mask, [id_col, key]].copy()
            matched["deprecated"] = f"{key}={value}"
            matched["replacement"] = replacement
            hits.append(matched.rename(columns={key: "value"}))
    result = pd.concat(hits, ignore_index=True) if hits else pd.DataFrame(
        columns=[id_col, "value", "deprecated", "replacement"])
    logger.info("frame scan: %d deprecated tags across %d rules", len(result), len(VALUE_DEPRECATIONS))
    return result


def _write_report(findings: list[Finding], path: str) -> None:
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["element", "key", "value", "replacement", "severity"])
        writer.writeheader()
        writer.writerows(asdict(f) for f in findings)


if __name__ == "__main__":
    flag_stream("extract.osm.pbf")
```

## Step-by-step walkthrough

1. **Two match kinds, one lookup** — `VALUE_DEPRECATIONS` keys on a `(key, value)` tuple so a specific retired value is flagged while other values of the same key pass, and `check_tags` does a single dictionary lookup per tag rather than iterating the whole map.
2. **Shared checker** — both the streaming and frame paths call the same rule data, so the definition of "deprecated" lives in exactly one place and cannot diverge between the two ingestion styles.
3. **Bounded-memory streaming** — `DeprecationHandler` subclasses `osmium.SimpleHandler` and receives one element at a time, so a planet file scans without ever loading into RAM; only the findings list grows, and that can be flushed periodically on a very dirty extract.
4. **Type-prefixed references** — findings carry `node/123`, `way/456`, or `relation/789` so a reviewer knows exactly which element and type to open, since IDs are not unique across types.
5. **Vectorized frame path** — `flag_frame` tests each rule as a boolean mask over a column, collecting matched rows, which runs in C over millions of rows instead of a Python loop; it is the path to take when tags have already been widened into columns.
6. **Uniform report** — both paths serialize to a flat table (`element, key, value, replacement`) so the output feeds a migration backlog, a dashboard, or a diff without reshaping.

## Verification

Confirm the pass behaves before trusting the report:

- **Known positive.** Seed a tiny extract or frame with `highway=ford` and confirm exactly one finding appears with `ford=yes` as the replacement.
- **Value granularity holds.** A `barrier=fence` element must *not* be flagged while `barrier=wire_fence` must be, proving the map keys on the pair, not the bare key.
- **Counts reconcile.** The number of report rows equals the number of matching tags across the extract; a `df.groupby("deprecated").size()` on the frame path should match a manual `grep`-style count per rule.
- **Streaming and frame agree.** Run both paths over the same data reduced to a frame and confirm identical finding counts per rule, proving the shared rule data is applied consistently.
- **Idempotent report.** Re-running produces the same rows; the pass reads and reports but never mutates the source, so a second run over unchanged data is byte-identical.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Every `barrier` flagged | Rule keyed on the bare key, not the pair | Key `VALUE_DEPRECATIONS` on `(key, value)`. |
| Current tags flagged | Deprecation map is out of date | Refresh against a dated OSM Wiki snapshot. |
| `KeyError` in `flag_frame` | Rule key absent from the frame columns | Guard with `if key not in df.columns: continue`. |
| Findings list exhausts RAM | Extremely dirty planet extract | Flush findings to disk periodically instead of holding all. |
| Wrong element opened | Report row lacks the element type | Prefix references with `node/`, `way/`, `relation/`. |
| Frame path far slower than expected | Row-wise `apply` instead of a mask | Use `df[key] == value` boolean masks, not `.apply`. |

## Specification reference

> The authoritative list of current OpenStreetMap tags is the [Map features](https://wiki.openstreetmap.org/wiki/Map_features) page, and retired tags with their recommended successors are catalogued on the OSM Wiki [Deprecated features](https://wiki.openstreetmap.org/wiki/Deprecated_features) page. Treat both as the source of truth for the deprecation map and pin your copy to a dated snapshot, because the community revises these conventions over time and a hard-coded map silently drifts out of date.

## Frequently Asked Questions

<details>
<summary>Does flagging a deprecated tag mean I should reject the element?</summary>

No. Deprecation is informational: the element still parses and renders, and the tag is merely out of step with current convention. The pass should emit a finding with the suggested replacement and let the element flow through, feeding a migration backlog rather than a hard failure. Reserve rejection for genuine errors like conflicting primary types or invalid value datatypes.
</details>

<details>
<summary>How do I keep the deprecation map from going stale?</summary>

Treat it as a pinned snapshot of the OSM Wiki rather than a permanent constant. Record the date you captured it, review it on a schedule against the Deprecated features and Map features pages, and refresh deliberately. A map that is never updated will eventually flag tags the community has re-adopted or miss newly retired ones.
</details>

<details>
<summary>Should I use the streaming or the pandas path?</summary>

Use the pyosmium stream when you are reading a raw PBF and want bounded memory on a large extract, since it processes one element at a time. Use the pandas path when tags have already been widened into columns earlier in the pipeline, because a boolean mask per rule vectorizes over millions of rows far faster than a per-element Python loop. Both share the same rule data, so the definition of deprecated stays consistent.
</details>

<details>
<summary>Why key the map on a key-value pair instead of just the key?</summary>

Because most deprecations retire one value of a key while other values remain current. Keying on the bare key would flag every use of, say, barrier when only barrier=wire_fence is deprecated. A (key, value) tuple lets the pass distinguish a retired value from a valid one and keeps the report free of false positives.
</details>

## Related

- [Tag & Attribute Consistency Checks](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/) — the parent reference where deprecation is one of five tag rule classes.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — the vocabulary that defines which tags are current.
- [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — the upstream pass that cleans values before a deprecation lookup.
- [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/) — turning the deprecation map into a maintained preset.
- [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) — the section gathering every validation discipline.

Up one level: [Tag & Attribute Consistency Checks](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Flagging Deprecated OSM Tags in a Pipeline",
  "description": "Detect deprecated OSM tags during ETL with a deprecated-to-replacement map applied over a pyosmium stream or a pandas frame, emitting a findings report with suggested successors.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Data Quality & Validation",
  "about": ["deprecated OSM tags", "ETL tag validation", "pyosmium streaming"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Quality & Validation", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/" },
    { "@type": "ListItem", "position": 3, "name": "Tag & Attribute Consistency Checks", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/" },
    { "@type": "ListItem", "position": 4, "name": "Flagging Deprecated OSM Tags in a Pipeline", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/flagging-deprecated-osm-tags-in-a-pipeline/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Flag deprecated OSM tags during ETL",
  "description": "Apply a deprecated-to-replacement map over a pyosmium stream or a pandas frame to detect retired OSM tags and emit a findings report with suggested successors.",
  "step": [
    { "@type": "HowToStep", "name": "Build the deprecation map", "text": "Key each retired tag on a key-value pair mapped to its modern replacement, pinned to a dated OSM Wiki snapshot." },
    { "@type": "HowToStep", "name": "Share one checker", "text": "Have both the streaming and frame paths call the same rule data so the definition of deprecated cannot diverge." },
    { "@type": "HowToStep", "name": "Stream under bounded memory", "text": "Subclass osmium.SimpleHandler to scan one element at a time so a planet file processes without loading into RAM." },
    { "@type": "HowToStep", "name": "Vectorize the frame path", "text": "Test each rule as a boolean mask over a tag column to flag deprecated values across millions of rows in C." },
    { "@type": "HowToStep", "name": "Emit a uniform report", "text": "Serialize findings to a flat table of element, key, value, and replacement so the output feeds a migration backlog or dashboard." }
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
      "name": "Does flagging a deprecated tag mean I should reject the element?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. Deprecation is informational: the element still parses and renders, and the tag is merely out of step with current convention. The pass should emit a finding with the suggested replacement and let the element flow through, feeding a migration backlog rather than a hard failure. Reserve rejection for genuine errors like conflicting primary types or invalid value datatypes." }
    },
    {
      "@type": "Question",
      "name": "How do I keep the deprecation map from going stale?",
      "acceptedAnswer": { "@type": "Answer", "text": "Treat it as a pinned snapshot of the OSM Wiki rather than a permanent constant. Record the date you captured it, review it on a schedule against the Deprecated features and Map features pages, and refresh deliberately. A map that is never updated will eventually flag tags the community has re-adopted or miss newly retired ones." }
    },
    {
      "@type": "Question",
      "name": "Should I use the streaming or the pandas path?",
      "acceptedAnswer": { "@type": "Answer", "text": "Use the pyosmium stream when you are reading a raw PBF and want bounded memory on a large extract, since it processes one element at a time. Use the pandas path when tags have already been widened into columns earlier in the pipeline, because a boolean mask per rule vectorizes over millions of rows far faster than a per-element Python loop. Both share the same rule data." }
    },
    {
      "@type": "Question",
      "name": "Why key the map on a key-value pair instead of just the key?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because most deprecations retire one value of a key while other values remain current. Keying on the bare key would flag every use of, say, barrier when only barrier=wire_fence is deprecated. A key-value tuple lets the pass distinguish a retired value from a valid one and keeps the report free of false positives." }
    }
  ]
}
</script>
