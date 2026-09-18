---
title: "Mirroring OSM Downloads Behind a Local Cache"
description: "One verified fetch serving a whole fleet of jobs: content-addressed storage keyed on the published digest, a single-flight lock, and an explicit fallback when the provider is unreachable."
pageTitle: "Cache OSM Extracts Once for a Whole Fleet of Jobs"
pageDescription: "Stop every job re-downloading the same OSM extract: store fetched files content-addressed by their published digest, serialise concurrent fetches, and fall back deliberately during a provider outage."
slug: mirroring-osm-downloads-behind-a-local-cache
type: article
breadcrumb: "Local Download Cache"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Mirroring OSM Downloads Behind a Local Cache

Give a fleet of jobs one shared, verified copy of each OSM extract, so ten workers transfer one file rather than ten — and so two workers can never end up silently reading different days of the map.

## Prerequisites

- [ ] Shared storage every job can reach: a network filesystem, or an object store with a local mount.
- [ ] The verifying download client from [Automating Geofabrik Extract Downloads with Checksums](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/automating-geofabrik-extract-downloads-with-checksums/); this page wraps it rather than replacing it.
- [ ] Python 3.10+ with `requests` and `filelock`, or an equivalent cross-process lock.
- [ ] A retention policy decided in advance: how many historical versions are worth keeping?
- [ ] An explicit position on what should happen when the provider is unreachable.

## Conceptual minimum

The cache has one job: **make "the extract for region R at version V" a name that resolves to the same bytes for every job, forever.**

That points straight at content addressing. Keying the cache on the provider's *published digest* rather than on a filename or a date gives three properties at once. Two jobs asking for the same version provably get the same bytes. A provider republishing under the same filename produces a different key rather than silently changing the file underneath a running job. And an archived result can name the exact input it used, which is what makes a run reproducible months later.

The second requirement is **single flight**. Ten jobs starting simultaneously must produce one download, not ten. A cross-process lock around the fetch, with a re-check of the cache after acquiring it, is all that takes.

The third is a **deliberate outage policy**. When the provider is unreachable, the cache still holds the last good version. Serving it is usually right and occasionally catastrophic, so the choice must be explicit and must be visible in the logs when it is exercised.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 290" role="img" aria-labelledby="mdc1-t mdc1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mdc1-t">How ten jobs asking for one extract become one download</title>
  <desc id="mdc1-d">Ten concurrent jobs all request the same region. A cache lookup keyed on the published digest resolves nine of them immediately once the file is present. The tenth, arriving first, takes a cross-process lock, re-checks the cache, performs the verified download and installs the file under its digest key. All ten then read the same local path, so no two jobs can be working from different published versions of the map.</desc>
  <defs><marker id="mdc1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="290" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Ten requests, one lock, one download</text>
  <rect x="26" y="122" width="240" height="56" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="146" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">ten jobs</text>
  <text x="146" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">same region, same moment</text>
  <rect x="320" y="50" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="74" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">digest lookup</text>
  <text x="440" y="92" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">resolve the version</text>
  <rect x="320" y="122" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">single-flight lock</text>
  <text x="440" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">one fetch, others wait</text>
  <rect x="320" y="194" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="218" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">verified download</text>
  <text x="440" y="236" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">digest and freshness</text>
  <rect x="614" y="122" width="240" height="56" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="734" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">one shared path</text>
  <text x="734" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">identical bytes for all</text>
  <line x1="266" y1="150" x2="293" y2="150" stroke="currentColor" stroke-width="1.4"/>
  <line x1="293" y1="78" x2="293" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="293" y1="78" x2="317" y2="78" stroke="currentColor" stroke-width="1.4" marker-end="url(#mdc1-a)"/>
  <line x1="293" y1="150" x2="317" y2="150" stroke="currentColor" stroke-width="1.4" marker-end="url(#mdc1-a)"/>
  <line x1="293" y1="222" x2="317" y2="222" stroke="currentColor" stroke-width="1.4" marker-end="url(#mdc1-a)"/>
  <line x1="560" y1="78" x2="587" y2="78" stroke="currentColor" stroke-width="1.4"/>
  <line x1="560" y1="150" x2="587" y2="150" stroke="currentColor" stroke-width="1.4"/>
  <line x1="560" y1="222" x2="587" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="587" y1="78" x2="587" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="587" y1="150" x2="611" y2="150" stroke="currentColor" stroke-width="1.4" marker-end="url(#mdc1-a)"/>
  <text x="868" y="274" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Without the lock, ten workers each download the file and up to ten of them can land on different published versions across a boundary.</text>
</svg>
<figcaption>The lock is not a performance optimisation first — it is what stops a fleet from disagreeing about which day it is.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
import shutil
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

import requests
from filelock import FileLock

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.extract.cache")

UA = "osm-pipeline-example/1.0 (contact@example.org)"


class ProviderUnavailable(RuntimeError):
    """The provider could not be reached and no fallback was permitted."""


@dataclass(frozen=True)
class CacheConfig:
    root: Path
    max_age: timedelta
    allow_stale_on_outage: bool = False    # opt in, never the default
    keep_versions: int = 3


def _region_dir(config: CacheConfig, region: str) -> Path:
    path = config.root / region
    path.mkdir(parents=True, exist_ok=True)
    return path


def _published_digest(md5_url: str) -> str:
    response = requests.get(md5_url, headers={"User-Agent": UA}, timeout=30)
    response.raise_for_status()
    return response.text.strip().split()[0]


def _newest_cached(region_dir: Path) -> Path | None:
    files = sorted(region_dir.glob("*.osm.pbf"), key=lambda p: p.stat().st_mtime)
    return files[-1] if files else None


def _prune(region_dir: Path, keep: int) -> None:
    files = sorted(region_dir.glob("*.osm.pbf"), key=lambda p: p.stat().st_mtime)
    for old in files[:-keep] if len(files) > keep else []:
        old.unlink()
        logger.info("pruned %s", old.name)


def fetch(config: CacheConfig, region: str, url: str, md5_url: str,
          download) -> Path:
    """Return a path to a verified extract, downloading at most once per version.

    `download(url, md5, dest)` is the verifying client: it must check the digest
    and the freshness gate and write `dest` atomically.
    """
    region_dir = _region_dir(config, region)

    try:
        digest = _published_digest(md5_url)
    except requests.RequestException as exc:
        cached = _newest_cached(region_dir)
        if cached and config.allow_stale_on_outage:
            # Loud on purpose: this run is NOT using current data.
            logger.warning("provider unreachable (%s) — serving cached %s",
                           exc, cached.name)
            return cached
        raise ProviderUnavailable(f"cannot reach provider and no fallback: {exc}")

    target = region_dir / f"{digest}.osm.pbf"
    if target.exists():
        logger.info("cache hit for %s at %s", region, digest[:12])
        return target

    # Single flight: the first arrival downloads, everyone else waits and re-checks.
    with FileLock(str(region_dir / ".fetch.lock"), timeout=3600):
        if target.exists():
            logger.info("another worker fetched %s while we waited", digest[:12])
            return target
        logger.info("fetching %s for %s", digest[:12], region)
        download(url, md5_url, target)
        _prune(region_dir, config.keep_versions)
    return target


def resolve_for_job(config: CacheConfig, region: str, url: str, md5_url: str,
                    download, workdir: Path) -> Path:
    """Give the job a stable local name pointing at the shared cached file."""
    source = fetch(config, region, url, md5_url, download)
    link = workdir / f"{region}.osm.pbf"
    link.unlink(missing_ok=True)
    try:
        link.symlink_to(source)
    except OSError:
        shutil.copy2(source, link)   # filesystems without symlinks
    logger.info("job input %s -> %s", link, source.name)
    return link


if __name__ == "__main__":
    logger.info("wire `download` to the verifying client from the sibling guide")
```

## Step-by-step walkthrough

1. **Ask for the digest first.** The published checksum is a tiny request and it *is* the version identity. Everything else follows from it.
2. **Key the file on the digest.** A file named for its own content cannot be ambiguous, cannot be silently replaced, and can be named in a provenance record that still means something in a year.
3. **Return immediately on a hit.** The common path does one small HTTP request and a filesystem check. No lock is taken when the file is already present, so a fleet of hundreds of jobs costs hundreds of tiny requests rather than any contention.
4. **Re-check inside the lock.** Between deciding to fetch and acquiring the lock, another worker may have finished. Checking again is two lines and removes the duplicate download entirely.
5. **Delegate the actual download.** The verifying client is passed in. This cache adds sharing and single-flight; it deliberately does not re-implement digest and freshness checking.
6. **Make the outage path opt-in and loud.** Serving a stale file during a provider outage is a policy decision. The default refuses; enabling it logs a warning naming the file being served, so the decision is visible in the run's output.
7. **Give each job a stable local name.** Jobs should not embed digests in their configuration. A symlink from a predictable name to the content-addressed file gives both stability and traceability, with a copy fallback where symlinks are unavailable.
8. **Prune inside the lock.** Retention runs while the lock is held, so no other worker can be reading a file as it is removed.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 239" role="img" aria-labelledby="mdc2-t mdc2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mdc2-t">Three cache key choices and what each one allows to go wrong</title>
  <desc id="mdc2-d">Three panels comparing cache key strategies. Keying on the filename alone means a republished file silently replaces the old one under the same key, so two jobs in the same run can read different data. Keying on the date is better but still ambiguous when a provider republishes within a day, and it cannot express that two dates carry identical bytes. Keying on the published digest makes identity exact, makes a republication a new key, and makes a provenance record verifiable long afterwards.</desc>
  <rect x="0" y="0" width="880" height="239" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three cache keys, only one of them is an identity</text>
  <rect x="26" y="52" width="259" height="153" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Filename</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Latest name, reused daily</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Republish overwrites in place</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Two jobs, two different files</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">No provenance value at all</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Never adequate</text>
  <rect x="311" y="52" width="259" height="153" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Date</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">One key per calendar day</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Republication within a day hides</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Identical bytes, two keys</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Provenance is approximate</text>
  <text x="325" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Better, still ambiguous</text>
  <rect x="595" y="52" width="259" height="153" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Published digest</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Key is the content itself</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Republication is a new key</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Identical bytes, one key</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Provenance verifiable later</text>
  <text x="609" y="188" font-size="10.5" fill="currentColor" opacity="0.92">The only real identity</text>
  <text x="868" y="223" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The date key looks sufficient until the first time a provider republishes a corrected file a few hours after the original.</text>
</svg>
<figcaption>Content addressing is not sophistication here; it is the minimum needed for two jobs to prove they read the same map.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 292" role="img" aria-labelledby="mdc3-t mdc3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mdc3-t">What happens to a fleet across a provider publication boundary</title>
  <desc id="mdc3-d">Four moments in time. Before the publication all jobs resolve the same digest and share one cached file. At the publication moment the provider swaps the file behind the same filename and publishes a new digest. Immediately after, a newly started job resolves the new digest, takes the lock and fetches, while jobs already running keep their existing symlink target and finish against the version they started with. Once the fetch completes both versions exist in the cache and retention decides when the older one goes.</desc>
  <defs><marker id="mdc3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="292" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">A publication mid-run must not change a running job's input</text>
  <line x1="26" y1="150" x2="848" y2="150" stroke="currentColor" stroke-width="1.8" marker-end="url(#mdc3-a)"/>
  <rect x="35" y="52" width="189" height="66" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="130" y="76" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">before</text>
  <text x="130" y="94" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">one digest</text>
  <text x="130" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">all jobs agree</text>
  <line x1="130" y1="118" x2="130" y2="143" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="130" cy="150" r="5" fill="var(--osm-accent,#0369a1)"/>
  <rect x="242" y="176" width="189" height="66" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="336" y="200" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">publish</text>
  <text x="336" y="218" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">provider swaps</text>
  <text x="336" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">new digest appears</text>
  <line x1="336" y1="176" x2="336" y2="157" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="336" cy="150" r="5" fill="var(--osm-ok,#15803d)"/>
  <rect x="449" y="52" width="189" height="66" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="544" y="76" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">after</text>
  <text x="544" y="94" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">new jobs fetch</text>
  <text x="544" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">running jobs unaffected</text>
  <line x1="544" y1="118" x2="544" y2="143" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="544" cy="150" r="5" fill="var(--osm-warn,#a16207)"/>
  <rect x="656" y="176" width="189" height="66" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="750" y="200" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">settled</text>
  <text x="750" y="218" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">both versions held</text>
  <text x="750" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">retention decides</text>
  <line x1="750" y1="176" x2="750" y2="157" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="750" cy="150" r="5" fill="var(--osm-alt,#6d28d9)"/>
  <text x="868" y="276" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Keeping the older version is what lets a job that started before the boundary finish against a consistent input instead of failing.</text>
</svg>
<figcaption>Content addressing plus a short retention window is the whole mechanism; nothing here needs coordination between jobs.</figcaption>
</figure>

## Verification

- **Ten concurrent jobs produce one download.** Launch them together against a cold cache and count provider requests for the file itself; it must be one.
- **A warm cache takes no lock.** Instrument the lock acquisition; on a warm run it should never be reached.
- **Two jobs resolve to the same file.** Compare the symlink targets from two workers started either side of a publication boundary; they must match.
- **The outage path refuses by default.** Block network access and run; the job must fail rather than quietly using an old file.
- **Pruning never removes an in-use file.** Run a long job while another triggers a fetch and prune; the running job's input must survive.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Ten downloads for one file | No cross-process lock | Take a lock around the fetch and re-check inside it |
| Two jobs disagree about the data | Cache keyed on filename | Key on the published digest instead |
| Deadlock under load | Lock held across the whole job | Hold the lock only around fetch and prune |
| Job breaks when a version is pruned | Retention ignores readers | Prune inside the lock and keep several versions |
| Silent use of stale data | Outage fallback enabled by default | Make the fallback opt-in and log it as a warning |
| Symlink fails on the target filesystem | Filesystem without symlink support | Fall back to a copy, explicitly |
| Cache grows without bound | No retention policy | Prune to a fixed number of versions per region |

## Specification reference

> Content-addressed storage names an object by a cryptographic digest of its contents, so a name resolves to exactly one byte sequence and any change to the contents produces a different name. Applied to published OSM extracts, the provider's own published digest serves as that name without recomputation. See the [OSM planet and extract documentation](https://wiki.openstreetmap.org/wiki/Planet.osm) for the digest files published alongside each extract.

## Frequently Asked Questions

<details>
<summary>Why key the cache on a digest rather than on the date?</summary>

Because a date is not an identity. Providers occasionally republish a corrected file within the same day, and a date key silently overwrites the earlier one — so two jobs in the same run can read different data while both believing they used "today's extract". A digest key makes a republication a new entry, makes identical bytes resolve to one entry, and lets a stored provenance record be verified long afterwards.
</details>

<details>
<summary>Should the cache serve a stale file when the provider is down?</summary>

Only when somebody has decided in advance that it should, and only loudly. For a dashboard that tolerates yesterday's data, continuing is clearly better than failing. For a pipeline computing figures somebody will act on, silently substituting old data is worse than an outage. Make it a configuration flag that defaults to refusing, and log a warning naming the file whenever the fallback is used.
</details>

<details>
<summary>How many versions should I keep?</summary>

Enough to cover your longest-running job plus a margin for reproducing a recent result — three is a reasonable default for a daily extract. The cost is storage; the benefit is that a job started before a refresh keeps a valid input and that last week's output can be re-derived. Prune inside the same lock the fetch uses so a file is never removed while a fetch or another prune is in flight.
</details>

<details>
<summary>Does the cache replace the checksum and freshness checks?</summary>

No, it composes with them. The cache's job is sharing and single-flight; the verifying client's job is proving the bytes are complete and the data is current. Keeping them separate means a cache hit is trustworthy because nothing was ever installed in the cache without passing both gates, and it keeps each piece small enough to reason about.
</details>

## Related

- [OSM Extract Providers & Automated Downloads](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/) — the parent topic and the provider properties this cache fronts.
- [Automating Geofabrik Extract Downloads with Checksums](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/automating-geofabrik-extract-downloads-with-checksums/) — the verifying client this cache wraps.
- [Recording OSM Data Provenance in a Pipeline](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/recording-osm-data-provenance-in-a-pipeline/) — what the digest key is worth once a result is archived.
- [Pinning a Reproducible OSM Snapshot by Sequence Number](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/pinning-a-reproducible-osm-snapshot-by-sequence-number/) — the replication-side equivalent of a content-addressed input.
- [Resuming an Interrupted OSM Import](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/error-handling-in-large-osm-extracts/resuming-an-interrupted-osm-import/) — why a stable input path matters to a restarted job.

Up one level: [OSM Extract Providers & Automated Downloads](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Mirroring OSM Downloads Behind a Local Cache",
  "description": "One verified fetch serving a whole fleet of jobs: content-addressed storage keyed on the published digest, a single-flight lock, and an explicit fallback when the provider is unreachable.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Querying OSM: Overpass, Nominatim & APIs",
  "about": ["download caching", "content addressing", "single flight"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Querying OSM: Overpass, Nominatim & APIs", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/" },
    { "@type": "ListItem", "position": 3, "name": "OSM Extract Providers & Automated Downloads", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/" },
    { "@type": "ListItem", "position": 4, "name": "Mirroring OSM Downloads Behind a Local Cache", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/mirroring-osm-downloads-behind-a-local-cache/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Share one verified OSM extract across a fleet of jobs",
  "description": "Resolve the published digest, key cached files on it, serialise concurrent fetches with a cross-process lock, prune under the same lock, and make the outage fallback explicit.",
  "step": [
    { "@type": "HowToStep", "name": "Resolve the version", "text": "Fetch the provider's published digest first and treat it as the identity of the extract version." },
    { "@type": "HowToStep", "name": "Look up by digest", "text": "Return the cached file immediately when a file named for that digest already exists, taking no lock on the common path." },
    { "@type": "HowToStep", "name": "Serialise the fetch", "text": "Acquire a cross-process lock, re-check the cache inside it, and download only if the file is still absent." },
    { "@type": "HowToStep", "name": "Delegate verification", "text": "Perform the download through the verifying client so digest and freshness gates run before anything is installed." },
    { "@type": "HowToStep", "name": "Prune under the lock", "text": "Apply the retention policy while the lock is held so no file is removed while another worker is fetching." },
    { "@type": "HowToStep", "name": "Expose a stable job path", "text": "Link a predictable per-region name to the content-addressed file so jobs need no digest in their configuration." },
    { "@type": "HowToStep", "name": "Make the outage policy explicit", "text": "Refuse by default when the provider is unreachable, and log a warning naming the file whenever a stale fallback is deliberately enabled." }
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
      "name": "Why key an OSM extract cache on a digest rather than on the date?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because a date is not an identity. Providers occasionally republish a corrected file within the same day, and a date key silently overwrites the earlier one, so two jobs in the same run can read different data while both believing they used today's extract. A digest key makes a republication a new entry and lets a stored provenance record be verified long afterwards." }
    },
    {
      "@type": "Question",
      "name": "Should the cache serve a stale file when the provider is down?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only when somebody has decided in advance that it should, and only loudly. For a dashboard that tolerates yesterday's data, continuing is clearly better than failing. For a pipeline computing figures somebody will act on, silently substituting old data is worse than an outage. Make it a configuration flag that defaults to refusing." }
    },
    {
      "@type": "Question",
      "name": "How many cached OSM extract versions should I keep?",
      "acceptedAnswer": { "@type": "Answer", "text": "Enough to cover your longest-running job plus a margin for reproducing a recent result — three is a reasonable default for a daily extract. The cost is storage; the benefit is that a job started before a refresh keeps a valid input and that last week's output can be re-derived. Prune inside the same lock the fetch uses." }
    },
    {
      "@type": "Question",
      "name": "Does a download cache replace the checksum and freshness checks?",
      "acceptedAnswer": { "@type": "Answer", "text": "No, it composes with them. The cache's job is sharing and single-flight; the verifying client's job is proving the bytes are complete and the data is current. Keeping them separate means a cache hit is trustworthy because nothing was ever installed without passing both gates." }
    }
  ]
}
</script>
