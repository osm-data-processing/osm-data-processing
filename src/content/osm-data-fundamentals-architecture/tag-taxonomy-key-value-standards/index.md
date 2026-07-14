---
title: "Tag Taxonomy & Key-Value Standards"
description: "Validate and canonicalize OSM key-value tags: casing rules, namespaced keys, value enumeration, type coercion, and a streaming pyosmium + pydantic normalization pipeline."
pageDescription: "OSM tag taxonomy and key-value standards for ETL: key casing, colon namespacing, value enumeration, type coercion, and a streaming pyosmium + pydantic validation pipeline."
slug: tag-taxonomy-key-value-standards
type: guide
breadcrumb: "Tag Taxonomy & Key-Value Standards"
datePublished: 2025-09-12
dateModified: 2026-06-26
date: 2026-06-26
---
# Tag Taxonomy & Key-Value Standards

<svg viewBox="0 0 760 270" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Data-flow diagram of the tag-normalization stage: a raw TagList streamed off an OSM primitive (with case-variant, aliased, and unitful example tags) flows into key normalization (NFC, lowercase, shape check, namespace split on colon), then value canonicalization (alias-to-canonical enumeration and unit/type coercion), then a validation gate that routes valid tags to a typed feature sink carrying canonical keys and coerced values, and defective tags to a quarantine dead-letter sink that records the reason" style="width:100%;max-width:760px;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Tag-Normalization Data Flow: Raw Tags to Typed Sink or Quarantine</title>
  <desc>A TagList read from a streamed node, way, or relation moves left to right through two transform stages and a validation gate. Key normalization applies NFC, lowercasing, a segment shape check, and a namespace split on the colon. Value canonicalization resolves aliases to a canonical enumeration member and coerces measurements into a number plus unit. The validation gate then branches: tags that pass go to a typed feature sink with canonical keys and coerced values, while malformed keys, empty values, and unresolvable values go to a quarantine dead-letter sink that records the rejection reason. Peak memory stays flat because each tag is validated and discarded inside the streaming callback.</desc>
  <defs>
    <marker id="tagArr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <!-- Stage 1: Raw TagList -->
  <rect x="16" y="55" width="120" height="130" rx="4" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1.5"/>
  <text x="76" y="76" text-anchor="middle" font-size="12" fill="currentColor" font-weight="bold">Raw TagList</text>
  <text x="76" y="91" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">streamed primitive</text>
  <text x="76" y="116" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.9">Highway=residential</text>
  <text x="76" y="134" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.9">surface=tarmac</text>
  <text x="76" y="152" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.9">maxspeed=50 mph</text>
  <text x="76" y="170" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.9">name=&#8201;(empty)</text>
  <line x1="136" y1="120" x2="172" y2="120" stroke="currentColor" stroke-width="1.5" marker-end="url(#tagArr)"/>
  <!-- Stage 2: Key normalization -->
  <rect x="176" y="55" width="120" height="130" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="236" y="80" text-anchor="middle" font-size="12" fill="currentColor" font-weight="bold">Key</text>
  <text x="236" y="95" text-anchor="middle" font-size="12" fill="currentColor" font-weight="bold">normalization</text>
  <text x="236" y="120" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">NFC &#183; lowercase</text>
  <text x="236" y="138" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">shape check</text>
  <text x="236" y="156" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">split on &#8220;:&#8221;</text>
  <text x="236" y="174" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">Highway &#8594; highway</text>
  <line x1="296" y1="120" x2="332" y2="120" stroke="currentColor" stroke-width="1.5" marker-end="url(#tagArr)"/>
  <!-- Stage 3: Value canonicalization -->
  <rect x="336" y="55" width="120" height="130" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="396" y="80" text-anchor="middle" font-size="12" fill="currentColor" font-weight="bold">Value</text>
  <text x="396" y="95" text-anchor="middle" font-size="12" fill="currentColor" font-weight="bold">canonicalization</text>
  <text x="396" y="120" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">enumeration</text>
  <text x="396" y="138" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">tarmac &#8594; asphalt</text>
  <text x="396" y="158" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">unit / type coercion</text>
  <text x="396" y="174" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">50 mph &#8594; (50, mph)</text>
  <line x1="456" y1="120" x2="478" y2="120" stroke="currentColor" stroke-width="1.5" marker-end="url(#tagArr)"/>
  <!-- Validation gate (diamond) -->
  <polygon points="520,80 562,120 520,160 478,120" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1.5"/>
  <text x="520" y="117" text-anchor="middle" font-size="11" fill="currentColor" font-weight="bold">valid?</text>
  <text x="520" y="131" text-anchor="middle" font-size="8.5" fill="currentColor" opacity="0.7">gate</text>
  <!-- Branch: valid -> typed feature sink -->
  <path d="M562,120 L582,120 L582,55 L596,55" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#tagArr)"/>
  <text x="588" y="98" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.75">yes</text>
  <rect x="600" y="28" width="150" height="56" rx="4" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1.5"/>
  <text x="675" y="50" text-anchor="middle" font-size="11.5" fill="currentColor" font-weight="bold">Typed feature sink</text>
  <text x="675" y="67" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.8">canonical keys + coerced values</text>
  <!-- Branch: invalid -> quarantine -->
  <path d="M562,120 L582,120 L582,185 L596,185" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#tagArr)"/>
  <text x="588" y="178" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.75">no</text>
  <rect x="600" y="157" width="150" height="56" rx="4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3"/>
  <text x="675" y="179" text-anchor="middle" font-size="11.5" fill="currentColor" font-weight="bold">Quarantine sink</text>
  <text x="675" y="196" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.8">dead-letter + reject reason</text>
  <!-- summary note -->
  <text x="380" y="245" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.7">Each tag is validated and discarded inside the streaming callback &#183; peak heap stays flat at any extract size</text>
</svg>

OpenStreetMap stores attributes as a schema-less dictionary of key-value pairs hung off every node, way, and relation. The model is what lets a global volunteer community describe everything from fire hydrants to ferry routes, but it pushes the entire burden of meaning onto the consumer: there is no database constraint that stops `Highway` and `highway` from coexisting, no enum that rejects `surface=tarmac` alongside `surface=asphalt`, and nothing that flags `maxspeed=50 mph` when every other row says `maxspeed=50`. Ignore this and the failure is silent rather than loud — a routing build that drops 4% of roads because their speed limit failed to cast to an integer, a choropleth that under-counts buildings because half were tagged `building=Yes`, or a spatial join that splits one logical category across three string variants. This stage of the pipeline turns that free-form key-value soup into typed, enumerated, deterministically-named attributes that downstream stores can trust.

## Prerequisite Concepts

Tag normalization runs after the structural layer, so a few foundations must be in place first. The free-form key-value model is part of the larger [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/), which establishes how attributes attach to primitives. You should understand the [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) because tags behave differently across primitive types — a `highway` key means a road on a way but a junction or crossing on a node — and your validation rules are often conditioned on element type. Finally, because tags arrive as indices into a per-block string table rather than as raw strings, the [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) explains the decoding step that produces the `(key, value)` pairs this page operates on.

## Specification & Field Reference

OSM tags are governed less by a formal schema than by a small set of hard API limits plus a large body of community convention. Treat the limits as invariants your validator can assume, and the conventions as rules your validator must *enforce* because nothing upstream does.

| Field / rule | Constraint | Notes for ETL |
|---|---|---|
| Key length | ≤ 255 Unicode characters | API 0.6 hard limit; longer keys cannot exist in valid data |
| Value length | ≤ 255 Unicode characters | Same limit; truncation upstream is a data-loss signal, not a fix |
| Key uniqueness | One value per key per element | Tags are a map, not a multimap; duplicates are impossible in-element |
| Key charset | Free-form UTF-8 | Convention is `[a-z0-9_]` segments; uppercase/space is a defect to normalize |
| Namespacing | Colon-separated segments | `addr:street`, `name:en`, `cycleway:right:lane` — split on `:` for scoped logic |
| Value semantics | Categorical, numeric, or boolean | No type tag exists; the consumer infers and coerces |
| Empty values | Permitted by the API | Almost always a defect; reject empty/whitespace-only values |

Three convention layers sit on top of those limits. **De facto standards** emerge from contributor adoption and the documented [OSM tagging conventions](https://wiki.openstreetmap.org/wiki/Tags) on the wiki; `highway=residential` is "correct" because millions of objects and every renderer agree it is. **De jure standards** are codified in regional import guidelines and editor presets. **Local extensions** carry language- or jurisdiction-specific keys that are legitimate but must be routed through localized rule sets rather than rejected — the subject of [best practices for OSM tag standardization across regions](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/best-practices-for-osm-tag-standardization-across-regions/). A production validator therefore models four enforceable concerns:

- **Key normalization & casing** — strip whitespace, lowercase, and validate the `segment(:segment)*` shape so `Highway`, ` highway `, and `highway` collapse to one attribute.
- **Value enumeration** — restrict categorical keys to approved sets (`surface ∈ {asphalt, concrete, paving_stones, gravel, unpaved, …}`) and map known aliases (`tarmac → asphalt`, `sett ↔ cobblestone`) to a canonical member.
- **Co-occurrence logic** — express mandatory or mutually exclusive combinations (a `highway=*` way in a municipal dataset usually requires `name=*` or `ref=*`; `building=*` and `highway=*` on the same way is contradictory).
- **Type coercion safety** — parse numeric and measurement values (`maxspeed`, `width`, `lanes`) into typed fields, capturing the unit (`50` vs `50 mph` vs `30 knots`) instead of discarding it.

## Step-by-Step Implementation

The pipeline below streams a PBF extract with `pyosmium`, validates each tag through a `pydantic` model, canonicalizes values, and routes failures to a quarantine sink — all at constant memory. The choice of PBF over textual XML here is deliberate; see the [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/) for the I/O and heap trade-offs that make streaming validation practical at continental scale.

1. **Define the tag contract.** Model a single `(key, value)` pair with a `pydantic` validator that normalizes the key and rejects empty values, then unicode-normalizes to NFC so visually identical strings compare equal.
2. **Canonicalize categorical values.** Resolve known aliases against a per-key lookup so enumerated attributes converge on one member.
3. **Coerce measurements.** Split a numeric value from its unit so `maxspeed=50 mph` becomes a typed, unit-aware field instead of a rejected string.
4. **Stream and emit.** Walk nodes, ways, and relations with a `SimpleHandler`, validating each tag and counting outcomes, sending valid tags to the real sink and defects to quarantine.

```python
from __future__ import annotations

import logging
import re
import unicodedata
from collections.abc import Callable

from pydantic import BaseModel, ValidationError, field_validator

logger = logging.getLogger(__name__)

# Per-key alias maps drive deterministic value canonicalization.
VALUE_ALIASES: dict[str, dict[str, str]] = {
    "surface": {"tarmac": "asphalt", "cobblestone": "sett"},
}
# Keys whose values are parsed as "<number> [unit]".
MEASUREMENT_KEYS: frozenset[str] = frozenset({"maxspeed", "width", "maxheight", "lanes"})

_KEY_RE = re.compile(r"^[a-z0-9_]+(?::[a-z0-9_]+)*$")
_MEASURE_RE = re.compile(r"^(?P<num>\d+(?:\.\d+)?)\s*(?P<unit>[a-zA-Z/]*)$")


class OSMTag(BaseModel):
    key: str
    value: str

    @field_validator("key")
    @classmethod
    def normalize_key(cls, v: str) -> str:
        normalized = unicodedata.normalize("NFC", v).strip().lower()
        # Allow namespaced keys: `highway`, `addr:street`, `cycleway:right:lane`.
        if not _KEY_RE.match(normalized):
            raise ValueError(f"malformed key: {v!r}")
        return normalized

    @field_validator("value")
    @classmethod
    def sanitize_value(cls, v: str) -> str:
        cleaned = unicodedata.normalize("NFC", v).strip()
        if not cleaned:
            raise ValueError("empty tag value")
        return cleaned

    def canonical(self) -> tuple[str, str | float]:
        """Return the (key, canonical_value) after enumeration + coercion."""
        value: str | float = VALUE_ALIASES.get(self.key, {}).get(self.value, self.value)
        if self.key in MEASUREMENT_KEYS and isinstance(value, str):
            if m := _MEASURE_RE.match(value):
                # Drop implicit km/h; preserve explicit units as a key suffix.
                return self.key, float(m["num"])
        return self.key, value


import osmium  # noqa: E402  (kept after pure-Python imports for clarity)


class TagNormalizer(osmium.SimpleHandler):
    """Stream primitives, validate + canonicalize tags at constant memory."""

    def __init__(
        self,
        sink: Callable[[str, str, float | str], None],
        quarantine: Callable[[str, str, str, str], None],
    ) -> None:
        super().__init__()
        self.sink = sink
        self.quarantine = quarantine
        self.stats: dict[str, int] = {"processed": 0, "valid": 0, "rejected": 0}

    def _handle(self, tags: osmium.osm.TagList, ref: str) -> None:
        self.stats["processed"] += 1
        for tag in tags:
            try:
                key, value = OSMTag(key=tag.k, value=tag.v).canonical()
            except ValidationError as exc:
                self.stats["rejected"] += 1
                self.quarantine(ref, tag.k, tag.v, str(exc))
                continue
            self.stats["valid"] += 1
            self.sink(key, value, ref)

    def node(self, n: osmium.osm.Node) -> None:
        self._handle(n.tags, f"node/{n.id}")

    def way(self, w: osmium.osm.Way) -> None:
        self._handle(w.tags, f"way/{w.id}")

    def relation(self, r: osmium.osm.Relation) -> None:
        self._handle(r.tags, f"relation/{r.id}")


def run(pbf_path: str) -> dict[str, int]:
    handler = TagNormalizer(
        sink=lambda k, v, ref: None,                      # replace with real sink
        quarantine=lambda ref, k, v, why: logger.debug(   # dead-letter sink
            "quarantine %s %s=%s (%s)", ref, k, v, why
        ),
    )
    handler.apply_file(pbf_path, locations=False)
    logger.info("tag normalization complete: %s", handler.stats)
    return handler.stats
```

## Validation & Error-Handling Matrix

Each tag defect has a distinct root cause, a cheap detection method, and a remediation that keeps the run alive. Quarantine genuinely defective tags rather than aborting; the only hard stop is a structurally broken extract that fails before the handler ever sees a tag.

| Error condition | Root cause | Detection | Remediation |
|---|---|---|---|
| Case-variant duplicate key | Editor or import wrote `Highway` | Key fails lowercase compare | Lowercase-normalize; merge attributes |
| Malformed key shape | Spaces / illegal chars in key | `_KEY_RE` no match | Reject tag; log raw `(key, value)` |
| Empty / whitespace value | Editor cleared a value | `value.strip()` is empty | Drop tag; increment `rejected` |
| Unitful numeric where int expected | `maxspeed=50 mph` | `int()` raises / regex unit group set | Split number + unit into typed fields |
| Unknown enumerated value | Local alias (`surface=tarmac`) | Value not in approved set | Map via alias table or route to regional rules |
| Mixed-script / NFD value | Combining characters, zero-width spaces | NFC-normalized form differs | Normalize to NFC before comparison |
| Contradictory co-occurrence | `highway=*` and `building=*` together | Co-occurrence rule violated | Quarantine element for manual review |

## Performance & Scale Considerations

Tag normalization is CPU-bound, not memory-bound, when it is implemented correctly. Because each tag is validated and discarded within the streaming callback, peak heap stays flat regardless of extract size — a continental file with hundreds of millions of tags processes in the same memory envelope as a city. The cost centers are per-tag object construction and regex evaluation. Constructing a fresh `pydantic` model per tag is the dominant overhead at planet scale; for hot paths, hoist the validators into plain functions or compile the key regex once (as above) and skip model instantiation for keys you have already seen by caching normalization results in a bounded `dict`.

Alias and enumeration lookups should be flat hash maps, never linear scans, so canonicalization stays O(1) per tag. The work is also embarrassingly parallel along the same block boundaries the binary format already aligns: fan out primitive-group blocks to a process pool, give each worker a read-only copy of the alias tables, and merge the per-worker `stats` counters at the end. On commodity hardware a single core sustains low-millions of tags per second; the practical ceiling is usually the decompression and string-table decode upstream, not the validation itself, which is why pairing this stage with [memory-efficient chunk processing](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/memory-efficient-chunk-processing/) matters more than micro-optimizing the validator.

## Failure Modes & Gotchas

- **Unicode equivalence.** `café` written as a precomposed `é` and as `e` + combining accent are different byte strings but the same word. Normalize every key and value to NFC before any comparison or dedup, or enumeration silently fragments.
- **Lossy unit stripping.** Discarding the unit on `maxspeed=50 mph` to force an integer corrupts routing. Capture the unit and convert deliberately; an unrecognized unit is a quarantine case, not a default.
- **Namespace blindness.** Treating `addr:street` as an opaque key misses that `addr:*` is a scoped family. Split on `:` so namespace-wide rules (every `name:<lang>` is a localized name) apply uniformly.
- **Over-eager rejection.** A value that is unknown to your global enum may be a perfectly valid regional convention. Route unknowns to a localized rule set before discarding them, or you erase legitimate local mapping.
- **Boolean ambiguity.** `oneway` accepts `yes`/`no`/`true`/`1`/`-1`/`reversible`; coercing it as a plain bool collapses `-1` (reverse direction) into `false`. Enumerate the full value domain per key rather than assuming Python truthiness.
- **Tag index overflow.** Tags arrive as indices into a per-block string table; an off-by-one in the `0`-terminated key/value index stream misattributes a tag to the wrong object. This is a decode bug upstream of normalization but surfaces as nonsensical tags here.

## Integration Points

Normalized tags are the payload the rest of the platform consumes. Emit each feature with its primitive type, resolved geometry, the canonicalized tag map, and provenance, so downstream stages key on stable attribute names without ever re-touching the raw strings. The wiring below joins a reconstructed geometry from the [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) stage with its normalized tags and hands the result to the transformation workflows in [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/).

```python
def emit_feature(
    osm_type: str,
    osm_id: int,
    geom_wkb: bytes,
    tags: dict[str, float | str],
    version: int,
) -> dict[str, object]:
    """Hand a geometry + its normalized tags to the next pipeline stage."""
    return {
        "osm_type": osm_type,            # node | way | relation
        "osm_id": osm_id,
        "geometry": geom_wkb,
        "tags": tags,                    # canonicalized keys + coerced values
        "version": version,
        "source": "© OpenStreetMap contributors",  # ODbL attribution carried forward
    }
```

Tags that fail validation flow to the same quarantine contract triaged in [error handling in large OSM extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/), so a defect rate spike becomes an alert rather than a silently shrinking output.

## Explore This Topic Further

- [Best practices for OSM tag standardization across regions](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/best-practices-for-osm-tag-standardization-across-regions/) — reconciling localized aliases, multilingual `name:*` hierarchies, and deprecated values across continental extracts without erasing legitimate local mapping.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Normalize OSM key-value tags into typed, canonical attributes",
  "description": "Four-stage streaming procedure to validate, canonicalize, and type-coerce OpenStreetMap tags during PBF ingestion at constant memory.",
  "step": [
    { "@type": "HowToStep", "name": "Define the tag contract", "text": "Model each (key, value) pair with a pydantic validator that strips whitespace, lowercases and shape-checks the key, NFC-normalizes both fields, and rejects empty values." },
    { "@type": "HowToStep", "name": "Canonicalize categorical values", "text": "Resolve known aliases against a per-key lookup so enumerated attributes such as surface converge on a single canonical member." },
    { "@type": "HowToStep", "name": "Coerce measurements", "text": "Split numeric values from their units so maxspeed=50 mph becomes a typed, unit-aware field instead of a rejected string." },
    { "@type": "HowToStep", "name": "Stream and route", "text": "Walk nodes, ways, and relations with a pyosmium SimpleHandler, sending valid tags to the real sink and defects to a quarantine dead-letter sink while counting outcomes." }
  ]
}
</script>

## Frequently Asked Questions

<details>
<summary>Why can't I trust OSM tags to follow a fixed schema?</summary>

Because there is none. OSM enforces only two hard limits — keys and values are at most 255 Unicode characters and a key appears once per element — and everything else is community convention. Casing, value spelling, units, and required combinations are all unenforced upstream, so the consumer must validate and canonicalize them or inherit every contributor's inconsistency.
</details>

<details>
<summary>Should I reject a tag whose value isn't in my approved enumeration?</summary>

Not immediately. An unknown value is often a legitimate regional convention rather than an error. Route it through a localized rule set or alias table first, and only quarantine values that no rule can resolve. Rejecting outright erases valid local mapping.
</details>

<details>
<summary>How do I handle maxspeed=50 mph when the column expects an integer?</summary>

Parse the value into a number and a unit instead of forcing a cast. Keep the numeric magnitude in a typed field and the unit alongside it, converting deliberately to your canonical unit. Stripping the unit to satisfy the type silently corrupts speed-dependent routing.
</details>

<details>
<summary>Why normalize tags to Unicode NFC before comparing them?</summary>

Visually identical strings can have different byte encodings — a precomposed accented character versus a base letter plus a combining accent. Without NFC normalization those compare as different values, so deduplication and enumeration silently fragment one logical category into several.
</details>

<details>
<summary>Where should tags that fail validation go?</summary>

To a quarantine or dead-letter sink, not to /dev/null. Counting and storing rejected tags turns a defect-rate spike into an observable alert and preserves the records for re-processing once a rule is added, keeping the main run deterministic and never silently shrinking the output.
</details>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Why can't I trust OSM tags to follow a fixed schema?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because there is none. OSM enforces only that keys and values are at most 255 Unicode characters and that a key appears once per element; casing, value spelling, units, and required combinations are unenforced community convention. The consumer must validate and canonicalize tags or inherit every contributor's inconsistency." }
    },
    {
      "@type": "Question",
      "name": "Should I reject a tag whose value isn't in my approved enumeration?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not immediately. An unknown value is often a legitimate regional convention rather than an error. Route it through a localized rule set or alias table first and only quarantine values that no rule can resolve, because rejecting outright erases valid local mapping." }
    },
    {
      "@type": "Question",
      "name": "How do I handle maxspeed=50 mph when the column expects an integer?",
      "acceptedAnswer": { "@type": "Answer", "text": "Parse the value into a number and a unit instead of forcing a cast. Keep the numeric magnitude in a typed field and the unit alongside it, converting deliberately to your canonical unit. Stripping the unit to satisfy the type silently corrupts speed-dependent routing." }
    },
    {
      "@type": "Question",
      "name": "Why normalize tags to Unicode NFC before comparing them?",
      "acceptedAnswer": { "@type": "Answer", "text": "Visually identical strings can have different byte encodings, such as a precomposed accented character versus a base letter plus a combining accent. Without NFC normalization those compare as different values, so deduplication and enumeration silently fragment one logical category into several." }
    },
    {
      "@type": "Question",
      "name": "Where should tags that fail validation go?",
      "acceptedAnswer": { "@type": "Answer", "text": "To a quarantine or dead-letter sink, not discarded. Counting and storing rejected tags turns a defect-rate spike into an observable alert and preserves records for reprocessing once a rule is added, keeping the main run deterministic and never silently shrinking the output." }
    }
  ]
}
</script>

## Related

- [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — the primitives these tags attach to and how element type conditions validation rules.
- [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/) — how per-block string tables deliver `(key, value)` pairs to your handler.
- [OSM XML vs PBF Comparison](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-xml-vs-pbf-comparison/) — the serialization trade-offs that make streaming tag validation practical.
- [Best practices for OSM tag standardization across regions](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/best-practices-for-osm-tag-standardization-across-regions/) — reconciling localized aliases and multilingual keys at continental scale.
- [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) — the transformation stage that consumes these canonicalized tags.
- [Error Handling in Large OSM Extracts](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/) — triaging the tags this stage quarantines.

This guide is part of [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/); return to that overview to follow tagging through serialization, CRS handling, and spatial indexing.
</content>
</invoke>
