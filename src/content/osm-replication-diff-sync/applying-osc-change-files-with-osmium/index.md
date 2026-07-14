---
title: "Applying .osc Change Files with osmium"
description: "A field-level guide to the OsmChange format and how osmium apply-changes and pyosmium's apply_diff merge create, modify, and delete blocks into a base OSM extract in correct version order."
pageTitle: "Applying .osc Change Files with osmium and pyosmium"
pageDescription: "How the OsmChange XML format works and how to apply .osc.gz diffs with osmium apply-changes and pyosmium apply_diff — ordering, --with-history, conflict handling, and output PBF."
slug: applying-osc-change-files-with-osmium
type: guide
breadcrumb: "Applying .osc Change Files"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Applying .osc Change Files with osmium

Imagine a nightly job that merges yesterday's edits into a country extract, and one morning a downstream router starts sending drivers down a road that was deleted last week. The diff that deleted it was fetched but applied against a base that was already a version ahead, so the delete silently no-op'd and the ghost road survived. That is the failure this guide exists to prevent: applying an OsmChange file is not a blind append but a version-aware merge, and getting the version arithmetic wrong corrupts state without raising an error. This reference is part of the broader [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/) section, which frames why an extract must track upstream at all; here the focus narrows to the single operation of taking one or more `.osc.gz` files and a base `.osm.pbf` and producing a correct, updated PBF.

<svg viewBox="0 0 1000 380" role="img" aria-label="Applying one OsmChange diff to a base PBF. On the left, base.osm.pbf at sequence N feeds an apply-changes merge engine. A diff file for sequence N plus one enters the engine on three lanes: a create lane adds new elements, a modify lane replaces existing elements by version, and a delete lane marks elements no longer visible. The engine emits base plus one dot osm dot pbf at sequence N plus one." xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:1000px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Applying a single .osc diff to a base PBF through the three operation lanes</title>
  <desc>A base PBF at sequence N and a change file at sequence N+1 both feed an apply-changes engine. The change file splits into create, modify, and delete lanes; the engine merges them by version and writes an updated PBF at sequence N+1.</desc>
  <defs>
    <marker id="osc-apply-arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <text x="500" y="26" text-anchor="middle" font-size="15" font-weight="700" fill="currentColor">One diff, three lanes, one version-aware merge</text>
  <!-- base -->
  <rect x="24" y="150" width="170" height="72" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="109" y="181" text-anchor="middle" font-size="13" font-weight="600" fill="currentColor">base.osm.pbf</text>
  <text x="109" y="201" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.82">sequence N</text>
  <!-- diff file with three lanes -->
  <rect x="250" y="60" width="220" height="252" rx="8" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.55"/>
  <text x="360" y="82" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">N+1.osc.gz</text>
  <rect x="268" y="96" width="184" height="56" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.4"/>
  <text x="360" y="119" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">&lt;create&gt;</text>
  <text x="360" y="137" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">new elements</text>
  <rect x="268" y="158" width="184" height="56" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.4"/>
  <text x="360" y="181" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">&lt;modify&gt;</text>
  <text x="360" y="199" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">replace by version</text>
  <rect x="268" y="220" width="184" height="56" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.4"/>
  <text x="360" y="243" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">&lt;delete&gt;</text>
  <text x="360" y="261" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">visible = false</text>
  <!-- engine -->
  <rect x="540" y="140" width="180" height="92" rx="8" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.6"/>
  <text x="630" y="180" text-anchor="middle" font-size="13" font-weight="600" fill="currentColor">apply-changes</text>
  <text x="630" y="200" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.82">merge engine</text>
  <!-- output -->
  <rect x="784" y="150" width="192" height="72" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="880" y="181" text-anchor="middle" font-size="13" font-weight="600" fill="currentColor">base+1.osm.pbf</text>
  <text x="880" y="201" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.82">sequence N+1</text>
  <!-- edges -->
  <line x1="194" y1="186" x2="248" y2="186" stroke="currentColor" stroke-width="1.6" marker-end="url(#osc-apply-arrow)"/>
  <line x1="470" y1="124" x2="538" y2="164" stroke="currentColor" stroke-width="1.5" marker-end="url(#osc-apply-arrow)"/>
  <line x1="470" y1="186" x2="538" y2="186" stroke="currentColor" stroke-width="1.5" marker-end="url(#osc-apply-arrow)"/>
  <line x1="470" y1="248" x2="538" y2="208" stroke="currentColor" stroke-width="1.5" marker-end="url(#osc-apply-arrow)"/>
  <line x1="720" y1="186" x2="782" y2="186" stroke="currentColor" stroke-width="1.6" marker-end="url(#osc-apply-arrow)"/>
  <text x="500" y="352" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.88">Creates add, modifies replace the prior version, deletes hide — and the sequence advances by exactly one.</text>
</svg>

## Prerequisites

Applying diffs assumes a few pieces are already in place. You need a base extract whose replication sequence you know — read it from the header per [How to Decode OSM PBF Headers in Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/), or from a sidecar you maintain. You need the ordered set of `.osc.gz` files that follow that sequence, which the sibling reference [Replication Sequence Numbers and State](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) explains how to resolve. And because the output is another PBF, a working knowledge of the container's block structure from the [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) helps when you inspect or validate what `apply-changes` writes.

The tooling itself: install `osmium-tool` (the `osmium` CLI, version 1.11 or later is comfortable) for file-level application, and `pyosmium` (3.6+) when you want to drive application from Python. Both wrap the same C++ libosmium merge logic, so their semantics are identical; the choice is between a shell one-liner and in-process control.

## The OsmChange Format Reference

An `.osc` file is XML with a root `<osmChange version="0.6">` and a `generator` attribute. Inside it, operation blocks group elements by the action to perform. The exact fields that govern application are:

| Field | Appears on | Meaning | Consequence if mishandled |
| --- | --- | --- | --- |
| `id` | every element | Stable object identity within its type | Keyed without `(type, id)` → node/way/relation ID collision |
| `version` | every element | Edit counter, increments by one per change | Applied against wrong version → silent overwrite or skip |
| `timestamp` | every element | When the edit was committed upstream | Needed for time-filtering; not used for ordering |
| `changeset` | every element | The changeset that produced this version | Provenance / attribution; dropped by non-history output |
| `visible` | modify, delete | `true` for live objects, `false` for deletions | A delete is a version with `visible="false"` |
| `lat` / `lon` | nodes | Coordinates of the node's current version | Absent on deleted nodes |
| `<nd ref>` | ways | Ordered node references | Reordered → geometry silently changes |
| `<member>` | relations | Typed, roled members | Role loss breaks multipolygon assembly |

Three semantic rules follow from this layout. First, a `<modify>` block contains the element's **complete new state**, never a partial patch — every tag and reference is present, and application replaces the stored object wholesale. Second, a `<delete>` carries only enough of the element to identify it plus its new `visible="false"` version; the merge engine marks the object absent rather than physically erasing history. Third, the three action blocks may appear in any number and in any order within a file, and a single file may create an element and reference it from another element created in the same file — so a correct applier cannot assume a create always precedes the reference to it in document order.

## Ordering and Version Semantics

The rule that makes application correct is blunt: **process diffs in ascending sequence order, and within the merge let versions decide**. When `apply-changes` reads a base object at version *v* and a change at version *v+1*, it accepts the change. If the change is at *v+2* — because you skipped the diff carrying *v+1* — libosmium still applies it (the tool does not have the intervening state to object), which means the guardrail is *yours*, upstream of the tool: never hand `apply-changes` a diff set with a gap. Conversely, re-applying a diff you already merged is safe, because replacing version *v* with an identical version *v* is a no-op; this is what makes the operation idempotent and lets a crashed pipeline retry a cycle without harm.

Whole-object replacement also means the merge is *last-writer-wins by document position* when two changes to the same object appear across the ordered input. Because you feed diffs in sequence order and each diff carries strictly increasing versions for a given object, the last occurrence is by construction the newest — which is exactly what you want. The danger is only ever a gap or a reorder in the input you supply, not a conflict the engine resolves incorrectly.

## Step-by-Step: Applying Diffs with osmium

The `apply-changes` subcommand is the direct path. It reads a base and any number of change files and writes a merged output.

1. **Confirm the base sequence.** Know the sequence number your base is at; the first diff you apply must be that number plus one.
2. **Order the change files.** Sort the `.osc.gz` paths by their numeric sequence, ascending, with no gaps.
3. **Run apply-changes.** Pass the base first, then the ordered diffs, then the output path.
4. **Verify and record.** Confirm the output opens and advance your recorded sequence to the last diff applied.

```bash
# Steady-state: apply one minutely diff, producing a new sequence.
osmium apply-changes region.osm.pbf 006543211.osc.gz \
  --output region-updated.osm.pbf --overwrite

# Catch-up: apply a contiguous run of diffs in one pass. Shell brace order is
# not guaranteed by osmium — it re-sorts objects internally — but supplying them
# in ascending sequence keeps the version chain intact and auditable.
osmium apply-changes region.osm.pbf \
  006543211.osc.gz 006543212.osc.gz 006543213.osc.gz \
  --output region-updated.osm.pbf --overwrite
```

When your base is itself a full-history file, add `--with-history` so `apply-changes` retains prior versions instead of collapsing to the latest — the two modes write structurally different output and are not interchangeable:

```bash
# Update a full-history file, retaining every version rather than the latest only.
osmium apply-changes --with-history history.osh.pbf 006543211.osc.gz \
  --output history-updated.osh.pbf --overwrite
```

## Step-by-Step: Applying a Diff with pyosmium

When application must live inside a larger process — fetching, applying, and recording in one transaction — pyosmium exposes the merge through a writer and a diff-reading handler. The pattern below reads a base and a diff and writes an updated PBF, logging what it merged.

```python
from __future__ import annotations

import logging

import osmium

logger = logging.getLogger(__name__)


class DiffApplier(osmium.SimpleHandler):
    """Merge one .osc.gz change file into a base PBF, writing an updated PBF.

    libosmium resolves create / modify / delete by object version; this handler
    simply forwards the merged object stream to a writer and tallies operations.
    """

    def __init__(self, writer: osmium.SimpleWriter) -> None:
        super().__init__()
        self.writer = writer
        self.counts: dict[str, int] = {"node": 0, "way": 0, "relation": 0}

    def node(self, n: osmium.osm.Node) -> None:
        self.writer.add_node(n)
        self.counts["node"] += 1

    def way(self, w: osmium.osm.Way) -> None:
        self.writer.add_way(w)
        self.counts["way"] += 1

    def relation(self, r: osmium.osm.Relation) -> None:
        self.writer.add_relation(r)
        self.counts["relation"] += 1


def apply_one_diff(base: str, diff: str, out: str) -> dict[str, int]:
    """Apply a single change file to a base extract and write the result."""
    writer = osmium.SimpleWriter(out)
    applier = DiffApplier(writer)
    try:
        # apply_file with a base then a diff merges by version; the change file
        # is read after the base so its versions win where ids collide.
        applier.apply_file(base)
        applier.apply_file(diff)
    finally:
        writer.close()
    logger.info("applied %s onto %s -> %s: %s", diff, base, out, applier.counts)
    return applier.counts
```

For the higher-level replication driver that fetches and applies a whole span of diffs rather than one file, see [Catching Up a Stale OSM Extract with pyosmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/catching-up-a-stale-osm-extract-with-pyosmium/), which uses pyosmium's `ReplicationServer.apply_diffs` instead of the manual writer loop shown here.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Apply an OsmChange diff to a base OSM extract with osmium",
  "description": "Merge one or more ordered .osc.gz change files into a base .osm.pbf using osmium apply-changes, respecting object version order.",
  "step": [
    { "@type": "HowToStep", "name": "Confirm the base sequence", "text": "Determine the replication sequence number the base PBF is at; the first diff applied must be that number plus one." },
    { "@type": "HowToStep", "name": "Order the change files", "text": "Sort the .osc.gz files by numeric sequence in ascending order, verifying there is no missing sequence in the run." },
    { "@type": "HowToStep", "name": "Run apply-changes", "text": "Invoke osmium apply-changes with the base first, then the ordered diffs, then the output path, adding --with-history when the base is a full-history file." },
    { "@type": "HowToStep", "name": "Verify and record", "text": "Confirm the output PBF opens cleanly and advance the recorded sequence to the last diff applied so the next cycle resumes correctly." }
  ]
}
</script>

## Validation and Error Matrix

Applying diffs surfaces a recognizable set of failures; each has a specific detection and fix rather than a generic retry.

| Error / symptom | Root cause | Detection | Fix |
| --- | --- | --- | --- |
| Ghost object survives a delete | Delete applied against a base already past that version | Object present after apply though diff deleted it | Re-anchor: your base was ahead of the diff; realign sequence |
| Modify appears to no-op | Diff skipped; version landed on wrong base | Object still at old tags after apply | Fetch the missing sequence; never leave a gap in the run |
| `node not found` on way build | Way references a node created in a later diff | Reference resolution error mid-apply | Apply the full contiguous run, not an isolated diff |
| Output drops all history | Applied a diff to `.osh.pbf` without `--with-history` | Only latest versions remain in output | Re-run with `--with-history` on the history base |
| ID collision across types | State keyed on bare id, not `(type, id)` | A way overwrites a node with same id | Key all lookups on the `(type, id)` tuple |
| `apply-changes` refuses to write | Output exists and `--overwrite` omitted | Non-zero exit, file-exists message | Add `--overwrite` or write to a fresh path |
| Coordinates absent on a node | Node is a deletion stub | `lat`/`lon` missing on a `<delete>` node | Expected — deletions carry no coordinates |

Route genuinely defective change files — truncated downloads, gzip CRC failures — to the quarantine discipline in [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) rather than aborting a multi-diff catch-up on the first bad file.

## Performance and Scale Considerations

The cost of `apply-changes` is dominated by rewriting the base, not by the diff. Because a PBF is a compressed, block-structured container, merging a 200 KB minutely diff into an 8 GB regional file still means decompressing, merging, and recompressing the whole base — so a naive minutely loop that rewrites a large PBF every 60 seconds spends nearly all its time on I/O for a handful of changed objects. Two mitigations matter. For file-based workflows, batch: accumulate several minutely diffs and apply them in one `apply-changes` pass so the base is rewritten once per batch rather than once per diff. For high-frequency tracking, apply into a database rather than a file, where only the changed rows are touched — the subject of [Applying Minutely Diffs to a PostGIS Database](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/applying-minutely-diffs-to-a-postgis-database/).

libosmium reads and writes streams, so peak memory is bounded by the location cache for reference resolution, not by file size; on continental bases, point osmium at a disk-backed index (`--index-type` / a location store) so way reconstruction during history-aware application does not exhaust RAM.

## Failure Modes and Gotchas

- **Gaps are invisible to the tool.** `apply-changes` cannot know a sequence is missing; it merges whatever versions you give it. Validate contiguity before you invoke it.
- **`--with-history` is not a flag you can add later.** A history base and a current base produce different output structures; choosing the wrong mode silently discards or duplicates versions.
- **Document order within one `.osc` is not dependency order.** A file may reference an object created later in the same file; never resolve references eagerly on the first pass.
- **Deletions have no geometry.** Treat a missing `lat`/`lon` on a delete as expected, not as corruption.
- **Output overwrite is opt-in.** Omitting `--overwrite` fails the run; a scheduled loop must write to a temp path and rename, or pass the flag explicitly.
- **Timestamps do not order diffs.** Sequence number orders the stream; the element `timestamp` is for temporal reconstruction, not for deciding which diff comes first.

## Integration Points

The output of this stage is an updated base ready for the next cycle, and its sequence number is the hand-off. Record that number and feed it back as the starting point of the following fetch — the loop the [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/) section describes. A minimal wiring that applies a diff and then stamps the new sequence for the next run:

```python
import logging

logger = logging.getLogger(__name__)


def apply_and_advance(base: str, diff: str, seq: int, out: str) -> int:
    """Apply one diff, then return the sequence the pipeline should record next."""
    counts = apply_one_diff(base, diff, out)  # from the pyosmium section above
    next_seq = seq + 1
    logger.info("advanced to sequence %d (%s)", next_seq, counts)
    return next_seq  # persist this only after the output write has committed
```

## Explore This Topic in Depth

Two focused guides extend this reference to concrete recovery and database scenarios:

- [Catching Up a Stale OSM Extract with pyosmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/catching-up-a-stale-osm-extract-with-pyosmium/) — discover the starting sequence for a weeks-behind extract and apply every intervening diff with pyosmium's replication API.
- [Applying Minutely Diffs to a PostGIS Database](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/applying-minutely-diffs-to-a-postgis-database/) — keep an `osm2pgsql` or `imposm` database current by appending diffs incrementally instead of rewriting a file.

## Frequently Asked Questions

<details>
<summary>Does a modify block contain only the changed fields?</summary>

No. A `<modify>` block carries the element's complete new state — every tag, every node reference or member — not a field-level delta. Application replaces the stored object wholesale with the version in the block. This is what makes re-applying the same diff a safe no-op: the replacement is identical.
</details>

<details>
<summary>What happens if I apply diffs out of order or skip one?</summary>

`apply-changes` does not detect gaps; it merges whatever versions you supply. A skipped diff means a later modify lands on a base that is missing an intervening version, so the update either fails a reference lookup or silently overwrites state. Always validate that the sequence run is contiguous and ascending before applying.
</details>

<details>
<summary>When do I need the --with-history flag?</summary>

Use `--with-history` only when the base is a full-history `.osh.pbf` and you want to retain every version. Applied to a current-state base it is unnecessary; omitted on a history base it collapses the file to latest-version-only. The two modes produce structurally different output and are not interchangeable.
</details>

<details>
<summary>Is applying the same diff twice dangerous?</summary>

No. Because each object in a diff carries a version and application is whole-object replacement, re-applying an already-merged diff replaces a version with an identical version — a no-op. This idempotency is what lets a crashed pipeline safely retry the last cycle without corrupting state.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Does a modify block contain only the changed fields?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. A modify block carries the element's complete new state — every tag and every node reference or member — not a field-level delta. Application replaces the stored object wholesale with the version in the block. This is what makes re-applying the same diff a safe no-op: the replacement is identical." }
    },
    {
      "@type": "Question",
      "name": "What happens if I apply diffs out of order or skip one?",
      "acceptedAnswer": { "@type": "Answer", "text": "apply-changes does not detect gaps; it merges whatever versions you supply. A skipped diff means a later modify lands on a base missing an intervening version, so the update either fails a reference lookup or silently overwrites state. Always validate that the sequence run is contiguous and ascending before applying." }
    },
    {
      "@type": "Question",
      "name": "When do I need the --with-history flag?",
      "acceptedAnswer": { "@type": "Answer", "text": "Use --with-history only when the base is a full-history .osh.pbf and you want to retain every version. Applied to a current-state base it is unnecessary; omitted on a history base it collapses the file to latest-version-only. The two modes produce structurally different output and are not interchangeable." }
    },
    {
      "@type": "Question",
      "name": "Is applying the same diff twice dangerous?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. Because each object in a diff carries a version and application is whole-object replacement, re-applying an already-merged diff replaces a version with an identical version, which is a no-op. This idempotency is what lets a crashed pipeline safely retry the last cycle without corrupting state." }
    }
  ]
}
</script>

## Related

- [Replication Sequence Numbers and State](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) — resolving the ordered set of diffs this guide applies.
- [Full-History .osh.pbf Processing](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/) — the history-aware base that `--with-history` targets.
- [How to Decode OSM PBF Headers in Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/) — reading the base sequence number before applying.
- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — the container format the merged output is written in.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — quarantining truncated or corrupt change files.

Up one level: [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Applying .osc Change Files with osmium",
  "description": "A field-level guide to the OsmChange format and how osmium apply-changes and pyosmium's apply_diff merge create, modify, and delete blocks into a base OSM extract in correct version order.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Replication & Diff Sync",
  "about": ["OsmChange format", "osmium apply-changes", "pyosmium diff application"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Replication & Diff Sync", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/" },
    { "@type": "ListItem", "position": 3, "name": "Applying .osc Change Files with osmium", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/" }
  ]
}
</script>
