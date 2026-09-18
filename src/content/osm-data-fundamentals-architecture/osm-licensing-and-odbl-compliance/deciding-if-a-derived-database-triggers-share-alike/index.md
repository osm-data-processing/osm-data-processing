---
title: "Deciding if a Derived Database Triggers Share-Alike"
description: "Work through the produced work, derived database and collective database distinction on a real output, and record the reasoning where a reviewer will find it later."
pageTitle: "Is Your OSM Output a Derived Database? A Decision Procedure"
pageDescription: "Classify a pipeline output as a produced work, a derived database or a collective database by asking what is distributed and whether the datasets are combined, then record the reasoning."
slug: deciding-if-a-derived-database-triggers-share-alike
type: article
breadcrumb: "Share-Alike Decision"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Deciding if a Derived Database Triggers Share-Alike

The question is not abstract and does not need a lawyer to answer in the ordinary case. It needs four facts about what you are actually shipping, applied in order, and written down where somebody can check them in three years.

## Prerequisites

- [ ] The vocabulary from [OSM Licensing & ODbL Compliance](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/): produced work, derived database, collective database.
- [ ] An exact description of what is distributed, in the form a recipient receives it.
- [ ] The licence terms of any non-OSM dataset involved.
- [ ] Somewhere durable to record the classification and its reasoning.
- [ ] Access to a lawyer for the genuinely unusual case; this page is for the ordinary ones.

## Conceptual minimum

The classification turns on four facts, asked in order because each one can end the enquiry.

**Is anything distributed at all?** Internal use creates no distribution obligation. A surprising share of pipelines that agonise over this turn out to publish nothing.

**Can a recipient get data out?** If what they receive is an image, a report or a rendered raster, they cannot — it is a produced work, attribution applies, share-alike does not. If they can query, extract or reconstruct features, it is a database.

**Is OSM data combined with the other data, or merely packaged alongside it?** Combined means the output cannot be separated back into its parts — a joined table, a single feature carrying attributes from both. Alongside means two distinguishable datasets shipped together, which is collective and leaves the other dataset's terms alone.

**Would the other dataset's licence permit share-alike?** If the answer is no and the output is a combined derived database, the architecture must change rather than the classification.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="dds1-t dds1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dds1-t">The four questions, in the order that ends the enquiry soonest</title>
  <desc id="dds1-d">Four questions asked in sequence. The first asks whether anything is distributed externally at all, and a no ends the enquiry with no obligation beyond attribution on published outputs. The second asks whether a recipient can extract data, and a no classifies the output as a produced work needing attribution only. The third asks whether the datasets are combined or merely packaged together, and merely packaged leaves the other dataset's terms untouched. The fourth asks whether the other licence permits share-alike, and a no means the architecture must change.</desc>
  <defs><marker id="dds1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four questions, each can end it</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">distributed?</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">no: nothing owed</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">beyond attribution</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dds1-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">extractable?</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">no: produced work</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">attribution only</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dds1-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">combined?</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">no: collective</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">other terms intact</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#dds1-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">compatible?</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">no: change design</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">not the classification</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Most outputs stop at the first or second question, which is why the enquiry is far shorter in practice than its reputation suggests.</text>
</svg>
<figcaption>Only an output that reaches the fourth question needs a conversation with anybody outside the team.</figcaption>
</figure>

## Runnable solution

Classification is a decision, not a computation — but recording it as data means it can be reviewed, versioned and checked in a build.

```python
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, asdict
from enum import Enum
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.licence.classify")


class Kind(str, Enum):
    NOT_DISTRIBUTED = "not_distributed"
    PRODUCED_WORK = "produced_work"
    COLLECTIVE = "collective_database"
    DERIVED = "derived_database"


class LicenceConflict(RuntimeError):
    """A combined derived database whose other source forbids share-alike."""


@dataclass(frozen=True)
class Output:
    name: str
    distributed: bool
    recipient_can_extract_data: bool
    other_datasets: tuple[str, ...] = ()
    combined_with_other: bool = False
    other_permits_share_alike: bool | None = None
    reasoning: str = ""


@dataclass(frozen=True)
class Classification:
    output: str
    kind: Kind
    attribution_required: bool
    share_alike_required: bool
    reasoning: str


def classify(output: Output) -> Classification:
    if not output.distributed:
        return Classification(output.name, Kind.NOT_DISTRIBUTED,
                              attribution_required=True,      # on anything shown
                              share_alike_required=False,
                              reasoning="not distributed externally; attribution "
                                        "still applies to any published output")

    if not output.recipient_can_extract_data:
        return Classification(output.name, Kind.PRODUCED_WORK,
                              attribution_required=True,
                              share_alike_required=False,
                              reasoning="recipients receive a rendering, not "
                                        "extractable data")

    if output.other_datasets and not output.combined_with_other:
        return Classification(output.name, Kind.COLLECTIVE,
                              attribution_required=True,
                              share_alike_required=False,
                              reasoning="OSM data shipped alongside, not merged "
                                        "into, the other dataset(s)")

    # A distributed, extractable, combined output is a derived database.
    if output.other_datasets and output.other_permits_share_alike is False:
        raise LicenceConflict(
            f"{output.name}: combined derived database including "
            f"{', '.join(output.other_datasets)}, whose licence does not permit "
            f"share-alike. Change the architecture, not the classification.")
    if output.other_datasets and output.other_permits_share_alike is None:
        raise LicenceConflict(
            f"{output.name}: share-alike compatibility of "
            f"{', '.join(output.other_datasets)} is unknown; establish it before "
            f"distributing")

    return Classification(output.name, Kind.DERIVED,
                          attribution_required=True,
                          share_alike_required=True,
                          reasoning="distributed, extractable and derived from "
                                    "the OSM database")


def record(classifications: list[Classification], path: Path) -> None:
    """Persist the decisions so a reviewer can read them without asking."""
    path.write_text(json.dumps([asdict(c) for c in classifications],
                               indent=2, default=str), encoding="utf-8")
    for c in classifications:
        logger.info("%-28s %-20s attribution=%s share-alike=%s",
                    c.output, c.kind.value, c.attribution_required,
                    c.share_alike_required)


if __name__ == "__main__":
    outputs = [
        Output("public tile archive", distributed=True,
               recipient_can_extract_data=True,
               reasoning="vector tiles carry queryable features"),
        Output("monthly PDF report", distributed=True,
               recipient_can_extract_data=False,
               reasoning="a rendering; no feature data is recoverable"),
        Output("internal warehouse", distributed=False,
               recipient_can_extract_data=True,
               reasoning="never leaves the organisation"),
    ]
    record([classify(o) for o in outputs], Path("licence-classification.json"))
```

## Step-by-step walkthrough

1. **Ask about distribution first.** It is the cheapest question and it ends the enquiry for a large share of outputs.
2. **Define extractability from the recipient's position.** The test is what *they* can get out, not what format you used internally. A raster image rendered from a database is a produced work even though a database produced it.
3. **Treat collective packaging as a real category.** Shipping two distinguishable datasets together is materially different from merging them, and the distinction is worth preserving deliberately in the output's structure.
4. **Refuse to classify when compatibility is unknown.** An unknown answer is not a permissive one. Raising forces somebody to establish it rather than letting the pipeline proceed on an assumption.
5. **Raise on a genuine conflict.** The exception message says what to change — the architecture, not the label — because relabelling is the tempting and wrong response.
6. **Record the reasoning, not just the verdict.** In three years the verdict alone will be unexplainable, and the reasoning is what lets somebody confirm it still applies after the pipeline has changed.
7. **Persist as data.** A JSON record can be versioned, diffed when an output changes, and read by a build check that refuses to ship an unclassified artefact.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="dds2-t dds2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dds2-t">Three common outputs and where each lands</title>
  <desc id="dds2-d">Three panels. A public vector tile archive is distributed and lets recipients query features, so it is a derived database owing attribution and share-alike. A monthly report or a rendered map image is distributed but yields no extractable features, so it is a produced work owing attribution only. An internal analytics warehouse is extractable but never distributed, so no share-alike obligation arises, though attribution still applies to anything published from it.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three outputs from one pipeline, three answers</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Vector tile archive</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Distributed: yes</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Extractable: yes</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Derived database</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Attribution and share-alike</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Rendered report</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Distributed: yes</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Extractable: no</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Produced work</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Attribution only</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Internal warehouse</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Distributed: no</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Extractable: yes</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">No distribution</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Attribution on outputs</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">One pipeline routinely produces all three, which is why the classification belongs per output rather than per project.</text>
</svg>
<figcaption>Classifying a project rather than each of its outputs is how a tile archive inherits a report's conclusion.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="dds3-t dds3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="dds3-t">The same underlying data, distributed four ways, with four different answers</title>
  <desc id="dds3-d">A grid of four distribution forms for one enriched dataset against their classification and obligations. A rendered map image is a produced work owing attribution only. A vector tile archive is a derived database owing attribution and share-alike. A download containing the OSM part and the other dataset as separate files is a collective database, owing attribution for the OSM part and leaving the other terms alone. A single joined table containing both is a combined derived database, pulling the other dataset into share-alike.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">One dataset, four distributions, four answers</text>
  <rect x="236" y="48" width="309" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="390" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Classification</text>
  <rect x="545" y="48" width="309" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="700" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Obligation</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Rendered map image</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="390" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">produced work</text>
  <text x="700" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">attribution</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Vector tile archive</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="390" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">derived database</text>
  <text x="700" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">plus share-alike</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Two separate files</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="390" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">collective</text>
  <text x="700" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">other terms intact</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">One joined table</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="390" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">combined derived</text>
  <text x="700" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">other data pulled in</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The bottom two rows contain identical information and differ only in how it is packaged, which is what makes this an engineering decision.</text>
</svg>
<figcaption>Nothing about the data changes between the last two rows — only whether a recipient receives it already joined.</figcaption>
</figure>

## Verification

- **Every distributed artefact has a classification.** An unclassified output is a gap, and a build check can enforce that.
- **The extractability answer matches reality.** Hand an artefact to somebody and ask them to get the features out; if they can, it is a database.
- **Collective outputs really are separable.** Confirm a recipient can use the other dataset without the OSM part, and vice versa.
- **Unknown compatibility raises.** Set the other dataset's compatibility to unknown and confirm the classifier refuses.
- **The reasoning reads as evidence.** Ask a colleague to evaluate the classification from the record alone.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Whole project classified once | Classification applied per project | Classify each distributed output separately |
| Tile set treated as a produced work | Format confused with extractability | Ask what the recipient can get out, not what it looks like |
| Proprietary data pulled into share-alike | Combined rather than packaged | Keep the datasets separable in the distribution |
| Classification proceeds on an unknown | Unknown treated as permissive | Refuse to classify until compatibility is established |
| Verdict unexplainable later | Reasoning not recorded | Store the reasoning alongside the verdict |
| Relabelled to avoid a conflict | The label changed, not the design | Change the architecture; the classification follows the facts |
| New output ships unclassified | No check for classification coverage | Fail the build on any distributed artefact without a record |

## Specification reference

> The Open Database Licence distinguishes a *Derivative Database* — a database based upon the licensed database — from a *Produced Work*, defined as a work resulting from the database that is not itself a database, and from a *Collective Database*, in which the licensed database is included alongside other independent databases without being merged into them. Share-alike obligations attach to distributed derivative databases; produced works carry a notice requirement instead. See the [ODbL text](https://opendatacommons.org/licenses/odbl/1-0/) for the definitions and the [OSM legal FAQ](https://wiki.openstreetmap.org/wiki/Legal_FAQ) for the project's own reading of them.

## Frequently Asked Questions

<details>
<summary>Is a database that I only query internally distributed?</summary>

No. Distribution is what triggers the share-alike obligation, and a database that never leaves your organisation is not distributed however large or valuable it is. Attribution still applies to anything you publish from it — a chart in a public report, a map shown to customers — but the derived-database question simply does not arise. A great many pipelines that worry about this are entirely internal.
</details>

<details>
<summary>What makes an output extractable?</summary>

Whether a recipient can recover structured features from it, not what file format it uses. A vector tile archive is extractable because the features and their attributes are right there; a raster image rendered from the same data is not, because a recipient has pixels. The test is what somebody receiving the artefact can do with it, which is why the question has to be asked from their position rather than from the pipeline's.
</details>

<details>
<summary>Can I avoid share-alike by calling the output a produced work?</summary>

No, and the attempt is the single worst response available. The classification follows the facts about what is distributed, not the label applied to it, and a reviewer evaluating the question will look at the artefact rather than the documentation. If the current architecture produces a combined derived database and that is a problem, the architecture has to change — by keeping the datasets separable, by distributing renderings instead, or by not distributing.
</details>

<details>
<summary>Why record the reasoning as well as the verdict?</summary>

Because a verdict alone cannot be re-evaluated. In three years the pipeline will have changed, somebody will ask whether the classification still holds, and "derived database" tells them nothing about which facts produced that answer or which of them might have moved. Recording the reasoning turns a re-review from an investigation into a reading, and it is two sentences per output.
</details>

## Related

- [OSM Licensing & ODbL Compliance](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/) — the parent topic and the vocabulary this applies.
- [Automating ODbL Attribution in Derived Products](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/automating-odbl-attribution-in-derived-products/) — the obligation that applies whichever way this lands.
- [Recording OSM Data Provenance in a Pipeline](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/recording-osm-data-provenance-in-a-pipeline/) — the record that makes a classification checkable.
- [Attribute Enrichment from Authoritative Sources](https://www.osm-data-processing.org/osm-conflation-and-enrichment/attribute-enrichment-from-authoritative-sources/) — where combining datasets raises this question.
- [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/) — an output whose classification is regularly misjudged.

Up one level: [OSM Licensing & ODbL Compliance](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Deciding if a Derived Database Triggers Share-Alike",
  "description": "Work through the produced work, derived database and collective database distinction on a real output, and record the reasoning where a reviewer will find it later.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["derived database", "produced work", "share-alike"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Fundamentals & Architecture", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/" },
    { "@type": "ListItem", "position": 3, "name": "OSM Licensing & ODbL Compliance", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/" },
    { "@type": "ListItem", "position": 4, "name": "Deciding if a Derived Database Triggers Share-Alike", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/deciding-if-a-derived-database-triggers-share-alike/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Classify an OSM pipeline output for share-alike",
  "description": "Ask in order whether the output is distributed, whether a recipient can extract data, whether datasets are combined or merely packaged, and whether any other licence permits share-alike, then record the verdict and its reasoning.",
  "step": [
    { "@type": "HowToStep", "name": "Ask about distribution", "text": "Establish whether the output leaves the organisation at all, since internal use creates no share-alike obligation." },
    { "@type": "HowToStep", "name": "Test extractability from the recipient's side", "text": "Decide whether somebody receiving the artefact can recover structured features, rather than judging by file format." },
    { "@type": "HowToStep", "name": "Distinguish combined from packaged", "text": "Determine whether OSM data is merged with another dataset or merely shipped alongside it as separable parts." },
    { "@type": "HowToStep", "name": "Refuse on unknown compatibility", "text": "Treat an unestablished share-alike compatibility as a blocker rather than as permission to proceed." },
    { "@type": "HowToStep", "name": "Change design, not labels", "text": "Where a combined derived database conflicts with another licence, alter the architecture rather than the classification." },
    { "@type": "HowToStep", "name": "Record verdict and reasoning", "text": "Persist both as versioned data so a later reviewer can re-evaluate the decision without an investigation." }
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
      "name": "Is a database that I only query internally distributed?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. Distribution is what triggers the share-alike obligation, and a database that never leaves your organisation is not distributed however large or valuable it is. Attribution still applies to anything you publish from it, but the derived-database question simply does not arise." }
    },
    {
      "@type": "Question",
      "name": "What makes an OSM output extractable?",
      "acceptedAnswer": { "@type": "Answer", "text": "Whether a recipient can recover structured features from it, not what file format it uses. A vector tile archive is extractable because the features and attributes are right there; a raster image rendered from the same data is not. The test has to be asked from the recipient's position rather than from the pipeline's." }
    },
    {
      "@type": "Question",
      "name": "Can I avoid share-alike by calling the output a produced work?",
      "acceptedAnswer": { "@type": "Answer", "text": "No, and the attempt is the worst response available. The classification follows the facts about what is distributed, not the label applied to it, and a reviewer will look at the artefact rather than the documentation. If the architecture produces a combined derived database and that is a problem, the architecture has to change." }
    },
    {
      "@type": "Question",
      "name": "Why record the licensing reasoning as well as the verdict?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because a verdict alone cannot be re-evaluated. In three years the pipeline will have changed and somebody will ask whether the classification still holds; the verdict tells them nothing about which facts produced it. Recording the reasoning turns a re-review from an investigation into a reading, and it is two sentences per output." }
    }
  ]
}
</script>
