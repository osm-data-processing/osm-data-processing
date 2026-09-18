---
title: "Automating Geofabrik Extract Downloads with Checksums"
description: "A download client that verifies the published digest, asserts the extract's own timestamp against a declared tolerance, and replaces the input file atomically."
pageTitle: "Automate OSM Extract Downloads with Digest & Freshness Gates"
pageDescription: "Fetch a regional OSM extract, verify its published checksum, read the PBF header timestamp to gate on freshness, and swap the file into place atomically so a partial download is never parsed."
slug: automating-geofabrik-extract-downloads-with-checksums
type: article
breadcrumb: "Automated Downloads"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Automating Geofabrik Extract Downloads with Checksums

Download a regional `.osm.pbf` on a schedule so that the file your parser opens is provably complete, provably current, and never a half-finished transfer.

## Prerequisites

- [ ] Python 3.10+ with `requests`; `hashlib` and `pathlib` come from the standard library.
- [ ] `osmium` on the path, or `pyosmium` installed, to read the PBF header timestamp.
- [ ] A writable directory with room for the extract twice over, since verification happens before the swap.
- [ ] An explicit freshness tolerance decided in advance — see [OSM Extract Providers & Automated Downloads](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/) for why this is a gate rather than a log line.
- [ ] The provider's checksum URL convention; most publish a digest file beside each extract.

## Conceptual minimum

Three independent properties have to hold before a downloaded extract is safe to parse, and each needs its own check.

**Completeness** is proved by comparing a computed digest against the published one. This catches truncated transfers and corrupted mirrors, and nothing else does — a PBF file that lost its last blob still decompresses and still parses right up to the point where the data stops.

**Currency** is proved by reading the *data's* timestamp, not the file's. The PBF header carries an `osmosis_replication_timestamp` describing the state of the map the extract was cut from. Filesystem modification time changes when you copy a file and tells you nothing.

**Atomicity** is a property of how you write, not of what you downloaded. If the pipeline's input path is also the download target, a process killed mid-transfer leaves a truncated file exactly where a parser expects a good one, and the next run parses it happily until it stops.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="agd1-t agd1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="agd1-t">Four stages between a provider URL and a file a parser may open</title>
  <desc id="agd1-d">Four stages. The fetch stage streams the extract and its published checksum to a temporary path, computing the digest as bytes arrive so no second read is needed. The verify stage compares the computed digest against the published one and aborts on a mismatch, deleting the temporary file. The gate stage reads the PBF header replication timestamp and aborts if it is older than the declared tolerance. The swap stage renames the verified file over the pipeline's input path, which is atomic and leaves no window where a partial file is visible.</desc>
  <defs><marker id="agd1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Fetch, verify, gate, swap — in that order</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">fetch</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">stream to a temp path</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">hash as bytes arrive</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#agd1-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">verify</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">digest must match</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">delete on mismatch</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#agd1-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">gate</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">header timestamp</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">fail if too old</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#agd1-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">swap</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">rename into place</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">atomic, no window</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Reversing the last two stages would publish a stale but intact file, which is the failure the gate exists to prevent.</text>
</svg>
<figcaption>Each stage can only reject; none of them repairs anything, which is what makes the sequence easy to reason about.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import hashlib
import logging
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import osmium
import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.extract.download")

UA = "osm-pipeline-example/1.0 (contact@example.org)"
CHUNK = 1 << 20


class IntegrityError(RuntimeError):
    """The downloaded bytes do not match the published digest."""


class StaleExtractError(RuntimeError):
    """The extract is intact but describes a map older than we tolerate."""


@dataclass(frozen=True)
class Source:
    url: str
    md5_url: str
    max_age: timedelta


def published_digest(md5_url: str) -> str:
    """Providers publish '<hex>  <filename>' beside each extract."""
    response = requests.get(md5_url, headers={"User-Agent": UA}, timeout=60)
    response.raise_for_status()
    match = re.match(r"([0-9a-f]{32})\s", response.text.strip())
    if not match:
        raise IntegrityError(f"unparseable digest file at {md5_url}")
    return match.group(1)


def download_to(tmp: Path, url: str) -> str:
    """Stream to disk, hashing as we go so the file is read exactly once."""
    digest = hashlib.md5()
    total = 0
    with requests.get(url, headers={"User-Agent": UA},
                      stream=True, timeout=600) as response:
        response.raise_for_status()
        with tmp.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=CHUNK):
                handle.write(chunk)
                digest.update(chunk)
                total += len(chunk)
    logger.info("downloaded %.1f MiB", total / (1 << 20))
    if total < (1 << 20):
        # An error page served with HTTP 200 is small; a real extract is not.
        raise IntegrityError(f"suspiciously small download: {total} bytes")
    return digest.hexdigest()


def header_timestamp(path: Path) -> datetime:
    """Read the replication timestamp the provider baked into the PBF header."""
    reader = osmium.io.Reader(str(path))
    try:
        stamp = reader.header().get("osmosis_replication_timestamp")
    finally:
        reader.close()
    if not stamp:
        raise StaleExtractError(f"{path} has no replication timestamp in its header")
    return datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def refresh(source: Source, target: Path) -> Path:
    tmp = target.with_suffix(target.suffix + ".part")
    expected = published_digest(source.md5_url)

    actual = download_to(tmp, source.url)
    if actual != expected:
        tmp.unlink(missing_ok=True)
        raise IntegrityError(f"digest mismatch: got {actual}, expected {expected}")
    logger.info("digest verified: %s", actual)

    age = datetime.now(timezone.utc) - header_timestamp(tmp)
    if age > source.max_age:
        tmp.unlink(missing_ok=True)
        raise StaleExtractError(
            f"extract describes a map {age} old, tolerance is {source.max_age}")
    logger.info("freshness ok: extract is %s old", age)

    tmp.replace(target)          # atomic within a filesystem
    logger.info("installed %s", target)
    return target


if __name__ == "__main__":
    base = "https://download.geofabrik.de/europe/poland-latest.osm.pbf"
    try:
        refresh(Source(base, base + ".md5", timedelta(days=2)),
                Path("/data/poland-latest.osm.pbf"))
    except (IntegrityError, StaleExtractError) as exc:
        logger.error("refresh refused: %s", exc)
        sys.exit(1)
```

## Step-by-step walkthrough

1. **Fetch the digest first.** Knowing what the file should hash to before downloading it means the verification is a comparison rather than a decision about whether to bother.
2. **Hash while streaming.** The digest is updated chunk by chunk as bytes land, so a multi-gigabyte file is read from the network once and never re-read from disk.
3. **Reject implausibly small downloads.** A provider error page returned with HTTP 200 is a few kilobytes. A minimum-size assertion catches that class before the digest comparison even runs, with a clearer message.
4. **Delete on failure.** Both failure paths remove the temporary file. Leaving a failed `.part` behind invites a later process to find it and guess.
5. **Read the header, not the filesystem.** `osmosis_replication_timestamp` is the state of the map the extract was cut from. It travels with the file through copies, mirrors and archives, which is exactly what makes it trustworthy.
6. **Fail on staleness, do not warn.** A stale extract produces perfectly valid output describing an old map, so the only effective response is to stop the pipeline.
7. **Swap by rename.** `Path.replace` is atomic within a filesystem, so the target path holds either the previous verified file or the new verified file and never anything in between. Keep the temporary file on the same filesystem or the rename degrades into a copy.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 239" role="img" aria-labelledby="agd2-t agd2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="agd2-t">Three download failures that produce no error without explicit checks</title>
  <desc id="agd2-d">Three panels. A truncated transfer leaves a file that still decompresses and parses until the data simply stops, and is caught only by comparing the computed digest against the published one. An error page served with HTTP 200 is a small text file where a multi-gigabyte extract was expected, and is caught by a minimum-size assertion before any parsing. A stale mirror serves a complete, correct file describing a map from weeks ago, and is caught only by reading the header replication timestamp.</desc>
  <rect x="0" y="0" width="880" height="239" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three silent failures, three different checks</text>
  <rect x="26" y="52" width="259" height="153" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Truncated transfer</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">File decompresses fine</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Parses until data stops</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Counts look low, not wrong</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Caught by: digest comparison</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Nothing else detects it</text>
  <rect x="311" y="52" width="259" height="153" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Error page as data</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">HTTP 200, a few kilobytes</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Not a PBF at all</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Parser error is cryptic</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Caught by: minimum size</text>
  <text x="325" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Check before hashing</text>
  <rect x="595" y="52" width="259" height="153" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Stale mirror</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Complete, valid, correct file</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Describes an old map</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Every gate downstream passes</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Caught by: header timestamp</text>
  <text x="609" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Never by a checksum</text>
  <text x="868" y="223" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the first of these three is what people mean by a corrupt download, and it is the least damaging of the three.</text>
</svg>
<figcaption>The third failure is the dangerous one because every other check in the pipeline reports success.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="agd3-t agd3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="agd3-t">Where the temporary file lives and why it matters</title>
  <desc id="agd3-d">Four layers describing the file lifecycle. The remote file is the provider's published extract with its own digest. The temporary path is a sibling of the target on the same filesystem, holding bytes that have not yet been verified. The verified state is reached once the digest matches and the header timestamp is within tolerance. The installed path is the pipeline's input, reached by an atomic rename that never exposes a partial file.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four states, one atomic transition between the last two</text>
  <rect x="26" y="50" width="828" height="52" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="42" y="72" font-size="12.5" font-weight="700" fill="currentColor">Remote</text>
  <text x="42" y="90" font-size="10.5" fill="currentColor" opacity="0.88">Provider file plus published digest</text>
  <text x="838" y="82" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">the only source of truth</text>
  <rect x="26" y="112" width="828" height="52" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="42" y="134" font-size="12.5" font-weight="700" fill="currentColor">Temporary</text>
  <text x="42" y="152" font-size="10.5" fill="currentColor" opacity="0.88">Sibling of the target, unverified</text>
  <text x="838" y="144" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">same filesystem, always</text>
  <rect x="26" y="174" width="828" height="52" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="42" y="196" font-size="12.5" font-weight="700" fill="currentColor">Verified</text>
  <text x="42" y="214" font-size="10.5" fill="currentColor" opacity="0.88">Digest matched, freshness passed</text>
  <text x="838" y="206" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">still not installed</text>
  <rect x="26" y="236" width="828" height="52" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="42" y="258" font-size="12.5" font-weight="700" fill="currentColor">Installed</text>
  <text x="42" y="276" font-size="10.5" fill="currentColor" opacity="0.88">The pipeline's input path</text>
  <text x="838" y="268" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">reached by rename only</text>
  <text x="868" y="308" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Putting the temporary file elsewhere turns the final rename into a full copy, reintroducing the partial-file window it was there to remove.</text>
</svg>
<figcaption>The whole design is one rule: the input path is only ever written by a rename from a file that already passed both gates.</figcaption>
</figure>

## Verification

- **A deliberately corrupted file is rejected.** Truncate a downloaded extract and re-run; the digest comparison must fail and the temporary file must be gone.
- **A stale file is rejected.** Set the tolerance to an hour and re-run against a daily extract; the freshness gate must fail.
- **The target is never partial.** Kill the process mid-download repeatedly; the target path must always hold a complete, previously verified file.
- **The temporary file shares a filesystem with the target.** Check that the rename is instant rather than taking as long as a copy.
- **A rerun with an unchanged remote file is cheap.** Compare the published digest against the installed file's digest first and skip the download when they match.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Parser stops mid-file | Truncated transfer accepted | Compare the computed digest before installing |
| Cryptic parse error on a tiny file | Error page saved as the extract | Assert a plausible minimum size first |
| Output describes an old map | No freshness gate | Read the header timestamp and fail on excess age |
| Rename takes minutes | Temporary file on a different filesystem | Put the `.part` file beside the target |
| Stale `.part` files accumulate | Failure paths do not clean up | Unlink the temporary file on every failure |
| Digest file unparseable | Provider format differs from the assumption | Match a hex digest with a regular expression, not by splitting |
| Freshness gate always passes | Filesystem mtime used instead of header | Read `osmosis_replication_timestamp` from the PBF header |

## Specification reference

> A PBF file's `OSMHeader` block may carry optional metadata including `osmosis_replication_timestamp`, `osmosis_replication_sequence_number` and `osmosis_replication_base_url`, which describe the replication state the file was produced from. Extract providers populate these for their published regional files. See the [PBF file format documentation](https://wiki.openstreetmap.org/wiki/PBF_Format) for the header fields and their semantics.

## Frequently Asked Questions

<details>
<summary>Why not just check the file size?</summary>

Because size only catches the gross failures. A transfer that dropped the last few blobs is within a fraction of a percent of the expected size and passes any tolerance loose enough not to produce false alarms as the region grows. The published digest is exact and costs one small extra request. Keep a minimum-size assertion as well, but as a fast check for the error-page case rather than as the integrity test.
</details>

<details>
<summary>Should a stale extract fail the run or just warn?</summary>

Fail it. The entire problem with a stale extract is that everything downstream succeeds: the parser is happy, the validation rules pass, the output looks normal. A warning on a successful run is not read by anybody. Failing is also easy to override deliberately when you genuinely want to reprocess an archived file, which is the case a warning is usually trying to accommodate.
</details>

<details>
<summary>What tolerance should I set?</summary>

A little over the provider's publication cadence, tight enough that a mirror which stopped updating is caught within a day or two. For a daily extract, two days is a sensible default: it survives a single missed publication without alarming, and it catches a mirror that has genuinely stalled. Declare it next to the job's schedule so an inconsistency between the two is visible when somebody reads the configuration.
</details>

<details>
<summary>Can I skip the download when nothing changed?</summary>

Yes, and you should. Fetch the published digest first and compare it against the digest of the file you already have; if they match, the remote file is byte-identical and there is nothing to do. That turns a daily job into one small request on days when the provider has not published, which matters when many jobs share a volunteer-funded mirror.
</details>

## Related

- [OSM Extract Providers & Automated Downloads](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/) — the parent topic and the provider differences behind this client.
- [Mirroring OSM Downloads Behind a Local Cache](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/mirroring-osm-downloads-behind-a-local-cache/) — running this once for a whole fleet.
- [Extracting Metadata from OSM Planet Files](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/extracting-metadata-from-osm-planet-files/) — the header fields the freshness gate reads.
- [Replication Sequence Numbers & State](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) — the sequence number that accompanies the header timestamp.
- [Catching Up a Stale OSM Extract with pyosmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/catching-up-a-stale-osm-extract-with-pyosmium/) — the alternative to re-downloading when the gate fails.

Up one level: [OSM Extract Providers & Automated Downloads](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Automating Geofabrik Extract Downloads with Checksums",
  "description": "A download client that verifies the published digest, asserts the extract's own timestamp against a declared tolerance, and replaces the input file atomically.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Querying OSM: Overpass, Nominatim & APIs",
  "about": ["extract download automation", "checksum verification", "PBF header timestamp"]
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
    { "@type": "ListItem", "position": 4, "name": "Automating Geofabrik Extract Downloads with Checksums", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/automating-geofabrik-extract-downloads-with-checksums/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Download an OSM extract with integrity and freshness gates",
  "description": "Fetch the published digest first, stream the extract to a temporary path while hashing, verify the digest, assert the PBF header replication timestamp against a tolerance, then rename atomically.",
  "step": [
    { "@type": "HowToStep", "name": "Fetch the published digest", "text": "Download the provider's checksum file for the extract before downloading the extract itself." },
    { "@type": "HowToStep", "name": "Stream and hash together", "text": "Write the response to a temporary path beside the target while updating the hash chunk by chunk, so the bytes are read once." },
    { "@type": "HowToStep", "name": "Reject implausible sizes", "text": "Abort immediately if the download is far smaller than a real extract, which catches an error page served with a success status." },
    { "@type": "HowToStep", "name": "Compare the digest", "text": "Abort and delete the temporary file when the computed digest does not equal the published one." },
    { "@type": "HowToStep", "name": "Gate on the header timestamp", "text": "Read the replication timestamp from the PBF header and fail the run when the extract is older than the declared tolerance." },
    { "@type": "HowToStep", "name": "Swap atomically", "text": "Rename the verified temporary file over the pipeline's input path so no partial file is ever visible to a parser." }
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
      "name": "Why not just check the extract file size?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because size only catches the gross failures. A transfer that dropped the last few blobs is within a fraction of a percent of the expected size and passes any tolerance loose enough not to produce false alarms as the region grows. The published digest is exact and costs one small extra request. Keep a minimum-size assertion as a fast check for the error-page case." }
    },
    {
      "@type": "Question",
      "name": "Should a stale extract fail the run or just warn?",
      "acceptedAnswer": { "@type": "Answer", "text": "Fail it. The entire problem with a stale extract is that everything downstream succeeds: the parser is happy, the validation rules pass, the output looks normal. A warning on a successful run is not read by anybody. Failing is also easy to override deliberately when you genuinely want to reprocess an archived file." }
    },
    {
      "@type": "Question",
      "name": "What freshness tolerance should I set for an OSM extract?",
      "acceptedAnswer": { "@type": "Answer", "text": "A little over the provider's publication cadence, tight enough that a mirror which stopped updating is caught within a day or two. For a daily extract, two days is a sensible default: it survives a single missed publication without alarming, and it catches a mirror that has genuinely stalled. Declare it next to the job's schedule." }
    },
    {
      "@type": "Question",
      "name": "Can I skip the download when nothing changed?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes, and you should. Fetch the published digest first and compare it against the digest of the file you already have; if they match, the remote file is byte-identical and there is nothing to do. That turns a daily job into one small request on days when the provider has not published." }
    }
  ]
}
</script>
