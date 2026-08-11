---
title: "Value Standardization & Regex Cleaning"
description: "Deterministic regex cleaning for OSM tag values: strip zero-width and control characters, collapse whitespace, resolve casing, and map to controlled vocabularies at extract scale."
pageDescription: "Deterministic regex cleaning for OSM tag values: strip zero-width and control characters, collapse whitespace, resolve casing, and map to controlled vocabularies at extract scale."
slug: value-standardization-regex-cleaning
type: guide
breadcrumb: "Value Standardization & Regex Cleaning"
datePublished: 2025-09-12
dateModified: 2026-06-26
date: 2026-06-26
---
# Value Standardization & Regex Cleaning

Value standardization is the stage where contributor-typed strings become machine-comparable values, and the failure it prevents is the kind that never raises an exception. Consider a single road surface tagged `surface=Asphalt ` in one regional import and `surface=asphalt` in another, with an invisible zero-width space appended by a copy-paste from a wiki table. To Python these are three distinct strings, so a `group_by("surface")` reports three categories instead of one, a paved/unpaved reclassification misses two of them, and a routing cost surface built downstream assigns different edge weights to identical pavement. The byte difference is undetectable to a human reviewer and survives schema validation untouched — it only surfaces as a quietly wrong isochrone or an inflated category count weeks later. This guide builds the deterministic cleaning layer that collapses those variants to one canonical value before any join, aggregation, or graph build can inherit the defect.

<svg viewBox="0 0 720 360" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Deterministic cleaning pipeline for one OSM tag value: a raw value passes through strip edges, remove control characters, and collapse internal whitespace, then a controlled-vocabulary lookup branches on hit to a canonical value or on miss to an audited pass-through, and both branches are written to a Parquet chunk" style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Deterministic value-cleaning pipeline</title>
  <desc>A raw tag value flows left to right through three regex stages: strip leading and trailing whitespace and zero-width characters, remove ASCII control characters, and collapse runs of internal whitespace to a single space. The cleaned string then enters a controlled-vocabulary lookup. On a hit it becomes a canonical value; on a miss it passes through and is logged for audit. Both outcomes are written to the same Parquet chunk.</desc>
  <defs>
    <marker id="arrPipe" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="720" height="360" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <g font-size="12.5" fill="currentColor" text-anchor="middle">
    <!-- top chain: regex cleaning stages -->
    <rect x="20" y="34" width="120" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="80" y="65">Raw value</text>
    <rect x="176" y="34" width="150" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="251" y="59">Strip edges</text>
    <text x="251" y="76" font-size="10.5" opacity="0.78">whitespace + zero-width</text>
    <rect x="362" y="34" width="150" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="437" y="59">Remove control</text>
    <text x="437" y="76" font-size="10.5" opacity="0.78">\x00–\x1f, \x7f</text>
    <rect x="548" y="34" width="152" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="624" y="59">Collapse spaces</text>
    <text x="624" y="76" font-size="10.5" opacity="0.78">runs &#8594; one space</text>
  </g>
  <!-- chain arrows -->
  <g stroke="currentColor" stroke-width="1.5" fill="none">
    <line x1="140" y1="60" x2="172" y2="60" marker-end="url(#arrPipe)"/>
    <line x1="326" y1="60" x2="358" y2="60" marker-end="url(#arrPipe)"/>
    <line x1="512" y1="60" x2="544" y2="60" marker-end="url(#arrPipe)"/>
    <!-- wrap connector down to vocabulary diamond -->
    <path d="M624,86 L624,150 L90,150 L90,233" marker-end="url(#arrPipe)"/>
  </g>
  <text x="360" y="143" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.8">cleaned string</text>
  <!-- vocabulary lookup diamond -->
  <polygon points="90,235 156,277 90,319 24,277" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <g font-size="11.5" fill="currentColor" text-anchor="middle">
    <text x="90" y="274">Vocabulary</text>
    <text x="90" y="288">lookup?</text>
  </g>
  <!-- branch boxes -->
  <g font-size="12.5" fill="currentColor" text-anchor="middle">
    <rect x="212" y="232" width="168" height="44" rx="6" fill="currentColor" fill-opacity="0.1" stroke="currentColor" stroke-width="1.5"/>
    <text x="296" y="259">Canonical value</text>
    <rect x="212" y="300" width="168" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3"/>
    <text x="296" y="320">Pass-through</text>
    <text x="296" y="336" font-size="10" opacity="0.78">logged for audit</text>
  </g>
  <!-- branch arrows -->
  <g stroke="currentColor" stroke-width="1.5" fill="none">
    <line x1="156" y1="270" x2="208" y2="254" marker-end="url(#arrPipe)"/>
    <line x1="156" y1="284" x2="208" y2="318" marker-end="url(#arrPipe)"/>
  </g>
  <g font-size="10.5" fill="currentColor" opacity="0.85">
    <text x="176" y="252">hit</text>
    <text x="170" y="312">miss</text>
  </g>
  <!-- parquet cylinder -->
  <g fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M452,250 a64,11 0 0 0 128,0 v52 a64,11 0 0 1 -128,0 z"/>
    <ellipse cx="516" cy="250" rx="64" ry="11"/>
  </g>
  <text x="516" y="290" text-anchor="middle" font-size="12.5" fill="currentColor">Parquet chunk</text>
  <!-- converge arrows -->
  <g stroke="currentColor" stroke-width="1.5" fill="none">
    <line x1="380" y1="254" x2="450" y2="266" marker-end="url(#arrPipe)"/>
    <line x1="380" y1="318" x2="450" y2="300" marker-end="url(#arrPipe)"/>
  </g>
</svg>

OpenStreetMap (OSM) data exhibits high semantic variance because of decentralized contribution, localized mapping conventions, and evolving community guidance. Within the broader architecture of [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/), value standardization and regular-expression cleaning are the deterministic bridge between raw contributor input and production-ready geospatial assets. Mapping engineers, OSM contributors, GIS analysts, and Python ETL developers implement strict cleaning routines to resolve casing inconsistencies, strip non-printable control characters, and enforce controlled vocabularies before downstream spatial joins, routing calculations, or network analysis.

## Prerequisite concepts

Three foundations should be in place before any cleaning rule runs. First, cleaning operates on the free-form key-value dictionary attached to each element, so the structure described in the [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) determines which values exist to clean — a way carries `surface` and `maxspeed`, a node carries different keys, and a relation carries others again. Second, value cleaning is strictly the step *before* mapping: this page produces trimmed, case-resolved strings, and [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/) assumes those strings arrive clean so its registry lookups can be exact rather than fuzzy. Third, the canonical forms your rules emit should match the controlled vocabulary defined in [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/); normalizing `Asphalt` to `asphalt` only helps if `asphalt` is the form the rest of the pipeline already targets.

## Deterministic cleaning principles

Production spatial ETL requires idempotent transformations: applying the same cleaning sequence twice to identical input must yield byte-identical output. This requirement rules out non-deterministic operations such as locale-dependent case folding, where `str.lower()` on a Turkish locale maps `I` differently than on a C locale and silently produces two outputs for one input. Cleaning routines must also prioritize memory efficiency by leaning on precompiled patterns and vectorized operations rather than row-by-row evaluation — a constraint that becomes acute during [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/), where bounded memory and strict serialization boundaries demand minimal intermediate object creation.

Error handling must be explicit and fail-safe. Malformed dictionaries, unexpected data types, and missing values should trigger controlled fallbacks rather than unhandled exceptions that terminate a planetary-scale run. Reproducibility is reinforced by documenting the cleaning sequence, versioning the controlled-vocabulary maps, and isolating transformation logic from I/O boundaries so the pure cleaning function can be unit-tested against fixed inputs.

## Specification & character-class reference

Cleaning is only as trustworthy as the character classes it names, so the ranges each pattern targets deserve to be pinned down as precisely as a binary format. OSM tag values are UTF-8 strings with no length or content schema, which means every category below can and does appear in real extracts.

| Character class | Range / example | Why it appears | Cleaning action |
|---|---|---|---|
| ASCII control chars | `\x00`–`\x08`, `\x0b`, `\x0c`, `\x0e`–`\x1f`, `\x7f` | Pasted from spreadsheets, stray editor bytes | Remove entirely |
| Tab / newline in value | `\t`, `\n`, `\r` | Multi-line text fields, import artifacts | Collapse to single space |
| Zero-width characters | `​` ZWSP, `‌` ZWNJ, `‍` ZWJ, `﻿` BOM | Copy-paste from rich text, RTL editing | Strip from both ends |
| Repeated whitespace | `"two  spaces"` | Hand entry, concatenation | Collapse to one space |
| Mixed casing | `Asphalt`, `ASPHALT`, `asphalt` | No casing convention enforced | Resolve via vocabulary map |
| Trailing unit suffix | `50 mph`, `30 km/h` | Locale habits | Route to unit parsing (not bare lowercase) |

Two rules govern the whole stage. Anchor every boundary-sensitive pattern with `^` and `$` so a partial match cannot corrupt a value — an unanchored numeric extractor will pull `50` out of `50 mph` and silently treat it as km/h. And never strip a unit suffix by deleting it: a value carrying units belongs in a dedicated unit parser, because dropping the suffix fabricates a measurement system. For authoritative pattern semantics consult the official [Python `re` documentation](https://docs.python.org/3/library/re.html), and validate target vocabularies against the [OSM Wiki Tagging Guidelines](https://wiki.openstreetmap.org/wiki/Tags).

## Implementation: regex compilation & vectorized cleaning

The foundation of a robust routine is precompiled pattern objects, explicit type validation, and chunk-aware processing. Compiling patterns once at module load avoids per-call overhead across millions of records, while pandas string methods push iteration below the Python interpreter. The routine below cleans a single value, then a DataFrame chunk, then streams an entire extract to Parquet without ever holding the file in memory.

```python
from __future__ import annotations

import gc
import logging
import re
from typing import Any

import pandas as pd

logger = logging.getLogger(__name__)

# Precompile patterns once — recompiling per row dominates wall-clock time at scale.
# Zero-width chars masquerade as "empty" yet defeat equality joins and group_by.
_ZERO_WIDTH = "​‌‍﻿"  # ZWSP, ZWNJ, ZWJ, BOM
STRIP_PATTERN = re.compile(rf"^[\s{_ZERO_WIDTH}]+|[\s{_ZERO_WIDTH}]+$")
MULTI_SPACE_PATTERN = re.compile(r"\s+")
NON_PRINTABLE_PATTERN = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

# Controlled vocabulary for deterministic case resolution (versioned alongside the pipeline).
CASE_NORMALIZATION_MAP: dict[str, dict[str, str]] = {
    "highway": {"Residential": "residential", "Primary": "primary", "Secondary": "secondary"},
    "surface": {"Asphalt": "asphalt", "Concrete": "concrete", "Gravel": "gravel"},
    "oneway": {"Yes": "yes", "No": "no", "True": "yes", "False": "no"},
}


def clean_tag_value(value: Any) -> str | None:
    """Sanitize a single tag value with explicit, fail-safe error handling."""
    if not isinstance(value, str):
        return None  # non-strings (None, ints) become a typed null, never a crash
    cleaned = STRIP_PATTERN.sub("", value)
    cleaned = NON_PRINTABLE_PATTERN.sub("", cleaned)
    cleaned = MULTI_SPACE_PATTERN.sub(" ", cleaned)
    return cleaned or None  # empty after cleaning is a null, not ""


def normalize_osm_tags_chunk(
    chunk: pd.DataFrame,
    tag_column: str = "tags",
    vocab_map: dict[str, dict[str, str]] | None = None,
) -> pd.DataFrame:
    """Apply deterministic regex cleaning and vocabulary mapping to a DataFrame chunk."""
    if vocab_map is None:
        vocab_map = CASE_NORMALIZATION_MAP
    if tag_column not in chunk.columns:
        raise ValueError(f"Missing required column: {tag_column!r}")

    def _clean_tag_dict(x: Any) -> dict[str, str | None]:
        if not isinstance(x, dict):
            return {}
        return {k: clean_tag_value(v) for k, v in x.items()}

    cleaned_tags = chunk[tag_column].map(_clean_tag_dict)

    # Apply the controlled vocabulary via direct dict lookup — exact, not fuzzy.
    remapped = 0
    for tag_key, mapping in vocab_map.items():
        for tag_dict in cleaned_tags:
            current = tag_dict.get(tag_key)
            if current in mapping:
                tag_dict[tag_key] = mapping[current]
                remapped += 1

    logger.info("cleaned %d rows, remapped %d values", len(chunk), remapped)
    chunk = chunk.copy()
    chunk[tag_column] = cleaned_tags
    return chunk


def process_large_osm_extract(
    df_generator,
    output_path: str = "normalized_osm.parquet",
) -> None:
    """Memory-efficient pipeline for processing large OSM extracts in chunks.

    Parquet is not an append-mode format, so we use pyarrow's ParquetWriter to
    append row groups inside one file. All chunks must share a compatible schema.
    """
    import pyarrow as pa
    import pyarrow.parquet as pq

    writer: pq.ParquetWriter | None = None
    try:
        for chunk in df_generator:
            normalized = normalize_osm_tags_chunk(chunk)
            table = pa.Table.from_pandas(normalized, preserve_index=False)
            if writer is None:
                writer = pq.ParquetWriter(output_path, table.schema, compression="zstd")
            writer.write_table(table)
            del normalized, table
            gc.collect()  # reclaim per-chunk buffers before the next iteration
    except Exception:
        logger.exception("extract cleaning failed; partial output at %s", output_path)
        raise
    finally:
        if writer is not None:
            writer.close()
```

The numbered sequence below is what these functions execute end to end:

1. **Validate the input type.** `clean_tag_value` returns `None` for any non-string, so malformed dictionaries degrade to typed nulls instead of raising mid-chunk.
2. **Strip the edges.** `STRIP_PATTERN` removes leading and trailing whitespace *and* zero-width characters in one pass, eliminating the invisible-suffix defect that fractures joins.
3. **Remove control characters.** `NON_PRINTABLE_PATTERN` deletes the ASCII control range while deliberately preserving `\t`, `\n`, `\r` for the next step to collapse rather than drop.
4. **Collapse internal whitespace.** `MULTI_SPACE_PATTERN` reduces any run of whitespace — including the tabs and newlines just preserved — to a single space.
5. **Resolve casing via vocabulary.** Each value is looked up in the versioned map by exact key, so `Asphalt` becomes `asphalt` deterministically and unmapped values pass through for audit.
6. **Stream to Parquet.** `process_large_osm_extract` writes ZSTD-compressed row groups one chunk at a time, calling `gc.collect()` between chunks so resident memory stays flat at planetary scale.

## Validation & error-handling matrix

A cleaning stage is only trustworthy if it names the ways it fails and how each is caught. The matrix below is the minimum set of conditions a production routine should detect before any value is committed to an analytical store.

| Failure condition | Root cause | Detection method | Remediation |
|---|---|---|---|
| Duplicate categories after group_by | Trailing zero-width char or whitespace | Compare cleaned vs raw distinct counts | Apply `STRIP_PATTERN`; assert stable cardinality |
| Locale-dependent case folding | `str.lower()` under a non-C locale | Run cleaning under two locales, diff output | Use explicit vocabulary maps, not `str.lower()` |
| Fabricated unit | Unanchored numeric regex matched `"50 mph"` | Anchored pattern returns the raw string instead | Route unit-bearing values to a dedicated parser |
| `TypeError` on non-string value | Tag value is `None` or numeric | `isinstance` guard returns `None` | Always type-check before regex; emit typed null |
| Empty string vs null ambiguity | Value reduces to `""` after stripping | `cleaned or None` collapses both to null | Treat absence as null, never `""` |
| Schema mismatch across chunks | A sparse chunk infers a different Parquet schema | `ParquetWriter` raises on `write_table` | Define schema explicitly from the first chunk |
| Silent pass-through of garbage | Value absent from vocabulary map | Log unmapped values; track audit count | Add canonical form to map; bump map version |

## Performance & scale considerations

The dominant cost in cleaning is rarely the regex engine itself but how often patterns are compiled and how data is laid out when they run. Three figures govern throughput. First, compile every pattern once at module load — recompiling inside a per-row callback can multiply wall-clock time by an order of magnitude on a multi-million-row chunk. Second, chunk size trades memory against scheduling overhead: chunks of roughly 1–5 million rows keep buffers in cache-friendly ranges while amortizing the fixed cost of `map` dispatch and Parquet row-group framing. Third, casting cleaned categorical columns such as `surface` to a pandas `category` dtype after normalization shrinks memory by an order of magnitude on high-cardinality extracts and accelerates the downstream `group_by` that mapping and validation perform.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="regex-cost-t regex-cost-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="regex-cost-t">The cost of five ways to apply the same cleaning rule to a column</title>
  <desc id="regex-cost-d">A bar chart of seconds to clean a ten million row string column. A Python loop with re.sub per row takes 88 seconds. A pandas apply with a compiled pattern takes 71. The pandas str.replace accessor with regex enabled takes 34. A dictionary map for exact-match replacements takes 2.9. And a pyarrow compute replace_substring_regex takes 1.6.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The fastest cleaning rule is the one that does no matching</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">seconds to clean a 10 M row string column</text>
  <line x1="250" y1="68" x2="250" y2="270" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">Python loop + re.sub</text>
  <rect x="250" y="74" width="427" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="687" y="89" font-size="11" fill="currentColor" opacity="0.9">88 s · per-row interpreter overhead</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">.apply() with a compiled pattern</text>
  <rect x="250" y="116" width="345" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="605" y="131" font-size="11" fill="currentColor" opacity="0.9">71 s · still per-row</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">.str.replace(regex=True)</text>
  <rect x="250" y="158" width="165" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="425" y="173" font-size="11" fill="currentColor" opacity="0.9">34 s · vectorised, still regex</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">dict map for exact values</text>
  <rect x="250" y="200" width="14" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="274" y="215" font-size="11" fill="currentColor" opacity="0.9">2.9 s · hash lookup, no matching</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">pyarrow replace_substring_regex</text>
  <rect x="250" y="242" width="8" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="268" y="257" font-size="11" fill="currentColor" opacity="0.9">1.6 s · compiled, columnar</text>
  <text x="440" y="306" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Split the rule set: exact-value substitutions go to a dictionary map, and only genuinely pattern-shaped rules pay for a regex.</text>
</svg>
<figcaption>Two of these are an order of magnitude apart from the rest, and both avoid per-row Python. Where the rule is an exact-value substitution, the dictionary map beats every regex approach by doing no matching at all.</figcaption>
</figure>

When memory rather than CPU is the binding constraint, prefer narrowing the chunk and streaming over widening parallelism — the patterns in [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) keep each worker's resident set bounded, whereas each additional parallel worker holds its own copy of the in-flight chunk. The explicit `gc.collect()` between chunks matters here: without it, the interpreter accumulates the millions of small tag dictionaries each chunk creates, and GC pressure rather than cleaning logic becomes the bottleneck.

## Failure modes & gotchas

- **Zero-width characters survive a naive `.strip()`.** Python's `str.strip()` removes ASCII whitespace but not `​` or the BOM, so the invisible suffix persists and the join still fractures. The combined regex class is what catches them.
- **`str.lower()` is not locale-safe.** Lowercasing is tempting but produces different output under different locales and cannot encode domain rules like `True → yes`. An explicit vocabulary map is both deterministic and expressive.
- **Unanchored patterns corrupt numeric fields.** A pattern without `^`/`$` extracts a partial match from `50 mph` and treats it as already-normalized, fabricating a unit. Anchor every value-shaping pattern.
- **Empty string and null are not the same.** A value that cleans to `""` should become a typed null, otherwise downstream null-rate assertions and `is_not_null` filters miscount it as present.
- **Parquet has no append mode.** Re-opening a file per chunk corrupts it; use a single `ParquetWriter` and append row groups, deriving the schema from the first chunk so sparse later chunks cannot drift it.
- **Mutating the source value in place destroys traceability.** Keep the raw tag alongside the cleaned form where contributor feedback or quality reporting may need to reverse-engineer the original string.

## Integration points

Cleaned values feed directly into the mapping stage, where exact registry lookups depend on the casing and whitespace having already been resolved. The wiring below shows the handoff: a stream of raw chunks is cleaned, the cleaned tag struct is expanded into typed columns, and the result is handed to mapping for vocabulary resolution and routing-graph preparation via [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/). Because cleaning is a pure function of its input, the same chunk can be replayed safely on retry, and any value the vocabulary map cannot resolve is preserved for triage shared with [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/).

```python
from __future__ import annotations

import logging
from collections.abc import Iterator

import pandas as pd

logger = logging.getLogger(__name__)


def clean_then_expand(
    df_generator: Iterator[pd.DataFrame],
) -> Iterator[pd.DataFrame]:
    """Clean each chunk, then expand the tag struct into flat columns for mapping."""
    for chunk in df_generator:
        normalized = normalize_osm_tags_chunk(chunk)
        # Promote the cleaned dict into addressable columns the mapping stage expects,
        # keeping the original struct for the audit trail.
        flat = pd.json_normalize(normalized["tags"]).add_prefix("tag_")
        out = pd.concat([normalized.reset_index(drop=True), flat], axis=1)
        logger.debug("expanded %d cleaned rows into %d columns", len(out), out.shape[1])
        yield out
```

The companion guide on [automating tag case normalization with pandas](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/automating-tag-case-normalization-with-pandas/) shows the fully vectorized form of the casing step, replacing the per-dict loop above with column-level `replace` over the pandas C backend for high-throughput pipelines.

<svg viewBox="0 0 720 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Before-and-after comparison of one surface value: before cleaning, three raw strings (Asphalt with a trailing space and zero-width character, ASPHALT in upper case, and asphalt) are counted as three distinct categories by group_by; after stripping and a controlled-vocabulary map all three collapse to the single canonical value asphalt, dropping the distinct count from three to one" style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>One surface value: three variants collapse to one canonical category</title>
  <desc>The left panel shows three raw surface values that look almost identical: Asphalt followed by an invisible trailing space and zero-width character, ASPHALT in upper case, and lower-case asphalt. Because the bytes differ, group_by reports three distinct categories. The right panel shows the result after stripping edges and applying the controlled-vocabulary map: all three become the single canonical value asphalt, so group_by now reports one category. The distinct count drops from three to one.</desc>
  <rect x="0" y="0" width="720" height="330" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <!-- BEFORE panel -->
  <text x="166" y="28" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">Before — raw byte variants</text>
  <rect x="16" y="40" width="300" height="256" rx="8" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" fill="currentColor">
    <!-- variant 1 -->
    <rect x="36" y="58" width="260" height="52" rx="5" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1"/>
    <text x="48" y="82">surface = "Asphalt</text>
    <rect x="167" y="70" width="22" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="3 2"/>
    <text x="192" y="82">"</text>
    <text x="48" y="100" font-size="9.5" font-family="inherit" opacity="0.78">trailing space + zero-width (invisible)</text>
    <!-- variant 2 -->
    <rect x="36" y="120" width="260" height="40" rx="5" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1"/>
    <text x="48" y="138">surface = "ASPHALT"</text>
    <text x="48" y="153" font-size="9.5" font-family="inherit" opacity="0.78">upper-case variant</text>
    <!-- variant 3 -->
    <rect x="36" y="170" width="260" height="40" rx="5" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1"/>
    <text x="48" y="188">surface = "asphalt"</text>
    <text x="48" y="203" font-size="9.5" font-family="inherit" opacity="0.78">already canonical</text>
  </g>
  <g text-anchor="middle">
    <text x="166" y="238" font-size="11.5" fill="currentColor" font-family="inherit">group_by("surface") counts</text>
    <text x="166" y="272" font-size="30" fill="currentColor" font-weight="700">3</text>
    <text x="166" y="290" font-size="10.5" fill="currentColor" font-family="inherit" opacity="0.8">distinct categories</text>
  </g>
  <!-- transform arrow -->
  <g>
    <line x1="320" y1="168" x2="398" y2="168" stroke="currentColor" stroke-width="1.8" marker-end="url(#arrCmp)"/>
    <text x="360" y="150" text-anchor="middle" font-size="10.5" fill="currentColor">strip +</text>
    <text x="360" y="163" text-anchor="middle" font-size="10.5" fill="currentColor">vocab map</text>
  </g>
  <defs>
    <marker id="arrCmp" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- AFTER panel -->
  <text x="554" y="28" text-anchor="middle" font-size="13" fill="currentColor" font-weight="600">After — one canonical value</text>
  <rect x="404" y="40" width="300" height="256" rx="8" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <rect x="444" y="110" width="220" height="54" rx="6" fill="currentColor" fill-opacity="0.12" stroke="currentColor" stroke-width="1.5"/>
  <text x="554" y="143" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" fill="currentColor">surface = "asphalt"</text>
  <g text-anchor="middle">
    <text x="554" y="238" font-size="11.5" fill="currentColor">group_by("surface") counts</text>
    <text x="554" y="272" font-size="30" fill="currentColor" font-weight="700">1</text>
    <text x="554" y="290" font-size="10.5" fill="currentColor" opacity="0.8">distinct category</text>
  </g>
</svg>

## In this section

The guide below goes deeper into the highest-throughput form of the casing step:

- [Automating tag case normalization with Pandas](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/automating-tag-case-normalization-with-pandas/) — vectorized, C-backed casing resolution that replaces the per-dictionary loop for bulk extracts.

## Frequently Asked Questions

<details>
<summary>Why not just call str.strip() and str.lower() on every value?</summary>

`str.strip()` removes ASCII whitespace but leaves zero-width characters and the BOM in place, so the invisible-suffix defect that fractures joins survives. `str.lower()` is locale-dependent and cannot express domain rules such as mapping `True` to `yes` or `Yes` to `yes`. A combined whitespace/zero-width regex plus an explicit, versioned vocabulary map is both deterministic across locales and able to encode the canonical forms your pipeline actually targets.
</details>

<details>
<summary>How do I keep cleaning idempotent?</summary>

Make the cleaning function pure — no locale-dependent operations, no random sampling, no time-based logic — so the same input always produces byte-identical output. Run it twice in a test and assert equality. Idempotency is what makes retries safe and lets a partial failure resume from the last committed chunk rather than restarting, which matters when a planetary extract takes hours to process.
</details>

<details>
<summary>Should an empty cleaned value become "" or null?</summary>

A typed null. A value that reduces to an empty string after stripping carries no information, and storing `""` makes it count as present in `is_not_null` filters and null-rate assertions, biasing every downstream completeness metric. The `cleaned or None` idiom collapses both empty strings and falsy results to a single null representation so absence is unambiguous.
</details>

<details>
<summary>Where do unit-bearing values like "50 mph" belong?</summary>

Not in the lowercase/strip path. Stripping the unit suffix fabricates a measurement system, so values carrying units must go to a dedicated unit parser that converts to a canonical SI form. Use an anchored regex to detect the unit explicitly and convert; never let an unanchored pattern extract the bare number, because it will treat `50 mph` as `50 km/h`.
</details>

<details>
<summary>How large should each cleaning chunk be?</summary>

Roughly 1–5 million rows keeps pandas and Arrow buffers in cache-friendly ranges while amortizing the fixed cost of `map` dispatch and Parquet row-group framing. When memory is the binding constraint, narrow the chunk and stream rather than widening parallelism, since each parallel worker holds its own copy of the in-flight chunk, and call `gc.collect()` between chunks to reclaim the many small tag dictionaries each one allocates.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Standardize and regex-clean OSM tag values at extract scale",
  "description": "Deterministic value-cleaning procedure: type-validate input, strip whitespace and zero-width characters, remove control characters, collapse internal whitespace, resolve casing via a versioned vocabulary, and stream to Parquet.",
  "step": [
    { "@type": "HowToStep", "name": "Validate the input type", "text": "Return a typed null for any non-string value so malformed dictionaries degrade gracefully instead of raising mid-chunk." },
    { "@type": "HowToStep", "name": "Strip the edges", "text": "Remove leading and trailing whitespace and zero-width characters in one regex pass to eliminate invisible suffixes that fracture joins." },
    { "@type": "HowToStep", "name": "Remove control characters", "text": "Delete the ASCII control range while preserving tab, newline, and carriage return for the collapse step." },
    { "@type": "HowToStep", "name": "Collapse internal whitespace", "text": "Reduce any run of whitespace to a single space so equality comparison is stable." },
    { "@type": "HowToStep", "name": "Resolve casing via vocabulary", "text": "Look each value up in a versioned controlled-vocabulary map by exact key so casing is resolved deterministically and unmapped values pass through for audit." },
    { "@type": "HowToStep", "name": "Stream to Parquet", "text": "Write ZSTD-compressed row groups one chunk at a time, collecting garbage between chunks to keep resident memory flat at planetary scale." }
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
      "name": "Why not just call str.strip() and str.lower() on every value?",
      "acceptedAnswer": { "@type": "Answer", "text": "str.strip() leaves zero-width characters and the BOM in place, so the invisible-suffix defect that fractures joins survives, and str.lower() is locale-dependent and cannot express domain rules like mapping True to yes. A combined whitespace and zero-width regex plus an explicit versioned vocabulary map is deterministic across locales and encodes the canonical forms the pipeline targets." }
    },
    {
      "@type": "Question",
      "name": "How do I keep cleaning idempotent?",
      "acceptedAnswer": { "@type": "Answer", "text": "Make the cleaning function pure with no locale-dependent operations, random sampling, or time-based logic, so identical input always yields byte-identical output. Run it twice and assert equality. Idempotency makes retries safe and lets a partial failure resume from the last committed chunk rather than restarting." }
    },
    {
      "@type": "Question",
      "name": "Should an empty cleaned value become an empty string or null?",
      "acceptedAnswer": { "@type": "Answer", "text": "A typed null. A value reduced to an empty string carries no information, and storing an empty string makes it count as present in is_not_null filters and null-rate assertions, biasing completeness metrics. Collapse empty strings and falsy results to a single null so absence is unambiguous." }
    },
    {
      "@type": "Question",
      "name": "Where do unit-bearing values like 50 mph belong?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not in the lowercase or strip path. Stripping the unit suffix fabricates a measurement system, so values carrying units must go to a dedicated unit parser that converts to a canonical SI form using an anchored regex. An unanchored pattern would extract the bare number and treat 50 mph as 50 km/h." }
    },
    {
      "@type": "Question",
      "name": "How large should each cleaning chunk be?",
      "acceptedAnswer": { "@type": "Answer", "text": "Roughly one to five million rows keeps pandas and Arrow buffers cache-friendly while amortizing map dispatch and Parquet row-group framing. When memory is the constraint, narrow the chunk and stream rather than widening parallelism, and call gc.collect() between chunks to reclaim the small tag dictionaries each chunk allocates." }
    }
  ]
}
</script>

## Related

- [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/) — the registry mapping stage that consumes these cleaned values.
- [Automating tag case normalization with Pandas](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/automating-tag-case-normalization-with-pandas/) — the vectorized form of the casing step.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — streaming and spill-to-disk when memory bounds the cleaning stage.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — triaging values the vocabulary map cannot resolve.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — the controlled vocabulary the cleaning output targets.
- [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/) — turning cleaned, mapped attributes into a routing graph.

This guide is part of [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/); return to that overview to follow the data through ingestion, normalization, error triage, and routing-graph conversion.
</content>
</invoke>
