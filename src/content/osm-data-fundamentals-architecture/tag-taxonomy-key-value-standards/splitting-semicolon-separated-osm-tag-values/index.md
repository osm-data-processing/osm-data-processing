---
title: "Splitting Semicolon-Separated OSM Tag Values"
description: "Split multi-valued OSM tags without breaking the values that legitimately contain a semicolon, and decide per key whether splitting is even correct."
pageTitle: "Splitting Multi-Valued OSM Tags Safely"
pageDescription: "Handle semicolon-separated OSM tag values per key rather than globally, preserve values where a semicolon is literal, trim and deduplicate parts, and keep the original for review."
slug: splitting-semicolon-separated-osm-tag-values
type: article
breadcrumb: "Semicolon Values"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Splitting Semicolon-Separated OSM Tag Values

The semicolon is OSM's conventional multi-value separator, and it is also an ordinary character that appears inside real values. A global split turns one opening-hours string into two meaningless fragments; not splitting at all leaves a cuisine tag nobody can filter on.

## Prerequisites

- [ ] Python 3.10+; the splitter uses only the standard library.
- [ ] Extracted tags, per [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/).
- [ ] The key conventions from [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/).
- [ ] A target schema that can hold a list, or a decision about how to flatten one.
- [ ] A corpus to audit, since which keys are multi-valued in practice varies by region.

## Conceptual minimum

Three facts decide the design.

**Splitting is per key, never global.** `cuisine=pizza;italian` is two values. `opening_hours=Mo-Fr 09:00-17:00; Sa 10:00-14:00` is one value whose syntax uses semicolons internally. Applying one rule to both is guaranteed to break one of them.

**Some keys are multi-valued and some are not.** `cuisine`, `sport`, `ref`, `alt_name` and several others conventionally hold lists. `name`, `opening_hours`, `description` and `addr:street` do not, and a semicolon inside one of them is either literal or a data error — but not a separator.

**Order sometimes matters.** For `cuisine` the order is arbitrary and deduplication is safe. For `ref` on a route it may reflect signage order. Sorting a list to make comparison easier can destroy information, so it should be a per-key decision too.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="sss1-t sss1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sss1-t">Which keys split, which do not, and what happens when the rule is wrong</title>
  <desc id="sss1-d">A grid of four key families against whether they split and the consequence of getting it wrong. Multi-valued keys such as cuisine and sport should split, and failing to split leaves values nobody can filter on. Structured-syntax keys such as opening hours and conditional restrictions must not split, because the semicolon is part of their grammar and splitting produces meaningless fragments. Free-text keys such as name and description must not split, because a semicolon there is literal punctuation. Reference keys such as route numbers split but must preserve order, because the sequence can carry meaning.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four key families, three different rules</text>
  <rect x="206" y="48" width="324" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="368" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Split?</text>
  <rect x="530" y="48" width="324" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="692" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">If you get it wrong</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">cuisine, sport</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">yes</text>
  <text x="692" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">unfilterable values</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">opening_hours</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">never</text>
  <text x="692" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">grammar destroyed</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">name, description</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">never</text>
  <text x="692" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">punctuation split</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">ref on a route</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">yes, keep order</text>
  <text x="692" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">signage order lost</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">There is no rule that is right for all four rows, which is why a global split or a global refusal both cause damage.</text>
</svg>
<figcaption>The second row is the one a global splitter destroys most visibly, because the fragments are individually meaningless.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
from dataclasses import dataclass

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.tags.multivalue")

# Keys whose values are conventionally lists. Anything absent is NOT split.
MULTI_VALUED: dict[str, bool] = {
    # key -> whether the order carries meaning
    "cuisine": False, "sport": False, "religion": False, "diet": False,
    "payment": False, "fuel": False, "recycling": False, "service": False,
    "alt_name": True, "ref": True, "operator": True, "brand": True,
    "route_ref": True, "network": True, "surface": False,
}
# Keys whose syntax uses semicolons internally. Splitting these is destructive.
NEVER_SPLIT = {
    "opening_hours", "service_times", "collection_times", "name", "description",
    "note", "fixme", "inscription", "addr:street", "addr:full", "conditional",
}
MAX_PARTS = 24          # a value with more parts than this is probably an error


@dataclass(frozen=True)
class MultiValue:
    key: str
    values: tuple[str, ...]
    original: str
    split: bool
    suspicious: bool


def split_value(key: str, value: str) -> MultiValue:
    """Split only where the key's convention says a list is meant."""
    base = key.split(":", 1)[0]     # addr:street -> addr, name:en -> name

    if key in NEVER_SPLIT or base in NEVER_SPLIT:
        return MultiValue(key, (value,), value, split=False, suspicious=False)
    if key not in MULTI_VALUED and base not in MULTI_VALUED:
        # Unknown key: do NOT split. An unsplit list is recoverable; a split
        # structured value is not.
        suspicious = ";" in value
        return MultiValue(key, (value,), value, split=False,
                          suspicious=suspicious)

    parts = [p.strip() for p in value.split(";")]
    parts = [p for p in parts if p]
    ordered = MULTI_VALUED.get(key, MULTI_VALUED.get(base, True))
    if not ordered:
        # Order is arbitrary for this key: deduplicate and sort for comparison.
        parts = sorted(set(parts))
    else:
        seen: set[str] = set()
        parts = [p for p in parts if not (p in seen or seen.add(p))]

    suspicious = len(parts) > MAX_PARTS
    if suspicious:
        logger.warning("%s has %d part(s); likely a data error", key, len(parts))
    return MultiValue(key, tuple(parts), value, split=True, suspicious=suspicious)


def split_tags(tags: dict[str, str]) -> dict[str, MultiValue]:
    return {k: split_value(k, v) for k, v in tags.items()}


def audit(tag_stream) -> dict[str, dict[str, int]]:
    """Which keys actually contain semicolons, and are we splitting them?"""
    stats: dict[str, dict[str, int]] = {}
    for tags in tag_stream:
        for key, value in tags.items():
            if ";" not in value:
                continue
            entry = stats.setdefault(key, {"seen": 0, "split": 0, "kept": 0})
            entry["seen"] += 1
            result = split_value(key, value)
            entry["split" if result.split else "kept"] += 1

    unsplit = {k: v for k, v in stats.items() if v["kept"] and v["seen"] > 20}
    if unsplit:
        logger.info("keys with semicolons that are NOT split (review these): %s",
                    sorted(unsplit, key=lambda k: -unsplit[k]["seen"])[:10])
    return stats


if __name__ == "__main__":
    tags = {
        "cuisine": "pizza;italian;pizza",
        "opening_hours": "Mo-Fr 09:00-17:00; Sa 10:00-14:00",
        "name": "Smith; Jones and Co",
        "ref": "A1;M25",
    }
    for key, result in split_tags(tags).items():
        logger.info("%-14s split=%-5s -> %s", key, result.split, result.values)
```

## Step-by-step walkthrough

1. **Default to not splitting.** An unsplit list can be split later; a structured value split into fragments cannot be reassembled reliably. When the key is unknown, leaving it alone is the recoverable choice.
2. **Check the namespace base as well as the full key.** `name:en` inherits `name`'s rule, and enumerating every language variant is not practical.
3. **List the never-split keys explicitly.** Keys whose grammar uses semicolons are few and well known, and naming them is what makes the default safe rather than merely cautious.
4. **Trim and drop empties.** A trailing separator produces an empty part, which downstream becomes a mysterious blank category.
5. **Decide ordering per key.** Sorting makes comparison easy and destroys signage order; doing it only where order is genuinely arbitrary keeps both properties where they belong.
6. **Deduplicate in both branches.** A repeated value is noise in either case; the difference is only whether the surviving order is the original one.
7. **Flag implausible part counts.** A tag with dozens of parts is almost always a data error rather than a genuine list, and the warning surfaces it rather than propagating it.
8. **Audit what is not being split.** A key containing semicolons often and never split is either correctly excluded or a gap in the vocabulary, and the audit is what tells the two apart.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="sss2-t sss2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sss2-t">The four decisions the splitter makes for each tag</title>
  <desc id="sss2-d">Four decisions in order. The first checks whether the key or its namespace base is on the never-split list, returning the value untouched if so. The second checks whether the key is known to be multi-valued, and defaults to not splitting when it is not, since an unsplit list is recoverable. The third splits, trims and drops empty parts. The fourth applies ordering: sorting and deduplicating where order is arbitrary, and preserving order while removing repeats where it is not.</desc>
  <defs><marker id="sss2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four decisions, and the default is to leave it alone</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">never split?</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">grammar uses semicolons</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">return untouched</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#sss2-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">known list?</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">unknown means no</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">recoverable choice</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#sss2-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">split and trim</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">drop empty parts</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">no blank categories</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#sss2-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">order</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">sort or preserve</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">per key, deliberately</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Defaulting to no split makes a missing vocabulary entry a minor inconvenience rather than an irreversible loss.</text>
</svg>
<figcaption>Every step except the third is a lookup, which is what keeps this cheap enough to run on every tag of every element.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="sss3-t sss3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sss3-t">What a global split and a global refusal each destroy</title>
  <desc id="sss3-d">Three panels. Splitting everything breaks structured values such as opening hours into fragments that are individually meaningless and cannot be reassembled, and turns literal punctuation in a name into two separate names. Splitting nothing leaves genuine lists as single opaque strings, so a consumer cannot filter on one cuisine or match one alternative name. Splitting per key handles both correctly at the cost of maintaining a vocabulary, which an audit of the corpus keeps current.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Two global rules, both wrong; one per-key rule</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Split everything</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Opening hours in fragments</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Names split at punctuation</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Fragments are meaningless</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Cannot be reassembled</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Split nothing</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Cuisines stay opaque</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Alternative names unmatched</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Filters cannot work</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">At least it is recoverable</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Split per key</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Both cases handled</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Needs a vocabulary</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Audit keeps it current</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Default to not splitting</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The middle panel is the safer of the two global choices precisely because nothing it does is irreversible.</text>
</svg>
<figcaption>That asymmetry is the argument for defaulting unknown keys to unsplit rather than to split.</figcaption>
</figure>

## Verification

- **Structured values survive intact.** An opening-hours string with internal semicolons must come through as a single value.
- **List keys are split.** A cuisine value with two parts must produce two values.
- **Unknown keys are not split.** Introduce an unfamiliar key with a semicolon and confirm it passes through whole and flagged.
- **Empty parts do not appear.** A trailing separator must not produce a blank value.
- **Order is preserved where it matters.** A route reference list must keep its original sequence.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Opening hours in fragments | Global split applied | Split per key, with an explicit never-split list |
| Cuisine values unfilterable | Nothing split | Add the key to the multi-valued vocabulary |
| Blank categories downstream | Empty parts kept | Trim and drop empty parts after splitting |
| Route references reordered | Sorting applied to an ordered key | Sort only where order is genuinely arbitrary |
| Language variants not split | Only the full key checked | Check the namespace base as well |
| Dozens of parts on one tag | A data error propagated | Warn above a plausible maximum part count |
| Vocabulary never improves | Unsplit semicolon values unaudited | Report keys that frequently contain separators |

## Specification reference

> The semicolon is the conventional separator for multiple values in a single OSM tag, though its use is not universal and several keys define a syntax in which semicolons appear as part of the value rather than as a separator. Consumers are expected to apply the convention per key. See the [semi-colon value separator documentation](https://wiki.openstreetmap.org/wiki/Semi-colon_value_separator) for the convention and its exceptions.

## Frequently Asked Questions

<details>
<summary>Why not split every value containing a semicolon?</summary>

Because several keys use the semicolon inside their own grammar. An opening-hours value separates its rules with semicolons, and splitting it produces fragments that are individually meaningless and cannot be reassembled reliably. The same applies to conditional restrictions and to free-text keys where a semicolon is ordinary punctuation. Splitting has to be a per-key decision, driven by an explicit vocabulary.
</details>

<details>
<summary>What should an unknown key default to?</summary>

Not splitting. The asymmetry is the whole argument: a list left unsplit can be split later once the key is added to the vocabulary, while a structured value already split into fragments has lost information that is difficult to recover. Flagging unknown keys that contain semicolons, so they can be reviewed and classified, gives the benefit of the split without the risk.
</details>

<details>
<summary>Should the split values be sorted?</summary>

Only where the order is genuinely arbitrary. Sorting a cuisine list makes two features with the same cuisines compare equal regardless of how they were entered, which is useful. Sorting a route reference list destroys the signage order, which a consumer may depend on. The ordering decision belongs in the same vocabulary as the split decision, one flag per key.
</details>

<details>
<summary>How do I discover which keys need splitting?</summary>

Audit the corpus. Count, per key, how often its values contain a semicolon and whether the splitter currently splits it. A key that frequently contains separators and is never split is either a correct exclusion or a gap, and reviewing the top few by frequency covers almost all the value. Regional tagging conventions differ, so the audit is worth repeating on each new area.
</details>

## Related

- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — the parent topic and the key conventions.
- [Normalizing OSM Yes/No Tag Values](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/normalizing-osm-yes-no-tag-values/) — the other value-shape problem in this namespace.
- [Parsing OSM Opening Hours Values](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/parsing-osm-opening-hours-values/) — the key this splitter must never touch.
- [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — the normalization stage this belongs to.
- [Fuzzy Name Matching for OSM POI Conflation](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/fuzzy-name-matching-for-osm-poi-conflation/) — a consumer that depends on alternative names being split.

Up one level: [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Splitting Semicolon-Separated OSM Tag Values",
  "description": "Split multi-valued OSM tags without breaking the values that legitimately contain a semicolon, and decide per key whether splitting is even correct.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Fundamentals & Architecture",
  "about": ["multi-valued tags", "semicolon separator", "per-key rules"]
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
    { "@type": "ListItem", "position": 4, "name": "Splitting Semicolon-Separated OSM Tag Values", "item": "https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/splitting-semicolon-separated-osm-tag-values/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Split multi-valued OSM tags safely",
  "description": "Consult an explicit never-split list, default unknown keys to not splitting, trim and drop empty parts, apply ordering per key, flag implausible part counts, and audit unsplit semicolon values.",
  "step": [
    { "@type": "HowToStep", "name": "Check the never-split list", "text": "Return the value untouched for keys whose own grammar uses semicolons, checking the namespace base as well as the full key." },
    { "@type": "HowToStep", "name": "Default unknown keys to unsplit", "text": "Leave unfamiliar keys whole, since an unsplit list is recoverable and a split structured value is not." },
    { "@type": "HowToStep", "name": "Trim and drop empties", "text": "Strip whitespace from each part and discard empty ones so a trailing separator does not create a blank category." },
    { "@type": "HowToStep", "name": "Apply ordering per key", "text": "Sort and deduplicate where order is arbitrary, and preserve order while removing repeats where it carries meaning." },
    { "@type": "HowToStep", "name": "Flag implausible counts", "text": "Warn when a value splits into far more parts than a genuine list would contain." },
    { "@type": "HowToStep", "name": "Audit the unsplit", "text": "Report keys that frequently contain semicolons but are never split, and classify them deliberately." }
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
      "name": "Why not split every OSM value containing a semicolon?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because several keys use the semicolon inside their own grammar. An opening-hours value separates its rules with semicolons, and splitting it produces fragments that are individually meaningless and cannot be reassembled reliably. Splitting has to be a per-key decision driven by an explicit vocabulary." }
    },
    {
      "@type": "Question",
      "name": "What should an unknown OSM key default to when splitting?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not splitting. A list left unsplit can be split later once the key is added to the vocabulary, while a structured value already split into fragments has lost information that is difficult to recover. Flagging unknown keys that contain semicolons gives the benefit without the risk." }
    },
    {
      "@type": "Question",
      "name": "Should split OSM tag values be sorted?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only where the order is genuinely arbitrary. Sorting a cuisine list makes two features with the same cuisines compare equal, which is useful. Sorting a route reference list destroys signage order, which a consumer may depend on. The ordering decision belongs in the same vocabulary as the split decision." }
    },
    {
      "@type": "Question",
      "name": "How do I discover which OSM keys need splitting?",
      "acceptedAnswer": { "@type": "Answer", "text": "Audit the corpus. Count, per key, how often its values contain a semicolon and whether the splitter currently splits it. A key that frequently contains separators and is never split is either a correct exclusion or a gap. Regional conventions differ, so repeat the audit on each new area." }
    }
  ]
}
</script>
