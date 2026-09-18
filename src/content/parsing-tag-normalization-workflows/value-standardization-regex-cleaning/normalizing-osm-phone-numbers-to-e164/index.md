---
title: "Normalizing OSM Phone Numbers to E.164"
description: "Turn the free-text phone values OSM actually contains into a canonical international form, using the feature's country to resolve national numbers, and refusing to guess when it cannot."
pageTitle: "Canonicalising OSM Phone Tags into E.164"
pageDescription: "Parse OSM phone and contact values into E.164 using the feature's country for national numbers, split multi-valued tags, keep extensions, and route unparseable values to review."
slug: normalizing-osm-phone-numbers-to-e164
type: article
breadcrumb: "Phone Numbers"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Normalizing OSM Phone Numbers to E.164

A phone tag in OSM is free text, and the range of what appears there is wider than any regular expression usefully covers. The thing that makes normalization tractable is not a better pattern — it is knowing which country the feature is in.

## Prerequisites

- [ ] Python 3.10+ with `phonenumbers`, which carries the per-country metadata.
- [ ] The feature's country, from the administrative containment described in [Designing a Star Schema for OSM Features](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/designing-a-star-schema-for-osm-features/).
- [ ] Multi-value handling, per [Splitting Semicolon-Separated OSM Tag Values](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/splitting-semicolon-separated-osm-tag-values/).
- [ ] The cleaning discipline from [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/).
- [ ] A review queue, because some values genuinely cannot be resolved.

## Conceptual minimum

E.164 is the international canonical form: a plus sign, a country calling code, and the national number, with no spaces or punctuation and a maximum of fifteen digits. Two numbers in E.164 are equal if and only if they are the same number, which is what makes it worth converting to.

Three facts about OSM's phone values shape the work.

**Most values are national.** A number written as it would be dialled locally has no country code, so converting it requires knowing the country — and the only reliable source of that is the feature's location, not the string.

**Several keys carry phone numbers.** `phone`, `contact:phone`, `contact:mobile`, `fax` and `contact:fax` all appear, sometimes on the same feature with different values.

**Multi-valued is common.** A business with two lines writes both, separated by a semicolon, and occasionally by a slash or the word "or".

The rule that keeps this honest is that **an unparseable value is not dropped and not guessed at**. It is preserved and flagged, because a phone number that cannot be resolved is still information a human can use.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="npn1-t npn1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="npn1-t">Three kinds of phone value and what each needs to resolve</title>
  <desc id="npn1-d">Three panels. An international value already carrying a plus and a country code resolves without any context and is the easy case. A national value written as it would be dialled locally carries no country code and can only be resolved using the feature's country, which comes from its location rather than from the string. An ambiguous value, such as one with a country code but no plus, or an internal extension alone, cannot be resolved reliably at all and belongs in a review queue rather than being guessed at.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three kinds of value, three levels of certainty</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">International</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Already has plus and code</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Resolves with no context</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Validate and reformat</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">The easy case</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">National</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">As dialled locally</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Needs the feature country</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">From location, not text</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">The common case</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Ambiguous</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Code without a plus</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Or an extension alone</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Cannot resolve reliably</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Flag, never guess</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The second panel is the majority, which is why containment must be resolved before phone normalisation rather than after.</text>
</svg>
<figcaption>Guessing a country for the third panel produces a valid-looking number that dials somewhere else entirely.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import re
from dataclasses import dataclass

import phonenumbers
from phonenumbers import NumberParseException, PhoneNumberFormat

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.clean.phone")

PHONE_KEYS = ("phone", "contact:phone", "contact:mobile", "mobile",
              "fax", "contact:fax")
# Separators people actually use, beyond the conventional semicolon.
SPLIT = re.compile(r"\s*(?:;|/|\bor\b|,(?=\s*\+))\s*", re.I)
EXTENSION = re.compile(r"\s*(?:ext\.?|x|extension|durchwahl)\s*(\d{1,6})\s*$", re.I)


@dataclass(frozen=True)
class Phone:
    e164: str | None
    extension: str | None
    original: str
    key: str
    status: str        # 'ok' | 'invalid' | 'unparseable' | 'no_country'


def split_values(value: str) -> list[str]:
    return [p.strip() for p in SPLIT.split(value) if p.strip()]


def normalize_one(raw: str, country: str | None, key: str) -> Phone:
    """Parse one value. `country` comes from the feature's location."""
    text = raw.strip()
    extension = None
    match = EXTENSION.search(text)
    if match:
        # Extensions are not part of E.164; keep them separately rather than
        # letting the parser silently absorb or reject them.
        extension = match.group(1)
        text = text[:match.start()].strip()

    is_international = text.startswith("+") or text.startswith("00")
    if not is_international and not country:
        # A national number with no country is genuinely unresolvable. Guessing
        # produces a valid-looking number that dials somewhere else.
        return Phone(None, extension, raw, key, "no_country")

    try:
        parsed = phonenumbers.parse(text, None if is_international else country)
    except NumberParseException:
        return Phone(None, extension, raw, key, "unparseable")

    if not phonenumbers.is_valid_number(parsed):
        # Parsed but not a real number for that country: a typo or a
        # placeholder. Keep the original for review rather than discarding it.
        return Phone(None, extension, raw, key, "invalid")

    return Phone(phonenumbers.format_number(parsed, PhoneNumberFormat.E164),
                 extension, raw, key, "ok")


def normalize_tags(tags: dict[str, str], country: str | None) -> list[Phone]:
    out: list[Phone] = []
    for key in PHONE_KEYS:
        value = tags.get(key)
        if not value:
            continue
        for part in split_values(value):
            out.append(normalize_one(part, country, key))
    return out


def audit(results: list[Phone]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for phone in results:
        counts[phone.status] = counts.get(phone.status, 0) + 1
    total = sum(counts.values()) or 1
    logger.info("phone normalisation: %s (%.1f%% resolved)", counts,
                100 * counts.get("ok", 0) / total)
    if counts.get("no_country", 0):
        logger.warning("%d value(s) had no country: resolve administrative "
                       "containment before phone normalisation",
                       counts["no_country"])
    return counts


if __name__ == "__main__":
    tags = {"phone": "+48 12 345 67 89; 012 345 67 90 ext. 12",
            "contact:fax": "12 345 67 91"}
    for phone in normalize_tags(tags, country="PL"):
        logger.info("%-12s %-16s %-8s from %r", phone.key, phone.e164 or "-",
                    phone.status, phone.original)
```

## Step-by-step walkthrough

1. **Split on more than semicolons.** Slashes and the word "or" appear regularly, and a comma before a plus sign is almost always a separator rather than punctuation.
2. **Strip extensions before parsing.** E.164 has no place for them, and leaving one attached causes the parser either to reject the number or to absorb the digits into it.
3. **Detect international form from the prefix.** A value starting with a plus or a double zero carries its own country code and needs no context, which is worth checking before reaching for the feature's country.
4. **Refuse to guess a country.** A national number with no known country is unresolvable, and defaulting to a likely one produces a syntactically valid number that reaches a different country entirely.
5. **Distinguish unparseable from invalid.** A string the parser cannot make sense of and a well-formed number that does not exist in that country are different problems with different fixes.
6. **Keep the original always.** Every outcome retains the source value, so a human reviewing the flagged ones has something to work with.
7. **Report the status distribution.** A high proportion lacking a country means the containment step has not run, which is a pipeline ordering problem rather than a data problem.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="npn2-t npn2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="npn2-t">Four outcomes, what each means and what to do with it</title>
  <desc id="npn2-d">A grid of four statuses against their meaning and the appropriate action. An OK status means the value parsed and is a valid number for its country, and the canonical form can be used directly. An invalid status means the value parsed but is not a real number in that country, usually a typo or a placeholder, and belongs in a review queue. An unparseable status means the parser could make no sense of the string at all, which is usually a note or an address in the wrong field. A no-country status means a national number arrived without the feature's country, which is a pipeline ordering fault rather than a data fault.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four outcomes, four different responses</text>
  <rect x="196" y="48" width="329" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="360" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Means</text>
  <rect x="525" y="48" width="329" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="690" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Do</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">ok</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">valid for its country</text>
  <text x="690" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">use the canonical form</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">invalid</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">typo or placeholder</text>
  <text x="690" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">review the original</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">unparseable</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">not a number at all</text>
  <text x="690" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">review, likely wrong field</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">no_country</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="360" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">containment not resolved</text>
  <text x="690" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">fix the pipeline order</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The last row is the only one that indicates a fault in your pipeline rather than in the data, which makes it the first to check.</text>
</svg>
<figcaption>Collapsing these four into a simple success-or-failure loses the distinction between bad data and a bad pipeline.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="npn3-t npn3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="npn3-t">The order the stages must run in, and why</title>
  <desc id="npn3-d">Four stages in a required order. Administrative containment must run first, because it produces the country that national numbers cannot be resolved without. Multi-value splitting comes next, so each number is handled independently rather than the whole tag failing on one bad part. Extension stripping follows, since the canonical form cannot hold one and the parser will otherwise absorb or reject it. Parsing and validation come last, with each outcome carrying its original value forward.</desc>
  <defs><marker id="npn3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four stages, and the first one is not about phones</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">containment</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">resolve the country</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">before anything else</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#npn3-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">split</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">one number at a time</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">one bad part, one failure</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#npn3-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">strip extension</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">store it separately</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">E.164 has no slot</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#npn3-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">parse</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">validate per country</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">keep the original</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Running phone normalisation before containment is the most common ordering fault, and it shows up as a wall of unresolvable values.</text>
</svg>
<figcaption>Only the last stage is about phone numbers; the first three are about getting the input into a shape that can be parsed.</figcaption>
</figure>

## Verification

- **A known number round-trips.** Take a number you can verify and confirm the canonical form matches its published international form.
- **National numbers resolve.** With a country supplied, a locally-written number should produce the right country code.
- **No country means no guess.** Without a country, a national number must return the no-country status rather than any number at all.
- **Extensions survive.** A value with an extension should produce both a canonical number and the extension separately.
- **Multi-values split.** A tag with two numbers should produce two results, both resolved.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Numbers resolve to the wrong country | A default country assumed | Return a no-country status rather than guessing |
| Extensions lost or mangled | Extension left attached during parsing | Strip and store it before parsing the number |
| Only the first number kept | Value not split | Split on semicolons, slashes and the word "or" |
| Valid numbers rejected | Written in international form with a double zero | Treat a leading double zero as international |
| Everything reported unresolvable | Country not resolved before this stage | Run administrative containment first |
| Typos silently dropped | Invalid numbers discarded | Keep the original and flag it for review |
| Fax numbers missed | Only the primary key read | Read every key that carries a phone number |

## Specification reference

> E.164 defines the international public telecommunication numbering plan: a number consists of a country code followed by a national number, with a maximum of fifteen digits in total and no formatting characters. Parsing a national-format number into this form requires knowing the region it belongs to. See the [libphonenumber documentation](https://github.com/google/libphonenumber) for the parsing and validation semantics the library implements.

## Frequently Asked Questions

<details>
<summary>Why can a national number not be parsed without a country?</summary>

Because the same digits mean different numbers in different countries, and nothing in the string says which. A number written as it would be dialled locally omits the country code precisely because the caller is assumed to know it. Supplying a default country produces a syntactically valid number that reaches somewhere else entirely, which is worse than returning nothing because it looks correct.
</details>

<details>
<summary>Where does the country come from?</summary>

From the feature's location, through the administrative containment that a warehouse schema materialises anyway. That makes phone normalisation dependent on containment having run first, which is a pipeline ordering constraint worth stating explicitly — a large proportion of unresolvable phone values is usually a symptom of the two stages being in the wrong order.
</details>

<details>
<summary>What should happen to an extension?</summary>

Keep it in its own field. E.164 has no representation for an extension, so leaving it attached either causes the parse to fail or lets its digits be absorbed into the number, producing something that dials the wrong place. Splitting it out before parsing preserves both pieces, and a consumer that needs the extension has it while one that does not can ignore it.
</details>

<details>
<summary>Should invalid numbers be dropped?</summary>

No. A value that parses but is not a real number for its country is usually a typo, a transposed digit or a placeholder, all of which a human can recognise and often correct. Dropping it discards the evidence; keeping the original with an invalid flag routes it somewhere useful. The same applies to values the parser cannot make sense of at all, which are frequently addresses or notes entered in the wrong field.
</details>

## Related

- [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — the parent topic and the wider cleaning stage.
- [Cleaning OSM Website and Contact URL Tags](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/cleaning-osm-website-and-contact-url-tags/) — the same discipline for the neighbouring keys.
- [Splitting Semicolon-Separated OSM Tag Values](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/splitting-semicolon-separated-osm-tag-values/) — the multi-value handling this depends on.
- [Designing a Star Schema for OSM Features](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/modelling-osm-for-analytics-warehouses/designing-a-star-schema-for-osm-features/) — where the country this needs comes from.
- [Fixing Malformed OSM Tags During ETL Ingestion](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/fixing-malformed-osm-tags-during-etl-ingestion/) — the general pattern for values that will not parse.

Up one level: [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Normalizing OSM Phone Numbers to E.164",
  "description": "Turn the free-text phone values OSM actually contains into a canonical international form, using the feature's country to resolve national numbers, and refusing to guess when it cannot.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["E.164 normalisation", "phone parsing", "country resolution"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Parsing & Tag Normalization Workflows", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/" },
    { "@type": "ListItem", "position": 3, "name": "Value Standardization & Regex Cleaning", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/" },
    { "@type": "ListItem", "position": 4, "name": "Normalizing OSM Phone Numbers to E.164", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/normalizing-osm-phone-numbers-to-e164/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Normalize OSM phone values to E.164",
  "description": "Split multi-valued tags on the separators people use, strip extensions before parsing, detect international prefixes, resolve national numbers with the feature's country, and flag rather than guess.",
  "step": [
    { "@type": "HowToStep", "name": "Read every phone key", "text": "Collect values from the phone, contact, mobile and fax keys rather than only the primary one." },
    { "@type": "HowToStep", "name": "Split on real separators", "text": "Divide multi-valued tags on semicolons, slashes and the word or, as well as a comma preceding a plus sign." },
    { "@type": "HowToStep", "name": "Strip the extension", "text": "Remove and store any trailing extension before parsing, since the canonical form has no place for it." },
    { "@type": "HowToStep", "name": "Detect international form", "text": "Treat a leading plus or double zero as carrying its own country code and parse without context." },
    { "@type": "HowToStep", "name": "Resolve nationals with the country", "text": "Use the feature's administrative country to parse locally written numbers, and return a distinct status when it is unavailable." },
    { "@type": "HowToStep", "name": "Separate invalid from unparseable", "text": "Distinguish a well-formed number that does not exist from a string that is not a number at all." },
    { "@type": "HowToStep", "name": "Keep the original", "text": "Retain the source value on every outcome so flagged values remain useful to a reviewer." }
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
      "name": "Why can a national phone number not be parsed without a country?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because the same digits mean different numbers in different countries, and nothing in the string says which. A locally-dialled number omits the country code precisely because the caller knows it. Supplying a default produces a syntactically valid number that reaches somewhere else entirely, which is worse than returning nothing because it looks correct." }
    },
    {
      "@type": "Question",
      "name": "Where does the country for phone normalisation come from?",
      "acceptedAnswer": { "@type": "Answer", "text": "From the feature's location, through the administrative containment a warehouse schema materialises anyway. That makes phone normalisation dependent on containment having run first, and a large proportion of unresolvable values is usually a symptom of the two stages being in the wrong order." }
    },
    {
      "@type": "Question",
      "name": "What should happen to a phone extension?",
      "acceptedAnswer": { "@type": "Answer", "text": "Keep it in its own field. The canonical international form has no representation for an extension, so leaving it attached either fails the parse or lets its digits be absorbed into the number. Splitting it out before parsing preserves both pieces." }
    },
    {
      "@type": "Question",
      "name": "Should invalid phone numbers be dropped?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. A value that parses but is not a real number is usually a typo or a placeholder, which a human can often correct. Dropping it discards the evidence; keeping the original with a flag routes it somewhere useful. The same applies to values that are not numbers at all, frequently addresses entered in the wrong field." }
    }
  ]
}
</script>
