---
title: "OSM Replication & Diff Sync"
description: "How to keep a local OpenStreetMap dataset current with upstream: the OsmChange diff format, replication streams, sequence numbers, osmium apply-changes, full-history files, and ODbL provenance."
pageTitle: "OSM Replication & Diff Sync: Keeping Extracts Current"
pageDescription: "Reference for OSM replication and diff sync — OsmChange .osc.gz diffs, minutely/hourly/daily streams, sequence numbers, osmium apply-changes, .osh.pbf history, and provenance."
slug: osm-replication-diff-sync
type: overview
breadcrumb: "Replication & Diff Sync"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# OSM Replication & Diff Sync

<figure class="diagram-wrap">
<svg viewBox="0 0 1060 300" role="img" aria-labelledby="repl-flow-title repl-flow-desc" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit;color:var(--c-ink)">
  <title id="repl-flow-title">OSM replication pipeline: from a base extract to a continuously updated dataset</title>
  <desc id="repl-flow-desc">A horizontal data-flow diagram. A base extract carries a stored sequence number. A replication server publishes state.txt and sequence N. The pipeline fetches ordered .osc.gz diffs, applies them with apply-changes, and writes an updated .osm.pbf or PostGIS database that feeds downstream consumers. When a sequence gap or a bad diff is detected, the flow branches into gap recovery and quarantine before resuming.</desc>
  <defs>
    <marker id="repl-flow-arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker>
  </defs>
  <rect x="0" y="0" width="1060" height="300" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <!-- top row edges -->
  <line x1="160" y1="86" x2="188" y2="86" stroke="currentColor" stroke-width="1.6" marker-end="url(#repl-flow-arrow)"/>
  <line x1="356" y1="86" x2="384" y2="86" stroke="currentColor" stroke-width="1.6" marker-end="url(#repl-flow-arrow)"/>
  <line x1="552" y1="86" x2="580" y2="86" stroke="currentColor" stroke-width="1.6" marker-end="url(#repl-flow-arrow)"/>
  <line x1="748" y1="86" x2="776" y2="86" stroke="currentColor" stroke-width="1.6" marker-end="url(#repl-flow-arrow)"/>
  <!-- 1 base extract -->
  <rect x="12" y="54" width="148" height="64" rx="9" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="86" y="80" text-anchor="middle" font-size="13" font-weight="600" fill="currentColor">Base extract</text>
  <text x="86" y="99" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.82">.osm.pbf · seq N</text>
  <!-- 2 replication server -->
  <rect x="188" y="54" width="168" height="64" rx="9" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.85"/>
  <text x="272" y="80" text-anchor="middle" font-size="13" font-weight="600" fill="currentColor">Replication server</text>
  <text x="272" y="99" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.82">state.txt · seq N+k</text>
  <!-- 3 fetch diffs -->
  <rect x="384" y="54" width="168" height="64" rx="9" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.85"/>
  <text x="468" y="80" text-anchor="middle" font-size="13" font-weight="600" fill="currentColor">Fetch ordered diffs</text>
  <text x="468" y="99" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.82">.osc.gz · N+1…N+k</text>
  <!-- 4 apply-changes -->
  <rect x="580" y="54" width="168" height="64" rx="9" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="664" y="80" text-anchor="middle" font-size="13" font-weight="600" fill="currentColor">apply-changes</text>
  <text x="664" y="99" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.82">create·modify·delete</text>
  <!-- 5 updated output -->
  <rect x="776" y="54" width="168" height="64" rx="9" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="860" y="80" text-anchor="middle" font-size="13" font-weight="600" fill="currentColor">Updated dataset</text>
  <text x="860" y="99" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.82">.osm.pbf · PostGIS</text>
  <!-- 6 consumers -->
  <rect x="776" y="200" width="168" height="60" rx="9" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.85"/>
  <text x="860" y="225" text-anchor="middle" font-size="13" font-weight="600" fill="currentColor">Downstream</text>
  <text x="860" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.82">routing · analytics</text>
  <line x1="860" y1="118" x2="860" y2="198" stroke="currentColor" stroke-width="1.6" marker-end="url(#repl-flow-arrow)"/>
  <!-- branch to gap recovery / quarantine -->
  <rect x="384" y="200" width="168" height="60" rx="9" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="468" y="225" text-anchor="middle" font-size="12.5" font-weight="600" fill="currentColor">Gap recovery</text>
  <text x="468" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.82">quarantine · resync</text>
  <path d="M468,118 V200" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#repl-flow-arrow)"/>
  <text x="524" y="162" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">gap / bad diff</text>
  <path d="M552,230 H620 V150" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#repl-flow-arrow)"/>
  <text x="640" y="176" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">resume</text>
</svg>
<figcaption>Replication keeps a base extract current: a stream advertises its sequence in state.txt, the pipeline fetches every intervening .osc.gz in order, applies them, and writes an updated dataset — branching to gap recovery whenever the sequence is broken or a diff fails to apply cleanly.</figcaption>
</figure>

An OpenStreetMap extract is a photograph of a moving subject. The moment `osmium extract` or a Geofabrik download writes a `.osm.pbf` to disk, thousands of contributors begin editing the objects it contains — a road is split, a building's footprint is corrected, a closed shop is deleted. Within a day a regional file already disagrees with the live database in tens of thousands of places; within a month it is stale enough that routing, geocoding, and completeness metrics built on top of it quietly drift out of true. This section is the reference for closing that gap: it explains how OSM publishes its edit history as a stream of diffs, how you consume that stream in the correct order, and how you apply it to a local `.osm.pbf` or PostGIS database so your copy tracks upstream to the minute instead of aging in place. It builds directly on the format and model groundwork in [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/); if the byte layout of a PBF blob is unfamiliar, start there first.

The scope is deliberately the *update loop* — the mechanics of turning a fixed snapshot into a living dataset without re-downloading a planet file every night. Full re-imports are simple but wasteful: a planet PBF is roughly 80 GB and an `osm2pgsql` import of it takes many hours, whereas a minute of global change is a few hundred kilobytes that applies in seconds. The engineering payoff of replication is that update cost tracks *change volume*, not *database size*. Getting it right, though, demands discipline around ordering, state tracking, and provenance, because a single skipped or reordered diff corrupts state silently and is often not noticed until a downstream query returns a road that was deleted weeks ago.

## The OsmChange Diff Format

The unit of replication is the OsmChange document, distributed gzip-compressed with the extension `.osc.gz`. It is an XML file whose root `<osmChange>` element contains three kinds of operation block — `<create>`, `<modify>`, and `<delete>` — each wrapping full OSM elements (`<node>`, `<way>`, `<relation>`) exactly as they appear in a normal OSM XML file, with their `id`, `version`, `timestamp`, `changeset`, and, for modifications and deletions, a `visible` attribute. A `<modify>` block carries the *entire* new state of the element, not a field-level patch; consumers replace the prior version wholesale. A `<delete>` block carries the element stub with `visible="false"` at its new version number. This whole-object replacement semantics is what makes application idempotent-by-version: applying the same diff twice yields the same result, provided you respect version numbers.

Two properties of the format govern correct application. First, **version monotonicity**: every operation names a `version`, and an element's version increments by one on each edit. A diff that modifies a node to version 8 is only valid against a base holding version 7; applying it to a base still at version 5 means you have missed versions 6 and 7. Second, **intra-file ordering is not spatial or type-grouped** in a way you can rely on — a single `.osc` may create a node, then modify a way that references it, so a naive two-pass loader that resolves references eagerly can trip over forward references within one file. Robust appliers process creates, then modifies, then deletes, or defer reference resolution until the whole diff is ingested. The detailed field reference and the create/modify/delete application rules live in [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/).

## Replication Streams and Cadence

OSM publishes its change stream at three cadences, each a directory tree of numbered diffs on a replication server (the canonical one being `planet.openstreetmap.org/replication/`, mirrored by Geofabrik for regional extracts):

<figure class="diagram-wrap">
<svg viewBox="0 0 880 240" role="img" aria-labelledby="cadence-t cadence-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cadence-t">Typical diff size, freshness and catch-up cost for the three replication cadences</title>
  <desc id="cadence-d">A bar chart comparing minutely, hourly and daily replication for a planet stream. A minutely diff averages 480 kilobytes and leaves the copy at most 60 seconds behind, but a week of downtime means 10 080 files to replay. An hourly diff averages 28 megabytes with an hour of lag and 168 files for the same week. A daily diff averages 640 megabytes with a day of lag and 7 files.</desc>
  <rect x="0" y="0" width="880" height="240" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Cadence sets both how fresh you are and how expensive a week offline is</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">average compressed diff size per file</text>
  <line x1="250" y1="68" x2="250" y2="186" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">daily</text>
  <rect x="250" y="74" width="368" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="628" y="89" font-size="11" fill="currentColor" opacity="0.9">640 MB/file · ≤24 h stale · 7 files per lost week</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">hourly</text>
  <rect x="250" y="116" width="16" height="21" rx="3" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="276" y="131" font-size="11" fill="currentColor" opacity="0.9">28 MB/file · ≤60 min stale · 168 files per lost week</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">minutely</text>
  <rect x="250" y="158" width="6" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="266" y="173" font-size="11" fill="currentColor" opacity="0.9">480 kB/file · ≤60 s stale · 10 080 files per lost week</text>
  <text x="868" y="222" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Each file costs an HTTP round trip and a state write, so replaying 10 080 minutely diffs is dominated by request latency, not by the 4.7 GB of payload.</text>
</svg>
<figcaption>Cadence is a choice about recovery, not only freshness. The minutely stream is the freshest and by far the most expensive to catch up on, because catch-up cost is a file count, not a byte count.</figcaption>
</figure>

| Stream | Path suffix | Typical diff size | Latency to live | Use case |
| --- | --- | --- | --- | --- |
| Minutely | `/replication/minute/` | 50 KB–2 MB | ~1–2 minutes | Live routing, near-real-time tiles |
| Hourly | `/replication/hour/` | 3–40 MB | ~1 hour | Analytics refreshed each hour |
| Daily | `/replication/day/` | 40–400 MB | ~1 day | Nightly batch imports |

The three streams are not independent datasets — the hourly and daily diffs are aggregations of the same edits carried by the minutely stream, so you choose exactly one cadence per pipeline and never mix them for a single database. A common design error is to catch up a weeks-behind extract from the *minutely* stream, which would mean fetching tens of thousands of tiny files; the daily stream covers the same span in a few dozen large diffs and is far cheaper for a long catch-up, after which you switch to minutely for steady-state tracking. Geofabrik additionally publishes region-scoped `.osc.gz` streams so you can update a country extract without processing global change, though those streams update less frequently and carry their own sequence numbering.

## Sequence Numbers and state.txt

Ordering in OSM replication is enforced by a single monotonically increasing integer: the **sequence number**. Every diff in a stream is identified by its sequence, and the server publishes a companion `state.txt` alongside each diff and at the stream root. A `state.txt` is a tiny key-value file:

```text
#Wed Jul 14 09:03:02 UTC 2026
sequenceNumber=6543210
timestamp=2026-07-14T09\:00\:00Z
```

The `sequenceNumber` is the identity of the most recent diff, and `timestamp` is the instant up to which that diff is complete — meaning every edit with a timestamp at or before that value is reflected once the diff is applied. The sequence number also maps directly onto the diff's path: OSM formats the integer as a nine-digit, zero-padded, slash-segmented path, so sequence `6543210` lives at `006/543/210.osc.gz` with its own `006/543/210.state.txt`. Your pipeline's core state is therefore just one integer — the last sequence you successfully applied. Recording it durably (alongside the file checksum and applied-at timestamp) is what makes the loop resumable and auditable. A PBF that has itself been kept current carries this integer in its header as `osmosis_replication_sequence_number`, which you can read back with the technique in [How to decode OSM PBF headers in Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/) rather than tracking it in a sidecar. The full mechanics — deriving the starting sequence, mapping timestamps to sequences, and detecting gaps — are covered in [Replication Sequence Numbers and State](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/).

## Applying Diffs: osmium and pyosmium

Once you hold an ordered list of `.osc.gz` files, application is a merge of the diff stream into the base data. The workhorse for file-to-file updates is the `osmium` command-line tool. Its `apply-changes` subcommand consumes a base `.osm.pbf` and one or more change files and writes a new PBF reflecting the merged state:

```bash
# Apply a single minutely diff to a base extract, writing a new PBF.
osmium apply-changes base.osm.pbf 006543211.osc.gz \
  --output updated.osm.pbf

# Apply several ordered diffs in one pass (osmium sorts internally by object,
# but you must pass them in ascending sequence order for correct versioning).
osmium apply-changes base.osm.pbf \
  006543211.osc.gz 006543212.osc.gz 006543213.osc.gz \
  --output updated.osm.pbf
```

For programmatic control — fetching diffs, applying them, and reacting to failures inside one process — pyosmium exposes the same machinery. Its `osmium.replication.server.ReplicationServer` class talks to a replication URL, resolves your last sequence into a set of diffs, and streams their changes into a handler, while `apply_diffs` drives the whole catch-up. The concrete recipe for bringing a stale file current in Python is [Catching Up a Stale OSM Extract with pyosmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/catching-up-a-stale-osm-extract-with-pyosmium/). Whichever path you take, the invariant is identical: diffs apply in ascending sequence order, and each successful application advances your recorded sequence by exactly the span consumed. Wrapping application in the defensive-decoding and quarantine discipline from [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) keeps a single malformed change from aborting an otherwise healthy run.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Keep a local OSM extract current with replication diffs",
  "description": "The end-to-end loop for updating an OpenStreetMap extract from a replication stream in correct sequence order.",
  "step": [
    { "@type": "HowToStep", "name": "Read the stored sequence", "text": "Read the last applied sequence number from your state store or from the base PBF header field osmosis_replication_sequence_number." },
    { "@type": "HowToStep", "name": "Read the server state", "text": "Fetch state.txt from the replication stream to learn the newest available sequence number and its completeness timestamp." },
    { "@type": "HowToStep", "name": "Fetch the intervening diffs", "text": "Download every .osc.gz between your stored sequence and the server's newest sequence, in ascending order, from the zero-padded slash-segmented paths." },
    { "@type": "HowToStep", "name": "Apply changes in order", "text": "Run osmium apply-changes or pyosmium apply_diffs to merge the create, modify, and delete operations into the base data, writing an updated dataset." },
    { "@type": "HowToStep", "name": "Advance and record state", "text": "On success, record the new sequence number, file checksum, and timestamp durably so the next cycle resumes exactly where this one stopped." }
  ]
}
</script>

## Full-History Files and Temporal Snapshots

Replication keeps the *current* state current, but a whole class of work needs the *past*: what did this neighbourhood look like a year ago, when was this building first mapped, how has road coverage grown. For that OSM distributes full-history files with the `.osh.pbf` extension. Where a standard PBF holds only the latest visible version of each element, an `.osh.pbf` retains *every* version — each carrying its `version`, `timestamp`, `changeset`, and `visible` flag — and declares the `HistoricalInformation` feature in its header so parsers know to expect multiple versions per `(type, id)`. The file is, in effect, the accumulated diff stream folded back into a single object store keyed on `(type, id, version)`.

Reconstructing the map as it stood at an instant is then a filtering operation: for each element, select the highest version whose timestamp is at or before the target instant and whose `visible` flag is true. The `osmium` tool packages this as `time-filter`:

```bash
# Reconstruct the visible state of the map as of a past instant.
osmium time-filter history.osh.pbf 2025-01-01T00:00:00Z \
  --output snapshot-2025.osm.pbf
```

Full-history processing is memory- and CPU-heavy because the version dimension multiplies object counts several-fold, and it interacts with the spatial layer — reconstructing geometry at a past date means resolving node *versions*, not just node IDs, so the incremental index-maintenance patterns in [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) need a temporal key. The dedicated reference [Full-History .osh.pbf Processing](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/) covers version selection, changeset attribution, and the snapshot-reconstruction algorithm in depth.

## Building an Automated Update Pipeline

A production replication pipeline is a small state machine wrapped in a scheduler, and its correctness rests on a few non-negotiable properties. It must be **resumable**: interrupted mid-cycle, the next run continues from the last durably recorded sequence, never re-applying or skipping. It must be **atomic at the state boundary**: the recorded sequence advances only after the corresponding data write has been committed, so a crash between apply and record leaves the data behind the sequence, not ahead of it — behind is safe (the diff re-applies harmlessly under version semantics), ahead is silent data loss. And it must be **idempotent**: re-running a cycle over already-applied diffs produces identical state, which the version-numbered whole-object replacement of OsmChange guarantees as long as you never skip.

The end-to-end assembly — a fetch-apply-record loop, a lock to prevent overlapping runs, checksum verification, and a scheduler to fire it every minute — is the subject of [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/). Two failure modes deserve naming here because they define the pipeline's hard edges. A **sequence gap** occurs when your recorded sequence is so far behind that the stream has rotated the intervening diffs out of retention, or when a run advanced state without a matching data commit; recovery means re-anchoring against a fresh base rather than trying to fetch missing diffs. A **poison diff** — one that fails to apply because the base is at the wrong version — signals that your state and data have diverged and must be reconciled before the loop resumes. Both branch out of the steady-state loop into the gap-recovery path drawn in the overview diagram above.

## Provenance and ODbL for Derived State

Replication changes the licensing picture in a way a static extract does not: a continuously updated database is a *derivative database* under the Open Database License (ODbL), and its share-alike and attribution obligations attach to the state at every point in time, not just at initial import. That makes provenance an engineering requirement, not a footnote. Every update cycle should append to an immutable ledger: the sequence number applied, the source stream URL, the `state.txt` timestamp, and the checksum of the diff file. This ledger is simultaneously your reproducibility record (any past state can be rebuilt by replaying the ledger from a known base) and your compliance record (you can prove, for any published extract, exactly which upstream edits it incorporates and attribute "© OpenStreetMap contributors" against a dated source).

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="prov-chain-t prov-chain-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="prov-chain-t">The provenance record a diff-applying pipeline must carry forward</title>
  <desc id="prov-chain-d">A left-to-right chain. The base extract records its source URL and download date. Each applied diff records its sequence number and timestamp. The current dataset therefore carries a sequence range rather than a single date. The published output attaches the ODbL attribution together with that sequence range, so a consumer can reproduce the exact state.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="prov" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Provenance survives replication only if it records sequences, not dates</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">base extract</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">source URL + SHA</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">seq 6 102 400</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#prov)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">applied diffs</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">seq 6 102 401 …</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">… 6 123 456, in order</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#prov)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">current dataset</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">range, not a date</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">plus applied-at clock</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#prov)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">published output</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">ODbL attribution</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">+ the sequence range</text>
  <text x="440" y="158" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Two consumers given the same sequence range can rebuild byte-identical data; two given the same calendar date cannot.</text>
</svg>
<figcaption>A single "data as of" date stops being true the moment you start applying diffs. What makes a derived dataset reproducible is the sequence range, because a sequence number names one immutable file.</figcaption>
</figure>

The keep-open clause of the ODbL means that if you redistribute the updated database you cannot layer technical restrictions on it, and the share-alike clause means adaptations you publish inherit the licence — both of which are far easier to satisfy when provenance is stamped automatically at each cycle than when reconstructed after the fact. The authoritative obligations are the official [OpenStreetMap Copyright & License](https://www.openstreetmap.org/copyright) terms; pin your interpretation to a dated copy in the same ledger that records your sequences, so licence state and data state are auditable together.

## Explore Replication & Diff Sync in Depth

Each reference below drills into one stage of the update loop introduced above:

- [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) — the OsmChange format field-by-field and how `apply-changes` and pyosmium merge create/modify/delete blocks into a base.
- [Replication Sequence Numbers and State](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) — how sequence numbers, `state.txt`, and header anchors track exactly how current your data is and how to detect gaps.
- [Full-History .osh.pbf Processing](https://www.osm-data-processing.org/osm-replication-diff-sync/full-history-osh-pbf-processing/) — retaining every element version and reconstructing the map at any past instant with `time-filter`.
- [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/) — assembling a resumable, atomic, scheduled fetch-apply-record loop for steady-state tracking.

## Frequently Asked Questions

<details>
<summary>What is the difference between an .osc.gz diff and an .osh.pbf history file?</summary>

An `.osc.gz` (OsmChange) diff carries only the create, modify, and delete operations that occurred between two states of the map, and is the unit of live replication. An `.osh.pbf` full-history file carries every version of every element ever, keyed on type, id, and version, and is used to reconstruct the map as it stood at any past instant. Diffs move you forward from a base; history files let you look backward from the accumulated whole.
</details>

<details>
<summary>Which replication cadence should I choose — minutely, hourly, or daily?</summary>

Pick one cadence per database and match it to your freshness need. Minutely suits live routing and near-real-time tiles; hourly suits analytics refreshed each hour; daily suits nightly batch imports. The three streams carry the same edits at different aggregation levels, so never mix them for one database. For a long initial catch-up use the daily stream to cover the span cheaply, then switch to your steady-state cadence.
</details>

<details>
<summary>Why must diffs be applied strictly in sequence order?</summary>

Each OsmChange modify or delete carries a version number that is only valid against the immediately preceding version of that element. Apply diffs out of order and a modify lands on the wrong base version, so the update either fails or silently overwrites newer state with older. Ascending sequence order guarantees every element passes through its versions in the order they actually occurred upstream.
</details>

<details>
<summary>How do I recover if my extract falls behind the retention window?</summary>

If your last applied sequence has aged out of the stream's retention, the intervening diffs no longer exist to fetch, so you cannot catch up incrementally. Re-anchor instead: download a fresh base extract whose header sequence is recent, record that sequence as your new state, and resume the loop from there. Keep a provenance ledger so the discontinuity is auditable.
</details>

<details>
<summary>What provenance should each update cycle record for ODbL compliance?</summary>

Append the applied sequence number, the source stream URL, the state.txt completeness timestamp, and the diff file checksum to an immutable ledger on every cycle. This lets you rebuild any past state by replay and prove exactly which upstream edits a published extract incorporates, satisfying attribution and share-alike obligations under the ODbL.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is the difference between an .osc.gz diff and an .osh.pbf history file?",
      "acceptedAnswer": { "@type": "Answer", "text": "An .osc.gz OsmChange diff carries only the create, modify, and delete operations between two states of the map, and is the unit of live replication. An .osh.pbf full-history file carries every version of every element ever, keyed on type, id, and version, and is used to reconstruct the map at any past instant. Diffs move you forward from a base; history files let you look backward from the accumulated whole." }
    },
    {
      "@type": "Question",
      "name": "Which replication cadence should I choose — minutely, hourly, or daily?",
      "acceptedAnswer": { "@type": "Answer", "text": "Pick one cadence per database and match it to your freshness need. Minutely suits live routing and near-real-time tiles; hourly suits analytics refreshed each hour; daily suits nightly batch imports. The three streams carry the same edits at different aggregation levels, so never mix them for one database. For a long initial catch-up use the daily stream, then switch to your steady-state cadence." }
    },
    {
      "@type": "Question",
      "name": "Why must diffs be applied strictly in sequence order?",
      "acceptedAnswer": { "@type": "Answer", "text": "Each OsmChange modify or delete carries a version number that is only valid against the immediately preceding version of that element. Apply diffs out of order and a modify lands on the wrong base version, so the update either fails or silently overwrites newer state with older. Ascending sequence order guarantees every element passes through its versions in the order they occurred upstream." }
    },
    {
      "@type": "Question",
      "name": "How do I recover if my extract falls behind the retention window?",
      "acceptedAnswer": { "@type": "Answer", "text": "If your last applied sequence has aged out of the stream's retention, the intervening diffs no longer exist to fetch, so you cannot catch up incrementally. Re-anchor instead: download a fresh base extract whose header sequence is recent, record that sequence as your new state, and resume the loop from there. Keep a provenance ledger so the discontinuity is auditable." }
    },
    {
      "@type": "Question",
      "name": "What provenance should each update cycle record for ODbL compliance?",
      "acceptedAnswer": { "@type": "Answer", "text": "Append the applied sequence number, the source stream URL, the state.txt completeness timestamp, and the diff file checksum to an immutable ledger on every cycle. This lets you rebuild any past state by replay and prove exactly which upstream edits a published extract incorporates, satisfying attribution and share-alike obligations under the ODbL." }
    }
  ]
}
</script>

## Related

- [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/) — the data model, PBF format, and validation gates that replication builds upon.
- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — the block and blob layout that both base extracts and applied output are written in.
- [How to Decode OSM PBF Headers in Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/) — reading the replication sequence number stored in a PBF header.
- [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) — incremental index maintenance as diffs mutate geometry.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — quarantine and defensive decoding for the diffs an update loop consumes.

This section anchors the diff-sync side of the OSM knowledge base; return to the [site home](https://www.osm-data-processing.org/) to explore the fundamentals, parsing, and quality-assurance pipelines that a continuously updated dataset feeds.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "OSM Replication & Diff Sync",
  "description": "How to keep a local OpenStreetMap dataset current with upstream: the OsmChange diff format, replication streams, sequence numbers, osmium apply-changes, full-history files, and ODbL provenance.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Replication & Diff Sync",
  "about": ["OpenStreetMap replication", "OsmChange diff format", "diff sync pipelines"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Replication & Diff Sync", "item": "https://www.osm-data-processing.org/osm-replication-diff-sync/" }
  ]
}
</script>
