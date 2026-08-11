---
title: "Handling Missing Tags in OSM Data Pipelines"
description: "Detect, infer, and quarantine missing OSM tags in a Python ETL pipeline using coverage diagnostics, deterministic priority-ordered fallback chains, and region-aware defaults — without fabricating data."
pageDescription: "Handle missing OSM tags in Python ETL: measure tag coverage, resolve null highway/surface/maxspeed values through priority fallback chains, apply regional defaults, and route the unresolvable to quarantine."
slug: handling-missing-tags-in-osm-data-pipelines
type: article
breadcrumb: "Handling Missing Tags"
datePublished: 2025-09-12
dateModified: 2026-06-26
date: 2026-06-26
---
# Handling missing tags in OSM data pipelines

Resolve absent OSM keys — `highway`, `surface`, `maxspeed`, `oneway`, `lanes` — through deterministic fallback chains and route the unresolvable to quarantine, so a sparse contributor edit never silently downgrades a routing graph three stages downstream.

## Prerequisites

- [ ] Python 3.10+ (the snippet uses `X | None` union hints)
- [ ] `pandas>=2.1.0` and `geopandas>=1.0.0` installed (`pip install "pandas>=2.1.0" "geopandas>=1.0.0"`)
- [ ] `pyrosm>=0.6.2` for reading the `.osm.pbf` extract into a GeoDataFrame
- [ ] `psutil>=5.9` if you intend to gate ingestion on memory pressure
- [ ] A regional extract to test against (any `.osm.pbf` from [Geofabrik](https://download.geofabrik.de/) works)
- [ ] A writable quarantine directory for the dead-letter Parquet partition

## Why tags go missing

OpenStreetMap's schemaless model guarantees contributor flexibility, but that freedom means any key can be absent on any element. Critical keys go missing for three distinct reasons, and they must not be treated the same way: a key is *legitimately absent* (a footpath has no `maxspeed`), it is *unmapped* (a road that simply has not been surveyed for `surface`), or it is an *extraction artifact* (a value clipped to an empty string or coerced to `NaN` during a spatial join). The first justifies a documented default; the second and third must be inferred or quarantined, never guessed. Distinguishing them is the whole job of this stage, which sits inside [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/) and receives the quarantine routing that page defines.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 251" role="img" aria-labelledby="missing-kinds-t missing-kinds-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="missing-kinds-t">Three reasons a tag is absent, and why they must not be filled the same way</title>
  <desc id="missing-kinds-d">Three panels. Not surveyed means the mapper never recorded it and the true value is unknown; filling it invents data and a null is the honest answer. Implied by another tag means the value is derivable, such as a residential road carrying an urban default; filling it is correct if the derivation is stamped. Genuinely inapplicable means the tag does not apply, such as a maxspeed on a footpath; filling it is wrong in a different way, and the column should be null with a reason.</desc>
  <rect x="0" y="0" width="880" height="251" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three absences that look identical in the data</text>
  <rect x="26" y="52" width="258" height="157" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Not surveyed</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Nobody recorded it</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">True value exists, unknown</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Filling it invents data</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Correct: null, count as a gap</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Fixable by: a mapper going there</text>
  <rect x="310" y="52" width="258" height="157" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="439" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Implied elsewhere</text>
  <text x="324" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Derivable from other tags</text>
  <text x="324" y="125" font-size="10.5" fill="currentColor" opacity="0.92">e.g. urban residential default</text>
  <text x="324" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Filling it is correct</text>
  <text x="324" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Correct: fill, provenance='implied'</text>
  <text x="324" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Fixable by: your derivation rules</text>
  <rect x="594" y="52" width="258" height="157" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="723" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Inapplicable</text>
  <text x="608" y="104" font-size="10.5" fill="currentColor" opacity="0.92">The tag does not apply here</text>
  <text x="608" y="125" font-size="10.5" fill="currentColor" opacity="0.92">e.g. maxspeed on a footway</text>
  <text x="608" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Filling it is a category error</text>
  <text x="608" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Correct: null with a reason code</text>
  <text x="608" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Fixable by: nothing — it is right</text>
  <text x="440" y="235" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Carry a reason code beside the null. It costs a small enum and turns an unusable completeness number into an actionable one.</text>
</svg>
<figcaption>A single null cannot distinguish these three, which is why a completeness metric computed on null counts alone always overstates how much is missing.</figcaption>
</figure>

A naive `.fillna()` violates OSM tagging semantics by collapsing all three cases into one fabricated value. The correct approach is a priority-ordered chain: try the primary key, then ranked secondary keys that carry the same signal, then a region-appropriate default, and only if all fail, quarantine the row. This presupposes that values have already been trimmed and case-resolved — that cleaning belongs to [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/), and the diagnostic below treats a whitespace-only or `"nan"` string as missing precisely because uncleaned input would otherwise read as present.

<svg viewBox="0 0 980 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Decision flow for a single raw OSM tag value. Test whether the value is present and non-empty; if yes, keep it. If not, try fallback key one, then fallback key two — each, if it holds a value, fills the primary key. If all fallbacks fail, test for a documented regional default: if one exists, apply it and write an audit log entry; otherwise route the row to a quarantine dead-letter partition." style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Priority-ordered resolution path for a missing OSM tag</title>
  <desc>A left-to-right decision chain: a raw tag value is tested for presence; a yes at any stage keeps or fills the value, the no path walks ranked fallback keys, then a regional default, and finally quarantine when nothing resolves.</desc>
  <defs>
    <marker id="mtArrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="980" height="320" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <g text-anchor="middle" fill="currentColor">
    <!-- start -->
    <rect x="20" y="68" width="100" height="44" rx="6" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
    <text x="70" y="88" font-size="12.5">raw tag</text>
    <text x="70" y="104" font-size="12.5">value</text>
    <!-- decision diamonds along the top -->
    <!-- Q1 present? center 235,90 -->
    <path d="M235,52 L297,90 L235,128 L173,90 Z" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
    <text x="235" y="86" font-size="11">present &amp;</text>
    <text x="235" y="100" font-size="11">non-empty?</text>
    <!-- Q2 fallback #1 center 435,90 -->
    <path d="M435,52 L497,90 L435,128 L373,90 Z" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
    <text x="435" y="86" font-size="11">fallback</text>
    <text x="435" y="100" font-size="11">key #1?</text>
    <!-- Q3 fallback #2 center 635,90 -->
    <path d="M635,52 L697,90 L635,128 L573,90 Z" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
    <text x="635" y="86" font-size="11">fallback</text>
    <text x="635" y="100" font-size="11">key #2?</text>
    <!-- Q4 regional default center 835,90 -->
    <path d="M835,52 L897,90 L835,128 L773,90 Z" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
    <text x="835" y="86" font-size="11">regional</text>
    <text x="835" y="100" font-size="11">default?</text>
    <!-- top "no" chain -->
    <line x1="120" y1="90" x2="171" y2="90" stroke="currentColor" stroke-width="1.5" marker-end="url(#mtArrow)"/>
    <line x1="297" y1="90" x2="371" y2="90" stroke="currentColor" stroke-width="1.5" marker-end="url(#mtArrow)"/>
    <text x="334" y="84" font-size="10" opacity="0.75">no</text>
    <line x1="497" y1="90" x2="571" y2="90" stroke="currentColor" stroke-width="1.5" marker-end="url(#mtArrow)"/>
    <text x="534" y="84" font-size="10" opacity="0.75">no</text>
    <line x1="697" y1="90" x2="771" y2="90" stroke="currentColor" stroke-width="1.5" marker-end="url(#mtArrow)"/>
    <text x="734" y="84" font-size="10" opacity="0.75">no</text>
    <!-- outcome: keep / fill -->
    <rect x="360" y="231" width="150" height="48" rx="6" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
    <text x="435" y="252" font-size="12.5">keep value</text>
    <text x="435" y="268" font-size="10" opacity="0.78">fills primary key</text>
    <!-- outcome: apply default -->
    <rect x="675" y="231" width="140" height="48" rx="6" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
    <text x="745" y="252" font-size="12.5">apply default</text>
    <text x="745" y="268" font-size="10" opacity="0.78">+ audit log</text>
    <!-- outcome: quarantine (dead-letter, dashed) -->
    <rect x="840" y="231" width="130" height="48" rx="6" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3"/>
    <text x="905" y="252" font-size="12.5">quarantine</text>
    <text x="905" y="268" font-size="10" opacity="0.78">row (DLQ)</text>
    <!-- yes paths dropping to keep value -->
    <!-- Q2 straight down -->
    <line x1="435" y1="128" x2="435" y2="229" stroke="currentColor" stroke-width="1.5" marker-end="url(#mtArrow)"/>
    <text x="448" y="185" font-size="10" opacity="0.75">yes</text>
    <!-- Q1 down-then-right into keep -->
    <polyline points="235,128 235,205 375,205 375,229" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#mtArrow)"/>
    <text x="248" y="150" font-size="10" opacity="0.75">yes</text>
    <!-- Q3 down-then-left into keep -->
    <polyline points="635,128 635,205 495,205 495,229" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#mtArrow)"/>
    <text x="648" y="150" font-size="10" opacity="0.75">yes</text>
    <!-- Q4 yes -> apply default -->
    <polyline points="835,128 835,205 745,205 745,229" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#mtArrow)"/>
    <text x="848" y="150" font-size="10" opacity="0.75">yes</text>
    <!-- Q4 no -> quarantine -->
    <polyline points="897,90 940,90 940,229" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#mtArrow)"/>
    <text x="952" y="160" font-size="10" opacity="0.75">no</text>
  </g>
</svg>

## The complete solution

Run a coverage diagnostic first, then resolve fallbacks, apply regional defaults, and split valid rows from a quarantine partition. The module is self-contained against `pandas>=2.1.0` / `geopandas>=1.0.0`:

```python
"""Detect and resolve missing OSM tags, quarantining the unresolvable.

Requires: pandas>=2.1.0, geopandas>=1.0.0, pyrosm>=0.6.2, Python 3.10+.
"""
import logging

import geopandas as gpd
import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Strings that *look* present but are extraction artifacts, not real values.
SENTINELS = ["", "nan", "none", "NaN", "None"]

# Priority-ordered fallback chains: primary key -> ranked secondary keys.
FALLBACK_RULES: dict[str, list[str]] = {
    "highway": ["route", "railway", "waterway"],
    "surface": ["tracktype"],
    "maxspeed": ["maxspeed:forward", "maxspeed:backward", "zone:maxspeed"],
}

# Defaults applied ONLY where absence has a documented meaning per region.
REGION_DEFAULTS: dict[str, dict[str, object]] = {
    "EU": {"oneway": "no"},
    "US": {"oneway": "no"},
}


def _missing_mask(col: pd.Series) -> pd.Series:
    """True where a value is null, empty, or a coercion sentinel."""
    cleaned = col.astype("string").str.strip()
    return cleaned.isna() | cleaned.str.lower().isin([s.lower() for s in SENTINELS])


def diagnose_tag_coverage(gdf: gpd.GeoDataFrame, keys: list[str]) -> pd.DataFrame:
    """Quantify present/missing counts per key before any imputation runs."""
    total = max(len(gdf), 1)
    rows = []
    for key in keys:
        col = gdf.get(key, pd.Series(dtype="object"))
        missing = int(_missing_mask(col).sum()) if len(col) else total
        present = total - missing
        rows.append({
            "key": key,
            "present": present,
            "missing": missing,
            "coverage_pct": round(present / total * 100, 2),
        })
    report = pd.DataFrame(rows).set_index("key")
    logger.info("tag coverage:\n%s", report)
    return report


def resolve_missing_tags(
    gdf: gpd.GeoDataFrame, rules: dict[str, list[str]] = FALLBACK_RULES
) -> gpd.GeoDataFrame:
    """Backfill each primary key from its ranked fallback chain, in place."""
    gdf = gdf.copy()
    for primary, chain in rules.items():
        if primary not in gdf.columns:
            gdf[primary] = pd.NA
        mask = _missing_mask(gdf[primary])
        for fallback_key in chain:
            if fallback_key not in gdf.columns or not mask.any():
                continue
            donor_ok = ~_missing_mask(gdf[fallback_key])
            fill_here = mask & donor_ok
            gdf.loc[fill_here, primary] = gdf.loc[fill_here, fallback_key]
            logger.debug("filled %d %r from %r", int(fill_here.sum()), primary, fallback_key)
            mask = mask & ~fill_here  # only still-missing rows need the next link
    return gdf


def apply_regional_defaults(
    gdf: gpd.GeoDataFrame, region_code: str
) -> gpd.GeoDataFrame:
    """Backfill documented defaults (e.g. oneway=no) for the given region."""
    gdf = gdf.copy()
    defaults = REGION_DEFAULTS.get(region_code, REGION_DEFAULTS["EU"])
    for col, value in defaults.items():
        if col not in gdf.columns:
            gdf[col] = pd.NA
        filled = _missing_mask(gdf[col])
        gdf.loc[filled, col] = value
        logger.info("region %s: defaulted %d rows of %r to %r",
                    region_code, int(filled.sum()), col, value)
    return gdf


def split_quarantine(
    gdf: gpd.GeoDataFrame, required: list[str]
) -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame]:
    """Send rows still missing a required key to a dead-letter partition."""
    unresolved = pd.Series(False, index=gdf.index)
    for key in required:
        unresolved |= _missing_mask(gdf.get(key, pd.Series(index=gdf.index, dtype="object")))
    keep_cols = [c for c in (*required, *FALLBACK_RULES) if c in gdf.columns]
    quarantine = gdf.loc[unresolved, keep_cols].assign(
        quarantine_reason="missing_required_after_fallback"
    )
    valid = gdf.loc[~unresolved]
    logger.info("resolved %d valid, %d quarantined", len(valid), len(quarantine))
    return valid, quarantine
```

A typical driver wires the stages together, reading the extract once and emitting two partitions:

```python
from pyrosm import OSM

def process_extract(pbf_path: str, region: str = "EU"):
    gdf = OSM(pbf_path).get_network(network_type="driving")
    diagnose_tag_coverage(gdf, ["highway", "surface", "maxspeed", "oneway"])
    gdf = resolve_missing_tags(gdf)
    gdf = apply_regional_defaults(gdf, region)
    valid, quarantine = split_quarantine(gdf, required=["highway"])
    return valid, quarantine
```

## Step-by-step walkthrough

1. **`_missing_mask` defines "missing" once.** Every other function depends on it, so the policy that a whitespace-only or `"None"` string counts as absent lives in exactly one place. Casting to the nullable `"string"` dtype first avoids the object-array boxing that makes `.str` operations slow on large extracts.
2. **`diagnose_tag_coverage` measures before it mutates.** Run it on the raw extract and log the result. If `highway` coverage on a driving network drops below ~95%, that is a survey gap or an extraction bug to investigate — not something to paper over with defaults.
3. **`resolve_missing_tags` walks the chain in rank order.** For each primary key it recomputes the still-missing mask after every donor, so a row is only ever filled by the *highest-priority* fallback that actually has a value. The order of the list in `FALLBACK_RULES` is the policy; reordering it changes results, which is why it is data, not control flow.
4. **`apply_regional_defaults` is deliberately separate.** Defaults are the one place data is invented, so they are isolated, logged with a count, and keyed by region. `oneway=no` is safe to default because its absence has a documented meaning in OSM; `maxspeed` is not, which is why it never appears here.
5. **`split_quarantine` refuses to guess.** Any row still missing a *required* key after fallbacks and defaults is routed to a dead-letter frame that retains its raw payload and a reason string, so a reviewer can diagnose it without re-joining the source extract. This is the quarantine partition that [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) triages.

For planetary or continental files that exceed RAM, drive the same functions over bounded slices rather than one monolithic frame, gating on `psutil.virtual_memory().percent` and flushing intermediate Parquet between chunks — the streaming and spill patterns are covered by [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/).

## Verification

Confirm the stage behaved before handing the result to a graph builder:

<figure class="diagram-wrap">
<svg viewBox="0 0 880 278" role="img" aria-labelledby="missing-verify-t missing-verify-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="missing-verify-t">Checks that keep a null-handling strategy honest over time</title>
  <desc id="missing-verify-d">A grid of four checks with what a healthy result looks like. The share of rows filled by defaults should be stable release to release; a jump means upstream tagging changed or a rule broke. No output row should have a filled value with a null provenance code. Rows marked inapplicable should never appear for feature classes where the tag does apply. And the count of not-surveyed rows should trend down over releases as the map improves, not up.</desc>
  <rect x="0" y="0" width="880" height="278" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four checks — the last one measures the map, not the pipeline</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">healthy</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">what a breach means</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">share filled by defaults</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">stable ±1pp</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">upstream tagging shifted, or a rule broke</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">filled value, null provenance</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">never happens</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">a fill path bypassed the stamp</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">inapplicable on an applicable class</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">never happens</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">the applicability rule is wrong</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">not-surveyed count over releases</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">trending down</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">rising: your extract area is growing faster than it is mapped</text>
  <text x="440" y="260" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Snapshot these four per release into a small table. Trends are what make them useful; a single reading tells you almost nothing.</text>
</svg>
<figcaption>The last one is a data-quality signal about OSM itself rather than about your pipeline, and it is the one worth putting on a dashboard.</figcaption>
</figure>

- The coverage log shows `present + missing == len(gdf)` for every key, and `coverage_pct` for `highway` is near 100 on a `network_type="driving"` extract.
- After `resolve_missing_tags`, re-running `diagnose_tag_coverage` on `maxspeed` shows higher coverage than before — the `maxspeed:forward`/`backward` donors filled real gaps.
- `split_quarantine` returns a `valid` frame with zero missing `highway` values: assert `_missing_mask(valid["highway"]).sum() == 0`.
- The quarantine frame's row count is small and stable batch-to-batch. A sudden spike means a stale fallback table after a large import, not a code bug.
- Defaulted rows carry the region value: `(apply_regional_defaults(g, "EU")["oneway"] == "no").sum()` equals the pre-default missing count for `oneway`.

## Common errors and fixes

| Error / symptom | Root cause | One-line fix |
|---|---|---|
| Every row reads as "present" despite blanks | `.notna()` alone misses `""` and `"nan"` strings | Use `_missing_mask`, which strips and matches the sentinel set |
| `KeyError` on a fallback key | The donor column is absent in this regional extract | Guard with `if fallback_key not in gdf.columns: continue` |
| Routing graph treats all roads two-way | `oneway` left null, builder defaults to bidirectional | Apply `apply_regional_defaults` before graph conversion |
| `maxspeed` filled with imperial numbers | Defaulted instead of cleaned/converted | Never default `maxspeed`; convert units in the cleaning stage |
| Quarantine count grows every run | Fallback table stale after an import | Audit recent changesets; add the new key variants to `FALLBACK_RULES` |
| `SettingWithCopyWarning` on `.loc` writes | Operating on a slice view | Call `.copy()` once at function entry (the snippet already does) |

## Spec reference

> OSM places no schema constraint on which keys an element carries — any key may be absent — so "missing" is a pipeline concept, not a format error. The authoritative meaning of each key and whether absence is significant is defined in the OpenStreetMap [Map Features](https://wiki.openstreetmap.org/wiki/Map_Features) and [Tags](https://wiki.openstreetmap.org/wiki/Tags) documentation; treat those as the source of truth for which defaults are legitimate. The pattern-matching used to detect sentinel values follows the [Python `re` module](https://docs.python.org/3/library/re.html) and pandas nullable `string` dtype semantics.

## Related

- [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/) — the mapping stage whose quarantine routing this page implements.
- [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — the cleaning that must precede missing-value detection.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — triaging the dead-letter partition this stage emits.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — streaming the same logic over extracts larger than RAM.
- [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/) — where missing `oneway`/`lanes` silently corrupt topology if not backfilled first.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — the controlled vocabulary that decides which absences are meaningful.

This how-to belongs to the [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/) guide — head back there for the full mapping stage, or up to [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) for the broader pipeline.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Handling missing tags in OSM data pipelines",
  "description": "Detect, infer, and quarantine missing OSM tags in a Python ETL pipeline using coverage diagnostics, priority-ordered fallback chains, and region-aware defaults.",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["OpenStreetMap", "Tag normalization", "Data quality", "Python ETL"],
  "isPartOf": {
    "@type": "TechArticle",
    "name": "Batch Attribute Mapping Strategies",
    "url": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/"
  }
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Parsing & Tag Normalization Workflows", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/" },
    { "@type": "ListItem", "position": 3, "name": "Batch Attribute Mapping Strategies", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/" },
    { "@type": "ListItem", "position": 4, "name": "Handling Missing Tags in OSM Data Pipelines", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/handling-missing-tags-in-osm-data-pipelines/" }
  ]
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Resolve missing OSM tags with fallback chains and quarantine",
  "description": "Detect missing OSM tags, backfill them through priority-ordered fallback chains and regional defaults, and route the unresolvable to a quarantine partition.",
  "step": [
    { "@type": "HowToStep", "name": "Diagnose coverage", "text": "Run diagnose_tag_coverage on the raw extract to count present versus missing values per key, treating empty and sentinel strings as missing." },
    { "@type": "HowToStep", "name": "Resolve fallback chains", "text": "Walk each primary key's ranked fallback list, filling only still-missing rows from the highest-priority donor that holds a value." },
    { "@type": "HowToStep", "name": "Apply regional defaults", "text": "Backfill documented defaults such as oneway=no for the target region, logging the count, while never defaulting unsafe keys like maxspeed." },
    { "@type": "HowToStep", "name": "Split quarantine", "text": "Route rows still missing a required key after fallbacks and defaults to a dead-letter partition that retains the raw payload and a failure reason." }
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
      "name": "Why not just use fillna() for missing OSM tags?",
      "acceptedAnswer": { "@type": "Answer", "text": "fillna collapses three distinct cases — legitimately absent, unmapped, and extraction artifact — into one fabricated value, which biases every downstream aggregate. A priority-ordered fallback chain backfills only from keys carrying the same signal and quarantines what it cannot resolve, instead of inventing data." }
    },
    {
      "@type": "Question",
      "name": "How do I tell a genuinely missing tag from an extraction artifact?",
      "acceptedAnswer": { "@type": "Answer", "text": "Treat null, empty strings, and coercion sentinels like 'nan' or 'None' as missing through a single shared mask, then measure coverage on the raw extract before any cleaning. A sudden coverage drop on a key that is normally well-populated signals an artifact or survey gap rather than legitimate absence." }
    },
    {
      "@type": "Question",
      "name": "When is it safe to apply a default value to a missing tag?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only when the absence has a documented meaning, such as oneway defaulting to no. Keys whose absence is ambiguous, like maxspeed, must never be defaulted here; convert and infer them in the cleaning and mapping stages or quarantine the row instead." }
    },
    {
      "@type": "Question",
      "name": "What should the quarantine partition contain?",
      "acceptedAnswer": { "@type": "Answer", "text": "Rows still missing a required key after fallbacks and defaults, retaining their raw key columns plus a quarantine_reason string. Keeping the original payload lets a reviewer diagnose the failure without re-joining the source extract, and a stable quarantine count batch-to-batch confirms the fallback table is current." }
    }
  ]
}
</script>
