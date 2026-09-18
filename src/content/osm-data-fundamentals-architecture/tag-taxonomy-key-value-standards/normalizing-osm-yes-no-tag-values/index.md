---
title: "Normalizing OSM Yes/No Tag Values"
description: "Map the real vocabulary of boolean-ish OSM values onto a tri-state that keeps 'not mapped' distinct from 'no', and refuse to guess at the values that are genuinely neither."
pageTitle: "Normalizing Boolean OSM Tags Without Losing Information"
pageDescription: "Turn yes, no, true, 1, designated, limited and permissive into a tri-state that distinguishes absent from negative, and route genuinely non-boolean values to review rather than defaulting them."
slug: normalizing-osm-yes-no-tag-values
type: article
breadcrumb: "Yes/No Values"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Normalizing OSM Yes/No Tag Values

The tag looks boolean and is not. `access` can be `yes`, `no`, `private`, `permissive`, `destination`, `customers` or `designated`, and a pipeline that maps everything not equal to `yes` onto false has just told a routing engine that a permissive path is closed.

## Prerequisites

- [ ] Python 3.10+; nothing beyond the standard library is needed.
- [ ] Tags already extracted, per [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/).
- [ ] The key conventions from [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/).
- [ ] A decision about what an absent tag means for each key, since it differs.
- [ ] A consumer that can accept three states rather than two.

## Conceptual minimum

Three distinctions have to survive normalization, and collapsing any of them loses real information.

**Absent is not false.** A way with no `lit` tag has not been surveyed for lighting; it has not been recorded as unlit. A pipeline that treats the absence as a negative is inventing data, and it will report that a city's streets are overwhelmingly unlit when in fact they are overwhelmingly unsurveyed.

**Some values are boolean in disguise.** `true`, `1` and occasionally `T` appear as synonyms for `yes`, usually from imports or from editors that did not enforce the vocabulary. They are safe to fold.

**Some values are not boolean at all.** `private`, `permissive`, `destination`, `customers`, `designated`, `limited` and `unknown` each say something a boolean cannot carry. Folding them into true or false is where the real damage happens, because the result is plausible and the nuance is gone.

The right output is a **tri-state** — yes, no, unknown — plus a preserved original value, so a consumer that understands the richer vocabulary can still reach it.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 342" role="img" aria-labelledby="nyn1-t nyn1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="nyn1-t">What each family of boolean-ish value actually means</title>
  <desc id="nyn1-d">A grid of five value families against how each should normalise and why. The affirmative family, covering yes, true and one, normalises to yes and is safe to fold. The negative family, covering no, false and zero, normalises to no and is equally safe. The conditional family, covering permissive, destination and customers, means access is allowed under conditions and must not become a plain yes. The restrictive family, covering private and no entry variants, means access is denied to the general public and is closer to no but not identical. The absent case means unsurveyed and must stay distinct from no.</desc>
  <rect x="0" y="0" width="880" height="342" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Five families, and only two fold safely</text>
  <rect x="196" y="48" width="329" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="360" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Normalises to</text>
  <rect x="525" y="48" width="329" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="690" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Why</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">yes, true, 1</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">yes</text>
  <text x="690" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">synonyms, safe to fold</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">no, false, 0</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">no</text>
  <text x="690" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">synonyms, safe to fold</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">permissive, destination</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">yes, flagged</text>
  <text x="690" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">allowed with conditions</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">private, customers</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">no, flagged</text>
  <text x="690" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">denied to the public</text>
  <text x="30" y="289" font-size="11.5" font-weight="600" fill="currentColor">absent</text>
  <line x1="26" y1="308" x2="854" y2="308" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">unknown</text>
  <text x="690" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">unsurveyed, not negative</text>
  <text x="868" y="326" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The flagged rows keep the original value alongside the tri-state, so a consumer that understands the nuance can still use it.</text>
</svg>
<figcaption>Collapsing the middle two rows into plain yes and no is what tells a routing engine a permissive path is a public road.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
from enum import Enum
from dataclasses import dataclass

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.tags.boolean")


class Tri(str, Enum):
    YES = "yes"
    NO = "no"
    UNKNOWN = "unknown"


AFFIRMATIVE = {"yes", "true", "1", "t", "y"}
NEGATIVE = {"no", "false", "0", "f", "n"}
# Values that resolve to a state but carry a condition worth keeping.
CONDITIONAL_YES = {"permissive", "destination", "designated", "official",
                   "customers", "permit", "agricultural", "forestry", "delivery"}
CONDITIONAL_NO = {"private", "no_entry", "restricted", "military"}
# Values that resolve to nothing: they say the surveyor did not know.
EXPLICIT_UNKNOWN = {"unknown", "unspecified", "fixme", ""}


@dataclass(frozen=True)
class Normalized:
    state: Tri
    original: str | None
    conditional: bool
    recognised: bool

    @property
    def is_definite(self) -> bool:
        return self.state is not Tri.UNKNOWN and not self.conditional


def normalize(value: str | None) -> Normalized:
    """Map an OSM boolean-ish value to a tri-state, keeping what was lost."""
    if value is None:
        # Absent is NOT false: nobody recorded anything either way.
        return Normalized(Tri.UNKNOWN, None, conditional=False, recognised=True)

    raw = value.strip()
    folded = raw.casefold()

    if folded in EXPLICIT_UNKNOWN:
        return Normalized(Tri.UNKNOWN, raw, False, True)
    if folded in AFFIRMATIVE:
        return Normalized(Tri.YES, raw, False, True)
    if folded in NEGATIVE:
        return Normalized(Tri.NO, raw, False, True)
    if folded in CONDITIONAL_YES:
        return Normalized(Tri.YES, raw, conditional=True, recognised=True)
    if folded in CONDITIONAL_NO:
        return Normalized(Tri.NO, raw, conditional=True, recognised=True)

    # An unrecognised value is not a negative. Say so, and keep it.
    logger.debug("unrecognised boolean-ish value %r", raw)
    return Normalized(Tri.UNKNOWN, raw, conditional=False, recognised=False)


def normalize_key(tags: dict[str, str], key: str) -> Normalized:
    return normalize(tags.get(key))


def audit(values: list[str | None]) -> dict[str, int]:
    """Count how a corpus distributes, so the vocabularies can be extended."""
    counts = {"yes": 0, "no": 0, "unknown": 0,
              "conditional": 0, "unrecognised": 0}
    unrecognised: dict[str, int] = {}
    for value in values:
        result = normalize(value)
        counts[result.state.value] += 1
        if result.conditional:
            counts["conditional"] += 1
        if not result.recognised:
            counts["unrecognised"] += 1
            key = result.original or ""
            unrecognised[key] = unrecognised.get(key, 0) + 1

    top = sorted(unrecognised.items(), key=lambda kv: -kv[1])[:10]
    logger.info("distribution %s", counts)
    if top:
        logger.info("most common unrecognised: %s", top)
    return counts


if __name__ == "__main__":
    sample = ["yes", "no", "private", "permissive", None, "1", "maybe", ""]
    audit(sample)
```

## Step-by-step walkthrough

1. **Separate absent from empty.** A missing key and a key whose value is an empty string both mean unknown, but only the first is a legitimate state — the second is a data-quality signal worth keeping visible.
2. **Fold case, not meaning.** Case folding handles the editor variants safely; folding a conditional value into a plain state does not.
3. **Keep conditional and definite apart.** A path that is `permissive` is usable and a path that is `yes` is usable, and a routing engine that plans a route through private land on the strength of a permissive tag has made a real mistake.
4. **Treat an unrecognised value as unknown.** It is neither affirmative nor negative; defaulting it either way is guessing, and defaulting it to false is the guess that silently closes things.
5. **Preserve the original.** The tri-state is for consumers that want simplicity; the original is for the ones that want the nuance, and keeping both costs one column.
6. **Audit the corpus.** Counting the most common unrecognised values is how the vocabularies get extended from evidence rather than from memory of what the documentation says.
7. **Record whether the value was recognised.** That flag is what lets a quality report distinguish "the surveyor did not know" from "we did not understand the answer".

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="nyn2-t nyn2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="nyn2-t">Three collapses that each lose something specific</title>
  <desc id="nyn2-d">Three panels. Collapsing absent into no reports unsurveyed features as negative, which turns a coverage gap into a factual claim and makes a city's streets look unlit when they are merely unsurveyed. Collapsing conditional into definite tells a consumer that a permissive path is a public right of way, which a routing engine will act on. Collapsing unrecognised into no closes anything whose value the pipeline did not understand, which is the worst default because the failure scales with how unusual the data is.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three collapses, three different damages</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Absent to no</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Unsurveyed reads as negative</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Coverage gap becomes a claim</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Streets look unlit</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Statistics quietly invented</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Conditional to definite</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Permissive reads as public</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Private reads as merely closed</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Routing acts on it</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Nuance gone, plausible result</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Unrecognised to no</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Anything unknown is closed</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Worst possible default</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Scales with unusual data</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Fails hardest where it matters</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">All three produce numbers that look entirely reasonable, which is why none of them is caught by a sanity check on the output.</text>
</svg>
<figcaption>Each collapse saves one column and costs a distinction that cannot be recovered afterwards.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="nyn3-t nyn3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="nyn3-t">How one key's values actually distribute across a country extract</title>
  <desc id="nyn3-d">Five outcome categories with their approximate share of features for a typical access-style key across a country extract. Features with no tag at all dominate by a wide margin, because most things are simply unsurveyed for that property. Plain affirmative values are the next largest group. Plain negative values are a small share. Conditional values such as permissive and private form a smaller but significant share. Unrecognised values are a fraction of a percent and are where the vocabulary needs extending.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Where the values actually are, for one key</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">No tag at all</text>
  <rect x="246" y="60" width="488" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 88%</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Plain yes</text>
  <rect x="246" y="100" width="39" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 7%</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Plain no</text>
  <rect x="246" y="140" width="12" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 2%</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Conditional</text>
  <rect x="246" y="180" width="14" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 2.5%</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">Unrecognised</text>
  <rect x="246" y="220" width="6" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">under 1%</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Folding the first bar into the third would report ninety percent of features as negative, which is the shape of a statistic nobody questions.</text>
</svg>
<figcaption>The dominance of the first bar is why the absent-versus-negative distinction matters more than every other decision here.</figcaption>
</figure>

## Verification

- **Absent and negative differ in the output.** Count features whose tri-state is unknown versus no; a corpus where unknown is zero means absence is being folded.
- **Conditional values are flagged.** Find a permissive feature and confirm it carries both the affirmative state and the conditional flag.
- **Unrecognised values surface.** The audit's unrecognised list should be short and, where non-empty, should contain real values worth adding.
- **Case variants fold.** `Yes`, `YES` and `yes` must produce identical output.
- **Originals survive.** Every normalised record should still carry the value it came from.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Most features reported negative | Absent folded into no | Return unknown for a missing key |
| Routing uses private land | Conditional folded into definite | Keep a conditional flag alongside the state |
| Unusual regions behave worst | Unrecognised defaulted to no | Return unknown for anything not in the vocabulary |
| Vocabulary never grows | Unrecognised values discarded | Audit and report the most common ones |
| Case variants treated as distinct | No case folding | Casefold before matching |
| Nuance irrecoverable downstream | Original value dropped | Keep the raw value alongside the tri-state |
| Empty string treated as a state | Empty and absent conflated | Map empty to unknown but flag it separately |

## Specification reference

> Keys such as `access`, `oneway`, `lit` and `bridge` accept `yes` and `no` alongside a wider vocabulary, and several keys define conditional values such as `permissive`, `destination` and `private` with distinct meanings. An absent key indicates that the property has not been recorded rather than that it is false. See the [access tag documentation](https://wiki.openstreetmap.org/wiki/Key:access) for the conditional vocabulary and [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) for the wider key conventions.

## Frequently Asked Questions

<details>
<summary>Why should an absent tag be unknown rather than no?</summary>

Because absence records that nobody surveyed the property, not that the property is false. Treating the two the same converts a coverage gap into a factual claim, and the resulting statistics are confidently wrong: a city whose streets are largely unsurveyed for lighting will be reported as largely unlit. The distinction also tells you where survey effort would be worth spending, which the collapsed version cannot.
</details>

<details>
<summary>Is permissive the same as yes?</summary>

For the question "can I pass", nearly; for anything a consumer will act on, no. Permissive means the owner currently tolerates access and may withdraw it, which is a materially different statement from a public right of way. A routing engine planning a walking route can reasonably use permissive paths; one planning a delivery vehicle's route probably should not, and it can only make that distinction if the value survived normalization.
</details>

<details>
<summary>What should happen to a value nobody recognises?</summary>

It becomes unknown, and it gets counted. Defaulting it to false is the worst available choice because the failure scales with how unusual the data is — regions with local tagging conventions, or features with genuinely unusual access arrangements, are exactly where the default does most damage. Counting the unrecognised values is how the vocabulary grows from evidence.
</details>

<details>
<summary>Is a tri-state enough, or should the full vocabulary survive?</summary>

Both, which is why the original is kept alongside. The tri-state serves the many consumers that want a simple answer and would otherwise invent one; the preserved original serves the few that need the nuance. Storing only the tri-state discards information irreversibly, and storing only the original pushes the same normalization decision onto every consumer separately.
</details>

## Related

- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — the parent topic and the key conventions.
- [Splitting Semicolon-Separated OSM Tag Values](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/splitting-semicolon-separated-osm-tag-values/) — the other value-shape problem in the same namespace.
- [Validating Oneway and Access Tags for Routing](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/validating-oneway-and-access-tags-for-routing/) — where these values are consumed and where a collapse causes real harm.
- [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — the wider normalization stage this belongs to.
- [Handling Missing Tags in OSM Data Pipelines](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/handling-missing-tags-in-osm-data-pipelines/) — the absence question across all keys.

Up one level: [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Normalizing OSM Yes/No Tag Values",
  "description": "Map the real vocabulary of boolean-ish OSM values onto a tri-state that keeps 'not mapped' distinct from 'no', and refuse to guess at the values that are genuinely neither.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["boolean tags", "tri-state normalization", "access values"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Fundamentals & Architecture", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/" },
    { "@type": "ListItem", "position": 3, "name": "Tag Taxonomy & Key-Value Standards", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/" },
    { "@type": "ListItem", "position": 4, "name": "Normalizing OSM Yes/No Tag Values", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/normalizing-osm-yes-no-tag-values/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Normalize boolean-ish OSM tag values to a tri-state",
  "description": "Return unknown for absent and unrecognised values, fold only genuine synonyms, flag conditional values rather than collapsing them, preserve the original, and audit the corpus to extend the vocabulary.",
  "step": [
    { "@type": "HowToStep", "name": "Return unknown for absence", "text": "Treat a missing key as unsurveyed rather than as a negative, keeping coverage gaps distinct from facts." },
    { "@type": "HowToStep", "name": "Fold only synonyms", "text": "Case-fold and accept the affirmative and negative synonym sets, which are safe to collapse." },
    { "@type": "HowToStep", "name": "Flag conditional values", "text": "Resolve permissive and private to a state but mark them conditional, since the condition matters to consumers." },
    { "@type": "HowToStep", "name": "Return unknown for the unrecognised", "text": "Never default an unfamiliar value to false, because that failure scales with how unusual the data is." },
    { "@type": "HowToStep", "name": "Preserve the original", "text": "Keep the raw value alongside the tri-state so the richer vocabulary remains reachable." },
    { "@type": "HowToStep", "name": "Audit the corpus", "text": "Count the most common unrecognised values and extend the vocabularies from that evidence." }
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
      "name": "Why should an absent OSM tag be unknown rather than no?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because absence records that nobody surveyed the property, not that it is false. Treating the two the same converts a coverage gap into a factual claim, and the resulting statistics are confidently wrong. The distinction also tells you where survey effort would be worth spending, which the collapsed version cannot." }
    },
    {
      "@type": "Question",
      "name": "Is an OSM permissive access value the same as yes?",
      "acceptedAnswer": { "@type": "Answer", "text": "For the question of whether you can pass, nearly; for anything a consumer will act on, no. Permissive means the owner currently tolerates access and may withdraw it, which differs materially from a public right of way. A routing engine can only make that distinction if the value survived normalization." }
    },
    {
      "@type": "Question",
      "name": "What should happen to an OSM tag value nobody recognises?",
      "acceptedAnswer": { "@type": "Answer", "text": "It becomes unknown, and it gets counted. Defaulting it to false is the worst choice because the failure scales with how unusual the data is — regions with local conventions are exactly where the default does most damage. Counting unrecognised values is how the vocabulary grows from evidence." }
    },
    {
      "@type": "Question",
      "name": "Is a tri-state enough, or should the full OSM vocabulary survive?",
      "acceptedAnswer": { "@type": "Answer", "text": "Both, which is why the original is kept alongside. The tri-state serves consumers that want a simple answer and would otherwise invent one; the preserved original serves those that need the nuance. Storing only the tri-state discards information irreversibly." }
    }
  ]
}
</script>
