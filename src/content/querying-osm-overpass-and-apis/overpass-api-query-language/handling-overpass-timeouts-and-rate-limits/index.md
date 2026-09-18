---
title: "Handling Overpass Timeouts and Rate Limits"
description: "A resilient Overpass client: slot-aware backoff that honours Retry-After, a disk cache keyed on the query, one shared concurrency limiter, and a response-size guard that fails fast."
pageTitle: "A Resilient Overpass Client: Backoff, Cache & Size Guards"
pageDescription: "Survive Overpass 429 and 504 responses with jittered exponential backoff, a query-keyed disk cache, a single shared semaphore, and an explicit response-size ceiling that fails before memory does."
slug: handling-overpass-timeouts-and-rate-limits
type: article
breadcrumb: "Timeouts & Rate Limits"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Handling Overpass Timeouts and Rate Limits

Turn a client that dies on the first HTTP 429 into one that rides a shared server's throttle, caches what it already fetched, and refuses to materialise a response too large to hold.

## Prerequisites

- [ ] Python 3.10+ with `requests` installed; the client below uses only the standard library beyond that.
- [ ] A query you have already narrowed — see [Overpass API Query Language](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/), because no client behaviour rescues a query that scans a continent.
- [ ] A writable cache directory, and a `logging` configuration so backoff decisions are visible.
- [ ] An identifying `User-Agent` string naming your project and a contact address.
- [ ] Optional: a private endpoint from [Running a Local Overpass Instance for Bulk Queries](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/running-a-local-overpass-instance-for-bulk-queries/) if your volume has outgrown the public one.

## Conceptual minimum

Overpass public instances allocate a small number of concurrent execution *slots* per client address, plus a rolling budget of execution time. When you exceed either, the server responds with HTTP 429 and, on most deployments, a body describing when a slot frees up. Separately, every query declares a timeout in its settings block; exceed it and the request ends as a gateway timeout, typically HTTP 504.

These two failures mean opposite things and need opposite responses. A **429 is about you** — you are asking too often — and the correct response is to slow down and keep the work you already have. A **504 is about the query** — it is too expensive to finish — and the correct response is to change the query, because retrying an identical query that just failed to complete will fail again in exactly the same way. A client that treats both as "retry later" will retry its way into a block on one and into an infinite loop on the other.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 260" role="img" aria-labelledby="otl1-t otl1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="otl1-t">How a client should respond to each Overpass failure status</title>
  <desc id="otl1-d">Three panels naming the right response to each status. A 429 means the client is asking too often, so the fix is to wait the interval the server named, halve concurrency and keep every result already fetched. A 504 means the query itself could not finish in its declared timeout, so retrying unchanged is pointless and the query must be narrowed spatially or split. A runtime error about memory means the candidate set exceeded the declared maxsize, so the filters must select fewer elements rather than the ceiling being raised.</desc>
  <rect x="0" y="0" width="880" height="260" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three statuses, three different fixes</text>
  <rect x="26" y="52" width="259" height="174" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">HTTP 429</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Meaning: you are asking too often</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Cause: slots or time budget spent</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Wait the interval the server named</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Halve concurrency for the run</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Keep everything already fetched</text>
  <text x="40" y="209" font-size="10.5" fill="currentColor" opacity="0.92">Retrying now escalates to a block</text>
  <rect x="311" y="52" width="259" height="174" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">HTTP 504</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Meaning: the query cannot finish</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Cause: too many candidate elements</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Retrying unchanged fails identically</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Narrow the spatial filter first</text>
  <text x="325" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Split by area or by tag</text>
  <text x="325" y="209" font-size="10.5" fill="currentColor" opacity="0.92">Raising timeout only delays it</text>
  <rect x="595" y="52" width="259" height="174" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Out of memory</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Meaning: candidate set too large</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Cause: filters select too broadly</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Reported as a runtime error</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Reduce elements, not the ceiling</text>
  <text x="609" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Add a tag filter before the area</text>
  <text x="609" y="209" font-size="10.5" fill="currentColor" opacity="0.92">maxsize is a guard, not a budget</text>
  <text x="868" y="244" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the first of these three is worth retrying automatically; the other two are bugs in the query that a retry loop will hide.</text>
</svg>
<figcaption>Blanket retry logic turns two query bugs into a silent loop, which is why the status has to steer the handler.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import hashlib
import json
import logging
import random
import threading
import time
from pathlib import Path

import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.overpass.client")

ENDPOINT = "https://overpass-api.de/api/interpreter"
USER_AGENT = "osm-pipeline-example/1.0 (contact@example.org)"
MAX_BYTES = 64 * 1024 * 1024          # refuse to materialise more than this
MAX_ATTEMPTS = 5


class QueryTooExpensive(RuntimeError):
    """The query itself cannot finish — retrying it unchanged will not help."""


class ResponseTooLarge(RuntimeError):
    """The response exceeded the client's hard size ceiling."""


class OverpassClient:
    def __init__(self, cache_dir: Path, max_concurrency: int = 1) -> None:
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        # ONE limiter for the whole process: adding workers must not multiply
        # the request rate against a shared public server.
        self._slots = threading.Semaphore(max_concurrency)
        self._session = requests.Session()
        self._session.headers["User-Agent"] = USER_AGENT

    def _cache_path(self, query: str) -> Path:
        digest = hashlib.sha256(query.encode("utf-8")).hexdigest()[:32]
        return self.cache_dir / f"{digest}.json"

    def _read_cache(self, query: str) -> dict | None:
        path = self._cache_path(query)
        if not path.exists():
            return None
        logger.info("cache hit for %s", path.name)
        return json.loads(path.read_text(encoding="utf-8"))

    def _write_cache(self, query: str, payload: dict) -> None:
        tmp = self._cache_path(query).with_suffix(".tmp")
        tmp.write_text(json.dumps(payload), encoding="utf-8")
        tmp.replace(self._cache_path(query))   # atomic: never a half-written cache

    def _stream_json(self, response: requests.Response) -> dict:
        """Read the body with a hard ceiling so a mis-scoped query fails fast."""
        chunks: list[bytes] = []
        total = 0
        for chunk in response.iter_content(chunk_size=1 << 16):
            total += len(chunk)
            if total > MAX_BYTES:
                response.close()
                raise ResponseTooLarge(f"response exceeded {MAX_BYTES} bytes")
            chunks.append(chunk)
        return json.loads(b"".join(chunks))

    def run(self, query: str, *, use_cache: bool = True) -> dict:
        if use_cache:
            cached = self._read_cache(query)
            if cached is not None:
                return cached

        delay = 2.0
        for attempt in range(1, MAX_ATTEMPTS + 1):
            with self._slots:
                started = time.monotonic()
                response = self._session.post(
                    ENDPOINT, data={"data": query}, timeout=300, stream=True)

            if response.status_code == 200:
                payload = self._stream_json(response)
                elapsed = time.monotonic() - started
                logger.info("ok in %.1fs, %d element(s)",
                            elapsed, len(payload.get("elements", [])))
                if use_cache:
                    self._write_cache(query, payload)
                return payload

            if response.status_code in (429, 503):
                wait = float(response.headers.get("Retry-After", delay))
                wait += random.uniform(0, wait * 0.25)   # jitter: never in lockstep
                logger.warning("throttled (%s), sleeping %.1fs (attempt %d/%d)",
                               response.status_code, wait, attempt, MAX_ATTEMPTS)
                time.sleep(wait)
                delay = min(delay * 2, 120)
                continue

            if response.status_code in (504, 400):
                # 504: the query ran out of time. 400 usually carries a runtime
                # error such as "Query run out of memory". Neither is retryable.
                raise QueryTooExpensive(
                    f"HTTP {response.status_code}: narrow the query, do not retry it")

            response.raise_for_status()

        raise RuntimeError(f"gave up after {MAX_ATTEMPTS} throttled attempts")


if __name__ == "__main__":
    client = OverpassClient(Path(".overpass-cache"))
    result = client.run(
        "[out:json][timeout:60];"
        'node["amenity"="drinking_water"](50.02,19.87,50.10,20.05);'
        "out center tags;"
    )
    logger.info("%d element(s)", len(result["elements"]))
```

## Step-by-step walkthrough

1. **Cache first, ask second.** The cache key is a hash of the exact query text, so an identical query never reaches the network twice. In development this removes the large majority of requests, because reruns dominate.
2. **Write the cache atomically.** The payload lands in a temporary file and is renamed into place, so an interrupted run leaves either the old cache entry or the new one, never a truncated file a later run would parse as valid.
3. **One semaphore for the process.** The limiter is an instance attribute shared by every caller, so adding threads increases parallel *work* without increasing the request rate against the shared endpoint.
4. **Stream with a ceiling.** The body is read in chunks and abandoned the moment it crosses the byte limit, so a query that accidentally selects a country fails in seconds rather than exhausting memory minutes later.
5. **Honour `Retry-After`.** When the server states how long to wait, that value is used verbatim; the exponential fallback only applies when the header is absent.
6. **Add jitter.** A quarter of the wait is randomised so a fleet of workers throttled at the same moment does not retry in a synchronised wave, which is what turns a throttle into a block.
7. **Refuse to retry a query bug.** A 504 or a memory runtime error raises immediately with a message that names the fix, because the same query will fail the same way however long you wait.
8. **Bound the attempts.** Five throttled attempts with doubling delay is roughly two minutes of patience; past that, surfacing the failure is more useful than looping.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 292" role="img" aria-labelledby="otl2-t otl2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="otl2-t">How the backoff delay grows across five throttled attempts</title>
  <desc id="otl2-d">A timeline of five attempts. The first request is throttled and the client waits about two seconds plus jitter. The second waits about four seconds. The third waits about eight. The fourth waits about sixteen, and by then concurrency has been halved for the rest of the run. After the fifth the client gives up and raises, because a throttle that has not cleared in two minutes is a capacity problem rather than a transient one.</desc>
  <defs><marker id="otl2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="292" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Doubling delay, capped patience</text>
  <line x1="26" y1="150" x2="848" y2="150" stroke="currentColor" stroke-width="1.8" marker-end="url(#otl2-a)"/>
  <rect x="35" y="52" width="189" height="66" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="130" y="76" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">attempt 1</text>
  <text x="130" y="94" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">throttled</text>
  <text x="130" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">wait about 2s</text>
  <line x1="130" y1="118" x2="130" y2="143" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="130" cy="150" r="5" fill="var(--osm-accent,#0369a1)"/>
  <rect x="242" y="176" width="189" height="66" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="336" y="200" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">attempt 2</text>
  <text x="336" y="218" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">still throttled</text>
  <text x="336" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">wait about 4s</text>
  <line x1="336" y1="176" x2="336" y2="157" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="336" cy="150" r="5" fill="var(--osm-ok,#15803d)"/>
  <rect x="449" y="52" width="189" height="66" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="544" y="76" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">attempt 3</text>
  <text x="544" y="94" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">still throttled</text>
  <text x="544" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">wait about 8s</text>
  <line x1="544" y1="118" x2="544" y2="143" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="544" cy="150" r="5" fill="var(--osm-warn,#a16207)"/>
  <rect x="656" y="176" width="189" height="66" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="750" y="200" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">give up</text>
  <text x="750" y="218" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">raise, do not loop</text>
  <text x="750" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">about 2 minutes total</text>
  <line x1="750" y1="176" x2="750" y2="157" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="750" cy="150" r="5" fill="var(--osm-alt,#6d28d9)"/>
  <text x="868" y="276" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Unbounded retry is indistinguishable from an attack from the server's side, and it hides a capacity problem from yours.</text>
</svg>
<figcaption>Bounded patience makes the failure visible to whoever scheduled the job, which is the person who can actually fix it.</figcaption>
</figure>

## Verification

- **A second identical run makes no network call.** Watch the log: the second invocation should report a cache hit and finish in milliseconds.
- **An interrupted run leaves no partial cache.** Kill the process mid-download and rerun; the query should be re-fetched cleanly, not parsed from a truncated file.
- **The size guard trips.** Point the client at a deliberately unbounded query and confirm it raises `ResponseTooLarge` within seconds rather than consuming memory.
- **A 504 does not retry.** Submit a query with an absurdly low declared timeout; the client should raise `QueryTooExpensive` immediately rather than sleeping.
- **Concurrency is actually capped.** Start ten threads against the client and count concurrent requests at the endpoint; the count must never exceed the configured limit.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="otl3-t otl3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="otl3-t">The four layers of a well-behaved Overpass client and what each one removes</title>
  <desc id="otl3-d">Four stacked layers. The cache layer removes repeat traffic entirely and is the single largest reduction in most projects. The limiter layer caps concurrent requests at one shared value so worker count and request rate stay independent. The backoff layer converts a throttle into a delay instead of an escalation. The guard layer refuses oversized responses and unretryable statuses so a bad query fails in seconds rather than minutes.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Each layer removes a different kind of waste</text>
  <rect x="26" y="50" width="828" height="52" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="42" y="72" font-size="12.5" font-weight="700" fill="currentColor">Cache</text>
  <text x="42" y="90" font-size="10.5" fill="currentColor" opacity="0.88">Serve an identical query from disk</text>
  <text x="838" y="82" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">removes repeat traffic</text>
  <rect x="26" y="112" width="828" height="52" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="42" y="134" font-size="12.5" font-weight="700" fill="currentColor">Limiter</text>
  <text x="42" y="152" font-size="10.5" fill="currentColor" opacity="0.88">One semaphore for the whole process</text>
  <text x="838" y="144" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">decouples workers from rate</text>
  <rect x="26" y="174" width="828" height="52" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="42" y="196" font-size="12.5" font-weight="700" fill="currentColor">Backoff</text>
  <text x="42" y="214" font-size="10.5" fill="currentColor" opacity="0.88">Honour Retry-After, add jitter</text>
  <text x="838" y="206" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">turns a throttle into a delay</text>
  <rect x="26" y="236" width="828" height="52" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="42" y="258" font-size="12.5" font-weight="700" fill="currentColor">Guards</text>
  <text x="42" y="276" font-size="10.5" fill="currentColor" opacity="0.88">Size ceiling and unretryable statuses</text>
  <text x="838" y="268" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">fails a bad query in seconds</text>
  <text x="868" y="308" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Built in this order, each layer makes the one below it matter less — which is why the cache is worth writing before the backoff.</text>
</svg>
<figcaption>Most teams write the backoff first and the cache last, and then wonder why the backoff is doing so much work.</figcaption>
</figure>

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Repeated 429 despite backoff | A limiter per worker instead of per process | Share one semaphore instance across all callers |
| Client hangs forever | No request timeout set | Always pass an explicit `timeout=` to the HTTP call |
| Memory exhausted on a big result | Body read in one call | Stream in chunks and enforce a byte ceiling |
| Cache never hits | Query text differs by whitespace between runs | Normalise the query string before hashing |
| Corrupt cache entry after a crash | Cache written in place | Write to a temporary file and rename atomically |
| Retry loop never ends | 504 treated as retryable | Raise on 504; narrow the query instead |
| Blocked despite polite backoff | No identifying `User-Agent` | Set an agent naming the project and a contact |

## Specification reference

> Public Overpass instances enforce a per-client limit on concurrent query slots and on cumulative execution time, and respond with HTTP 429 when either is exceeded; the `[timeout:n]` and `[maxsize:n]` settings declared in a query are upper bounds enforced by the server, not resource reservations. The [Overpass API usage policy and commonly used limits](https://wiki.openstreetmap.org/wiki/Overpass_API) describe the slot model and the expectation that clients identify themselves and back off rather than retry immediately.

## Frequently Asked Questions

<details>
<summary>Should I retry a 504 the way I retry a 429?</summary>

No. A 429 means you are asking too often and the same query will succeed once a slot frees up, so waiting is the correct response. A 504 means the query could not finish within its declared timeout, and an identical query submitted later will fail in exactly the same way. Treat a 504 as a signal to narrow the spatial filter, split the work by area or tag, or move to a local extract — never as something to sleep through.
</details>

<details>
<summary>Does raising maxsize fix an out-of-memory runtime error?</summary>

Only by letting a query that selects far too many elements run for longer before failing, usually on a server that other people are also using. The setting is a guard against a mis-scoped query, not a budget to spend. The real fix is to make the candidate set smaller: apply the spatial filter before the tag filters, replace a key-existence test with exact values, and check the element count with a cheap counting query before asking for any geometry.
</details>

<details>
<summary>How much should I cache, and for how long?</summary>

Cache every successful response keyed on the exact query text, and expire on a schedule that matches how fresh your consumers actually need the data. For development and test runs the cache can be effectively permanent, because reproducibility matters more than freshness. For scheduled production jobs an expiry matched to the job's cadence is usually right, and a cache that is never invalidated at all is a stale-data incident waiting to happen.
</details>

<details>
<summary>Why add jitter if the server tells me exactly how long to wait?</summary>

Because every client it throttled at the same moment was told the same interval. Without jitter a fleet of workers wakes up simultaneously and delivers a synchronised burst, which is more likely to be read as abuse than the original traffic was. A random fraction of the interval spreads the retries out at no cost to any single client's latency.
</details>

## Related

- [Overpass API Query Language](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/) — the parent topic; no client behaviour rescues a badly shaped query.
- [Running a Local Overpass Instance for Bulk Queries](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/running-a-local-overpass-instance-for-bulk-queries/) — the answer once backoff stops being enough.
- [Estimating the Cost of an Overpass Query](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/estimating-the-cost-of-an-overpass-query/) — sizing a query before you send it.
- [Batch Geocoding with Nominatim Without Getting Blocked](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/batch-geocoding-with-nominatim-without-getting-blocked/) — the same discipline applied to the geocoder.
- [Querying OSM: Overpass, Nominatim & APIs](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/) — the quota model behind all of this.

Up one level: [Overpass API Query Language](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Handling Overpass Timeouts and Rate Limits",
  "description": "A resilient Overpass client: slot-aware backoff that honours Retry-After, a disk cache keyed on the query, one shared concurrency limiter, and a response-size guard that fails fast.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Querying OSM: Overpass, Nominatim & APIs",
  "about": ["Overpass rate limits", "HTTP backoff", "query caching"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Querying OSM: Overpass, Nominatim & APIs", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/" },
    { "@type": "ListItem", "position": 3, "name": "Overpass API Query Language", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/" },
    { "@type": "ListItem", "position": 4, "name": "Handling Overpass Timeouts and Rate Limits", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/handling-overpass-timeouts-and-rate-limits/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Build an Overpass client that survives throttling",
  "description": "Add a query-keyed disk cache, a single process-wide concurrency limiter, jittered exponential backoff honouring Retry-After, and a hard response-size ceiling to an Overpass client.",
  "step": [
    { "@type": "HowToStep", "name": "Cache on the query text", "text": "Hash the exact query string and return a cached payload before making any network call." },
    { "@type": "HowToStep", "name": "Write the cache atomically", "text": "Write each payload to a temporary file and rename it into place so an interrupted run never leaves a truncated entry." },
    { "@type": "HowToStep", "name": "Share one limiter", "text": "Hold a single semaphore for the whole process so adding workers increases parallel work without increasing the request rate." },
    { "@type": "HowToStep", "name": "Stream with a ceiling", "text": "Read the response in chunks and abandon it once it crosses an explicit byte limit, failing fast on a mis-scoped query." },
    { "@type": "HowToStep", "name": "Back off on throttling only", "text": "Sleep for the Retry-After interval plus jitter on 429, doubling a fallback delay, and give up after a bounded number of attempts." },
    { "@type": "HowToStep", "name": "Raise on query bugs", "text": "Treat a gateway timeout or a memory runtime error as unretryable and surface a message naming the fix." }
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
      "name": "Should I retry a 504 the way I retry a 429?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. A 429 means you are asking too often and the same query will succeed once a slot frees up, so waiting is the correct response. A 504 means the query could not finish within its declared timeout, and an identical query submitted later will fail in exactly the same way. Treat a 504 as a signal to narrow the spatial filter, split the work by area or tag, or move to a local extract." }
    },
    {
      "@type": "Question",
      "name": "Does raising maxsize fix an out-of-memory runtime error?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only by letting a query that selects far too many elements run for longer before failing, usually on a server that other people are also using. The setting is a guard against a mis-scoped query, not a budget to spend. The real fix is to make the candidate set smaller: apply the spatial filter before the tag filters, replace a key-existence test with exact values, and check the element count with a cheap counting query first." }
    },
    {
      "@type": "Question",
      "name": "How much should I cache, and for how long?",
      "acceptedAnswer": { "@type": "Answer", "text": "Cache every successful response keyed on the exact query text, and expire on a schedule that matches how fresh your consumers actually need the data. For development and test runs the cache can be effectively permanent, because reproducibility matters more than freshness. For scheduled production jobs an expiry matched to the job's cadence is usually right." }
    },
    {
      "@type": "Question",
      "name": "Why add jitter if the server tells me exactly how long to wait?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because every client it throttled at the same moment was told the same interval. Without jitter a fleet of workers wakes up simultaneously and delivers a synchronised burst, which is more likely to be read as abuse than the original traffic was. A random fraction of the interval spreads the retries out at no cost to any single client's latency." }
    }
  ]
}
</script>
