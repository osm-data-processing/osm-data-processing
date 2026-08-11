---
pageDescription: "Decode and validate the OSMHeader blob of an OSM PBF file in Python — 4-byte framing, zlib Blob decompression, required_features checks and bbox nanodegree conversion."
---
# How to decode OSM PBF headers in Python

Decode the leading `OSMHeader` blob of a `.osm.pbf` file in Python to validate `required_features` and read the bounding box before you stream a single data block — getting this pre-flight step right is what stops an incompatible or corrupt extract from silently poisoning everything downstream.

<svg viewBox="0 0 700 548" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Byte-level decode pipeline for the OSMHeader blob. The .osm.pbf byte stream begins with a 4-byte big-endian uint32 length prefix read by struct.unpack, guarded against the 64 KiB BlobHeader ceiling. That gives the BlobHeader, whose type must equal OSMHeader and whose datasize is guarded against the 32 MiB payload ceiling. Reading datasize bytes yields the Blob, which sets exactly one of zlib_data, raw or lzma_data. zlib.decompress turns it into the HeaderBlock carrying required_features, the nanodegree bbox, and osmosis replication provenance." style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Decoding the OSMHeader blob byte by byte</title>
  <desc>A vertical pipeline: the .osm.pbf byte stream is read as a 4-byte big-endian uint32 length prefix (raw framing, guarded at 64 KiB), then parsed into a BlobHeader whose type must equal OSMHeader and whose datasize is guarded at 32 MiB, then datasize bytes are read into a Blob with exactly one of zlib_data, raw or lzma_data set, then zlib.decompress produces the HeaderBlock holding required_features, the nanodegree bbox, and osmosis replication provenance fields.</desc>
  <defs>
    <marker id="hdrArrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="700" height="548" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <g text-anchor="middle" fill="currentColor">
    <!-- 0: byte stream -->
    <rect x="100" y="16" width="270" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="235" y="34" font-size="12.5">.osm.pbf byte stream</text>
    <text x="235" y="51" font-size="10" opacity="0.75">first block is always the header</text>
    <line x1="235" y1="60" x2="235" y2="82" stroke="currentColor" stroke-width="1.5" marker-end="url(#hdrArrow)"/>
    <!-- 1: length prefix -->
    <rect x="100" y="84" width="270" height="64" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="235" y="104" font-size="12.5">1 · Length prefix</text>
    <text x="235" y="122" font-size="10" opacity="0.78">4-byte big-endian uint32 — raw framing</text>
    <text x="235" y="138" font-size="10" opacity="0.78">struct.unpack(&quot;&gt;I&quot;, prefix)</text>
    <line x1="235" y1="148" x2="235" y2="170" stroke="currentColor" stroke-width="1.5" marker-end="url(#hdrArrow)"/>
    <!-- 2: BlobHeader -->
    <rect x="100" y="172" width="270" height="64" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="235" y="192" font-size="12.5">2 · BlobHeader</text>
    <text x="235" y="210" font-size="10" opacity="0.78">type == &quot;OSMHeader&quot;</text>
    <text x="235" y="226" font-size="10" opacity="0.78">datasize (payload length)</text>
    <line x1="235" y1="236" x2="235" y2="258" stroke="currentColor" stroke-width="1.5" marker-end="url(#hdrArrow)"/>
    <!-- 3: Blob -->
    <rect x="100" y="260" width="270" height="60" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <text x="235" y="280" font-size="12.5">3 · Blob (datasize bytes)</text>
    <text x="235" y="300" font-size="10" opacity="0.78">exactly one of: zlib_data | raw | lzma_data</text>
    <line x1="235" y1="320" x2="235" y2="342" stroke="currentColor" stroke-width="1.5" marker-end="url(#hdrArrow)"/>
    <!-- 4: decompress -->
    <rect x="100" y="344" width="270" height="44" rx="6" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
    <text x="235" y="363" font-size="12.5">4 · zlib.decompress(...)</text>
    <text x="235" y="380" font-size="10" opacity="0.75">branch on HasField, never assume</text>
    <line x1="235" y1="388" x2="235" y2="410" stroke="currentColor" stroke-width="1.5" marker-end="url(#hdrArrow)"/>
    <!-- 5: HeaderBlock -->
    <rect x="100" y="412" width="270" height="118" rx="6" fill="none" stroke="currentColor" stroke-width="2"/>
    <text x="235" y="432" font-size="12.5">5 · HeaderBlock</text>
    <text x="235" y="455" font-size="10" opacity="0.82">required_features → validate vs supported</text>
    <text x="235" y="477" font-size="10" opacity="0.82">bbox (nanodegrees × 1e-9 → degrees)</text>
    <text x="235" y="499" font-size="10" opacity="0.82">osmosis_replication_* provenance</text>
    <text x="235" y="520" font-size="9.5" opacity="0.6">the contract for the rest of the file</text>
  </g>
  <!-- ceiling guards (right column) -->
  <g text-anchor="middle" fill="currentColor">
    <line x1="370" y1="116" x2="408" y2="116" stroke="currentColor" stroke-width="1.1" stroke-dasharray="4 3"/>
    <rect x="408" y="92" width="278" height="48" rx="6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 3"/>
    <text x="547" y="112" font-size="10.5">guard before read: header_len &#8804; 64 KiB</text>
    <text x="547" y="129" font-size="9.5" opacity="0.7">else MemoryError</text>
    <line x1="370" y1="204" x2="408" y2="204" stroke="currentColor" stroke-width="1.1" stroke-dasharray="4 3"/>
    <rect x="408" y="180" width="278" height="48" rx="6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 3"/>
    <text x="547" y="200" font-size="10.5">guard before read: datasize &#8804; 32 MiB</text>
    <text x="547" y="217" font-size="9.5" opacity="0.7">else MemoryError</text>
  </g>
</svg>

## Prerequisites

- [ ] Python 3.10+ (the snippets below use `match`-free modern type hints)
- [ ] `protobuf>=4.21.0` installed in the runtime (`pip install "protobuf>=4.21.0"`)
- [ ] `protoc` compiler pinned to 3.21.12 or higher on your build machine
- [ ] The canonical `fileformat.proto` and `osmformat.proto` from the [OSM-binary repository](https://github.com/openstreetmap/OSM-binary/tree/master/osmpbf)
- [ ] Generated `fileformat_pb2.py` and `osmformat_pb2.py` vendored beside your pipeline code
- [ ] A sample extract (any regional `.osm.pbf` from [Geofabrik](https://download.geofabrik.de/) works)

## What the header actually is

A `.osm.pbf` file is a sequence of length-prefixed blocks, and the very first one is always a single `OSMHeader` blob. As the [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) sets out, every block is framed identically: a 4-byte big-endian `uint32` giving the `BlobHeader` length, the `BlobHeader` message itself, then the compressed `Blob` payload whose size lives in `BlobHeader.datasize`. The header's `Blob`, once decompressed, deserializes into a `HeaderBlock` — and that block is the contract for the rest of the file.

<figure class="diagram-wrap">
<svg viewBox="0 0 860 244" role="img" aria-labelledby="hdr-bytes-t hdr-bytes-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="hdr-bytes-t">Byte-level walk from the file start to a decoded HeaderBlock</title>
  <desc id="hdr-bytes-d">Four steps left to right. The first four bytes, big-endian, give the BlobHeader length, here thirteen, and are read with struct.unpack rather than protobuf. The next thirteen bytes are the BlobHeader protobuf carrying a type of OSMHeader and a datasize. The next datasize bytes are the Blob holding zlib data. Inflating it gives the HeaderBlock with bounding box, feature lists and replication fields, and the inflated length must equal the declared raw size. A panel warns that a short read from a socket or pipe must be looped over, or the next length prefix will be read from the middle of a blob.</desc>
  <rect x="0" y="0" width="860" height="244" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="430" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Reading the length prefix: the one field that is <tspan font-style="italic">not</tspan> protobuf</text>
  <rect x="34" y="56" width="126" height="46" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.4"/>
  <text x="97" y="76" text-anchor="middle" font-size="11" font-family="monospace" fill="currentColor">00 00 00 0D</text>
  <text x="97" y="94" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">4-byte big-endian</text>
  <text x="97" y="122" text-anchor="middle" font-size="10.5" font-weight="600" fill="currentColor">= 13</text>
  <text x="97" y="140" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">struct.unpack("&gt;I")</text>
  <rect x="184" y="56" width="230" height="46" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.4"/>
  <text x="299" y="76" text-anchor="middle" font-size="10.5" font-family="monospace" fill="currentColor">0A 09 4F 53 4D 48 65 61 64 65 72 …</text>
  <text x="299" y="94" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">13 bytes of BlobHeader protobuf</text>
  <text x="299" y="122" text-anchor="middle" font-size="10.5" font-weight="600" fill="currentColor">type = "OSMHeader", datasize = N</text>
  <text x="299" y="140" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">BlobHeader.FromString(buf)</text>
  <rect x="438" y="56" width="176" height="46" rx="5" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="526" y="76" text-anchor="middle" font-size="11" font-family="monospace" fill="currentColor">next N bytes</text>
  <text x="526" y="94" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">the Blob itself</text>
  <text x="526" y="122" text-anchor="middle" font-size="10.5" font-weight="600" fill="currentColor">zlib_data</text>
  <text x="526" y="140" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">zlib.decompress(...)</text>
  <rect x="638" y="56" width="196" height="46" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.4"/>
  <text x="736" y="76" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor">HeaderBlock</text>
  <text x="736" y="94" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">bbox · features · replication</text>
  <text x="736" y="122" text-anchor="middle" font-size="10.5" font-weight="600" fill="currentColor">raw_size must match</text>
  <text x="736" y="140" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">len(inflated) == raw_size</text>
  <rect x="34" y="164" width="800" height="62" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.4"/>
  <text x="434" y="188" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">The failure that looks like a corrupt file but is not</text>
  <text x="828" y="210" text-anchor="end" font-size="9" fill="currentColor" opacity="0.9">A socket or pipe read can return fewer bytes than you asked for. Loop until you have all four, then all thirteen, then all N — or the next length prefix is read from the middle of a blob.</text>
</svg>
<figcaption>The length prefix is deliberately not protobuf: it has to be readable before you know how much to read. Everything after it is, which is why a single short read desynchronises the whole stream.</figcaption>
</figure>

The fields you must read are `required_features` (capabilities your parser is obligated to implement, typically `OsmSchema-V0.6` and `DenseNodes`), the `bbox` bounding box stored in nanodegrees, and the `osmosis_replication_*` provenance fields. Because PBF stores coordinates as scaled integers rather than floats — a detail covered under [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — every `bbox` edge must be converted with $\text{degrees} = \text{nanodegrees} \times 10^{-9}$ before it means anything in WGS 84. That is the entire conceptual surface; the rest is binary framing and one decompression call.

## The complete solution

First compile the schema once on your build machine:

```bash
# protoc >= 3.21.12; run from a directory containing ./proto/*.proto
protoc --python_out=. --proto_path=./proto \
    ./proto/fileformat.proto ./proto/osmformat.proto
# -> generates fileformat_pb2.py and osmformat_pb2.py
```

Then the runnable decoder. Drop this beside the generated `*_pb2.py` modules and run it against any extract:

```python
"""Decode and validate the OSMHeader blob of an OSM PBF file.

Requires: protobuf>=4.21.0, Python 3.10+, and compiled
fileformat_pb2 / osmformat_pb2 modules on the import path.
"""
import struct
import zlib
import logging

import fileformat_pb2
import osmformat_pb2

logger = logging.getLogger(__name__)

# Hard ceilings straight from the PBF specification. Validate the declared
# sizes against these *before* allocating, so a truncated or hostile file
# cannot trigger an unbounded read.
MAX_BLOB_HEADER_SIZE = 64 * 1024          # 64 KiB
MAX_BLOB_PAYLOAD_SIZE = 32 * 1024 * 1024  # 32 MiB
NANODEGREE = 1e-9


def decode_pbf_header(filepath: str) -> osmformat_pb2.HeaderBlock:
    """Read, frame-check and decompress the leading OSMHeader blob."""
    with open(filepath, "rb") as f:
        # 1. The 4-byte big-endian length prefix is raw framing, NOT protobuf.
        prefix = f.read(4)
        if len(prefix) != 4:
            raise ValueError("File too short to contain a BlobHeader length prefix")
        header_len = struct.unpack(">I", prefix)[0]
        if header_len > MAX_BLOB_HEADER_SIZE:
            raise MemoryError(f"BlobHeader length {header_len} exceeds 64 KiB ceiling")

        # 2. Parse the BlobHeader and confirm it really is the OSMHeader.
        header_data = f.read(header_len)
        if len(header_data) != header_len:
            raise ValueError("Truncated BlobHeader")
        blob_header = fileformat_pb2.BlobHeader()
        blob_header.ParseFromString(header_data)
        if blob_header.type != "OSMHeader":
            raise ValueError(
                f"Expected BlobHeader type 'OSMHeader', got '{blob_header.type}'"
            )
        if blob_header.datasize > MAX_BLOB_PAYLOAD_SIZE:
            raise MemoryError(
                f"Blob datasize {blob_header.datasize} exceeds 32 MiB ceiling"
            )

        # 3. Read exactly datasize bytes for the Blob payload.
        blob_data = f.read(blob_header.datasize)
        if len(blob_data) != blob_header.datasize:
            raise ValueError("Truncated Blob payload")

        header_block = _decompress_header_blob(blob_data)
        logger.info(
            "Decoded OSMHeader: features=%s, writingprogram=%r",
            list(header_block.required_features),
            header_block.writingprogram,
        )
        return header_block


def _decompress_header_blob(raw_blob: bytes) -> osmformat_pb2.HeaderBlock:
    """Select the active compression field and deserialize the HeaderBlock."""
    blob = fileformat_pb2.Blob()
    blob.ParseFromString(raw_blob)

    # Exactly one payload field is set. zlib_data dominates in practice.
    if blob.HasField("zlib_data"):
        decompressed = zlib.decompress(blob.zlib_data)
    elif blob.HasField("raw"):
        decompressed = blob.raw
    elif blob.HasField("lzma_data"):
        import lzma
        decompressed = lzma.decompress(blob.lzma_data)
    else:
        raise ValueError("Blob has no recognized compression or raw payload")

    header_block = osmformat_pb2.HeaderBlock()
    header_block.ParseFromString(decompressed)
    return header_block


def extract_bounding_box(header_block: osmformat_pb2.HeaderBlock) -> dict[str, float]:
    """Return the bbox in decimal degrees (EPSG:4326) from the HeaderBlock."""
    bbox = header_block.bbox
    return {
        "left":   bbox.left   * NANODEGREE,
        "right":  bbox.right  * NANODEGREE,
        "top":    bbox.top    * NANODEGREE,
        "bottom": bbox.bottom * NANODEGREE,
    }


def validate_header(header_block: osmformat_pb2.HeaderBlock,
                    supported: set[str]) -> None:
    """Reject the file if it requires a feature this parser cannot honour."""
    missing = set(header_block.required_features) - supported
    if missing:
        raise ValueError(f"Unsupported required_features: {sorted(missing)}")


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    SUPPORTED = {"OsmSchema-V0.6", "DenseNodes"}
    hb = decode_pbf_header(sys.argv[1])
    validate_header(hb, SUPPORTED)
    print("required_features:", list(hb.required_features))
    print("optional_features:", list(hb.optional_features))
    print("bbox (deg):", extract_bounding_box(hb))
    print("replication_seq:", hb.osmosis_replication_sequence_number)
    print("replication_ts: ", hb.osmosis_replication_timestamp)
```

## Step-by-step walkthrough

1. **Read the length prefix** (`struct.unpack(">I", prefix)`). The first four bytes are network byte order and stand outside any protobuf message — `>I` is a big-endian unsigned 32-bit integer. The `header_len > MAX_BLOB_HEADER_SIZE` guard runs *before* the next read so a bogus length never drives an oversized allocation.
2. **Parse and identify the `BlobHeader`.** After `ParseFromString`, the `type` field must equal `OSMHeader`; anything else means you are not at the start of the file or the pointer is misaligned. `datasize` is checked against the 32 MiB ceiling here, again before reading.
3. **Read the `Blob` payload** of exactly `datasize` bytes. A short read means truncation — treat it as fatal, not recoverable.
4. **Decompress by field, not by guess.** `_decompress_header_blob` inspects which payload field is set with `HasField`. The fields are mutually exclusive; `zlib_data` covers the overwhelming majority of real extracts, with `raw` and `lzma_data` as fallbacks. The decompressed bytes deserialize straight into a `HeaderBlock`.
5. **Convert the bounding box.** `extract_bounding_box` multiplies each nanodegree edge by $10^{-9}$. Skipping this step produces a systematic $10^{9}\times$ offset, so coordinates land nowhere near the source region.
6. **Gate on `required_features`.** `validate_header` subtracts your supported set from the file's `required_features`; a non-empty remainder is a hard stop, because honouring an unimplemented feature like `DenseNodes` is the difference between correct geometry and silently misread nodes — the same primitive graph described in the [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/).

<figure class="diagram-wrap">
<svg viewBox="0 0 880 278" role="img" aria-labelledby="reqfeat-t reqfeat-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="reqfeat-t">How a reader should respond to each declared PBF feature string</title>
  <desc id="reqfeat-d">A grid mapping four feature strings against the required and optional lists. OsmSchema-V0.6 and DenseNodes are understood and safe to parse in either list. HistoricalInformation in the required list means the file holds multiple versions per object and a snapshot reader must abort; in the optional list it can be parsed with a warning. An unknown future string must abort when required and only be logged when optional.</desc>
  <rect x="0" y="0" width="880" height="278" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">required_features aborts, optional_features only warns</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">in required_features</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">in optional_features</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">OsmSchema-V0.6</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">parse — understood</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">parse — understood</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">DenseNodes</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">parse — understood</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">parse — understood</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">HistoricalInformation</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">abort: not a snapshot</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">parse, warn on dupes</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">unknown future string</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">abort: meaning unknown</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">parse, log the string</text>
  <text x="868" y="260" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A snapshot pipeline that ignores a required HistoricalInformation flag will silently emit every historical version of every object as if it were current.</text>
</svg>
<figcaption>The asymmetry is the whole point of two lists. <code>required_features</code> is the file telling you that ignoring it changes the meaning of the data; <code>optional_features</code> is telling you it does not.</figcaption>
</figure>

## Verification

Run the script against a known-good extract and confirm the output:

- The log line reads `Decoded OSMHeader: features=['OsmSchema-V0.6', 'DenseNodes'], ...` — the two features present on virtually every modern file.
- `bbox (deg)` values fall inside valid WGS 84 ranges: longitude in `[-180, 180]`, latitude in `[-90, 90]`. For a Berlin extract, expect `left`/`bottom` near `13.0` / `52.3`.
- `replication_seq` is a non-zero integer for files cut from the replication stream (regional Geofabrik extracts include it).

Cross-check against the reference tool: `osmium fileinfo -e your-extract.osm.pbf` reports the same bounding box and header options. If your decoded `bbox` and `osmium`'s disagree, the nanodegree conversion is the first suspect.

## Common errors and fixes

| Error / symptom | Root cause | One-line fix |
|---|---|---|
| `struct.error: unpack requires a buffer of 4 bytes` | File opened in text mode or empty | Open with `"rb"` and check `len(prefix) == 4` |
| `Expected BlobHeader type 'OSMHeader'` | Reading mid-file or wrong offset | Seek to byte 0; decode only the first block as the header |
| `zlib.error: incorrect header check` | Decompressing the wrong field (e.g. `raw` as zlib) | Branch on `Blob.HasField(...)`, never assume zlib |
| Coordinates off by ~$10^{9}$ | Forgot the nanodegree scale | Multiply every `bbox` edge by `1e-9` |
| `MemoryError: ... exceeds 64 KiB / 32 MiB` | Corrupt length, or a non-PBF file | Validate the magic by checking `type == "OSMHeader"` first |
| `DecodeError: Error parsing message` | Stale or mismatched `*_pb2.py` | Recompile with `protoc >= 3.21.12` against the current `.proto` |

## Spec reference

> The 4-byte big-endian length prefix, the `BlobHeader` / `Blob` framing, the mutually exclusive compression fields, and the 64 KiB / 32 MiB ceilings are all defined in the OpenStreetMap [PBF Format specification](https://wiki.openstreetmap.org/wiki/PBF_Format). The `required_features`, `bbox`, and `osmosis_replication_*` fields are declared in `osmformat.proto`'s `HeaderBlock` message. Varint and length-prefix mechanics follow the [Protocol Buffers encoding guide](https://protobuf.dev/programming-guides/encoding/), and the `struct` format codes are in the [Python struct documentation](https://docs.python.org/3/library/struct.html).

## Related

- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — the full block-by-block wire format this header sits at the front of.
- [Extracting metadata from OSM planet files](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/extracting-metadata-from-osm-planet-files/) — reading provenance fields once the header validates.
- [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/) — why the binary header exists at all.
- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — the nanodegree-to-WGS 84 scaling applied to the bbox.
- [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) — using the header bbox to size an index before streaming data.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — turning the validation failures above into quarantine and remediation.

This how-to belongs to the [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) guide — head back there for the rest of the wire format, or up to [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/) for the broader data model.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "How to decode OSM PBF headers in Python",
  "description": "Decode and validate the OSMHeader blob of an OSM PBF file in Python: 4-byte framing, zlib Blob decompression, required_features checks and bbox nanodegree conversion.",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["OpenStreetMap", "PBF format", "Protocol Buffers", "Python ETL"],
  "isPartOf": {
    "@type": "TechArticle",
    "name": "PBF File Structure Deep Dive",
    "url": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/"
  }
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
    { "@type": "ListItem", "position": 4, "name": "How to decode OSM PBF headers in Python", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/" }
  ]
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Decode an OSM PBF header in Python",
  "description": "Read, frame-check, decompress and validate the leading OSMHeader blob of an OpenStreetMap PBF file before streaming data blocks.",
  "step": [
    { "@type": "HowToStep", "name": "Compile the proto definitions", "text": "Run protoc (3.21.12+) on fileformat.proto and osmformat.proto to generate fileformat_pb2.py and osmformat_pb2.py." },
    { "@type": "HowToStep", "name": "Read the length prefix", "text": "Read 4 bytes and decode them with struct.unpack('>I'); reject any value above the 64 KiB BlobHeader ceiling." },
    { "@type": "HowToStep", "name": "Parse and identify the BlobHeader", "text": "Deserialize the BlobHeader and confirm its type is OSMHeader and datasize is within the 32 MiB ceiling." },
    { "@type": "HowToStep", "name": "Decompress the Blob", "text": "Read datasize bytes into a Blob, branch on the active field (usually zlib_data) and decompress into a HeaderBlock." },
    { "@type": "HowToStep", "name": "Validate and convert", "text": "Confirm every required_features value is supported and multiply each bbox edge by 1e-9 to get decimal degrees." }
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
      "name": "Why must I read the OSMHeader before any data block?",
      "acceptedAnswer": { "@type": "Answer", "text": "The HeaderBlock carries required_features, the bounding box, and replication metadata. It is the validation gate: a reader confirms it implements every required feature before touching a primitive. A malformed or out-of-spec header is a hard stop, because the rest of the file cannot be trusted." }
    },
    {
      "@type": "Question",
      "name": "Why are my bounding-box coordinates off by a factor of a billion?",
      "acceptedAnswer": { "@type": "Answer", "text": "The bbox fields are stored in nanodegrees (integer units of 1e-9 degrees). You must multiply each edge by 1e-9 to get decimal degrees in WGS 84. Skipping the conversion produces a systematic 1e9 offset, so the coordinates land nowhere near the source region." }
    },
    {
      "@type": "Question",
      "name": "Is the 4-byte length prefix part of the protobuf message?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. The leading 4 bytes are raw big-endian framing read with struct.unpack('>I') and are not encoded as protobuf. Everything after them — the BlobHeader and Blob — is standard protobuf decoded through the compiled bindings." }
    },
    {
      "@type": "Question",
      "name": "Which compression field should I decompress for the header Blob?",
      "acceptedAnswer": { "@type": "Answer", "text": "Branch on Blob.HasField rather than assuming. zlib_data covers the overwhelming majority of files, with raw as the uncompressed fallback and lzma_data defined but rare. Decompressing the wrong field raises a zlib header-check error." }
    }
  ]
}
</script>
