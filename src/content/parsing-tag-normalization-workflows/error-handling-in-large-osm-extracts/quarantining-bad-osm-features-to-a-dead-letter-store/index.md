---
title: "Quarantining Bad OSM Features to a Dead-Letter Store"
description: "Give failed features somewhere to go that preserves the input, the reason and the code version, so a fix can be replayed against exactly what broke rather than against a fresh extract."
pageTitle: "A Dead-Letter Store for Failed OSM Features"
pageDescription: "Route failing OSM features to a quarantine that keeps the raw input, the error, the stage and the code version, then replay them after a fix and promote what now succeeds."
slug: quarantining-bad-osm-features-to-a-dead-letter-store
type: article
breadcrumb: "Dead-Letter Store"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Quarantining Bad OSM Features to a Dead-Letter Store

A pipeline that stops on the first bad feature never finishes, and one that logs and continues loses the evidence. A dead-letter store is the third option: the run completes, and everything that failed is still there in a form you can replay.

## Prerequisites

- [ ] Python 3.10+; the store below uses `sqlite3` from the standard library.
- [ ] The error-handling framing in [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/).
- [ ] Provenance, per [Recording OSM Data Provenance in a Pipeline](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/recording-osm-data-provenance-in-a-pipeline/).
- [ ] A pipeline whose stages are separable enough to name in a record.
- [ ] Somebody who will actually look at the store, since an unexamined quarantine is a slow leak.

## Conceptual minimum

A quarantine record has to answer four questions, and dropping any one of them makes replay impossible.

**What failed?** The feature's identity, and the raw input as it arrived — not the partially transformed version, because that is what you will need to reproduce the failure.

**Why?** The exception type and message, and the stage that raised it. A message alone is rarely enough to group failures, and the stage is what tells you where to look.

**When, and with what code?** The run identifier and the code version. After a fix, the records from before it are the ones worth replaying, and the ones from after it are a new problem.

**Has it been resolved?** A status, so a replayed record that now succeeds is promoted rather than sitting in quarantine forever looking like an outstanding fault.

The design rule that makes the store useful is that **the stored input must be sufficient to reproduce the failure alone**. A record referencing a feature by identifier, expecting the extract still to exist, is a note rather than a quarantine.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="qbf1-t qbf1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="qbf1-t">Three ways to handle a failing feature, and what each costs</title>
  <desc id="qbf1-d">Three panels. Stopping the run on the first failure guarantees correctness but means a single malformed feature prevents a continental extract from ever completing. Logging and continuing lets the run finish but loses the evidence, since a log line cannot be replayed and the input is gone by the time anybody reads it. Quarantining lets the run finish and keeps the input, the error and the code version, so a fix can be replayed against exactly what broke.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three responses to a bad feature</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Stop the run</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Correct, and useless</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">One bad feature blocks all</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Never completes at scale</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Nobody does this twice</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Log and continue</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Run completes</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Evidence is lost</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">A log cannot be replayed</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Input gone when read</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Quarantine</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Run completes</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Input preserved</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Replayable after a fix</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Needs somebody to look</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The third option's only weakness is human: a quarantine nobody examines becomes a place data goes to disappear quietly.</text>
</svg>
<figcaption>The middle option is the common default and it is the one that cannot be recovered from.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import json
import logging
import sqlite3
import traceback
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.errors.quarantine")

SCHEMA = """
CREATE TABLE IF NOT EXISTS dead_letter (
    id            INTEGER PRIMARY KEY,
    osm_type      TEXT NOT NULL,
    osm_id        INTEGER NOT NULL,
    stage         TEXT NOT NULL,
    error_type    TEXT NOT NULL,
    error_message TEXT NOT NULL,
    traceback     TEXT,
    raw_input     TEXT NOT NULL,      -- sufficient to reproduce, alone
    run_id        TEXT NOT NULL,
    code_version  TEXT NOT NULL,
    quarantined_at TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'open',  -- open | resolved | permanent
    resolved_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_dl_open ON dead_letter (status, stage, error_type);
"""


@dataclass(frozen=True)
class Context:
    run_id: str
    code_version: str


class DeadLetterStore:
    def __init__(self, path: Path, context: Context) -> None:
        self.conn = sqlite3.connect(path)
        self.conn.executescript(SCHEMA)
        self.context = context

    def quarantine(self, osm_type: str, osm_id: int, stage: str,
                   raw_input: dict, error: BaseException) -> None:
        self.conn.execute("""
            INSERT INTO dead_letter (osm_type, osm_id, stage, error_type,
              error_message, traceback, raw_input, run_id, code_version,
              quarantined_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (osm_type, osm_id, stage, type(error).__name__, str(error),
              "".join(traceback.format_exception(error))[-4000:],
              json.dumps(raw_input, default=str),
              self.context.run_id, self.context.code_version,
              datetime.now(timezone.utc).isoformat(timespec="seconds")))
        self.conn.commit()

    def summary(self) -> list[tuple]:
        rows = self.conn.execute("""
            SELECT stage, error_type, count(*) AS n
            FROM dead_letter WHERE status = 'open'
            GROUP BY stage, error_type ORDER BY n DESC
        """).fetchall()
        for stage, error_type, n in rows:
            logger.info("%6d  %-20s %s", n, stage, error_type)
        return rows

    def replay(self, process: Callable[[dict], None],
               stage: str | None = None) -> tuple[int, int]:
        """Re-run quarantined records against the CURRENT code.

        The stored raw input is replayed, not a fresh extract: the point is to
        test the fix against exactly what broke, which a new extract may no
        longer contain.
        """
        query = "SELECT id, raw_input FROM dead_letter WHERE status = 'open'"
        params: list = []
        if stage:
            query += " AND stage = ?"
            params.append(stage)

        fixed = still_failing = 0
        for record_id, raw in self.conn.execute(query, params).fetchall():
            try:
                process(json.loads(raw))
            except Exception:
                still_failing += 1
                continue
            self.conn.execute(
                "UPDATE dead_letter SET status = 'resolved', resolved_at = ? "
                "WHERE id = ?",
                (datetime.now(timezone.utc).isoformat(timespec="seconds"),
                 record_id))
            fixed += 1
        self.conn.commit()
        logger.info("replay: %d resolved, %d still failing", fixed, still_failing)
        return fixed, still_failing

    def age_alert(self, days: int = 14) -> int:
        """An unexamined quarantine is a slow leak. Make it visible."""
        stale, = self.conn.execute("""
            SELECT count(*) FROM dead_letter WHERE status = 'open'
            AND quarantined_at < datetime('now', ?)
        """, (f"-{days} days",)).fetchone()
        if stale:
            logger.warning("%d record(s) have been quarantined for over %d days",
                           stale, days)
        return stale


def guarded(store: DeadLetterStore, stage: str, process: Callable[[dict], None]
            ) -> Callable[[Iterable[dict]], int]:
    """Wrap a stage so one bad feature never stops the run."""
    def run(features: Iterable[dict]) -> int:
        processed = 0
        for feature in features:
            try:
                process(feature)
                processed += 1
            except Exception as error:
                store.quarantine(feature.get("type", "?"),
                                 int(feature.get("id", 0)), stage,
                                 feature, error)
        return processed
    return run


if __name__ == "__main__":
    logger.info("store the raw input, replay after a fix, promote what passes")
```

## Step-by-step walkthrough

1. **Store the input as it arrived.** A partially transformed feature may not reproduce the failure, and reconstructing the original later is usually impossible.
2. **Record the stage as well as the exception.** Grouping by stage and error type turns a thousand records into a handful of distinct problems, which is the difference between an actionable queue and a wall.
3. **Keep the code version.** After a fix, records from earlier versions are candidates for replay and records from the current one are a new fault, and only the version distinguishes them.
4. **Truncate the traceback.** A full traceback is useful and unbounded; keeping the last few kilobytes preserves the frames that matter without letting one record dominate the store.
5. **Commit per record.** The store is small and the cost is negligible against the work that produced the record, and it means a crash mid-run does not lose the quarantine.
6. **Replay against stored input.** Re-running a fresh extract tests the fix against data that may no longer contain the problem, which is how a fix gets declared successful without being verified.
7. **Promote what now passes.** A record that succeeds on replay becomes resolved, so the open count reflects outstanding problems rather than historical ones.
8. **Alert on age.** A quarantine nobody examines is a place data disappears into quietly, and an age alert is the cheapest possible defence against that.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 342" role="img" aria-labelledby="qbf2-t qbf2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="qbf2-t">What each stored field is for, and what replay loses without it</title>
  <desc id="qbf2-d">A grid of five stored fields against their purpose and what becomes impossible without them. The raw input allows the failure to be reproduced, without which a fix cannot be verified. The stage groups records into distinct problems, without which the queue is an undifferentiated wall. The error type groups them further and distinguishes a parse failure from a constraint violation. The code version separates records predating a fix from those after it. The status prevents resolved records from inflating the open count indefinitely.</desc>
  <rect x="0" y="0" width="880" height="342" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Five fields, five things replay depends on</text>
  <rect x="196" y="48" width="329" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="360" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">For</text>
  <rect x="525" y="48" width="329" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="690" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Without it</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Raw input</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">reproducing the failure</text>
  <text x="690" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">no verification possible</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Stage</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">grouping into problems</text>
  <text x="690" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">an undifferentiated wall</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Error type</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">distinguishing causes</text>
  <text x="690" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">parse and constraint merge</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Code version</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">separating before and after</text>
  <text x="690" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">fixes look unverified</text>
  <text x="30" y="289" font-size="11.5" font-weight="600" fill="currentColor">Status</text>
  <line x1="26" y1="308" x2="854" y2="308" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">closing resolved records</text>
  <text x="690" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">open count never falls</text>
  <text x="868" y="326" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The first row is the one that makes this a quarantine rather than a log, and it is the field most often omitted for size.</text>
</svg>
<figcaption>Storing the input costs bytes and is the only reason the store is worth having at all.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="qbf3-t qbf3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="qbf3-t">The quarantine lifecycle, from failure to resolution</title>
  <desc id="qbf3-d">Four stages. A feature fails inside a wrapped stage, and instead of stopping the run the wrapper writes a record holding the input, the error, the stage and the code version. A triage step groups the open records by stage and error type, turning a large count into a handful of distinct problems. A fix addresses one group. A replay re-runs the stored inputs for that group against the current code, promoting the records that now pass and leaving the rest open with a newer code version recorded.</desc>
  <defs><marker id="qbf3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Fail, triage, fix, replay</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">fail</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">record, do not stop</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">input preserved</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#qbf3-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">triage</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">group by stage and error</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">many become few</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#qbf3-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">fix</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">address one group</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">the smallest first</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#qbf3-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">replay</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">promote what passes</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">rest stay open</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Without the second step the queue is a number rather than a work list, which is why most quarantines are never worked through.</text>
</svg>
<figcaption>The loop only closes because replay uses the stored input; against fresh data it would prove nothing.</figcaption>
</figure>

## Verification

- **A failure is quarantined rather than fatal.** Feed a deliberately broken feature and confirm the run completes with one record stored.
- **The record replays.** Replay without changing anything and confirm it still fails, proving the stored input reproduces the problem.
- **A fix resolves it.** Correct the code, replay, and confirm the record is promoted to resolved.
- **Grouping is useful.** The summary should collapse many records into few distinct stage and error pairs.
- **Age alerting fires.** Backdate a record and confirm the alert reports it.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Fix cannot be verified | Raw input not stored | Store the feature as it arrived, before transformation |
| Queue is an undifferentiated wall | Stage not recorded | Record the stage and group the summary by it |
| Resolved records inflate the count | No status field | Promote records that pass on replay |
| Replay passes but production fails | Replayed against a fresh extract | Replay the stored input, not new data |
| Store grows without bound | Full tracebacks kept | Truncate to the last few kilobytes |
| Quarantine loses records on a crash | Commit deferred to the end | Commit per record; the cost is negligible |
| Nobody notices a growing backlog | No age alerting | Warn on records older than a threshold |

## Specification reference

> A dead-letter queue holds messages a consumer could not process, preserving them for inspection and reprocessing rather than discarding them or blocking the consumer. Applied to a batch pipeline, the equivalent requirement is that the stored record contain enough of the original input to reproduce the failure independently of the source data. See [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) for the wider error strategy this implements.

## Frequently Asked Questions

<details>
<summary>Why store the raw input rather than a reference to it?</summary>

Because a reference assumes the source still exists and still contains the problem, and neither is reliable. Extracts are replaced daily, and a feature that failed last week may have been edited since. Storing the input as it arrived makes the record self-contained, which is the entire difference between a quarantine you can replay and a log line describing something that is gone.
</details>

<details>
<summary>Should the pipeline stop when quarantine volume is high?</summary>

Yes, above a threshold. A handful of failures across millions of features is normal and worth reviewing at leisure; ten percent failing means something systemic changed and continuing produces an output whose gaps nobody has agreed to. Setting a proportional threshold turns that judgement into a rule, and it belongs in the same configuration as the quality gates.
</details>

<details>
<summary>Why replay the stored input rather than re-running the extract?</summary>

Because re-running tests the fix against current data, which may no longer contain the case that broke. A feature that has since been corrected upstream passes for reasons unrelated to your change, and the fix is declared successful without being verified. Replaying exactly what failed is the only way to know the code now handles it.
</details>

<details>
<summary>What should happen to a record that never resolves?</summary>

Mark it permanent and stop counting it as open. Some features are genuinely broken in ways your pipeline should not accommodate — a geometry that cannot be assembled, a value that means nothing — and leaving them open forever means the open count stops carrying information. Marking them explicitly preserves the record while keeping the queue honest about what is actually outstanding.
</details>

## Related

- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — the parent topic and the wider strategy.
- [Fixing Malformed OSM Tags During ETL Ingestion](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/fixing-malformed-osm-tags-during-etl-ingestion/) — the repairs that reduce quarantine volume.
- [Resuming an Interrupted OSM Import](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/resuming-an-interrupted-osm-import/) — the neighbouring resilience concern.
- [Recording OSM Data Provenance in a Pipeline](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/recording-osm-data-provenance-in-a-pipeline/) — where the run identifier and code version come from.
- [Setting Quality Thresholds That Fail a Build](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/setting-quality-thresholds-that-fail-a-build/) — turning quarantine volume into a gate.

Up one level: [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Quarantining Bad OSM Features to a Dead-Letter Store",
  "description": "Give failed features somewhere to go that preserves the input, the reason and the code version, so a fix can be replayed against exactly what broke rather than against a fresh extract.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["dead-letter store", "quarantine replay", "pipeline resilience"]
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
    { "@type": "ListItem", "position": 4, "name": "Quarantining Bad OSM Features to a Dead-Letter Store", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/quarantining-bad-osm-features-to-a-dead-letter-store/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Quarantine failing OSM features for later replay",
  "description": "Wrap each stage so a failure stores the raw input, stage, error and code version rather than stopping the run, then replay the stored records after a fix and promote the ones that pass.",
  "step": [
    { "@type": "HowToStep", "name": "Store the input as it arrived", "text": "Persist the untransformed feature so the failure can be reproduced independently of the source extract." },
    { "@type": "HowToStep", "name": "Record stage and error type", "text": "Capture which stage raised and what kind of exception, so records group into a few distinct problems." },
    { "@type": "HowToStep", "name": "Record run and code version", "text": "Keep the run identifier and code revision so records predating a fix can be separated from those after it." },
    { "@type": "HowToStep", "name": "Truncate the traceback", "text": "Keep the last few kilobytes so one record cannot dominate the store." },
    { "@type": "HowToStep", "name": "Commit per record", "text": "Persist immediately, so a crash mid-run does not lose the quarantine." },
    { "@type": "HowToStep", "name": "Replay stored input after a fix", "text": "Re-run the preserved features rather than a fresh extract, which may no longer contain the failing case." },
    { "@type": "HowToStep", "name": "Promote and age-alert", "text": "Mark records that now pass as resolved and warn about ones open beyond a threshold." }
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
      "name": "Why store the raw input rather than a reference to it?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because a reference assumes the source still exists and still contains the problem, and neither is reliable. Extracts are replaced daily and a feature that failed last week may have been edited since. Storing the input as it arrived makes the record self-contained, which is the difference between a quarantine you can replay and a log line describing something gone." }
    },
    {
      "@type": "Question",
      "name": "Should a pipeline stop when quarantine volume is high?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes, above a threshold. A handful of failures across millions of features is normal; ten percent failing means something systemic changed and continuing produces an output whose gaps nobody has agreed to. A proportional threshold turns that judgement into a rule." }
    },
    {
      "@type": "Question",
      "name": "Why replay stored input rather than re-running the extract?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because re-running tests the fix against current data, which may no longer contain the case that broke. A feature corrected upstream passes for reasons unrelated to your change, and the fix is declared successful without being verified. Replaying exactly what failed is the only way to know." }
    },
    {
      "@type": "Question",
      "name": "What should happen to a quarantined record that never resolves?",
      "acceptedAnswer": { "@type": "Answer", "text": "Mark it permanent and stop counting it as open. Some features are genuinely broken in ways your pipeline should not accommodate, and leaving them open forever means the open count stops carrying information. Marking them explicitly preserves the record while keeping the queue honest." }
    }
  ]
}
</script>
