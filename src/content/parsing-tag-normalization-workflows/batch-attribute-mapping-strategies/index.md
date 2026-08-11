---
title: "Batch Attribute Mapping Strategies"
description: "Translate raw OSM tag dictionaries into typed, query-ready columns with versioned schema registries, vectorized lookups, deterministic fallback chains, and quarantine routing."
pageDescription: "Batch attribute mapping for OSM ETL: versioned tag registries, Polars vectorized lookups, priority-ordered fallback chains, error routing, and cross-region harmonization."
slug: batch-attribute-mapping-strategies
type: guide
breadcrumb: "Batch Attribute Mapping"
datePublished: 2025-09-12
dateModified: 2026-06-26
date: 2026-06-26
---
# Batch Attribute Mapping Strategies

Batch attribute mapping is the deterministic translation layer between raw OpenStreetMap (OSM) tags and the typed columns every downstream stage assumes. The failure it prevents is silent and expensive: when a regional extract tags a road as `highway=primary_link` and your pipeline has only a rule for `primary`, the value falls through to `null`, the routing graph downgrades the slip road to an unweighted edge, and an isochrone built three stages later is quietly wrong with no error in any log. Multiply that across thousands of contributor-driven key variants and the analytical dataset degrades feature by feature while every job reports success. This page shows how to make the mapping stage explicit, versioned, and vectorized so that every input value resolves to a known target — or is routed to quarantine for review rather than fabricated into a default.

<svg viewBox="0 0 760 500" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Data-flow diagram of the batch attribute mapping stage: a raw tag struct of highway, surface and maxspeed feeds a versioned schema registry lookup, then a decision tests whether the primary tag resolved. A hit produces typed columns directly; a miss enters a priority-ordered fallback chain over lanes, maxspeed and smoothness. A resolved fallback also yields typed columns, while an exhausted chain routes the record to a quarantine Parquet partition. Typed columns flow into cross-region harmonization and then routing-graph preparation." style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Batch Attribute Mapping Data Flow</title>
  <desc>A raw tag struct (highway, surface, maxspeed) feeds a versioned schema registry lookup. A decision tests whether the primary tag resolved. A hit goes straight to typed columns (road_class, surface_type, speed). A miss enters a priority-ordered fallback chain over lanes, maxspeed and smoothness; a resolved fallback also produces typed columns, while an exhausted chain routes the record to a quarantine Parquet partition. Typed columns are then harmonized across regions and prepared as routing-graph inputs.</desc>
  <defs>
    <marker id="amArr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="760" height="500" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <!-- 1 raw tag struct -->
  <rect x="60" y="20" width="260" height="58" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="190" y="44" text-anchor="middle" font-size="13" fill="currentColor">Raw tag struct</text>
  <text x="190" y="62" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.75">highway &#183; surface &#183; maxspeed</text>
  <line x1="190" y1="78" x2="190" y2="108" stroke="currentColor" stroke-width="1.5" marker-end="url(#amArr)"/>
  <!-- 2 schema registry -->
  <rect x="60" y="110" width="260" height="58" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="190" y="134" text-anchor="middle" font-size="13" fill="currentColor">Schema registry lookup</text>
  <text x="190" y="152" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.75">versioned immutable artifact</text>
  <line x1="190" y1="168" x2="190" y2="188" stroke="currentColor" stroke-width="1.5" marker-end="url(#amArr)"/>
  <!-- 3 decision diamond -->
  <polygon points="190,190 280,232 190,274 100,232" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="190" y="228" text-anchor="middle" font-size="12" fill="currentColor">Primary tag</text>
  <text x="190" y="244" text-anchor="middle" font-size="12" fill="currentColor">resolved?</text>
  <!-- hit -> typed columns -->
  <text x="356" y="223" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">hit</text>
  <line x1="280" y1="232" x2="428" y2="232" stroke="currentColor" stroke-width="1.5" marker-end="url(#amArr)"/>
  <!-- miss -> fallback -->
  <text x="208" y="302" text-anchor="start" font-size="11" fill="currentColor" opacity="0.85">miss</text>
  <line x1="190" y1="274" x2="190" y2="318" stroke="currentColor" stroke-width="1.5" marker-end="url(#amArr)"/>
  <!-- 4 fallback chain -->
  <rect x="50" y="320" width="280" height="64" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="190" y="346" text-anchor="middle" font-size="13" fill="currentColor">Fallback chain</text>
  <text x="190" y="364" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.75">lanes &#183; maxspeed &#183; smoothness</text>
  <!-- fallback resolved -> typed columns -->
  <text x="392" y="320" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">resolved</text>
  <line x1="330" y1="344" x2="430" y2="270" stroke="currentColor" stroke-width="1.5" marker-end="url(#amArr)"/>
  <!-- fallback exhausted -> quarantine -->
  <text x="208" y="412" text-anchor="start" font-size="11" fill="currentColor" opacity="0.85">exhausted</text>
  <line x1="190" y1="384" x2="190" y2="428" stroke="currentColor" stroke-width="1.5" marker-end="url(#amArr)"/>
  <!-- 5 quarantine -->
  <rect x="60" y="430" width="260" height="58" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 4"/>
  <text x="190" y="454" text-anchor="middle" font-size="13" fill="currentColor">Quarantine partition</text>
  <text x="190" y="472" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.75">Parquet &#183; dead-letter</text>
  <!-- 6 typed columns -->
  <rect x="430" y="200" width="270" height="64" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="565" y="226" text-anchor="middle" font-size="13" fill="currentColor">Typed columns</text>
  <text x="565" y="244" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.75">road_class &#183; surface_type &#183; speed</text>
  <line x1="565" y1="264" x2="565" y2="298" stroke="currentColor" stroke-width="1.5" marker-end="url(#amArr)"/>
  <!-- 7 harmonization -->
  <rect x="430" y="300" width="270" height="58" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="565" y="334" text-anchor="middle" font-size="13" fill="currentColor">Cross-region harmonization</text>
  <line x1="565" y1="358" x2="565" y2="398" stroke="currentColor" stroke-width="1.5" marker-end="url(#amArr)"/>
  <!-- 8 routing graph -->
  <rect x="430" y="400" width="270" height="58" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="565" y="434" text-anchor="middle" font-size="13" fill="currentColor">Routing-graph preparation</text>
</svg>

This stage sits inside the broader architecture of [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/), downstream of ingestion and upstream of graph assembly. Mapping engineers and Python ETL developers implement these strategies to guarantee reproducible transformations across planetary-scale extracts, while GIS analysts depend on the resulting consistency for spatial joins, topology validation, and network routing. Production-grade pipelines prioritize memory efficiency, explicit error routing, and strict schema enforcement to keep high-throughput execution from degrading data in place.

## Prerequisite concepts

Three foundations should be in place before mapping rules run. First, mapping operates on a per-element dictionary of string key-value pairs, so the structure described in the [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) determines which columns even exist to map — ways carry the `highway`/`surface` keys this page uses, while nodes and relations expose different attribute surfaces. Second, mapping a value presupposes the value has already been cleaned: anchored regex extraction and unit conversion belong to [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/), and the registry here assumes inputs arrive trimmed and case-resolved rather than raw. Third, the canonical key names your rules target should follow the conventions in [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/); mapping deprecated keys onto a controlled vocabulary that does not match the rest of the pipeline only relocates the inconsistency.

## Schema registries and deterministic transformations

The foundation of reliable mapping is an explicit schema registry rather than ad-hoc conditional branching. A centralized mapping configuration — serialized as JSON, YAML, or a Parquet-backed lookup table — defines source-to-target transformations, handling case normalization, unit conversion, and deprecated tag aliases. Decoupling transformation rules from execution code lets teams version-control mapping configurations alongside pipeline releases, which yields audit trails and rollback capability: a misclassification introduced in registry `v7` can be diffed against `v6` and reverted without touching parser code.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 251" role="img" aria-labelledby="schema-reg-t schema-reg-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="schema-reg-t">What a versioned mapping registry gives you that inline mapping code does not</title>
  <desc id="schema-reg-d">Two panels. Mapping expressed as inline code means the rule set is spread across functions, a change is a code deploy, there is no way to ask which version produced a row, and reproducing last month output means checking out last month code. A versioned registry means the rules are data with a version identifier, a change is a reviewed data change, every output row carries the version that produced it, and reproducing an old output means loading an old registry version.</desc>
  <rect x="0" y="0" width="880" height="251" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Rules as data, versioned — so an output row can name what produced it</text>
  <rect x="26" y="52" width="401" height="157" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="226" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Mapping as inline code</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Rules spread across functions</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">A change is a code deploy</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">No version stamped on the output</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Reproducing old output: check out old code</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Reviewing a change: read a diff of Python</text>
  <rect x="453" y="52" width="401" height="157" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="653" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Versioned registry</text>
  <text x="467" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Rules are data with a version id</text>
  <text x="467" y="125" font-size="10.5" fill="currentColor" opacity="0.92">A change is a reviewed data change</text>
  <text x="467" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Every row carries registry_version</text>
  <text x="467" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Reproducing old output: load that version</text>
  <text x="467" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Reviewing a change: read a diff of rules</text>
  <text x="440" y="235" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">The registry version belongs in the output alongside the source sequence number — together they make a row fully reproducible.</text>
</svg>
<figcaption>The decisive property is the last one. Once a row records which registry version produced it, "why did this value change" becomes a diff between two versions instead of an archaeology exercise.</figcaption>
</figure>

The registry must be treated as an immutable artifact at run time. This directly supports [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/), because concurrent chunk processors can reference the same mapping artifact without lock contention or redundant I/O — every worker reads the frozen table once and shares it copy-free.

```python
from __future__ import annotations

import logging
from typing import Any

import polars as pl

logger = logging.getLogger(__name__)

# Production-grade mapping registry (versioned alongside pipeline releases).
TAG_REGISTRY: dict[str, Any] = {
    "version": "v7",
    "highway": {
        "motorway": "trunk", "trunk": "trunk", "primary": "arterial",
        "secondary": "collector", "tertiary": "local", "residential": "local",
        "service": "access", "track": "access",
    },
    "surface": {
        "asphalt": "paved", "concrete": "paved", "paved": "paved",
        "unpaved": "unpaved", "gravel": "unpaved", "dirt": "unpaved",
    },
    # Regex to extract the numeric speed value (no unit suffix expected after cleaning).
    "maxspeed_regex": r"^(\d+(?:\.\d+)?)$",
}


def apply_registry_lookups(df: pl.DataFrame) -> pl.DataFrame:
    """Vectorized tag normalization using strict registry replacement.

    Assumes the tags struct has been expanded into individual columns named
    'highway', 'surface', and 'maxspeed' before calling this function.
    """
    exprs = []

    if "highway" in df.columns:
        exprs.append(
            pl.col("highway")
              .replace_strict(TAG_REGISTRY["highway"], default=None)
              .alias("road_class")
        )

    if "surface" in df.columns:
        exprs.append(
            pl.col("surface")
              .replace_strict(TAG_REGISTRY["surface"], default="unknown")
              .alias("surface_type")
        )

    if "maxspeed" in df.columns:
        exprs.append(
            pl.col("maxspeed")
              .str.extract(TAG_REGISTRY["maxspeed_regex"], 1)
              .cast(pl.Float64, strict=False)
              .alias("speed_limit_kmh")
        )

    logger.debug("registry %s applied %d expressions", TAG_REGISTRY["version"], len(exprs))
    return df.with_columns(exprs) if exprs else df
```

The choice of `replace_strict` over `replace` is deliberate. `replace_strict` with an explicit `default` forces every unmapped value into a known state — `None` for `road_class` so the fallback chain can detect it, or the sentinel `"unknown"` for `surface_type` where a literal placeholder is preferable to a null. Silent pass-through of unmapped values is exactly the defect this stage exists to eliminate.

## Specification & registry reference

The registry is the spec for this stage, so its field semantics deserve to be pinned down as precisely as a binary format. The table below summarizes the contract each registry key obeys.

| Registry field | Type | Default policy | Pipeline consequence if violated |
|---|---|---|---|
| `version` | string (semver-like) | required, stamped into output metadata | Outputs become non-reproducible; you cannot diff a regression to a registry change |
| `highway` map | `dict[str, str]` | unmapped → `None` (drives fallback) | Missing alias downgrades a road class and corrupts edge weights |
| `surface` map | `dict[str, str]` | unmapped → `"unknown"` sentinel | A null instead of sentinel breaks `group_by` cardinality assertions |
| `maxspeed_regex` | anchored pattern | unmatched → `null` float | Unanchored pattern matches partial values (`"50 mph"` → `50`, wrong unit) |
| target column names | reserved | must not collide with source keys | Overwriting `highway` in place destroys the audit trail to the raw tag |

Two constraints are worth stating explicitly. The regex must be anchored with `^` and `$` — an unanchored pattern silently accepts `maxspeed=50 mph` and extracts `50` as if it were already km/h, fabricating a unit. And target columns must be *new* names (`road_class`, not `highway`) so the original tag survives alongside the mapped value, which is what makes bidirectional traceability possible later.

## Memory-efficient chunk processing and vectorization

OSM extracts routinely exceed available system memory, making naive DataFrame loading unsustainable. Memory-efficient processing requires streaming parsers, zero-copy columnar structures, and expression trees that compile to native execution kernels — the streaming and windowing patterns are covered in depth by [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/). Rather than materializing an entire `.osm.pbf` file in RAM, the mapping stage processes bounded chunks, applying registry rules through lazy evaluation. Polars and Apache Arrow enable out-of-core execution by spilling intermediate results to disk when memory pressure exceeds a threshold.

Vectorized operations eliminate Python-level iteration overhead. Regex compilation should occur once per pipeline run, not once per row; string operations, numeric casting, and categorical encoding must be pushed down to the Arrow compute layer to leverage SIMD instructions. For cross-region harmonization, locale-specific synonym dictionaries should be pre-joined as categorical mappings rather than evaluated through chained `if/else` branches, which reduces both CPU cycles and peak memory footprint. The practical rule is that any logic expressible as a column expression must never become a Python loop over rows — at a few million features per chunk, the interpreter overhead alone dominates wall-clock time.

## Step-by-step implementation

The mapping stage assembles into a repeatable sequence that takes an expanded tag DataFrame and emits a typed, validated result split into valid and quarantine partitions.

1. **Expand the tag struct.** Promote the nested `tags` dictionary into flat columns (`highway`, `surface`, `maxspeed`, `lanes`) so vectorized expressions can address them directly. Keep the original struct for the audit trail.
2. **Apply registry lookups.** Run `apply_registry_lookups` to produce `road_class`, `surface_type`, and `speed_limit_kmh` via strict replacement, so every unmapped value lands in a known state.
3. **Resolve fallbacks.** For rows where the primary `road_class` is `null`, evaluate a priority-ordered chain against secondary signals (`speed_limit_kmh`, `lanes`) to infer a class without resorting to row-wise Python.
4. **Split valid and quarantine.** Partition the result on whether a final class was resolved; valid rows proceed, unresolved rows carry their original payload and a failure reason to a dead-letter partition.
5. **Stamp provenance.** Record the registry `version`, source extract URL, and timestamp in the output metadata so the result is reproducible and auditable.

## Deterministic fallback chains and error routing

OSM data exhibits high variance across regions, contributor experience, and mapping campaigns, so the mapping stage must implement deterministic fallback chains when a primary tag is absent or malformed. Inferring `road_class` from `maxspeed`, `lanes`, or `smoothness` when `highway` is missing requires a priority-ordered evaluation sequence. These chains belong in vectorized conditional expressions, not row-wise Python loops, both to maintain throughput and to guarantee that every distributed worker evaluates the same priority order in the same way — a chain whose branch order depends on dict iteration would produce different results on different runs.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="fallback-chain-t fallback-chain-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="fallback-chain-t">A fallback chain that records which rung produced each value</title>
  <desc id="fallback-chain-d">A left-to-right chain of four fallback rungs for deriving a road speed limit. First the explicit maxspeed tag. Failing that, an implied value from maxspeed:type or a country default. Failing that, a highway-class default from the mapping table. Failing that, the row is routed to review rather than given a value. Each rung stamps a provenance code on the output so a downstream consumer can tell a measured value from a guessed one.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="fbc" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Every rung stamps its provenance — a default and a survey must not look alike</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">explicit tag</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">maxspeed=50</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">provenance: 'tagged'</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#fbc)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">implied value</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">maxspeed:type, country</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">provenance: 'implied'</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#fbc)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">class default</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">from the mapping table</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">provenance: 'default'</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#fbc)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">no rung matched</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">value stays null</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">route to review</text>
  <text x="868" y="158" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Downstream, filter on provenance before publishing a statistic. A completeness metric computed over defaulted values measures your mapping table, not the map.</text>
</svg>
<figcaption>The stamp is what makes a fallback chain safe. Without it, a country default and a surveyed value are the same number in the same column, and no downstream query can tell them apart.</figcaption>
</figure>

When fallback logic fails to produce a valid attribute, the pipeline routes the record to a quarantine dataset for manual review. Silent null propagation or arbitrary default assignment introduces analytical bias and breaks downstream topology validation. A robust error-routing strategy logs the original tag payload, the applied fallback sequence, and the failure reason, which makes targeted data-quality audits possible. This quarantine workflow — the per-key inference rules and null policies it depends on — is documented in full by [Handling Missing Tags in OSM Data Pipelines](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/handling-missing-tags-in-osm-data-pipelines/).

```python
from __future__ import annotations

import logging

import polars as pl

logger = logging.getLogger(__name__)


def resolve_attributes_with_fallbacks(
    df: pl.DataFrame,
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Apply priority-ordered fallback chains and split valid/quarantine records."""
    resolved = df.with_columns(
        pl.when(pl.col("road_class").is_not_null())
          .then(pl.col("road_class"))
          .when(pl.col("speed_limit_kmh") > 80)
          .then(pl.lit("arterial"))
          .when(
              pl.col("lanes").cast(pl.Int8, strict=False).is_not_null()
              & (pl.col("lanes").cast(pl.Int8, strict=False) >= 3)
          )
          .then(pl.lit("collector"))
          .otherwise(pl.lit(None))
          .alias("final_road_class")
    )

    valid_mask = resolved["final_road_class"].is_not_null()
    valid_df = resolved.filter(valid_mask)
    quarantine_df = resolved.filter(~valid_mask).select([
        "osm_id", "highway", "maxspeed", "lanes",
        pl.lit("missing_primary_and_fallback_failed").alias("quarantine_reason"),
    ])

    logger.info(
        "resolved %d valid, %d quarantined",
        valid_df.height, quarantine_df.height,
    )
    return valid_df, quarantine_df
```

The order of the `when` branches *is* the policy: an explicit `road_class` always wins, a high speed limit is the next-strongest signal, and lane count is the weakest. Quarantine rows deliberately retain the raw `highway`, `maxspeed`, and `lanes` columns rather than only an ID, so a reviewer can diagnose the failure without re-joining against the source extract.

## Validation & error-handling matrix

A mapping stage is only trustworthy if it names the ways it can fail and how each is caught. The matrix below is the minimum set of conditions a production mapper should detect before any feature is committed.

| Error condition | Root cause | Detection method | Remediation |
|---|---|---|---|
| Unmapped source value | Regional variant absent from registry (`primary_link`) | `replace_strict` yields `None` for `road_class` | Add alias to registry; bump `version`; fallback covers interim runs |
| Wrong-unit speed | Unanchored regex matched `"50 mph"` | Anchored pattern returns `null` instead | Send to value-cleaning stage; never map raw unit strings here |
| `polars.exceptions.InvalidOperationError` | `replace_strict` hit a value with no default set | Exception at chunk apply | Always pass `default=` to `replace_strict` |
| Schema drift between chunks | Sparse chunk missing an optional column | `if col in df.columns` guard skips silently | Assert mandatory columns up front; log skipped optionals |
| Silent null propagation | `replace` used instead of `replace_strict` | Null-rate assertion exceeds threshold | Switch to strict replacement with explicit default |
| Fallback non-determinism | Branch order depends on dict iteration | Diff outputs across two identical runs | Express chain as ordered `when/then`, never a Python loop |
| Quarantine overflow | Registry stale after large import | Quarantine row count spikes per batch | Audit recent changesets; refresh aliases; re-run touched features |

## Performance & scale considerations

The dominant cost in mapping is not the lookups themselves but how the data is laid out when they run. Three figures govern throughput. First, registry maps should be applied as a single `with_columns` call so Polars fuses the expressions into one pass over the chunk rather than materializing an intermediate frame per rule. Second, chunk size trades memory against scheduling overhead: chunks of roughly 1–5 million rows keep the Arrow buffers in cache-friendly ranges while amortizing the fixed cost of expression compilation. Third, casting `surface_type` and `road_class` to Polars `Categorical` after mapping shrinks memory by an order of magnitude on high-cardinality extracts and accelerates the downstream `group_by` that harmonization and validation perform.

The quarantine split itself is cheap — a single boolean mask filter — but writing two output partitions doubles I/O, so batch the quarantine writes and use ZSTD-compressed Parquet to keep the dead-letter partition small. When the binding constraint is memory rather than CPU, prefer the streaming generators in [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) over widening parallelism, because each additional worker holds its own copy of the in-flight chunk.

## Failure modes and gotchas

- **`replace` instead of `replace_strict` silently passes unmapped values through.** The non-strict variant leaves an input untouched when no key matches, so `primary_link` survives as itself and pollutes the typed column. Always use the strict form with an explicit `default`.
- **Unanchored speed regex fabricates units.** Without `^` and `$`, the pattern extracts `50` from `50 mph` and treats it as km/h. Anchor the pattern and route unit-bearing strings back to the cleaning stage.
- **Overwriting the source column destroys traceability.** Mapping `highway` in place leaves no way to reverse-engineer a contributor-feedback report. Always emit a new target column and keep the original.
- **Fallback chains expressed as Python loops break determinism and throughput.** A row-wise loop both crawls and risks order-dependent results across workers. Encode the priority as an ordered `when/then` expression.
- **Forgetting to stamp the registry version makes regressions unfixable.** Without the `version` in output metadata, you cannot tell which registry produced a bad batch. Stamp it on every artifact.
- **Categorical casting before mapping, not after, wastes the optimization.** Cast to `Categorical` once values are canonical; casting raw high-variance strings first just rebuilds the dictionary after every replacement.

## Cross-region harmonization and integration points

Regional tagging conventions diverge significantly, so harmonization layers must normalize synonyms while preserving semantic intent. Cross-region mapping has to account for historical practice — `tertiary_link` versus `unclassified`, or `cycleway:left` versus `cycleway:both` — and standardizing these variations before graph construction prevents edge-weight miscalculations and traversal-constraint violations. Harmonization should maintain bidirectional traceability so analysts can reverse-engineer a standardized attribute back to its original OSM tag for contributor feedback or quality reporting, which is exactly why the source columns are preserved rather than overwritten.

Once normalized, attributes feed directly into network topology generation. Properly mapped attributes ensure accurate speed profiles, turn restrictions, and accessibility flags, which is essential when applying [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/) for routing and spatial analysis. The wiring below shows the handoff: the valid partition is harmonized, cast to compact categoricals, and emitted in the shape the graph stage consumes, while the quarantine partition is written separately for triage shared with [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/).

```python
from __future__ import annotations

import logging
from pathlib import Path

import polars as pl

logger = logging.getLogger(__name__)


def map_chunk_to_graph_inputs(
    df: pl.DataFrame, quarantine_dir: Path,
) -> pl.DataFrame:
    """Map, resolve fallbacks, harmonize, and hand the valid partition to graph prep."""
    mapped = apply_registry_lookups(df)
    valid, quarantine = resolve_attributes_with_fallbacks(mapped)

    if quarantine.height:
        out = quarantine_dir / f"quarantine_{TAG_REGISTRY['version']}.parquet"
        quarantine.write_parquet(out, compression="zstd")
        logger.warning("wrote %d quarantined rows to %s", quarantine.height, out)

    # Compact categoricals accelerate the downstream group_by in graph assembly.
    return valid.with_columns(
        pl.col("final_road_class").cast(pl.Categorical),
        pl.col("surface_type").cast(pl.Categorical),
    )
```

## Emergency scaling and reproducibility guarantees

Emergency scaling strategies demand stateless execution, idempotent writes, and deterministic seeds for any sampling or validation step. When processing a sudden influx of regional updates or planetary diffs, pipelines should lean on columnar compression (ZSTD), partitioned Parquet outputs, and schema validation at ingestion boundaries. Caching intermediate normalized chunks prevents redundant computation during retry cycles, while strict schema enforcement catches upstream parser regressions before they propagate into the analytical store.

Reproducibility is enforced through configuration versioning, deterministic hash-based partitioning, and explicit dependency pinning. Mapping registries should be treated as code artifacts, deployed alongside pipeline binaries through CI/CD, and validation suites must assert attribute cardinality, null thresholds, and cross-field consistency before promoting outputs. Because mapping is a pure function of `(extract version, registry version)`, a retried run is safe and a partial failure resumes from the last committed checkpoint rather than restarting.

## In this section

The guide below goes deeper into the hardest sub-problem of this stage:

- [Handling Missing Tags in OSM Data Pipelines](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/handling-missing-tags-in-osm-data-pipelines/) — per-key default inference, null policies, and the quarantine routing this page emits.

## Frequently Asked Questions

<details>
<summary>Why use a schema registry instead of inline if/else mapping?</summary>

A registry decouples the transformation rules from execution code, so the rules can be version-controlled, diffed, and rolled back independently of the parser. It also lets concurrent workers share one immutable artifact without lock contention, and it gives you a single place to audit when a regional variant gets misclassified. Inline branching scatters the same logic across the codebase and makes a regression impossible to bisect.
</details>

<details>
<summary>When should a value go to quarantine rather than a default?</summary>

Quarantine when no rule and no fallback can resolve the value without guessing — assigning an arbitrary default there fabricates data and biases every downstream aggregate. Use a default only where absence has a genuine, documented meaning (for example a sentinel `"unknown"` surface). The distinction is between "we know the answer is X when unset" and "we cannot know," and only the former justifies a default.
</details>

<details>
<summary>Why replace_strict instead of replace in Polars?</summary>

`replace` leaves unmapped values untouched, so an unknown input like `primary_link` silently survives into the typed column and corrupts it. `replace_strict` with an explicit `default` forces every value into a known state — either a mapped target or a controlled null/sentinel — which is the entire point of this stage. The strict form turns an invisible data defect into a detectable null the fallback chain can act on.
</details>

<details>
<summary>How do I keep cross-region mapping from erasing local meaning?</summary>

Preserve the original tag columns alongside the mapped targets so every standardized value remains traceable back to its source, and apply region-specific override layers before the global merge rather than flattening everything to one vocabulary. Harmonization should normalize representation (synonyms, deprecated keys) while keeping semantically distinct categories distinct, so a regionally significant road class is not collapsed into a coarser global one.
</details>

<details>
<summary>What chunk size should batch mapping use?</summary>

Chunks of roughly 1–5 million rows keep Arrow buffers in cache-friendly ranges while amortizing the fixed cost of expression compilation, and fusing all registry rules into a single `with_columns` call avoids materializing an intermediate frame per rule. When memory rather than CPU is the constraint, narrow the chunk and stream rather than widening parallelism, since each worker holds its own copy of the in-flight chunk.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Map raw OSM tags to typed columns with a versioned registry",
  "description": "Batch attribute mapping procedure: expand tags, apply a versioned schema registry, resolve priority-ordered fallbacks, split valid and quarantine partitions, and stamp provenance.",
  "step": [
    { "@type": "HowToStep", "name": "Expand the tag struct", "text": "Promote the nested tags dictionary into flat columns so vectorized expressions can address them, keeping the original struct for the audit trail." },
    { "@type": "HowToStep", "name": "Apply registry lookups", "text": "Run replace_strict against the versioned registry to produce road_class, surface_type, and speed_limit_kmh so every unmapped value lands in a known state." },
    { "@type": "HowToStep", "name": "Resolve fallbacks", "text": "For rows where the primary class is null, evaluate a priority-ordered when/then chain against speed and lane signals to infer a class without row-wise Python." },
    { "@type": "HowToStep", "name": "Split valid and quarantine", "text": "Partition on whether a final class resolved; valid rows proceed, unresolved rows carry their original payload and a failure reason to a dead-letter Parquet partition." },
    { "@type": "HowToStep", "name": "Stamp provenance", "text": "Record the registry version, source extract URL, and timestamp in output metadata so the result is reproducible and auditable." }
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
      "name": "Why use a schema registry instead of inline if/else mapping?",
      "acceptedAnswer": { "@type": "Answer", "text": "A registry decouples transformation rules from execution code so they can be version-controlled, diffed, and rolled back independently of the parser. It lets concurrent workers share one immutable artifact without lock contention and gives a single place to audit misclassifications. Inline branching scatters the logic and makes a regression impossible to bisect." }
    },
    {
      "@type": "Question",
      "name": "When should a value go to quarantine rather than a default?",
      "acceptedAnswer": { "@type": "Answer", "text": "Quarantine when no rule and no fallback can resolve the value without guessing, because an arbitrary default fabricates data and biases downstream aggregates. Use a default only where absence has a genuine documented meaning, such as a sentinel unknown surface. The distinction is between knowing the answer when unset and being unable to know it." }
    },
    {
      "@type": "Question",
      "name": "Why replace_strict instead of replace in Polars?",
      "acceptedAnswer": { "@type": "Answer", "text": "replace leaves unmapped values untouched, so an unknown input survives into the typed column and corrupts it. replace_strict with an explicit default forces every value into a known state, either a mapped target or a controlled null or sentinel, turning an invisible data defect into a detectable null the fallback chain can act on." }
    },
    {
      "@type": "Question",
      "name": "How do I keep cross-region mapping from erasing local meaning?",
      "acceptedAnswer": { "@type": "Answer", "text": "Preserve the original tag columns alongside the mapped targets so every standardized value remains traceable, and apply region-specific override layers before the global merge rather than flattening to one vocabulary. Harmonization should normalize synonyms and deprecated keys while keeping semantically distinct categories distinct." }
    },
    {
      "@type": "Question",
      "name": "What chunk size should batch mapping use?",
      "acceptedAnswer": { "@type": "Answer", "text": "Chunks of roughly one to five million rows keep Arrow buffers cache-friendly while amortizing expression compilation, and fusing all registry rules into a single with_columns call avoids materializing an intermediate frame per rule. When memory is the constraint, narrow the chunk and stream rather than widening parallelism." }
    }
  ]
}
</script>

## Related

- [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — the anchored cleaning and unit conversion that prepares values before mapping.
- [Handling Missing Tags in OSM Data Pipelines](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/handling-missing-tags-in-osm-data-pipelines/) — default inference and null policy for the quarantine path.
- [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) — concurrent ingestion that emits Arrow tables against this registry.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — streaming and spill-to-disk when memory bounds the mapping stage.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — triaging the records this stage quarantines.
- [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/) — turning the typed, harmonized columns into a routing graph.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — the controlled vocabulary the registry targets.

This guide is part of [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/); return to that overview to follow the data through ingestion, normalization, error triage, and routing-graph conversion.
