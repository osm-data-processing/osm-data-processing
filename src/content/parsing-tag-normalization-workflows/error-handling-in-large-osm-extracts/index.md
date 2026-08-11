---
title: "Error Handling in Large OSM Extracts"
description: "Deterministic error boundaries, quarantine queues, circuit breakers, and idempotent checkpointing for ingesting continental-scale OpenStreetMap PBF extracts."
pageDescription: "Error handling for large OSM extracts: exception boundaries, dead-letter quarantine, circuit breakers, structured logging, and resumable checkpointing in Python ETL."
slug: error-handling-in-large-osm-extracts
type: guide
breadcrumb: "Error Handling"
datePublished: 2025-09-12
dateModified: 2026-06-26
date: 2026-06-26
---
# Error Handling in Large OSM Extracts

A continental OpenStreetMap (OSM) extract is not a clean dataset — it is a multi-gigabyte stream of community-contributed primitives in which a single corrupt block, a stray control character in a tag value, or a way that references a node missing from the extract can abort an overnight ingest at hour six. The failure that hurts most is the *silent* one: a decoder that swallows an unresolved reference and emits a way with a truncated geometry, which then poisons a routing graph that looks structurally valid until a journey planner returns a route through a wall. Error handling in this stage is therefore not defensive boilerplate around the happy path; it is the contract that decides which records reach the sink, which are quarantined for review, and when the pipeline must stop rather than commit garbage. This page shows how to wrap the parse-and-normalize loop in deterministic exception boundaries, route defective records to a dead-letter queue, halt on systematic corruption with a circuit breaker, and resume from the last committed checkpoint without reprocessing the whole archive.

<svg viewBox="0 0 860 560" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Flowchart of the resilient OSM ingest loop. A PBF chunk enters a decode-and-validate decision. On success it flows to normalise tags, then a schema-conformant decision: yes commits to the sink, no routes to the quarantine dead-letter queue. On a decode error the chunk goes to a log step recording offset and chunk id, then an error-rate-above-threshold decision: yes halts via the circuit breaker, no skips the block and continues the stream." style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit;color:inherit;">
  <title>Resilient OSM ingest loop: commit, quarantine, or halt</title>
  <desc>Each PBF chunk passes a decode-and-validate gate. Successful decodes are normalised and checked against the schema: conformant features commit to the sink, non-conformant features are quarantined to a dead-letter queue. Failed decodes are logged with their byte offset and chunk id, then fed to a circuit breaker; if the rolling block-error rate exceeds the threshold the pipeline halts, otherwise it skips the block and continues. There is no fourth state in which a defect is silently absorbed.</desc>
  <defs>
    <marker id="ehArr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="860" height="560" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <g fill="none" stroke="currentColor">
    <!-- edges -->
    <line x1="430" y1="67"  x2="430" y2="112" stroke-width="1.5" marker-end="url(#ehArr)"/>
    <line x1="430" y1="188" x2="430" y2="245" stroke-width="1.5" marker-end="url(#ehArr)"/>
    <line x1="526" y1="150" x2="635" y2="150" stroke-width="1.5" marker-end="url(#ehArr)"/>
    <line x1="430" y1="291" x2="430" y2="342" stroke-width="1.5" marker-end="url(#ehArr)"/>
    <line x1="430" y1="418" x2="430" y2="469" stroke-width="1.5" marker-end="url(#ehArr)"/>
    <line x1="334" y1="380" x2="215" y2="380" stroke-width="1.5" marker-end="url(#ehArr)"/>
    <line x1="720" y1="173" x2="720" y2="230" stroke-width="1.5" marker-end="url(#ehArr)"/>
    <line x1="720" y1="306" x2="720" y2="361" stroke-width="1.5" marker-end="url(#ehArr)"/>
    <path d="M816,268 L836,268 L836,492 L805,492" stroke-width="1.5" marker-end="url(#ehArr)"/>
  </g>
  <!-- process boxes -->
  <g stroke="currentColor" stroke-width="1.5">
    <rect x="345" y="21"  width="170" height="46" rx="6" fill="none"/>
    <rect x="345" y="245" width="170" height="46" rx="6" fill="none"/>
    <rect x="345" y="469" width="170" height="46" rx="6" fill="currentColor" fill-opacity="0.10"/>
    <rect x="635" y="127" width="170" height="46" rx="6" fill="none"/>
    <rect x="635" y="361" width="170" height="46" rx="6" fill="currentColor" fill-opacity="0.10"/>
    <rect x="635" y="469" width="170" height="46" rx="6" fill="currentColor" fill-opacity="0.10"/>
  </g>
  <!-- decision diamonds -->
  <g stroke="currentColor" stroke-width="1.5" fill="none">
    <polygon points="430,112 526,150 430,188 334,150"/>
    <polygon points="430,342 526,380 430,418 334,342"/>
    <polygon points="720,230 816,268 720,306 624,268"/>
  </g>
  <!-- quarantine cylinder -->
  <g stroke="currentColor" stroke-width="1.5">
    <path d="M65,359 L65,401 A75,8 0 0 0 215,401 L215,359" fill="currentColor" fill-opacity="0.10"/>
    <ellipse cx="140" cy="359" rx="75" ry="8" fill="currentColor" fill-opacity="0.10"/>
  </g>
  <!-- box labels -->
  <g fill="currentColor" font-size="12" text-anchor="middle">
    <text x="430" y="48">PBF chunk (block)</text>
    <text x="430" y="272">Normalise tags</text>
    <text x="430" y="496">Commit to sink</text>
    <text x="720" y="154">Log offset + chunk id</text>
    <text x="720" y="388">Halt · circuit breaker</text>
    <text x="720" y="496">Skip block, continue</text>
    <text x="140" y="378">Quarantine</text>
    <text x="140" y="394" opacity="0.8">(DLQ)</text>
  </g>
  <!-- diamond labels -->
  <g fill="currentColor" font-size="11.5" text-anchor="middle">
    <text x="430" y="146">Decode &amp;</text><text x="430" y="160">validate</text>
    <text x="430" y="376">Schema</text><text x="430" y="390">conformant?</text>
    <text x="720" y="264">Error rate &gt;</text><text x="720" y="278">threshold?</text>
  </g>
  <!-- edge labels -->
  <g fill="currentColor" font-size="11" opacity="0.85">
    <text x="445" y="220" text-anchor="start">success</text>
    <text x="580" y="142" text-anchor="middle">decode error</text>
    <text x="445" y="446" text-anchor="start">yes</text>
    <text x="288" y="372" text-anchor="middle">no</text>
    <text x="735" y="338" text-anchor="start">yes</text>
    <text x="824" y="262" text-anchor="end">no</text>
  </g>
  <text x="430" y="544" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.9">Three terminal fates — commit · quarantine · halt — and no silent fourth state.</text>
</svg>

The flow has a single organizing principle: every record either commits, quarantines, or trips the breaker — there is no fourth state in which a defect is silently absorbed. The sections below build each branch.

## Prerequisite concepts

This page sits in the resilience layer of the [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) pipeline and assumes three foundations are already in place. First, you must know where it is *safe* to draw an error boundary: the [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) explains that a `Blob` is the smallest independently decodable unit, which is why a decode failure is scoped to a block — you discard the block, log its offset, and keep streaming rather than aborting the file. Second, the reference-resolution rules in the [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) define what "missing node" and "dangling member" actually mean, and therefore which exceptions are recoverable (skip the feature) versus fatal (the extract itself is truncated). Third, the canonical schema you validate against is the one produced by [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — error handling enforces that schema; it does not invent one. Readers ingesting concurrently should also pair this with [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/), whose workers produce the quarantined records this stage triages.

## Specification & failure-surface reference

Before writing handlers, classify the failure surface against what the format actually guarantees. OSM PBF and XML each have well-defined points where corruption surfaces, and each maps to a different remediation tier.

| Failure surface | Where it originates | Spec guarantee | Recoverable scope |
|---|---|---|---|
| Blob decode error | zlib stream truncated or `Blob` size exceeds the 32 MiB uncompressed ceiling | Each `Blob` is independently decodable | Block — discard and continue |
| Unresolved node reference | Way references a node ID absent from the extract | Geometry is a join, not inline | Feature — skip way, log ID |
| Dangling relation member | Relation references a way/node outside the bbox clip | Members may legitimately span clips | Feature — partial-build or skip |
| Malformed tag value | Free-form string: bad casing, control chars, locale separators | No enforced tag schema | Field — normalize or null |
| Encoding anomaly | Non-UTF-8 bytes in a string-table entry | PBF mandates UTF-8 string tables | Field — replace/strip, quarantine |
| Schema non-conformance | Required key absent after normalization | No spec requirement; your contract | Feature — quarantine to DLQ |

The decisive distinction is *scope*. A blob decode error costs you one block; an unresolved reference costs you one feature; a malformed tag costs you one field. Collapsing these tiers — for example treating every exception as fatal — turns a 0.01% defect rate into a 100% failure. The string-table UTF-8 mandate is the one place where the spec is strict: a non-UTF-8 byte sequence indicates either a corrupt extract or a non-conformant producer, and it should always be quarantined rather than silently decoded with `errors="replace"`, because a replacement character in a `name` tag is itself a data defect.

## Step-by-step implementation

The core loop is a generator that yields one of two record types — committed or quarantined — and never raises across the chunk boundary. Build it in five steps.

1. **Define a typed outcome.** Model each record's fate explicitly so the consumer cannot accidentally treat a quarantined record as clean.
2. **Wrap decode and validation in scoped boundaries.** Catch decode errors at block scope and validation errors at feature scope; let only genuinely fatal conditions (truncated archive, unreadable file) propagate.
3. **Emit structured JSON logs.** Capture chunk id, byte offset, exception type, and the offending key/ID so failures are queryable, not buried in a stack trace.
4. **Trip a circuit breaker on systematic corruption.** Track a rolling error rate; halt when it crosses a threshold so a corrupt region does not burn hours producing quarantine noise.
5. **Checkpoint after every committed chunk.** Persist the last committed chunk id so a restart resumes rather than reprocesses.

```python
from __future__ import annotations

import logging
from collections.abc import Iterator
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)

REQUIRED_KEYS: frozenset[str] = frozenset({"highway"})


class Outcome(Enum):
    COMMIT = "commit"
    QUARANTINE = "quarantine"


@dataclass(slots=True)
class Record:
    chunk_id: int
    osm_id: int
    tags: dict[str, str]
    outcome: Outcome
    reason: str | None = None


def validate_feature(chunk_id: int, osm_id: int, tags: dict[str, str]) -> Record:
    """Field- and feature-scoped validation; never raises on data defects."""
    # Encoding anomaly: string table must be UTF-8 (PBF spec mandate).
    for k, v in tags.items():
        if "�" in v or "�" in k:
            return Record(chunk_id, osm_id, tags, Outcome.QUARANTINE,
                          reason="non_utf8_string_table")
    # Schema non-conformance: required key absent after normalization.
    missing = REQUIRED_KEYS - tags.keys()
    if missing:
        return Record(chunk_id, osm_id, tags, Outcome.QUARANTINE,
                      reason=f"missing_keys:{','.join(sorted(missing))}")
    return Record(chunk_id, osm_id, tags, Outcome.COMMIT)
```

### Block-scoped boundaries and the circuit breaker

Decode errors are scoped to the block, so the breaker counts *block* failures, not feature failures — one corrupt blob should not be amplified by the thousands of features it would have contained.

```python
from __future__ import annotations

import logging
import zlib
from collections.abc import Iterator

logger = logging.getLogger(__name__)


class CircuitBreaker:
    """Halt when the rolling block-error rate exceeds a threshold."""

    def __init__(self, threshold: float = 0.05, window: int = 200) -> None:
        self.threshold = threshold
        self.window = window
        self._results: list[bool] = []  # True == error

    def record(self, *, error: bool) -> None:
        self._results.append(error)
        if len(self._results) > self.window:
            self._results.pop(0)

    @property
    def tripped(self) -> bool:
        if len(self._results) < self.window:
            return False
        rate = sum(self._results) / len(self._results)
        return rate > self.threshold


def stream_blocks(blocks: Iterator[tuple[int, bytes]],
                  decode, breaker: CircuitBreaker) -> Iterator[Record]:
    """Yield validated records; discard bad blocks; halt on systematic corruption."""
    for chunk_id, raw in blocks:
        try:
            features = decode(raw)  # may raise on a truncated/corrupt blob
        except (zlib.error, ValueError) as exc:  # block-scoped, recoverable
            breaker.record(error=True)
            logger.warning(
                "block decode failed",
                extra={"chunk_id": chunk_id, "byte_len": len(raw),
                       "error_type": type(exc).__name__},
            )
            if breaker.tripped:
                logger.error("circuit breaker tripped at chunk %d", chunk_id)
                raise RuntimeError("error rate exceeded threshold") from exc
            continue
        breaker.record(error=False)
        for osm_id, tags in features:
            rec = validate_feature(chunk_id, osm_id, tags)
            if rec.outcome is Outcome.QUARANTINE:
                logger.info("quarantined feature",
                            extra={"chunk_id": chunk_id, "osm_id": osm_id,
                                   "reason": rec.reason})
            yield rec
```

The `extra=` dictionary is what makes failures queryable: with a JSON log formatter, each warning becomes a structured event you can aggregate (`GROUP BY reason`) to distinguish a one-off corrupt blob from a region-wide tagging problem. Configuring the [Python logging framework](https://docs.python.org/3/library/logging.html) to emit JSON — rather than free text — is the difference between forensic analysis and grep archaeology.

### Routing quarantine to a dead-letter partition

Quarantined records are not garbage; they are the review queue. Write them to a partitioned Parquet dead-letter store keyed by reason, so analysts can triage `missing_keys` separately from `non_utf8_string_table`.

```python
from __future__ import annotations

import logging
from collections.abc import Iterator

import pyarrow as pa
import pyarrow.parquet as pq

logger = logging.getLogger(__name__)


def split_and_sink(records: Iterator[Record], dlq_root: str) -> dict[str, int]:
    """Commit clean records; partition quarantined ones by reason."""
    committed: list[dict] = []
    quarantined: dict[str, list[dict]] = {}
    for rec in records:
        if rec.outcome is Outcome.COMMIT:
            committed.append({"osm_id": rec.osm_id, **rec.tags})
        else:
            bucket = (rec.reason or "unknown").split(":")[0]
            quarantined.setdefault(bucket, []).append(
                {"osm_id": rec.osm_id, "reason": rec.reason, **rec.tags})
    for reason, rows in quarantined.items():
        pq.write_table(pa.Table.from_pylist(rows),
                       f"{dlq_root}/reason={reason}/part.parquet")
        logger.warning("quarantined %d records under reason=%s", len(rows), reason)
    return {"committed": len(committed),
            **{f"dlq_{k}": len(v) for k, v in quarantined.items()}}
```

## Validation & error-handling matrix

<svg viewBox="0 0 820 470" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Decision matrix routing each error scope to a destination. Field-scoped defects (malformed value, non-UTF-8 byte) normalise or null to continue, or quarantine when non-UTF-8. Feature-scoped defects (unresolved reference, missing key) quarantine to the dead-letter queue. Block-scoped defects (zlib decode error, oversize blob) discard the block and continue, each incrementing a circuit breaker. The breaker tracks the rolling block-error rate over a window of two hundred; below the five percent threshold it tolerates and continues, above it the pipeline halts." style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit;color:inherit;">
  <title>Error scope to destination routing with the circuit-breaker threshold band</title>
  <desc>Three boundary scopes map to destinations. Field-scoped defects normalise or null and continue to the sink, except non-UTF-8 bytes which quarantine. Feature-scoped defects (unresolved references, missing required keys) quarantine to the dead-letter queue. Block-scoped decode errors discard the block and continue, each error incrementing the circuit breaker. The breaker measures the rolling block-error rate over a window of 200 blocks: below the 5 percent threshold it tolerates and discards, above the threshold it trips and halts the pipeline.</desc>
  <defs>
    <marker id="mxArr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="820" height="470" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <!-- column captions -->
  <g fill="currentColor" font-size="11" opacity="0.7" text-anchor="middle">
    <text x="149" y="44">boundary scope</text>
    <text x="666" y="44">destination</text>
  </g>
  <!-- routing edges -->
  <g fill="none" stroke="currentColor" stroke-width="1.4">
    <line x1="274" y1="86"  x2="548" y2="79"  marker-end="url(#mxArr)"/>
    <line x1="274" y1="98"  x2="548" y2="160" marker-end="url(#mxArr)"/>
    <line x1="274" y1="177" x2="548" y2="172" marker-end="url(#mxArr)"/>
    <line x1="274" y1="263" x2="548" y2="259" marker-end="url(#mxArr)"/>
  </g>
  <!-- source scope boxes -->
  <g stroke="currentColor" stroke-width="1.5" fill="currentColor" fill-opacity="0.06">
    <rect x="24" y="64"  width="250" height="54" rx="6"/>
    <rect x="24" y="150" width="250" height="54" rx="6"/>
    <rect x="24" y="236" width="250" height="54" rx="6"/>
  </g>
  <g fill="currentColor" text-anchor="middle">
    <text x="149" y="87"  font-size="12.5">FIELD scope</text>
    <text x="149" y="105" font-size="10.5" opacity="0.78">malformed value · non-UTF-8 byte</text>
    <text x="149" y="173" font-size="12.5">FEATURE scope</text>
    <text x="149" y="191" font-size="10.5" opacity="0.78">unresolved ref · missing key</text>
    <text x="149" y="259" font-size="12.5">BLOCK scope</text>
    <text x="149" y="277" font-size="10.5" opacity="0.78">zlib decode error · &gt;32 MiB blob</text>
  </g>
  <!-- destination boxes -->
  <g stroke="currentColor" stroke-width="1.5" fill="currentColor" fill-opacity="0.10">
    <rect x="548" y="56"  width="236" height="46" rx="6"/>
    <rect x="548" y="146" width="236" height="46" rx="6"/>
    <rect x="548" y="236" width="236" height="46" rx="6"/>
  </g>
  <g fill="currentColor" text-anchor="middle" font-size="12">
    <text x="666" y="84">Continue → sink</text>
    <text x="666" y="174">Quarantine (DLQ)</text>
    <text x="666" y="264">Discard block, continue</text>
  </g>
  <!-- edge labels -->
  <g fill="currentColor" font-size="10" opacity="0.85" text-anchor="middle">
    <text x="405" y="70">normalize / null</text>
    <text x="380" y="142">non-UTF-8 byte</text>
    <text x="410" y="192">unresolved · missing key</text>
    <text x="405" y="251">blob decode error</text>
  </g>
  <!-- divider -->
  <line x1="24" y1="312" x2="784" y2="312" stroke="currentColor" stroke-width="1" stroke-dasharray="4 4" opacity="0.35"/>
  <text x="24" y="338" font-size="11.5" fill="currentColor" opacity="0.85">Circuit breaker · rolling block-error rate (window = 200)</text>
  <!-- feed from discard into breaker -->
  <path d="M666,282 L666,330 L355,330 L355,386" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="4 3" marker-end="url(#mxArr)"/>
  <text x="512" y="324" font-size="10" fill="currentColor" opacity="0.8" text-anchor="middle">errors increment window</text>
  <!-- gauge track -->
  <rect x="150" y="388" width="205" height="22" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.2"/>
  <rect x="355" y="388" width="205" height="22" fill="currentColor" fill-opacity="0.22" stroke="currentColor" stroke-width="1.2"/>
  <line x1="355" y1="378" x2="355" y2="416" stroke="currentColor" stroke-width="1.6"/>
  <g fill="currentColor" text-anchor="middle">
    <text x="355" y="372" font-size="10.5">5% trip threshold</text>
    <text x="252" y="403" font-size="9.5" opacity="0.85">tolerate → discard</text>
    <text x="457" y="403" font-size="9.5" opacity="0.95">trip → halt</text>
    <text x="150" y="426" font-size="9.5" opacity="0.7">0%</text>
    <text x="560" y="426" font-size="9.5" opacity="0.7">10%</text>
  </g>
  <!-- gauge to halt -->
  <line x1="560" y1="399" x2="600" y2="399" stroke="currentColor" stroke-width="1.4" marker-end="url(#mxArr)"/>
  <text x="580" y="392" font-size="9.5" fill="currentColor" opacity="0.8" text-anchor="middle">rate &gt; threshold</text>
  <rect x="600" y="378" width="184" height="42" rx="6" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="1.6"/>
  <text x="692" y="404" font-size="13" fill="currentColor" text-anchor="middle">HALT</text>
</svg>

| Error condition | Root cause | Detection | Remediation |
|---|---|---|---|
| `zlib.error` on blob | Truncated download or corrupt `Blob` exceeding 32 MiB ceiling | `decode(raw)` raises | Discard block, log offset, increment breaker; re-fetch extract if rate climbs |
| `KeyError` on node ref | Way references a node absent from the extract | Reference lookup misses | Skip feature, log `osm_id`; if pervasive, the extract is truncated — abort |
| Dangling relation member | Member outside the bbox clip | Member resolve returns `None` | Partial-build with present members or skip; never raise |
| `UnicodeDecodeError` / `�` | Non-UTF-8 bytes in string table | Replacement char scan in `validate_feature` | Quarantine to `reason=non_utf8_string_table`; do not coerce |
| Missing required key | Tag dropped upstream or never mapped | `REQUIRED_KEYS - tags.keys()` | Quarantine to `reason=missing_keys`; route to manual review |
| `MemoryError` mid-chunk | Chunk too large for worker heap | OOM kill or allocation failure | Lower chunk size, force `gc.collect()` after commit |
| Runaway error rate | Systematically corrupt region | `CircuitBreaker.tripped` | Halt, alert, isolate offending byte range, re-tile |
| Duplicate commit on restart | No checkpoint; reprocessed chunks | Sink row count exceeds source | Read checkpoint manifest, skip committed chunk ids |

## Performance & scale considerations

The cost of error handling is dominated by two choices: chunk size and where garbage collection runs. Chunk size sets the granularity of both memory pressure and checkpoint recovery. Too large and a single `MemoryError` discards a lot of work and forces a long replay on restart; too small and per-chunk fixed costs (logging, breaker bookkeeping, Parquet flush) dominate. For dense urban extracts where multipolygon relations and high node density inflate per-feature memory, 250,000–750,000 features per chunk is a workable band; trigger an explicit `gc.collect()` after each successful commit, because GeoPandas/Shapely retain references in internal geometry caches that the cyclic collector will not otherwise reclaim promptly.

The circuit breaker's window and threshold trade detection latency against false trips. A window of 200 blocks at a 5% threshold tolerates the occasional corrupt blob (expected on large downloads) while still halting within ~200 blocks of entering a systematically corrupt region. Setting the threshold too low makes a noisy-but-usable extract un-ingestable; too high lets the pipeline burn hours writing quarantine noise before stopping. The expected wasted work before a trip is bounded by:

$$ W_{\text{wasted}} \approx \text{window} \times \bar{t}_{\text{block}} $$

where $\bar{t}_{\text{block}}$ is the mean per-block processing time — which is why a tighter window, not a lower threshold, is the right dial when you need to fail fast. When memory rather than corruption is the binding constraint, prefer the streaming generators in [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) over enlarging chunks to amortize fixed costs.

## Failure modes & gotchas

- **Catching `Exception` at the chunk boundary hides truncation.** A blanket `except Exception` will swallow the `KeyError` storm that signals a truncated extract, converting a fatal "your file is incomplete" into an endless quarantine stream. Catch the specific recoverable types (`zlib.error`, `ValueError`, `KeyError`) and let everything else propagate.
- **`errors="replace"` is data corruption, not error handling.** Decoding a non-UTF-8 string table with replacement characters produces a record that *looks* valid and passes schema checks while carrying a corrupted `name`. Quarantine the record instead so the defect is visible.
- **The breaker must count blocks, not features.** One corrupt blob can represent thousands of features; counting feature failures lets a single bad block trip the breaker spuriously, or — worse — mask a slow-burn corruption rate that never accumulates because each bad block contributes only one "error."
- **Checkpoints written before the sink flush are lies.** Persist the checkpoint *after* the Parquet write is durably flushed, never before; otherwise a crash between checkpoint and flush silently drops a committed chunk on restart.
- **Garbage collection after every feature, not every chunk, tanks throughput.** `gc.collect()` is expensive; call it once per committed chunk, not in the inner loop.
- **Locale-dependent number parsing corrupts silently.** A `maxspeed` of `1.200` means 1200 in some locales and 1.2 in others; never feed tag values through a locale-aware parser — the ambiguity belongs in the quarantine queue, not in a coerced float.

## Integration points

Error handling is a middleware stage: it consumes the raw feature stream from the parser and emits a *clean* stream plus a dead-letter store. Downstream, the committed records feed topology assembly. The most common defect class quarantined here — malformed tags — has its own dedicated remediation procedure in [Fixing malformed OSM tags during ETL ingestion](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/fixing-malformed-osm-tags-during-etl-ingestion/), which reads the `reason=` partitions this stage writes and applies targeted regex repairs before re-submitting records. The wiring below couples the breaker-guarded stream to the sink and an idempotent checkpoint manifest:

<figure class="diagram-wrap">
<svg viewBox="0 0 880 278" role="img" aria-labelledby="err-routing-t err-routing-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="err-routing-t">Where each failure class should be routed once it is detected</title>
  <desc id="err-routing-d">A grid of four failure classes against the destination and the retry policy. A transient I/O fault goes back to the same stage with bounded exponential retry. A malformed single object goes to a dead-letter partition and the run continues. A structurally broken block fails the run, because a corrupt block means the file cannot be trusted. And a schema mismatch against the mapping registry fails fast at startup rather than at object one million.</desc>
  <rect x="0" y="0" width="880" height="278" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Continue on object faults, stop on file faults</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">destination</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">retry policy</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">transient I/O</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">same stage</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">exponential backoff, bounded</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">one malformed object</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">dead-letter partition</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">never — record and move on</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">corrupt block</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">fail the run</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">never — the file is untrustworthy</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">schema mismatch</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">fail at startup</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">never — fix the registry</text>
  <text x="440" y="260" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">The dead-letter partition needs a size alarm. A run that quarantines four million objects and exits zero has not succeeded.</text>
</svg>
<figcaption>Two of these continue and two stop, and the distinction is whether the fault is local to one object or tells you something about the whole input.</figcaption>
</figure>

```python
from __future__ import annotations

import json
import logging
import sqlite3
from collections.abc import Iterator
from pathlib import Path

logger = logging.getLogger(__name__)


def load_checkpoint(db: sqlite3.Connection) -> int:
    """Return the highest committed chunk id, or -1 if none."""
    db.execute("CREATE TABLE IF NOT EXISTS ckpt(chunk_id INTEGER PRIMARY KEY)")
    row = db.execute("SELECT MAX(chunk_id) FROM ckpt").fetchone()
    return row[0] if row and row[0] is not None else -1


def run_ingest(blocks: Iterator[tuple[int, bytes]], decode,
               dlq_root: str, ckpt_path: str) -> dict[str, int]:
    """Drive the resilient stream with resumable, idempotent checkpointing."""
    db = sqlite3.connect(ckpt_path, isolation_level=None)
    db.execute("PRAGMA journal_mode=WAL")
    last = load_checkpoint(db)
    breaker = CircuitBreaker()

    fresh = ((cid, raw) for cid, raw in blocks if cid > last)  # skip committed
    stats = split_and_sink(stream_blocks(fresh, decode, breaker), dlq_root)
    # Checkpoint only AFTER the sink flush above has returned durably.
    db.execute("INSERT OR IGNORE INTO ckpt VALUES (?)", (stats.get("_last", last),))
    logger.info("ingest summary %s", json.dumps(stats))
    return stats
```

The committed Parquet output is then ready for projection to a working CRS per [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) and conversion into a routing graph via [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/), whose own topology validation forms the second line of defense against the dangling nodes and self-intersecting geometries that slip past tag-level checks.

## Deeper procedures in this area

- [Fixing malformed OSM tags during ETL ingestion](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/fixing-malformed-osm-tags-during-etl-ingestion/) — diagnostic profiling and targeted regex repairs for the malformed-tag records this stage quarantines.

## In this section

- [Resuming an Interrupted OSM Import](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/resuming-an-interrupted-osm-import/) — atomic units and commit-then-mark ordering, so a crash costs minutes.

## Frequently Asked Questions

<details>
<summary>When should the pipeline skip a record versus halt entirely?</summary>

Scope decides. A blob decode error is block-scoped — discard the block and continue. An unresolved reference or schema violation is feature-scoped — quarantine the feature and continue. The pipeline only halts when the circuit breaker detects a systematic pattern (a sustained error rate above threshold), which signals a corrupt region or a truncated archive rather than isolated defects.
</details>

<details>
<summary>Why quarantine non-UTF-8 tags instead of decoding with errors="replace"?</summary>

A replacement character in a `name` or `addr:street` tag is itself a data defect that passes every schema check and silently corrupts downstream output. Quarantining keeps the defect visible and reviewable. The PBF spec mandates UTF-8 string tables, so a non-UTF-8 sequence indicates a corrupt extract or a non-conformant producer — both warrant human triage, not a silent coercion.
</details>

<details>
<summary>How do I make the ingest resumable after a crash?</summary>

Persist the last committed chunk id to a lightweight SQLite WAL manifest *after* the sink flush is durable, and on restart skip every chunk id at or below that checkpoint. Because chunk processing is idempotent — the same chunk always produces the same committed and quarantined records — replaying a not-yet-checkpointed chunk is safe, while replaying a checkpointed one is avoided entirely.
</details>

<details>
<summary>Should the circuit breaker count failed features or failed blocks?</summary>

Blocks. One corrupt blob can stand in for thousands of features, so counting features either amplifies a single bad block into a spurious trip or dilutes a real corruption rate. Tracking block-level success/failure over a rolling window gives a stable error-rate signal that maps to the actual recoverable unit.
</details>

<details>
<summary>What chunk size balances memory against restart cost?</summary>

For dense urban extracts, 250,000–750,000 features per chunk is a practical band. Larger chunks reduce per-chunk fixed overhead but lose more work to a single `MemoryError` and force longer replays; smaller chunks recover faster but pay more in logging, breaker bookkeeping, and Parquet flushes. Force `gc.collect()` once per committed chunk to release GeoPandas/Shapely cache references.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Handle errors deterministically when ingesting large OSM extracts",
  "description": "Procedure for wrapping OSM PBF ingestion in scoped exception boundaries, dead-letter quarantine, a circuit breaker, and resumable idempotent checkpointing.",
  "step": [
    { "@type": "HowToStep", "name": "Define a typed outcome", "text": "Model each record's fate as COMMIT or QUARANTINE so the consumer cannot treat a quarantined record as clean." },
    { "@type": "HowToStep", "name": "Scope the exception boundaries", "text": "Catch decode errors at block scope and validation errors at feature scope; let only fatal conditions like a truncated archive propagate." },
    { "@type": "HowToStep", "name": "Emit structured JSON logs", "text": "Log chunk id, byte offset, exception type, and the offending key or ID so failures are queryable and aggregatable by reason." },
    { "@type": "HowToStep", "name": "Trip a circuit breaker on systematic corruption", "text": "Track a rolling block-error rate over a fixed window and halt when it crosses the threshold to avoid burning hours on a corrupt region." },
    { "@type": "HowToStep", "name": "Checkpoint after every committed chunk", "text": "Persist the last committed chunk id to a SQLite WAL manifest after the sink flush is durable, then skip committed chunks on restart." }
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
      "name": "When should the pipeline skip a record versus halt entirely?",
      "acceptedAnswer": { "@type": "Answer", "text": "Scope decides. A blob decode error is block-scoped, so discard the block and continue. An unresolved reference or schema violation is feature-scoped, so quarantine the feature and continue. The pipeline only halts when the circuit breaker detects a sustained error rate above threshold, signalling a corrupt region or truncated archive." }
    },
    {
      "@type": "Question",
      "name": "Why quarantine non-UTF-8 tags instead of decoding with errors=replace?",
      "acceptedAnswer": { "@type": "Answer", "text": "A replacement character in a name or address tag passes every schema check while silently corrupting downstream output. The PBF spec mandates UTF-8 string tables, so a non-UTF-8 sequence indicates a corrupt extract or non-conformant producer. Quarantining keeps the defect visible for human triage rather than coercing it." }
    },
    {
      "@type": "Question",
      "name": "How do I make the ingest resumable after a crash?",
      "acceptedAnswer": { "@type": "Answer", "text": "Persist the last committed chunk id to a SQLite WAL manifest after the sink flush is durable, and on restart skip every chunk id at or below that checkpoint. Because chunk processing is idempotent, replaying a not-yet-checkpointed chunk is safe and replaying a checkpointed one is avoided." }
    },
    {
      "@type": "Question",
      "name": "Should the circuit breaker count failed features or failed blocks?",
      "acceptedAnswer": { "@type": "Answer", "text": "Blocks. One corrupt blob can represent thousands of features, so counting features either amplifies a single bad block into a spurious trip or dilutes a real corruption rate. Tracking block-level success and failure over a rolling window gives a stable error-rate signal mapped to the actual recoverable unit." }
    },
    {
      "@type": "Question",
      "name": "What chunk size balances memory against restart cost?",
      "acceptedAnswer": { "@type": "Answer", "text": "For dense urban extracts, 250,000 to 750,000 features per chunk is practical. Larger chunks cut fixed overhead but lose more work to a MemoryError and force longer replays; smaller chunks recover faster but pay more in logging and flushes. Force gc.collect() once per committed chunk to release GeoPandas and Shapely cache references." }
    }
  ]
}
</script>

## Related

- [Async PBF Parsing with Pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) — the concurrent ingest whose workers produce the records this stage triages.
- [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — the canonical schema this stage validates against.
- [Batch Attribute Mapping Strategies](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/) — controlled vocabularies and fallback tables for cross-region tag harmonization.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — streaming generators when memory, not corruption, is the binding constraint.
- [OSMnx Graph Conversion Techniques](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/osmnx-graph-conversion-techniques/) — topology validation that catches defects slipping past tag-level checks.
- [Fixing malformed OSM tags during ETL ingestion](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/fixing-malformed-osm-tags-during-etl-ingestion/) — targeted repairs for the malformed-tag records quarantined here.

This guide is part of [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/); return to that overview to follow the data through normalization, error triage, and routing-graph conversion.
