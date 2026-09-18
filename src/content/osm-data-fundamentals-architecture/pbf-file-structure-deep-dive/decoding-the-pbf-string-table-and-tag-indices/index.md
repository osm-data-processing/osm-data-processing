---
title: "Decoding the PBF String Table and Tag Indices"
description: "Read a PrimitiveBlock's StringTable and resolve the interleaved key and value indices that dense nodes, ways and relations use instead of storing strings."
pageTitle: "PBF String Tables and Tag Index Resolution"
pageDescription: "Decode a PBF StringTable, resolve the keys_vals index stream that dense nodes use, and handle the per-block scoping that makes an index from one block meaningless in another."
slug: decoding-the-pbf-string-table-and-tag-indices
type: article
breadcrumb: "String Table & Indices"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Decoding the PBF String Table and Tag Indices

No string appears twice in a PBF file's data. Every key and every value is an index into a table that belongs to one block, and understanding that indirection explains both why the format is so compact and why an index carried across a block boundary is meaningless.

## Prerequisites

- [ ] Python 3.10+ with compiled OSM protobuf definitions, or `osmium` if you only want to verify results.
- [ ] The block structure from [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/).
- [ ] Familiarity with dense node encoding, from [Reading Dense Nodes and Delta-Encoded Coordinates](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/reading-dense-nodes-and-delta-encoded-coordinates/).
- [ ] A regional PBF file to read.
- [ ] Patience with the one genuinely unusual encoding in the format.

## Conceptual minimum

Each `PrimitiveBlock` contains a `StringTable`: a repeated field of byte strings. Every key and value in that block is stored as an integer index into it. **Index 0 is always the empty string** and is reserved as a delimiter, which matters enormously for dense nodes.

Two different tag encodings exist in the same format.

**Ways and relations use parallel arrays.** Each element carries a `keys` list and a `vals` list of equal length, and the tags are the pairwise zip of the two. This is straightforward.

**Dense nodes use one interleaved stream.** All the nodes in a group share a single `keys_vals` array, in which each node's tags appear as alternating key and value indices, terminated by a zero. A node with no tags contributes just the zero. Walking that stream is the only way to know which tags belong to which node, and it must be walked in step with the node array rather than indexed into.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 226" role="img" aria-labelledby="pst1-t pst1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="pst1-t">How one dense node group stores the tags of many nodes in a single array</title>
  <desc id="pst1-d">A single keys and values array split into four segments to show the pattern. The first segment holds one node's two tags as four alternating indices followed by a zero terminator. The second segment is a lone zero, which is how a node with no tags at all is represented. The third segment holds another node's single tag as two indices and a terminator. The fourth segment notes that the array must be walked sequentially in step with the node list, because there is no offset table giving each node's position.</desc>
  <rect x="0" y="0" width="880" height="226" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">One array, many nodes, a zero between each</text>
  <rect x="26" y="56" width="272" height="54" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="162" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">node 1</text>
  <text x="162" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">k v k v 0</text>
  <text x="162" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">two tags</text>
  <text x="162" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">alternating indices</text>
  <text x="162" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">zero terminates</text>
  <rect x="302" y="56" width="134" height="54" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="369" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">node 2</text>
  <text x="369" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">0</text>
  <text x="369" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">no tags at all</text>
  <text x="369" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">just the terminator</text>
  <text x="369" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">easy to mis-skip</text>
  <rect x="440" y="56" width="203" height="54" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="542" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">node 3</text>
  <text x="542" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">k v 0</text>
  <text x="542" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">one tag</text>
  <text x="542" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">same pattern</text>
  <text x="542" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">terminator again</text>
  <rect x="647" y="56" width="203" height="54" rx="6" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="748" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">walking</text>
  <text x="748" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">sequential only</text>
  <text x="748" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">no offset table</text>
  <text x="748" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">step with the node list</text>
  <text x="748" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">position is implicit</text>
  <text x="868" y="210" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Index zero is reserved as the empty string precisely so it can serve as this terminator without ever being a real key.</text>
</svg>
<figcaption>The untagged case, a lone zero, is the one that desynchronises a reader that assumes every node contributes pairs.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
from collections.abc import Iterator

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.pbf.stringtable")


class StringTable:
    """A block's string table. Indices are meaningless outside their block."""

    def __init__(self, entries: list[bytes]) -> None:
        self._entries = entries
        if not entries or entries[0] != b"":
            # Index 0 must be the empty string: dense nodes use it as a
            # terminator, so a table without it cannot be walked.
            raise ValueError("string table index 0 is not the empty string")

    def __len__(self) -> int:
        return len(self._entries)

    def get(self, index: int) -> str:
        if not 0 <= index < len(self._entries):
            raise IndexError(f"string index {index} outside a table of "
                             f"{len(self._entries)} entries")
        # OSM strings are UTF-8; a decode error means a corrupt block.
        return self._entries[index].decode("utf-8")


def tags_from_parallel(table: StringTable, keys: list[int],
                       vals: list[int]) -> dict[str, str]:
    """Ways and relations: two equal-length arrays, zipped."""
    if len(keys) != len(vals):
        raise ValueError(f"keys/vals length mismatch: {len(keys)} vs {len(vals)}")
    return {table.get(k): table.get(v) for k, v in zip(keys, vals)}


def tags_from_dense(table: StringTable, keys_vals: list[int],
                    node_count: int) -> Iterator[dict[str, str]]:
    """Dense nodes: ONE interleaved array for the whole group.

    Walked strictly sequentially. A zero ends the current node's tags; a
    node with no tags contributes a single zero and nothing else.
    """
    position = 0
    emitted = 0
    length = len(keys_vals)

    while emitted < node_count:
        tags: dict[str, str] = {}
        while position < length and keys_vals[position] != 0:
            if position + 1 >= length:
                raise ValueError("keys_vals ended mid-pair; block is truncated")
            key = table.get(keys_vals[position])
            value = table.get(keys_vals[position + 1])
            tags[key] = value
            position += 2
        position += 1          # step over the zero terminator
        emitted += 1
        yield tags

    if position < length:
        # Leftover data means the walk and the node count disagree.
        logger.warning("%d unconsumed keys_vals entr(ies) after %d node(s)",
                       length - position, node_count)


def table_stats(table: StringTable, keys_vals: list[int]) -> dict[str, float]:
    """How much the table is actually saving on this block."""
    used = {i for i in keys_vals if i != 0}
    referenced_bytes = sum(len(table.get(i).encode()) for i in keys_vals if i)
    stored_bytes = sum(len(table.get(i).encode()) for i in range(len(table)))
    ratio = referenced_bytes / stored_bytes if stored_bytes else 0.0
    logger.info("table holds %d entr(ies), %d used, %.1fx expansion if inlined",
                len(table), len(used), ratio)
    return {"entries": len(table), "used": len(used), "expansion": ratio}


if __name__ == "__main__":
    table = StringTable([b"", b"highway", b"residential", b"name", b"High St"])
    stream = [1, 2, 3, 4, 0,      # node 1: two tags
              0,                   # node 2: none
              1, 2, 0]             # node 3: one tag
    for tags in tags_from_dense(table, stream, node_count=3):
        logger.info("%s", tags)
```

## Step-by-step walkthrough

1. **Assert index zero is empty.** A table whose first entry is not the empty string cannot be walked, because the terminator would collide with a real key.
2. **Bound-check every index.** An out-of-range index means a corrupt block or a mismatched table, and a clear error beats a confusing one from the decoder.
3. **Zip parallel arrays only after checking lengths.** A length mismatch silently truncates under a plain zip, losing tags without any signal.
4. **Walk the dense stream, never index into it.** There is no offset table; a node's tags begin wherever the previous node's terminator left off, and that position is only knowable by walking.
5. **Handle the untagged node explicitly.** A lone zero is a complete node contribution, and a reader that expects at least one pair per node desynchronises on the first untagged node — which in OSM is most of them.
6. **Detect a truncated stream.** An odd number of entries before a terminator means the block is damaged, and failing there is better than emitting a half-read tag.
7. **Check for leftovers.** Unconsumed entries after the expected node count mean the walk and the node array disagree, which is the signature of a desynchronisation earlier in the block.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="pst2-t pst2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="pst2-t">The two tag encodings in one format, compared</title>
  <desc id="pst2-d">A grid of four properties against the parallel-array encoding used by ways and relations and the interleaved encoding used by dense nodes. The parallel encoding stores one keys array and one values array per element, is accessed by index, requires only a length check, and is straightforward to read. The interleaved encoding stores one array for a whole group of nodes, must be walked sequentially, requires tracking a position across nodes, and desynchronises permanently if an untagged node is mishandled.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Two encodings, and only one is random-access</text>
  <rect x="216" y="48" width="319" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="376" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Ways and relations</text>
  <rect x="535" y="48" width="319" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="694" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Dense nodes</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Arrays</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">two, per element</text>
  <text x="694" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">one, per group</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Access</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">by index</text>
  <text x="694" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">sequential walk</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">State needed</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">none</text>
  <text x="694" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a position</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Failure mode</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">truncated tags</text>
  <text x="694" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">permanent desync</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The right column's failure is silent and cumulative: once the walk loses step, every subsequent node gets another node's tags.</text>
</svg>
<figcaption>That asymmetry is why dense node decoding deserves its own tests even when the parallel path is obviously fine.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="pst3-t pst3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="pst3-t">How a tag filter uses the string table to compare integers instead of strings</title>
  <desc id="pst3-d">Four steps performed once per block. The resolve step looks up each of the filter's keys and values in that block's string table, turning them into integers. The absent step notes that a key not present in the table cannot match anything in the block, so the whole block can be skipped for that filter. The compare step tests element tag indices against the resolved integers, which is far cheaper than comparing strings. The rebuild step notes that all of this must be repeated for the next block, because the indices do not carry across.</desc>
  <defs><marker id="pst3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Resolve once per block, then compare integers</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">resolve</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">filter keys to indices</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">once per block</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#pst3-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">absent?</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">key not in the table</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">skip the whole block</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#pst3-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">compare</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">integers, not strings</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">far cheaper</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#pst3-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">rebuild</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">next block, new table</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">indices do not carry</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The second step is the large win: a filter for an uncommon key skips most blocks entirely without decoding a single element.</text>
</svg>
<figcaption>This is why tag filtering on PBF is so much faster than on XML, and it is a direct consequence of the string table.</figcaption>
</figure>

## Verification

- **Tag counts match a reference.** Compare total tags per block against `osmium fileinfo` or a known-good reader.
- **Untagged nodes appear.** A block should yield some nodes with empty tag dictionaries; if none do, the terminator handling is wrong.
- **The stream is fully consumed.** After emitting the expected node count, no entries should remain.
- **A known feature decodes correctly.** Pick a node whose tags you can check independently and confirm they match.
- **Indices do not cross blocks.** Decode two blocks and confirm the same index resolves to different strings, which proves the scoping is being respected.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Tags attached to the wrong nodes | Untagged node not handled | Treat a lone zero as a complete node contribution |
| Decoding drifts after a few nodes | Stream indexed rather than walked | Track a position and advance it sequentially |
| Strings are nonsense | Table from a different block reused | Rebuild the table per block; indices are block-scoped |
| Some tags silently missing | Parallel arrays zipped without a length check | Compare lengths and raise on a mismatch |
| Index error at the end of a block | Truncated stream ending mid-pair | Check for a second element before reading a pair |
| Unicode errors on decode | Bytes treated as another encoding | Decode as UTF-8; a failure indicates corruption |
| Leftover entries after the walk | Node count and stream disagree | Warn on unconsumed entries and investigate the block |

## Specification reference

> A `PrimitiveBlock` contains a `StringTable` whose first entry is always the empty string, reserved for use as a delimiter. Ways and relations encode tags as parallel `keys` and `vals` arrays of string-table indices. Dense nodes encode all tags for a group in a single `keys_vals` array of alternating key and value indices, with each node's tags terminated by a zero. See the [PBF format documentation](https://wiki.openstreetmap.org/wiki/PBF_Format) for the message definitions and the delimiter convention.

## Frequently Asked Questions

<details>
<summary>Why is index zero reserved for the empty string?</summary>

So it can serve as the terminator in the dense node tag stream without ever colliding with a real key. Since a key is never the empty string, a zero in that stream unambiguously means "this node's tags end here". Reserving the slot costs one entry per block and removes the need for any separate length or offset information, which is a large part of why the encoding is as compact as it is.
</details>

<details>
<summary>Can I use a string index from one block in another?</summary>

No, and doing so produces confidently wrong strings rather than an error. Each block builds its own table from the strings that block happens to use, so index five means different things in different blocks. Any reader that caches resolved strings must key the cache by block, and any intermediate representation that stores indices rather than strings must carry the block identity with them.
</details>

<details>
<summary>Why does dense node decoding desynchronise?</summary>

Because the tag stream has no offsets: each node's tags start wherever the previous node's terminator left off. If a reader mishandles one node — most commonly an untagged node, which contributes only a zero — every subsequent node receives the tags of the one before it. Nothing errors, and the output looks plausible, which is why this decoding needs a test with untagged nodes in it.
</details>

<details>
<summary>How much does the string table actually save?</summary>

A great deal, because OSM keys and values repeat enormously: a block containing tens of thousands of residential roads stores the strings for that key and value once each. Inlining them would multiply the tag payload several times over. The table is also what makes tag filtering fast, since a filter can resolve its keys to indices once per block and then compare integers.
</details>

## Related

- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — the parent topic and the block framing.
- [Reading Dense Nodes and Delta-Encoded Coordinates](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/reading-dense-nodes-and-delta-encoded-coordinates/) — the coordinate half of the same encoding.
- [Writing a Valid OSM PBF File from Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/writing-a-valid-osm-pbf-file-from-python/) — building a string table rather than reading one.
- [How to Decode OSM PBF Headers in Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/) — the header that precedes these blocks.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — why block scoping helps a streaming reader.

Up one level: [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Decoding the PBF String Table and Tag Indices",
  "description": "Read a PrimitiveBlock's StringTable and resolve the interleaved key and value indices that dense nodes, ways and relations use instead of storing strings.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["PBF string table", "dense node tags", "index resolution"]
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
    { "@type": "ListItem", "position": 4, "name": "Decoding the PBF String Table and Tag Indices", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/decoding-the-pbf-string-table-and-tag-indices/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Decode PBF string table indices into tags",
  "description": "Validate that index zero is empty, bound-check every lookup, zip parallel arrays after a length check, walk the dense stream sequentially treating a lone zero as an untagged node, and verify nothing remains unconsumed.",
  "step": [
    { "@type": "HowToStep", "name": "Validate the table", "text": "Confirm the first entry is the empty string, since dense node decoding uses it as a terminator." },
    { "@type": "HowToStep", "name": "Bound-check lookups", "text": "Raise a clear error on an out-of-range index rather than letting the decoder fail confusingly." },
    { "@type": "HowToStep", "name": "Check parallel array lengths", "text": "Compare the keys and values arrays before zipping, since a mismatch silently truncates tags." },
    { "@type": "HowToStep", "name": "Walk the dense stream", "text": "Track a position through the interleaved array rather than indexing, since each node's tags start where the last ended." },
    { "@type": "HowToStep", "name": "Handle untagged nodes", "text": "Treat a lone zero as a complete contribution, because most OSM nodes carry no tags at all." },
    { "@type": "HowToStep", "name": "Detect truncation and leftovers", "text": "Raise on a stream ending mid-pair and warn when entries remain after the expected node count." },
    { "@type": "HowToStep", "name": "Scope tables per block", "text": "Rebuild the table for each block, since an index from one block resolves to a different string in another." }
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
      "name": "Why is PBF string table index zero reserved for the empty string?",
      "acceptedAnswer": { "@type": "Answer", "text": "So it can serve as the terminator in the dense node tag stream without ever colliding with a real key. Since a key is never the empty string, a zero in that stream unambiguously means this node's tags end here. Reserving the slot removes the need for any separate length or offset information." }
    },
    {
      "@type": "Question",
      "name": "Can I use a PBF string index from one block in another?",
      "acceptedAnswer": { "@type": "Answer", "text": "No, and doing so produces confidently wrong strings rather than an error. Each block builds its own table from the strings it happens to use, so the same index means different things in different blocks. Any reader that caches resolved strings must key the cache by block." }
    },
    {
      "@type": "Question",
      "name": "Why does dense node tag decoding desynchronise?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because the tag stream has no offsets: each node's tags start wherever the previous node's terminator left off. If a reader mishandles one node — most commonly an untagged node contributing only a zero — every subsequent node receives the previous one's tags. Nothing errors and the output looks plausible." }
    },
    {
      "@type": "Question",
      "name": "How much does a PBF string table actually save?",
      "acceptedAnswer": { "@type": "Answer", "text": "A great deal, because OSM keys and values repeat enormously: a block containing tens of thousands of residential roads stores that key and value once each. The table also makes tag filtering fast, since a filter can resolve its keys to indices once per block and then compare integers." }
    }
  ]
}
</script>
