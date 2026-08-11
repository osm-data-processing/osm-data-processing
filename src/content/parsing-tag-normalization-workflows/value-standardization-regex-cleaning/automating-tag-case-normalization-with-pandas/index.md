---
title: "Automating Tag Case Normalization with Pandas"
description: "Vectorized, config-driven case normalization for OSM tag columns in pandas: lowercase enums, title-case operators, preserve case-sensitive keys, and stream multi-GB extracts to Parquet under a fixed memory budget."
pageTitle: "Automate OSM Tag Case Normalization in Pandas"
pageDescription: "Normalize OpenStreetMap tag casing at scale with vectorized pandas .str accessors, a YAML rule set, nullable StringDtype, and chunked Parquet output that holds a sub-8 GB footprint."
slug: automating-tag-case-normalization-with-pandas
type: article
breadcrumb: "Tag Case Normalization with Pandas"
datePublished: 2025-09-20
dateModified: 2026-06-26
date: 2026-06-26
---
# Automating tag case normalization with Pandas

Collapse casing variants such as `highway=Residential`, `Building=yes`, and `surface=Asphalt` to their canonical lowercase form across a multi-gigabyte OSM extract in a single vectorized pandas pass — while leaving case-sensitive keys like `ref`, `website`, and `name:en` untouched.

## Prerequisites

Confirm each item before running the code below; a skipped step is the usual reason a "normalized" frame still groups `Asphalt` and `asphalt` as two surfaces.

- [ ] `pandas` ≥ 2.1.0 installed (`pip install "pandas>=2.1"`) — the `.str` accessor behaviour and `StringDtype` semantics below assume the 2.x string backend.
- [ ] `pyyaml` ≥ 6.0 (`pip install "pyyaml>=6.0"`) for loading the declarative rule set.
- [ ] `pyarrow` ≥ 14.0 installed, so categorical columns serialize to dictionary-encoded Parquet.
- [ ] A tag-bearing DataFrame already extracted from PBF — produced upstream by [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) — with one column per tag key.
- [ ] A `tag_normalization_rules.yaml` file (template below) co-located with the script.
- [ ] Python 3.10+ for the `dict[str, str]` and structural typing used here.
- [ ] Optional: `psutil` if you want the adaptive chunk-resizing guard shown at the end.

## Conceptual minimum

OpenStreetMap stores attributes as a free-form key-value map on every element, and nothing in the format enforces a casing convention — so the same real-world value arrives as `Asphalt`, `ASPHALT`, and `asphalt` from three different editors. Casing must therefore be resolved per key, not globally, because the correct strategy depends on what the key *means*: enumerated values defined in [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) (`highway`, `surface`, `amenity`) are conventionally lowercase, whereas `ref` route numbers (`A1`, `M25`), `website` URLs, and `name:*` labels are case-sensitive and must be preserved verbatim. A blanket `.str.lower()` corrupts exactly the fields downstream joins and routing engines depend on.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 278" role="img" aria-labelledby="case-ops-t case-ops-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="case-ops-t">Four case operations and what each one does to non-ASCII text</title>
  <desc id="case-ops-d">A grid of four case operations against their effect on a German street name and on a Turkish place name. lower() lowercases the German name correctly but produces a dotless i for the Turkish one under a Turkish locale. upper() expands the German sharp s into a double S, changing the string length. casefold() handles both correctly for comparison purposes but is not a display form. And title() capitalises after every non-letter, breaking names containing apostrophes or hyphens.</desc>
  <rect x="0" y="0" width="880" height="278" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Case operations are for comparison keys, not for display values</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">German: "Straße"</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Turkish: "İzmir"</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">.lower()</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">straße — correct</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">i̇zmir / izmir by locale</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">.upper()</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">STRASSE — length changes</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">İZMIR — correct</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">.casefold()</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">strasse — comparison-safe</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">i̇zmir — comparison-safe</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">.title()</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">O'Brien → O'brien</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">İzmir — correct here</text>
  <text x="868" y="260" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Store the raw value, derive a casefolded key beside it, and join on the key. Displaying the folded form is how a dataset loses every proper noun it had.</text>
</svg>
<figcaption>Only casefold is safe for comparison, and none of the four is safe for display. Normalise a comparison key and leave the display value alone.</figcaption>
</figure>

This page is the dataframe-side counterpart to the streaming rewrite in [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/): it operates after parsing has already widened tags into columns, and it produces case-resolved strings that the registry lookups in [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/) can then match exactly. Two requirements govern the implementation. First, the transform must be **vectorized** — pandas `.str` accessors push iteration below the Python interpreter, so a row-wise `.apply()` is the difference between minutes and hours on a continental extract. Second, it must be **declarative**: the key→strategy mapping lives in YAML, version-controlled and editable without touching code, so adding a new lowercase key never risks an accidental mutation of a case-sensitive one.

<svg viewBox="0 0 980 360" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Per-column case-normalization data flow. A wide OSM tag DataFrame, one column per key, feeds a per-column router driven by the tag_normalization_rules.yaml file. The router dispatches each column to one of four strategy lanes: lowercase for highway, surface and amenity; titlecase for operator; regex_clean (strip, collapse whitespace, lower) for description; and a preserve lane for ref, name:en and website that bypasses all mutation. The lowercase and regex_clean lanes are downcast to category dtype, and every lane converges to dictionary-encoded Parquet chunks." style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Vectorized per-column tag case-normalization data flow</title>
  <desc>A wide tag DataFrame feeds a YAML-driven router that splits columns into lowercase, titlecase, regex_clean and a mutation-free preserve lane, then converges to category-dtype, dictionary-encoded Parquet chunks.</desc>
  <defs>
    <marker id="tcnArrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="980" height="360" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <g fill="currentColor" text-anchor="middle">
    <!-- YAML rule set -->
    <rect x="196" y="20" width="178" height="48" rx="6" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
    <text x="285" y="40" font-size="12">tag_normalization_</text>
    <text x="285" y="56" font-size="12">rules.yaml</text>
    <line x1="285" y1="68" x2="285" y2="138" stroke="currentColor" stroke-width="1.5" marker-end="url(#tcnArrow)"/>
    <text x="312" y="106" font-size="10" text-anchor="start" opacity="0.75">drives</text>
    <!-- wide tag DataFrame -->
    <rect x="24" y="116" width="150" height="216" rx="6" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
    <text x="99" y="138" font-size="12.5">tag DataFrame</text>
    <text x="99" y="153" font-size="10" opacity="0.75">wide · 1 col / key</text>
    <line x1="34" y1="162" x2="164" y2="162" stroke="currentColor" stroke-width="1" opacity="0.35"/>
    <g font-size="11" opacity="0.9">
      <text x="99" y="182">highway</text>
      <text x="99" y="202">surface</text>
      <text x="99" y="222">operator</text>
      <text x="99" y="242">description</text>
      <text x="99" y="262">ref</text>
      <text x="99" y="282">name:en</text>
      <text x="99" y="302">website</text>
    </g>
    <text x="99" y="322" font-size="9" opacity="0.7">astype("string")</text>
    <!-- per-column router -->
    <rect x="208" y="138" width="120" height="184" rx="6" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
    <text x="268" y="220" font-size="12.5">per-column</text>
    <text x="268" y="236" font-size="12.5">router</text>
    <text x="268" y="254" font-size="9.5" opacity="0.75">key → strategy</text>
    <line x1="174" y1="230" x2="206" y2="230" stroke="currentColor" stroke-width="1.5" marker-end="url(#tcnArrow)"/>
    <!-- router output bus -->
    <line x1="328" y1="230" x2="352" y2="230" stroke="currentColor" stroke-width="1.5"/>
    <line x1="352" y1="62" x2="352" y2="304" stroke="currentColor" stroke-width="1.5"/>
    <!-- four strategy lanes -->
    <!-- lowercase -->
    <line x1="352" y1="62" x2="394" y2="62" stroke="currentColor" stroke-width="1.5" marker-end="url(#tcnArrow)"/>
    <rect x="396" y="36" width="262" height="52" rx="6" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
    <text x="412" y="60" font-size="12.5" text-anchor="start">lowercase</text>
    <text x="412" y="77" font-size="9.5" text-anchor="start" opacity="0.78">.str.lower() — highway · surface · amenity</text>
    <!-- titlecase -->
    <line x1="352" y1="142" x2="394" y2="142" stroke="currentColor" stroke-width="1.5" marker-end="url(#tcnArrow)"/>
    <rect x="396" y="116" width="262" height="52" rx="6" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
    <text x="412" y="140" font-size="12.5" text-anchor="start">titlecase</text>
    <text x="412" y="157" font-size="9.5" text-anchor="start" opacity="0.78">.str.title() — operator</text>
    <!-- regex_clean -->
    <line x1="352" y1="222" x2="394" y2="222" stroke="currentColor" stroke-width="1.5" marker-end="url(#tcnArrow)"/>
    <rect x="396" y="196" width="262" height="52" rx="6" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
    <text x="412" y="220" font-size="12.5" text-anchor="start">regex_clean</text>
    <text x="412" y="237" font-size="9.5" text-anchor="start" opacity="0.78">strip · collapse ws · lower — description</text>
    <!-- preserve (dashed = bypasses mutation) -->
    <line x1="352" y1="302" x2="394" y2="302" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#tcnArrow)"/>
    <rect x="396" y="276" width="262" height="52" rx="6" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3"/>
    <text x="412" y="300" font-size="12.5" text-anchor="start">preserve</text>
    <text x="412" y="317" font-size="9.5" text-anchor="start" opacity="0.78">no mutation — ref · name:en · website</text>
    <!-- category downcast tags on mutating enum lanes -->
    <text x="700" y="56" font-size="9" opacity="0.7">→ category</text>
    <text x="700" y="216" font-size="9" opacity="0.7">→ category</text>
    <!-- convergence bus to Parquet output -->
    <line x1="658" y1="62" x2="772" y2="62" stroke="currentColor" stroke-width="1.5"/>
    <line x1="658" y1="142" x2="772" y2="142" stroke="currentColor" stroke-width="1.5"/>
    <line x1="658" y1="222" x2="772" y2="222" stroke="currentColor" stroke-width="1.5"/>
    <line x1="658" y1="302" x2="772" y2="302" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3"/>
    <line x1="772" y1="62" x2="772" y2="302" stroke="currentColor" stroke-width="1.5"/>
    <line x1="772" y1="182" x2="820" y2="182" stroke="currentColor" stroke-width="1.5" marker-end="url(#tcnArrow)"/>
    <!-- Parquet output -->
    <rect x="822" y="138" width="134" height="92" rx="6" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
    <text x="889" y="166" font-size="11.5">dictionary-</text>
    <text x="889" y="183" font-size="11.5">encoded</text>
    <text x="889" y="200" font-size="11.5">Parquet</text>
    <text x="889" y="218" font-size="9.5" opacity="0.75">chunked write</text>
  </g>
</svg>

## Runnable solution

This module loads a YAML rule set, applies the correct casing strategy to each named column using vectorized string operations and boolean masking, and downcasts high-cardinality columns to `category` before returning. It targets `pandas>=2.1.0`, `pyyaml>=6.0`, and Python 3.10+.

```python
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

import pandas as pd
import yaml

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.tag_case_normalizer")

# Enforce Copy-on-Write semantics (default in pandas 3.0; opt-in for 2.x).
pd.options.mode.copy_on_write = True

# Load the declarative rule set once at module import.
CONFIG_PATH = Path("tag_normalization_rules.yaml")
NORM_RULES: dict[str, Any] = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))

# Precompiled patterns for the regex_clean strategy.
WHITESPACE_RE = re.compile(r"\s+")

# Keys that must never be lowercased regardless of the rule file, as a safety net.
PRESERVE_GUARD = re.compile(r"^(name(:[a-z]{2,3})?|int_name|ref|website|wikidata|source)$")


def normalize_osm_tags(df: pd.DataFrame) -> pd.DataFrame:
    """Vectorized, per-column case normalization for OSM tag columns.

    Each rule names a strategy: ``lowercase``, ``titlecase``, ``regex_clean``,
    or ``preserve``. Only columns listed in the rule set are touched, so
    geometry and metadata columns pass through untouched.
    """
    df = df.copy()
    rules: dict[str, str] = NORM_RULES.get("rules", {})
    target_cols = [c for c in rules if c in df.columns]
    if not target_cols:
        logger.warning("no rule columns present in frame; nothing to normalize")
        return df

    # Nullable string dtype avoids object-array memory bloat and keeps <NA> distinct from "".
    df[target_cols] = df[target_cols].astype("string")

    for col, strategy in rules.items():
        if col not in df.columns:
            continue
        if strategy == "lowercase" and PRESERVE_GUARD.match(col):
            logger.error("refusing to lowercase case-sensitive key %r; treating as preserve", col)
            continue

        mask = df[col].notna()
        if not mask.any():
            continue

        if strategy == "lowercase":
            df.loc[mask, col] = df.loc[mask, col].str.lower()
        elif strategy == "titlecase":
            df.loc[mask, col] = df.loc[mask, col].str.title()
        elif strategy == "regex_clean":
            df.loc[mask, col] = (
                df.loc[mask, col]
                .str.strip()
                .str.replace(WHITESPACE_RE, " ", regex=True)
                .str.lower()
            )
        elif strategy == "preserve":
            continue
        else:
            logger.warning("unknown strategy %r for column %r; skipping", strategy, col)

    # Downcast low-entropy enums to category for a 60-85% memory reduction.
    for col in target_cols:
        if NORM_RULES.get("rules", {}).get(col) in {"lowercase", "regex_clean"}:
            df[col] = df[col].astype("category")

    return df


def stream_normalize(src: Path, dst: Path, chunksize: int = 500_000) -> None:
    """Normalize an extract chunk-by-chunk and append to a single Parquet file."""
    import pyarrow as pa
    import pyarrow.parquet as pq

    writer: pq.ParquetWriter | None = None
    rows = 0
    try:
        for chunk in pd.read_parquet(src, dtype_backend="pyarrow").pipe(
            lambda d: (d.iloc[i:i + chunksize] for i in range(0, len(d), chunksize))
        ):
            out = normalize_osm_tags(chunk)
            table = pa.Table.from_pandas(out, preserve_index=False)
            if writer is None:
                writer = pq.ParquetWriter(dst, table.schema, use_dictionary=True)
            writer.write_table(table)
            rows += len(out)
            logger.info("normalized %d rows (cumulative)", rows)
    finally:
        if writer is not None:
            writer.close()  # flush the final row group


if __name__ == "__main__":
    stream_normalize(Path("tags-raw.parquet"), Path("tags-normalized.parquet"))
```

An example `tag_normalization_rules.yaml` that matches the pipeline:

```yaml
rules:
  highway: lowercase
  surface: lowercase
  building: lowercase
  amenity: lowercase
  oneway: lowercase
  operator: titlecase
  description: regex_clean
  name: preserve        # Free-text label; never alter case
  ref: preserve         # Route references stay upper-case ("A1", "M25")
  website: preserve     # URLs are case-sensitive on many servers
  "name:en": preserve
```

## Step-by-step walkthrough

1. **Copy-on-Write up front** — `pd.options.mode.copy_on_write = True` makes the `.loc[mask, col] = ...` writes predictable across pandas 2.x and 3.0, eliminating `SettingWithCopyWarning` and the silent no-op assignments it warns about.
2. **Rules load once** — the YAML is read at import, so the key→strategy map is a single source of truth that edits without redeploying logic. `target_cols` intersects the rule keys with the frame's actual columns, so geometry and metadata never get mutated.
3. **Nullable `StringDtype`** — casting target columns to `"string"` keeps `<NA>` distinct from the empty string and avoids the per-object overhead of the default object dtype, which matters across millions of rows.
4. **Boolean masking, not `apply`** — `mask = df[col].notna()` restricts each vectorized `.str` call to non-null cells, so `.str.lower()` / `.str.title()` run in C rather than row-by-row in Python.
5. **The preserve guard** — `PRESERVE_GUARD` is a defence-in-depth check: even if a rule file mistakenly assigns `lowercase` to `ref` or a `name:*` key, the code refuses and logs an error instead of corrupting case-sensitive data.
6. **`regex_clean` composition** — strip, collapse internal whitespace to a single space via the precompiled `WHITESPACE_RE`, then lowercase, all chained on the `.str` accessor so the intermediate Series are never materialized as Python lists.
7. **Categorical downcast** — only the lowercase/regex_clean enums (low cardinality after normalization) are cast to `category`, cutting memory 60-85% depending on tag entropy and feeding dictionary-encoded Parquet.
8. **Chunked streaming** — `stream_normalize` slices the source into `chunksize` row windows and appends each normalized chunk through a single `ParquetWriter`, so peak memory tracks one chunk rather than the whole planet. This is the same memory discipline detailed in [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/).

## Verification

Confirm the normalization is correct before handing the frame downstream:

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="case-verify-t case-verify-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="case-verify-t">Assertions that a case-normalisation pass is safe to re-run</title>
  <desc id="case-verify-d">A left-to-right chain of four assertions. The folded key column must be idempotent under a second fold. The count of distinct raw values must be greater than or equal to the count of distinct folded values, never less, which would mean the fold introduced variation. Every raw value must still be present unchanged in its own column. And a reverse lookup from a folded key to its raw values must return every original spelling, so nothing was merged away silently.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="cvf" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four assertions that keep the fold a key rather than a rewrite</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">fold is idempotent</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">fold(fold(x)) == fold(x)</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">or it is not a key</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cvf)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">distinct(raw) ≥ distinct(key)</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">never fewer</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">folding cannot add variety</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cvf)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">raw column unchanged</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">byte-for-byte</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">nothing overwritten</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cvf)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">key → all raw spellings</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">reverse lookup</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">nothing merged away</text>
  <text x="868" y="158" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Keep the reverse lookup as a materialised view. It is the answer to "which spellings ended up in this bucket", which is the first question asked of any normalisation.</text>
</svg>
<figcaption>The last assertion is what turns a lossy-looking operation into a reversible one: the fold is a key, and the raw values it groups are all still there to inspect.</figcaption>
</figure>

- **Count the distinct surfaces.** `df["surface"].nunique()` should drop after normalization; if `Asphalt` and `asphalt` still both appear, the rule for `surface` did not load.
- **Prove preservation.** Assert that `df.loc[df["ref"].notna(), "ref"].str.isupper().any()` is still `True` — upper-case route refs must survive.
- **Check the log line.** A `refusing to lowercase case-sensitive key` error means a rule file mistakenly targeted a protected key; fix the YAML, not the data.
- **Confirm dtype.** `df["highway"].dtype` should report `category`, and `df["name"].dtype` should remain `string`.
- **Round-trip Parquet.** Re-read `tags-normalized.parquet` and run the normalizer again — output must be byte-identical, proving the transform is idempotent.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| `ref` values lowercased to `a1` | Rule file set `ref: lowercase` | Set `ref: preserve`; the guard also blocks this and logs it. |
| `SettingWithCopyWarning` | Copy-on-Write disabled on pandas 2.x | Add `pd.options.mode.copy_on_write = True` before edits. |
| `AttributeError: Can only use .str accessor with string values` | Column still object/float dtype | Cast targets with `.astype("string")` before `.str` calls. |
| `<NA>` became the literal string `"<NA>"` | Lowercasing applied without the `notna()` mask | Restrict every assignment to `df.loc[mask, col]`. |
| Memory climbs to OOM on a planet file | Whole frame read before normalizing | Use `stream_normalize`; process one `chunksize` window at a time. |
| Categorical column rejected by Parquet | Mixed `<NA>` and category on old pyarrow | Upgrade `pyarrow>=14` or downcast after, not before, write. |
| `oneway` graph edges flipped | Casing of `Yes`/`-1` not normalized before graph build | Lowercase `oneway` here, before [OSMnx graph conversion](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/). |

For extracts dirty enough that casing is the least of the problems, hand malformed rows to the quarantine path in [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) before this stage rather than letting `.astype("string")` raise.

## Specification reference

> OpenStreetMap tag values are free-form UTF-8 strings with no enforced casing; canonical lowercase enumeration is a community convention documented per key on the OSM Wiki — see [Map features](https://wiki.openstreetmap.org/wiki/Map_features) for the expected values and [Key:ref](https://wiki.openstreetmap.org/wiki/Key:ref) for why reference values keep their original case. For the exact semantics of the patterns used in `regex_clean`, consult the official [Python `re` documentation](https://docs.python.org/3/library/re.html).

## Related

- [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — the parent stage covering whitespace, control-character, and vocabulary cleaning this casing pass complements.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — the canonical key-value reference that decides which keys are lowercase enums versus case-sensitive.
- [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/) — exact-match registry lookups that assume case-resolved input.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — the chunk-and-stream discipline behind `stream_normalize`.
- [Best Practices for OSM Tag Standardization Across Regions](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/best-practices-for-osm-tag-standardization-across-regions/) — a streaming pyosmium approach to the same casing variance.
- [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/) — the routing stage that breaks on un-normalized `oneway` and `maxspeed` casing.

Up one level: [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Automating Tag Case Normalization with Pandas",
  "description": "Vectorized, config-driven case normalization for OSM tag columns in pandas: lowercase enums, title-case operators, preserve case-sensitive keys, and stream multi-GB extracts to Parquet under a fixed memory budget.",
  "datePublished": "2025-09-20",
  "dateModified": "2026-06-26",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["OpenStreetMap tag casing", "pandas vectorized normalization", "ETL value standardization"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Parsing & Tag Normalization Workflows", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/" },
    { "@type": "ListItem", "position": 3, "name": "Value Standardization & Regex Cleaning", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/" },
    { "@type": "ListItem", "position": 4, "name": "Automating Tag Case Normalization with Pandas", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/automating-tag-case-normalization-with-pandas/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Automate OSM tag case normalization with pandas",
  "description": "Vectorized, YAML-driven procedure that resolves tag casing per column, preserves case-sensitive keys, downcasts enums to category, and streams a multi-GB extract to dictionary-encoded Parquet.",
  "step": [
    { "@type": "HowToStep", "name": "Declare per-key strategies in YAML", "text": "Map each tag key to lowercase, titlecase, regex_clean, or preserve so case-sensitive keys like ref and name:en are never altered." },
    { "@type": "HowToStep", "name": "Cast targets to nullable string dtype", "text": "Convert rule columns to StringDtype so the .str accessor works and <NA> stays distinct from the empty string." },
    { "@type": "HowToStep", "name": "Apply vectorized casing per column", "text": "Use a notna() boolean mask plus .str.lower, .str.title, or a precompiled regex chain to transform each column in C rather than row-wise." },
    { "@type": "HowToStep", "name": "Downcast enums to category", "text": "Convert low-cardinality lowercase columns to category dtype to cut memory 60-85% and enable dictionary-encoded Parquet." },
    { "@type": "HowToStep", "name": "Stream chunks to Parquet", "text": "Slice the source into chunksize windows and append each normalized chunk through one ParquetWriter, holding only one chunk in memory." }
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
      "name": "Why not just call str.lower() on the whole DataFrame?",
      "acceptedAnswer": { "@type": "Answer", "text": "Casing must be resolved per key. Enumerated values like highway and surface are conventionally lowercase, but ref route numbers, website URLs, and name:* labels are case-sensitive. A blanket lowercase corrupts exactly the fields downstream joins and routing engines depend on, so a per-column rule set is required." }
    },
    {
      "@type": "Question",
      "name": "How do I keep proper nouns and route references from being lowercased?",
      "acceptedAnswer": { "@type": "Answer", "text": "Mark those keys as preserve in the YAML rule set. The code also includes a regex guard that refuses to lowercase keys matching name, int_name, ref, website, wikidata, or source and logs an error instead of mutating them." }
    },
    {
      "@type": "Question",
      "name": "Why use vectorized .str accessors instead of apply()?",
      "acceptedAnswer": { "@type": "Answer", "text": "Pandas .str methods push iteration below the Python interpreter into C, while a row-wise apply() evaluates a Python callable per row. On a continental extract of millions of rows that difference is minutes versus hours, so vectorization is mandatory for ETL throughput." }
    },
    {
      "@type": "Question",
      "name": "How do I normalize an extract larger than RAM?",
      "acceptedAnswer": { "@type": "Answer", "text": "Process the file in chunks. Slice the source into fixed-size row windows, normalize each one, and append it through a single ParquetWriter so peak memory tracks one chunk rather than the whole dataset, keeping a sub-8 GB footprint on standard runners." }
    },
    {
      "@type": "Question",
      "name": "Why convert columns to category dtype after normalizing?",
      "acceptedAnswer": { "@type": "Answer", "text": "Once casing variants collapse to canonical forms, columns like highway and surface have very low cardinality. Casting them to category cuts memory 60-85% and lets pyarrow write dictionary-encoded Parquet, which preserves that efficiency on disk and on re-read." }
    }
  ]
}
</script>
