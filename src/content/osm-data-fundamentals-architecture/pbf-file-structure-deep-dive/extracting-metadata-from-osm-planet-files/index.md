---
pageTitle: "Extract Metadata from OSM Planet Files with pyosmium"
pageDescription: "Stream uid, user, timestamp, version, changeset, and visible provenance fields out of a multi-gigabyte OSM PBF planet file with pyosmium at bounded memory — no coordinate index, anonymized-edit fallbacks, and CSV/Parquet output."
---
# Extracting metadata from OSM planet files

Stream the per-element provenance fields — `uid`, `user`, `timestamp`, `version`, `changeset`, and `visible` — out of a multi-gigabyte OSM PBF planet file into a flat table, without loading the file into memory and without resolving a single coordinate.

## Prerequisites

Confirm each item before running the code below; a missing version pin or a coordinate index left switched on is the usual cause of either a parse error or a runaway 60 GB memory spike on a planet-scale file.

- [ ] `pyosmium` ≥ 3.6.0 installed (`pip install "osmium>=3.6"`) — it bundles libosmium and resolves PBF delta encoding internally.
- [ ] Python 3.10+ for the `list[...]` builtin generics and structural pattern matching used here.
- [ ] `osmium-tool` available on `PATH` (`apt install osmium-tool`) for the `osmium fileinfo` pre-flight integrity check.
- [ ] A source extract on local disk — `planet-latest.osm.pbf` for the full archive, or a regional `.osm.pbf` / historical `.osh.pbf` for the `visible` field to be meaningful.
- [ ] `pyarrow` ≥ 14.0.0 installed only if you intend to emit Parquet instead of CSV (`pip install "pyarrow>=14"`).
- [ ] Enough free disk for the output: a flat metadata table for the full planet is tens of gigabytes as CSV, roughly a third of that as Parquet.

## Conceptual minimum

OpenStreetMap metadata is not spatial data — it is the provenance layer that records *who* edited each primitive, *when*, and in which changeset. These fields drive attribution tracking, contributor analytics, and licensing compliance, and they sit beside the geometry rather than inside it. In the PBF wire format covered by the [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/), each `PrimitiveBlock` carries metadata in an optional layer: dense nodes pack it into a single `DenseInfo` message, while ways and relations carry a per-element `Info` message. Within a block, `uid`, `version`, `timestamp`, and `changeset` are delta-encoded against the preceding element, and `user` is an index into the block's shared `StringTable` — which is exactly why a naive byte scan or regex over the binary payload returns garbage.

You do not have to decode any of that by hand. `pyosmium` materializes the delta chains and resolves `StringTable` offsets for you, handing each callback a fully reconstructed object. The fields map directly onto the three element types of the [Node-Way-Relation data model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/), so the handler below simply reads attributes off whatever object it is given. The one decision that governs memory is whether to build a coordinate location index: metadata extraction never needs geometry, so you switch that index off and the parser stays under a couple of gigabytes even on the full planet. When the metadata layer is absent — anonymized or stripped extracts, redacted history — `uid` is `0` and `user` is the empty string, and your code must treat that as a first-class case rather than a bug.

<svg viewBox="0 0 760 392" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Decode path for OSM PBF metadata: a PrimitiveBlock holds a shared StringTable, a DenseInfo message for dense nodes, and per-element Info messages for ways and relations. The uid, version, timestamp, and changeset fields are delta-encoded and accumulate across elements, while the user field is an index resolved through the StringTable, producing a flat output row of id, type, uid, user, timestamp, version, changeset, and visible." style="width:100%;max-width:760px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>How pyosmium decodes PBF metadata into a flat row</title>
  <desc>Inside one PrimitiveBlock, dense nodes store metadata in a DenseInfo message and ways and relations store it in per-element Info messages. The uid, version, timestamp, and changeset values are delta-encoded, so each element adds a signed delta to the previous running value (for example uid 1042 then +3 then minus 5 yields 1042, 1045, 1040). The user field is not stored inline; it is a user_sid index into the block-level StringTable, where index 0 is the empty string that signals an anonymized edit. libosmium materialises both — accumulating the deltas and dereferencing the StringTable — to hand the handler a fully reconstructed object, which is emitted as a flat row of id, type, uid, user, timestamp, version, changeset, and visible.</desc>
  <defs>
    <marker id="metaArr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- Column 1: PrimitiveBlock -->
  <rect x="14" y="40" width="210" height="320" rx="6" fill="currentColor" fill-opacity="0.04" stroke="currentColor" stroke-width="1.5"/>
  <text x="119" y="60" text-anchor="middle" font-size="13" fill="currentColor" font-weight="bold">PrimitiveBlock</text>
  <rect x="30" y="74" width="178" height="58" rx="4" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.25"/>
  <text x="119" y="93" text-anchor="middle" font-size="12" fill="currentColor">StringTable</text>
  <text x="119" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">[0] = &#34;&#34; &#8226; [1] = &#34;alice&#34;</text>
  <text x="119" y="124" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">[2] = &#34;bob&#34; &#8230;</text>
  <rect x="30" y="148" width="178" height="88" rx="4" fill="none" stroke="currentColor" stroke-width="1.25"/>
  <text x="119" y="167" text-anchor="middle" font-size="12" fill="currentColor">DenseInfo</text>
  <text x="119" y="183" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">dense nodes</text>
  <text x="119" y="203" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">uid &#8226; version</text>
  <text x="119" y="218" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">timestamp &#8226; changeset</text>
  <text x="119" y="231" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">(delta-encoded)</text>
  <rect x="30" y="252" width="178" height="88" rx="4" fill="none" stroke="currentColor" stroke-width="1.25"/>
  <text x="119" y="271" text-anchor="middle" font-size="12" fill="currentColor">Info (per element)</text>
  <text x="119" y="287" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.75">ways &#8226; relations</text>
  <text x="119" y="307" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">uid &#8226; version</text>
  <text x="119" y="322" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">timestamp &#8226; changeset</text>
  <text x="119" y="335" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">(delta-encoded)</text>
  <!-- Column 2: decode operations -->
  <text x="380" y="60" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.7">libosmium materialises</text>
  <rect x="270" y="82" width="220" height="96" rx="6" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1.5"/>
  <text x="380" y="101" text-anchor="middle" font-size="12" fill="currentColor" font-weight="bold">delta accumulate</text>
  <text x="380" y="122" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">uid: 1042</text>
  <text x="380" y="139" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">&#8594; +3 &#8594; 1045</text>
  <text x="380" y="156" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">&#8594; &#8722;5 &#8594; 1040</text>
  <text x="380" y="171" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">running value per element</text>
  <rect x="270" y="206" width="220" height="80" rx="6" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1.5"/>
  <text x="380" y="225" text-anchor="middle" font-size="12" fill="currentColor" font-weight="bold">StringTable lookup</text>
  <text x="380" y="246" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">user_sid = 1 &#8594; &#34;alice&#34;</text>
  <text x="380" y="263" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">user_sid = 0 &#8594; &#34;&#34;</text>
  <text x="380" y="278" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">index 0 = anonymized edit</text>
  <!-- arrows block -> decode -->
  <line x1="208" y1="192" x2="268" y2="130" stroke="currentColor" stroke-width="1.25" marker-end="url(#metaArr)" opacity="0.8"/>
  <line x1="208" y1="296" x2="268" y2="130" stroke="currentColor" stroke-width="1.25" marker-end="url(#metaArr)" opacity="0.8"/>
  <line x1="208" y1="103" x2="268" y2="240" stroke="currentColor" stroke-width="1.25" marker-end="url(#metaArr)" opacity="0.8"/>
  <!-- Column 3: flat output row -->
  <line x1="490" y1="130" x2="556" y2="200" stroke="currentColor" stroke-width="1.25" marker-end="url(#metaArr)" opacity="0.8"/>
  <line x1="490" y1="246" x2="556" y2="200" stroke="currentColor" stroke-width="1.25" marker-end="url(#metaArr)" opacity="0.8"/>
  <text x="673" y="60" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.7">flat output row</text>
  <g font-size="10.5" fill="currentColor">
    <rect x="560" y="74" width="186" height="28" rx="3" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1"/>
    <text x="572" y="92" fill="currentColor" opacity="0.7">id</text>
    <text x="734" y="92" text-anchor="end" fill="currentColor">240109189</text>
    <rect x="560" y="102" width="186" height="28" rx="3" fill="none" stroke="currentColor" stroke-width="1"/>
    <text x="572" y="120" fill="currentColor" opacity="0.7">type</text>
    <text x="734" y="120" text-anchor="end" fill="currentColor">node</text>
    <rect x="560" y="130" width="186" height="28" rx="3" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1"/>
    <text x="572" y="148" fill="currentColor" opacity="0.7">uid</text>
    <text x="734" y="148" text-anchor="end" fill="currentColor">1040</text>
    <rect x="560" y="158" width="186" height="28" rx="3" fill="none" stroke="currentColor" stroke-width="1"/>
    <text x="572" y="176" fill="currentColor" opacity="0.7">user</text>
    <text x="734" y="176" text-anchor="end" fill="currentColor">alice</text>
    <rect x="560" y="186" width="186" height="28" rx="3" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1"/>
    <text x="572" y="204" fill="currentColor" opacity="0.7">timestamp</text>
    <text x="734" y="204" text-anchor="end" fill="currentColor">2026-05-01T&#8230;</text>
    <rect x="560" y="214" width="186" height="28" rx="3" fill="none" stroke="currentColor" stroke-width="1"/>
    <text x="572" y="232" fill="currentColor" opacity="0.7">version</text>
    <text x="734" y="232" text-anchor="end" fill="currentColor">7</text>
    <rect x="560" y="242" width="186" height="28" rx="3" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1"/>
    <text x="572" y="260" fill="currentColor" opacity="0.7">changeset</text>
    <text x="734" y="260" text-anchor="end" fill="currentColor">158204771</text>
    <rect x="560" y="270" width="186" height="28" rx="3" fill="none" stroke="currentColor" stroke-width="1"/>
    <text x="572" y="288" fill="currentColor" opacity="0.7">visible</text>
    <text x="734" y="288" text-anchor="end" fill="currentColor">true</text>
  </g>
</svg>

## Runnable solution

The handler streams every primitive through `pyosmium`, captures the six provenance fields plus the element id and type, normalizes timestamps to ISO 8601 UTC, maps anonymized edits to a sentinel, and writes batched rows to CSV so memory stays flat regardless of file size.

```python
import csv
import logging
import sys
from contextlib import closing

import osmium

logger = logging.getLogger("osm.metadata")

CSV_HEADER = ["id", "type", "uid", "user", "timestamp", "version", "changeset", "visible"]


class MetadataExtractor(osmium.SimpleHandler):
    """Stream provenance metadata from an OSM PBF/XML extract into a CSV file.

    pyosmium resolves PBF delta encoding and StringTable offsets internally,
    so the handler only captures the materialised attributes for each
    primitive. Run apply_file with locations=False so no coordinate index is
    built — metadata needs no geometry, and the index is what would otherwise
    blow memory on a planet-scale file.
    """

    def __init__(self, csv_file, batch_size: int = 150_000):
        super().__init__()
        self.writer = csv.writer(csv_file)
        self.writer.writerow(CSV_HEADER)
        self._file = csv_file
        self.batch_size = batch_size
        self.buffer: list[list] = []
        self.processed = 0

    def _flush_buffer(self) -> None:
        if not self.buffer:
            return
        self.writer.writerows(self.buffer)
        self._file.flush()
        self.buffer.clear()

    def _extract_meta(self, obj_type: str, obj_id: int, obj) -> None:
        ts = obj.timestamp
        uid = obj.uid
        # uid == 0 is the canonical signal for an anonymized / redacted edit.
        user = obj.user if uid != 0 else "anonymous"
        self.buffer.append([
            obj_id,
            obj_type,
            uid,
            user,
            ts.isoformat() if ts is not None else "",   # ISO 8601, UTC
            obj.version,
            obj.changeset,
            obj.visible,
        ])
        self.processed += 1
        if len(self.buffer) >= self.batch_size:
            self._flush_buffer()

    def node(self, n) -> None:
        self._extract_meta("node", n.id, n)

    def way(self, w) -> None:
        self._extract_meta("way", w.id, w)

    def relation(self, r) -> None:
        self._extract_meta("relation", r.id, r)


def extract(input_pbf: str, output_csv: str) -> int:
    """Extract metadata from input_pbf into output_csv; return primitive count."""
    with closing(open(output_csv, "w", encoding="utf-8", newline="")) as fh:
        handler = MetadataExtractor(fh)
        # locations=False => no location index is created, saving tens of GB.
        handler.apply_file(input_pbf, locations=False)
        handler._flush_buffer()
    logger.info("Extraction complete: %d primitives -> %s", handler.processed, output_csv)
    return handler.processed


if __name__ == "__main__":
    # Requires: pyosmium>=3.6.0, Python 3.10+
    # Usage: python extract_osm_meta.py planet-latest.osm.pbf osm_metadata.csv
    logging.basicConfig(level=logging.INFO)
    extract(sys.argv[1], sys.argv[2])
```

## Step-by-step walkthrough

1. **`SimpleHandler` subclass** — `pyosmium` calls `node`, `way`, and `relation` once per primitive as it streams the file. You never hold more than one element at a time, so the file size is irrelevant to memory.
2. **`locations=False`** — passed to `apply_file`, this disables the coordinate location cache. Metadata carries no geometry, so skipping the index drops peak memory from tens of gigabytes to roughly 1–2 GB on the full planet.
3. **`_extract_meta` capture** — each callback forwards `(type, id, obj)` to one shared method that reads the six provenance fields directly off the materialised object; the delta decoding and `StringTable` lookup already happened inside libosmium.
4. **Anonymized fallback** — `uid == 0` is the canonical marker for a redacted or anonymous edit, so `user` is replaced with the `"anonymous"` sentinel rather than emitting an empty cell that downstream joins would mishandle.
5. **Timestamp normalization** — `obj.timestamp` is a timezone-aware datetime; `isoformat()` yields an unambiguous UTC ISO 8601 string, and a `None` timestamp (possible in stripped extracts) degrades to an empty field instead of raising.
6. **Batched writes** — rows accumulate in `self.buffer` and flush every `batch_size` primitives, amortizing I/O while keeping the live buffer bounded; the final partial batch is flushed after `apply_file` returns.
7. **`visible` semantics** — the field is always `True` in regular planet files (deleted elements are absent), and only varies in historical `.osh.pbf` files where deletions are recorded as `visible=False`.

## Verification

Confirm the output is correct before feeding it into an attribution or analytics pipeline:

- **Row count.** The logged `processed` count must equal the sum of nodes, ways, and relations reported by `osmium fileinfo -e planet-latest.osm.pbf` — a shortfall means callbacks were silently skipped.
- **Header and arity.** Every output row has exactly eight columns; a ragged row signals a field that came back `None` and was not handled.
- **Anonymized rows.** Spot-check that every row with `uid` equal to `0` carries `user` equal to `anonymous`, and that no non-zero `uid` maps to an empty user string.
- **Timestamp monotonicity per changeset.** Within a single `changeset` id, timestamps should fall inside that changeset's open/close window; gross outliers indicate a parse misalignment.
- **Version sanity.** For a current planet file every primitive has `version >= 1`; a `0` or negative version means the metadata layer was misread, not merely absent.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Memory climbs to tens of GB and OOM-kills | Coordinate location index built by default | Pass `locations=False` to `apply_file`. |
| `RuntimeError` partway through the parse | Corrupted `Blob` or truncated `PrimitiveBlock` | Run `osmium fileinfo -e file.pbf` first; re-download if it errors. |
| All `user` cells empty, `uid` all `0` | Anonymized or metadata-stripped extract | Expected — map to the `"anonymous"` sentinel as shown. |
| `visible` is `True` for every row | Reading a regular planet file, not a history file | Use a `.osh.pbf` history extract if you need deletions. |
| `AttributeError` on `obj.timestamp` | `pyosmium` older than 3.x API | Upgrade to `osmium>=3.6.0`. |
| Garbage values from a hand-rolled regex parser | Metadata is delta-encoded against the `StringTable`, not plain text | Decode through `pyosmium`, never scan the raw bytes. |

For very large deployments, swap the CSV writer for an Apache Parquet writer via `pyarrow`: columnar storage cuts the on-disk footprint by roughly 60–70% versus CSV and preserves predicate-pushdown query performance for downstream contributor analytics. Tag-based attribution (`source=*`, `attribution=*`, `license=*`) is a separate concern handled when you apply the conventions in the [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/) and cross-reference the OSM API `/api/0.6/changeset/{id}` endpoint.

## Specification reference

> In PBF, element metadata lives in the optional `Info` message (ways, relations) and the `DenseInfo` message (dense nodes), defined in `osmformat.proto`. Each of `version`, `timestamp`, `changeset`, and `uid` is delta-encoded within a `PrimitiveGroup`, and `user_sid` indexes the block-level `StringTable`. When metadata is omitted, `uid` is `0` and the user string index points at the empty entry. See the OSM Wiki [PBF Format](https://wiki.openstreetmap.org/wiki/PBF_Format) specification and the upstream [`osmformat.proto`](https://github.com/openstreetmap/OSM-binary/blob/master/osmpbf/osmformat.proto) for the authoritative field definitions, and the [pyosmium documentation](https://docs.osmcode.org/pyosmium/latest/) for the handler API used above.

## Frequently asked questions

<details>
<summary>Why disable the location index when extracting metadata?</summary>

The location index exists only to attach coordinates to nodes so way and relation geometry can be reconstructed. Metadata extraction reads provenance fields, never geometry, so the index is pure overhead — and on a planet file it is the single largest memory consumer. Passing `locations=False` keeps peak memory around 1–2 GB instead of tens of gigabytes.
</details>

<details>
<summary>How do I tell an anonymized edit from a missing field?</summary>

They are the same signal at the wire level: an anonymized or metadata-stripped element reports `uid == 0` and an empty user string. Treat `uid == 0` as the canonical test and substitute a sentinel such as `"anonymous"` so downstream joins and group-bys behave predictably.
</details>

<details>
<summary>Why is the visible field always true on a normal planet file?</summary>

A current planet snapshot contains only live elements; deleted primitives are simply absent, so `visible` is always `True`. The field only varies in historical `.osh.pbf` files, where each version of an element — including deletions recorded as `visible=False` — is retained.
</details>

<details>
<summary>Can I parse a planet file's metadata in parallel?</summary>

Yes, but not by seeking arbitrary byte offsets. The smallest safe split point is a PBF `Blob` boundary, so pre-tile the source with `osmium extract` and run one handler per tile; concatenate the per-tile tables afterward. The single-pass streaming handler above is already fast enough for most planet-scale metadata jobs.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Extract provenance metadata from an OSM PBF planet file",
  "description": "Stream uid, user, timestamp, version, changeset, and visible fields out of a multi-gigabyte OSM PBF file with pyosmium at bounded memory, with anonymized-edit fallbacks and batched output.",
  "step": [
    { "@type": "HowToStep", "name": "Pre-validate the file", "text": "Run osmium fileinfo -e on the PBF to confirm block integrity and obtain the expected node, way, and relation counts before parsing." },
    { "@type": "HowToStep", "name": "Subclass SimpleHandler", "text": "Implement node, way, and relation callbacks that forward each primitive to a shared method which reads the six provenance fields off the materialised object." },
    { "@type": "HowToStep", "name": "Disable the location index", "text": "Call apply_file with locations=False so no coordinate cache is built, keeping peak memory near 1-2 GB on a planet-scale file." },
    { "@type": "HowToStep", "name": "Handle anonymized edits", "text": "Treat uid == 0 as the canonical anonymized signal and substitute an 'anonymous' sentinel for the empty user string." },
    { "@type": "HowToStep", "name": "Batch and write output", "text": "Accumulate rows and flush every batch_size primitives to CSV or Parquet, flushing the final partial batch after apply_file returns." }
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
      "name": "Why disable the location index when extracting metadata?",
      "acceptedAnswer": { "@type": "Answer", "text": "The location index exists only to attach coordinates to nodes so way and relation geometry can be reconstructed. Metadata extraction reads provenance fields, never geometry, so the index is pure overhead and on a planet file it is the largest memory consumer. Passing locations=False keeps peak memory around 1-2 GB instead of tens of gigabytes." }
    },
    {
      "@type": "Question",
      "name": "How do I tell an anonymized edit from a missing field?",
      "acceptedAnswer": { "@type": "Answer", "text": "They are the same signal at the wire level: an anonymized or metadata-stripped element reports uid == 0 and an empty user string. Treat uid == 0 as the canonical test and substitute a sentinel such as 'anonymous' so downstream joins behave predictably." }
    },
    {
      "@type": "Question",
      "name": "Why is the visible field always true on a normal planet file?",
      "acceptedAnswer": { "@type": "Answer", "text": "A current planet snapshot contains only live elements; deleted primitives are absent, so visible is always True. The field only varies in historical .osh.pbf files, where each version of an element including deletions recorded as visible=False is retained." }
    },
    {
      "@type": "Question",
      "name": "Can I parse a planet file's metadata in parallel?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes, but not by seeking arbitrary byte offsets. The smallest safe split point is a PBF Blob boundary, so pre-tile the source with osmium extract and run one handler per tile, concatenating the per-tile tables afterward. The single-pass streaming handler is already fast enough for most planet-scale metadata jobs." }
    }
  ]
}
</script>

## Related

- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — how `DenseInfo`, `Info`, and the `StringTable` encode the fields this handler reads.
- [How to Decode OSM PBF Headers in Python](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/how-to-decode-osm-pbf-headers-in-python/) — validate `required_features` and replication state before streaming data blocks.
- [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — the three primitive types each metadata row is keyed against.
- [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/) — why the binary format, not XML, is the practical source for planet-scale extraction.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — triage corrupted blocks and quarantine bad records at scale.
- [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/) — the foundation this extraction stage sits within.

Up one level: [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/).
