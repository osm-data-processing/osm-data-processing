---
title: "Incremental OSM Loads into DuckDB"
description: "Merge a change file into an existing OSM table instead of reloading: resolve affected features, upsert and delete in one transaction, and make the load idempotent."
pageTitle: "Merging OSM Diffs into DuckDB Without a Full Reload"
pageDescription: "Apply an OSM change file to a warehouse table with an idempotent merge: collect affected identifiers, rebuild only those features, upsert and tombstone in one transaction, and record the sequence."
slug: incremental-osm-loads-into-duckdb
type: article
breadcrumb: "Incremental Loads"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Incremental OSM Loads into DuckDB

A daily reload of a country extract is an hour of work to change a fraction of a percent of rows. The alternative is not complicated, but it has one requirement people underestimate: the load must be safe to run twice.

## Prerequisites

- [ ] DuckDB, or any engine with an upsert and a transaction; the shape transfers.
- [ ] A schema to load into, per [Designing a Star Schema for OSM Features](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/designing-a-star-schema-for-osm-features/).
- [ ] A change file and the state that produced it, per [Replication Sequence Numbers & State](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/).
- [ ] A local copy of the extract the diff applies to, since rebuilding a feature needs its current members.
- [ ] Python 3.10+ with `duckdb` and a change-file reader.

## Conceptual minimum

A change file lists created, modified and deleted elements. Turning that into a table update needs three steps, and the middle one is the subtle part.

**Collect the affected features.** Not just the changed elements: a moved node changes the geometry of every way referencing it, and a changed way changes every relation containing it. The affected set is the changed elements plus their dependents, which requires the reverse references.

**Rebuild, do not patch.** For each affected feature, rebuild its row from current data rather than applying a delta to the stored row. Rebuilding is idempotent and delta application is not, and the cost difference is negligible because the affected set is small.

**Apply atomically.** Upserts and deletes for one change file go in one transaction, with the sequence number recorded in the same transaction. That is what makes the load safe to retry: either the data and the state both advanced, or neither did.

The idempotence requirement is worth stating plainly: **running the same change file twice must leave the table identical**. Retries happen, and a load that double-counts on retry is worse than one that fails.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="iod1-t iod1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="iod1-t">The four stages of applying one change file</title>
  <desc id="iod1-d">Four stages. The collect stage reads the change file and gathers the identifiers of changed elements plus every feature that depends on them, since a moved node changes the geometry of the ways using it. The rebuild stage reconstructs each affected feature from current data rather than applying a delta, which makes the operation idempotent. The apply stage performs upserts and deletions in a single transaction. The record stage writes the new replication sequence number inside that same transaction, so data and state advance together or not at all.</desc>
  <defs><marker id="iod1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Collect, rebuild, apply, record — one transaction</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">collect</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">changed plus dependents</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">reverse references</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#iod1-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">rebuild</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">from current data</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">never a delta</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#iod1-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">apply</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">upsert and delete</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">one transaction</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#iod1-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">record</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">sequence in the same</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">both or neither</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Recording the sequence outside the transaction is how a pipeline ends up believing it applied a change file it did not.</text>
</svg>
<figcaption>Rebuilding rather than patching is what makes a retry harmless, which matters because retries are routine.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

import duckdb

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.warehouse.incremental")


@dataclass
class ChangeSet:
    sequence: int
    created: set[tuple[str, int]] = field(default_factory=set)
    modified: set[tuple[str, int]] = field(default_factory=set)
    deleted: set[tuple[str, int]] = field(default_factory=set)

    @property
    def touched(self) -> set[tuple[str, int]]:
        return self.created | self.modified | self.deleted


def dependents(conn: duckdb.DuckDBPyConnection,
               touched: set[tuple[str, int]]) -> set[tuple[str, int]]:
    """Features whose geometry depends on a changed element.

    A moved node changes every way that references it, and a changed way
    changes every relation containing it. Missing this leaves stale geometry
    on features the change file never mentions.
    """
    nodes = [i for t, i in touched if t == "node"]
    ways = [i for t, i in touched if t == "way"]
    affected: set[tuple[str, int]] = set()

    if nodes:
        rows = conn.execute(
            "SELECT DISTINCT 'way', way_id FROM way_node WHERE node_id IN "
            "(SELECT UNNEST(?))", [nodes]).fetchall()
        affected.update((t, i) for t, i in rows)
    if ways or affected:
        candidate_ways = ways + [i for t, i in affected if t == "way"]
        rows = conn.execute(
            "SELECT DISTINCT 'relation', relation_id FROM relation_member "
            "WHERE member_type = 'way' AND member_id IN (SELECT UNNEST(?))",
            [candidate_ways]).fetchall()
        affected.update((t, i) for t, i in rows)

    logger.info("%d touched element(s) affect %d additional feature(s)",
                len(touched), len(affected - touched))
    return affected


def apply_change(conn: duckdb.DuckDBPyConnection, change: ChangeSet,
                 rebuild: callable) -> None:
    """Apply one change file atomically, including the sequence number."""
    expected = conn.execute(
        "SELECT sequence FROM replication_state").fetchone()[0]
    if change.sequence <= expected:
        # Already applied. Idempotence means this is a no-op, not an error.
        logger.info("sequence %d already applied (state is %d); skipping",
                    change.sequence, expected)
        return
    if change.sequence != expected + 1:
        raise ValueError(f"sequence gap: state is {expected}, file is "
                         f"{change.sequence}; catch up before applying")

    affected = change.created | change.modified
    affected |= dependents(conn, change.touched) - change.deleted
    rows = [rebuild(osm_type, osm_id) for osm_type, osm_id in sorted(affected)]
    rows = [r for r in rows if r is not None]

    conn.execute("BEGIN TRANSACTION")
    try:
        if rows:
            conn.executemany("""
                INSERT INTO fact_feature
                  (feature_key, snapshot_key, class_key, area_key, osm_type,
                   osm_id, osm_version, name, geom, area_m2, length_m, tags)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (feature_key) DO UPDATE SET
                  class_key = excluded.class_key, area_key = excluded.area_key,
                  osm_version = excluded.osm_version, name = excluded.name,
                  geom = excluded.geom, area_m2 = excluded.area_m2,
                  length_m = excluded.length_m, tags = excluded.tags
            """, rows)
        if change.deleted:
            conn.executemany(
                "DELETE FROM fact_feature WHERE osm_type = ? AND osm_id = ?",
                sorted(change.deleted))
        # The sequence advances INSIDE the transaction: data and state together.
        conn.execute("UPDATE replication_state SET sequence = ?",
                     [change.sequence])
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise

    logger.info("sequence %d: %d upsert(s), %d deletion(s)",
                change.sequence, len(rows), len(change.deleted))


if __name__ == "__main__":
    logger.info("rebuild affected features from current data, never from deltas")
```

## Step-by-step walkthrough

1. **Check the sequence before doing anything.** An already-applied file is skipped rather than failing, because a retry after a network error is routine and should be harmless.
2. **Refuse a gap.** A file whose sequence is more than one ahead means diffs were missed, and applying it leaves the table silently inconsistent with the map.
3. **Expand to dependents.** A moved node changes every way that uses it, and a change file does not mention those ways. Skipping this leaves stale geometry on features nothing appeared to touch.
4. **Exclude deleted features from the rebuild set.** A dependent that was itself deleted should not be reconstructed.
5. **Rebuild whole rows.** Reconstructing from current data makes the operation idempotent; applying deltas to stored rows does not, and the affected set is small enough that the difference in cost is immaterial.
6. **Use an upsert, not an insert.** A created element may already be present if a previous run partially succeeded, and an upsert handles both cases identically.
7. **Advance the sequence inside the transaction.** This is the single most important line: data and state commit together, so a crash leaves both at the old value and the retry is clean.
8. **Sort before applying.** Deterministic ordering makes two runs over the same input produce identical write patterns, which matters when comparing logs.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 248" role="img" aria-labelledby="iod2-t iod2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="iod2-t">Rows touched by one minutely change file, by stage</title>
  <desc id="iod2-d">Four counts for a single minutely diff over a country-sized table. The change file itself names a few thousand elements. Expanding to ways whose nodes moved roughly triples that. Adding relations containing changed ways adds a smaller increment. The final upsert count remains a tiny fraction of the table's tens of millions of rows, which is the entire argument for loading incrementally rather than reloading.</desc>
  <rect x="0" y="0" width="880" height="248" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">A minutely diff against a table of tens of millions</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Elements in the change file</text>
  <rect x="256" y="60" width="6" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 3,100</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Plus dependent ways</text>
  <rect x="256" y="100" width="6" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 9,400</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Plus dependent relations</text>
  <rect x="256" y="140" width="6" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 10,200</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Rows in the table</text>
  <rect x="256" y="180" width="478" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">tens of millions</text>
  <text x="868" y="232" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The dependent expansion roughly triples the work and is not optional: skipping it leaves stale geometry nothing appears to have touched.</text>
</svg>
<figcaption>Even after expansion the affected set is a rounding error against the table, which is why a full reload is so wasteful.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="iod3-t iod3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="iod3-t">Three ways an incremental load diverges from the map without erroring</title>
  <desc id="iod3-d">Three panels. Skipping dependent expansion leaves ways whose nodes moved carrying stale geometry, which nothing in the change file pointed at and no error reports. Writing the sequence outside the transaction lets data and state disagree after a crash, so a change is either applied twice or skipped forever. Applying across a sequence gap leaves some features at a recent state and others frozen at an older one, producing a table describing a moment the map never passed through.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three divergences, none of which raises</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">No dependent expansion</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Ways keep old geometry</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Nothing pointed at them</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">No error anywhere</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Found by a visual check</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">State outside the transaction</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Crash between the two</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Applied twice, or never</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Depends on the order</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Found much later</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Gap applied anyway</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Some rows recent</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Others frozen</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">A state that never existed</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Impossible to reason about</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Each is prevented by one line, and each is discovered weeks later by somebody comparing the table against the live map.</text>
</svg>
<figcaption>The third is the worst because there is no consistent moment the table corresponds to, so no comparison can diagnose it.</figcaption>
</figure>

## Verification

- **Re-applying is a no-op.** Run the same change file twice and confirm the second run skips and the table is byte-identical.
- **A gap is refused.** Skip a sequence deliberately and confirm the load raises rather than proceeding.
- **Dependents are updated.** Move a node in a test diff and confirm the ways referencing it have new geometry.
- **State and data agree.** After an interrupted load, the recorded sequence must correspond to the data actually present.
- **Counts reconcile.** Compare the table's feature count against the same count from a full reload of the caught-up extract.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Stale geometry after a node move | Dependents not expanded | Resolve reverse references for changed nodes and ways |
| Retry double-counts | Deltas applied rather than rows rebuilt | Rebuild whole rows from current data |
| State ahead of the data | Sequence written outside the transaction | Update the sequence inside the same transaction |
| Load fails on a re-run | Insert used instead of upsert | Use an upsert keyed on the feature key |
| Silent divergence from the map | A sequence gap applied anyway | Refuse anything other than the next sequence |
| Deleted features reappear | Dependents rebuilt after deletion | Exclude deleted elements from the rebuild set |
| Write patterns differ between runs | Unordered application | Sort the affected set before applying |

## Specification reference

> A change file contains `create`, `modify` and `delete` blocks describing element-level changes between two replication states, identified by a sequence number. Applying one to a derived dataset requires resolving which derived rows depend on the changed elements, since the file describes elements rather than features. See [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) for the file format and [Replication Sequence Numbers & State](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) for the state model.

## Frequently Asked Questions

<details>
<summary>Why rebuild features rather than patching them?</summary>

Because rebuilding is idempotent and patching is not. Applying the same delta twice double-applies it, which turns a routine retry into silent corruption; rebuilding a row from current data produces the same result however many times it runs. The cost argument that favours patching does not apply here, because the affected set after one change file is a few thousand rows against a table of tens of millions.
</details>

<details>
<summary>Why does a change file not mention every affected feature?</summary>

Because it describes elements and your table describes features. When a mapper drags a node, the change file contains that node and nothing else — but every way whose geometry includes it now has different geometry, and every relation containing those ways may too. Resolving those reverse references is the step that turns an element-level change into a feature-level one, and skipping it leaves stale geometry that nothing appears to have touched.
</details>

<details>
<summary>Why must the sequence number be updated inside the transaction?</summary>

So that the data and the record of what has been applied cannot disagree. If the sequence is written after the commit, a crash in between leaves data applied and state unaware, and the retry applies it again. If it is written before, a failed commit leaves state ahead of the data and the change is silently skipped forever. Inside the transaction, both advance or neither does.
</details>

<details>
<summary>What should happen when a sequence is skipped?</summary>

The load should refuse. A gap means diffs were missed, and applying a later one leaves the table describing a state the map never passed through — some features updated to a recent state and others frozen at an older one, with nothing indicating which. Catching up through the missing sequences, or reloading from a fresh extract, are the only two correct responses.
</details>

## Related

- [Modelling OSM for Analytics Warehouses](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/) — the parent topic and the load strategy this implements.
- [Designing a Star Schema for OSM Features](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/designing-a-star-schema-for-osm-features/) — the table this merges into.
- [Incremental Updates for Derived Datasets](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/) — the same pattern across other output kinds.
- [Applying Minutely Diffs to a PostGIS Database](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/applying-minutely-diffs-to-a-postgis-database/) — the equivalent for a spatial database.
- [Recovering from a Replication Sequence Gap](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/recovering-from-a-replication-sequence-gap/) — what to do when the gap check fires.

Up one level: [Modelling OSM for Analytics Warehouses](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Incremental OSM Loads into DuckDB",
  "description": "Merge a change file into an existing OSM table instead of reloading: resolve affected features, upsert and delete in one transaction, and make the load idempotent.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["incremental loading", "idempotent merge", "dependent features"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Parsing & Tag Normalization Workflows", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/" },
    { "@type": "ListItem", "position": 3, "name": "Modelling OSM for Analytics Warehouses", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/" },
    { "@type": "ListItem", "position": 4, "name": "Incremental OSM Loads into DuckDB", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/incremental-osm-loads-into-duckdb/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Apply an OSM change file to a warehouse table incrementally",
  "description": "Check the sequence, expand changed elements to their dependent features, rebuild whole rows from current data, upsert and delete in one transaction, and advance the sequence inside it.",
  "step": [
    { "@type": "HowToStep", "name": "Check the sequence first", "text": "Skip an already-applied file and refuse one that leaves a gap, so retries are harmless and missed diffs are visible." },
    { "@type": "HowToStep", "name": "Expand to dependents", "text": "Resolve which ways reference changed nodes and which relations contain changed ways, since the file names only elements." },
    { "@type": "HowToStep", "name": "Exclude deletions from the rebuild", "text": "Remove deleted elements from the set to be reconstructed so they are not resurrected." },
    { "@type": "HowToStep", "name": "Rebuild whole rows", "text": "Reconstruct each affected feature from current data rather than applying a delta, which makes the load idempotent." },
    { "@type": "HowToStep", "name": "Upsert rather than insert", "text": "Use a conflict-handling insert so a partially completed previous run does not cause a failure." },
    { "@type": "HowToStep", "name": "Advance the sequence in the transaction", "text": "Write the new replication state in the same transaction as the data, so both commit or neither does." }
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
      "name": "Why rebuild OSM features rather than patching them?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because rebuilding is idempotent and patching is not. Applying the same delta twice double-applies it, turning a routine retry into silent corruption; rebuilding from current data produces the same result however many times it runs. The cost argument for patching does not apply, since the affected set is a few thousand rows against tens of millions." }
    },
    {
      "@type": "Question",
      "name": "Why does an OSM change file not mention every affected feature?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because it describes elements and your table describes features. When a mapper drags a node, the file contains that node alone — but every way whose geometry includes it now differs. Resolving those reverse references turns an element-level change into a feature-level one, and skipping it leaves stale geometry nothing appears to have touched." }
    },
    {
      "@type": "Question",
      "name": "Why must the replication sequence be updated inside the transaction?",
      "acceptedAnswer": { "@type": "Answer", "text": "So data and the record of what has been applied cannot disagree. Written after the commit, a crash leaves data applied and state unaware, so the retry applies it again. Written before, a failed commit leaves state ahead and the change is skipped forever. Inside the transaction, both advance or neither does." }
    },
    {
      "@type": "Question",
      "name": "What should happen when an OSM replication sequence is skipped?",
      "acceptedAnswer": { "@type": "Answer", "text": "The load should refuse. A gap means diffs were missed, and applying a later one leaves the table describing a state the map never passed through, with some features recent and others frozen. Catching up through the missing sequences, or reloading from a fresh extract, are the only correct responses." }
    }
  ]
}
</script>
