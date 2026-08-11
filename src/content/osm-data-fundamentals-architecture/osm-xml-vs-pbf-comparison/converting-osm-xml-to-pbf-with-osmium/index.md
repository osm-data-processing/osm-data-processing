---
title: "Converting OSM XML to PBF with osmium"
description: "Convert .osm or .osm.bz2 to .osm.pbf with osmium cat, keeping the object metadata and replication anchor the conversion drops by default, and verifying nothing was lost."
pageTitle: "Convert OSM XML to PBF with osmium"
pageDescription: "A complete XML-to-PBF conversion: add_metadata, output-header replication anchors, streaming from bzcat without a temp file, and a probe that proves metadata survived."
slug: "converting-osm-xml-to-pbf-with-osmium"
type: "article"
breadcrumb: "Converting XML to PBF"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Converting OSM XML to PBF with osmium

Turn a `.osm` or `.osm.bz2` file into a `.osm.pbf` that later passes read twenty times faster — and carry across the metadata the conversion drops by default.

## Prerequisites

- [ ] `osmium-tool` 1.14 or later
- [ ] The source XML, compressed or not
- [ ] Free disk for the output: expect roughly 6 percent of uncompressed XML
- [ ] A decision about whether object metadata (version, timestamp, user) is needed downstream

## Conceptual minimum

XML and PBF describe the same OSM data model with very different encodings, compared in detail in [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/). The conversion is mechanical: parse the XML into objects, then write those objects in PBF's blocked, string-tabled, delta-encoded form.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="conv-cost-t conv-cost-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="conv-cost-t">Seconds per stage converting an OSM XML file to PBF</title>
  <desc id="conv-cost-d">A bar chart of converting a 1.9 gigabyte uncompressed Ireland XML extract to PBF. Reading and parsing the XML takes 148 seconds and dominates. Building objects takes 34 seconds. Delta encoding and deflating takes 61 seconds. Writing the 118 megabyte output takes 12 seconds. Re-reading the resulting PBF later takes 9 seconds, which is what the conversion bought.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What the conversion actually costs</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">Ireland, 1.9 GB uncompressed .osm → .osm.pbf</text>
  <line x1="250" y1="68" x2="250" y2="270" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">read + parse XML</text>
  <rect x="250" y="74" width="470" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="868" y="89" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">148 s · the dominant cost</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">build objects</text>
  <rect x="250" y="116" width="108" height="21" rx="3" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="368" y="131" font-size="11" fill="currentColor" opacity="0.9">34 s</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">delta-encode + deflate</text>
  <rect x="250" y="158" width="194" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="454" y="173" font-size="11" fill="currentColor" opacity="0.9">61 s</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">write output</text>
  <rect x="250" y="200" width="38" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="298" y="215" font-size="11" fill="currentColor" opacity="0.9">12 s · 118 MB result</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">(re-reading the PBF later)</text>
  <rect x="250" y="242" width="29" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="289" y="257" font-size="11" fill="currentColor" opacity="0.9">9 s · what you bought</text>
  <text x="440" y="306" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Conversion pays for itself on the second read. If a file is read once and discarded, converting it is pure cost.</text>
</svg>
<figcaption>The conversion is a one-off tax on the XML read. Every subsequent pass is roughly twenty times faster, which is the whole argument.</figcaption>
</figure>

The cost is entirely in reading the XML, which means the economics are simple. Converting a file you will read once is a waste; converting one that feeds a pipeline is repaid on the second pass and every pass after.

What makes the conversion worth doing carefully is what it silently does not carry.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 358" role="img" aria-labelledby="conv-fields-t conv-fields-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="conv-fields-t">What an XML to PBF conversion preserves and what it drops</title>
  <desc id="conv-fields-d">A grid of six field groups. Nodes, ways and relations carry over automatically, as do tags, which the string table deduplicates. Version, timestamp and user identifier carry over only with the metadata output option and are dropped by default in some builds. The bounding box is computed from the data and written into the header. The replication anchor is not carried and must be set with an output-header flag. Changeset comments are never in the file at all and live on the changeset API.</desc>
  <rect x="0" y="0" width="880" height="358" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What survives the conversion, and what you must ask for</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">carried automatically?</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">note</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">nodes, ways, relations</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">yes</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">the whole point</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">tags</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">yes</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">string table deduplicates them</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">version / timestamp / uid</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">only with --output-format metadata</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">dropped by default in some builds</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">bounding box</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">computed from the data</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">written into the header</text>
  <text x="198" y="264" text-anchor="end" font-size="11.5" fill="currentColor">replication anchor</text>
  <rect x="213" y="244" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">no</text>
  <rect x="535" y="244" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">set it with --output-header</text>
  <text x="198" y="304" text-anchor="end" font-size="11.5" fill="currentColor">changeset comments</text>
  <rect x="213" y="284" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="371" y="304" text-anchor="middle" font-size="10.5" fill="currentColor">no — never in the file</text>
  <rect x="535" y="284" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="693" y="304" text-anchor="middle" font-size="10.5" fill="currentColor">they live on the changeset API</text>
  <text x="440" y="340" text-anchor="middle" font-size="10.0" fill="currentColor" opacity="0.85">Two of these six are lost silently. Object metadata and the replication anchor both need an explicit flag, and neither absence raises anything.</text>
</svg>
<figcaption>The two silent losses are object metadata and the replication anchor. Neither raises an error and both matter later.</figcaption>
</figure>

Object metadata is the first trap. A PBF written without it has no `version`, `timestamp` or `uid` on any object, which is fine for rendering and fatal for anything doing history, attribution or conflict detection — and nothing complains until a downstream tool finds `version` is zero everywhere.

The replication anchor is the second. An XML file has nowhere structured to record which replication sequence it corresponds to, so a converted PBF starts life with no anchor and cannot be caught up by the workflow in [Catching Up a Stale OSM Extract with pyosmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/catching-up-a-stale-osm-extract-with-pyosmium/) unless you supply it.

## Runnable solution

```bash
#!/usr/bin/env bash
# Convert an OSM XML extract to PBF, preserving metadata and setting a
# replication anchor so the result can be kept current afterwards.
set -euo pipefail

IN="${1:?usage: convert.sh <input.osm[.bz2]> <output.osm.pbf>}"
OUT="${2:?}"
REPL_BASE="${REPL_BASE:-https://planet.osm.org/replication/minute/}"

# Object metadata is not carried by every build's defaults — ask for it.
osmium cat "$IN" \
  --output-format "pbf,add_metadata=true" \
  --output-header "osmosis_replication_base_url=${REPL_BASE}" \
  --overwrite \
  -o "$OUT"

osmium fileinfo --extended "$OUT"
```

For a compressed source too large to decompress to disk:

```bash
bzcat planet.osm.bz2 \
  | osmium cat -F osm - \
      --output-format "pbf,add_metadata=true" \
      --overwrite -o planet.osm.pbf
```

And the verification worth running every time, because two of the failures are silent:

```python
#!/usr/bin/env python3
"""Verify a converted PBF kept the object metadata and carries a replication anchor."""
from __future__ import annotations

import json
import logging
import subprocess
import sys

import osmium

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


class MetadataProbe(osmium.SimpleHandler):
    """Sample the first N objects and record whether metadata survived."""

    def __init__(self, sample: int = 1000) -> None:
        super().__init__()
        self.sample = sample
        self.seen = 0
        self.with_version = 0
        self.with_timestamp = 0
        self.with_uid = 0

    def node(self, n) -> None:
        if self.seen >= self.sample:
            return
        self.seen += 1
        if n.version:
            self.with_version += 1
        if n.timestamp and n.timestamp.year > 1970:
            self.with_timestamp += 1
        if n.uid:
            self.with_uid += 1


def verify(path: str) -> None:
    info = json.loads(subprocess.run(
        ["osmium", "fileinfo", "--extended", "--json", path],
        capture_output=True, text=True, check=True).stdout)

    counts = info["data"]["count"]
    if counts["nodes"] == 0:
        raise ValueError(f"{path}: no nodes — the conversion produced an empty file")

    header = info["header"]["options"]
    if "osmosis_replication_base_url" not in header:
        logger.warning("%s: no replication anchor — this file cannot be caught up", path)

    probe = MetadataProbe()
    probe.apply_file(path)
    if probe.seen and probe.with_version < probe.seen:
        logger.error("%s: %d/%d sampled nodes have no version — metadata was dropped",
                     path, probe.seen - probe.with_version, probe.seen)
        sys.exit(1)

    logger.info("%s: %d nodes, %d ways, %d relations; metadata intact on %d/%d sampled",
                path, counts["nodes"], counts["ways"], counts["relations"],
                probe.with_version, probe.seen)


if __name__ == "__main__":
    verify(sys.argv[1])
```

<figure class="diagram-wrap">
<svg viewBox="0 0 880 251" role="img" aria-labelledby="conv-modes-t conv-modes-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="conv-modes-t">Three ways to invoke the conversion</title>
  <desc id="conv-modes-d">Three panels. A straight conversion uses osmium cat with input and output filenames, inferring format from extensions and changing nothing else; add overwrite for reruns. Convert-and-filter uses osmium tags-filter with a way highway selector in a single pass, producing much smaller output when the subset is known. Converting a stream pipes bzcat into osmium cat with a dash for stdin and an explicit input format flag, avoiding any intermediate file when disk is tight.</desc>
  <rect x="0" y="0" width="880" height="251" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three conversion jobs, three different commands</text>
  <rect x="26" y="52" width="258" height="157" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Straight conversion</text>
  <text x="40" y="104" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">osmium cat in.osm -o out.osm.pbf</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Format inferred from the extensions</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Nothing else changes</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Add `--overwrite` for reruns</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">The default for a one-off</text>
  <rect x="310" y="52" width="258" height="157" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="439" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Convert and filter</text>
  <text x="324" y="104" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">osmium tags-filter in.osm \</text>
  <text x="324" y="125" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">  w/highway -o roads.osm.pbf</text>
  <text x="324" y="146" font-size="10.5" fill="currentColor" opacity="0.92">One pass, not two</text>
  <text x="324" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Much smaller output</text>
  <text x="324" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Best when you know the subset</text>
  <rect x="594" y="52" width="258" height="157" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="723" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Convert a stream</text>
  <text x="608" y="104" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">bzcat in.osm.bz2 | \</text>
  <text x="608" y="125" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">  osmium cat -F osm - -o out.pbf</text>
  <text x="608" y="146" font-size="10.5" fill="currentColor" opacity="0.92">No intermediate file on disk</text>
  <text x="608" y="167" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">-F` names the input format</text>
  <text x="608" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Needed when disk is tight</text>
  <text x="440" y="235" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">The streaming form is the one worth knowing: converting a compressed planet XML without ever writing the uncompressed form saves hundreds of gigabytes.</text>
</svg>
<figcaption>Piping from the compressed source is the form that matters at planet scale — it never materialises the uncompressed XML at all.</figcaption>
</figure>

## Step-by-step walkthrough

`osmium cat` is the general format-conversion command; it reads whatever it is given and writes whatever the output extension implies. Nothing about the data changes, which is what makes it safe — the same objects, the same identifiers, a different encoding.

`--output-format "pbf,add_metadata=true"` is the flag that matters. The `pbf` output format takes comma-separated options, and `add_metadata` controls whether version, timestamp, changeset and user are written. Leaving it to the default is the source of most "why is `version` zero" questions.

`--output-header` writes arbitrary key-value pairs into the PBF header. Setting the replication base URL costs nothing and is the difference between a file that can be updated and one that can only be regenerated. If you also know the sequence number the XML corresponds to, set `osmosis_replication_sequence_number` too.

The `-F osm` in the streaming form tells `osmium` what it is reading, because standard input has no extension to infer from. Omitting it produces an immediate and clear error, which is the one failure in this guide that is not silent.

`MetadataProbe` samples rather than scanning the whole file. A thousand objects is plenty to detect a global metadata drop, and it turns verification from a second full pass into a fraction of a second.

## Verification

Run `osmium fileinfo --extended` on the output and read three things: a non-zero object count, a bounding box that matches the source area, and the header options containing your replication anchor.

Then compare object counts against the source, which catches a truncated conversion:

```bash
osmium fileinfo --extended input.osm     | grep -A4 'Number of'
osmium fileinfo --extended output.osm.pbf | grep -A4 'Number of'
```

The counts must match exactly. A conversion cannot legitimately lose objects, so any difference is a truncated read — usually a source file that was itself incomplete.

Finally, confirm the round trip is lossless on a small file:

```bash
osmium cat output.osm.pbf -o roundtrip.osm --overwrite
osmium diff input.osm roundtrip.osm && echo "identical"
```

## Common errors and fixes

| Message or symptom | Root cause | Fix |
|---|---|---|
| `Cannot detect file format` | Reading from stdin without `-F` | Pass `-F osm` or `-F osm.bz2` |
| `version` is 0 on every object | Metadata not requested | `--output-format "pbf,add_metadata=true"` |
| Converted file cannot be diff-updated | No replication anchor | Set `--output-header` |
| `Open file ... exists` | osmium will not clobber | `--overwrite` |
| Conversion runs out of disk | Decompressing to a temp file first | Pipe from `bzcat` instead |
| Output far smaller than expected | Source XML truncated mid-file | Compare object counts against the source |
| Conversion is slower than expected | bzip2 input decompressing single-threaded | Use `lbzip2 -dc` if available |

## Frequently Asked Questions

<details>
<summary>Is the conversion lossless?</summary>

For the data model, yes — every node, way, relation and tag survives, and `osmium diff` on a round trip reports no differences. What is not preserved is anything the XML carried outside the model: comments, whitespace, attribute ordering and any non-standard elements a producer added. If those matter, keep the original.
</details>

<details>
<summary>Should I convert or just parse the XML directly?</summary>

Convert if the file will be read more than once, which in a pipeline it always is. The conversion costs roughly one XML read and every subsequent pass is around twenty times faster, so the break-even is immediate. Parse XML directly only for a genuinely single-pass job, such as a one-off count.
</details>

<details>
<summary>What compression should the PBF use?</summary>

The default zlib compression is right for almost everything. `osmium` also offers `pbf_compression=lz4`, which writes and reads faster and produces files roughly 30 percent larger; it is worth considering for short-lived intermediates in a pipeline, and not for anything archived or shared, because lz4-compressed PBF is not universally supported.
</details>

<details>
<summary>Can I convert a history file the same way?</summary>

Yes, but the output must be named `.osh.pbf` and metadata is not optional — a history file without versions and timestamps is meaningless, since those are what distinguish the versions from each other. `osmium` sets the `HistoricalInformation` required feature in the header automatically, which is what tells a snapshot reader to refuse the file rather than silently emit every version.
</details>

## Where the conversion belongs in a pipeline

Convert once, at the boundary where data enters your control, and never again. That placement has two practical consequences worth stating.

The first is that the converted file becomes the artefact everything downstream refers to, so it needs an identity. Record its SHA-256 alongside the source URL and the conversion date, because "the Ireland extract" is not a reproducible reference and a re-download a week later is a different file with different content. Once the hash is recorded, any later question about why a number changed can be answered by comparing hashes rather than by guessing.

The second is that conversion is the natural place to apply a filter. If the pipeline only ever reads highways, `osmium tags-filter` during the conversion produces a file a fraction of the size, and every subsequent pass is faster in proportion. The cost is that the filtered file cannot answer questions about anything else, so keep the unfiltered conversion too when disk allows — it is the thing you will want when a new consumer appears.

Where the source is refreshed on a schedule, the conversion belongs in the same job as the download, with both writing to a temporary name and being renamed together on success. A half-downloaded XML converted into a valid-looking PBF is a genuinely nasty failure, because nothing downstream can tell that it is short.

## Specification reference

> `osmium cat [INFILE...] -o OUTFILE` converts between OSM file formats, inferring both from filename suffixes unless `-F`/`-f` override them. Output format options are appended after the format name, comma-separated; `add_metadata` controls whether object version, timestamp, changeset, uid and user are written. `--output-header KEY=VALUE` writes arbitrary header fields.

## Related

- [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/) — why the two encodings differ so much in cost.
- [Measuring OSM XML vs PBF Parse Throughput](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/measuring-osm-xml-vs-pbf-parse-throughput/) — putting numbers on the payback.
- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — what the writer is producing.
- [Extracting Metadata from OSM Planet Files](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/extracting-metadata-from-osm-planet-files/) — reading the header fields this sets.
- [Catching Up a Stale OSM Extract with pyosmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/catching-up-a-stale-osm-extract-with-pyosmium/) — what the replication anchor enables.

Up one level: [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/).
