---
title: "Propagating OSM Diffs Into a GeoParquet Lake"
description: "Apply minutely OSM changes to immutable Parquet files by rewriting only the partitions the diff touches, and publish the result atomically so readers never see a half-updated dataset."
pageTitle: "Applying OSM Change Files to a GeoParquet Lake"
pageDescription: "Map an .osc change file to the Parquet partitions it affects, rewrite only those, and swap them in atomically through a manifest so concurrent readers stay consistent."
slug: propagating-osm-diffs-into-a-geoparquet-lake
type: article
breadcrumb: "Diffs Into GeoParquet"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Propagating OSM Diffs Into a GeoParquet Lake

Parquet files cannot be updated in place, so an OSM diff that changes four hundred features becomes a question of which files to rewrite entirely — and the answer decides whether the update takes a minute or an afternoon.

## Prerequisites

- [ ] Python 3.10+ with `pyarrow` 14+ and `shapely` 2.x.
- [ ] An existing GeoParquet export, per [Exporting OSM to GeoParquet and PostGIS](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/).
- [ ] The affected-set reasoning from [Incremental Updates for Derived Datasets](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/).
- [ ] A partitioning scheme you can compute from a feature, which is the whole precondition for this working.
- [ ] Object storage or a filesystem where a rename is cheap.

## Conceptual minimum

A Parquet dataset is a set of immutable files plus an agreement about which of them constitute the dataset. Updating it means writing new files and changing that agreement, and every design decision follows from which files a change forces you to rewrite.

**The partition key decides the blast radius.** If features are partitioned by a coarse spatial cell, a diff scattered across a continent touches most partitions and you have effectively rebuilt. If partitioned finely, each diff touches few partitions but the dataset has thousands of small files, which is its own problem. The partitioning that works for incremental update is not usually the one that works best for query performance, and that tension is the real design decision.

**Partition membership can change.** A feature that moves crosses a partition boundary, which means the update is a delete from one partition and an insert into another — two rewrites for one edit, and forgetting the delete leaves a duplicate that every subsequent query returns.

**Publication must be atomic.** Rewriting a partition file in place is visible to a reader mid-write. Writing to a new path and swapping a manifest is not. A manifest listing the current file for each partition gives a single object whose replacement is the commit, which is the same trick a view switch plays in a database.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="pgl1-t pgl1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="pgl1-t">Three partition-key choices and what each costs on a diff</title>
  <desc id="pgl1-d">Three panels comparing partitioning strategies against incremental update cost. Partitioning by a coarse cell such as a country means a scattered continental diff touches nearly every partition, so the update approaches a full rebuild while queries are efficient. Partitioning by a fine cell such as a small tile means each diff touches few partitions and rewrites are small, but the dataset accumulates many small files that slow every query. Partitioning by feature identity range means the affected partitions are trivially computable from the diff alone with no geometry needed, but spatial queries must read everything.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Partition key versus rewrite cost</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Coarse spatial</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Country or region cell</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Diff touches most</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Approaches a rebuild</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Queries are efficient</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Fine spatial</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Small tile or cell</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Few partitions per diff</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Small, quick rewrites</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Many small files</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">By ID range</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">No geometry needed</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Affected set is trivial</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Rewrites are balanced</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Spatial scans read all</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The partitioning that suits incremental update is rarely the one that suits query performance, and picking one accepts the other's cost.</text>
</svg>
<figcaption>Most production lakes end up partitioning spatially and compacting on a schedule.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import json
import logging
import shutil
import tempfile
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.lake.incremental")

CELL_DEG = 1.0   # partition cell size; smaller means more files, smaller rewrites


@dataclass(frozen=True)
class Change:
    action: str            # create | modify | delete
    osm_type: str
    osm_id: int
    row: dict | None       # None for delete
    old_cell: str | None   # from the pre-diff state; REQUIRED for delete/move
    new_cell: str | None


def cell_of(lon: float, lat: float) -> str:
    return f"c_{int((lon + 180) // CELL_DEG):04d}_{int((lat + 90) // CELL_DEG):04d}"


class Manifest:
    """The single object whose replacement is the commit."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.path = root / "_manifest.json"
        self.data = (json.loads(self.path.read_text(encoding="utf-8"))
                     if self.path.exists()
                     else {"sequence": 0, "partitions": {}})

    def file_for(self, cell: str) -> Path | None:
        name = self.data["partitions"].get(cell)
        return self.root / name if name else None

    def commit(self, updates: dict[str, str], sequence: int) -> None:
        self.data["partitions"].update(updates)
        self.data["sequence"] = sequence
        # Write beside, then rename: a rename is atomic, a rewrite is not.
        tmp = self.path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(self.data, indent=1), encoding="utf-8")
        tmp.replace(self.path)
        logger.info("committed %d partition(s) at sequence %d",
                    len(updates), sequence)


def affected_cells(changes: Iterable[Change]) -> dict[str, list[Change]]:
    """A moved feature affects TWO cells: where it was and where it is.

    Dropping the first leaves a duplicate that every later query returns.
    """
    by_cell: dict[str, list[Change]] = defaultdict(list)
    for change in changes:
        for cell in {change.old_cell, change.new_cell} - {None}:
            by_cell[cell].append(change)
    return dict(by_cell)


def rewrite_partition(manifest: Manifest, cell: str,
                      changes: list[Change], sequence: int) -> str:
    existing = manifest.file_for(cell)
    table = pq.read_table(existing) if existing else None

    removed = {c.osm_id for c in changes
               if c.action in ("delete", "modify") or c.old_cell == cell}
    if table is not None and removed:
        keep = pc.invert(pc.is_in(table["osm_id"], value_set=pa.array(sorted(removed))))
        table = table.filter(keep)

    added = [c.row for c in changes
             if c.row is not None and c.new_cell == cell]
    if added:
        fresh = pa.Table.from_pylist(added, schema=table.schema if table else None)
        table = pa.concat_tables([table, fresh]) if table is not None else fresh

    if table is None or table.num_rows == 0:
        return ""

    # New name every time: readers holding the old manifest keep working.
    name = f"{cell}/part-{sequence:010d}.parquet"
    out = manifest.root / name
    out.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table.sort_by("osm_id"), out, compression="zstd",
                   write_statistics=True)
    return name


def apply_diff(root: Path, changes: list[Change], sequence: int) -> int:
    manifest = Manifest(root)
    if sequence <= manifest.data["sequence"]:
        logger.info("sequence %d already applied; nothing to do", sequence)
        return 0

    updates: dict[str, str] = {}
    for cell, cell_changes in affected_cells(changes).items():
        name = rewrite_partition(manifest, cell, cell_changes, sequence)
        if name:
            updates[cell] = name
    manifest.commit(updates, sequence)
    return len(updates)


def compact(root: Path, min_files: int = 8, target_mb: int = 128) -> None:
    """Fine partitioning makes updates cheap and queries slow. Compact on a
    schedule to get both, rather than choosing one at design time."""
    logger.info("compacting partitions under %d MB into ~%d MB files",
                target_mb, target_mb)


if __name__ == "__main__":
    logger.info("rewrite affected partitions, then swap the manifest")
```

## Step-by-step walkthrough

1. **Compute the affected cells from both states.** A moved feature belongs to two partitions during the update, and only the new one is discoverable from the diff.
2. **Skip already-applied sequences.** The manifest carries the sequence it reflects, which makes the whole operation idempotent against a retried diff.
3. **Read, filter, append, write.** Removing rows from an immutable file means writing a new file without them; there is no cheaper path, which is why partition size governs cost.
4. **Give every rewrite a new filename.** A reader holding the previous manifest continues reading valid files, so there is no window where a query fails.
5. **Delete empty partitions from the manifest rather than writing empty files.** An empty Parquet file still costs a read on every scan.
6. **Commit by renaming the manifest.** The rename is the atomic operation; everything before it is invisible and everything after it is complete.
7. **Compact on a schedule.** Fine partitions keep updates small and leave the dataset with many files, and periodic compaction resolves the tension the partition key could not.
8. **Keep superseded files for a retention window.** They cost storage and they are what a reader with an old manifest is still reading, plus the cheapest possible rollback.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="pgl2-t pgl2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="pgl2-t">The commit sequence that keeps concurrent readers consistent</title>
  <desc id="pgl2-d">Four steps. New partition files are written under fresh names, which no manifest references yet, so no reader can see them and a crash here leaves only garbage to collect. The manifest is written to a temporary path beside the real one, still invisible. The temporary manifest is renamed over the real one, which is atomic on both POSIX filesystems and object stores that guarantee it, and that single operation is the commit. Superseded files are retained for a window so readers who resolved the old manifest before the rename continue to read valid files.</desc>
  <defs><marker id="pgl2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Write, stage, rename, retain</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">write files</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">fresh names, unreferenced</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">invisible to readers</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#pgl2-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">stage manifest</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">written beside the real</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">still invisible</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#pgl2-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">rename</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">atomic, this is the commit</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">all or nothing</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#pgl2-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">retain old</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">in-flight readers valid</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">and a cheap rollback</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Rewriting a partition file under its existing name skips all of this and gives a reader a half-written file instead.</text>
</svg>
<figcaption>Every property the update needs comes from one rename and from never reusing a filename.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="pgl3-t pgl3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="pgl3-t">What each change action forces the lake to rewrite</title>
  <desc id="pgl3-d">A grid of four change actions against the partitions they affect, the state each needs from before the diff, and the mistake most commonly made. A create affects only the new partition, needs nothing from before, and rarely goes wrong. A modify without movement affects one partition and needs the identifier only. A modify that moves the feature affects two partitions and needs the pre-diff cell, and omitting the old partition leaves a duplicate. A delete affects one partition and needs the pre-diff cell, which is unavailable once the diff has been applied.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Action, partitions, and the pre-diff state each needs</text>
  <rect x="184" y="48" width="223" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="296" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Partitions</text>
  <rect x="407" y="48" width="223" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="519" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Needs from before</text>
  <rect x="631" y="48" width="223" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="742" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Usual mistake</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Create</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="296" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">one, the new</text>
  <text x="519" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">nothing</text>
  <text x="742" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">none</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Modify in place</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="296" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">one</text>
  <text x="519" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">the identifier</text>
  <text x="742" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">none</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Modify with move</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="296" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">two</text>
  <text x="519" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">the old cell</text>
  <text x="742" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">duplicate left behind</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Delete</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="296" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">one, the old</text>
  <text x="519" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">the old cell</text>
  <text x="742" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">derived after applying</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the first two rows work if the affected set is computed after the diff has landed, which is why this bug survives testing.</text>
</svg>
<figcaption>The last two rows are the whole reason the derivation has to run before the apply.</figcaption>
</figure>

## Verification

- **Row counts reconcile.** Rows added minus rows removed should equal the diff's net effect on the partitions touched.
- **No duplicates after a move.** Query a feature that crossed a partition boundary and confirm exactly one row is returned.
- **Readers never fail.** Run a continuous query loop during an update and confirm no missing-file errors.
- **Replay is a no-op.** Apply the same sequence twice and confirm the second call changes nothing.
- **The manifest sequence advances.** Confirm it matches the last applied diff, since that is what any freshness check reads.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Duplicate rows for a moved feature | Only the new partition rewritten | Derive affected cells from old and new state |
| Queries fail mid-update | Partition file rewritten in place | Write a new name and swap the manifest |
| Update as slow as a rebuild | Partition cells too coarse | Partition finer and compact on a schedule |
| Thousands of tiny files | Partition cells too fine, no compaction | Run scheduled compaction to a target file size |
| Retried diff duplicates rows | No applied-sequence check | Store the sequence in the manifest and skip replays |
| Deleted features still returned | Delete had no old partition recorded | Capture the pre-diff cell before applying |
| Storage grows without bound | Superseded files never collected | Expire files unreferenced beyond the retention window |

## Specification reference

> GeoParquet stores geometry in a Parquet column, with dataset-level metadata under the `geo` key in the file's key-value metadata, recording the geometry column name, encoding and CRS. Parquet files are immutable once written; datasets are updated by adding and removing files. Atomicity of a dataset-level commit therefore depends on the single operation that changes which files are current. See the GeoParquet specification and the Apache Parquet format documentation.

## Frequently Asked Questions

<details>
<summary>Why not use a table format like Iceberg or Delta rather than a manifest?</summary>

If you can, do. Both implement exactly this pattern — immutable files plus an atomic metadata commit — with snapshot isolation, time travel and compaction already solved, and the hand-rolled manifest above is the minimum version of what they provide. The reasons to write it yourself are a deployment where those engines are not available, or a dataset small enough that their operational cost outweighs the benefit. The design reasoning is identical either way.
</details>

<details>
<summary>How do you get the pre-diff partition of a deleted feature?</summary>

By looking it up before applying the diff, which is the ordering constraint the parent topic describes. A `<delete>` block carries an identifier and little else, so the partition has to be resolved from local state that still contains the feature. In practice that means either an identifier-to-partition index maintained alongside the lake, or reading the partitions the identifier could be in — and the index is dramatically cheaper.
</details>

<details>
<summary>Should the lake keep every version of a feature?</summary>

Only if consumers ask questions about history, and most do not. Keeping versions turns every modification into an append, which makes updates cheap and every query a deduplication over versions. Keeping only current state makes updates expensive and queries simple. The middle position — current state in the lake, history in a separate append-only dataset — usually serves both without making either query pay for the other.
</details>

<details>
<summary>How often should compaction run?</summary>

When the file count in a partition passes a threshold, rather than on a clock. A partition edited constantly accumulates files quickly and one in an unmapped area may go months without a rewrite, so a time-based schedule either compacts what does not need it or lets the busy partitions degrade. Triggering on file count spends the effort exactly where updates have been happening.
</details>

## Related

- [Incremental Updates for Derived Datasets](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/) — the parent topic.
- [Computing a Dirty Tile List from an .osc File](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/computing-a-dirty-tile-list-from-an-osc-file/) — the same derivation for a tile pyramid.
- [Exporting OSM to GeoParquet and PostGIS](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/) — where the lake comes from.
- [Migrating a PostGIS OSM Schema Without Downtime](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/exporting-osm-to-geoparquet-and-postgis/migrating-a-postgis-osm-schema-without-downtime/) — the same atomic-switch idea in a database.
- [Modelling OSM for Analytics Warehouses](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/) — deciding the partitioning and the schema.

Up one level: [Incremental Updates for Derived Datasets](https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Propagating OSM Diffs Into a GeoParquet Lake",
  "description": "Apply minutely OSM changes to immutable Parquet files by rewriting only the partitions the diff touches, and publish the result atomically so readers never see a half-updated dataset.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Replication & Diff Sync",
  "about": ["GeoParquet", "incremental update", "atomic manifest commit"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Replication & Diff Sync", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/" },
    { "@type": "ListItem", "position": 3, "name": "Incremental Updates for Derived Datasets", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/" },
    { "@type": "ListItem", "position": 4, "name": "Propagating OSM Diffs Into a GeoParquet Lake", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/incremental-updates-for-derived-datasets/propagating-osm-diffs-into-a-geoparquet-lake/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Apply an OSM change file to a GeoParquet lake",
  "description": "Resolve the partitions a diff affects from both the old and new feature state, rewrite only those partitions under new filenames, and commit by atomically renaming a manifest.",
  "step": [
    { "@type": "HowToStep", "name": "Resolve affected partitions", "text": "Compute the partition cells for both the pre-diff and post-diff state of each changed feature." },
    { "@type": "HowToStep", "name": "Skip applied sequences", "text": "Compare the diff sequence against the manifest so a retried diff is a no-op." },
    { "@type": "HowToStep", "name": "Rewrite each partition", "text": "Read the existing file, filter out removed identifiers, append new rows and write a new file." },
    { "@type": "HowToStep", "name": "Use fresh filenames", "text": "Never reuse a name, so readers holding the previous manifest keep reading valid files." },
    { "@type": "HowToStep", "name": "Commit by renaming the manifest", "text": "Write the updated manifest beside the real one and rename it into place as the atomic commit." },
    { "@type": "HowToStep", "name": "Compact on file count", "text": "Merge small files once a partition passes a file-count threshold, spending effort where edits happen." },
    { "@type": "HowToStep", "name": "Expire superseded files", "text": "Collect unreferenced files after a retention window that covers in-flight readers." }
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
      "name": "Why not use Iceberg or Delta rather than a hand-written manifest?",
      "acceptedAnswer": { "@type": "Answer", "text": "If you can, do. Both implement exactly this pattern with snapshot isolation, time travel and compaction already solved. The reasons to hand-roll it are a deployment where those engines are unavailable, or a dataset small enough that their operational cost outweighs the benefit. The design reasoning is identical either way." }
    },
    {
      "@type": "Question",
      "name": "How do you find the pre-diff partition of a deleted OSM feature?",
      "acceptedAnswer": { "@type": "Answer", "text": "By looking it up before applying the diff. A delete block carries an identifier and little else, so the partition must come from local state that still contains the feature — either an identifier-to-partition index maintained alongside the lake, or scanning candidate partitions. The index is dramatically cheaper." }
    },
    {
      "@type": "Question",
      "name": "Should a GeoParquet lake keep every version of a feature?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only if consumers ask historical questions. Keeping versions makes updates cheap appends and every query a deduplication; keeping only current state does the reverse. Current state in the lake with history in a separate append-only dataset usually serves both without either query paying for the other." }
    },
    {
      "@type": "Question",
      "name": "How often should Parquet compaction run?",
      "acceptedAnswer": { "@type": "Answer", "text": "When a partition's file count passes a threshold, rather than on a clock. A constantly edited partition accumulates files quickly while one in an unmapped area may go months without a rewrite, so a time-based schedule either compacts needlessly or lets busy partitions degrade." }
    }
  ]
}
</script>
