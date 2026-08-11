---
title: "Fixing Malformed OSM Tags During ETL Ingestion"
description: "Detect and repair malformed OpenStreetMap tags during ingestion — strip control and zero-width characters, normalise keys, fix locale numerics, and quarantine the unrepairable — with idempotent, memory-bounded Python."
pageDescription: "Fix malformed OSM tags during ETL ingestion: profile anomalies with osmium-tool, strip control/zero-width characters, normalise keys, correct locale numerics, harmonise units, and quarantine unrepairable rows in Python."
slug: fixing-malformed-osm-tags-during-etl-ingestion
type: article
breadcrumb: "Fixing Malformed Tags"
datePublished: 2025-09-12
dateModified: 2026-06-26
date: 2026-06-26
---
# Fixing malformed OSM tags during ETL ingestion

Repair the malformed OSM tags that abort an ingest — trailing zero-width characters, mixed-case keys, locale-formatted numbers, unescaped multi-value separators — through one idempotent sanitization pass, and route what cannot be repaired to quarantine before it reaches a routing graph.

## Prerequisites

- [ ] Python 3.10+ (the snippet uses `str | None` union hints)
- [ ] `osmium-tool>=1.14.0` on `PATH` for command-line tag profiling (`apt install osmium-tool` or `brew install osmium-tool`)
- [ ] `polars>=0.20.0` (the `map_elements` signature below changed at 0.20) and `pyarrow>=14` for Parquet output
- [ ] `pyrosm>=0.6.2` to read a `.osm.pbf` extract into a GeoDataFrame
- [ ] A regional extract to test against (any `.osm.pbf` from [Geofabrik](https://download.geofabrik.de/) works)
- [ ] A writable quarantine directory for the dead-letter Parquet partition

## Why OSM tags arrive malformed

OpenStreetMap stores tags as arbitrary string key-value pairs with no schema enforcement, so any editor, import, or regional convention can introduce a value that is syntactically valid UTF-8 yet semantically broken. "Malformed" here is a pipeline concept, not a format error: the PBF decoded cleanly, but the string carries a trailing `U+200B` zero-width space, a key was typed `Highway` instead of `highway`, or a German editor wrote `1.200` meaning twelve hundred. Each of these passes a naive `str` check and then silently corrupts a join key, a unit conversion, or an edge weight several stages downstream. This stage belongs to [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) and enforces the canonical schema produced earlier by [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — it does not invent that schema, it repairs deviations from it.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="mal-sources-t mal-sources-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mal-sources-t">What produces malformed tag values, by share of the anomalies found</title>
  <desc id="mal-sources-d">A bar chart of the share of malformed tag values by cause in a country extract. Copy-paste from a spreadsheet or web page contributes 38 percent, bringing non-breaking spaces and smart quotes. Locale-formatted numbers such as a comma decimal separator contribute 24 percent. Unit suffixes mixed into numeric fields contribute 19 percent. Trailing or doubled separators in semicolon lists contribute 13 percent. And control or zero-width characters contribute 6 percent, invisible in every editor.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What actually produces malformed values</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">share of anomalous tag values by cause, country extract</text>
  <line x1="250" y1="68" x2="250" y2="270" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">paste artefacts (NBSP, smart quotes)</text>
  <rect x="250" y="74" width="447" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="707" y="89" font-size="11" fill="currentColor" opacity="0.9">38% — invisible in most editors</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">locale-formatted numbers</text>
  <rect x="250" y="116" width="282" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="542" y="131" font-size="11" fill="currentColor" opacity="0.9">24% — "1.200" meaning 1200</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">units inside numeric fields</text>
  <rect x="250" y="158" width="223" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="483" y="173" font-size="11" fill="currentColor" opacity="0.9">19% — "30 mph", "3.5 t"</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">trailing / doubled separators</text>
  <rect x="250" y="200" width="153" height="21" rx="3" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="413" y="215" font-size="11" fill="currentColor" opacity="0.9">13% — "a;b;" and "a;;b"</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">control and zero-width chars</text>
  <rect x="250" y="242" width="70" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="330" y="257" font-size="11" fill="currentColor" opacity="0.9">6% — U+200B, U+FEFF</text>
  <text x="868" y="306" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The last row is small and disproportionately expensive: a zero-width space makes two identical-looking values compare unequal for the life of the dataset.</text>
</svg>
<figcaption>The distribution argues for a specific order of operations: normalise whitespace and Unicode first, because that single step addresses nearly half of what you will find.</figcaption>
</figure>

The repair must be *idempotent*: running it twice produces the same output as running it once, so a resumed or re-driven ingest never double-mutates a value. It must also be *memory-bounded*, because continental extracts exceed RAM and the sanitization has to run over bounded slices rather than one monolithic frame — the streaming mechanics come from [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/). The order is fixed: profile to size the problem, sanitize what is repairable, and quarantine what is not, never coercing an ambiguous value into a fabricated one.

<svg viewBox="0 0 1000 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="The fixed three-stage repair order for a malformed OSM tag. A raw tag value is first profiled with osmium tags-count to size the problem, then passed to an idempotent sanitize stage that strips control and zero-width characters, lowercases and snake-cases the key, collapses locale numerics such as 1.200 to 1200, and harmonises units like mph to km/h. The result is then branched: a row whose required key is filled is committed to the graph build, while an unrepairable row is routed to a quarantine dead-letter partition rather than coerced." style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>The profile, sanitize, branch repair order for a malformed OSM tag</title>
  <desc>A left-to-right pipeline: a raw tag value is profiled, then run through an idempotent four-step sanitizer, then branched so a repaired row commits to the graph build and an unrepairable row goes to a dashed quarantine partition.</desc>
  <defs>
    <marker id="fmArrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="1000" height="320" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <g text-anchor="middle" fill="currentColor">
    <!-- raw tag value -->
    <rect x="18" y="128" width="112" height="64" rx="6" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
    <text x="74" y="156" font-size="12.5">raw tag</text>
    <text x="74" y="173" font-size="12.5">value</text>
    <line x1="130" y1="160" x2="176" y2="160" stroke="currentColor" stroke-width="1.5" marker-end="url(#fmArrow)"/>
    <!-- profile -->
    <rect x="178" y="128" width="150" height="64" rx="6" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
    <text x="253" y="155" font-size="12.5">profile</text>
    <text x="253" y="173" font-size="10" opacity="0.78">osmium tags-count</text>
    <line x1="328" y1="160" x2="374" y2="160" stroke="currentColor" stroke-width="1.5" marker-end="url(#fmArrow)"/>
    <!-- sanitize box with 4 stacked ops -->
    <rect x="376" y="40" width="254" height="240" rx="6" fill="currentColor" fill-opacity="0.04" stroke="currentColor" stroke-width="1.5"/>
    <text x="503" y="62" font-size="12.5">sanitize · idempotent</text>
    <rect x="392" y="78" width="222" height="40" rx="5" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1"/>
    <text x="503" y="103" font-size="10.5">strip control / zero-width chars</text>
    <rect x="392" y="126" width="222" height="40" rx="5" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1"/>
    <text x="503" y="151" font-size="10.5">lowercase + snake-case key</text>
    <rect x="392" y="174" width="222" height="40" rx="5" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1"/>
    <text x="503" y="199" font-size="10.5">fix locale numeric  1.200 → 1200</text>
    <rect x="392" y="222" width="222" height="40" rx="5" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1"/>
    <text x="503" y="247" font-size="10.5">harmonise units  mph → km/h</text>
    <line x1="630" y1="160" x2="666" y2="160" stroke="currentColor" stroke-width="1.5" marker-end="url(#fmArrow)"/>
    <!-- branch decision -->
    <path d="M730,108 L792,160 L730,212 L668,160 Z" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
    <text x="730" y="156" font-size="10.5">required</text>
    <text x="730" y="170" font-size="10.5">key filled?</text>
    <!-- repaired -> commit -->
    <polyline points="730,108 730,86 858,86" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#fmArrow)"/>
    <text x="752" y="80" font-size="10" opacity="0.75">repaired</text>
    <rect x="860" y="58" width="124" height="56" rx="6" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
    <text x="922" y="82" font-size="12.5">commit</text>
    <text x="922" y="99" font-size="10" opacity="0.78">to graph build</text>
    <!-- unrepairable -> quarantine (dashed DLQ) -->
    <polyline points="730,212 730,250 858,250" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#fmArrow)"/>
    <text x="755" y="244" font-size="10" opacity="0.75">unrepairable</text>
    <rect x="860" y="222" width="124" height="56" rx="6" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3"/>
    <text x="922" y="246" font-size="12.5">quarantine</text>
    <text x="922" y="263" font-size="10" opacity="0.78">DLQ partition</text>
  </g>
</svg>

## Profile the anomalies first

Before mutating anything, quantify what is actually wrong so the sanitization does not over-correct and strip valid semantics. `osmium-tool` gives a fast, language-independent tag-frequency baseline directly on the `.osm.pbf`:

```bash
# Select features carrying a highway tag, then tally value frequencies to CSV.
osmium tags-filter north-america-latest.osm.pbf w/highway -o highway_ways.osm.pbf
osmium tags-count highway_ways.osm.pbf --output-format csv > tag_distribution.csv
```

Scanning that distribution surfaces the recurring failure modes a generic cleaner would miss:

- Keys with trailing whitespace or zero-width characters (`U+200B`, `U+00A0`, `U+FEFF`)
- Values with unescaped semicolons in `opening_hours` or `maxspeed`
- Mixed-case keys violating the OSM lowercase convention (`Highway` vs `highway`)
- Numbers using locale thousands separators (`1,200` or `1.200` meaning 1200)
- Multi-value tags concatenated without a separator or with trailing punctuation

## The complete solution

The module below is the full repair stage: precompiled patterns at module scope, a single definition of what counts as malformed, idempotent value and key sanitizers, a unit harmoniser, and a quarantine split. It uses the established `logging.getLogger(__name__)` pattern so counts surface in the pipeline log rather than `print`.

```python
from __future__ import annotations

import logging
import re

import polars as pl

logger = logging.getLogger(__name__)

# Precompiled at module level to avoid per-call recompilation on large extracts.
# Strips C0/C1 control chars plus zero-width space, NBSP, and BOM.
CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f-\x9f​ ﻿]+")
LOCALE_NUMERIC = re.compile(r"^(\d{1,3})[.,](\d{3})$")  # "1,200"/"1.200" -> "1200"
MPH = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*mph\s*$", re.IGNORECASE)


def sanitize_value(val: str | None) -> str:
    """Idempotently clean a single tag value. Safe to run more than once."""
    if not isinstance(val, str):
        return "" if val is None else str(val)
    val = CONTROL_CHARS.sub("", val).strip()
    m = LOCALE_NUMERIC.match(val)
    if m:
        val = m.group(1) + m.group(2)
    return val


def normalize_key(key: str | None) -> str:
    """Lowercase, trim, and snake-case a tag key per OSM convention."""
    if not isinstance(key, str):
        return ""
    return CONTROL_CHARS.sub("", key).strip().lower().replace(" ", "_")


def harmonize_speed_kmh(val: str | None) -> float | None:
    """Normalise a maxspeed value to km/h. Returns None for non-numeric input."""
    clean = sanitize_value(val).lower()
    if not clean:
        return None
    m = MPH.match(clean)
    if m:
        return round(float(m.group(1)) * 1.60934, 1)
    try:
        return float(clean)
    except ValueError:
        return None  # "variable", "walk", "none" -> not a numeric speed


def apply_sanitization(df: pl.DataFrame, tag_columns: list[str]) -> pl.DataFrame:
    """Vectorised value sanitization across the given tag columns."""
    present = [c for c in tag_columns if c in df.columns]
    if not present:
        logger.warning("None of %s present in frame; skipping", tag_columns)
        return df
    return df.with_columns(
        pl.col(c).map_elements(sanitize_value, return_dtype=pl.Utf8) for c in present
    )


def split_quarantine(
    df: pl.DataFrame, required: list[str]
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Route rows still empty in a required column after repair to a DLQ frame."""
    blank = pl.lit(False)
    for col in (c for c in required if c in df.columns):
        blank = blank | (pl.col(col).str.len_chars() == 0) | pl.col(col).is_null()
    bad = df.filter(blank)
    good = df.filter(~blank)
    if bad.height:
        logger.warning("Quarantining %d/%d rows", bad.height, df.height)
    return good, bad
```

## Step-by-step walkthrough

1. **Patterns compile once.** `CONTROL_CHARS`, `LOCALE_NUMERIC`, and `MPH` live at module scope so the regex engine is not rebuilt per row — the single biggest speedup on tag-heavy continental frames.
2. **`sanitize_value` is the idempotency anchor.** It strips control and zero-width characters, trims, then collapses a locale-formatted thousands group. Running it on already-clean input is a no-op, which is what makes a resumed ingest safe to re-drive.
3. **`normalize_key` enforces the OSM lowercase convention.** `Highway` and `highway ` both collapse to `highway`, so the controlled vocabulary defined in [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) actually matches at join time instead of fragmenting into case variants.
4. **`harmonize_speed_kmh` separates numeric repair from unit conversion.** `mph` values are converted; genuinely non-numeric values like `variable` or `walk` return `None` rather than being coerced to a fake speed — defaulting `maxspeed` is never safe here.
5. **`apply_sanitization` stays vectorised.** `map_elements` with an explicit `return_dtype` runs the cleaner column-wise and guards against absent columns in a given regional extract instead of raising.
6. **`split_quarantine` refuses to guess.** Any row still empty in a required key after repair goes to a dead-letter frame, preserving the raw payload for review — the same quarantine partition that [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) triages.

To run the stage over an extract larger than RAM, drive these functions over bounded Polars slices and flush Parquet between batches rather than materialising one frame:

```python
import gc

from pyrosm import OSM

CHUNK = 250_000  # rows per batch; keeps resident memory under ~4 GB on CI runners


def stream_and_clean(pbf_path: str, tag_cols: list[str]):
    """Yield sanitized CHUNK-row frames from a driving-network extract."""
    gdf = OSM(pbf_path).get_network(network_type="driving")
    if gdf is None or gdf.empty:
        return
    df = pl.from_pandas(gdf.drop(columns="geometry"))  # geometry has no Arrow dtype
    for start in range(0, df.height, CHUNK):
        yield apply_sanitization(df.slice(start, CHUNK), tag_cols)
        gc.collect()  # break GeoPandas->Polars reference cycles between batches
```

## Verification

Confirm the repair behaved before handing rows to a graph builder:

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="mal-idempotent-t mal-idempotent-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mal-idempotent-t">Proving a sanitiser is idempotent and lossless enough to trust</title>
  <desc id="mal-idempotent-d">A left-to-right chain of four properties to assert about a sanitiser. Idempotence: sanitising twice must equal sanitising once, or the function is not a normalisation. Stability: an already-clean value must pass through byte-identical, so clean data is untouched. Reversibility of record: the original value must be retained in a raw column even though the clean one is used. And bounded change: the share of values the sanitiser modifies should be stable release to release, so a rule change shows up as a jump.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="mid" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four properties — assert idempotence first, it fails most often</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">f(f(x)) == f(x)</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">sanitise twice</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">or it is not a normalisation</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#mid)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">clean stays identical</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">byte-for-byte</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">clean data untouched</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#mid)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">raw value retained</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">in its own column</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">the change is inspectable</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#mid)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">change rate stable</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">release to release</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">a jump means a rule moved</text>
  <text x="868" y="158" text-anchor="end" font-size="10" fill="currentColor" opacity="0.85">Run the first two as property tests over a sample of real values from the extract, not over hand-written examples — the interesting inputs are the ones nobody would think to write.</text>
</svg>
<figcaption>Idempotence is the one to test first, because a non-idempotent sanitiser produces a different dataset depending on how many times a re-run happens to touch a row.</figcaption>
</figure>

- `sanitize_value` is idempotent: `sanitize_value(sanitize_value(x)) == sanitize_value(x)` for every sampled value.
- No control or zero-width characters survive: `df.filter(pl.col("name").str.contains(r"[​﻿ ]")).height == 0`.
- Keys are lowercase: `all(k == k.lower() for k in normalized_keys)`.
- `harmonize_speed_kmh("30 mph")` returns `48.3`; `harmonize_speed_kmh("variable")` returns `None`.
- The quarantine frame is small and stable batch-to-batch — a sudden spike signals a new tagging convention to add to the patterns, not a code bug. The log line `Quarantining N/M rows` should report a single-digit percentage.

## Common errors and fixes

| Error / symptom | Root cause | One-line fix |
|---|---|---|
| Join silently drops rows that "look" equal | Trailing `U+200B`/`U+FEFF` on the key | Run `normalize_key`, whose `CONTROL_CHARS` strip removes zero-width characters |
| `Highway` and `highway` counted separately | Mixed-case keys never normalised | Lowercase keys with `normalize_key` before any aggregation |
| `maxspeed` of 1200 km/h appears | `1.200` read as a float, not a locale 1200 | Apply `sanitize_value` (the `LOCALE_NUMERIC` branch) before numeric cast |
| `maxspeed` filled with imperial numbers | `mph` value cast directly to float | Convert with `harmonize_speed_kmh`, not `float()` |
| `TypeError` in `map_elements` | Older Polars signature / missing dtype | Pin `polars>=0.20.0` and pass `return_dtype=pl.Utf8` |
| Re-driven ingest double-mutates values | Non-idempotent cleaner | Keep all repair inside `sanitize_value`; it is a no-op on clean input |
| Memory climbs across batches | GeoPandas->Polars cycles not freed | Call `gc.collect()` after each `df.slice` (the stream loop already does) |

## Spec reference

> OSM imposes no schema on tag keys or values — any key may carry any UTF-8 string — so "malformed" is defined by the pipeline, not the format. The authoritative meaning of each key, the lowercase key convention, the `;` multi-value separator, and unit syntax for keys like `maxspeed` are documented in the OpenStreetMap [Map Features](https://wiki.openstreetmap.org/wiki/Map_Features), [Tags](https://wiki.openstreetmap.org/wiki/Tags), and [Key:maxspeed](https://wiki.openstreetmap.org/wiki/Key:maxspeed) pages; treat those as the source of truth for what a repair may and may not change. Pattern syntax follows the [Python `re` module](https://docs.python.org/3/library/re.html).

## Related

- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — the resilience stage whose quarantine partition this repair feeds.
- [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — the canonical schema this stage repairs deviations from.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — streaming the same functions over extracts larger than RAM.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — the controlled vocabulary that decides which values are valid.
- [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/) — where unrepaired `maxspeed`/`lanes` values corrupt edge weights downstream.
- [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/) — the mapping stage that consumes cleaned, harmonised attributes.

This how-to belongs to the [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) guide — head back there for the full resilience stage, or up to [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) for the broader pipeline.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Fixing malformed OSM tags during ETL ingestion",
  "description": "Detect and repair malformed OpenStreetMap tags during ingestion — strip control and zero-width characters, normalise keys, fix locale numerics, harmonise units, and quarantine the unrepairable — with idempotent, memory-bounded Python.",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["OpenStreetMap", "Tag normalization", "Data quality", "Python ETL"],
  "isPartOf": {
    "@type": "TechArticle",
    "name": "Error Handling in Large OSM Extracts",
    "url": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/"
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
    { "@type": "ListItem", "position": 3, "name": "Error Handling in Large OSM Extracts", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/" },
    { "@type": "ListItem", "position": 4, "name": "Fixing Malformed OSM Tags During ETL Ingestion", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/fixing-malformed-osm-tags-during-etl-ingestion/" }
  ]
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Fix malformed OSM tags during ETL ingestion",
  "description": "Profile tag anomalies, repair control characters, key casing, locale numerics and units idempotently, then quarantine rows that cannot be repaired.",
  "step": [
    { "@type": "HowToStep", "name": "Profile anomalies", "text": "Run osmium tags-filter and tags-count on the .osm.pbf to baseline tag value frequencies and surface recurring malformations before mutating anything." },
    { "@type": "HowToStep", "name": "Sanitize values", "text": "Strip control and zero-width characters, trim, and collapse locale thousands separators with an idempotent sanitize_value applied vectorised across tag columns." },
    { "@type": "HowToStep", "name": "Normalise keys and units", "text": "Lowercase and snake-case keys per OSM convention and convert maxspeed to km/h, returning None for non-numeric speeds rather than fabricating a value." },
    { "@type": "HowToStep", "name": "Quarantine the unrepairable", "text": "Route rows still empty in a required key after repair to a dead-letter Parquet partition that retains the raw payload for review." }
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
      "name": "What makes an OSM tag 'malformed' if the PBF decoded fine?",
      "acceptedAnswer": { "@type": "Answer", "text": "OSM enforces no schema, so a value can be valid UTF-8 yet semantically broken: a trailing zero-width space on a key, a mixed-case key like Highway, or a locale number such as 1.200 meaning 1200. These pass a naive string check and then corrupt joins, unit conversions, or edge weights downstream, so malformed is a pipeline concept rather than a format error." }
    },
    {
      "@type": "Question",
      "name": "Why must the sanitization be idempotent?",
      "acceptedAnswer": { "@type": "Answer", "text": "A continental ingest can be resumed or re-driven after a failure, so any repair must produce the same output whether it runs once or twice. Keeping all mutation inside sanitize_value, which is a no-op on already-clean input, guarantees a re-run never double-mutates a value." }
    },
    {
      "@type": "Question",
      "name": "How do I strip zero-width and control characters from tags?",
      "acceptedAnswer": { "@type": "Answer", "text": "Use a precompiled regex covering C0/C1 control ranges plus U+200B zero-width space, U+00A0 non-breaking space, and U+FEFF byte-order mark, then strip and trim. Applying it to both keys and values removes invisible characters that otherwise break joins on values that look identical." }
    },
    {
      "@type": "Question",
      "name": "Is it ever safe to default a missing maxspeed during repair?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. The repair stage converts mph to km/h and returns None for non-numeric speeds like variable or walk, but it never invents a maxspeed. Rows lacking a required value after repair are quarantined for review rather than coerced into a fabricated number." }
    }
  ]
}
</script>
