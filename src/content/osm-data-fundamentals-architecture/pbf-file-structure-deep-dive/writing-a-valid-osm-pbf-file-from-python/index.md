---
title: "Writing a Valid OSM PBF File from Python"
description: "Emit a PBF that every reader accepts: a header declaring only features you implement, size-bounded blocks, a built string table, sorted elements and correct delta encoding."
pageTitle: "Writing an OSM PBF File Readers Will Accept"
pageDescription: "Produce a conforming OSM PBF from Python: declare required features honestly, keep blobs under the size limit, build per-block string tables, sort by identifier, and delta-encode dense nodes."
slug: writing-a-valid-osm-pbf-file-from-python
type: article
breadcrumb: "Writing a PBF"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Writing a Valid OSM PBF File from Python

Reading a PBF forgivingly is easy; writing one that every other reader accepts is where the specification's quiet requirements surface. Most of them are about size limits and ordering, and none of them produces a helpful error when broken.

## Prerequisites

- [ ] Python 3.10+ with the OSM protobuf definitions compiled, or `pyosmium` if you would rather use its writer.
- [ ] The format from [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/).
- [ ] String table semantics from [Decoding the PBF String Table and Tag Indices](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/decoding-the-pbf-string-table-and-tag-indices/).
- [ ] `osmium fileinfo` available, since it is the quickest independent check.
- [ ] A clear reason to be writing PBF by hand rather than using a library.

## Conceptual minimum

Five requirements decide whether a reader accepts your file.

**The header must declare what you used.** `required_features` lists capabilities a reader must support — `OsmSchema-V0.6` always, `DenseNodes` if you used them, `HistoricalInformation` for history files. Declaring a feature you did not use makes readers refuse unnecessarily; omitting one you did use makes them misread silently.

**Blobs have hard size limits.** An uncompressed blob must not exceed 32 MiB and a header blob 64 KiB, with a strong recommendation to stay under 16 MiB for data. A reader encountering a larger blob is entitled to refuse.

**String tables are per block.** Each block carries only the strings its own elements use, and the empty string occupies index 0.

**Elements must be sorted and grouped.** Nodes, then ways, then relations, each ascending by identifier. Many readers rely on this for streaming joins, and a file that violates it works in some tools and fails mysteriously in others.

**Dense nodes are delta-encoded.** Identifiers, latitudes and longitudes are stored as differences from the previous value, with the first relative to zero.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 386" role="img" aria-labelledby="wpp1-t wpp1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="wpp1-t">The five requirements, in the order a writer must satisfy them</title>
  <desc id="wpp1-d">Five stacked requirements. The header must declare exactly the features used, since over-declaring makes readers refuse and under-declaring makes them misread. Blocks must stay under the uncompressed size limit, which means batching elements by estimated size rather than by count. Each block needs its own string table containing only the strings its elements use, with the empty string first. Elements must be written grouped by type and sorted by identifier within each group. Dense node fields must be delta-encoded against the previous value in the same group.</desc>
  <rect x="0" y="0" width="880" height="386" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Five requirements, none of which errors loudly</text>
  <rect x="26" y="50" width="828" height="52" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="42" y="72" font-size="12.5" font-weight="700" fill="currentColor">Header features</text>
  <text x="42" y="90" font-size="10.5" fill="currentColor" opacity="0.88">Declare exactly what you used</text>
  <text x="838" y="82" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">over or under both break</text>
  <rect x="26" y="112" width="828" height="52" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="42" y="134" font-size="12.5" font-weight="700" fill="currentColor">Blob size</text>
  <text x="42" y="152" font-size="10.5" fill="currentColor" opacity="0.88">Stay under the uncompressed limit</text>
  <text x="838" y="144" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">batch by size, not count</text>
  <rect x="26" y="174" width="828" height="52" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="42" y="196" font-size="12.5" font-weight="700" fill="currentColor">String table</text>
  <text x="42" y="214" font-size="10.5" fill="currentColor" opacity="0.88">Per block, empty string first</text>
  <text x="838" y="206" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">only what the block uses</text>
  <rect x="26" y="236" width="828" height="52" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="42" y="258" font-size="12.5" font-weight="700" fill="currentColor">Sort order</text>
  <text x="42" y="276" font-size="10.5" fill="currentColor" opacity="0.88">Type groups, ascending ids</text>
  <text x="838" y="268" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">readers rely on it</text>
  <rect x="26" y="298" width="828" height="52" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.5"/>
  <text x="42" y="320" font-size="12.5" font-weight="700" fill="currentColor">Delta encoding</text>
  <text x="42" y="338" font-size="10.5" fill="currentColor" opacity="0.88">Ids and coordinates as differences</text>
  <text x="838" y="330" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">first is against zero</text>
  <text x="868" y="370" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A file breaking any of these is accepted by some readers and rejected or misread by others, which is the worst kind of bug to ship.</text>
</svg>
<figcaption>Nothing in the format checks these for you; conformance is entirely the writer's responsibility.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import struct
import zlib
from dataclasses import dataclass, field
from pathlib import Path

# Generated from the OSM .proto definitions with protoc.
from osmformat_pb2 import (DenseNodes, HeaderBlock, PrimitiveBlock,
                           PrimitiveGroup, StringTable)
from fileformat_pb2 import Blob, BlobHeader

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.pbf.write")

MAX_BLOB_UNCOMPRESSED = 16 * 1024 * 1024      # recommended ceiling, not the hard 32
MAX_HEADER_BLOB = 64 * 1024
NANO = 1_000_000_000


@dataclass
class Node:
    osm_id: int
    lat: float
    lon: float
    tags: dict[str, str] = field(default_factory=dict)


class TableBuilder:
    """Per-block string table. Index 0 is the empty string, always."""

    def __init__(self) -> None:
        self._index: dict[str, int] = {"": 0}
        self._entries: list[str] = [""]

    def add(self, text: str) -> int:
        existing = self._index.get(text)
        if existing is not None:
            return existing
        self._index[text] = len(self._entries)
        self._entries.append(text)
        return self._index[text]

    def build(self) -> StringTable:
        table = StringTable()
        table.s.extend(e.encode("utf-8") for e in self._entries)
        return table


def write_blob(handle, blob_type: str, payload: bytes) -> None:
    """Frame one blob: length, BlobHeader, then the compressed Blob."""
    raw_size = len(payload)
    limit = MAX_HEADER_BLOB if blob_type == "OSMHeader" else MAX_BLOB_UNCOMPRESSED
    if raw_size > limit:
        raise ValueError(f"{blob_type} blob is {raw_size} bytes, over the "
                         f"{limit} limit; emit smaller blocks")

    blob = Blob()
    blob.raw_size = raw_size
    blob.zlib_data = zlib.compress(payload, 6)
    encoded = blob.SerializeToString()

    header = BlobHeader()
    header.type = blob_type
    header.datasize = len(encoded)
    header_bytes = header.SerializeToString()

    # The only fixed-width field in the whole format: a big-endian int32.
    handle.write(struct.pack(">I", len(header_bytes)))
    handle.write(header_bytes)
    handle.write(encoded)


def write_header(handle, bbox: tuple[float, float, float, float],
                 dense: bool, source: str) -> None:
    block = HeaderBlock()
    # Declare exactly what the file uses: over-declaring makes readers refuse.
    block.required_features.append("OsmSchema-V0.6")
    if dense:
        block.required_features.append("DenseNodes")
    block.optional_features.append("Sort.Type_then_ID")
    block.writingprogram = "osm-pipeline-example 1.0"
    block.source = source

    left, bottom, right, top = bbox
    block.bbox.left = int(left * NANO)
    block.bbox.bottom = int(bottom * NANO)
    block.bbox.right = int(right * NANO)
    block.bbox.top = int(top * NANO)
    write_blob(handle, "OSMHeader", block.SerializeToString())


def build_dense_block(nodes: list[Node]) -> PrimitiveBlock:
    """One block of dense nodes, delta-encoded and tag-interleaved."""
    table = TableBuilder()
    dense = DenseNodes()

    last_id = last_lat = last_lon = 0
    for node in sorted(nodes, key=lambda n: n.osm_id):
        lat = int(node.lat * NANO)
        lon = int(node.lon * NANO)
        # Deltas against the previous node; the first is against zero.
        dense.id.append(node.osm_id - last_id)
        dense.lat.append(lat - last_lat)
        dense.lon.append(lon - last_lon)
        last_id, last_lat, last_lon = node.osm_id, lat, lon

        for key, value in node.tags.items():
            dense.keys_vals.append(table.add(key))
            dense.keys_vals.append(table.add(value))
        dense.keys_vals.append(0)          # terminator, even when untagged

    block = PrimitiveBlock()
    block.stringtable.CopyFrom(table.build())
    block.granularity = 100                 # nanodegrees per unit
    block.lat_offset = 0
    block.lon_offset = 0
    group = PrimitiveGroup()
    group.dense.CopyFrom(dense)
    block.primitivegroup.append(group)
    return block


def batch_by_size(nodes: list[Node], target_bytes: int) -> list[list[Node]]:
    """Batch by ESTIMATED SIZE, not by count: tag-heavy nodes are much larger."""
    batches: list[list[Node]] = [[]]
    size = 0
    for node in nodes:
        estimate = 16 + sum(len(k) + len(v) + 4 for k, v in node.tags.items())
        if size + estimate > target_bytes and batches[-1]:
            batches.append([])
            size = 0
        batches[-1].append(node)
        size += estimate
    return batches


def write_pbf(path: Path, nodes: list[Node],
              bbox: tuple[float, float, float, float]) -> None:
    ordered = sorted(nodes, key=lambda n: n.osm_id)
    with path.open("wb") as handle:
        write_header(handle, bbox, dense=True, source="osm-pipeline-example")
        for batch in batch_by_size(ordered, MAX_BLOB_UNCOMPRESSED // 2):
            payload = build_dense_block(batch).SerializeToString()
            write_blob(handle, "OSMData", payload)
    logger.info("wrote %d node(s) to %s", len(ordered), path)


if __name__ == "__main__":
    sample = [Node(1, 50.06, 19.94, {"amenity": "pharmacy"}),
              Node(2, 50.07, 19.95, {})]
    write_pbf(Path("out.osm.pbf"), sample, (19.9, 50.0, 20.0, 50.1))
```

## Step-by-step walkthrough

1. **Declare features honestly.** `DenseNodes` goes in only when dense nodes are used. A file declaring it without using them is refused by strict readers for no reason.
2. **Check blob sizes before writing.** The check is on the *uncompressed* payload, because that is what the limit applies to and what a reader must allocate.
3. **Batch by estimated size, not by element count.** A thousand untagged nodes and a thousand heavily tagged ones differ by more than an order of magnitude, so a count-based batch overflows unpredictably.
4. **Build the string table as you go.** Adding strings during encoding means the table contains exactly what the block uses and nothing else.
5. **Emit a terminator for every node.** Including untagged ones, whose contribution is the terminator alone. Omitting it desynchronises every reader.
6. **Delta-encode against the previous value in the group.** The first element's deltas are against zero, and the accumulator resets at each block boundary.
7. **Sort before batching.** Sorting within a batch is not enough; the file-level order must be ascending, so the sort has to happen before the split.
8. **Write the length prefix big-endian.** It is the only fixed-width field in the format and the only place byte order matters.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="wpp2-t wpp2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="wpp2-t">Three writer mistakes and the reader behaviour each produces</title>
  <desc id="wpp2-d">Three panels. An over-declared required feature makes strict readers refuse the file outright while lenient ones accept it, so the file works in testing and fails in production. An oversized blob is refused by conforming readers and accepted by permissive ones, which produces a file that works in the tool it was tested with and nowhere else. Unsorted elements break readers that rely on ordering for streaming joins, usually producing missing geometry rather than an error.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three mistakes, three partial failures</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Feature over-declared</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Strict readers refuse</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Lenient ones accept</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Works in testing</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Fails somewhere else</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Blob too large</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Conforming readers refuse</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Permissive ones accept</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Works in one tool</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Nowhere else</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Elements unsorted</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Streaming joins break</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Usually no error</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Geometry goes missing</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Looks like a data gap</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Each of these produces a file that some reader accepts, which is why testing against one tool proves almost nothing.</text>
</svg>
<figcaption>Verifying with at least two independent readers is the cheapest way to catch all three.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 226" role="img" aria-labelledby="wpp3-t wpp3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="wpp3-t">What the writer emits, in order, for one small file</title>
  <desc id="wpp3-d">A file laid out left to right in four parts. The first part is the header blob framing: a four byte big-endian length, a blob header naming the type, and the compressed header block declaring required features and the bounding box. The second and third parts are data blobs with the same framing, each holding one primitive block with its own string table and one group of delta-encoded dense nodes. The fourth part notes that the file simply ends after the last blob, with no trailer or index of any kind.</desc>
  <rect x="0" y="0" width="880" height="226" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Length, header, blob — repeated, with no trailer</text>
  <rect x="26" y="56" width="222" height="54" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="137" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">header blob</text>
  <text x="137" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">under 64 KiB</text>
  <text x="137" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">required features</text>
  <text x="137" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">bounding box</text>
  <text x="137" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">writing program</text>
  <rect x="252" y="56" width="222" height="54" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="363" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">data blob 1</text>
  <text x="363" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">under 16 MiB</text>
  <text x="363" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">own string table</text>
  <text x="363" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">one dense group</text>
  <text x="363" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">lowest ids</text>
  <rect x="478" y="56" width="222" height="54" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="589" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">data blob 2</text>
  <text x="589" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">under 16 MiB</text>
  <text x="589" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">own string table</text>
  <text x="589" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">continues the order</text>
  <text x="589" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">higher ids</text>
  <rect x="703" y="56" width="147" height="54" rx="6" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="777" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">end of file</text>
  <text x="777" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">no trailer</text>
  <text x="777" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">nothing follows</text>
  <text x="777" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">no index</text>
  <text x="777" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">no element count</text>
  <text x="868" y="210" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The absence of a trailer is why a truncated file parses happily up to the point where the data simply stops.</text>
</svg>
<figcaption>A reader cannot tell a complete file from a truncated one without an external checksum, which is why downloads carry them.</figcaption>
</figure>

## Verification

- **An independent tool reads it.** `osmium fileinfo` should report the expected element counts and bounding box.
- **Round-trip the data.** Read the file back with a different library and compare element counts and a sample of tags.
- **Blob sizes are within limits.** Instrument the writer to log each blob's uncompressed size; none should approach the ceiling.
- **Order holds across blocks.** Confirm the last identifier of one block is less than the first of the next.
- **Untagged nodes survive.** Include some in the test data and confirm they read back with empty tags rather than inheriting a neighbour's.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Some readers refuse the file | A declared feature is unused | Declare only the features actually used |
| Reader reports an oversized blob | Batched by element count | Batch by estimated uncompressed size |
| Tags attached to the wrong nodes | Terminator omitted for untagged nodes | Append a zero after every node's tags |
| Coordinates wildly wrong | Deltas taken against the wrong baseline | Reset accumulators at each block boundary |
| Streaming joins fail downstream | Elements not globally sorted | Sort before batching, not within batches |
| File unreadable from the first byte | Length prefix written little-endian | Pack the prefix as a big-endian integer |
| Strings decode as nonsense | String table shared across blocks | Build a fresh table per block |

## Specification reference

> A PBF file is a sequence of blobs, each preceded by a four-byte big-endian length and a `BlobHeader`. Header blobs must not exceed 64 KiB and data blobs must not exceed 32 MiB uncompressed, with 16 MiB recommended. The `HeaderBlock` lists `required_features` a reader must support. Dense node identifiers and coordinates are delta-encoded within a group, and the string table's index 0 is the empty string. See the [PBF format documentation](https://wiki.openstreetmap.org/wiki/PBF_Format) for the message definitions and limits.

## Frequently Asked Questions

<details>
<summary>Should I write PBF by hand at all?</summary>

Usually not. An existing writer handles every requirement here and has been tested against the readers you care about. Writing by hand is worth it when you need output a library does not produce, when you are learning the format deliberately, or when the dependency is unacceptable. If you do, verify against at least two independent readers, because conformance mistakes are accepted by some tools and not others.
</details>

<details>
<summary>Why batch by size rather than element count?</summary>

Because element size varies by more than an order of magnitude. A thousand untagged nodes might be twenty kilobytes; a thousand heavily tagged points of interest might be four hundred. A count-based batch tuned on one produces oversized blobs on the other, and the limit applies to the uncompressed payload, so compression does not rescue it. Estimating size per element and accumulating is a few lines and removes the failure entirely.
</details>

<details>
<summary>What happens if I declare a feature I did not use?</summary>

Strict readers refuse the file, because the declaration is a statement that they must support something to read it correctly. Lenient readers accept it. The result is a file that works in whichever tool you tested with and fails elsewhere, which is harder to diagnose than an outright rejection. Declare exactly what the file contains.
</details>

<details>
<summary>Does element ordering really matter?</summary>

Yes, for consumers that stream. A reader building way geometry in a single pass depends on encountering all nodes before the ways that reference them, and that only holds if the file is grouped by type and sorted by identifier. A file violating the order reads fine in tools that buffer everything and produces missing geometry in tools that do not — usually reported as a data gap rather than as a format problem.
</details>

## Related

- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — the parent topic and the container this writes.
- [Decoding the PBF String Table and Tag Indices](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/decoding-the-pbf-string-table-and-tag-indices/) — the table this builds, from the reading side.
- [Reading Dense Nodes and Delta-Encoded Coordinates](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/reading-dense-nodes-and-delta-encoded-coordinates/) — the encoding this must produce correctly.
- [How to Decode OSM PBF Headers in Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/) — verifying the header this writes.
- [Converting OSM XML to PBF with osmium](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/converting-osm-xml-to-pbf-with-osmium/) — the tool that does all of this for you.

Up one level: [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Writing a Valid OSM PBF File from Python",
  "description": "Emit a PBF that every reader accepts: a header declaring only features you implement, size-bounded blocks, a built string table, sorted elements and correct delta encoding.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["PBF writing", "blob size limits", "required features"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Fundamentals & Architecture", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/" },
    { "@type": "ListItem", "position": 3, "name": "PBF File Structure Deep Dive", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/" },
    { "@type": "ListItem", "position": 4, "name": "Writing a Valid OSM PBF File from Python", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/writing-a-valid-osm-pbf-file-from-python/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Write a conforming OSM PBF file",
  "description": "Declare only the features used, batch elements by estimated uncompressed size, build a per-block string table while encoding, terminate every node's tags, delta-encode within each group, and sort before batching.",
  "step": [
    { "@type": "HowToStep", "name": "Declare features honestly", "text": "List exactly the capabilities the file uses, since over-declaring makes strict readers refuse and under-declaring makes them misread." },
    { "@type": "HowToStep", "name": "Check uncompressed blob size", "text": "Validate the payload against the limit before compressing, because the limit applies to the uncompressed form." },
    { "@type": "HowToStep", "name": "Batch by estimated size", "text": "Accumulate an estimate per element rather than counting, since tag-heavy elements are an order of magnitude larger." },
    { "@type": "HowToStep", "name": "Build the table while encoding", "text": "Add strings to the block's table as elements are written so it contains exactly what the block uses." },
    { "@type": "HowToStep", "name": "Terminate every node", "text": "Append a zero after each node's tags, including nodes with none, or every reader desynchronises." },
    { "@type": "HowToStep", "name": "Delta-encode within the group", "text": "Store identifiers and coordinates as differences from the previous value, resetting the accumulators at each block." },
    { "@type": "HowToStep", "name": "Sort before batching", "text": "Order the whole element set by identifier before splitting into blocks, since per-batch sorting does not give file-level order." }
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
      "name": "Should I write OSM PBF by hand at all?",
      "acceptedAnswer": { "@type": "Answer", "text": "Usually not. An existing writer handles every requirement and has been tested against the readers you care about. Writing by hand is worth it when you need output a library does not produce or when the dependency is unacceptable. If you do, verify against at least two independent readers, because conformance mistakes are accepted by some tools and not others." }
    },
    {
      "@type": "Question",
      "name": "Why batch PBF blocks by size rather than element count?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because element size varies by more than an order of magnitude. A count-based batch tuned on untagged nodes produces oversized blobs on tag-heavy ones, and the limit applies to the uncompressed payload so compression does not rescue it. Estimating size per element is a few lines and removes the failure." }
    },
    {
      "@type": "Question",
      "name": "What happens if I declare a PBF feature I did not use?",
      "acceptedAnswer": { "@type": "Answer", "text": "Strict readers refuse the file, because the declaration says they must support something to read it correctly. Lenient readers accept it. The result is a file that works in whichever tool you tested with and fails elsewhere, which is harder to diagnose than an outright rejection." }
    },
    {
      "@type": "Question",
      "name": "Does PBF element ordering really matter?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes, for consumers that stream. A reader building way geometry in one pass depends on encountering all nodes before the ways referencing them, which only holds if the file is grouped by type and sorted by identifier. A file violating the order produces missing geometry in streaming tools, usually reported as a data gap." }
    }
  ]
}
</script>
