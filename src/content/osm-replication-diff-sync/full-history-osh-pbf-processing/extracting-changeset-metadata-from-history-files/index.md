---
title: "Extracting Changeset Metadata from History Files"
description: "Extract per-version provenance — changeset id, uid, user, and timestamp — from an OSM .osh.pbf with a pyosmium handler, then aggregate it into a contributor table, with metadata-availability caveats."
pageTitle: "Extract Changeset Metadata from OSM History Files"
pageDescription: "Read per-version changeset, uid, user, and timestamp from a full-history .osh.pbf with pyosmium and build a contributor audit table, noting when metadata is stripped."
slug: extracting-changeset-metadata-from-history-files
type: article
breadcrumb: "Changeset Metadata"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Extracting Changeset Metadata from History Files

From a full-history `.osh.pbf`, collect the provenance of every element version — the changeset that made it, the editor's uid and name, and the timestamp — into a table you can audit or aggregate by contributor.

## Prerequisites

Confirm each item; the most common surprise is a file that parses cleanly but reports zeros for every metadata field because its metadata was stripped upstream.

- [ ] A full-history file (`*.osh.pbf`) whose header sets `HistoricalInformation` — the format is covered in [Full-History .osh.pbf Processing](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/).
- [ ] `pyosmium` ≥ 3.6 installed (`pip install osmium`).
- [ ] Optional: `pandas` ≥ 2.1 for the aggregation step (`pip install "pandas>=2.1"`).
- [ ] Python 3.10+ for the `list[dict[str, object]]` typing used below.
- [ ] Confirmation that the source retains metadata — a file written with `add_metadata=false` carries no changeset, uid, or timestamp to extract.
- [ ] If you produced the file yourself with `osmium extract`, that you passed `--with-history` so version chains and their metadata survived the cut.

## Conceptual minimum

Every version of every OSM element carries a fixed metadata block independent of its tags and geometry: a `version` counter, the `changeset` that committed it, the editor's numeric `uid` and display `user`, and a UTC `timestamp`. In a current-state extract you see this block once per object; in a full-history file you see it once per *version*, which is exactly what makes the file usable for auditing — you can reconstruct who changed what, when, and under which changeset across an object's whole life. This is the same per-version stream used to [reconstruct features at a past date](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/reconstructing-osm-features-at-a-past-date/), read for provenance rather than for state. Extraction is therefore a flat projection: for each version, emit one row of `(type, id, version, changeset, uid, user, timestamp)`, and leave the tags behind.

The one caveat that governs whether this works at all is metadata availability. The OSM PBF and XML schemas treat object metadata as optional, so a producer can strip it to shrink a file — and when it is stripped, pyosmium returns `version = 0`, `changeset = 0`, `uid = 0`, an empty `user`, and an invalid timestamp rather than raising. History files distributed as `.osh.pbf` always retain metadata, because the metadata *is* the history; the risk arises with self-made extracts. Whenever you cut a region from a history planet you must keep history explicitly, and if a downstream tool re-encoded the file with metadata disabled, provenance is simply gone and no code can recover it. The reader below detects that condition instead of silently emitting a table of zeros.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 300" role="img" aria-label="Provenance extraction flow. A stack of element versions on the left each carries a metadata block. A projection step in the middle pulls the changeset, uid, user, and timestamp fields from every version. On the right the rows aggregate into a contributor table grouped by uid with edit counts." style="width:100%;max-width:900px;display:block;margin:1.5rem auto;font-family:inherit">
  <title>Projecting per-version metadata into a contributor audit table</title>
  <desc>Element versions on the left feed a field-projection step that extracts changeset, uid, user, and timestamp, which then group by uid into a contributor table on the right.</desc>
  <defs>
    <marker id="ecm-arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <text x="450" y="26" text-anchor="middle" font-size="14.5" fill="currentColor" font-weight="700">Every version's metadata block becomes one provenance row</text>
  <!-- version stack -->
  <rect x="30" y="70" width="150" height="44" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.4"/>
  <text x="105" y="88" text-anchor="middle" font-size="11.5" fill="currentColor" font-weight="700">version A</text>
  <text x="105" y="104" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.82">meta block</text>
  <rect x="42" y="122" width="150" height="44" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.4"/>
  <text x="117" y="140" text-anchor="middle" font-size="11.5" fill="currentColor" font-weight="700">version B</text>
  <text x="117" y="156" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.82">meta block</text>
  <rect x="54" y="174" width="150" height="44" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.4"/>
  <text x="129" y="192" text-anchor="middle" font-size="11.5" fill="currentColor" font-weight="700">version C</text>
  <text x="129" y="208" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.82">meta block</text>
  <!-- projection -->
  <rect x="330" y="108" width="170" height="84" rx="7" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
  <text x="415" y="134" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="700">project fields</text>
  <text x="415" y="153" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">changeset · uid</text>
  <text x="415" y="169" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">user · timestamp</text>
  <text x="415" y="185" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">drop tags + geom</text>
  <!-- table -->
  <rect x="640" y="86" width="220" height="128" rx="7" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="750" y="110" text-anchor="middle" font-size="12.5" fill="currentColor" font-weight="700">contributor table</text>
  <line x1="656" y1="120" x2="844" y2="120" stroke="currentColor" stroke-width="1" opacity="0.4"/>
  <text x="668" y="140" text-anchor="start" font-size="10.5" fill="currentColor">uid</text>
  <text x="820" y="140" text-anchor="end" font-size="10.5" fill="currentColor">edits</text>
  <text x="668" y="160" text-anchor="start" font-size="10.5" fill="currentColor" opacity="0.85">1042</text>
  <text x="820" y="160" text-anchor="end" font-size="10.5" fill="currentColor" opacity="0.85">318</text>
  <text x="668" y="178" text-anchor="start" font-size="10.5" fill="currentColor" opacity="0.85">7781</text>
  <text x="820" y="178" text-anchor="end" font-size="10.5" fill="currentColor" opacity="0.85">92</text>
  <text x="668" y="196" text-anchor="start" font-size="10.5" fill="currentColor" opacity="0.85">…</text>
  <text x="820" y="196" text-anchor="end" font-size="10.5" fill="currentColor" opacity="0.85">…</text>
  <!-- arrows -->
  <line x1="204" y1="145" x2="328" y2="145" stroke="currentColor" stroke-width="1.5" marker-end="url(#ecm-arr)"/>
  <line x1="500" y1="150" x2="638" y2="150" stroke="currentColor" stroke-width="1.5" marker-end="url(#ecm-arr)"/>
  <text x="266" y="136" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">per version</text>
  <text x="569" y="141" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">group by uid</text>
</svg>

## Runnable solution

The handler below collects one provenance row per version into a list, guarding against stripped metadata, and then aggregates the rows into a per-contributor summary. The aggregation uses pandas when it is available and falls back to the standard library otherwise.

```python
from __future__ import annotations

import logging
from collections import Counter

import osmium

logger = logging.getLogger("osm.provenance")


class ProvenanceHandler(osmium.SimpleHandler):
    """Collect (type, id, version, changeset, uid, user, timestamp) per version."""

    def __init__(self) -> None:
        super().__init__()
        self.rows: list[dict[str, object]] = []
        self.stripped = 0  # versions whose metadata looks absent

    def _row(self, kind: str, obj: osmium.osm.OSMObject) -> None:
        # Stripped metadata surfaces as version 0 and changeset 0, not an error.
        if obj.version == 0 and obj.changeset == 0:
            self.stripped += 1
            return
        self.rows.append(
            {
                "type": kind,
                "id": obj.id,
                "version": obj.version,
                "changeset": obj.changeset,
                "uid": obj.uid,
                "user": obj.user,  # may be "" if redacted
                "timestamp": obj.timestamp.isoformat() if obj.timestamp else None,
                "visible": obj.visible,
            }
        )

    def node(self, n: osmium.osm.Node) -> None:
        self._row("node", n)

    def way(self, w: osmium.osm.Way) -> None:
        self._row("way", w)

    def relation(self, r: osmium.osm.Relation) -> None:
        self._row("relation", r)


def extract_provenance(path: str) -> list[dict[str, object]]:
    """Return one provenance row per element version in *path*."""
    reader = osmium.io.Reader(path)
    if not reader.header().has_multiple_object_versions():
        logger.warning("%s is not a history file; only head versions will appear", path)
    reader.close()

    handler = ProvenanceHandler()
    handler.apply_file(path)
    if handler.stripped:
        logger.warning(
            "%d versions had no metadata (version=0); source may be stripped",
            handler.stripped,
        )
    logger.info("collected %d provenance rows", len(handler.rows))
    return handler.rows


def contributor_summary(rows: list[dict[str, object]]) -> list[tuple[int, str, int]]:
    """Aggregate rows into (uid, user, edit_count), busiest first."""
    try:
        import pandas as pd

        frame = pd.DataFrame(rows)
        grouped = (
            frame.groupby("uid")
            .agg(user=("user", "last"), edits=("version", "size"))
            .sort_values("edits", ascending=False)
            .reset_index()
        )
        return list(grouped.itertuples(index=False, name=None))
    except ImportError:
        counts: Counter[int] = Counter(r["uid"] for r in rows)
        names = {r["uid"]: r["user"] for r in rows}
        return [(uid, names[uid], n) for uid, n in counts.most_common()]


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    provenance = extract_provenance("history.osh.pbf")
    for uid, user, edits in contributor_summary(provenance)[:10]:
        logger.info("uid=%s user=%r edits=%d", uid, user, edits)
```

## Step-by-step walkthrough

1. **Check the header first.** `extract_provenance` opens an `osmium.io.Reader` and inspects `has_multiple_object_versions()` before parsing. On a current-state file it warns that only head versions exist, so a caller never mistakes a one-row-per-object result for a full history.
2. **Detect stripped metadata, don't crash on it.** A version with both `version == 0` and `changeset == 0` had its metadata removed upstream; the handler counts these separately rather than writing rows full of zeros that would corrupt any contributor tally.
3. **Project, don't reconstruct.** `_row` copies only the provenance fields and ignores tags and node references, so the handler stays cheap even on a large file — there is no geometry assembly.
4. **Keep `user` as best-effort.** The display name can be blank when an account was deleted or a version redacted, while `uid` remains stable. Rows retain both, and the summary groups on `uid` so redacted names never split one contributor into several buckets.
5. **Aggregate flexibly.** `contributor_summary` uses pandas for a fast `groupby` when it is installed and otherwise falls back to `collections.Counter`, so the extraction has no hard dependency on the data-frame stack.
6. **Timestamps serialize as ISO-8601.** `obj.timestamp.isoformat()` produces a sortable, timezone-aware string that loads cleanly into a database or a data frame later.

## Verification

- **Row count matches version count.** For a small region, `len(rows)` plus the `stripped` count should equal the total version count reported by `osmium fileinfo -e history.osh.pbf`.
- **No zero uids among real edits.** `uid = 0` in the output means anonymous or stripped edits leaked past the guard; inspect those rows before trusting the tally.
- **Changesets are monotone per object.** Within one `(type, id)`, `changeset` values should generally increase with `version`; a decrease signals rows sorted or merged incorrectly.
- **Spot-check against the API.** Pick a changeset id from the table and confirm its editor and timestamp on the live OSM changeset view; they must match the extracted row.
- **The stripped-metadata warning fires appropriately.** Running against a deliberately metadata-free file should log the `versions had no metadata` warning and return no rows.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Every row shows `changeset=0`, `uid=0` | Source written with `add_metadata=false` | Re-source a file that retains metadata; provenance cannot be recovered. |
| Only one row per object | Current-state file, not a history file | Use a `.osh.pbf`; check `has_multiple_object_versions()`. |
| Contributor split across blank names | Grouped on `user` not `uid` | Aggregate on the numeric `uid`; treat `user` as a label. |
| `AttributeError` on `timestamp.isoformat` | Timestamp invalid on a stripped version | Guard with `if obj.timestamp else None`, as shown. |
| History lost after `osmium extract` | `--with-history` omitted on the cut | Re-run the extract with `--with-history`. |
| Memory climbs on a planet history | All rows buffered in one list | Stream rows to CSV/Parquet instead of appending in RAM. |

## Specification reference

> Each OSM element carries optional metadata — `version`, `changeset`, `timestamp`, `uid`, and `user` — that records the edit provenance; see the OSM Wiki [Elements](https://wiki.openstreetmap.org/wiki/Elements) page for the field definitions and [Changeset](https://wiki.openstreetmap.org/wiki/Changeset) for how edits are grouped. Because the metadata is optional in the PBF and XML schemas, a file can be written without it, in which case these fields are absent; the [pyosmium documentation](https://docs.osmcode.org/pyosmium/latest/) describes the attributes exposed on each object.

## Related

- [Full-History .osh.pbf Processing](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/) — the format and the version stream this extraction reads.
- [Reconstructing OSM Features at a Past Date](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/reconstructing-osm-features-at-a-past-date/) — the state-oriented sibling that reads the same versions to rebuild geometry at T.
- [How to Decode OSM PBF Headers in Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/) — confirming a file is historical and metadata-bearing before extraction.
- [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — the elements whose per-version metadata this table projects.
- [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) — the diffs that create the changeset-stamped versions you are auditing.

Up one level: [Full-History .osh.pbf Processing](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/).

## Frequently Asked Questions

<details>
<summary>Why are all my changeset and uid values zero?</summary>

The source file was written without object metadata, which the PBF and XML schemas permit. When metadata is stripped, pyosmium returns version and changeset as zero, uid as zero, an empty user, and an invalid timestamp rather than raising an error. Provenance cannot be reconstructed from such a file; you need a source that retained its metadata, which every distributed .osh.pbf does.
</details>

<details>
<summary>Should I group contributor stats on uid or user?</summary>

Group on the numeric uid. The display name can change over time, and it can be blank when an account was deleted or a version redacted, so grouping on the name splits one contributor into several buckets or merges anonymous rows. The uid is stable across a contributor's history, so it is the correct aggregation key; carry the name along only as a label.
</details>

<details>
<summary>Do I need the whole history file to get changeset metadata?</summary>

Only if you want provenance for past versions. A current-state extract still carries the metadata of each object's latest version, so you can attribute the head state from it. To audit an object's full edit trail — every changeset that ever touched it — you need the full-history file, because a current-state file keeps just the newest version per object.
</details>

<details>
<summary>How do I keep provenance when cutting a regional extract?</summary>

Pass --with-history to osmium extract so the cut preserves version chains and their metadata. A plain extract reduces the file to current state and discards older versions, and any re-encoding step that disables metadata output removes the changeset, uid, and timestamp fields entirely. Verify the result with osmium fileinfo before relying on it.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Extracting Changeset Metadata from History Files",
  "description": "Extract per-version provenance — changeset id, uid, user, and timestamp — from an OSM .osh.pbf with a pyosmium handler, then aggregate it into a contributor table, with metadata-availability caveats.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Replication & Diff Sync",
  "about": ["OSM changeset metadata", "pyosmium provenance extraction", "contributor analysis"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Replication & Diff Sync", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/" },
    { "@type": "ListItem", "position": 3, "name": "Full-History Processing", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/" },
    { "@type": "ListItem", "position": 4, "name": "Changeset Metadata", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/extracting-changeset-metadata-from-history-files/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Extract changeset metadata from an OSM history file",
  "description": "Read per-version changeset, uid, user, and timestamp from a full-history .osh.pbf with pyosmium and aggregate the rows into a contributor audit table.",
  "step": [
    { "@type": "HowToStep", "name": "Confirm the file is historical", "text": "Open the PBF header and check has_multiple_object_versions so a current-state file is not mistaken for a full history." },
    { "@type": "HowToStep", "name": "Project the metadata per version", "text": "For each element version emit one row of type, id, version, changeset, uid, user, and timestamp, ignoring tags and geometry." },
    { "@type": "HowToStep", "name": "Guard against stripped metadata", "text": "Treat versions with version and changeset both zero as metadata-free and count them separately instead of emitting zero rows." },
    { "@type": "HowToStep", "name": "Aggregate by contributor", "text": "Group the rows on the numeric uid and count versions to rank contributors, keeping the display name only as a label." },
    { "@type": "HowToStep", "name": "Verify against the API", "text": "Spot-check a changeset id from the table against the live OSM changeset view to confirm editor and timestamp." }
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
      "name": "Why are all my changeset and uid values zero?",
      "acceptedAnswer": { "@type": "Answer", "text": "The source file was written without object metadata, which the PBF and XML schemas permit. When metadata is stripped, pyosmium returns version and changeset as zero, uid as zero, an empty user, and an invalid timestamp rather than raising an error. Provenance cannot be reconstructed from such a file; you need a source that retained its metadata, which every distributed history file does." }
    },
    {
      "@type": "Question",
      "name": "Should I group contributor stats on uid or user?",
      "acceptedAnswer": { "@type": "Answer", "text": "Group on the numeric uid. The display name can change over time and can be blank when an account was deleted or a version redacted, so grouping on the name splits one contributor into several buckets or merges anonymous rows. The uid is stable across a contributor's history, so it is the correct aggregation key; carry the name along only as a label." }
    },
    {
      "@type": "Question",
      "name": "Do I need the whole history file to get changeset metadata?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only if you want provenance for past versions. A current-state extract still carries the metadata of each object's latest version, so you can attribute the head state from it. To audit an object's full edit trail you need the full-history file, because a current-state file keeps just the newest version per object." }
    },
    {
      "@type": "Question",
      "name": "How do I keep provenance when cutting a regional extract?",
      "acceptedAnswer": { "@type": "Answer", "text": "Pass with-history to osmium extract so the cut preserves version chains and their metadata. A plain extract reduces the file to current state and discards older versions, and any re-encoding step that disables metadata output removes the changeset, uid, and timestamp fields entirely. Verify the result with osmium fileinfo before relying on it." }
    }
  ]
}
</script>
