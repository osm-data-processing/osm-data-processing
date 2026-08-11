---
title: "Reading DenseNodes and Delta-Encoded Coordinates"
description: "Decode the DenseNodes encoding that holds almost every node in a PBF: three delta accumulators that reset per block, and the keys_vals array that is not delta-encoded at all."
pageTitle: "Read DenseNodes and Delta-Encoded OSM Coordinates"
pageDescription: "A dependency-light DenseNodes decoder — per-block accumulator resets, the zero-terminated keys_vals cursor, granularity from the block header, and counts cross-checked against osmium."
slug: "reading-dense-nodes-and-delta-encoded-coordinates"
type: "article"
breadcrumb: "Reading DenseNodes"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Reading DenseNodes and Delta-Encoded Coordinates

Decode the encoding that holds ninety-nine percent of the nodes in any real PBF, including the tag array that looks like a delta and is not.

## Prerequisites

- [ ] Python 3.10+ with `protobuf` and the compiled `osmformat_pb2`
- [ ] The block-framing machinery from [How to Decode OSM PBF Headers in Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/)
- [ ] A small PBF to test against — a city extract is ideal
- [ ] `osmium` available, for cross-checking counts

## Conceptual minimum

A `PrimitiveGroup` can hold nodes in two forms: repeated `Node` messages, or one `DenseNodes` message holding parallel arrays. Real files use the second almost exclusively.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 318" role="img" aria-labelledby="dn-vs-node-t dn-vs-node-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dn-vs-node-t">DenseNodes compared with individual Node messages</title>
  <desc id="dn-vs-node-d">A grid comparing the two encodings. DenseNodes costs roughly seven to nine bytes per node against 28 to 40 for individual Node messages. DenseNodes stores tags in a flat zero-terminated keys_vals array while Node uses repeated key and value pairs. DenseNodes uses parallel delta-coded arrays; Node uses one message per node. DenseNodes has no random access within a block because decoding must start from the block start. Producers almost always emit DenseNodes for nodes, and Node messages rarely, mostly for ways and relations.</desc>
  <rect x="0" y="0" width="880" height="318" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">DenseNodes against plain Node messages</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">DenseNodes</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Node</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">bytes per node</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">~7–9 B</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">~28–40 B</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">tags</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">flat keys_vals, 0-terminated</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">repeated key/val pairs</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">field layout</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">parallel arrays, delta-coded</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">one message per node</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">random access within a block</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">no — must decode from the block start</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">yes</text>
  <text x="198" y="264" text-anchor="end" font-size="11.5" fill="currentColor">when producers emit it</text>
  <rect x="213" y="244" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">almost always, for nodes</text>
  <rect x="535" y="244" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="693" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">rarely; ways and relations only</text>
  <text x="440" y="300" text-anchor="middle" font-size="9.0" fill="currentColor" opacity="0.85">A four-to-one size advantage is why every real planet file uses DenseNodes, and why a reader that only handles plain Node messages appears to find no nodes at all.</text>
</svg>
<figcaption>A reader that handles only plain Node messages parses a planet file successfully and reports zero nodes, because there are none of that kind in it.</figcaption>
</figure>

`DenseNodes` stores each field as its own array, delta-encoded so that successive values are small and pack into one-byte varints. Four arrays, four independent accumulators.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="dn-accumulators-t dn-accumulators-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dn-accumulators-t">The four parallel arrays in a DenseNodes message</title>
  <desc id="dn-accumulators-d">A four-stage chain. The id array is a first absolute value followed by deltas. Latitude and longitude are independent accumulators with granularity applied after summing. Timestamps use their own date granularity in milliseconds and appear only when metadata is present. The keys_vals array is not a delta at all: it is a flat list of string-table indices in which a zero terminates each node.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="dn" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four accumulators, reset at every block boundary</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">id</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">first absolute, then deltas</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">+4, +1, +7 …</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dn)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">lat / lon</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">independent accumulators</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">granularity applied after</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dn)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">timestamp</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">date_granularity, ms</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">only with metadata</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dn)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">keys_vals</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">NOT a delta — a flat list</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">0 terminates each node</text>
  <text x="440" y="158" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Three of the four are running sums. The fourth looks like one and is not, which is where hand-rolled DenseNodes readers go wrong.</text>
</svg>
<figcaption>Every accumulator resets at the PrimitiveBlock boundary, and each is independent — carrying one across a block yields plausible, wrong values.</figcaption>
</figure>

The `keys_vals` array is the trap. It sits alongside the delta-coded arrays, it is an array of integers, and it is not delta-coded at all: it is a flat sequence of string-table indices, alternating key and value, with a zero terminating each node's run. Nodes with no tags contribute a single zero. Treating it as a running sum produces string-table indices that are in range, resolve to real strings, and are wrong.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="dn-bytes-t dn-bytes-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dn-bytes-t">Average bytes per field in a DenseNodes-encoded node</title>
  <desc id="dn-bytes-d">A bar chart of average bytes per node in a European extract. The identifier delta costs 1.2 bytes, almost always a single varint. The latitude delta costs 2.4 bytes and the longitude delta 2.4 bytes. Tags in the keys_vals array cost 1.1 bytes on average because 92 percent of nodes carry no tags. The same node encoded as an individual Node message costs 34 bytes, four times the total.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Where the bytes go in a node</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">average per node in a European extract, DenseNodes</text>
  <line x1="250" y1="68" x2="250" y2="270" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">id delta</text>
  <rect x="250" y="74" width="17" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="277" y="89" font-size="11" fill="currentColor" opacity="0.9">1.2 B · almost always one varint</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">lat delta</text>
  <rect x="250" y="116" width="33" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="293" y="131" font-size="11" fill="currentColor" opacity="0.9">2.4 B</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">lon delta</text>
  <rect x="250" y="158" width="33" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="293" y="173" font-size="11" fill="currentColor" opacity="0.9">2.4 B</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">tags (keys_vals)</text>
  <rect x="250" y="200" width="15" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="275" y="215" font-size="11" fill="currentColor" opacity="0.9">1.1 B · 92% of nodes are untagged</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">(same node as a Node message)</text>
  <rect x="250" y="242" width="470" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="868" y="257" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">34 B · four times the total above</text>
  <text x="440" y="306" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">Sorting by id is what makes the id delta one byte. An unsorted file produces multi-byte deltas and loses most of the encoding advantage.</text>
</svg>
<figcaption>The encoding assumes sorted, spatially coherent input. Shuffle the nodes and the deltas grow, which is one reason PBF writers sort before they write.</figcaption>
</figure>

## Runnable solution

```python
#!/usr/bin/env python3
"""Decode DenseNodes from a PBF PrimitiveBlock, correctly and without a library."""
from __future__ import annotations

import logging
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import osmformat_pb2      # protoc --python_out=. osmformat.proto
import fileformat_pb2

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DecodedNode:
    id: int
    lat: float
    lon: float
    tags: dict[str, str]


def blocks(path: Path) -> Iterator[osmformat_pb2.PrimitiveBlock]:
    """Yield each decompressed OSMData PrimitiveBlock in the file."""
    with path.open("rb") as handle:
        while True:
            raw_len = handle.read(4)
            if len(raw_len) < 4:
                return
            header_len = struct.unpack(">I", raw_len)[0]
            header = fileformat_pb2.BlobHeader()
            header.ParseFromString(_read_exactly(handle, header_len))
            payload = _read_exactly(handle, header.datasize)
            if header.type != "OSMData":
                continue
            blob = fileformat_pb2.Blob()
            blob.ParseFromString(payload)
            data = blob.raw if blob.HasField("raw") else zlib.decompress(blob.zlib_data)
            if len(data) != blob.raw_size and blob.raw_size:
                raise ValueError(f"inflated {len(data)} bytes, header claims {blob.raw_size}")
            block = osmformat_pb2.PrimitiveBlock()
            block.ParseFromString(data)
            yield block


def _read_exactly(handle, count: int) -> bytes:
    """A pipe or socket may return fewer bytes than asked for. Loop."""
    chunks: list[bytes] = []
    remaining = count
    while remaining:
        chunk = handle.read(remaining)
        if not chunk:
            raise EOFError(f"wanted {count} bytes, short by {remaining}")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def decode_dense(block: osmformat_pb2.PrimitiveBlock) -> Iterator[DecodedNode]:
    """Decode every DenseNodes group in one block.

    Accumulators are local to this function because they reset at the block
    boundary — carrying one across blocks is the classic corruption.
    """
    strings = [s.decode("utf-8") for s in block.stringtable.s]
    granularity = block.granularity or 100
    lat_offset = block.lat_offset
    lon_offset = block.lon_offset

    for group in block.primitivegroup:
        if not group.HasField("dense"):
            continue
        dense = group.dense

        node_id = lat = lon = 0        # the three running sums
        kv_index = 0                   # a cursor into keys_vals — NOT a running sum

        for i in range(len(dense.id)):
            node_id += dense.id[i]
            lat += dense.lat[i]
            lon += dense.lon[i]

            tags: dict[str, str] = {}
            if dense.keys_vals:
                # Walk key/value index pairs until the 0 that terminates this node.
                while kv_index < len(dense.keys_vals) and dense.keys_vals[kv_index] != 0:
                    key = strings[dense.keys_vals[kv_index]]
                    value = strings[dense.keys_vals[kv_index + 1]]
                    tags[key] = value
                    kv_index += 2
                kv_index += 1          # step over the terminating 0

            yield DecodedNode(
                id=node_id,
                lat=(lat_offset + granularity * lat) * 1e-9,
                lon=(lon_offset + granularity * lon) * 1e-9,
                tags=tags,
            )


def count_nodes(path: Path) -> tuple[int, int]:
    total = tagged = 0
    for block in blocks(path):
        for node in decode_dense(block):
            total += 1
            if node.tags:
                tagged += 1
    logger.info("%s: %d node(s), %d tagged (%.1f%%)",
                path, total, tagged, 100 * tagged / max(total, 1))
    return total, tagged
```

## Step-by-step walkthrough

The three accumulators are initialised **inside** the group loop, not outside it, and not at module scope. Every `PrimitiveBlock` restarts its deltas from zero, and a reader that hoists the accumulators out of the loop decodes the first block correctly and then produces identifiers and coordinates that drift further from the truth with every subsequent block — the failure the parent topic, [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/), warns about.

`kv_index` is deliberately named as a cursor rather than an accumulator, because that is what it is. It advances monotonically through `keys_vals` across all nodes in the group, consuming each node's run of key/value index pairs and then the terminating zero. Nodes with no tags consume exactly one element.

The coordinate formula applies the block's own `granularity` and offsets. Hardcoding 100 works on almost every file and fails silently on the ones that declare something else, producing coordinates off by a factor of ten with no error anywhere.

`_read_exactly` exists because `read(n)` is permitted to return fewer than `n` bytes. From a regular file it usually does not; from a pipe or a socket it routinely does, and one short read desynchronises the block stream permanently.

The `raw_size` check is cheap insurance. A mismatch between the inflated length and the declared length means the blob is truncated or corrupt, and catching it here is far better than catching it as a protobuf parse error several fields later.

## Verification

Cross-check the count against a reference implementation, which catches almost every decoding bug at once:

```bash
python3 -c "from decode import count_nodes; from pathlib import Path; count_nodes(Path('city.osm.pbf'))"
osmium fileinfo --extended city.osm.pbf | grep -A1 'Number of nodes'
```

The two node counts must match exactly. A count that is close but not equal usually means the `keys_vals` cursor is drifting and some nodes are being skipped or double-counted.

Then check a specific node against the live map:

```python
for node in decode_dense(next(blocks(Path("city.osm.pbf")))):
    if node.tags.get("amenity"):
        print(node.id, node.lat, node.lon, node.tags)
        break
# Compare against https://www.openstreetmap.org/node/<id>
```

Coordinates should agree to seven decimal places. Agreement to two or three decimal places with divergence after that means the granularity was assumed rather than read.

Finally, assert the tag decoding independently, since a drifting cursor produces valid-looking tags:

```python
total, tagged = count_nodes(Path("city.osm.pbf"))
assert 0.02 < tagged / total < 0.25, "tagged fraction implausible — check the kv cursor"
```

Real extracts run around five to eight percent tagged nodes. A figure near zero or near one hundred percent means the cursor is out of step.

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| First block fine, later blocks wrong | Accumulators hoisted out of the block loop | Reset id, lat and lon per block |
| Tags belong to the wrong nodes | `keys_vals` treated as delta-coded | It is a flat, zero-terminated list |
| Coordinates off by a factor of ten | Granularity hardcoded to 100 | Read `block.granularity` |
| Zero nodes found | Only `Node` messages handled | Handle `group.dense` |
| `IndexError` on the string table | Cursor advanced past the terminator | Step over the 0 exactly once per node |
| Truncated read partway through | `read(n)` returned short | Loop until `n` bytes are in hand |
| Coordinates near 0,0 | `lat_offset`/`lon_offset` ignored | Apply both from the block |

## Frequently Asked Questions

<details>
<summary>Should I decode DenseNodes by hand at all?</summary>

Usually not — pyosmium and osmium-tool do it correctly and faster than Python can. Hand decoding earns its place in three situations: when you need a dependency-free reader, when you are writing a producer and need to verify what it emits, and when you are debugging a file another tool rejects. Understanding the encoding is worth it regardless, because the failure modes above appear as data bugs rather than as errors.
</details>

<details>
<summary>Why are the coordinate deltas two bytes when the id delta is one?</summary>

Because ids are nearly consecutive in a sorted file while coordinates are not. A delta of 4 fits a single varint; a coordinate delta of a few thousand nanodegree units needs two. This is also why sorting matters so much to PBF size — the encoding's whole advantage comes from successive values being close together.
</details>

<details>
<summary>What happens with the optional metadata arrays?</summary>

`DenseInfo` carries version, timestamp, changeset, uid and user_sid as further parallel arrays, and timestamp, changeset and uid are themselves delta-coded with their own accumulators — three more resets per block. The timestamp uses `date_granularity`, which is separate from the coordinate granularity and defaults to 1000 milliseconds. Files written without metadata omit the whole message, which is what [Converting OSM XML to PBF with osmium](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/converting-osm-xml-to-pbf-with-osmium/) covers.
</details>

<details>
<summary>Can I seek to a specific node?</summary>

Not within a block — the deltas mean node *n* can only be reconstructed by decoding nodes 0 through *n*. You can seek to a block boundary, because blobs are independently framed and independently deflated, which is what makes parallel parsing possible. Random access to a single node needs an external index mapping ids to block offsets.
</details>

## Specification reference

> `DenseNodes` holds parallel repeated fields: `id`, `lat` and `lon` are delta-encoded sint64 arrays, each with its own accumulator reset at the start of every `PrimitiveBlock`. `keys_vals` is a flat repeated int32 of string-table indices, alternating key and value, with `0` terminating each node's tags; it is not delta-encoded. Coordinates are recovered as `(offset + granularity * value) * 1e-9` degrees.

## Related

- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — the topic this decoding belongs to.
- [How to Decode OSM PBF Headers in Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/) — the framing this builds on.
- [Extracting Metadata from OSM Planet Files](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/extracting-metadata-from-osm-planet-files/) — the header fields that come free.
- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — what the decoded degrees mean.
- [Speed Up OSM Parsing with Multiprocessing in Python](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/speed-up-osm-parsing-with-multiprocessing-in-python/) — exploiting block independence.

Up one level: [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/).
