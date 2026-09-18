---
title: "Auditing a Conflation Run Before Upload"
description: "Assemble an evidence pack a reviewer can check without running anything: counts by slice, representative examples across the score range, the rules in plain words, and the known weak spots."
pageTitle: "Build an Evidence Pack for a Conflation Run"
pageDescription: "Produce a reviewable audit of a conflation run — sliced counts, threshold-straddling examples, plainly stated decision rules and honest limitations — before any change reaches the map."
slug: auditing-a-conflation-run-before-upload
type: article
breadcrumb: "Auditing a Run"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Auditing a Conflation Run Before Upload

The audit is written for somebody who did not build the pipeline, does not want to run it, and has the authority to say no. Everything about its format follows from that.

## Prerequisites

- [ ] A completed conflation run with per-pair scores, components and outcomes.
- [ ] Metrics from [Measuring Conflation Precision and Recall](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/measuring-conflation-precision-and-recall/).
- [ ] Python 3.10+ with `pandas`; the output is a document, not a dashboard.
- [ ] The decision rules as written, not as implemented — thresholds, precedence and cardinality.
- [ ] Somewhere public to publish it, linked from every changeset comment.

## Conceptual minimum

An evidence pack answers four questions in the order a reviewer asks them.

**What did it do?** Counts, sliced. Not "50,000 records processed" but how many matched, how many were routed to review, how many found nothing, broken down by the slices that behave differently.

**Can I see some?** Examples. Not the twenty best ones — a sample spread across the score range, deliberately including pairs just either side of the threshold, because those show what the decision actually looks like at its boundary.

**What are the rules?** The thresholds, the precedence and the cardinality rule, stated in sentences. A reviewer should not have to read code to know what "confident" meant.

**Where is it weak?** The limitations, admitted. A pack that names its own weak spots is far more credible than one that does not, and the reviewer will find them regardless — better from you than from them.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="acr1-t acr1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="acr1-t">The four sections of an evidence pack and the question each answers</title>
  <desc id="acr1-d">Four stacked sections. The counts section answers what the run did, sliced by the dimensions that behave differently rather than reported as one total. The examples section answers whether a reviewer can see the decisions, sampled across the score range including pairs at the threshold. The rules section answers what the thresholds and precedence actually were, stated in sentences rather than as code. The limitations section answers where the run is weak, admitted openly because a reviewer will find the weak spots anyway.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four sections, in the order a reviewer asks</text>
  <rect x="26" y="50" width="828" height="52" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="42" y="72" font-size="12.5" font-weight="700" fill="currentColor">Counts</text>
  <text x="42" y="90" font-size="10.5" fill="currentColor" opacity="0.88">What did the run do?</text>
  <text x="838" y="82" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">sliced, never one total</text>
  <rect x="26" y="112" width="828" height="52" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="42" y="134" font-size="12.5" font-weight="700" fill="currentColor">Examples</text>
  <text x="42" y="152" font-size="10.5" fill="currentColor" opacity="0.88">Can I see some decisions?</text>
  <text x="838" y="144" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">across the score range</text>
  <rect x="26" y="174" width="828" height="52" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="42" y="196" font-size="12.5" font-weight="700" fill="currentColor">Rules</text>
  <text x="42" y="214" font-size="10.5" fill="currentColor" opacity="0.88">What did confident mean?</text>
  <text x="838" y="206" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">sentences, not code</text>
  <rect x="26" y="236" width="828" height="52" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="42" y="258" font-size="12.5" font-weight="700" fill="currentColor">Limitations</text>
  <text x="42" y="276" font-size="10.5" fill="currentColor" opacity="0.88">Where is this weak?</text>
  <text x="838" y="268" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">admitted, not discovered</text>
  <text x="868" y="308" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A pack that omits the last section reads as marketing, and a reviewer who finds an unmentioned weakness discounts the other three.</text>
</svg>
<figcaption>The order matters: a reviewer who cannot answer the first question never reaches the second.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import random
from dataclasses import dataclass

import pandas as pd

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.conflate.audit")

SLICES = ["density_band", "feature_class", "region"]
EXAMPLES_PER_BAND = 4
SEED = 20260917


@dataclass(frozen=True)
class Rules:
    match_floor: float
    review_floor: float
    min_gap: float
    cardinality: str
    precedence: str

    def as_sentences(self) -> list[str]:
        return [
            f"A pair is a confident match when its combined score is at least "
            f"{self.match_floor:.2f} AND it beats the next candidate by at "
            f"least {self.min_gap:.2f}.",
            f"A pair scoring between {self.review_floor:.2f} and "
            f"{self.match_floor:.2f}, or beating its runner-up by less than "
            f"{self.min_gap:.2f}, goes to human review.",
            f"Below {self.review_floor:.2f} the record is recorded as having no "
            f"match, which is an expected outcome rather than a failure.",
            f"Cardinality: {self.cardinality}.",
            f"Precedence when both sources have a value: {self.precedence}.",
        ]


def sliced_counts(pairs: pd.DataFrame) -> pd.DataFrame:
    """Counts by outcome, for the whole run and for every slice."""
    rows = []
    overall = pairs["outcome"].value_counts()
    rows.append({"slice": "ALL", "value": "ALL", **overall.to_dict()})
    for column in SLICES:
        if column not in pairs.columns:
            logger.warning("slice column %r absent; the pack will be weaker", column)
            continue
        for value, group in pairs.groupby(column):
            rows.append({"slice": column, "value": str(value),
                         **group["outcome"].value_counts().to_dict()})
    frame = pd.DataFrame(rows).fillna(0)
    numeric = [c for c in frame.columns if c not in {"slice", "value"}]
    frame[numeric] = frame[numeric].astype(int)
    frame["match_rate"] = frame.get("match", 0) / frame[numeric].sum(axis=1)
    return frame


def threshold_examples(pairs: pd.DataFrame, rules: Rules) -> pd.DataFrame:
    """Examples across the score range, weighted towards the boundary.

    Showing only high-scoring pairs proves nothing: a reviewer needs to see
    what a marginal decision looks like, because that is where errors live.
    """
    rng = random.Random(SEED)
    bands = {
        "well above": pairs[pairs["score"] >= rules.match_floor + 0.10],
        "just above": pairs[(pairs["score"] >= rules.match_floor)
                            & (pairs["score"] < rules.match_floor + 0.03)],
        "just below": pairs[(pairs["score"] < rules.match_floor)
                            & (pairs["score"] >= rules.match_floor - 0.03)],
        "small gap": pairs[(pairs["score"] >= rules.match_floor)
                           & (pairs["gap"] < rules.min_gap)],
        "no match": pairs[pairs["score"] < rules.review_floor],
    }
    chosen = []
    for band, group in bands.items():
        if group.empty:
            logger.warning("no examples in band %r", band)
            continue
        take = min(EXAMPLES_PER_BAND, len(group))
        picks = rng.sample(list(group.index), take)
        sample = group.loc[picks].copy()
        sample.insert(0, "band", band)
        chosen.append(sample)
    return pd.concat(chosen) if chosen else pd.DataFrame()


def limitations(pairs: pd.DataFrame, counts: pd.DataFrame) -> list[str]:
    """Derive the weak spots from the data rather than relying on memory."""
    notes: list[str] = []
    worst = counts[counts["slice"] != "ALL"].nsmallest(1, "match_rate")
    if not worst.empty:
        row = worst.iloc[0]
        notes.append(f"Lowest match rate is {row['match_rate']:.0%} in "
                     f"{row['slice']}={row['value']}; treat results there as weaker.")
    thin = pairs[pairs["evidence_weight"] < 0.6]
    if len(thin):
        notes.append(f"{len(thin)} pair(s) ({len(thin)/len(pairs):.1%}) were decided "
                     f"on less than 60% of the available evidence.")
    reviewed = (pairs["outcome"] == "review").sum()
    notes.append(f"{reviewed} pair(s) require human review before use; no "
                 f"automated decision was made for them.")
    return notes


def build_pack(pairs: pd.DataFrame, rules: Rules, path: str) -> None:
    counts = sliced_counts(pairs)
    examples = threshold_examples(pairs, rules)
    notes = limitations(pairs, counts)

    with open(path, "w", encoding="utf-8") as fh:
        fh.write("# Conflation run audit\n\n## Counts\n\n")
        fh.write(counts.to_markdown(index=False))
        fh.write("\n\n## Decision rules\n\n")
        for sentence in rules.as_sentences():
            fh.write(f"- {sentence}\n")
        fh.write("\n## Examples\n\n")
        fh.write(examples.to_markdown(index=False))
        fh.write("\n\n## Known limitations\n\n")
        for note in notes:
            fh.write(f"- {note}\n")
    logger.info("wrote evidence pack to %s", path)


if __name__ == "__main__":
    logger.info("publish the pack where every changeset comment can link to it")
```

## Step-by-step walkthrough

1. **Slice the counts, always.** One total tells a reviewer nothing about where the run is weak. The slices are the same ones the metrics use, so the two documents agree.
2. **Warn when a slice is missing.** A pack without the density breakdown is weaker, and saying so is better than quietly producing a thinner document.
3. **Sample examples at the boundary.** Four bands around the threshold plus one well above and one well below. A reviewer learns far more from a pair that only just qualified than from an obvious one.
4. **Fix the sampling seed.** The examples in the pack must be the same ones next time, or a reviewer returning to a question finds different data.
5. **State the rules as sentences.** Generating the prose from the same constants the pipeline uses means the document cannot drift away from the code.
6. **Derive limitations from the data.** The worst-performing slice, the share of thin-evidence decisions and the review backlog are computed rather than remembered, so they stay honest as the run changes.
7. **Write markdown, not a dashboard.** A file that can be read in a browser, linked from a changeset comment and archived is what a reviewer will actually use.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 342" role="img" aria-labelledby="acr2-t acr2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="acr2-t">What each example band shows a reviewer</title>
  <desc id="acr2-d">A grid of five example bands against what each demonstrates and why it belongs in the pack. Pairs well above the threshold show what an easy correct match looks like and set the reader's baseline. Pairs just above show what the weakest accepted decision looks like, which is where precision errors concentrate. Pairs just below show what was rejected at the margin, revealing whether the threshold is costing real matches. Pairs with a small runner-up gap show the ambiguity the gap rule exists to catch. Pairs well below show that no-match is a real and reasonable outcome.</desc>
  <rect x="0" y="0" width="880" height="342" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Five bands, five different things they prove</text>
  <rect x="176" y="48" width="339" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="346" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Shows</text>
  <rect x="515" y="48" width="339" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="684" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Why it belongs</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Well above</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="346" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">an easy correct match</text>
  <text x="684" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">sets the baseline</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Just above</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="346" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">the weakest acceptance</text>
  <text x="684" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">where errors concentrate</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Just below</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="346" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">marginal rejection</text>
  <text x="684" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">is the threshold costly?</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Small gap</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="346" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">genuine ambiguity</text>
  <text x="684" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">why the gap rule exists</text>
  <text x="30" y="289" font-size="11.5" font-weight="600" fill="currentColor">Well below</text>
  <line x1="26" y1="308" x2="854" y2="308" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="346" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a reasonable no-match</text>
  <text x="684" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">no-match is not failure</text>
  <text x="868" y="326" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A pack showing only the first band is the one reviewers learn to distrust, because it demonstrates nothing about the decision boundary.</text>
</svg>
<figcaption>The two middle bands are where a reviewer forms their actual opinion of the matcher.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="acr3-t acr3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="acr3-t">Which questions reviewers actually ask, by how often they come up</title>
  <desc id="acr3-d">Five questions ranked by how frequently reviewers raise them on a bulk edit proposal. Asking how the existing data was checked for duplicates is the most common. Asking what the tagging maps to and who agreed it comes next. Asking how a mistake would be undone is close behind. Asking what the licence position is follows. Asking about the matching algorithm itself is the least common, which is usually the opposite of what the pipeline's authors expect.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What reviewers ask, in order of frequency</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">How was duplication checked?</text>
  <rect x="276" y="60" width="458" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">most common</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">What does the tagging map to?</text>
  <rect x="276" y="100" width="364" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">very common</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">How would this be undone?</text>
  <rect x="276" y="140" width="296" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">common</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">What is the licence position?</text>
  <rect x="276" y="180" width="175" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">regular</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">How does the matcher work?</text>
  <rect x="276" y="220" width="54" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">rarely asked</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The algorithm is the part authors most want to explain and the part reviewers care least about, which is worth knowing before writing.</text>
</svg>
<figcaption>Structure the pack around the top three questions and most review threads finish in one exchange.</figcaption>
</figure>

## Verification

- **The pack reproduces.** Rebuild it from the same run and confirm the examples and counts are identical.
- **Every band has examples.** An empty band usually means a threshold is placed where no data falls, which is itself worth knowing.
- **The rules match the code.** The stated thresholds must be the ones the pipeline used — generating them from the same constants makes this automatic.
- **The limitations are unflattering.** If the derived notes read well, check the derivation rather than celebrating.
- **A reviewer can answer questions from it alone.** Give it to a colleague and see whether they need to ask you anything that the pack should have contained.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Reviewer asks for a breakdown | Only aggregate counts included | Slice by density, class and region |
| Examples all obviously correct | Sampled from high scores only | Sample bands around the threshold |
| Examples differ between builds | Unseeded sampling | Fix the seed and record it |
| Stated rules differ from behaviour | Prose written by hand | Generate the sentences from the pipeline's constants |
| Limitations section empty | Weak spots recalled rather than computed | Derive them from the run's own data |
| Pack unusable during review | Delivered as a dashboard needing access | Write a file that can be linked and archived |
| Nobody reads it | Not linked from the changesets | Reference the published pack in every changeset comment |

## Specification reference

> The OpenStreetMap community's expectations for automated and bulk edits include documenting the edit, discussing it in advance on the relevant channels, and making the documentation discoverable from the changesets themselves. An evidence pack satisfies the documentation requirement in a form a reviewer can act on. See the [automated edits code of conduct](https://wiki.openstreetmap.org/wiki/Automated_Edits_code_of_conduct) and the [import guidelines](https://wiki.openstreetmap.org/wiki/Import/Guidelines) for what reviewers expect to find.

## Frequently Asked Questions

<details>
<summary>Why include examples that were rejected?</summary>

Because a reviewer's real question is where the boundary sits, and only marginal cases answer it. A pack showing twenty obviously correct matches demonstrates that the easy cases work, which nobody doubted. Showing what was accepted at the weakest point and what was rejected just below it lets a reviewer judge whether the threshold is in the right place — which is the one judgement they are actually qualified to make without running anything.
</details>

<details>
<summary>Should the pack admit its weaknesses?</summary>

Yes, and derive them from the data rather than from memory. A reviewer will find the weak spots — they are usually the first thing an experienced one looks for — and finding an unmentioned one discounts everything else in the document. A pack that names its worst-performing slice, its thin-evidence decisions and its review backlog reads as honest, which is the property that determines whether the rest is believed.
</details>

<details>
<summary>How do I keep the stated rules in step with the code?</summary>

Generate the prose from the same constants the pipeline uses, rather than writing it by hand. A threshold described in a document and a threshold used in a run will eventually differ if they are maintained separately, and the discrepancy is discovered at the worst possible moment. Rendering sentences from the configuration object costs a few lines and removes the drift entirely.
</details>

<details>
<summary>Is a dashboard not better than a file?</summary>

Not for this purpose. The pack has to be linkable from a changeset comment, readable by somebody without access to your systems, and archivable so the same document can be re-read in two years when a question arises. A dashboard satisfies none of those. Build the dashboard too if it helps your team, but the artefact that accompanies the upload should be a file.
</details>

## Related

- [Conflation QA & Rollback](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/) — the parent topic and the four artefacts a run should produce.
- [Measuring Conflation Precision and Recall](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/measuring-conflation-precision-and-recall/) — the metrics this pack reports.
- [Preparing an OSM Import](https://www.osm-data-processing.org/osm-conflation-and-enrichment/preparing-an-osm-import/) — the plan this pack accompanies.
- [Dry-Running a Bulk Edit Against the Dev API](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/dry-running-a-bulk-edit-against-the-dev-api/) — the rehearsal that produces some of this evidence.
- [Generating an OSM Data Quality Report](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/generating-an-osm-data-quality-report/) — the same reporting discipline for pipeline quality.

Up one level: [Conflation QA & Rollback](https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Auditing a Conflation Run Before Upload",
  "description": "Assemble an evidence pack a reviewer can check without running anything: counts by slice, representative examples across the score range, the rules in plain words, and the known weak spots.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Conflation & Data Enrichment",
  "about": ["conflation audit", "evidence pack", "reviewer documentation"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Conflation & Data Enrichment", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/" },
    { "@type": "ListItem", "position": 3, "name": "Conflation QA & Rollback", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/" },
    { "@type": "ListItem", "position": 4, "name": "Auditing a Conflation Run Before Upload", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/conflation-qa-and-rollback/auditing-a-conflation-run-before-upload/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Assemble an evidence pack for a conflation run",
  "description": "Produce sliced counts, sample examples in bands around the decision threshold with a fixed seed, generate the rules as sentences from the pipeline's own constants, and derive the limitations from the data.",
  "step": [
    { "@type": "HowToStep", "name": "Slice the counts", "text": "Report outcomes by density, feature class and region as well as overall, warning when a slice column is unavailable." },
    { "@type": "HowToStep", "name": "Sample around the threshold", "text": "Take examples from bands well above, just above, just below, small-gap and well below, rather than only from high scores." },
    { "@type": "HowToStep", "name": "Fix the sampling seed", "text": "Use a recorded seed so the pack's examples are identical on every rebuild." },
    { "@type": "HowToStep", "name": "Generate the rules as prose", "text": "Render the thresholds, cardinality and precedence into sentences from the same constants the pipeline uses." },
    { "@type": "HowToStep", "name": "Derive the limitations", "text": "Compute the worst slice, the thin-evidence share and the review backlog from the run's own data rather than recalling them." },
    { "@type": "HowToStep", "name": "Publish as a file", "text": "Write a document that can be linked from every changeset comment and archived for later re-reading." }
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
      "name": "Why include rejected examples in a conflation audit?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because a reviewer's real question is where the boundary sits, and only marginal cases answer it. A pack showing twenty obviously correct matches demonstrates that the easy cases work, which nobody doubted. Showing what was accepted at the weakest point and rejected just below lets a reviewer judge whether the threshold is in the right place." }
    },
    {
      "@type": "Question",
      "name": "Should a conflation evidence pack admit its weaknesses?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes, and derive them from the data rather than from memory. A reviewer will find the weak spots, and finding an unmentioned one discounts everything else in the document. A pack that names its worst-performing slice, its thin-evidence decisions and its review backlog reads as honest, which determines whether the rest is believed." }
    },
    {
      "@type": "Question",
      "name": "How do I keep the stated rules in step with the pipeline code?",
      "acceptedAnswer": { "@type": "Answer", "text": "Generate the prose from the same constants the pipeline uses rather than writing it by hand. A threshold described in a document and one used in a run will eventually differ if maintained separately, and the discrepancy is discovered at the worst moment. Rendering sentences from the configuration removes the drift." }
    },
    {
      "@type": "Question",
      "name": "Is a dashboard better than a file for a conflation audit?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not for this purpose. The pack has to be linkable from a changeset comment, readable without access to your systems, and archivable for re-reading in two years. A dashboard satisfies none of those. Build one too if it helps your team, but the artefact accompanying the upload should be a file." }
    }
  ]
}
</script>
