---
pageDescription: "Byte-level guide to the OSM PBF wire format: BlobHeader/Blob framing, HeaderBlock validation, StringTable and delta-encoded PrimitiveGroups, plus runnable Python readers and an error matrix for production ETL."
---
# PBF File Structure Deep Dive

OpenStreetMap distributes its primary geospatial datasets in Protocolbuffer Binary Format (PBF), a compressed, schema-driven container engineered for high-throughput spatial ETL. The pipeline challenge this guide solves is precise and unforgiving: a single misread length prefix or a missed delta-accumulator reset does not raise an exception — it silently shifts every coordinate that follows, so a continent of nodes lands in the wrong hemisphere and the corruption surfaces only after the data reaches a map. For mapping engineers, GIS analysts, and Python developers building production ingestion, the only defence is to read the format exactly as the specification defines it, block by block, with validation gates between every stage. This reference dissects the PBF wire format at the byte level, establishes memory-bounded parsing patterns, and defines the error-handling checkpoints that make extract processing reproducible. It sits within the broader [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/) layer, which frames why this binary encoding underpins every fast OSM workflow.

<svg viewBox="0 0 700 210" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Byte-stream layout of an OSM PBF file as a left-to-right sequence of length-prefixed blocks: the file opens with a single OSMHeader frame (a 4-byte big-endian length prefix, a BlobHeader, then a Blob carrying the HeaderBlock) and continues with repeating OSMData frames, each prefix plus BlobHeader plus Blob carrying one PrimitiveBlock, where the BlobHeader is capped at 64 KiB and the decompressed Blob payload at 32 MiB" style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>OSM PBF File: Length-Prefixed Block Stream</title>
  <desc>A .osm.pbf file is a continuous concatenation of frames read left to right. The first frame is exactly one OSMHeader: a 4-byte big-endian uint32 length prefix, then a BlobHeader with type=OSMHeader, then a Blob carrying the HeaderBlock. Every following frame is an OSMData frame with the same three parts, each Blob carrying one PrimitiveBlock, repeating to end of file. The BlobHeader must not exceed 64 KiB and the decompressed Blob payload must not exceed 32 MiB; both are validated before any buffer is allocated.</desc>
  <defs>
    <marker id="pbfArr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="700" height="210" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <!-- file start label -->
  <text x="60" y="58" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">file start</text>
  <text x="60" y="100" text-anchor="middle" font-size="14" fill="currentColor" opacity="0.55">&#9656;</text>
  <!-- annotations over the repeating data frame -->
  <text x="370" y="44" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">uint32, big-endian</text>
  <line x1="370" y1="50" x2="370" y2="68" stroke="currentColor" stroke-width="1" stroke-dasharray="2 2" opacity="0.6"/>
  <text x="449" y="44" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">&#8804; 64 KiB</text>
  <line x1="449" y1="50" x2="449" y2="68" stroke="currentColor" stroke-width="1" stroke-dasharray="2 2" opacity="0.6"/>
  <text x="574" y="44" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">raw_size &#8804; 32 MiB</text>
  <line x1="574" y1="50" x2="574" y2="68" stroke="currentColor" stroke-width="1" stroke-dasharray="2 2" opacity="0.6"/>
  <!-- Frame 0: OSMHeader -->
  <rect x="84" y="70" width="40" height="56" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
  <text x="104" y="95" text-anchor="middle" font-size="11" fill="currentColor">len</text>
  <text x="104" y="110" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">4 B</text>
  <rect x="124" y="70" width="118" height="56" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="183" y="94" text-anchor="middle" font-size="12" fill="currentColor">BlobHeader</text>
  <text x="183" y="111" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">type=OSMHeader</text>
  <rect x="242" y="70" width="132" height="56" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="308" y="94" text-anchor="middle" font-size="12" fill="currentColor">Blob</text>
  <text x="308" y="111" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">(HeaderBlock)</text>
  <!-- Frame 1: OSMData -->
  <rect x="374" y="70" width="40" height="56" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
  <text x="394" y="95" text-anchor="middle" font-size="11" fill="currentColor">len</text>
  <text x="394" y="110" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">4 B</text>
  <rect x="414" y="70" width="118" height="56" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="473" y="94" text-anchor="middle" font-size="12" fill="currentColor">BlobHeader</text>
  <text x="473" y="111" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">type=OSMData</text>
  <rect x="532" y="70" width="132" height="56" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="598" y="94" text-anchor="middle" font-size="12" fill="currentColor">Blob</text>
  <text x="598" y="111" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">(PrimitiveBlock 1)</text>
  <!-- continuation -->
  <line x1="664" y1="98" x2="682" y2="98" stroke="currentColor" stroke-width="1.5" marker-end="url(#pbfArr)" opacity="0.7"/>
  <text x="678" y="118" text-anchor="end" font-size="13" fill="currentColor" opacity="0.7">&#8943;</text>
  <!-- grouping brackets -->
  <path d="M84,138 L84,144 L374,144 L374,138" fill="none" stroke="currentColor" stroke-width="1" opacity="0.6"/>
  <text x="229" y="160" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">first frame: exactly one OSMHeader</text>
  <path d="M374,138 L374,144 L664,144 L664,138" fill="none" stroke="currentColor" stroke-width="1" opacity="0.6"/>
  <text x="519" y="160" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">repeating OSMData frames &#8594;</text>
  <!-- summary note -->
  <text x="350" y="190" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.7">Each frame: length prefix &#8594; BlobHeader &#8594; Blob &#183; sizes validated before allocation</text>
</svg>

A `.osm.pbf` file is a sequential concatenation of length-prefixed blocks. Each block begins with a 4-byte big-endian integer declaring the `BlobHeader` payload length, followed by the serialized `BlobHeader` message, then the `Blob` payload whose compressed size is declared in `BlobHeader.datasize`. The file strictly leads with a single `OSMHeader` blob and is followed by a series of `OSMData` blobs, each carrying one `PrimitiveBlock`. This deterministic framing is what enables memory-mapped I/O, block-at-a-time streaming, and parallel chunk decomposition.

## Prerequisites: Concepts to Anchor First

This guide assumes three foundations. First, the [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — every primitive decoded from a `PrimitiveBlock` is one of those three element types, and reference closure between them governs whether geometry can be reconstructed. Second, the format trade-offs covered in the [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/), which quantify the I/O and memory savings that justify reading binary at all. Third, the WGS 84 storage model detailed under [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/), because PBF stores latitude and longitude as scaled integers, not floats. Readers comfortable with those three can treat the rest of this page as a wire-format reference.

## The Wire Format: Length-Prefixed Blocks

The two framing messages are defined in `fileformat.proto`. `BlobHeader` carries three fields: `type` (a string, either `OSMHeader` or `OSMData`), an optional `indexdata` byte string, and `datasize` (the compressed length of the `Blob` that follows). The `Blob` message then holds the payload in exactly one of several mutually exclusive fields:

<figure class="diagram-wrap">
<svg viewBox="0 0 880 252" role="img" aria-labelledby="blob-frame-t blob-frame-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="blob-frame-t">The four-step framing that precedes every PBF primitive block</title>
  <desc id="blob-frame-d">A left-to-right chain: a four-byte big-endian length prefix gives the size of the BlobHeader; the BlobHeader carries a type of either OSMHeader or OSMData plus a datasize; the Blob that follows is exactly datasize bytes and holds zlib data with a raw size; inflating it yields a PrimitiveBlock with a string table, primitive groups and a granularity, conventionally capped at eight thousand elements. A panel below explains that because each blob is independently deflated and self-describing, a reader can seek to any block boundary without decoding earlier blocks, which is what makes parallel parsing possible.</desc>
  <rect x="0" y="0" width="880" height="252" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="blb" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Every block is four reads: length, BlobHeader, Blob, inflate</text>
  <rect x="24" y="52" width="96" height="54" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="72" y="74" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor">4 bytes</text>
  <text x="72" y="92" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">big-endian</text>
  <text x="72" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">len(BlobHeader)</text>
  <line x1="120" y1="79" x2="152" y2="79" stroke="currentColor" stroke-width="1.5" marker-end="url(#blb)"/>
  <rect x="154" y="52" width="176" height="54" rx="6" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="242" y="74" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor">BlobHeader</text>
  <text x="242" y="92" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">type · datasize</text>
  <text x="242" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">"OSMHeader" or "OSMData"</text>
  <line x1="330" y1="79" x2="362" y2="79" stroke="currentColor" stroke-width="1.5" marker-end="url(#blb)"/>
  <rect x="364" y="52" width="176" height="54" rx="6" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="452" y="74" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor">Blob</text>
  <text x="452" y="92" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">zlib_data · raw_size</text>
  <text x="452" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">datasize bytes exactly</text>
  <line x1="540" y1="79" x2="572" y2="79" stroke="currentColor" stroke-width="1.5" marker-end="url(#blb)"/>
  <rect x="574" y="52" width="282" height="54" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="715" y="74" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor">inflate → PrimitiveBlock</text>
  <text x="715" y="92" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">stringtable · primitivegroup[] · granularity</text>
  <text x="715" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">≤ 8 000 elements by convention</text>
  <rect x="24" y="150" width="832" height="82" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.4"/>
  <text x="440" y="174" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">Why the framing matters more than the payload</text>
  <text x="440" y="196" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.9">Because each Blob is independently deflated and self-describing, a reader can seek to any block boundary without decoding the ones before it.</text>
  <text x="440" y="216" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.9">That single property is what makes parallel PBF parsing possible at all — and what a short read of <tspan font-family="monospace">datasize</tspan> silently destroys.</text>
</svg>
<figcaption>Read this framing once and the parallel-parsing strategies later in the section stop looking clever — block independence is simply a property the container was designed to have.</figcaption>
</figure>

| Blob field | Meaning | Notes |
|---|---|---|
| `raw` | Uncompressed payload | `raw_size` is omitted; rare in practice |
| `zlib_data` | DEFLATE-compressed payload | By far the most common encoding |
| `lzma_data` | LZMA-compressed payload | Defined by the spec; seldom emitted |
| `OBSOLETE_bzip2_data` | Deprecated bzip2 | Do not produce; tolerate when reading legacy files |
| `lz4_data` / `zstd_data` | Newer optional codecs | Only present if a writer opts in; gate behind feature detection |

When any compressed field is set, `Blob.raw_size` declares the **decompressed** length, which you use to size the output buffer. Two hard ceilings come straight from the specification and must be enforced before allocating anything: a `BlobHeader` may not exceed **64 KiB**, and a decompressed `Blob` payload may not exceed **32 MiB**. Treat both as adversarial inputs — a corrupt or hostile file can claim an enormous size to trigger unbounded allocation, so validate the declared figures against the ceilings first.

The 4-byte length prefix that precedes each `BlobHeader` is encoded **network byte order (big-endian)** and is *not* part of any protobuf message — it is raw framing you read with `struct.unpack(">I", ...)`. Everything after it is standard protobuf and decodes through compiled bindings.

## Header Block Anatomy & Validation Gates

The leading `HeaderBlock` is the ingestion gateway. It carries an optional bounding box (`bbox`, in nanodegrees), the `required_features` and `optional_features` repeated string fields, a writing-program string, an optional source, and replication metadata: `osmosis_replication_timestamp`, `osmosis_replication_sequence_number`, and `osmosis_replication_base_url`. The `required_features` array is the contract — it tells you which capabilities a reader must implement to interpret the data correctly. The two values seen almost universally are `OsmSchema-V0.6` and `DenseNodes`; an extract that lists a feature your parser does not implement must be rejected, because skipping it would silently drop or misread records.

> **Spec reference.** Field semantics and the 64 KiB / 32 MiB ceilings are defined in the OpenStreetMap [PBF Format specification](https://wiki.openstreetmap.org/wiki/PBF_Format). The varint and zig-zag rules referenced below are in the [Protocol Buffers encoding guide](https://protobuf.dev/programming-guides/encoding/).

Run these gates against the header before a single primitive is read:

- Confirm `required_features` contains only values the parser implements (minimally `OsmSchema-V0.6`; `DenseNodes` if you read dense nodes).
- Bounds-check the `bbox` nanodegree values against valid WGS 84 ranges before initializing any spatial index.
- Record `osmosis_replication_sequence_number` and confirm it matches the expected upstream replication state so later diffs apply in order.

A missing, malformed, or out-of-spec header is a hard stop. Unlike a single bad element — which you can route to a quarantine table — a bad header means the rest of the file cannot be trusted, so abort before primitive ingestion begins. A complete, defensive header reader is walked through in [how to decode OSM PBF headers in Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Read and validate an OSM PBF block stream",
  "description": "Step-by-step procedure for parsing the length-prefixed block structure of an OpenStreetMap PBF file and validating each stage before ingestion.",
  "step": [
    { "@type": "HowToStep", "name": "Compile the proto definitions", "text": "Run protoc on fileformat.proto and osmformat.proto to generate Python bindings for BlobHeader, Blob, HeaderBlock, and PrimitiveBlock." },
    { "@type": "HowToStep", "name": "Read the length prefix", "text": "Read 4 bytes and decode them as a big-endian unsigned integer with struct.unpack('>I'); confirm the value does not exceed 64 KiB before reading the BlobHeader." },
    { "@type": "HowToStep", "name": "Parse the BlobHeader and Blob", "text": "Read BlobHeader.datasize bytes into a Blob message, confirm raw_size does not exceed 32 MiB, then decompress the active compression field (usually zlib_data)." },
    { "@type": "HowToStep", "name": "Validate the HeaderBlock", "text": "Decode the leading OSMHeader blob and verify every entry in required_features is implemented; bounds-check the bbox; record the replication sequence number." },
    { "@type": "HowToStep", "name": "Stream PrimitiveBlocks", "text": "For each OSMData blob, decode the PrimitiveBlock, read its StringTable, then reconstruct primitives by accumulating delta-encoded IDs and coordinates, resetting the accumulator at every group boundary." }
  ]
}
</script>

## Primitive Groups, StringTable & Delta Encoding

Each `PrimitiveBlock` opens with a `StringTable`: a single array of byte strings, indexed from 1, that deduplicates every tag key and value used in the block (index 0 is reserved as a delimiter for dense node key/value packing). Tags throughout the block are stored as integer indices into this table rather than repeated strings, which is the largest single contributor to PBF's compactness. Applying the conventions in [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) at this point — while you still hold the raw indices — lets you validate or normalize keys before they fan out into downstream tables.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 284" role="img" aria-labelledby="delta-dec-t delta-dec-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="delta-dec-t">Delta-encoded DenseNodes identifiers and the running sum that restores them</title>
  <desc id="delta-dec-d">The top row shows what is on the wire: a first absolute identifier of 240111883 followed by signed varint deltas of plus four, plus one, plus seven and minus two, each costing a single byte where the absolute value would cost five. The bottom row shows the reconstructed identifiers after the running sum. A warning panel notes that the accumulator resets at every primitive block boundary, separately for id, latitude, longitude and timestamp, and that carrying one across a boundary yields plausible but wrong identifiers.</desc>
  <rect x="0" y="0" width="880" height="284" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">DenseNodes stores differences; the accumulator turns them back into values</text>
  <text x="34" y="62" font-size="11.5" font-weight="600" fill="currentColor">on the wire — signed varints, mostly one byte each</text>
  <rect x="34" y="72" width="120" height="34" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="94" y="94" text-anchor="middle" font-size="12" font-family="monospace" fill="currentColor">240 111 883</text>
  <rect x="164" y="72" width="76" height="34" rx="5" fill="none" stroke="currentColor" stroke-width="1.3"/>
  <text x="202" y="94" text-anchor="middle" font-size="12" font-family="monospace" fill="currentColor">+4</text>
  <rect x="250" y="72" width="76" height="34" rx="5" fill="none" stroke="currentColor" stroke-width="1.3"/>
  <text x="288" y="94" text-anchor="middle" font-size="12" font-family="monospace" fill="currentColor">+1</text>
  <rect x="336" y="72" width="76" height="34" rx="5" fill="none" stroke="currentColor" stroke-width="1.3"/>
  <text x="374" y="94" text-anchor="middle" font-size="12" font-family="monospace" fill="currentColor">+7</text>
  <rect x="422" y="72" width="76" height="34" rx="5" fill="none" stroke="currentColor" stroke-width="1.3"/>
  <text x="460" y="94" text-anchor="middle" font-size="12" font-family="monospace" fill="currentColor">-2</text>
  <text x="520" y="94" font-size="11" fill="currentColor" opacity="0.85">…each delta costs 1 byte; the absolute ids would cost 5</text>
  <text x="34" y="148" font-size="11.5" font-weight="600" fill="currentColor">after the running sum</text>
  <rect x="34" y="158" width="120" height="34" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="94" y="180" text-anchor="middle" font-size="12" font-family="monospace" fill="currentColor">240 111 883</text>
  <rect x="164" y="158" width="120" height="34" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="224" y="180" text-anchor="middle" font-size="12" font-family="monospace" fill="currentColor">240 111 887</text>
  <rect x="294" y="158" width="120" height="34" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="354" y="180" text-anchor="middle" font-size="12" font-family="monospace" fill="currentColor">240 111 888</text>
  <rect x="424" y="158" width="120" height="34" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="484" y="180" text-anchor="middle" font-size="12" font-family="monospace" fill="currentColor">240 111 895</text>
  <rect x="554" y="158" width="120" height="34" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="614" y="180" text-anchor="middle" font-size="12" font-family="monospace" fill="currentColor">240 111 893</text>
  <rect x="34" y="212" width="812" height="52" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.4"/>
  <text x="440" y="234" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">The accumulator resets at every PrimitiveBlock boundary — id, lat, lon and timestamp each have their own</text>
  <text x="440" y="253" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.9">Carry one across a block and the ids stay plausible while pointing at entirely different objects. Nothing in the file will tell you.</text>
</svg>
<figcaption>Delta encoding is why a PBF is small, and the per-block accumulator reset is why a hand-rolled reader that works on one block quietly corrupts the second.</figcaption>
</figure>

After the `StringTable` come the `primitivegroup` entries. Each `PrimitiveGroup` is homogeneous: it holds *either* a packed `DenseNodes` message, *or* a list of `Way`, *or* `Relation`, *or* standalone `Node` messages — never a mix. Object IDs, node references, and coordinates are stored as **signed deltas**: each value is the difference from its predecessor within the same group, zig-zag encoded into a varint. `DenseNodes` takes this furthest, delta-encoding `id`, `lat`, `lon`, and the `denseinfo` fields as parallel packed arrays.

The non-negotiable rule: maintain a running accumulator for every delta-encoded field and **reset it to zero at each group boundary**. The first value in a group is the absolute starting point; every value after it adds to the accumulator. Read the deltas as zig-zag varints, never as fixed-width integers. A missed reset or a varint misread does not error — it shifts every subsequent value, which is precisely the silent corruption described at the top of this page.

## Coordinate Reconstruction

Coordinates are stored as 64-bit signed integers in scaled WGS 84. Each `PrimitiveBlock` carries a `granularity` field (default `100`, meaning 100 nanodegrees per unit) plus `lat_offset` and `lon_offset` (default `0`, in nanodegrees). The accumulated delta sum for a node is converted to decimal degrees with:

$$
\text{lat}_{\deg} = 10^{-9} \times \bigl(\text{lat\_offset} + \text{granularity} \times \text{lat}_{\text{acc}}\bigr)
$$

$$
\text{lon}_{\deg} = 10^{-9} \times \bigl(\text{lon\_offset} + \text{granularity} \times \text{lon}_{\text{acc}}\bigr)
$$

With the default granularity of 100 nanodegrees, the storage resolution is roughly 1.1 cm at the equator — far finer than survey-grade OSM data needs, and well clear of IEEE 754 rounding error. Keep coordinates as integers as long as possible and defer the float conversion to the final output stage; doing the arithmetic in integers preserves bit-for-bit reproducibility across distributed worker nodes.

## Step-by-Step: Reading the Block Stream in Python

The following procedure turns the wire format above into a bounded, streaming reader. It uses compiled `osmformat`/`fileformat` bindings, Python 3.10+ type hints, and the project's standard logger pattern.

1. **Compile the proto definitions.** Fetch `fileformat.proto` and `osmformat.proto` from the OSM source tree and generate bindings: `protoc --python_out=. fileformat.proto osmformat.proto`. This yields `fileformat_pb2` and `osmformat_pb2`.

2. **Read and bound-check each `BlobHeader`.** Pull the 4-byte big-endian prefix, reject anything over the 64 KiB ceiling, then parse the header.

3. **Decompress the `Blob`.** Confirm `raw_size` is within the 32 MiB ceiling, then inflate the active compression field.

4. **Dispatch by `type`.** Decode the first blob as a `HeaderBlock` and validate it; decode every subsequent `OSMData` blob as a `PrimitiveBlock`.

```python
import logging
import struct
import zlib
from collections.abc import Iterator
from typing import BinaryIO

import fileformat_pb2
import osmformat_pb2

logger = logging.getLogger(__name__)

MAX_HEADER_BYTES: int = 64 * 1024        # BlobHeader ceiling per spec
MAX_BLOB_BYTES: int = 32 * 1024 * 1024   # decompressed Blob ceiling per spec


def iter_blobs(stream: BinaryIO) -> Iterator[tuple[str, bytes]]:
    """Yield (blob_type, decompressed_payload) for each block in a .osm.pbf stream."""
    while True:
        prefix = stream.read(4)
        if len(prefix) == 0:
            return  # clean EOF on a block boundary
        if len(prefix) != 4:
            raise EOFError("truncated length prefix at block boundary")

        (header_len,) = struct.unpack(">I", prefix)  # big-endian framing
        if header_len > MAX_HEADER_BYTES:
            raise ValueError(f"BlobHeader length {header_len} exceeds 64 KiB ceiling")

        header = fileformat_pb2.BlobHeader()
        header.ParseFromString(_read_exact(stream, header_len))

        blob = fileformat_pb2.Blob()
        blob.ParseFromString(_read_exact(stream, header.datasize))
        yield header.type, _inflate(blob)


def _read_exact(stream: BinaryIO, n: int) -> bytes:
    data = stream.read(n)
    if len(data) != n:
        raise EOFError(f"expected {n} bytes, got {len(data)} (truncated file)")
    return data


def _inflate(blob: fileformat_pb2.Blob) -> bytes:
    if blob.raw_size and blob.raw_size > MAX_BLOB_BYTES:
        raise ValueError(f"declared raw_size {blob.raw_size} exceeds 32 MiB ceiling")
    if blob.HasField("raw"):
        return blob.raw
    if blob.HasField("zlib_data"):
        return zlib.decompress(blob.zlib_data, bufsize=blob.raw_size or zlib.DEF_BUF_SIZE)
    raise NotImplementedError("unsupported Blob compression (only raw and zlib handled)")


def read_pbf(path: str) -> Iterator[osmformat_pb2.PrimitiveBlock]:
    """Validate the header, then yield each PrimitiveBlock in order."""
    with open(path, "rb") as fh:
        blobs = iter_blobs(fh)
        first_type, first_payload = next(blobs)
        if first_type != "OSMHeader":
            raise ValueError(f"file must lead with OSMHeader, found {first_type!r}")

        header = osmformat_pb2.HeaderBlock()
        header.ParseFromString(first_payload)
        _validate_header(header)

        for blob_type, payload in blobs:
            if blob_type != "OSMData":
                logger.warning("skipping unexpected blob type %r", blob_type)
                continue
            block = osmformat_pb2.PrimitiveBlock()
            block.ParseFromString(payload)
            yield block


SUPPORTED_FEATURES: frozenset[str] = frozenset({"OsmSchema-V0.6", "DenseNodes"})


def _validate_header(header: osmformat_pb2.HeaderBlock) -> None:
    unsupported = set(header.required_features) - SUPPORTED_FEATURES
    if unsupported:
        raise ValueError(f"required features not implemented: {sorted(unsupported)}")
    logger.info("header OK; replication seq=%s", header.osmosis_replication_sequence_number)
```

Reconstructing the actual nodes from a `PrimitiveBlock` is the second half of the job — accumulating the dense delta arrays and applying the granularity formula:

```python
def iter_dense_nodes(block: osmformat_pb2.PrimitiveBlock) -> Iterator[tuple[int, float, float]]:
    """Yield (osm_id, lat_deg, lon_deg) from every DenseNodes group in a block."""
    granularity: int = block.granularity or 100
    lat_off: int = block.lat_offset
    lon_off: int = block.lon_offset

    for group in block.primitivegroup:
        if not group.HasField("dense"):
            continue
        dense = group.dense
        oid = lat = lon = 0  # accumulators reset at every group boundary
        for d_id, d_lat, d_lon in zip(dense.id, dense.lat, dense.lon, strict=True):
            oid += d_id
            lat += d_lat
            lon += d_lon
            yield (
                oid,
                1e-9 * (lat_off + granularity * lat),
                1e-9 * (lon_off + granularity * lon),
            )
```

## Validation & Error-Handling Matrix

Each row below is a real failure seen in production PBF pipelines, with how to detect and remediate it.

| Error condition | Root cause | Detection | Remediation |
|---|---|---|---|
| Coordinates shifted by a constant offset | Delta accumulator not reset at group boundary | Spot-check first node of each group against an absolute reference | Reset `oid/lat/lon` to 0 at the start of every `primitivegroup` |
| Coordinates diverge progressively | Deltas read as fixed-width, not zig-zag varints | Compare reconstructed bbox to header `bbox` | Decode via protobuf bindings, never manual `struct` on the deltas |
| `MemoryError` on a single block | `raw_size` trusted without bound | Allocation spikes before crash | Reject `raw_size > 32 MiB` and `header_len > 64 KiB` before allocating |
| `DecodeError` mid-file | Truncated or partially transferred file | `ParseFromString` raises; byte count short | Verify file SHA-256 before ingest; fail fast on short reads |
| Silent record loss | Unsupported `required_features` ignored | Output count below expectation | Validate `required_features` against the supported set; abort on mismatch |
| Tags resolve to wrong strings | Off-by-one into `StringTable` (index 0 misuse) | Garbled or empty tag values | Treat index 0 as the dense delimiter; index real strings from 1 |
| Diffs apply out of order | Replication sequence not tracked | State drift between extract and updates | Persist `osmosis_replication_sequence_number` to a manifest |

## Performance & Scale Considerations

The block structure is what makes PBF fast, and your reader should exploit it rather than fight it. Stream one `PrimitiveBlock` at a time and discard each after processing — never deserialize the whole file into RAM. Because every `BlobHeader` declares its `datasize` up front, you can scan the file once to build an index of block offsets, then hand disjoint offset ranges to worker processes. Partition on **block boundaries**, never arbitrary byte offsets, so each worker holds a self-contained delta context; splitting mid-block breaks the accumulator chain.

With the 32 MiB decompressed ceiling, a conservative per-worker memory budget is one inflated block plus the reconstructed primitives it produces — typically well under 100 MB even for dense urban blocks. A planet file holds tens of thousands of `OSMData` blobs, so the offset-index-then-fan-out pattern scales near-linearly with cores until disk read bandwidth saturates. Keep coordinates in integer form across worker boundaries and convert to float only at the sink, both for reproducibility and to halve the serialized intermediate size.

## Failure Modes & Gotchas

Beyond the matrix, a few edge cases catch even careful implementations:

- **Group-local granularity.** `granularity`, `lat_offset`, and `lon_offset` live on the `PrimitiveBlock`, not the file. A multi-source merged extract can carry different granularities per block; never cache the first block's values globally.
- **`date_granularity` is separate.** Timestamps in `denseinfo`/`info` use `date_granularity` (default 1000 ms), a different field from coordinate `granularity`. Mixing them corrupts version history.
- **Optional features are advisory.** `optional_features` (e.g. `Has_Metadata`, `Sort.Type_then_ID`) may be absent without making a file invalid — gate metadata extraction on their presence rather than assuming it.
- **The trailing prefix.** A well-formed file ends cleanly on a block boundary; a zero-length read at the prefix step is EOF, but a 1–3 byte read is truncation. Distinguish the two.
- **zlib `bufsize` hint.** Passing `raw_size` to `zlib.decompress` avoids repeated buffer growth on large blocks — a measurable win across a planet file.

## Integration Points: Feeding the Next Stage

The reconstructed primitive stream is the input to every downstream stage. The cleanest contract is a generator of plain records that the normalization layer consumes without knowing anything about PBF framing — exactly the boundary that the [parsing and tag-normalization workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) build on. The example below wires the reader into a tag-cleaning sink and routes defective records to a quarantine, the discipline detailed in [error handling in large OSM extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/):

```python
def ingest(path: str) -> None:
    """Wire the PBF reader into the normalization stage with a quarantine path."""
    clean = 0
    quarantined = 0
    for block in read_pbf(path):
        for osm_id, lat, lon in iter_dense_nodes(block):
            try:
                record = {"id": osm_id, "lat": lat, "lon": lon}
                normalize_and_emit(record)  # provided by the normalization stage
                clean += 1
            except ValueError as exc:
                logger.warning("quarantining node %s: %s", osm_id, exc)
                quarantine(osm_id, exc)
                quarantined += 1
    logger.info("ingest complete: %d clean, %d quarantined", clean, quarantined)
```

For higher-level reads that skip the manual block loop entirely, the concurrent reader described in [async PBF parsing with pyrosm](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/async-pbf-parsing-with-pyrosm/) and the windowed approach in [memory-efficient chunk processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) apply the same block-boundary partitioning shown above.

## Worked Examples

These focused walkthroughs implement specific tasks against the format described here:

- [How to decode OSM PBF headers in Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/) — a defensive `HeaderBlock` reader with size-ceiling enforcement and feature validation.
- [Extracting metadata from OSM planet files](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/extracting-metadata-from-osm-planet-files/) — pulling replication sequence, timestamp, and bbox for version lineage without a full parse.

## Frequently Asked Questions

<details>
<summary>Why does my PBF reader return coordinates in the wrong place?</summary>

Almost always a delta-encoding mistake. PBF stores IDs and coordinates as zig-zag varint deltas from the previous value within a `PrimitiveGroup`. You must accumulate them and reset the accumulator to zero at every group boundary, and you must let the protobuf bindings decode the varints rather than reading fixed-width integers. A missed reset or a varint misread shifts everything after it.
</details>

<details>
<summary>What size ceilings must I enforce when reading PBF?</summary>

The specification caps a `BlobHeader` at 64 KiB and a decompressed `Blob` payload at 32 MiB. Validate both against the declared `header_len` and `raw_size` before allocating any buffer, so a truncated or hostile file cannot trigger unbounded allocation.
</details>

<details>
<summary>Which compression modes do I actually need to support?</summary>

In practice `zlib_data` covers the overwhelming majority of files, with `raw` as the uncompressed fallback. The spec also defines `lzma_data`, deprecated `bzip2`, and optional newer codecs (`lz4`, `zstd`); support those only if your sources emit them, and gate the newer ones behind feature detection.
</details>

<details>
<summary>How do granularity and offsets affect coordinate accuracy?</summary>

Each `PrimitiveBlock` carries `granularity` (default 100 nanodegrees), `lat_offset`, and `lon_offset`. Decimal degrees are `1e-9 × (offset + granularity × accumulated_delta)`. At the default granularity the storage resolution is about 1.1 cm, so the limiting factor is the survey accuracy of the source data, not the format.
</details>

<details>
<summary>Why does the file start with a separate OSMHeader blob?</summary>

The leading `OSMHeader` blob carries the `HeaderBlock`: required and optional feature flags, the bounding box, and replication metadata. It is the validation gate — a reader confirms it implements every `required_feature` and records the replication sequence before touching a single primitive. A malformed header is a hard stop, not a quarantine case.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Why does my PBF reader return coordinates in the wrong place?",
      "acceptedAnswer": { "@type": "Answer", "text": "Almost always a delta-encoding mistake. PBF stores IDs and coordinates as zig-zag varint deltas from the previous value within a PrimitiveGroup. You must accumulate them and reset the accumulator to zero at every group boundary, and let the protobuf bindings decode the varints rather than reading fixed-width integers. A missed reset or a varint misread shifts everything after it." }
    },
    {
      "@type": "Question",
      "name": "What size ceilings must I enforce when reading PBF?",
      "acceptedAnswer": { "@type": "Answer", "text": "The specification caps a BlobHeader at 64 KiB and a decompressed Blob payload at 32 MiB. Validate both against the declared header length and raw_size before allocating any buffer, so a truncated or hostile file cannot trigger unbounded allocation." }
    },
    {
      "@type": "Question",
      "name": "Which compression modes do I actually need to support?",
      "acceptedAnswer": { "@type": "Answer", "text": "In practice zlib_data covers the overwhelming majority of files, with raw as the uncompressed fallback. The spec also defines lzma_data, deprecated bzip2, and optional newer codecs like lz4 and zstd; support those only if your sources emit them, and gate the newer ones behind feature detection." }
    },
    {
      "@type": "Question",
      "name": "How do granularity and offsets affect coordinate accuracy?",
      "acceptedAnswer": { "@type": "Answer", "text": "Each PrimitiveBlock carries granularity (default 100 nanodegrees), lat_offset, and lon_offset. Decimal degrees are 1e-9 times (offset plus granularity times accumulated delta). At the default granularity the storage resolution is about 1.1 cm, so the limiting factor is the survey accuracy of the source data, not the format." }
    },
    {
      "@type": "Question",
      "name": "Why does the file start with a separate OSMHeader blob?",
      "acceptedAnswer": { "@type": "Answer", "text": "The leading OSMHeader blob carries the HeaderBlock: required and optional feature flags, the bounding box, and replication metadata. It is the validation gate; a reader confirms it implements every required feature and records the replication sequence before touching a single primitive. A malformed header is a hard stop, not a quarantine case." }
    }
  ]
}
</script>

## Related

- [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — the primitive graph each decoded block reconstructs.
- [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/) — the I/O and memory trade-offs that motivate reading binary.
- [Coordinate Reference Systems in OSM](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/coordinate-reference-systems-in-osm/) — WGS 84 storage and reprojection after decode.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — validating StringTable keys before they fan out.
- [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) — building R-tree, Quadkey, or H3 indexes from the decoded stream.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — quarantine and remediation for defective records.

This reference is part of the [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/) section — return there for the full map of the OSM data model, serialization formats, and ingestion foundations.
