---
title: "Batch Geocoding with Nominatim Without Getting Blocked"
description: "Geocode a large address list against the public Nominatim instance by deduplicating first, throttling to one request per second, caching every answer, and resuming after a failure."
pageTitle: "Batch Geocode with Nominatim: Throttle, Cache, Resume"
pageDescription: "Run a large Nominatim batch inside the public usage policy: normalise and deduplicate inputs, hold one request per second, persist every result, and resume a half-finished run without re-asking."
slug: batch-geocoding-with-nominatim-without-getting-blocked
type: article
breadcrumb: "Batch Geocoding"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Batch Geocoding with Nominatim Without Getting Blocked

Geocode tens of thousands of addresses against a shared public service without exceeding its usage policy, and without losing a day's work when the process dies at input 34,000.

## Prerequisites

- [ ] Python 3.10+ with `requests`; the persistence layer below uses only `sqlite3` from the standard library.
- [ ] An identifying `User-Agent` naming your project and a real contact address — the public instance requires one.
- [ ] A cleaned address list. Address strings should already have been through the value standardisation described in [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/).
- [ ] The ranking model from [Nominatim Geocoding Pipelines](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/), because this script stores place rank and asserting on it is the point.
- [ ] A writable path for the SQLite result store.

## Conceptual minimum

The public Nominatim instance's usage policy allows roughly one request per second from a single source and requires an identifying user agent. That ceiling is not negotiable by writing a faster client, so the only levers available are **asking fewer times** and **never asking twice**.

Deduplication is the larger of the two. Address lists drawn from real systems repeat heavily — the same office, the same depot, the same postcode centroid — and collapsing them on a normalised key routinely removes a third or more of the work before a single request is made. Caching removes the rest: every result written to durable storage the moment it arrives means a rerun, a crash, or a second job over overlapping data costs nothing.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="bgn1-t bgn1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="bgn1-t">Where the requests go when a naive batch is progressively improved</title>
  <desc id="bgn1-d">Five bars showing how many requests a hypothetical fifty thousand row address list actually issues under successive improvements. The naive loop issues all fifty thousand. Trimming whitespace and normalising case collapses exact duplicates and removes roughly a fifth. Normalising punctuation and abbreviations removes more. Persisting every result so a rerun is free removes the entire second run. The remaining distinct addresses are the irreducible work.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Most of a geocoding batch is work you do not need to do</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Naive loop over rows</text>
  <rect x="296" y="60" width="438" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">50,000 requests</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Trim and case-fold</text>
  <rect x="296" y="100" width="350" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 40,000</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Normalise punctuation</text>
  <rect x="296" y="140" width="289" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 33,000</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Distinct addresses only</text>
  <rect x="296" y="180" width="272" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 31,000</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">Second run, with cache</text>
  <rect x="296" y="220" width="9" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">near zero</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Proportions vary by dataset but the shape does not: normalisation and persistence remove far more traffic than client tuning can.</text>
</svg>
<figcaption>The last bar is the one that matters most in practice, because development reruns outnumber production runs by a wide margin.</figcaption>
</figure>

Resumability is the third requirement and it falls out of the second for free. If every answer is persisted as it arrives, a run that dies is resumed by skipping the keys already present — no checkpoint file, no bookkeeping.

## Runnable solution

```python
from __future__ import annotations

import logging
import re
import sqlite3
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.nominatim.batch")

ENDPOINT = "https://nominatim.openstreetmap.org/search"
HEADERS = {"User-Agent": "osm-pipeline-example/1.0 (contact@example.org)"}
MIN_INTERVAL = 1.1          # seconds between requests; policy is ~1/sec
_WS = re.compile(r"\s+")
_PUNCT = re.compile(r"[.,;]+")


@dataclass(frozen=True)
class Address:
    street: str
    city: str
    postalcode: str
    country: str

    def key(self) -> str:
        """A normalised, order-stable key used for dedupe and for the cache."""
        parts = (self.street, self.city, self.postalcode, self.country)
        cleaned = []
        for part in parts:
            # NFKC folds compatibility forms; casefold is stronger than lower().
            text = unicodedata.normalize("NFKC", part).casefold()
            text = _PUNCT.sub(" ", text)
            cleaned.append(_WS.sub(" ", text).strip())
        return "|".join(cleaned)


def open_store(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS geocode (
            key         TEXT PRIMARY KEY,
            lat         REAL,
            lon         REAL,
            place_rank  INTEGER,
            osm_type    TEXT,
            osm_id      INTEGER,
            resolved_at TEXT NOT NULL,
            status      TEXT NOT NULL      -- 'ok' or 'no_match'
        )
    """)
    conn.commit()
    return conn


def already_done(conn: sqlite3.Connection, key: str) -> bool:
    row = conn.execute("SELECT 1 FROM geocode WHERE key = ?", (key,)).fetchone()
    return row is not None


def geocode_one(session: requests.Session, addr: Address) -> dict | None:
    """One structured, country-constrained lookup. Returns the top candidate."""
    params = {
        "street": addr.street,
        "city": addr.city,
        "postalcode": addr.postalcode,
        "countrycodes": addr.country,      # removes the wrong-country class entirely
        "format": "jsonv2",
        "addressdetails": 1,
        "limit": 1,
    }
    response = session.get(ENDPOINT, params=params, timeout=30)
    if response.status_code in (429, 503):
        wait = float(response.headers.get("Retry-After", 30))
        logger.warning("throttled, sleeping %.0fs", wait)
        time.sleep(wait)
        return geocode_one(session, addr)
    response.raise_for_status()
    results = response.json()
    return results[0] if results else None


def run_batch(addresses: list[Address], store: Path) -> None:
    conn = open_store(store)
    session = requests.Session()
    session.headers.update(HEADERS)

    # Dedupe on the normalised key, preserving one representative per key.
    unique: dict[str, Address] = {}
    for addr in addresses:
        unique.setdefault(addr.key(), addr)
    logger.info("%d row(s) collapsed to %d distinct address(es)",
                len(addresses), len(unique))

    pending = [(k, a) for k, a in unique.items() if not already_done(conn, k)]
    logger.info("%d already cached, %d to fetch", len(unique) - len(pending), len(pending))

    last = 0.0
    for i, (key, addr) in enumerate(pending, start=1):
        # Throttle on the wall clock, not with a fixed sleep: local work is free.
        gap = MIN_INTERVAL - (time.monotonic() - last)
        if gap > 0:
            time.sleep(gap)
        last = time.monotonic()

        hit = geocode_one(session, addr)
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        if hit is None:
            conn.execute(
                "INSERT INTO geocode (key, resolved_at, status) VALUES (?, ?, 'no_match')",
                (key, now))
        else:
            conn.execute(
                "INSERT INTO geocode (key, lat, lon, place_rank, osm_type, osm_id,"
                " resolved_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'ok')",
                (key, float(hit["lat"]), float(hit["lon"]),
                 int(hit.get("place_rank", -1)), hit.get("osm_type"),
                 int(hit.get("osm_id", 0)), now))
        conn.commit()          # commit per row: a crash loses at most one lookup
        if i % 100 == 0:
            logger.info("%d/%d fetched", i, len(pending))

    conn.close()


if __name__ == "__main__":
    sample = [
        Address("Rynek Główny 1", "Kraków", "31-042", "pl"),
        Address("rynek glowny 1 ", "KRAKÓW", "31-042", "pl"),   # same key
    ]
    run_batch(sample, Path("geocode.sqlite"))
```

## Step-by-step walkthrough

1. **Normalise into a key, not into the query.** The key is casefolded, punctuation-stripped and whitespace-collapsed, but the *query* still sends the original strings. Normalising the query itself can degrade matching; normalising only the cache key cannot.
2. **Use `NFKC` plus `casefold`.** Unicode normalisation folds compatibility forms so visually identical strings hash together, and `casefold` handles cases that `lower()` does not.
3. **Dedupe before counting the work.** The log line reporting rows collapsed to distinct addresses is the first useful number in the run, and it is usually a pleasant surprise.
4. **Skip what is already stored.** Resumability needs no checkpoint file: the store is the checkpoint, and `already_done` is the whole resume logic.
5. **Query structurally, with a country constraint.** Separate street, city and postcode fields remove parser guesswork, and the country code removes the wrong-country failure class entirely.
6. **Throttle on the clock, not with a fixed sleep.** Sleeping a full second after each request adds the request's own duration on top. Measuring the gap since the last request keeps the actual rate at the intended one.
7. **Record no-match as a result.** An address that does not resolve is an answer worth storing; without it, every rerun retries the same hopeless inputs at one per second.
8. **Commit per row.** The write cost is negligible next to a one-second interval, and it means a crash loses at most a single lookup.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="bgn2-t bgn2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="bgn2-t">The batch loop, from raw rows to a durable result store</title>
  <desc id="bgn2-d">Four stages. Normalising builds a stable key from each address without changing the query that will be sent. Deduplicating collapses rows sharing a key so each distinct address is fetched once. The fetch stage throttles on the wall clock, sends a structured country-constrained query, and handles a throttle response by waiting the interval the server named. The persist stage writes each result, including explicit no-match results, and commits immediately so the store doubles as the resume checkpoint.</desc>
  <defs><marker id="bgn2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four stages, and the store is the checkpoint</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">normalise</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">build a stable key</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">query keeps originals</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#bgn2-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">dedupe</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">one fetch per key</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">usually a third fewer</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#bgn2-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">fetch</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">throttle on the clock</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">structured, constrained</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#bgn2-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">persist</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">store no-match too</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">commit every row</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Storing an explicit no-match is what stops each rerun from retrying every hopeless input at one request per second.</text>
</svg>
<figcaption>There is no separate checkpoint file because there does not need to be one: the result store already knows what is finished.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 260" role="img" aria-labelledby="bgn3-t bgn3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="bgn3-t">What to store per geocode and what each stored field prevents</title>
  <desc id="bgn3-d">Three panels describing the durable record. The coordinate and object reference panel notes that both are needed because the coordinate answers where and the reference answers what, and that storing only the coordinate makes later re-resolution impossible. The quality panel covers place rank and status, which together distinguish a real address match from a coarser fallback and from an input that matched nothing. The provenance panel covers the resolution timestamp, which is what makes later coordinate drift explainable rather than alarming.</desc>
  <rect x="0" y="0" width="880" height="260" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three groups of stored fields, three problems avoided</text>
  <rect x="26" y="52" width="259" height="174" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Where and what</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Latitude and longitude</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">OSM type and identifier</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Coordinate answers where</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Reference answers what</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Without the reference you</text>
  <text x="40" y="209" font-size="10.5" fill="currentColor" opacity="0.92">cannot re-resolve later</text>
  <rect x="311" y="52" width="259" height="174" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">How good</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Place rank of the match</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Explicit ok or no-match</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Rank exposes a fallback</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Status stops retry loops</text>
  <text x="325" y="188" font-size="10.5" fill="currentColor" opacity="0.92">A city rank for a house</text>
  <text x="325" y="209" font-size="10.5" fill="currentColor" opacity="0.92">number is not a match</text>
  <rect x="595" y="52" width="259" height="174" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">When</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Resolution timestamp</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">UTC, not local</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Explains later drift</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Drives re-resolution</text>
  <text x="609" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Without it, every change</text>
  <text x="609" y="209" font-size="10.5" fill="currentColor" opacity="0.92">looks like a regression</text>
  <text x="868" y="244" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The middle panel is the one most often omitted, and its absence is why fallback coordinates end up stored as if they were buildings.</text>
</svg>
<figcaption>Each group answers a question a later maintainer will definitely ask, and none of them can be reconstructed after the fact.</figcaption>
</figure>

## Verification

- **The dedupe ratio is reported and plausible.** A list of fifty thousand rows collapsing to fifty thousand distinct keys means normalisation is not working.
- **The observed rate is at or below one per second.** Time a hundred-row run; it must take at least a hundred seconds.
- **A rerun fetches nothing.** Run the same batch twice; the second run should report everything cached and issue no requests.
- **A killed run resumes correctly.** Interrupt mid-batch and restart; the fetch count should drop by exactly the number already stored.
- **Place rank is stored and inspected.** Query the store for results whose rank is coarser than an address; those are fallbacks, not matches, and should be reviewed rather than used.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| HTTP 403 on every request | No identifying `User-Agent` | Set an agent naming the project and a contact address |
| Persistent 429 despite sleeping | Sleep placed after the request, not measured between | Throttle on elapsed monotonic time since the last call |
| Rerun re-fetches everything | Key built from the raw string | Normalise with `NFKC` and `casefold` before hashing |
| Every rerun retries the same failures | No-match results not persisted | Store an explicit `no_match` status row |
| Coordinates in a neighbouring country | No country constraint | Pass `countrycodes` on every structured query |
| Crash loses hours of work | Commit deferred to the end | Commit after each row; the cost is negligible |
| Suspiciously round coordinates | Result is a postcode or city centroid | Check `place_rank` and reject coarse fallbacks |

## Specification reference

> The Nominatim usage policy for the public instance limits clients to an absolute maximum of one request per second, requires a valid `User-Agent` or `Referer` identifying the application, and asks that results be cached rather than re-requested. Bulk geocoding of large address lists against the public instance is explicitly outside the policy. See the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) for the current wording and the recommendation to self-host beyond small volumes.

## Frequently Asked Questions

<details>
<summary>Can I run several workers to go faster?</summary>

Not against the public instance. The limit applies to your source, not to each process, so parallel workers simply reach the same ceiling faster and then get blocked. If the batch genuinely needs to finish faster, the answer is a private import, which removes the limit entirely. Within the public instance the only real speed-ups are asking fewer times through deduplication and never asking twice through caching.
</details>

<details>
<summary>Should I normalise the address before sending it?</summary>

Normalise the cache key aggressively and the query barely at all. The geocoder's own tokeniser handles punctuation and case perfectly well, and over-normalising the query — stripping accents, expanding abbreviations incorrectly — can turn a match into a miss. Keeping the two separate lets deduplication be as aggressive as you like without any risk to matching quality.
</details>

<details>
<summary>What should I store for each result?</summary>

The coordinate, the matched object's type and identifier, the place rank, the resolution timestamp, and an explicit status for inputs that did not match. The timestamp makes later drift explainable, the place rank makes fallbacks detectable, and the explicit no-match status is what stops every rerun from retrying hopeless inputs at one request per second.
</details>

<details>
<summary>Is it acceptable to geocode a hundred thousand addresses this way?</summary>

Not against the public instance. Even perfectly throttled, that is well over a day of continuous requesting against a shared volunteer-funded service, and the usage policy names bulk geocoding as out of scope. Deduplicate first and you may find the distinct count is far smaller than the row count; if it is still in the tens of thousands, import your own instance instead.
</details>

## Related

- [Nominatim Geocoding Pipelines](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/) — the parent topic and the ranking model this batch stores.
- [Importing Nominatim from an OSM Extract](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/importing-nominatim-from-an-osm-extract/) — the answer once the batch stops fitting inside the policy.
- [Parsing Nominatim Address Details into Columns](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/parsing-nominatim-address-details-into-columns/) — turning stored results into an assertable table.
- [Handling Overpass Timeouts and Rate Limits](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/handling-overpass-timeouts-and-rate-limits/) — the same discipline for the query engine.
- [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — cleaning the input list before any of this starts.

Up one level: [Nominatim Geocoding Pipelines](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Batch Geocoding with Nominatim Without Getting Blocked",
  "description": "Geocode a large address list against the public Nominatim instance by deduplicating first, throttling to one request per second, caching every answer, and resuming after a failure.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Querying OSM: Overpass, Nominatim & APIs",
  "about": ["batch geocoding", "Nominatim usage policy", "request throttling"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Querying OSM: Overpass, Nominatim & APIs", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/" },
    { "@type": "ListItem", "position": 3, "name": "Nominatim Geocoding Pipelines", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/" },
    { "@type": "ListItem", "position": 4, "name": "Batch Geocoding with Nominatim Without Getting Blocked", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/batch-geocoding-with-nominatim-without-getting-blocked/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Run a large Nominatim geocoding batch inside the usage policy",
  "description": "Collapse duplicate addresses on a normalised key, throttle to one request per second measured on the clock, persist every answer including non-matches, and resume from the store.",
  "step": [
    { "@type": "HowToStep", "name": "Build a normalised key", "text": "Casefold, fold Unicode compatibility forms, strip punctuation and collapse whitespace to produce a stable dedupe and cache key, leaving the query text untouched." },
    { "@type": "HowToStep", "name": "Collapse duplicates", "text": "Keep one representative address per key so each distinct address is fetched exactly once." },
    { "@type": "HowToStep", "name": "Skip what is stored", "text": "Query the result store for each key before fetching, so a restarted run resumes without any separate checkpoint." },
    { "@type": "HowToStep", "name": "Throttle on elapsed time", "text": "Measure the interval since the previous request and sleep only the remainder, so local work does not push the real rate below the intended one." },
    { "@type": "HowToStep", "name": "Query structurally", "text": "Send street, city and postcode as separate fields with a country constraint, and request address details." },
    { "@type": "HowToStep", "name": "Persist every outcome", "text": "Write coordinate, object reference, place rank, timestamp and an explicit non-match status, committing after each row." }
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
      "name": "Can I run several workers to geocode faster?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not against the public instance. The limit applies to your source, not to each process, so parallel workers simply reach the same ceiling faster and then get blocked. If the batch genuinely needs to finish faster, the answer is a private import. Within the public instance the only real speed-ups are asking fewer times through deduplication and never asking twice through caching." }
    },
    {
      "@type": "Question",
      "name": "Should I normalise the address before sending it?",
      "acceptedAnswer": { "@type": "Answer", "text": "Normalise the cache key aggressively and the query barely at all. The geocoder's own tokeniser handles punctuation and case perfectly well, and over-normalising the query can turn a match into a miss. Keeping the two separate lets deduplication be as aggressive as you like without any risk to matching quality." }
    },
    {
      "@type": "Question",
      "name": "What should I store for each geocoding result?",
      "acceptedAnswer": { "@type": "Answer", "text": "The coordinate, the matched object's type and identifier, the place rank, the resolution timestamp, and an explicit status for inputs that did not match. The timestamp makes later drift explainable, the place rank makes fallbacks detectable, and the explicit non-match status stops every rerun from retrying hopeless inputs." }
    },
    {
      "@type": "Question",
      "name": "Is it acceptable to geocode a hundred thousand addresses this way?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not against the public instance. Even perfectly throttled, that is well over a day of continuous requesting against a shared volunteer-funded service, and the usage policy names bulk geocoding as out of scope. Deduplicate first and you may find the distinct count is far smaller than the row count; if it is still in the tens of thousands, import your own instance instead." }
    }
  ]
}
</script>
