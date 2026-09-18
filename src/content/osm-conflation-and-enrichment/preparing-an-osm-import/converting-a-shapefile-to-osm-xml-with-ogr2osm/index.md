---
title: "Converting a Shapefile to OSM XML with ogr2osm"
description: "Convert an external vector dataset into uploadable OSM XML with a translation file that maps fields to locally used tags, drops what has no equivalent, and merges duplicate nodes."
pageTitle: "Shapefile to OSM XML with an ogr2osm Translation File"
pageDescription: "Write an ogr2osm translation that maps source fields onto locally used OSM tags, normalises values, drops unjustifiable fields, and produces negative-id OSM XML ready for a reviewed upload."
slug: converting-a-shapefile-to-osm-xml-with-ogr2osm
type: article
breadcrumb: "Shapefile to OSM XML"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Converting a Shapefile to OSM XML with ogr2osm

Turn an external vector file into an OSM XML document whose tags a local mapper would recognise — with the awkward decisions made in a translation file you can show somebody, rather than buried in a script.

## Prerequisites

- [ ] `ogr2osm` installed, and GDAL available for the source format.
- [ ] Established permission to import the source, per [Preparing an OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/) — the conversion is pointless without it.
- [ ] A published tag mapping agreed with the local community.
- [ ] The source's attribute schema, including which fields are populated in practice rather than merely defined.
- [ ] Python 3.10+, since the translation file is a Python module.

## Conceptual minimum

`ogr2osm` reads any format GDAL can open and emits OSM XML with **negative identifiers**, which is the convention for objects that do not yet exist on the server. The upload assigns real identifiers and reports the mapping back, exactly as described in [Uploading an OSM Changeset from Python](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/uploading-an-osm-changeset-from-python/).

The interesting part is the **translation file**: a Python module defining a class whose methods are called for each feature. `filter_tags` receives the source attributes and returns the OSM tags; `filter_feature` can reject a feature entirely; `merge_tags` decides what happens when two geometries are merged.

Two conversion behaviours matter for correctness. The tool **merges coincident nodes** by default, which is usually what you want — adjacent polygons sharing a boundary should share nodes rather than stacking duplicates — but it means the output's topology is not a straightforward copy of the source's. And it **reprojects to WGS 84**, which is required, but depends on the source declaring its projection correctly.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="cso1-t cso1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cso1-t">What happens to one source feature during conversion</title>
  <desc id="cso1-d">Four steps. The read step opens the source with GDAL and yields a feature with its attributes and geometry in the source projection. The filter step calls the translation's feature filter, which may reject the feature entirely on the basis of its attributes. The tag step calls the tag filter, which maps source fields onto OSM tags, normalises values and drops fields with no equivalent. The emit step reprojects the geometry to WGS 84, merges coincident nodes with those of neighbouring features, and writes the object with a negative identifier.</desc>
  <defs><marker id="cso1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Read, reject, retag, emit</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">read</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">GDAL, source CRS</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">attributes plus geometry</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cso1-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">filter</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">reject whole features</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">before any tagging</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cso1-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">retag</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">fields to OSM tags</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">normalise and drop</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cso1-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">emit</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">reproject, merge nodes</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">negative identifiers</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Node merging happens across features, so the output's topology is a property of the whole file rather than of any single feature.</text>
</svg>
<figcaption>Rejecting a feature before tagging keeps the tag filter simple: it only ever sees features that are definitely being imported.</figcaption>
</figure>

## Runnable solution

```python
# translation.py — the file that carries every judgement in the conversion.
from __future__ import annotations

import logging
import re

import ogr2osm

logger = logging.getLogger("osm.import.translate")

# Source values -> OSM tagging, agreed with the local community and published
# in the import plan. Anything absent here is DROPPED, deliberately.
BUILDING_TYPES: dict[str, dict[str, str]] = {
    "RESIDENTIAL": {"building": "residential"},
    "COMMERCIAL": {"building": "commercial"},
    "INDUSTRIAL": {"building": "industrial"},
    "SCHOOL": {"building": "school", "amenity": "school"},
    "CHURCH": {"building": "church"},
    # "OTHER" and "UNKNOWN" are intentionally absent: building=yes is better
    # than inventing a value, and is applied as the fallback below.
}
_HOUSENUMBER = re.compile(r"^\s*(\d+[A-Za-z]?(?:\s*[-/]\s*\d+[A-Za-z]?)?)\s*$")


class BuildingTranslation(ogr2osm.TranslationBase):

    def filter_feature(self, ogrfeature, layer_fields, reproject):
        """Reject features that should not be imported at all."""
        if ogrfeature is None:
            return None
        status = (ogrfeature.GetField("STATUS") or "").upper()
        if status in {"DEMOLISHED", "PROPOSED", "PLANNED"}:
            # Not on the ground: importing it would be mapping the future.
            return None
        geometry = ogrfeature.GetGeometryRef()
        if geometry is None or geometry.IsEmpty():
            return None
        return ogrfeature

    def filter_tags(self, attrs):
        if not attrs:
            return {}
        tags: dict[str, str] = {}

        kind = (attrs.get("BLD_TYPE") or "").strip().upper()
        tags.update(BUILDING_TYPES.get(kind, {"building": "yes"}))
        if kind and kind not in BUILDING_TYPES:
            logger.debug("unmapped building type %r -> building=yes", kind)

        # Addresses: normalise, and drop anything that does not parse cleanly
        # rather than importing a malformed housenumber onto the map.
        number = (attrs.get("HOUSENUM") or "").strip()
        match = _HOUSENUMBER.match(number)
        if match:
            tags["addr:housenumber"] = match.group(1).replace(" ", "")
        elif number:
            logger.debug("dropping unparseable housenumber %r", number)

        street = (attrs.get("STREET") or "").strip()
        if street:
            # Title-casing a street name is a local decision; here the source
            # is already correctly cased and is passed through unchanged.
            tags["addr:street"] = street

        levels = (attrs.get("FLOORS") or "").strip()
        if levels.isdigit() and 1 <= int(levels) <= 200:
            tags["building:levels"] = levels

        # The source identifier is kept ONLY because it is a published public
        # reference; an internal key would be dropped here instead.
        ref = (attrs.get("PUB_REF") or "").strip()
        if ref:
            tags["ref:cadastre"] = ref

        # Provenance on every object: what it came from and when.
        tags["source"] = "City Cadastre 2026-06"
        return tags

    def merge_tags(self, geometry_type, tags_existing, tags_new):
        """Called when two geometries merge. Refuse silent conflicts."""
        merged = dict(tags_existing)
        for key, value in tags_new.items():
            if key in merged and merged[key] != value:
                logger.warning("conflicting %s: %r vs %r — keeping existing",
                               key, merged[key], value)
                continue
            merged[key] = value
        return merged
```

```bash
#!/usr/bin/env bash
set -euo pipefail

ogr2osm buildings.shp \
  --translation translation.py \
  --output buildings.osm \
  --add-version --add-timestamp \
  --positive-id=false \
  --rounding-digits 7

# Sanity: every object must be negative-id and carry a source tag.
grep -c 'id="-' buildings.osm
grep -c 'k="source"' buildings.osm
```

## Step-by-step walkthrough

1. **Reject before tagging.** `filter_feature` removes demolished and proposed structures, so the tag filter only ever sees features that are genuinely being imported.
2. **Refuse to map the future.** A cadastre's "proposed" buildings are not on the ground, and importing them puts things on the map that do not exist.
3. **Use an explicit mapping table with a safe fallback.** Unmapped types become a generic value rather than an invented one, and the unmapped case is logged so the table can be extended from evidence.
4. **Drop what does not parse.** A housenumber that does not match the expected pattern is dropped rather than imported malformed — a missing tag is far easier for a mapper to fix than a wrong one.
5. **Bound numeric values.** A floor count outside a plausible range is almost always a sentinel value in the source, and importing it produces obviously wrong data.
6. **Keep only public references.** The source identifier is retained because it is a published reference, in the established namespace. An internal key would be dropped here.
7. **Tag provenance on every object.** A source tag naming the dataset and its vintage is what lets a mapper five years later understand where a feature came from.
8. **Refuse silent conflicts on merge.** When two merging geometries disagree about a tag, the warning names it rather than letting one value quietly win.
9. **Round coordinates sensibly.** Seven decimal places is roughly centimetre precision; more is false precision that inflates the file for no benefit.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 239" role="img" aria-labelledby="cso2-t cso2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cso2-t">Three decisions in a translation file that are policy rather than code</title>
  <desc id="cso2-d">Three panels. The unmapped value decision determines what happens to a source category with no agreed OSM equivalent: a safe generic fallback is almost always better than inventing a value nobody consumes. The malformed value decision determines whether an unparseable attribute is dropped or imported as-is: dropping leaves a gap a mapper can fill, while importing creates a wrong value somebody must find first. The identifier decision determines whether the source key reaches the map at all, and only a genuinely public reference should.</desc>
  <rect x="0" y="0" width="880" height="239" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three judgements that belong in the plan, not the code</text>
  <rect x="26" y="52" width="259" height="153" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Unmapped values</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Source category, no OSM equivalent</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Invent a value, or fall back?</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Fallback is almost always right</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Log it, extend from evidence</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Never invent a key</text>
  <rect x="311" y="52" width="259" height="153" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Malformed values</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Attribute does not parse</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Import as-is, or drop?</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Dropping leaves a fixable gap</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Importing leaves a wrong value</text>
  <text x="325" y="188" font-size="10.5" fill="currentColor" opacity="0.92">A gap is easier to find</text>
  <rect x="595" y="52" width="259" height="153" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Identifiers</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Source key, public or internal?</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Public reference: keep it</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Internal key: drop it</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Once imported, hard to remove</text>
  <text x="609" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Track the mapping your side</text>
  <text x="868" y="223" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">All three answers should appear in the published import plan, because a reviewer will ask about each of them.</text>
</svg>
<figcaption>Writing these into the translation file rather than a script is what makes them reviewable by somebody who does not read Python.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="cso3-t cso3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cso3-t">Which part of the conversion each kind of decision belongs in</title>
  <desc id="cso3-d">Four layers. The command line holds operational settings such as identifier sign, coordinate rounding and whether version metadata is added. The feature filter holds decisions about whether a record should exist on the map at all. The tag filter holds the mapping from source fields to OSM tags, value validation and provenance. The merge handler holds what happens when two geometries share a boundary and disagree about a tag. A note observes that putting a policy decision in the command line hides it from review.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four places a decision can live, each with a purpose</text>
  <rect x="26" y="50" width="828" height="52" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="42" y="72" font-size="12.5" font-weight="700" fill="currentColor">Command line</text>
  <text x="42" y="90" font-size="10.5" fill="currentColor" opacity="0.88">Identifiers, rounding, metadata</text>
  <text x="838" y="82" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">operational settings</text>
  <rect x="26" y="112" width="828" height="52" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="42" y="134" font-size="12.5" font-weight="700" fill="currentColor">Feature filter</text>
  <text x="42" y="152" font-size="10.5" fill="currentColor" opacity="0.88">Should this exist on the map?</text>
  <text x="838" y="144" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">rejects whole records</text>
  <rect x="26" y="174" width="828" height="52" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="42" y="196" font-size="12.5" font-weight="700" fill="currentColor">Tag filter</text>
  <text x="42" y="214" font-size="10.5" fill="currentColor" opacity="0.88">Fields to tags, validation</text>
  <text x="838" y="206" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">where policy lives</text>
  <rect x="26" y="236" width="828" height="52" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="42" y="258" font-size="12.5" font-weight="700" fill="currentColor">Merge handler</text>
  <text x="42" y="276" font-size="10.5" fill="currentColor" opacity="0.88">Conflicts on shared geometry</text>
  <text x="838" y="268" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">warn, never guess</text>
  <text x="868" y="308" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Policy belongs in the middle two layers, where it is visible in a file a reviewer can read alongside the import plan.</text>
</svg>
<figcaption>A decision hidden in a command-line flag is one nobody will find when the import is questioned a year later.</figcaption>
</figure>

## Verification

- **Every object has a negative identifier.** A positive identifier means the output is claiming to modify existing objects rather than create new ones.
- **Every object carries provenance.** A source tag naming the dataset and vintage should be universal.
- **Rejected features really are absent.** Count features in the source with a rejecting status and confirm the output is smaller by exactly that number.
- **Coordinates are in WGS 84.** Spot-check a coordinate against a known location; a source with a mis-declared projection lands somewhere plausible but wrong.
- **No unexpected keys.** Extract the distinct keys from the output and compare against the published mapping; anything else is a leak.
- **Merge conflicts are rare.** A high conflict count means the source has inconsistent attributes on adjacent geometries, which is worth understanding before uploading.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Objects have positive identifiers | Positive identifiers enabled | Emit negative identifiers for new objects |
| Features land in the wrong place | Source projection mis-declared | Verify the source CRS before converting |
| Invented tag values on the map | No fallback for unmapped categories | Fall back to a generic value and log the gap |
| Malformed housenumbers imported | Values passed through unvalidated | Validate and drop what does not parse |
| Duplicate nodes along boundaries | Node merging disabled | Leave coincident-node merging enabled |
| Internal identifiers on the map | Source key mapped without justification | Keep only genuinely public references |
| File enormous for the feature count | Excessive coordinate precision | Round to about seven decimal places |

## Specification reference

> `ogr2osm` converts any OGR-readable data source into OSM XML, applying a translation supplied as a Python module that subclasses the translation base class. `filter_feature` may reject a feature, `filter_tags` maps source attributes to OSM tags, and `merge_tags` resolves tagging when geometries are merged. Output objects are given negative identifiers to indicate that they do not yet exist on the server. See the [ogr2osm documentation](https://github.com/roelderickx/ogr2osm) for the translation interface and the command-line options.

## Frequently Asked Questions

<details>
<summary>Why negative identifiers?</summary>

Because they mark objects as new. In an upload document a negative identifier is a placeholder: the server assigns a real identifier on creation and returns the mapping. A positive identifier would instead claim to refer to an existing object, which either fails as a version conflict or, worse, succeeds against an unrelated object. Emitting negative identifiers is the convention and the default, and confirming it in the output is a one-line check worth doing.
</details>

<details>
<summary>Should an unmapped source category become a new tag value?</summary>

Almost never. Inventing a value produces data that is technically present and consumed by nothing, and once it is on the map it is hard to remove. A generic fallback — the broad value everyone already renders — is more useful to consumers and honest about what is known. Log the unmapped categories, review them against real usage, and extend the mapping deliberately where a recognised value exists.
</details>

<details>
<summary>Is it better to drop a malformed value or import it as-is?</summary>

Drop it. A missing tag is a visible gap that any mapper can fill from local knowledge; a wrong tag looks like data and has to be discovered before it can be fixed. This is especially true for addresses, where a malformed housenumber will be consumed by geocoders and routing engines as though it were correct. Log what you dropped so the source's data-quality problems are visible.
</details>

<details>
<summary>What does node merging actually do?</summary>

It makes geometries that share a coordinate share a node rather than each carrying its own. For adjacent polygons — building blocks, land parcels — that is correct and important: without it every shared boundary is duplicated, doubling the node count and leaving the map topologically wrong. It does mean the output's topology depends on the whole file rather than on any single feature, which is worth remembering when comparing counts against the source.
</details>

## Related

- [Preparing an OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/) — the parent topic and the permission this conversion assumes.
- [Deduplicating Addresses Before an OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/deduplicating-addresses-before-an-osm-import/) — the step that decides which of these objects are uploaded.
- [Uploading an OSM Changeset from Python](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/uploading-an-osm-changeset-from-python/) — what consumes the negative identifiers.
- [Mapping OSM Tags to a Fixed Schema with YAML](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/mapping-osm-tags-to-a-fixed-schema-with-yaml/) — the same mapping discipline in the other direction.
- [Fixing Malformed OSM Tags During ETL Ingestion](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/fixing-malformed-osm-tags-during-etl-ingestion/) — validating values before they reach a sink.

Up one level: [Preparing an OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Converting a Shapefile to OSM XML with ogr2osm",
  "description": "Convert an external vector dataset into uploadable OSM XML with a translation file that maps fields to locally used tags, drops what has no equivalent, and merges duplicate nodes.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Conflation & Data Enrichment",
  "about": ["ogr2osm", "OSM XML conversion", "tag translation"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Conflation & Data Enrichment", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/" },
    { "@type": "ListItem", "position": 3, "name": "Preparing an OSM Import", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/" },
    { "@type": "ListItem", "position": 4, "name": "Converting a Shapefile to OSM XML with ogr2osm", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/converting-a-shapefile-to-osm-xml-with-ogr2osm/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Convert an external vector dataset into OSM XML",
  "description": "Write a translation that rejects features before tagging, maps categories through an explicit table with a safe fallback, drops unparseable values, keeps only public references, and tags provenance.",
  "step": [
    { "@type": "HowToStep", "name": "Reject before tagging", "text": "Use the feature filter to remove records that should not be imported at all, such as demolished or proposed structures." },
    { "@type": "HowToStep", "name": "Map through an explicit table", "text": "Translate source categories with a published mapping and fall back to a generic value for anything unmapped, logging the gap." },
    { "@type": "HowToStep", "name": "Validate before emitting", "text": "Parse and bound attribute values, dropping anything malformed rather than importing a wrong value onto the map." },
    { "@type": "HowToStep", "name": "Keep only public references", "text": "Retain the source identifier only when it is a genuinely public reference, in the established namespace." },
    { "@type": "HowToStep", "name": "Tag provenance", "text": "Add a source tag naming the dataset and its vintage to every emitted object." },
    { "@type": "HowToStep", "name": "Resolve merges loudly", "text": "Warn rather than silently choosing when two merging geometries disagree about a tag value." },
    { "@type": "HowToStep", "name": "Check the output", "text": "Confirm negative identifiers, universal provenance, correct reprojection and no keys outside the published mapping." }
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
      "name": "Why do imported OSM objects use negative identifiers?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because they mark objects as new. In an upload document a negative identifier is a placeholder: the server assigns a real identifier on creation and returns the mapping. A positive identifier would instead claim to refer to an existing object, which either fails as a version conflict or succeeds against an unrelated object." }
    },
    {
      "@type": "Question",
      "name": "Should an unmapped source category become a new OSM tag value?",
      "acceptedAnswer": { "@type": "Answer", "text": "Almost never. Inventing a value produces data that is technically present and consumed by nothing, and once on the map it is hard to remove. A generic fallback is more useful to consumers and honest about what is known. Log the unmapped categories and extend the mapping deliberately where a recognised value exists." }
    },
    {
      "@type": "Question",
      "name": "Is it better to drop a malformed value or import it as-is?",
      "acceptedAnswer": { "@type": "Answer", "text": "Drop it. A missing tag is a visible gap any mapper can fill; a wrong tag looks like data and has to be discovered before it can be fixed. This is especially true for addresses, where a malformed housenumber will be consumed by geocoders and routing engines as though it were correct." }
    },
    {
      "@type": "Question",
      "name": "What does coincident node merging actually do in a conversion?",
      "acceptedAnswer": { "@type": "Answer", "text": "It makes geometries that share a coordinate share a node rather than each carrying its own. For adjacent polygons that is correct and important: without it every shared boundary is duplicated, doubling the node count and leaving the map topologically wrong. It does mean the output topology depends on the whole file." }
    }
  ]
}
</script>
