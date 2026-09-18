---
title: "Recording OSM Data Provenance in a Pipeline"
description: "Capture the source, version and date at ingestion and carry them through every transformation, so any result can be traced back to the exact bytes it came from."
pageTitle: "Carry OSM Provenance Through Every Pipeline Stage"
pageDescription: "Record source, checksum, replication sequence and processing version at ingestion, propagate them through each transformation, and make any output traceable to the exact input it derives from."
slug: recording-osm-data-provenance-in-a-pipeline
type: article
breadcrumb: "Recording Provenance"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Recording OSM Data Provenance in a Pipeline

Provenance is the licence obligation everybody knows about and the debugging tool nobody expects. It is also the thing that is nearly free to add on day one and a migration project to add on day eight hundred.

## Prerequisites

- [ ] A verified input with a checksum, per [Automating Geofabrik Extract Downloads with Checksums](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/automating-geofabrik-extract-downloads-with-checksums/).
- [ ] Python 3.10+; the record is a dataclass and a hash.
- [ ] A way to read the PBF header's replication fields, from [Extracting Metadata from OSM Planet Files](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/extracting-metadata-from-osm-planet-files/).
- [ ] Version control on the pipeline code, so a processing version can be recorded.
- [ ] Storage for one small record per run and one identifier per output row.

## Conceptual minimum

A provenance record answers one question: **what exactly produced this?** Answering it completely needs four facts.

**The source identity.** Not "Geofabrik" but which file, with the checksum actually consumed. A name without a digest identifies a moving target.

**The data's own timestamp.** The PBF header's replication timestamp and sequence number describe the state of the map the file captures, independently of when it was downloaded or processed.

**The processing version.** Which code produced the output. A result derived by a version of the pipeline with a known bug is distinguishable from one that is not, but only if the version was recorded.

**The run identity.** A stable identifier for this execution, so several outputs from one run can be recognised as siblings.

Together these form a small record that every output references. The record is stored once; outputs carry the identifier.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 226" role="img" aria-labelledby="rdp1-t rdp1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="rdp1-t">The four parts of a provenance record and the question each answers</title>
  <desc id="rdp1-d">A single record divided into four parts. The source identity holds the file name and the checksum actually consumed, answering which bytes were read. The data timestamp holds the replication timestamp and sequence number from the file header, answering what state of the map the file describes. The processing version holds the pipeline's code revision, answering which logic produced the output. The run identity holds a stable identifier for the execution, answering which outputs are siblings from the same run.</desc>
  <rect x="0" y="0" width="880" height="226" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four facts, one small record</text>
  <rect x="26" y="56" width="203" height="54" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="128" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">source</text>
  <text x="128" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">file plus digest</text>
  <text x="128" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">which bytes were read</text>
  <text x="128" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">a name alone is not enough</text>
  <text x="128" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">the digest is the identity</text>
  <rect x="233" y="56" width="203" height="54" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="334" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">data time</text>
  <text x="334" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">timestamp, sequence</text>
  <text x="334" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">from the file header</text>
  <text x="334" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">what the map looked like</text>
  <text x="334" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">not when you downloaded</text>
  <rect x="440" y="56" width="203" height="54" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="542" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">code version</text>
  <text x="542" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">a revision</text>
  <text x="542" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">which logic ran</text>
  <text x="542" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">distinguishes a known bug</text>
  <text x="542" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">from git, not by hand</text>
  <rect x="647" y="56" width="203" height="54" rx="6" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="748" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">run id</text>
  <text x="748" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">one per execution</text>
  <text x="748" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">groups sibling outputs</text>
  <text x="748" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">survives partial reruns</text>
  <text x="748" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">cheap to generate</text>
  <text x="868" y="210" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The second part is the one people omit, and it is the only one that says anything about the data rather than about the process.</text>
</svg>
<figcaption>Outputs carry the record's identifier rather than a copy of it, so the cost per row is a single column.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import hashlib
import json
import logging
import subprocess
import uuid
from dataclasses import dataclass, asdict, replace
from datetime import datetime, timezone
from pathlib import Path

import osmium

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.provenance")


@dataclass(frozen=True)
class Provenance:
    run_id: str
    source_path: str
    source_digest: str
    data_timestamp: str | None       # what the map looked like
    sequence_number: int | None      # replication state of the source
    code_version: str
    started_at: str
    stages: tuple[str, ...] = ()

    @property
    def provenance_id(self) -> str:
        """Stable hash over the facts, so identical inputs give one identifier."""
        payload = json.dumps({
            "source_digest": self.source_digest,
            "data_timestamp": self.data_timestamp,
            "sequence_number": self.sequence_number,
            "code_version": self.code_version,
            "stages": list(self.stages),
        }, sort_keys=True)
        return hashlib.sha256(payload.encode()).hexdigest()[:16]

    def then(self, stage: str) -> "Provenance":
        """Return a new record extended by one transformation stage."""
        return replace(self, stages=self.stages + (stage,))


def code_version() -> str:
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                             capture_output=True, text=True, check=True)
        dirty = subprocess.run(["git", "status", "--porcelain"],
                               capture_output=True, text=True, check=True)
        # A dirty tree means the recorded revision does not describe the code.
        return out.stdout.strip() + ("-dirty" if dirty.stdout.strip() else "")
    except (OSError, subprocess.CalledProcessError):
        logger.warning("no code version available; provenance will be weaker")
        return "unknown"


def digest_of(path: Path, chunk: int = 1 << 20) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as fh:
        while block := fh.read(chunk):
            hasher.update(block)
    return hasher.hexdigest()


def header_facts(path: Path) -> tuple[str | None, int | None]:
    reader = osmium.io.Reader(str(path))
    try:
        header = reader.header()
        stamp = header.get("osmosis_replication_timestamp") or None
        seq = header.get("osmosis_replication_sequence_number") or None
    finally:
        reader.close()
    return stamp, int(seq) if seq else None


def ingest(path: Path) -> Provenance:
    """Capture provenance at the moment the input is first read."""
    stamp, seq = header_facts(path)
    if stamp is None:
        logger.warning("%s has no replication timestamp; freshness is unknowable",
                       path.name)
    prov = Provenance(
        run_id=str(uuid.uuid4()),
        source_path=str(path),
        source_digest=digest_of(path),
        data_timestamp=stamp,
        sequence_number=seq,
        code_version=code_version(),
        started_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
    )
    logger.info("run %s reads %s (data of %s, code %s) -> provenance %s",
                prov.run_id[:8], path.name, stamp, prov.code_version,
                prov.provenance_id)
    return prov


def write_record(prov: Provenance, directory: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{prov.provenance_id}.json"
    path.write_text(json.dumps(asdict(prov), indent=2), encoding="utf-8")
    return path


if __name__ == "__main__":
    prov = ingest(Path("/data/poland-latest.osm.pbf"))
    prov = prov.then("tags-filter:highway").then("export:geoparquet")
    logger.info("after %d stage(s), provenance id is %s",
                len(prov.stages), prov.provenance_id)
    write_record(prov, Path("_provenance"))
```

## Step-by-step walkthrough

1. **Capture at ingestion, not at output.** The facts are available when the file is opened and become guesswork afterwards.
2. **Hash the file you actually read.** A published checksum proves the download was intact; hashing the local file proves you are describing the bytes on disk right now.
3. **Read the header's replication fields.** These describe the map, not the file transfer, and they are what makes a result comparable against another run months later.
4. **Warn when the timestamp is missing.** A file without one cannot support any freshness claim, and knowing that up front is better than discovering it during an investigation.
5. **Record a dirty working tree.** A revision identifier from a modified checkout does not describe the code that ran, and the suffix says so honestly.
6. **Extend rather than mutate through stages.** Each transformation returns a new record with one more stage appended, so the provenance identifier changes when the processing does.
7. **Derive the identifier from the facts.** A content hash means two runs over identical inputs with identical code produce the same identifier, which is what makes outputs comparable.
8. **Store the record once, reference it everywhere.** Outputs carry a sixteen-character identifier; the full record lives in one place.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="rdp2-t rdp2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="rdp2-t">Three questions provenance answers, only one of which is about licensing</title>
  <desc id="rdp2-d">Three panels. The licence question asks what an output is derived from, which attribution and classification both need and which is the reason provenance is usually introduced. The debugging question asks why two runs differ, which is answered instantly when the provenance identifiers differ and requires an investigation when they are absent. The reproducibility question asks how to recreate a result from six months ago, which needs the exact source digest and code revision and is impossible without them.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three questions, three very different audiences</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Licence</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">What is this derived from?</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Attribution needs it</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Classification needs it</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Why it gets introduced</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Debugging</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Why do two runs differ?</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Compare the identifiers</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Instant when present</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">An investigation when not</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Reproducibility</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Recreate last quarter</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Needs digest and revision</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Impossible without both</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Asked during an audit</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The second and third uses are why teams that add provenance for licensing reasons end up keeping it for everything else.</text>
</svg>
<figcaption>One column of sixteen characters answers all three, which is an unusually good return for a design decision.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="rdp3-t rdp3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="rdp3-t">How a provenance identifier survives a multi-stage pipeline</title>
  <desc id="rdp3-d">Four stages of one pipeline run. At ingestion the record holds the source digest, the header timestamp and the code revision, producing an initial identifier. After the filtering stage the record gains that stage's name and the identifier changes. After the export stage it gains another and changes again. Every row written by the export carries only the final identifier, from which the whole lineage can be read back by looking up the stored record.</desc>
  <defs><marker id="rdp3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The identifier changes with the processing, not just the input</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">ingest</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">digest, stamp, revision</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">first identifier</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#rdp3-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">filter</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">stage appended</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">identifier changes</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#rdp3-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">export</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">stage appended</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">identifier changes</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#rdp3-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">rows</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">carry the final one</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">lineage looks up</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Two outputs from the same extract processed differently get different identifiers, which is exactly the distinction a debugger needs.</text>
</svg>
<figcaption>Without the per-stage extension, two very different outputs from one extract would be indistinguishable in the record.</figcaption>
</figure>

## Verification

- **Identical inputs give identical identifiers.** Run twice with no changes; the provenance identifier must match.
- **A code change changes the identifier.** Commit a change and re-run; it must differ.
- **A dirty tree is visible.** Modify a file without committing and confirm the recorded version carries the dirty marker.
- **Every output references a record.** Query outputs for a null provenance identifier; the count must be zero.
- **The record resolves.** Pick an identifier from an output and confirm the stored record for it exists and describes a real file.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Cannot say what a result came from | Provenance captured at output, not input | Capture the moment the file is opened |
| Two runs indistinguishable | Identifier not derived from the facts | Hash source digest, timestamp and code version together |
| Version recorded but wrong | Dirty working tree not detected | Append a marker when the checkout has uncommitted changes |
| Freshness claims unsupportable | Header timestamp never read | Read the replication fields and warn when absent |
| Provenance lost after a transformation | Record not propagated through stages | Extend the record per stage and carry it forward |
| Every row stores the full record | Record copied instead of referenced | Store once, reference by identifier |
| Retrofit is a large project | Provenance added late | Capture from the first version; it is one column |

## Specification reference

> A PBF file's `OSMHeader` may carry `osmosis_replication_timestamp`, `osmosis_replication_sequence_number` and `osmosis_replication_base_url`, describing the replication state the file was produced from. These fields travel with the file through copies and archives, unlike filesystem metadata. See the [PBF format documentation](https://wiki.openstreetmap.org/wiki/PBF_Format) for the header fields and [Replication Sequence Numbers & State](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) for what the sequence number means.

## Frequently Asked Questions

<details>
<summary>Why record the header timestamp as well as the download date?</summary>

Because they answer different questions. The download date says when you fetched the file; the header timestamp says what state of the map the file describes. A file downloaded today can describe a map from last week if a mirror is stale, and only the header field reveals that. It also travels with the file through copies and archives, so a result derived from an archived extract three years ago is still explainable.
</details>

<details>
<summary>Should the provenance identifier be a hash or a sequence?</summary>

A hash over the facts, because it makes identical inputs produce identical identifiers. That in turn means two outputs with the same identifier are provably derived from the same bytes by the same code, which a sequence number cannot tell you. It also removes the need for a central counter, which matters when several machines run stages independently.
</details>

<details>
<summary>How do I carry provenance through a transformation?</summary>

By extending the record rather than replacing it: each stage appends its name and returns a new record, so the identifier changes when the processing does and the lineage is readable from the record itself. That way an output's identifier describes not just which extract it came from but which sequence of transformations produced it, which is what makes two similar-looking outputs distinguishable.
</details>

<details>
<summary>Is one column per row too expensive?</summary>

A sixteen-character identifier is negligible next to geometry, and it is one column rather than a copy of the record. The alternative — reconstructing which run produced which rows, after the fact — is not a cost comparison at all, because it is usually impossible. The genuinely expensive option is adding provenance to a pipeline that has been running without it, which means every historical output stays unexplainable.
</details>

## Related

- [OSM Licensing & ODbL Compliance](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/) — the parent topic and the obligation provenance satisfies.
- [Automating ODbL Attribution in Derived Products](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/automating-odbl-attribution-in-derived-products/) — rendering the credit from this record.
- [Extracting Metadata from OSM Planet Files](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/extracting-metadata-from-osm-planet-files/) — reading the header fields this records.
- [Pinning a Reproducible OSM Snapshot by Sequence Number](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/pinning-a-reproducible-osm-snapshot-by-sequence-number/) — using the sequence number to recreate an input.
- [Mirroring OSM Downloads Behind a Local Cache](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/mirroring-osm-downloads-behind-a-local-cache/) — content-addressed inputs that make this record resolvable.

Up one level: [OSM Licensing & ODbL Compliance](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Recording OSM Data Provenance in a Pipeline",
  "description": "Capture the source, version and date at ingestion and carry them through every transformation, so any result can be traced back to the exact bytes it came from.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["data provenance", "reproducibility", "replication timestamp"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Fundamentals & Architecture", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/" },
    { "@type": "ListItem", "position": 3, "name": "OSM Licensing & ODbL Compliance", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/" },
    { "@type": "ListItem", "position": 4, "name": "Recording OSM Data Provenance in a Pipeline", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/recording-osm-data-provenance-in-a-pipeline/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Record and propagate OSM data provenance",
  "description": "Capture the source digest, the header replication fields, the code revision and a run identifier at ingestion, extend the record per transformation stage, and reference it by a content-derived identifier from every output.",
  "step": [
    { "@type": "HowToStep", "name": "Capture at ingestion", "text": "Record the facts the moment the input file is opened, since they become guesswork afterwards." },
    { "@type": "HowToStep", "name": "Hash the local file", "text": "Compute a digest over the bytes actually read rather than trusting a published checksum alone." },
    { "@type": "HowToStep", "name": "Read the replication fields", "text": "Take the timestamp and sequence number from the file header, and warn when they are absent." },
    { "@type": "HowToStep", "name": "Record the code revision honestly", "text": "Capture the version control revision and mark it when the working tree has uncommitted changes." },
    { "@type": "HowToStep", "name": "Extend per stage", "text": "Append each transformation to the record so the identifier reflects the processing as well as the input." },
    { "@type": "HowToStep", "name": "Derive the identifier by hashing", "text": "Compute the provenance identifier from the facts so identical inputs and code produce the same value." },
    { "@type": "HowToStep", "name": "Store once, reference everywhere", "text": "Persist the full record in one place and carry only its identifier on each output." }
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
      "name": "Why record the PBF header timestamp as well as the download date?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because they answer different questions. The download date says when you fetched the file; the header timestamp says what state of the map the file describes. A file downloaded today can describe a map from last week if a mirror is stale, and only the header field reveals that. It also travels with the file through copies and archives." }
    },
    {
      "@type": "Question",
      "name": "Should a provenance identifier be a hash or a sequence?",
      "acceptedAnswer": { "@type": "Answer", "text": "A hash over the facts, because it makes identical inputs produce identical identifiers. Two outputs with the same identifier are then provably derived from the same bytes by the same code, which a sequence number cannot tell you. It also removes the need for a central counter across machines." }
    },
    {
      "@type": "Question",
      "name": "How do I carry provenance through a transformation?",
      "acceptedAnswer": { "@type": "Answer", "text": "By extending the record rather than replacing it: each stage appends its name and returns a new record, so the identifier changes when the processing does and the lineage is readable from the record. An output's identifier then describes both the extract and the sequence of transformations." }
    },
    {
      "@type": "Question",
      "name": "Is one provenance column per row too expensive?",
      "acceptedAnswer": { "@type": "Answer", "text": "A sixteen-character identifier is negligible next to geometry, and it is one column rather than a copy of the record. The alternative — reconstructing which run produced which rows after the fact — is usually impossible. The genuinely expensive option is adding provenance to a pipeline that has been running without it." }
    }
  ]
}
</script>
