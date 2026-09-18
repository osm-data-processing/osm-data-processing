---
title: "Finding Statistical Outliers in OSM Tag Values"
description: "Surface the typos, unit confusions and misplaced decimal points in numeric and enumerated OSM tags, using robust statistics that survive the long tail real tag data always has."
pageTitle: "Detecting Outliers in OSM Tag Values"
pageDescription: "Find implausible heights, speeds and levels alongside near-miss spellings in categorical tags, with methods that do not collapse on skewed distributions or rare-but-valid values."
slug: finding-statistical-outliers-in-osm-tag-values
type: article
breadcrumb: "Tag Value Outliers"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Finding Statistical Outliers in OSM Tag Values

A building with `height=1500` is almost certainly metres confused with centimetres, and a `maxspeed=500` is almost certainly a decimal point in the wrong place — neither is invalid, and both will happily reach a consumer.

## Prerequisites

- [ ] Python 3.10+; the code below uses `statistics` and `difflib` from the standard library.
- [ ] Parsed tag values, per [Tag & Attribute Consistency Checks](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/).
- [ ] Enough features per category to make a distribution meaningful — hundreds, not dozens.
- [ ] A review path, since outlier detection produces candidates rather than verdicts.

## Conceptual minimum

Tag values come in two kinds and need different machinery.

**Numeric values** — `height`, `maxspeed`, `width`, `level`, `capacity` — have distributions, and the distributions are skewed and heavy-tailed. Most buildings are a few metres high; a few are three hundred. A mean-and-standard-deviation rule either flags every genuine skyscraper or nothing at all, because the tall buildings inflate the standard deviation that is supposed to catch them. The workable approach is the same robust machinery used for build thresholds — median and median absolute deviation — applied **within a category**, because a `building=house` and a `building=skyscraper` are not samples from the same distribution.

**Categorical values** — `surface`, `amenity`, `cuisine` — have frequency distributions with a very long tail, and the tail contains both genuine rare values and typos. `surface=aphalt` occurring eleven times against `surface=asphalt` occurring four million is a typo; `surface=woodchips` occurring eleven times is a real thing. Frequency alone cannot distinguish them; **frequency plus edit distance to a common value** usually can.

The unit confusion case deserves its own treatment because it is both common and detectable exactly. A value that is implausible as metres but entirely plausible as centimetres or feet is not a random outlier, it is a specific mistake, and reporting the suspected unit alongside the value is what makes the finding actionable rather than merely noticed.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="sto1-t sto1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sto1-t">Why a standard-deviation rule fails on OSM numeric tags</title>
  <desc id="sto1-d">Three panels. Building heights are heavily skewed, with the great majority between three and twenty metres and a long tail reaching three hundred, so a mean plus three standard deviations threshold lands far above any plausible error and catches nothing. Removing the tall buildings to fix that discards exactly the valid data the check should preserve. A median and median absolute deviation computed within a building category resists the tail entirely, keeps skyscrapers valid as skyscrapers, and still flags a house tagged as fifteen hundred metres.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Skew, and what survives it</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Mean and SD</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Tail inflates the SD</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Threshold lands too high</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Catches nothing useful</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Worse as data grows</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Trim the tall ones</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Threshold comes down</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Discards valid data</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Skyscrapers now errors</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Trades one failure for two</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Median and MAD</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Tail does not move it</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Computed per category</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Skyscrapers stay valid</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">House at 1500m flagged</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The middle panel is the common instinct and it turns a detection problem into a data-loss problem.</text>
</svg>
<figcaption>Robust statistics are not a refinement here; the naive version detects nothing at all.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import difflib
import logging
import re
import statistics
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.qa.outliers")

MIN_SAMPLE = 200          # below this a distribution means little
NUMERIC_K = 6.0           # generous: this is a review queue, not a gate
MIN_RARE = 50             # a value below this count may be a typo
TYPO_RATIO = 0.001        # ...if it is this much rarer than its neighbour

UNIT_SUFFIX = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*([a-z']*)\s*$", re.I)
# Plausible ranges in the tag's DOCUMENTED unit, used to name the mistake.
PLAUSIBLE = {"height": (0.5, 900.0), "width": (0.3, 100.0),
             "maxspeed": (5.0, 200.0), "capacity": (1.0, 20_000.0)}
UNIT_FACTORS = {"cm": 0.01, "mm": 0.001, "ft": 0.3048, "'": 0.3048,
                "km": 1000.0, "mph": 1.609344}


@dataclass(frozen=True)
class Outlier:
    osm_id: int
    key: str
    value: str
    category: str
    reason: str
    suspected: str | None = None


def parse_number(raw: str) -> tuple[float, str] | None:
    match = UNIT_SUFFIX.match(raw)
    if not match:
        return None
    try:
        return float(match.group(1)), match.group(2).lower()
    except ValueError:
        return None


def suspect_unit(key: str, value: float) -> str | None:
    """An implausible metre value that is plausible in another unit is not a
    random outlier; it is a specific, nameable mistake."""
    low, high = PLAUSIBLE.get(key, (float("-inf"), float("inf")))
    if low <= value <= high:
        return None
    for unit, factor in UNIT_FACTORS.items():
        if low <= value * factor <= high:
            return f"plausible if the value is {unit}: {value * factor:,.2f}"
    return None


def robust_spread(values: Sequence[float]) -> float:
    centre = statistics.median(values)
    return statistics.median([abs(v - centre) for v in values]) * 1.4826


def numeric_outliers(features: Iterable[tuple[int, Mapping[str, str]]],
                     key: str, category_key: str) -> list[Outlier]:
    """Group by category first: a house and a skyscraper are different
    distributions, and pooling them hides both ends."""
    groups: dict[str, list[tuple[int, float, str]]] = defaultdict(list)
    for osm_id, tags in features:
        raw = tags.get(key)
        if raw is None:
            continue
        parsed = parse_number(raw)
        if parsed is None:
            continue
        value, unit = parsed
        if unit in UNIT_FACTORS:            # explicit units are not errors
            value *= UNIT_FACTORS[unit]
        groups[tags.get(category_key, "unknown")].append((osm_id, value, raw))

    found: list[Outlier] = []
    for category, rows in groups.items():
        if len(rows) < MIN_SAMPLE:
            continue
        values = [v for _, v, _ in rows]
        centre = statistics.median(values)
        spread = robust_spread(values) or max(abs(centre) * 0.05, 0.1)
        low, high = centre - NUMERIC_K * spread, centre + NUMERIC_K * spread
        for osm_id, value, raw in rows:
            if low <= value <= high:
                continue
            found.append(Outlier(
                osm_id, key, raw, category,
                f"{value:,.2f} against a {category} median of {centre:,.2f} "
                f"(band {low:,.2f} to {high:,.2f})",
                suspect_unit(key, value)))
    logger.info("%s: %d numeric outlier(s)", key, len(found))
    return found


def categorical_outliers(features: Iterable[tuple[int, Mapping[str, str]]],
                         key: str) -> list[Outlier]:
    """Rarity alone cannot separate a typo from a genuinely rare value.
    Rarity plus closeness to a common value usually can."""
    counts = Counter(tags[key] for _, tags in features if key in tags)
    common = [v for v, n in counts.items() if n >= MIN_SAMPLE]
    total = sum(counts.values()) or 1

    suspicious: dict[str, str] = {}
    for value, n in counts.items():
        if n >= MIN_RARE:
            continue
        near = difflib.get_close_matches(value, common, n=1, cutoff=0.86)
        if near and n / max(counts[near[0]], 1) < TYPO_RATIO:
            suspicious[value] = near[0]

    found = [Outlier(osm_id, key, tags[key], "-",
                     f"{counts[tags[key]]} use(s) against "
                     f"{counts[suspicious[tags[key]]]:,} for a near-identical value",
                     f"probably {suspicious[tags[key]]!r}")
             for osm_id, tags in features
             if tags.get(key) in suspicious]
    logger.info("%s: %d suspected typo(s) across %d distinct value(s), "
                "%.4f%% of uses", key, len(found), len(suspicious),
                100 * sum(counts[v] for v in suspicious) / total)
    return found


if __name__ == "__main__":
    logger.info("robust bands per category; rarity plus edit distance for text")
```

## Step-by-step walkthrough

1. **Group numeric checks by category.** Pooling houses with towers produces a band wide enough to admit anything and narrow enough to flag legitimate tall buildings, depending on the mix.
2. **Normalise explicit units before comparing.** A value of `12 ft` is correctly tagged and must become metres before it enters the distribution, not be flagged for being small.
3. **Use the median and median absolute deviation.** The distributions are skewed and heavy-tailed, and the naive statistics are moved by exactly the values they should be detecting against.
4. **Keep the multiplier generous.** This produces a review queue, not a build failure, and a tight band buries the interesting findings in plausible ones.
5. **Name the suspected unit.** "1500 is implausible" is a finding; "1500 is implausible as metres but plausible as centimetres" is a fix.
6. **For categorical values, combine rarity with similarity.** Either signal alone produces mostly false positives; together they are precise enough to act on.
7. **Require a large frequency ratio.** A value used a thousand times is a real thing even if it is close to something more common, and the ratio is what encodes that.
8. **Report counts alongside findings.** Knowing a suspected typo accounts for eleven features out of four million sets the priority instantly.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 306" role="img" aria-labelledby="sto2-t sto2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sto2-t">Separating a typo from a genuinely rare tag value</title>
  <desc id="sto2-d">A decision with three branches applied to a rare categorical value. A value that is rare and not similar to any common value is most likely genuine, such as a niche surface material, and reporting it produces noise. A value that is rare and very similar to a much more common one is most likely a typo, such as surface equals aphalt beside surface equals asphalt, and the count ratio is what confirms it. A value that is similar to a common one but used thousands of times is a real variant that people deliberately use, such as a regional spelling, and belongs in the normalisation table rather than a defect queue.</desc>
  <defs><marker id="sto2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="306" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Rare, similar, or both</text>
  <rect x="26" y="117" width="250" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="151" y="145" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">How rare, and how similar?</text>
  <text x="151" y="167" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Rarity alone flags real values</text>
  <text x="151" y="185" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Similarity alone flags variants</text>
  <line x1="276" y1="161" x2="314" y2="161" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="314" y2="239" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="353" y2="83" stroke="currentColor" stroke-width="1.4" marker-end="url(#sto2-a)"/>
  <rect x="356" y="52" width="498" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="370" y="77" font-size="12" font-weight="700" fill="currentColor">Rare, not similar to anything</text>
  <text x="370" y="97" font-size="10.5" fill="currentColor" opacity="0.88">Probably genuine: a niche value that really exists</text>
  <line x1="314" y1="161" x2="353" y2="161" stroke="currentColor" stroke-width="1.4" marker-end="url(#sto2-a)"/>
  <rect x="356" y="130" width="498" height="62" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="370" y="155" font-size="12" font-weight="700" fill="currentColor">Rare and near-identical to a common value</text>
  <text x="370" y="175" font-size="10.5" fill="currentColor" opacity="0.88">Probably a typo: report it with both counts</text>
  <line x1="314" y1="239" x2="353" y2="239" stroke="currentColor" stroke-width="1.4" marker-end="url(#sto2-a)"/>
  <rect x="356" y="208" width="498" height="62" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="370" y="233" font-size="12" font-weight="700" fill="currentColor">Similar but used thousands of times</text>
  <text x="370" y="253" font-size="10.5" fill="currentColor" opacity="0.88">A real variant: add it to the normalisation table</text>
  <text x="868" y="290" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The third branch is the one that turns an outlier report into an improvement to the pipeline rather than an edit to the data.</text>
</svg>
<figcaption>Both signals are needed; each on its own produces mostly false positives.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 342" role="img" aria-labelledby="sto3-t sto3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="sto3-t">Five outlier signatures and what each one usually means</title>
  <desc id="sto3-d">A grid of five observed patterns against the mistake each usually indicates and the action it calls for. A value roughly one hundred times too large in a length tag indicates centimetres recorded without a unit, and the action is to convert and review. A value roughly three times too large in a metre-denominated tag indicates feet recorded as metres. A value ten times too large indicates a misplaced decimal point, which needs a human because the correct magnitude is ambiguous. A rare categorical value near-identical to a common one indicates a typo, and the action is to normalise it in the mapping table. A rare categorical value close to nothing indicates a genuine niche value, and the action is to leave it alone.</desc>
  <rect x="0" y="0" width="880" height="342" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Signature, cause, action</text>
  <rect x="216" y="48" width="319" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="376" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Usually means</text>
  <rect x="535" y="48" width="319" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="694" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Action</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">About 100x too large</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">centimetres, no unit</text>
  <text x="694" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">convert and review</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">About 3x too large</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">feet read as metres</text>
  <text x="694" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">convert and review</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Exactly 10x too large</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">misplaced decimal point</text>
  <text x="694" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">needs a human</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Rare, near a common value</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a typo</text>
  <text x="694" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">normalise in the table</text>
  <text x="30" y="289" font-size="11.5" font-weight="600" fill="currentColor">Rare, near nothing</text>
  <line x1="26" y1="308" x2="854" y2="308" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a genuine niche value</text>
  <text x="694" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">leave it alone</text>
  <text x="868" y="326" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The third row is the only one where the correct value is genuinely ambiguous, and it is the only one that cannot be automated.</text>
</svg>
<figcaption>Naming the likely cause is what separates a review queue people work through from one they do not.</figcaption>
</figure>

## Verification

- **A planted unit error is found.** Set a building height to 1500 and confirm the finding names centimetres.
- **Skyscrapers are not flagged.** Confirm genuinely tall buildings in the tall-building category pass.
- **Explicit units pass.** Tag a width as `12 ft` and confirm it is normalised rather than reported.
- **A planted typo is found.** Introduce a near-miss spelling at low frequency and confirm it is matched to its common neighbour.
- **Rare genuine values are not.** Confirm a legitimate uncommon value with no close neighbour produces nothing.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| No numeric outliers ever found | Mean and standard deviation on a skewed tail | Use the median and median absolute deviation |
| Tall buildings flagged as errors | One distribution for all building types | Group the distribution by category |
| Correctly tagged imperial values flagged | Units not normalised before comparison | Parse and convert the suffix first |
| Hundreds of false typo reports | Similarity used without a frequency ratio | Require the rare value to be far rarer |
| Real rare values reported as typos | Frequency used without similarity | Require a close match among common values |
| Findings nobody can act on | Value reported without the suspected cause | Name the suspected unit or spelling |
| Small categories produce nonsense | Distribution derived from a handful of rows | Require a minimum sample per category |

## Specification reference

> The `height` key is documented as a value in metres, with an optional explicit unit suffix such as `ft` permitted; values without a unit are metres by convention. The `maxspeed` key defaults to kilometres per hour, with `mph` and `knots` available as explicit suffixes. Consumers are expected to treat an absent unit as the documented default rather than inferring one from magnitude. See the OpenStreetMap wiki pages for `height`, `maxspeed` and units.

## Frequently Asked Questions

<details>
<summary>Should outliers be corrected automatically?</summary>

Numeric unit confusions are tempting because the correction is usually obvious, and it is still worth routing them through review — some of those values are simply wrong rather than mis-united, and a confident automated conversion turns an obvious error into a plausible one. Categorical typos are safer to normalise automatically in your own pipeline, where the mapping table makes the decision visible and reversible, but that is different from editing the upstream data.
</details>

<details>
<summary>How do you choose the category to group numeric values by?</summary>

By whatever makes the distribution unimodal. For heights that is usually the `building` value; for speeds it is the `highway` class; for widths it is a combination of `highway` and whether the way is in an urban area. The test is empirical: plot the distribution within a candidate grouping and see whether it has one hump. If it has two, the grouping is hiding a distinction that matters.
</details>

<details>
<summary>What about values that are outliers because the area is unusual?</summary>

This is the main source of false positives at continental scale, because a distribution computed across a continent does not describe any particular place in it. Computing bands per region as well as per category is the fix, and it needs enough features per region to be meaningful, which limits how finely you can slice. Where that is not possible, the finding should carry the region so a reviewer can apply local knowledge quickly.
</details>

<details>
<summary>Is edit distance the right similarity measure for tag values?</summary>

It works well for typos, which are what this check targets, and poorly for genuine alternatives that happen to be spelled differently. Keyboard-adjacency weighting improves it slightly; phonetic matching is worse, because tag values are not words people pronounce. The practical answer is that the simple ratio with a high cutoff catches most real typos, and the cases it misses are better handled by an explicit normalisation table than by a cleverer metric.
</details>

## Related

- [Tag & Attribute Consistency Checks](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/) — the parent topic.
- [Setting Quality Thresholds That Fail a Build](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/setting-quality-thresholds-that-fail-a-build/) — the same robust statistics across runs rather than within one.
- [Normalizing OSM Yes/No Tag Values](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/normalizing-osm-yes-no-tag-values/) — where confirmed variants should end up.
- [Splitting Semicolon-Separated OSM Tag Values](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/splitting-semicolon-separated-osm-tag-values/) — a structural cause of apparently rare values.
- [Generating an OSM Data Quality Report](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/generating-an-osm-data-quality-report/) — presenting a review queue of candidates.

Up one level: [Tag & Attribute Consistency Checks](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Finding Statistical Outliers in OSM Tag Values",
  "description": "Surface the typos, unit confusions and misplaced decimal points in numeric and enumerated OSM tags, using robust statistics that survive the long tail real tag data always has.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Quality & Validation",
  "about": ["outlier detection", "tag values", "unit confusion"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Quality & Validation", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/" },
    { "@type": "ListItem", "position": 3, "name": "Tag & Attribute Consistency Checks", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/" },
    { "@type": "ListItem", "position": 4, "name": "Finding Statistical Outliers in OSM Tag Values", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/finding-statistical-outliers-in-osm-tag-values/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Find outliers in OSM tag values",
  "description": "Group numeric tags by category, normalise explicit units, build a robust band from the median and median absolute deviation, and separate categorical typos from rare genuine values using both frequency and similarity.",
  "step": [
    { "@type": "HowToStep", "name": "Group numeric values by category", "text": "Compute distributions within a feature class, since a house and a tower are not samples from one distribution." },
    { "@type": "HowToStep", "name": "Normalise explicit units", "text": "Parse and convert suffixes such as ft or cm before comparing, so correct tagging is not reported." },
    { "@type": "HowToStep", "name": "Use robust statistics", "text": "Derive the band from the median and median absolute deviation, which the heavy tail cannot move." },
    { "@type": "HowToStep", "name": "Keep the multiplier generous", "text": "Produce a review queue rather than a gate, so the interesting findings are not buried in plausible ones." },
    { "@type": "HowToStep", "name": "Name the suspected unit", "text": "Report that an implausible metre value would be plausible as centimetres or feet, which turns a finding into a fix." },
    { "@type": "HowToStep", "name": "Combine rarity with similarity", "text": "Flag a categorical value only when it is both rare and near-identical to a far more common one." },
    { "@type": "HowToStep", "name": "Report counts with findings", "text": "Include both the rare and the common value's counts so priority is obvious at a glance." }
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
      "name": "Should OSM tag outliers be corrected automatically?",
      "acceptedAnswer": { "@type": "Answer", "text": "Numeric unit confusions are tempting but belong in review, since some values are simply wrong rather than mis-united and a confident conversion turns an obvious error into a plausible one. Categorical typos are safer to normalise inside your own pipeline through a visible mapping table, which is different from editing upstream data." }
    },
    {
      "@type": "Question",
      "name": "How do you choose the category to group numeric OSM values by?",
      "acceptedAnswer": { "@type": "Answer", "text": "By whatever makes the distribution unimodal — usually the building value for heights, the highway class for speeds. The test is empirical: plot the distribution within a candidate grouping and check it has one hump. Two humps mean the grouping hides a distinction that matters." }
    },
    {
      "@type": "Question",
      "name": "What about tag values that are outliers only because the area is unusual?",
      "acceptedAnswer": { "@type": "Answer", "text": "This is the main source of false positives at continental scale, since a continental distribution describes no particular place. Compute bands per region as well as per category where sample sizes allow, and otherwise attach the region to the finding so a reviewer can apply local knowledge." }
    },
    {
      "@type": "Question",
      "name": "Is edit distance the right similarity measure for tag values?",
      "acceptedAnswer": { "@type": "Answer", "text": "It works well for typos and poorly for genuine alternatives spelled differently. Phonetic matching is worse, since tag values are not words people pronounce. A simple ratio with a high cutoff catches most real typos, and the rest belong in an explicit normalisation table." }
    }
  ]
}
</script>
