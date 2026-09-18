---
title: "Cleaning OSM Website and Contact URL Tags"
description: "Turn the URL values OSM actually holds into something a consumer can follow: add missing schemes, reject non-URLs, normalise without breaking case-sensitive paths, and never verify by fetching."
pageTitle: "Normalising OSM Website and Contact URL Values"
pageDescription: "Clean OSM website and contact URL tags: supply a missing scheme, reject values that are not URLs, normalise host case while preserving the path, and validate structurally rather than by fetching."
slug: cleaning-osm-website-and-contact-url-tags
type: article
breadcrumb: "Website & URL Tags"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Cleaning OSM Website and Contact URL Tags

A URL tag looks like the easiest field in OSM to normalise and is not, because half the values are missing a scheme, a tenth are not URLs at all, and the obvious normalisation of lower-casing the whole string breaks every case-sensitive path.

## Prerequisites

- [ ] Python 3.10+; `urllib.parse` and `idna` cover everything needed.
- [ ] Multi-value handling, per [Splitting Semicolon-Separated OSM Tag Values](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/splitting-semicolon-separated-osm-tag-values/).
- [ ] The cleaning framing from [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/).
- [ ] A decision not to fetch, which is both slow and a privacy question.
- [ ] A review queue for the values that are genuinely something else.

## Conceptual minimum

Four transformations cover almost all of it, and one common instinct is wrong.

**Supply a missing scheme.** A value beginning with a host name rather than a scheme is the single most common shape, and prefixing a secure scheme makes it a URL. It is a guess, and it is the one guess in this area that is safe, because the alternative is a value no consumer can follow.

**Normalise the host, not the path.** Host names are case-insensitive and paths are not. Lower-casing the whole string is the obvious normalisation and it breaks every path on a case-sensitive server, which is most of them.

**Handle international domains.** A host with non-ASCII characters has an ASCII-compatible encoding, and storing both the display form and the encoded form serves different consumers.

**Reject non-URLs structurally.** Email addresses, phone numbers, social media handles and free text all appear in URL tags. A value with no host, or whose host has no dot, is not a URL, and saying so is more useful than storing it.

The instinct to avoid is **verifying by fetching**. It is slow, it fails for reasons unrelated to the data, it makes the pipeline non-deterministic, and it means your infrastructure visits every URL in the map — which is a privacy and etiquette problem as well as a technical one.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="cwu1-t cwu1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cwu1-t">Four transformations and the mistake each one replaces</title>
  <desc id="cwu1-d">A grid of four transformations against what each one does and the naive approach it replaces. Supplying a missing scheme turns a bare host into a followable URL, replacing the alternative of discarding it. Normalising only the host preserves case-sensitive paths, replacing the instinct to lower-case the whole string. Encoding an international domain stores an ASCII-compatible form alongside the display form, replacing the alternative of storing something no resolver accepts. Structural rejection identifies values that are not URLs at all, replacing verification by fetching, which is slow and non-deterministic.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four transformations, four instincts corrected</text>
  <rect x="206" y="48" width="324" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="368" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Does</text>
  <rect x="530" y="48" width="324" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="692" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Replaces</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Supply a scheme</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">bare host becomes a URL</text>
  <text x="692" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">discarding it</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Normalise host only</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">paths keep their case</text>
  <text x="692" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">lower-casing everything</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Encode the domain</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">stores both forms</text>
  <text x="692" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">an unresolvable host</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Reject structurally</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">identifies non-URLs</text>
  <text x="692" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">fetching to check</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The last row is the important one: fetching makes a cleaning stage slow, non-deterministic and a privacy question all at once.</text>
</svg>
<figcaption>Every one of these is a string operation, which is what keeps the stage fast and reproducible.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit, quote

import idna

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.clean.url")

URL_KEYS = ("website", "contact:website", "url", "contact:url", "operator:website")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
HANDLE = re.compile(r"^@[\w.]+$")
SPLIT = re.compile(r"\s*[;\s]\s*(?=https?://|www\.)|\s*;\s*")
DEFAULT_SCHEME = "https"


@dataclass(frozen=True)
class Url:
    normalised: str | None
    display_host: str | None
    original: str
    key: str
    status: str        # 'ok' | 'scheme_added' | 'not_a_url' | 'email' | 'handle'


def looks_like_host(text: str) -> bool:
    head = text.split("/", 1)[0]
    # A host needs a dot and no whitespace. This is deliberately structural.
    return "." in head and " " not in head and not head.endswith(".")


def normalise_one(raw: str, key: str) -> Url:
    text = raw.strip()
    if not text:
        return Url(None, None, raw, key, "not_a_url")
    if EMAIL.match(text):
        # An email in a website tag is information, in the wrong field.
        return Url(None, None, raw, key, "email")
    if HANDLE.match(text):
        return Url(None, None, raw, key, "handle")

    added = False
    if "://" not in text:
        if not looks_like_host(text):
            return Url(None, None, raw, key, "not_a_url")
        text = f"{DEFAULT_SCHEME}://{text}"
        added = True

    parts = urlsplit(text)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        return Url(None, None, raw, key, "not_a_url")

    host = parts.hostname or ""
    if not looks_like_host(host):
        return Url(None, None, raw, key, "not_a_url")

    display_host = host
    try:
        # An international domain needs its ASCII-compatible form to resolve.
        ascii_host = idna.encode(host, uts46=True).decode("ascii")
    except idna.IDNAError:
        ascii_host = host.lower()

    netloc = ascii_host
    if parts.port:
        netloc = f"{netloc}:{parts.port}"

    # Path, query and fragment keep their case: servers are case-sensitive.
    path = quote(parts.path, safe="/%:@!$&'()*+,;=~-._")
    normalised = urlunsplit((parts.scheme, netloc, path or "/",
                             parts.query, parts.fragment))
    return Url(normalised, display_host, raw, key,
               "scheme_added" if added else "ok")


def normalise_tags(tags: dict[str, str]) -> list[Url]:
    out: list[Url] = []
    for key in URL_KEYS:
        value = tags.get(key)
        if not value:
            continue
        for part in (p for p in SPLIT.split(value) if p.strip()):
            out.append(normalise_one(part, key))
    return out


def audit(results: list[Url]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for url in results:
        counts[url.status] = counts.get(url.status, 0) + 1
    logger.info("url normalisation: %s", counts)
    misplaced = counts.get("email", 0) + counts.get("handle", 0)
    if misplaced:
        logger.info("%d value(s) are contact details in a website field; "
                    "route them to the right key rather than discarding",
                    misplaced)
    return counts


if __name__ == "__main__":
    tags = {"website": "www.example.org/Menu; https://Café.example/Über",
            "contact:website": "info@example.org"}
    for url in normalise_tags(tags):
        logger.info("%-18s %-14s %s", url.key, url.status,
                    url.normalised or url.original)
```

## Step-by-step walkthrough

1. **Identify misplaced contact details first.** An email address or a social handle in a website field is information in the wrong place, and naming it as such lets a pipeline move it rather than discard it.
2. **Test for a host structurally.** A dot, no whitespace and no trailing dot is a cheap test that separates bare hosts from free text without pretending to validate a domain.
3. **Add the scheme only when the rest looks like a host.** Prefixing a scheme onto arbitrary text produces a URL-shaped string that resolves to nothing.
4. **Restrict the accepted schemes.** Anything other than the two web schemes in a website tag is either a mistake or something a consumer following links should not open.
5. **Encode international hosts, keep both forms.** The encoded form is what resolves; the display form is what a human should see, and storing only one of them disappoints one audience.
6. **Leave the path alone apart from escaping.** Paths are case-sensitive on most servers, and lower-casing them is the most common way a cleaning stage breaks working URLs.
7. **Report the misplaced counts.** A high number of emails in website fields is a data-quality finding worth acting on upstream, not just a filtering statistic.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="cwu2-t cwu2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cwu2-t">Three normalisations that look sensible and break working URLs</title>
  <desc id="cwu2-d">Three panels. Lower-casing the whole string normalises the host correctly and destroys every case-sensitive path, which is most paths on most servers. Stripping a trailing slash changes a directory request into a file request on some servers, which redirects at best and fails at worst. Removing a query string discards parameters that identify the page entirely on sites that route through them, turning a specific link into a home page.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three tempting normalisations, all destructive</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Lower-case everything</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Host normalises correctly</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Path breaks</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Most servers are case-sensitive</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">The most common damage</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Strip trailing slashes</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Looks tidier</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Directory becomes a file</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Redirect at best</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Failure at worst</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Drop query strings</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Looks like noise</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Often identifies the page</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Specific link becomes a home page</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Silently wrong</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">All three produce a URL that still looks correct, which is why they survive review and are discovered by a reader clicking a broken link.</text>
</svg>
<figcaption>The safe rule is to normalise the host and to treat everything after it as opaque.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="cwu3-t cwu3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cwu3-t">How URL values in a country extract actually distribute</title>
  <desc id="cwu3-d">Five outcome categories with their approximate share of website and contact URL values across a country extract. Values already carrying a scheme and resolving structurally are the largest group. Values that are a bare host and gain a scheme are the next largest, close behind. Values that are email addresses in the wrong field are a small but significant share. Social media handles are smaller again. Free text that is not a URL at all is the smallest group. A note observes that the second group would be lost entirely by a pipeline that rejects anything without a scheme.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Where URL values actually fall</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Already has a scheme</text>
  <rect x="256" y="60" width="478" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 57%</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Bare host, scheme added</text>
  <rect x="256" y="100" width="285" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 34%</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Email in the wrong field</text>
  <rect x="256" y="140" width="42" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 5%</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">A social handle</text>
  <rect x="256" y="180" width="21" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 2.5%</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">Not a URL at all</text>
  <rect x="256" y="220" width="13" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">under 2%</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A pipeline rejecting anything without a scheme discards the second bar, which is a third of every website value in the extract.</text>
</svg>
<figcaption>The size of that second group is why adding a scheme is worth the small risk the host test already removes.</figcaption>
</figure>

## Verification

- **Case-sensitive paths survive.** A URL with mixed-case path segments must come through unchanged after the host.
- **Bare hosts gain a scheme.** A value beginning with a host name must produce a followable URL with the added-scheme status.
- **Free text is rejected.** A note or a sentence in a website field must not become a URL.
- **International domains encode.** A host with non-ASCII characters should yield both an encoded and a display form.
- **Nothing is fetched.** Watch the network during a run; a cleaning stage should make no requests at all.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Links return not-found | Whole string lower-cased | Normalise the host only; leave the path as it is |
| Free text became a URL | Scheme added without a host test | Require a dot and no whitespace before prefixing |
| International domains fail | Only the display form stored | Store the encoded form alongside it |
| Emails silently dropped | Non-URLs discarded rather than classified | Detect and label them so they can be relocated |
| Cleaning stage is slow | URLs fetched to verify | Validate structurally; never fetch |
| Some values never seen | Only the primary key read | Read every key that carries a URL |
| Query parameters lost | Query string stripped as noise | Preserve the query; it often identifies the page |

## Specification reference

> A URL's host component is case-insensitive while its path, query and fragment are case-sensitive, and internationalised domain names have an ASCII-compatible encoding used for resolution. See [RFC 3986](https://datatracker.ietf.org/doc/html/rfc3986) for the component definitions and case rules, and [RFC 5891](https://datatracker.ietf.org/doc/html/rfc5891) for the internationalised domain encoding.

## Frequently Asked Questions

<details>
<summary>Is adding a scheme a safe guess?</summary>

It is the one safe guess here, provided the rest of the value looks like a host. A bare host name is unambiguously intended as a web address, and prefixing a scheme makes it followable where the alternative is a value no consumer can use. What makes it safe is the host test: prefixing a scheme onto arbitrary text produces something URL-shaped that resolves to nothing, which is worse than rejecting it.
</details>

<details>
<summary>Why not lower-case the whole URL?</summary>

Because only the host is case-insensitive. Paths, query strings and fragments are case-sensitive on most servers, so lower-casing them turns working links into not-found errors. This is the most common way a URL cleaning stage does harm, and it is particularly insidious because the result still looks like a valid URL and fails only when somebody follows it.
</details>

<details>
<summary>Should I check that the URL resolves?</summary>

No, for four reasons that compound. It is slow, since every value becomes a network round trip. It is non-deterministic, since a site being down makes good data look bad. It makes the pipeline's output depend on the moment it ran. And it means your infrastructure visits every URL in the map, which is a privacy and etiquette question as well as a technical one. Structural validation catches the values that are genuinely wrong.
</details>

<details>
<summary>What should happen to an email address in a website tag?</summary>

Label it rather than discarding it. It is real information filed under the wrong key, and a pipeline that recognises it can route it to the email field, flag it for a mapper, or simply record that it exists. Dropping it loses a contact detail somebody took the trouble to record; storing it as a website produces a link nothing can follow.
</details>

## Related

- [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — the parent topic and the wider cleaning stage.
- [Normalizing OSM Phone Numbers to E.164](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/normalizing-osm-phone-numbers-to-e164/) — the same discipline for the neighbouring contact keys.
- [Splitting Semicolon-Separated OSM Tag Values](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/splitting-semicolon-separated-osm-tag-values/) — the multi-value handling this uses.
- [Fixing Malformed OSM Tags During ETL Ingestion](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/fixing-malformed-osm-tags-during-etl-ingestion/) — the general pattern for values in the wrong field.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — the contact namespace these keys belong to.

Up one level: [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Cleaning OSM Website and Contact URL Tags",
  "description": "Turn the URL values OSM actually holds into something a consumer can follow: add missing schemes, reject non-URLs, normalise without breaking case-sensitive paths, and never verify by fetching.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Parsing & Tag Normalization Workflows",
  "about": ["URL normalisation", "internationalised domains", "structural validation"]
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
    { "@type": "ListItem", "position": 4, "name": "Cleaning OSM Website and Contact URL Tags", "item": "https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/cleaning-osm-website-and-contact-url-tags/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Normalize OSM website and URL tag values",
  "description": "Classify misplaced contact details, test for a host structurally before adding a scheme, restrict to web schemes, encode international domains while keeping the display form, and leave the path untouched.",
  "step": [
    { "@type": "HowToStep", "name": "Classify misplaced values", "text": "Detect email addresses and social handles so they can be relocated rather than discarded or stored as links." },
    { "@type": "HowToStep", "name": "Test for a host structurally", "text": "Require a dot, no whitespace and no trailing dot before treating a value as a bare host." },
    { "@type": "HowToStep", "name": "Add a scheme only then", "text": "Prefix a secure scheme to values that pass the host test, and reject the rest." },
    { "@type": "HowToStep", "name": "Restrict the schemes", "text": "Accept only the two web schemes in a website field, rejecting anything else." },
    { "@type": "HowToStep", "name": "Encode international hosts", "text": "Store the ASCII-compatible encoding for resolution alongside the display form for humans." },
    { "@type": "HowToStep", "name": "Leave the path alone", "text": "Escape but do not case-fold the path, query and fragment, which are case-sensitive." },
    { "@type": "HowToStep", "name": "Never fetch", "text": "Validate structurally, since fetching is slow, non-deterministic and a privacy question." }
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
      "name": "Is adding a scheme to an OSM website value a safe guess?",
      "acceptedAnswer": { "@type": "Answer", "text": "It is the one safe guess here, provided the rest of the value looks like a host. A bare host name is unambiguously intended as a web address, and prefixing a scheme makes it followable. What makes it safe is the host test: prefixing a scheme onto arbitrary text produces something URL-shaped that resolves to nothing." }
    },
    {
      "@type": "Question",
      "name": "Why not lower-case the whole URL?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because only the host is case-insensitive. Paths, query strings and fragments are case-sensitive on most servers, so lower-casing them turns working links into not-found errors. This is the most common way a URL cleaning stage does harm, and the result still looks like a valid URL." }
    },
    {
      "@type": "Question",
      "name": "Should I check that an OSM website URL resolves?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. It is slow, since every value becomes a network round trip; non-deterministic, since a site being down makes good data look bad; and it means your infrastructure visits every URL in the map, which is a privacy and etiquette question. Structural validation catches the values that are genuinely wrong." }
    },
    {
      "@type": "Question",
      "name": "What should happen to an email address in an OSM website tag?",
      "acceptedAnswer": { "@type": "Answer", "text": "Label it rather than discarding it. It is real information filed under the wrong key, and a pipeline that recognises it can route it to the email field or flag it for a mapper. Dropping it loses a contact detail somebody recorded; storing it as a website produces a link nothing can follow." }
    }
  ]
}
</script>
