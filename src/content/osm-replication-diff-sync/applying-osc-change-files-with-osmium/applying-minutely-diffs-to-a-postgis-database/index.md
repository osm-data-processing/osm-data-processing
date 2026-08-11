---
title: "Applying Minutely Diffs to a PostGIS Database"
description: "Keep an osm2pgsql or imposm PostGIS database current by appending minutely OSM diffs incrementally, using slim mode and a small fetch-and-append orchestration loop."
pageTitle: "Apply Minutely OSM Diffs to a PostGIS Database"
pageDescription: "Update a PostGIS OSM database in place with osm2pgsql --append --slim or imposm run, plus a Python loop that fetches minutely diffs and appends them without a full reimport."
slug: applying-minutely-diffs-to-a-postgis-database
type: article
breadcrumb: "Applying Diffs to PostGIS"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Applying Minutely Diffs to a PostGIS Database

Keep an `osm2pgsql`- or `imposm`-loaded PostGIS database current by appending minutely OSM change files incrementally, so only the rows that actually changed are touched — never a multi-hour full reimport.

## Prerequisites

- [ ] A PostGIS database already loaded from a `.osm.pbf`, and PostGIS 3.x on PostgreSQL 14+.
- [ ] `osm2pgsql` 1.9+ **imported in slim mode** — updates are impossible against a non-slim import (see the note below).
- [ ] `pyosmium` 3.6+ for `pyosmium-get-changes`, or a direct `.osc.gz` fetch, as set up in [Catching Up a Stale OSM Extract with pyosmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/catching-up-a-stale-osm-extract-with-pyosmium/).
- [ ] The database's current replication sequence recorded — its origin is explained in [Replication Sequence Numbers and State](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/).
- [ ] Python 3.10+ and a scheduler (cron or a timer) to fire the loop.
- [ ] Disk headroom for the slim tables, which roughly double the import footprint but are what make incremental updates possible.

## Conceptual minimum

A file-based update rewrites the entire `.osm.pbf` for every diff; a database-based update instead applies the diff's create/modify/delete operations as row-level `INSERT`/`UPDATE`/`DELETE` against the rendered tables, so cost tracks the number of changed objects rather than database size. That is why a minutely cadence — impractical against a large file, as the parent guide [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) notes — is entirely comfortable against PostGIS.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 251" role="img" aria-labelledby="slim-mode-t slim-mode-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="slim-mode-t">What osm2pgsql slim mode stores and why an update is impossible without it</title>
  <desc id="slim-mode-d">Two panels. Without slim mode, osm2pgsql keeps only the rendered output tables; an incoming diff names an object identifier that the database can no longer resolve to a row, so update is impossible and a full reimport is the only path. With slim mode, the middle tables planet_osm_nodes, ways and rels persist the raw object graph, so a diff can look up the affected object, find every way and relation that depends on it, and rebuild just those rows.</desc>
  <rect x="0" y="0" width="880" height="251" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The middle tables are what make an update possible</text>
  <rect x="26" y="52" width="401" height="157" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.5"/>
  <text x="226" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Without --slim</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Output tables only: point, line, polygon</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Raw node coordinates discarded after import</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">A diff names id 240111883 — no row to find</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Dependent ways cannot be identified</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Only recovery: full reimport, many hours</text>
  <rect x="453" y="52" width="401" height="157" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="653" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">With --slim</text>
  <text x="467" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Middle tables: planet_osm_nodes / ways / rels</text>
  <text x="467" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Raw object graph persisted alongside output</text>
  <text x="467" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Diff resolves id → row directly</text>
  <text x="467" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Reverse lookup finds dependent ways and rels</text>
  <text x="467" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Update touches only the affected rows</text>
  <text x="868" y="235" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Budget roughly 40 percent more disk for the middle tables on a country extract, and use --drop only when you have decided this is the last import.</text>
</svg>
<figcaption>Slim mode is not a performance flag; it is the difference between a database that can be updated and one that can only be rebuilt. The extra disk it costs buys the ability to apply a diff at all.</figcaption>
</figure>

The load-bearing requirement is **slim mode**. To turn a diff's `modify way 12345 v8` into the right SQL, the updater must know that way's previous geometry and which rendered rows it produced — it must resolve node references to coordinates and remember prior state. `osm2pgsql --slim` persists that bookkeeping in the `planet_osm_nodes`, `planet_osm_ways`, and `planet_osm_rels` tables; without them the tool has no way to reconstruct the delta and simply refuses to append. `imposm` keeps the equivalent state in its own cache directory. Either way, the update path is: fetch the ordered diffs, apply them with `--append`, and advance the recorded sequence only after the database transaction commits — the same atomic-at-the-state-boundary discipline the [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/) section insists on.

<svg viewBox="4 -3 852 199" role="img" aria-label="Minutely diff loop into PostGIS. A scheduler fires the loop. The loop reads the stored sequence, fetches the minutely diff for the next sequence, and runs osm2pgsql in append slim mode which applies row-level inserts, updates, and deletes to the PostGIS tables. On a committed transaction the sequence is advanced and the loop waits for the next tick." xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Minutely fetch-append-commit loop updating PostGIS in place</title>
  <desc>A scheduler fires a loop that reads the stored sequence, fetches the next minutely diff, and applies it with osm2pgsql append slim mode as row-level changes to PostGIS. After the transaction commits the sequence advances and the loop waits for the next tick.</desc>
  <defs>
    <marker id="pg-diff-arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <rect x="4" y="-3" width="852" height="199" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="480" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Fetch, append in slim mode, commit, advance</text>
  <g transform="translate(0,-70)">
  <!-- fetch -->
  <rect x="20" y="118" width="158" height="70" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="99" y="146" text-anchor="middle" font-size="12.5" font-weight="600" fill="currentColor">Fetch diff</text>
  <text x="99" y="166" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.82">seq + 1 · .osc.gz</text>
  <!-- append -->
  <rect x="242" y="118" width="176" height="70" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="330" y="146" text-anchor="middle" font-size="12.5" font-weight="600" fill="currentColor">osm2pgsql</text>
  <text x="330" y="166" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.82">--append --slim</text>
  <!-- postgis cylinder -->
  <ellipse cx="560" cy="128" rx="66" ry="12" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <path d="M494,128 V186 A66,12 0 0 0 626,186 V128" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="560" y="158" text-anchor="middle" font-size="12.5" font-weight="600" fill="currentColor">PostGIS</text>
  <text x="560" y="176" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">row INS/UPD/DEL</text>
  <!-- advance -->
  <rect x="672" y="118" width="168" height="70" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="756" y="146" text-anchor="middle" font-size="12.5" font-weight="600" fill="currentColor">Advance seq</text>
  <text x="756" y="166" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.82">after commit</text>
  <line x1="178" y1="153" x2="240" y2="153" stroke="currentColor" stroke-width="1.6" marker-end="url(#pg-diff-arrow)"/>
  <line x1="418" y1="153" x2="490" y2="153" stroke="currentColor" stroke-width="1.6" marker-end="url(#pg-diff-arrow)"/>
  <line x1="626" y1="153" x2="670" y2="153" stroke="currentColor" stroke-width="1.6" marker-end="url(#pg-diff-arrow)"/>
  <!-- loop back -->
  <path d="M756,188 V250 H99 V190" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#pg-diff-arrow)"/>
  <text x="430" y="244" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">wait for next minute · repeat</text>
  </g>
</svg>

## Runnable solution

The orchestration below fetches the next span of minutely diffs with `pyosmium-get-changes`, appends them with `osm2pgsql`, and advances a sequence file only when both the fetch and the append succeed. It shells out to the two CLIs so the exact flags used in a manual run are visible and reproducible.

```python
from __future__ import annotations

import logging
import subprocess
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.pg_update")

REPL_URL = "https://planet.openstreetmap.org/replication/minute/"
SEQ_FILE = Path("state.seq")            # last committed sequence
DIFF_FILE = Path("update.osc.gz")       # merged diff for this cycle
STYLE = Path("openstreetmap-carto.style")
DB = "osm"


def read_sequence() -> int:
    return int(SEQ_FILE.read_text().strip())


def fetch_diffs(start: int, max_diffs: int = 120) -> int | None:
    """Fetch up to max_diffs minutely diffs after `start` into one .osc.gz.

    Returns the new head sequence, or None when already current.
    """
    result = subprocess.run(
        ["pyosmium-get-changes", "--server", REPL_URL,
         "--start-id", str(start), "--size", str(max_diffs),
         "-o", str(DIFF_FILE), "--verbose"],
        capture_output=True, text=True,
    )
    if result.returncode == 3:            # pyosmium: nothing new to fetch
        logger.info("no new diffs after sequence %d", start)
        return None
    if result.returncode != 0:
        raise RuntimeError(f"fetch failed: {result.stderr.strip()}")
    # pyosmium-get-changes writes the reached sequence to a sidecar .osc.gz.seq
    return int(Path(str(DIFF_FILE) + ".seq").read_text().strip())


def append_to_postgis() -> None:
    """Apply the fetched diff to PostGIS in slim append mode (single txn)."""
    subprocess.run(
        ["osm2pgsql", "--append", "--slim",
         "--database", DB, "--style", str(STYLE),
         "--number-processes", "4", str(DIFF_FILE)],
        check=True,
    )


def run_once() -> None:
    start = read_sequence()
    head = fetch_diffs(start)
    if head is None:
        return
    append_to_postgis()               # raises on any non-zero exit
    SEQ_FILE.write_text(str(head))    # advance ONLY after append committed
    logger.info("PostGIS updated through sequence %d", head)


if __name__ == "__main__":
    run_once()
```

For an `imposm`-managed schema the append step is a single command instead — `imposm` tracks its own diff state in its cache and reads the replication URL from its config:

```bash
# imposm equivalent: run continuous minutely updates against its own cache.
imposm run -config imposm.json -connection "postgis://osm@localhost/osm"
```

## Step-by-step walkthrough

1. **Read the committed sequence.** `read_sequence` loads the last sequence that was *fully applied and committed*, not merely fetched — the file is the single source of truth for where the database stands.
2. **Fetch a bounded span.** `fetch_diffs` caps the request at `max_diffs` minutely diffs, so a run that fell behind catches up in bounded chunks; return code 3 is `pyosmium-get-changes`'s "already current" signal and exits cleanly.
3. **Append in slim mode.** `append_to_postgis` runs `osm2pgsql --append --slim`, which reads the slim bookkeeping tables to turn each diff operation into the correct row-level SQL against the rendered tables. `--number-processes` parallelizes geometry building.
4. **Commit then advance.** `osm2pgsql` applies the diff in its own transaction; only after it returns success does `run_once` write the new sequence. A crash before the write leaves the database *behind* the sequence file's prior value, which is safe because re-fetching and re-applying is idempotent.
5. **Schedule the loop.** Fire `run_once` every minute from cron or a timer; the scheduling and locking details are the subject of [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/), including how to prevent two runs overlapping.

## Verification

- **Sequence file moved.** After a cycle, `state.seq` holds a higher number and matches the `.osc.gz.seq` sidecar the fetch wrote.
- **Row counts changed.** `SELECT count(*) FROM planet_osm_point;` before and after should differ on an active region; a static count means nothing was appended.
- **A known edit landed.** Pick a recently edited object id and query `planet_osm_line` / `planet_osm_polygon` for it; its geometry or tags should reflect the change.
- **No slim-mode error.** The absence of `Cannot apply diffs to a database that was not imported with --slim` in the log confirms the base import was slim.
- **Timestamps track live.** The `osm2pgsql` replication status (or `imposm`'s log) should report a lag of a few minutes at most under a minutely schedule.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 278" role="img" aria-labelledby="pg-verify-t pg-verify-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="pg-verify-t">Four checks that distinguish a working diff loop from one that only appears to run</title>
  <desc id="pg-verify-d">A grid of four verification checks against what a healthy result and a broken result look like. The stored sequence should advance every tick; if it is unchanged the loop is not committing. Row counts in planet_osm_point should drift by hundreds per hour; a frozen count means the apply is a no-op. The oldest un-applied sequence should stay near zero; a growing value means the loop is slower than the stream. And a spot-checked recently edited object should match the live API; a mismatch means diffs are being skipped.</desc>
  <rect x="0" y="0" width="880" height="278" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four checks, because a stalled loop still logs success</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">healthy</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">broken — and how it looks</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">stored sequence</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">advances every tick</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">unchanged: commit never ran</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">row counts</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">drifts by 100s/hour</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">frozen: apply is a no-op</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">replication lag</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">under 2 minutes</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">growing: loop slower than stream</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">spot-check vs API</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">object matches live</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">differs: diffs being skipped</text>
  <text x="440" y="260" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Wire the first three into your metrics; run the fourth by hand after any change to the loop.</text>
</svg>
<figcaption>Three of these four look identical to a healthy pipeline in the logs. Checking the stored sequence alone is what lets a silently no-op loop run for weeks.</figcaption>
</figure>

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| `Cannot apply diffs ... not imported with --slim` | Base import ran without `--slim` | Reimport once with `--slim`; updates then work in place |
| Sequence advances but rows unchanged | Advanced state before append committed | Write `state.seq` only after `osm2pgsql` exits 0 |
| `osm2pgsql` exits with a lock error | A previous run still holds the database | Serialize runs with a lock; never overlap cycles |
| Geometry missing after update | `--style` differs from the original import | Reuse the exact style file the base import used |
| Fetch returns nothing repeatedly | `--start-id` past the stream head | Confirm the stored sequence is not ahead of `state.txt` |
| Disk fills during append | Slim tables plus WAL growth | Provision for ~2x import size; tune PostgreSQL checkpoints |
| Updates fall progressively behind | Per-diff overhead exceeds one minute | Raise `--number-processes` or batch several diffs per cycle |

## Specification reference

> Incremental updates require the slim schema and the append mode. See the official [osm2pgsql updating documentation](https://osm2pgsql.org/doc/manual.html#updating-an-existing-database) for the `--append --slim` requirement and the middle-table bookkeeping, and the [imposm3 documentation](https://imposm.org/docs/imposm3/latest/) for its equivalent diff-update workflow and cache. The replication directory and `state.txt` format the fetch reads are documented on the [OSM Wiki "Planet.osm/diffs"](https://wiki.openstreetmap.org/wiki/Planet.osm/diffs) page.

## Frequently Asked Questions

<details>
<summary>Why must the database be imported in slim mode to apply diffs?</summary>

Applying a modify or delete requires knowing an object's previous state — its node coordinates and which rendered rows it produced. `osm2pgsql --slim` persists that bookkeeping in middle tables; without them the tool cannot reconstruct the delta and refuses to append. A non-slim import can only ever be fully reimported, never updated in place.
</details>

<details>
<summary>Can I apply minutely diffs to a file instead of a database?</summary>

You can, but every diff rewrites the entire PBF, so a minutely cadence against a large file spends almost all its time on I/O. A database applies only the changed rows, so update cost tracks change volume rather than database size — which is exactly why PostGIS suits minutely tracking and a file does not.
</details>

<details>
<summary>What happens if the update loop crashes mid-cycle?</summary>

If `osm2pgsql` fails or the process dies before the sequence file is written, the database stays at the prior committed sequence. The next run re-fetches from that sequence and re-applies, which is idempotent under version-numbered whole-object replacement, so no data is lost or double-counted. Advancing the sequence only after commit is what guarantees this.
</details>

<details>
<summary>Should I use osm2pgsql or imposm for updates?</summary>

Both apply diffs incrementally and keep their own bookkeeping — `osm2pgsql` in slim middle tables, `imposm` in a cache directory. Choose `osm2pgsql` when your rendering stack already depends on its schema and style files; choose `imposm` when you want its custom mapping configuration and built-in continuous `run` mode. The diff semantics are identical.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Why must the database be imported in slim mode to apply diffs?",
      "acceptedAnswer": { "@type": "Answer", "text": "Applying a modify or delete requires knowing an object's previous state — its node coordinates and which rendered rows it produced. osm2pgsql --slim persists that bookkeeping in middle tables; without them the tool cannot reconstruct the delta and refuses to append. A non-slim import can only be fully reimported, never updated in place." }
    },
    {
      "@type": "Question",
      "name": "Can I apply minutely diffs to a file instead of a database?",
      "acceptedAnswer": { "@type": "Answer", "text": "You can, but every diff rewrites the entire PBF, so a minutely cadence against a large file spends almost all its time on I/O. A database applies only the changed rows, so update cost tracks change volume rather than database size, which is why PostGIS suits minutely tracking and a file does not." }
    },
    {
      "@type": "Question",
      "name": "What happens if the update loop crashes mid-cycle?",
      "acceptedAnswer": { "@type": "Answer", "text": "If osm2pgsql fails or the process dies before the sequence file is written, the database stays at the prior committed sequence. The next run re-fetches from that sequence and re-applies, which is idempotent under version-numbered whole-object replacement, so no data is lost or double-counted. Advancing the sequence only after commit is what guarantees this." }
    },
    {
      "@type": "Question",
      "name": "Should I use osm2pgsql or imposm for updates?",
      "acceptedAnswer": { "@type": "Answer", "text": "Both apply diffs incrementally and keep their own bookkeeping — osm2pgsql in slim middle tables, imposm in a cache directory. Choose osm2pgsql when your rendering stack depends on its schema and style files; choose imposm when you want its custom mapping configuration and built-in continuous run mode. The diff semantics are identical." }
    }
  ]
}
</script>

## Related

- [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) — the diff-application semantics that also govern the database path.
- [Catching Up a Stale OSM Extract with pyosmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/catching-up-a-stale-osm-extract-with-pyosmium/) — the file-based counterpart and the fetch tooling reused here.
- [Replication Sequence Numbers and State](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) — where the database's tracked sequence comes from.
- [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/) — scheduling and locking the loop shown here.
- [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) — keeping spatial indexes current as rows change.

Up one level: [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Applying Minutely Diffs to a PostGIS Database",
  "description": "Keep an osm2pgsql or imposm PostGIS database current by appending minutely OSM diffs incrementally, using slim mode and a small fetch-and-append orchestration loop.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Replication & Diff Sync",
  "about": ["osm2pgsql append slim", "PostGIS OSM updates", "minutely diff pipeline"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Replication & Diff Sync", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/" },
    { "@type": "ListItem", "position": 3, "name": "Applying .osc Change Files with osmium", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/" },
    { "@type": "ListItem", "position": 4, "name": "Applying Minutely Diffs to a PostGIS Database", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/applying-minutely-diffs-to-a-postgis-database/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Apply minutely OSM diffs to a PostGIS database",
  "description": "Append minutely OsmChange diffs to an osm2pgsql PostGIS database incrementally in slim mode, advancing the sequence only after each transaction commits.",
  "step": [
    { "@type": "HowToStep", "name": "Confirm a slim import", "text": "Verify the base database was imported with osm2pgsql --slim so the middle bookkeeping tables exist and updates are possible." },
    { "@type": "HowToStep", "name": "Read the committed sequence", "text": "Load the last fully applied and committed replication sequence from the state file." },
    { "@type": "HowToStep", "name": "Fetch the next diffs", "text": "Use pyosmium-get-changes to fetch a bounded span of minutely diffs after the stored sequence into one .osc.gz." },
    { "@type": "HowToStep", "name": "Append in slim mode", "text": "Run osm2pgsql --append --slim with the original style file to apply the diff as row-level inserts, updates, and deletes." },
    { "@type": "HowToStep", "name": "Advance after commit", "text": "Write the new sequence to the state file only after osm2pgsql exits successfully, so a crash leaves the database safely behind the sequence." }
  ]
}
</script>
