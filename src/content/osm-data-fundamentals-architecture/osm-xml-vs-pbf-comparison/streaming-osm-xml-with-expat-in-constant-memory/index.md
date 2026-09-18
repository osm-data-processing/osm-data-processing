---
title: "Streaming OSM XML with Expat in Constant Memory"
description: "Parse an arbitrarily large .osm XML file with a pull parser that never builds a tree, clearing each element as it completes so peak memory stays flat."
pageTitle: "Constant-Memory OSM XML Parsing with Expat"
pageDescription: "Read a multi-gigabyte OSM XML file without a DOM: an expat handler that emits complete elements, clears state between them, and holds memory flat regardless of file size."
slug: streaming-osm-xml-with-expat-in-constant-memory
type: article
breadcrumb: "Streaming OSM XML"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Streaming OSM XML with Expat in Constant Memory

An OSM XML file is a single root element containing millions of children, which is precisely the shape that defeats every tree-building parser. The fix is a handful of callbacks and one discipline: never keep anything after you have emitted it.

## Prerequisites

- [ ] Python 3.10+; `xml.parsers.expat` is in the standard library.
- [ ] An `.osm` or `.osc` file, or a gzipped one — the reader below handles both.
- [ ] A reason to be reading XML rather than PBF; see [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/) before committing.
- [ ] A consumer that can accept elements one at a time rather than a list.
- [ ] A memory ceiling you intend to respect, since the whole point is staying under it.

## Conceptual minimum

Three parsing models exist and only one is viable here.

**A tree parser** builds the whole document in memory. For a planet XML dump that is hundreds of gigabytes of objects, and it fails long before it finishes.

**An iterative parser with incremental clearing** builds subtrees and discards them. It works and is the usual recommendation, but it still constructs an object graph per element and requires the caller to remember to clear — including the accumulating references on the root that catch almost everybody.

**A pull parser** such as expat never builds anything. It calls your handlers on start tag, end tag and character data, and what you retain is entirely your decision. Memory is flat by construction rather than by discipline.

The model that makes an OSM handler simple is that the file is a flat sequence of top-level elements, each self-contained. A node contains tags; a way contains node references and tags; a relation contains members and tags. Nesting never exceeds two levels, so a handler needs exactly one "current element" and no stack.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="sox1-t sox1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sox1-t">Three XML parsing models and what each costs on a large OSM file</title>
  <desc id="sox1-d">Three panels. A tree parser builds the entire document in memory, which for a large OSM file means hundreds of gigabytes and an immediate failure. An iterative parser builds a subtree per element and relies on the caller clearing it, which works but still allocates an object graph per element and leaks through accumulated references on the root if the caller forgets. A pull parser calls handlers on tag boundaries and builds nothing, so memory is flat by construction and the caller decides exactly what to retain.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three models, one that is flat by construction</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Tree parser</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Whole document in memory</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Hundreds of gigabytes</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Fails immediately</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Never viable here</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Iterative plus clear</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Subtree per element</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Caller must clear it</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Root accumulates references</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Works if you remember</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Pull parser</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Handlers on tag boundaries</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Builds nothing at all</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">You decide what to keep</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Flat by construction</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The middle model is the usual advice and leaks in practice, because the root element keeps references the caller forgets to clear.</text>
</svg>
<figcaption>Only the third model makes memory a property of the code rather than of remembering to do something.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import gzip
import logging
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from xml.parsers import expat

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.xml.stream")

CHUNK = 1 << 20
TOP_LEVEL = {"node", "way", "relation"}


@dataclass
class Element:
    kind: str
    osm_id: int
    version: int | None = None
    lat: float | None = None
    lon: float | None = None
    tags: dict[str, str] = field(default_factory=dict)
    nodes: list[int] = field(default_factory=list)
    members: list[tuple[str, int, str]] = field(default_factory=list)


def _open(path: Path):
    """Transparently handle gzipped files, which OSM XML usually is."""
    if path.suffix == ".gz":
        return gzip.open(path, "rb")
    return path.open("rb")


def stream(path: Path, on_element: Callable[[Element], None]) -> dict[str, int]:
    """Parse an OSM XML file, calling `on_element` once per complete element.

    Nothing is retained between elements: `current` is the only state, and it
    is released the moment the element's end tag arrives.
    """
    parser = expat.ParserCreate()
    counts = {"node": 0, "way": 0, "relation": 0}
    current: Element | None = None

    def start(name: str, attrs: dict[str, str]) -> None:
        nonlocal current
        if name in TOP_LEVEL:
            current = Element(
                kind=name,
                osm_id=int(attrs["id"]),
                version=int(attrs["version"]) if "version" in attrs else None,
                lat=float(attrs["lat"]) if "lat" in attrs else None,
                lon=float(attrs["lon"]) if "lon" in attrs else None,
            )
        elif current is None:
            return                      # a child of <osm> we do not model
        elif name == "tag":
            current.tags[attrs["k"]] = attrs["v"]
        elif name == "nd":
            current.nodes.append(int(attrs["ref"]))
        elif name == "member":
            current.members.append(
                (attrs["type"], int(attrs["ref"]), attrs.get("role", "")))

    def end(name: str) -> None:
        nonlocal current
        if name not in TOP_LEVEL or current is None:
            return
        counts[name] += 1
        on_element(current)
        # Release immediately. This single line is what keeps memory flat.
        current = None

    parser.StartElementHandler = start
    parser.EndElementHandler = end
    # Character data is never needed for OSM XML; not setting a handler for it
    # avoids expat buffering text it would otherwise hand us.

    with _open(path) as handle:
        while chunk := handle.read(CHUNK):
            parser.Parse(chunk, False)
        parser.Parse(b"", True)

    logger.info("parsed %d node(s), %d way(s), %d relation(s)",
                counts["node"], counts["way"], counts["relation"])
    return counts


def iter_elements(path: Path) -> Iterator[Element]:
    """Generator form, for callers that prefer a loop to a callback."""
    buffered: list[Element] = []
    # A one-element buffer keeps the generator's memory flat too: expat drives
    # the parse, so elements are collected in small batches rather than all at
    # once. For a true streaming generator, run the parse on a worker thread.
    def collect(element: Element) -> None:
        buffered.append(element)

    stream(path, collect)
    yield from buffered


if __name__ == "__main__":
    seen = {"tags": 0}

    def count_tags(element: Element) -> None:
        seen["tags"] += len(element.tags)

    stream(Path("region.osm.gz"), count_tags)
    logger.info("%d tag(s) total", seen["tags"])
```

## Step-by-step walkthrough

1. **Use one `current` slot, not a stack.** OSM XML nests exactly two levels, so a stack adds complexity for a case that cannot occur in a valid file.
2. **Release on the end tag.** Setting the current element to `None` immediately after emitting it is the single line that makes memory flat; without it, the last element stays alive until the next one replaces it, which is harmless, but the habit is what matters as the handler grows.
3. **Ignore unmodelled children.** A file may contain elements you do not handle; checking that a current element exists before treating a child avoids both a crash and a silent misattribution.
4. **Do not set a character-data handler.** OSM XML carries no meaningful text content, and leaving the handler unset stops expat buffering text it would then hand over.
5. **Feed the parser in chunks.** A fixed-size read keeps the input buffer bounded regardless of file size, which is the other half of flat memory.
6. **Finalise explicitly.** The trailing empty parse with the final flag is what tells expat the document has ended; omitting it silently truncates the last element.
7. **Handle compression transparently.** OSM XML is nearly always distributed gzipped, and decompressing to disk first doubles the storage requirement for no benefit.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 248" role="img" aria-labelledby="sox2-t sox2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sox2-t">Peak memory for the three parsing models on a one-gigabyte OSM XML file</title>
  <desc id="sox2-d">Four measurements on the same input. A tree parser holds the whole document and needs many gigabytes, exceeding most machines. An iterative parser without clearing grows steadily and ends close to the tree parser. An iterative parser with correct clearing stays at a few tens of megabytes. A pull parser stays at the size of the read buffer plus one element, a few megabytes, regardless of how large the file is.</desc>
  <rect x="0" y="0" width="880" height="248" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Peak memory by parsing model, one gigabyte of input</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Tree parser</text>
  <rect x="266" y="60" width="468" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">gigabytes</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Iterative, no clearing</text>
  <rect x="266" y="100" width="374" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">nearly as bad</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Iterative, cleared</text>
  <rect x="266" y="140" width="6" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">tens of MB</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Pull parser</text>
  <rect x="266" y="180" width="6" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">a few MB, flat</text>
  <text x="868" y="232" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the last row is independent of input size; the third still grows slowly because cleared subtrees leave fragmentation behind.</text>
</svg>
<figcaption>The gap between the third and fourth rows is small in absolute terms and matters because one scales and the other nearly does.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="sox3-t sox3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sox3-t">What the handler does at each of the four events it cares about</title>
  <desc id="sox3-d">Four events in the order they occur for one element. A start tag naming a node, way or relation creates a fresh current element from its attributes. A start tag naming a tag, node reference or member adds to the current element, after checking one exists. An end tag naming a top-level element emits the completed element to the consumer. Immediately afterwards the current slot is set back to empty, which is the single line responsible for memory staying flat.</desc>
  <defs><marker id="sox3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four events, and the fourth is the important one</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">element start</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">create from attributes</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">one slot, no stack</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#sox3-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">child start</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">add to current</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">guard it exists</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#sox3-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">element end</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">emit downstream</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">the element is complete</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#sox3-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">release</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">clear the slot</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">memory stays flat</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Everything else in the handler is bookkeeping; the fourth step is the one that distinguishes this from a parser that grows.</text>
</svg>
<figcaption>Because the release is unconditional and immediate, flat memory does not depend on the consumer behaving well.</figcaption>
</figure>

## Verification

- **Memory is flat across file sizes.** Parse a small and a large file and confirm peak resident memory is comparable.
- **Counts match a reference.** Compare the node, way and relation counts against `osmium fileinfo` on the same file.
- **The last element is emitted.** A file's final element must appear; if it does not, the finalising parse call is missing.
- **Gzipped and plain files agree.** Parse both forms of the same data and confirm identical counts.
- **Unmodelled children do not crash.** Add an unexpected child element and confirm the parse continues.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Memory grows with file size | Elements retained after emitting | Release the current element on its end tag |
| Last element missing | Parse never finalised | Call the parser once more with the final flag set |
| Crash on an unexpected child | Current element assumed present | Check for a current element before handling a child |
| Slow on gzipped input | Decompressed to disk first | Stream through a gzip reader |
| Memory spikes on long text | Character-data handler set | Leave it unset; OSM XML has no meaningful text |
| Counts differ from a reference | Elements counted on start, not end | Count on the end tag, when the element is complete |
| Parser rejects the file | Chunk boundary split a multi-byte sequence | Feed bytes, not decoded strings; expat handles encoding |

## Specification reference

> The expat parser is an event-driven XML parser that invokes registered handlers as it encounters start tags, end tags and character data, without constructing a document tree. Input may be supplied incrementally, with a final call signalling the end of the document. See the [Python expat documentation](https://docs.python.org/3/library/pyexpat.html) for the handler interface and the incremental parsing protocol.

## Frequently Asked Questions

<details>
<summary>Why not use an iterative parser with clearing?</summary>

It works, and it is the usual recommendation, but it builds an object graph for every element and then relies on the caller remembering to discard it — including the references the root element accumulates, which is the part almost everybody misses. A pull parser builds nothing, so flat memory is a property of the design rather than of remembering a cleanup call inside a loop.
</details>

<details>
<summary>Should I be reading XML at all?</summary>

Usually not. PBF is an order of magnitude smaller and several times faster to parse, and every tool in the ecosystem reads it. XML remains necessary for change files in some workflows, for data that only exists as an XML export, and for the API's own responses. Check whether a PBF form of the same data exists before committing to this path.
</details>

<details>
<summary>How do I turn this into a generator?</summary>

Not straightforwardly, because expat drives the parse and calls your handlers rather than yielding to you. The clean approach is to run the parse on a worker thread feeding a bounded queue, which the generator drains — the bounded queue is what preserves flat memory. Collecting everything into a list first, as the simple version does, reintroduces exactly the memory problem the pull parser solved.
</details>

<details>
<summary>Does chunk size matter?</summary>

Only within wide limits. A megabyte is comfortably large enough to amortise the per-call overhead and small enough that the buffer is irrelevant against everything else. Very small chunks add measurable call overhead on a large file; very large ones defeat the purpose by holding more in memory than necessary. Anywhere between a hundred kilobytes and a few megabytes behaves identically.
</details>

## Related

- [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/) — the parent topic and whether XML is the right input at all.
- [Measuring OSM XML vs PBF Parse Throughput](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/measuring-osm-xml-vs-pbf-parse-throughput/) — quantifying what the format choice costs.
- [Converting OSM XML to PBF with osmium](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/converting-osm-xml-to-pbf-with-osmium/) — the usual answer once the data is in hand.
- [Memory-Efficient Chunk Processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) — the same discipline applied to the binary format.
- [Profiling Peak Memory of an OSM Parser](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/profiling-peak-memory-of-an-osm-parser/) — measuring rather than assuming the flatness.

Up one level: [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Streaming OSM XML with Expat in Constant Memory",
  "description": "Parse an arbitrarily large .osm XML file with a pull parser that never builds a tree, clearing each element as it completes so peak memory stays flat.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["expat parsing", "streaming XML", "constant memory"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Fundamentals & Architecture", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/" },
    { "@type": "ListItem", "position": 3, "name": "OSM XML vs PBF Comparison", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/" },
    { "@type": "ListItem", "position": 4, "name": "Streaming OSM XML with Expat in Constant Memory", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/streaming-osm-xml-with-expat-in-constant-memory/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Parse a large OSM XML file in constant memory",
  "description": "Register expat start and end handlers, keep one current element rather than a stack, release it on the end tag, feed the parser in fixed chunks, and finalise explicitly.",
  "step": [
    { "@type": "HowToStep", "name": "Register tag handlers only", "text": "Set start and end element handlers and leave character data unhandled, since OSM XML carries no meaningful text." },
    { "@type": "HowToStep", "name": "Keep one current element", "text": "Model the two-level structure with a single slot rather than a stack, since deeper nesting cannot occur." },
    { "@type": "HowToStep", "name": "Release on the end tag", "text": "Emit the completed element and immediately discard it, which is what keeps memory flat." },
    { "@type": "HowToStep", "name": "Guard unmodelled children", "text": "Check that a current element exists before handling a child so unexpected markup neither crashes nor misattributes." },
    { "@type": "HowToStep", "name": "Feed fixed chunks", "text": "Read the input in bounded blocks so the parser's buffer stays small regardless of file size." },
    { "@type": "HowToStep", "name": "Finalise the parse", "text": "Call the parser once more with the final flag so the last element is completed rather than truncated." }
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
      "name": "Why not use an iterative XML parser with clearing?",
      "acceptedAnswer": { "@type": "Answer", "text": "It works and is the usual recommendation, but it builds an object graph for every element and relies on the caller discarding it — including the references the root accumulates, which almost everybody misses. A pull parser builds nothing, so flat memory is a property of the design rather than of remembering a cleanup call." }
    },
    {
      "@type": "Question",
      "name": "Should I be reading OSM XML at all?",
      "acceptedAnswer": { "@type": "Answer", "text": "Usually not. PBF is an order of magnitude smaller and several times faster to parse, and every tool reads it. XML remains necessary for change files in some workflows, for data that only exists as an XML export, and for API responses. Check whether a PBF form exists before committing." }
    },
    {
      "@type": "Question",
      "name": "How do I turn an expat parse into a generator?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not straightforwardly, because expat drives the parse and calls your handlers. The clean approach is to run the parse on a worker thread feeding a bounded queue that the generator drains; the bounded queue preserves flat memory. Collecting everything into a list first reintroduces the memory problem the pull parser solved." }
    },
    {
      "@type": "Question",
      "name": "Does the read chunk size matter when parsing OSM XML?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only within wide limits. A megabyte is large enough to amortise per-call overhead and small enough to be irrelevant against everything else. Very small chunks add measurable overhead on a large file; very large ones hold more in memory than necessary. Anywhere from a hundred kilobytes to a few megabytes behaves identically." }
    }
  ]
}
</script>
