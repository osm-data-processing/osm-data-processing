---
title: "Fuzzy Name Matching for OSM POI Conflation"
description: "Normalise place names non-destructively, compare them with token and character measures that behave differently on real data, and keep both scores rather than blending them."
pageTitle: "Fuzzy Name Matching That Works on OSM Place Names"
pageDescription: "Build a name comparator for OSM conflation: conservative Unicode and punctuation normalisation, a guarded suffix list, token-set and character-edit measures kept separate, and a script guard."
slug: fuzzy-name-matching-for-osm-poi-conflation
type: article
breadcrumb: "Fuzzy Name Matching"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Fuzzy Name Matching for OSM POI Conflation

Compare "St. Mary's C of E Primary School" with "SAINT MARYS CHURCH OF ENGLAND PRIMARY" and get a useful number — without also deciding that "Bar Vega" and "Bar Vela" are the same place.

## Prerequisites

- [ ] Python 3.10+; `rapidfuzz` for the similarity measures, though the standard library's `difflib` works for small volumes.
- [ ] Names from both datasets, with the OSM side taken from `name` and its language variants rather than from `name:en` alone.
- [ ] The matcher structure from [Matching OSM Features to External Datasets](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/).
- [ ] A labelled sample of true and false pairs, to calibrate rather than guess.
- [ ] An explicit decision about which languages and scripts appear in your data.

## Conceptual minimum

Two different kinds of similarity measure exist and they fail on opposite things.

**Character-edit measures** — Levenshtein and its normalised forms — count the operations needed to turn one string into another. They handle typos and spelling variants well and word reordering badly: "Vega Bar" versus "Bar Vega" is a large edit distance despite being obviously the same name.

**Token-set measures** split both strings into words and compare the sets. They handle reordering, extra words and missing words well, and typos badly: a single wrong letter turns a matching token into a non-matching one and the whole word is lost.

Real place names need both, and **blending them into one number discards the information that distinguishes the failure modes**. Keeping them separate lets a pair with a high token score and a low character score — a reordered name — be treated differently from one with the reverse profile.

The third component is the normalisation that runs before either, and its guiding rule is that it must be **conservative and reversible**: it produces a comparison string, never replaces the original.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 239" role="img" aria-labelledby="fnm1-t fnm1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="fnm1-t">Three name comparison strategies and what each one gets wrong</title>
  <desc id="fnm1-d">Three panels. A character-edit measure counts insertions, deletions and substitutions, handling typos and spelling variants well but scoring reordered word sequences very low. A token-set measure compares the sets of words, handling reordering and extra or missing words well but losing a whole word to a single typo. Using both and keeping the scores separate covers each other's weaknesses and lets a reviewer see which kind of difference a pair exhibits.</desc>
  <rect x="0" y="0" width="880" height="239" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Two measures, two opposite blind spots</text>
  <rect x="26" y="52" width="259" height="153" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Character edit</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Counts edits between strings</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Good: typos, spellings</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Bad: reordered words</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Bar Vega vs Vega Bar fails</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Normalised to 0 to 1</text>
  <rect x="311" y="52" width="259" height="153" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Token set</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Compares sets of words</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Good: reordering, extra words</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Bad: a single typo</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">One wrong letter loses a word</text>
  <text x="325" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Ignores word order entirely</text>
  <rect x="595" y="52" width="259" height="153" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Both, kept apart</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Compute both, store both</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Each covers the other</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Profile shows the difference</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">High token, low char: reorder</text>
  <text x="609" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Low token, high char: typo</text>
  <text x="868" y="223" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Blending the two into one number throws away exactly the information a reviewer needs to judge an uncertain pair.</text>
</svg>
<figcaption>Two numbers cost nothing extra to compute and turn an opaque score into a diagnosis.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass

from rapidfuzz import fuzz

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.conflate.names")

# Generic words safe to drop: they carry no distinguishing content on their own.
# NOTE: words like "church", "school" or "hotel" are NOT here — for many places
# they are the whole distinguishing part of the name.
DROPPABLE = {
    "ltd", "limited", "plc", "inc", "llc", "gmbh", "sa", "sp", "zoo",
    "the", "and",
}
EXPANSIONS = {
    "st": "saint", "ste": "sainte", "mt": "mount", "ft": "fort",
    "rd": "road", "ave": "avenue", "sq": "square",
}
_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)
_WS = re.compile(r"\s+")


@dataclass(frozen=True)
class NameScore:
    token: float          # 0..1, set-based; robust to reordering
    char: float           # 0..1, edit-based; robust to typos
    comparable: bool      # False when scripts differ or a side is empty

    @property
    def best(self) -> float:
        return max(self.token, self.char) if self.comparable else 0.0

    @property
    def profile(self) -> str:
        if not self.comparable:
            return "incomparable"
        if self.token - self.char > 0.25:
            return "reordered"
        if self.char - self.token > 0.25:
            return "typo-like"
        return "consistent"


def dominant_script(text: str) -> str:
    """Crude script detection: enough to avoid comparing across alphabets."""
    for ch in text:
        if ch.isalpha():
            name = unicodedata.name(ch, "")
            for script in ("LATIN", "CYRILLIC", "GREEK", "ARABIC", "HEBREW",
                           "HANGUL", "HIRAGANA", "KATAKANA", "CJK"):
                if script in name:
                    return script
    return "UNKNOWN"


def normalise(text: str) -> str:
    """Produce a comparison string. The caller keeps the original."""
    # NFKC folds compatibility forms; casefold is stronger than lower().
    text = unicodedata.normalize("NFKC", text).casefold()
    text = _PUNCT.sub(" ", text)
    tokens = [EXPANSIONS.get(t, t) for t in _WS.split(text) if t]
    kept = [t for t in tokens if t not in DROPPABLE]
    # If dropping emptied the name, keep the original tokens: a place genuinely
    # called "The Limited" must not normalise to nothing.
    return " ".join(kept or tokens)


def compare(left: str, right: str) -> NameScore:
    if not left or not right:
        return NameScore(0.0, 0.0, comparable=False)
    if dominant_script(left) != dominant_script(right):
        # Comparing across scripts produces meaningless numbers; say so instead.
        return NameScore(0.0, 0.0, comparable=False)

    a, b = normalise(left), normalise(right)
    if not a or not b:
        return NameScore(0.0, 0.0, comparable=False)
    return NameScore(
        token=fuzz.token_set_ratio(a, b) / 100.0,
        char=fuzz.ratio(a, b) / 100.0,
        comparable=True,
    )


def osm_names(tags: dict[str, str]) -> list[str]:
    """Every name an OSM feature carries, not just the default one."""
    keys = [k for k in tags if k == "name" or k.startswith("name:")
            or k in {"alt_name", "official_name", "short_name", "old_name"}]
    values: list[str] = []
    for key in keys:
        # Semicolon-separated multi-values are common in alt_name.
        values.extend(v.strip() for v in tags[key].split(";") if v.strip())
    return values


def best_against_osm(external: str, tags: dict[str, str]) -> NameScore:
    """Score an external name against every name the feature carries."""
    scores = [compare(external, name) for name in osm_names(tags)]
    comparable = [s for s in scores if s.comparable]
    if not comparable:
        return NameScore(0.0, 0.0, comparable=False)
    return max(comparable, key=lambda s: s.best)


if __name__ == "__main__":
    tags = {"name": "St. Mary's C of E Primary School",
            "alt_name": "Saint Marys Primary"}
    score = best_against_osm("SAINT MARYS CHURCH OF ENGLAND PRIMARY", tags)
    logger.info("token=%.2f char=%.2f profile=%s",
                score.token, score.char, score.profile)
```

## Step-by-step walkthrough

1. **Keep the droppable list short and safe.** Legal suffixes and a couple of articles only. Words like "church", "school" and "hotel" look generic and are frequently the entire distinguishing content of a name.
2. **Expand rather than strip abbreviations.** Turning "St" into "saint" makes it match "Saint"; deleting it makes both names shorter and less distinctive.
3. **Guard against emptying a name.** A place called "The Limited" would normalise to nothing under a naive filter; falling back to the unfiltered tokens prevents that.
4. **Refuse cross-script comparisons.** A Latin and a Cyrillic name produce a meaningless similarity number that is nevertheless a number, and it will be used. Returning an explicit incomparable result is far better than returning zero, which looks like evidence of a mismatch.
5. **Score against every name the feature carries.** OSM features frequently carry `alt_name`, `official_name`, `short_name` and language variants, and the external dataset may use any of them. Comparing only against `name` throws away the easiest matches.
6. **Split semicolon multi-values.** `alt_name` in particular often holds several names separated by semicolons, as covered in [Splitting Semicolon-Separated OSM Tag Values](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/splitting-semicolon-separated-osm-tag-values/).
7. **Return a profile, not just a number.** Naming the shape of the difference — reordered, typo-like, consistent — is what makes an uncertain pair reviewable in seconds rather than minutes.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="fnm2-t fnm2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="fnm2-t">How each normalisation step affects a worked example name pair</title>
  <desc id="fnm2-d">A grid showing one external name and one OSM name progressing through four normalisation steps, with the token and character similarity after each. Before normalisation the two strings share little and both scores are low. After Unicode folding and case folding the character score rises modestly. After punctuation removal the token score rises sharply because apostrophes and full stops stopped splitting words. After abbreviation expansion both scores rise again because the abbreviated saint and church of England now match their expanded forms.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Where each normalisation step actually earns its place</text>
  <rect x="236" y="48" width="309" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="390" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Token score</text>
  <rect x="545" y="48" width="309" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="700" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Char score</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Raw strings</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="390" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">0.41</text>
  <text x="700" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">0.38</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Unicode and case folded</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="390" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">0.44</text>
  <text x="700" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">0.52</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Punctuation removed</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="390" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">0.71</text>
  <text x="700" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">0.58</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Abbreviations expanded</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="390" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">0.94</text>
  <text x="700" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">0.79</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Punctuation removal and abbreviation expansion do nearly all the work; suffix dropping contributes little and carries real risk.</text>
</svg>
<figcaption>Measuring each step on your own labelled sample is what stops normalisation from accumulating rules nobody can justify.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="fnm3-t fnm3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="fnm3-t">What the comparison profile tells a reviewer about an uncertain pair</title>
  <desc id="fnm3-d">Four profiles and the judgement each suggests. A consistent profile, where both scores agree and are high, needs no review. A reordered profile, where the token score is much higher than the character score, almost always indicates the same name written in a different word order and is usually a match. A typo-like profile, where the character score is much higher, indicates a spelling variant and is usually a match. An incomparable profile means no comparison was possible and the pair must be judged on other signals entirely.</desc>
  <defs><marker id="fnm3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four profiles, four different review actions</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">consistent</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">both scores agree</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">no review needed</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#fnm3-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">reordered</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">token beats char</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">usually a match</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#fnm3-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">typo-like</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">char beats token</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">usually a match</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#fnm3-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">incomparable</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">no comparison made</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">judge on other signals</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The last profile is the important one: it must not be treated as a low score, because no evidence was gathered either way.</text>
</svg>
<figcaption>Naming the profile is what turns a reviewer's minute of squinting at two strings into a two-second decision.</figcaption>
</figure>

## Verification

- **Known pairs score high.** Take twenty labelled true pairs and confirm the best score exceeds your intended threshold on nearly all of them.
- **Known non-pairs score low.** Twenty labelled false pairs, especially nearby similar businesses, should score well below it.
- **Reordered names are caught.** "Bar Vega" against "Vega Bar" should score high on token similarity and carry the reordered profile.
- **Cross-script pairs are incomparable.** A Latin name against a Cyrillic one must return the incomparable result, not zero.
- **Alternative names are used.** A feature whose `alt_name` matches but whose `name` does not should still produce a high score.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Distinct places score identically | Distinguishing word in the drop list | Remove generic-looking but meaningful words from it |
| A name normalises to nothing | Every token was droppable | Fall back to the unfiltered tokens |
| Reordered names score low | Only a character measure used | Add a token-set measure and keep both |
| Typos score low | Only a token measure used | Add a character measure and keep both |
| Cross-script pairs look like mismatches | Zero returned instead of incomparable | Detect the script and mark the pair incomparable |
| Easy matches missed | Only the default name compared | Compare against every name key the feature carries |
| Accented names never match | No Unicode normalisation | Apply compatibility normalisation before comparing |

## Specification reference

> The token set ratio compares two strings by splitting them into token sets and measuring similarity over the intersection and the differences, which makes it insensitive to word order and to extra tokens on either side. The simple ratio is based on the longest matching subsequence and is sensitive to character-level differences. See the [RapidFuzz documentation](https://rapidfuzz.github.io/RapidFuzz/) for the exact definitions of each scorer and their normalisation to a zero-to-one hundred range.

## Frequently Asked Questions

<details>
<summary>Should I strip generic words like "church" or "school"?</summary>

No. They look generic and for many places they are the entire distinguishing content of the name — a village with a church, a school and a pub may have three features whose names differ only in that word. Restrict the drop list to legal suffixes and a couple of articles, and expand abbreviations rather than deleting them. The risk of dropping a meaningful word is much larger than the gain from a slightly shorter comparison string.
</details>

<details>
<summary>Why keep two similarity scores instead of one combined number?</summary>

Because they fail on opposite things and the difference between them is diagnostic. A high token score with a low character score means the words match but were reordered; the reverse means the order is right but the spelling differs. A reviewer can judge those two cases in seconds, while a single blended number tells them only that something was partially similar.
</details>

<details>
<summary>How should I handle names in different scripts?</summary>

Mark the pair incomparable rather than scoring it. A similarity measure over two different alphabets returns a small number, and a small number looks like evidence that the names differ when in fact no comparison was possible. If your data genuinely spans scripts, transliterate deliberately into a common form as a separate, reviewable step — and keep both the original and the transliteration.
</details>

<details>
<summary>Which OSM name tags should I compare against?</summary>

All of them. A feature commonly carries a default name, one or more language variants, an official name, a short name and one or more alternative names, and an external dataset may use any of those. Comparing only the default name discards the easiest matches available. Split semicolon-separated multi-values as well, because alternative name tags frequently hold several names in one string.
</details>

## Related

- [Matching OSM Features to External Datasets](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/) — the parent topic and where this signal fits.
- [Scoring Conflation Candidates with Multiple Signals](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/scoring-conflation-candidates-with-multiple-signals/) — combining this with distance and category.
- [Splitting Semicolon-Separated OSM Tag Values](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/splitting-semicolon-separated-osm-tag-values/) — handling multi-valued name tags properly.
- [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — the same conservative normalisation discipline for other fields.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — the name namespace this reads.

Up one level: [Matching OSM Features to External Datasets](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Fuzzy Name Matching for OSM POI Conflation",
  "description": "Normalise place names non-destructively, compare them with token and character measures that behave differently on real data, and keep both scores rather than blending them.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Conflation & Data Enrichment",
  "about": ["fuzzy string matching", "name normalisation", "place name comparison"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Conflation & Data Enrichment", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/" },
    { "@type": "ListItem", "position": 3, "name": "Matching OSM Features to External Datasets", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/" },
    { "@type": "ListItem", "position": 4, "name": "Fuzzy Name Matching for OSM POI Conflation", "item": "https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/fuzzy-name-matching-for-osm-poi-conflation/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Compare place names for OSM conflation",
  "description": "Normalise conservatively into a comparison string, refuse cross-script comparisons, score with both a token-set and a character-edit measure, and compare against every name tag a feature carries.",
  "step": [
    { "@type": "HowToStep", "name": "Normalise non-destructively", "text": "Apply Unicode compatibility folding, case folding, punctuation removal and abbreviation expansion to produce a comparison string while keeping the original." },
    { "@type": "HowToStep", "name": "Keep the drop list minimal", "text": "Remove only legal suffixes and a couple of articles, never generic-looking words that distinguish real places." },
    { "@type": "HowToStep", "name": "Guard against empty results", "text": "Fall back to the unfiltered tokens when normalisation would leave nothing to compare." },
    { "@type": "HowToStep", "name": "Refuse cross-script pairs", "text": "Detect the dominant script on each side and return an explicit incomparable result rather than a misleading low score." },
    { "@type": "HowToStep", "name": "Score twice and keep both", "text": "Compute a token-set similarity and a character-edit similarity and retain each, since they fail on opposite things." },
    { "@type": "HowToStep", "name": "Compare against every name tag", "text": "Score the external name against the default name, language variants, official, short and alternative names, splitting semicolon multi-values." }
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
      "name": "Should I strip generic words like church or school from place names?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. They look generic and for many places they are the entire distinguishing content of the name. Restrict the drop list to legal suffixes and a couple of articles, and expand abbreviations rather than deleting them. The risk of dropping a meaningful word is much larger than the gain from a shorter comparison string." }
    },
    {
      "@type": "Question",
      "name": "Why keep two name similarity scores instead of one combined number?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because they fail on opposite things and the difference between them is diagnostic. A high token score with a low character score means the words match but were reordered; the reverse means the order is right but the spelling differs. A reviewer can judge those cases in seconds, while a blended number says only that something was partially similar." }
    },
    {
      "@type": "Question",
      "name": "How should I handle names in different scripts?",
      "acceptedAnswer": { "@type": "Answer", "text": "Mark the pair incomparable rather than scoring it. A similarity measure over two different alphabets returns a small number, and a small number looks like evidence that the names differ when no comparison was possible. If your data spans scripts, transliterate deliberately as a separate reviewable step and keep both forms." }
    },
    {
      "@type": "Question",
      "name": "Which OSM name tags should I compare against?",
      "acceptedAnswer": { "@type": "Answer", "text": "All of them. A feature commonly carries a default name, language variants, an official name, a short name and alternative names, and an external dataset may use any of those. Comparing only the default name discards the easiest matches. Split semicolon-separated multi-values as well." }
    }
  ]
}
</script>
