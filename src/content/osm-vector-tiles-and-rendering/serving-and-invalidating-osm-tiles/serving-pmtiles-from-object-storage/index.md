---
title: "Serving PMTiles from Object Storage"
description: "Deliver a vector tile set with no server: convert an MBTiles archive to PMTiles, upload it, and configure the range requests, CORS headers and caching a client reader depends on."
pageTitle: "Serve Vector Tiles from Object Storage with PMTiles"
pageDescription: "Convert MBTiles to PMTiles, upload to object storage, and get the range-request, CORS and cache headers right so browsers can read single tiles from one large file."
slug: serving-pmtiles-from-object-storage
type: article
breadcrumb: "Serving PMTiles"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Serving PMTiles from Object Storage

Put one file in a bucket, point a map at it, and have no tile server to operate — provided the storage, the edge network and the headers all cooperate on one thing: HTTP range requests.

## Prerequisites

- [ ] An MBTiles archive, from [Generating MBTiles from OSM GeoJSON](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/generating-mbtiles-from-osm-geojson/).
- [ ] The `pmtiles` command-line tool for conversion and inspection.
- [ ] Object storage that honours HTTP range requests, and a content delivery network in front of it that does too.
- [ ] A map client with a PMTiles protocol handler registered.
- [ ] The packaging trade-offs from [Serving & Invalidating OSM Tiles](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/) — this format is immutable in practice.

## Conceptual minimum

A PMTiles archive is one file laid out so that a client can find any tile with a small number of byte-range reads. Its head holds a header and a hierarchical directory; tile data follows. A client reads the header once, walks the directory — usually one or two additional range reads, cached thereafter — and then fetches the tile's bytes directly.

Everything that makes this work is a property of the transport rather than of the file. **Range requests must be honoured end to end**: by the object store, by the edge network, and by any proxy in between. A layer that answers a range request with the whole file turns each tile fetch into a multi-gigabyte download. **CORS headers must permit the range header** from browser clients, which is a separate allowance from permitting the request itself.

The consequence of the single-file design is immutability in practice. Updating one tile means rewriting the archive, so PMTiles fits a tile set rebuilt as a unit and fits a minutely-updated one badly.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="spo1-t spo1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="spo1-t">What a client does to fetch one tile from a single remote archive</title>
  <desc id="spo1-d">Four steps. The client first requests a small byte range covering the header, learning the archive's zoom range, bounds and the location of the root directory. It then requests the root directory range, which maps tile addresses to either leaf directories or tile locations. For deep archives it requests one leaf directory range. Finally it requests the byte range holding the tile itself. The first three responses are cached, so subsequent tiles from the same area cost a single range request each.</desc>
  <defs><marker id="spo1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three reads to warm up, then one per tile</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">header</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">a few hundred bytes</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">zoom range and bounds</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#spo1-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">root directory</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">one range read</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">cached thereafter</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#spo1-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">leaf directory</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">deep archives only</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">also cached</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#spo1-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">tile bytes</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">one range read</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">the steady state</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Once the directories are cached the steady-state cost is identical to a conventional tile server: one request per tile.</text>
</svg>
<figcaption>The warm-up is three requests for the whole session, which is why the format is viable at all.</figcaption>
</figure>

## Runnable solution

```bash
#!/usr/bin/env bash
# Convert an MBTiles archive to PMTiles and publish it.
set -euo pipefail

SRC="${1:?usage: publish.sh <archive.mbtiles>}"
BASE="$(basename "$SRC" .mbtiles)"
VERSION="$(date -u +%Y%m%dT%H%M%SZ)"       # a version token in the object key
DST="${BASE}-${VERSION}.pmtiles"
BUCKET="s3://tiles.example.org"

pmtiles convert "$SRC" "$DST"
pmtiles show "$DST"                         # prints zoom range, bounds, layers

# Tiles are immutable per version, so they can be cached effectively forever.
aws s3 cp "$DST" "$BUCKET/$DST" \
  --content-type application/octet-stream \
  --cache-control "public, max-age=31536000, immutable"

echo "https://tiles.example.org/$DST"
```

```python
from __future__ import annotations

import logging
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.pmtiles.verify")

ORIGIN = "https://map.example.org"      # the site that will embed the map


def check(url: str) -> bool:
    ok = True

    head = requests.head(url, timeout=30)
    head.raise_for_status()
    size = int(head.headers.get("Content-Length", 0))
    logger.info("archive is %.1f MiB", size / (1 << 20))
    if head.headers.get("Accept-Ranges") != "bytes":
        logger.error("origin does not advertise byte ranges")
        ok = False

    # The decisive test: ask for 16 bytes and insist on getting 16 bytes.
    ranged = requests.get(url, headers={"Range": "bytes=0-15"}, timeout=30)
    if ranged.status_code != 206:
        logger.error("range request returned %d, expected 206 Partial Content",
                     ranged.status_code)
        ok = False
    elif len(ranged.content) != 16:
        logger.error("range request returned %d bytes, expected 16 — a layer "
                     "in the path is collapsing ranges", len(ranged.content))
        ok = False
    else:
        logger.info("range requests honoured; magic bytes %r", ranged.content[:7])

    # Browsers send a preflight for the Range header; it must be allowed.
    pre = requests.options(url, headers={
        "Origin": ORIGIN,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "range",
    }, timeout=30)
    allowed = pre.headers.get("Access-Control-Allow-Headers", "").lower()
    if "range" not in allowed:
        logger.error("CORS preflight does not allow the Range header (got %r)",
                     allowed or "nothing")
        ok = False
    expose = pre.headers.get("Access-Control-Expose-Headers", "").lower()
    if "content-length" not in expose and "*" not in expose:
        logger.warning("Content-Length not exposed to the browser; some "
                       "readers need it")
    return ok


if __name__ == "__main__":
    logger.info("verification %s", "PASSED" if check(sys.argv[1]) else "FAILED")
```

## Step-by-step walkthrough

1. **Put the version in the object key.** A dated file name makes every rebuild a new URL, which lets the archive be cached indefinitely and removes the browser-cache problem entirely.
2. **Set an immutable cache policy.** Because the key changes on every rebuild, the object behind it never changes, so a long lifetime with an immutable directive is both safe and the cheapest possible configuration.
3. **Inspect after converting.** The conversion reports the zoom range, bounds and layer list; comparing that against what the build intended catches a truncated or wrong archive before it is uploaded.
4. **Test the range request, not the header.** Advertising byte-range support and honouring it are different things. Asking for sixteen bytes and counting what arrives is the only test that distinguishes them.
5. **Insist on a partial-content status.** A layer that answers a range request with the whole file returns a normal success status, which is exactly the failure this check exists to find.
6. **Check the CORS preflight for the range header.** Browsers send a preflight naming `Range`; a configuration that allows the origin but not that header fails only in a browser, never in a command-line test.
7. **Watch for exposed headers.** Some client readers need `Content-Length` visible to the page, which requires it to be explicitly exposed in the CORS response.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 239" role="img" aria-labelledby="spo2-t spo2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="spo2-t">Three configuration failures that only appear in a browser</title>
  <desc id="spo2-d">Three panels. A collapsed range happens when a layer in the path answers a range request with the whole file, which returns a success status rather than partial content and downloads gigabytes per tile. A blocked preflight happens when the CORS configuration allows the origin but not the range header, which works from a command line and fails silently in a browser. A missing exposed header happens when content length is not made visible to page scripts, which some readers require to locate directories.</desc>
  <rect x="0" y="0" width="880" height="239" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three failures a command-line test will not find</text>
  <rect x="26" y="52" width="259" height="153" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Collapsed range</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Layer returns the whole file</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Status 200, not 206</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Gigabytes per tile fetched</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Test: ask for 16 bytes</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Count what arrives</text>
  <rect x="311" y="52" width="259" height="153" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Blocked preflight</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Origin allowed, header not</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Browsers preflight Range</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Works from the shell</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Fails silently in a page</text>
  <text x="325" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Test: send a preflight</text>
  <rect x="595" y="52" width="259" height="153" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Hidden headers</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Content-Length not exposed</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Reader cannot locate data</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Map loads then stalls</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Test: check expose header</text>
  <text x="609" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Add it to the CORS policy</text>
  <text x="868" y="223" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">All three produce a map that fails to load with no server-side error: every request involved succeeded from the origin's point of view.</text>
</svg>
<figcaption>These are the reasons a serverless tile set is a configuration problem rather than a code problem.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="spo3-t spo3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="spo3-t">What each layer in the delivery path must do for a serverless tile set to work</title>
  <desc id="spo3-d">A grid of four delivery layers against the two capabilities each must provide. Object storage must honour byte ranges and must attach the CORS policy. The content delivery network must forward and cache ranged responses correctly and must not strip CORS headers. Any reverse proxy in the path must pass range headers through untouched. The browser must be permitted to send the range header by the CORS preflight. A note observes that a single layer failing either capability breaks the whole arrangement.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four layers, and every one of them can break it</text>
  <rect x="206" y="48" width="324" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="368" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Must honour ranges</text>
  <rect x="530" y="48" width="324" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="692" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Must pass CORS</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Object storage</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">yes, natively</text>
  <text x="692" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">policy attached here</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Edge network</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">forward and cache</text>
  <text x="692" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">must not strip</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Reverse proxy</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">pass through</text>
  <text x="692" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">pass through</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Browser</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="368" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">sends the header</text>
  <text x="692" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">preflights it first</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Testing against the origin alone proves nothing: the failure is almost always introduced by a layer added between the origin and the reader.</text>
</svg>
<figcaption>Because one broken layer breaks everything, the verification has to run against the public URL a reader will actually use.</figcaption>
</figure>

## Verification

- **A sixteen-byte range returns sixteen bytes.** Anything else means a layer in the path is collapsing ranges.
- **The status is partial content.** A plain success status on a range request is the signature of the same problem.
- **The preflight allows the range header.** Test with an options request carrying the origin and the requested header.
- **The archive's metadata matches the build.** Zoom range, bounds and layer list should be exactly what the generator produced.
- **A cold client loads in a handful of requests.** Watch the network panel: header, directory, then tiles. A long sequence of directory reads means the archive is deeply nested and may benefit from reclustering.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Whole archive downloaded per tile | A layer collapses range requests | Test with a small range and require partial content |
| Map loads from the shell, not the browser | CORS preflight rejects the range header | Allow `Range` in the allowed-headers policy |
| Map loads then stalls | `Content-Length` not exposed to scripts | Expose it in the CORS response |
| Readers see a stale archive | Object key reused across rebuilds | Put a version token in the object key |
| Archive rewritten every few minutes | Immutable format with incremental updates | Use an updateable archive format instead |
| Client reports an unsupported version | Archive written by an older tool | Convert with a current toolchain and re-inspect |
| High cost per request | Cache lifetime too short for immutable objects | Set a long lifetime and rely on versioned keys |

## Specification reference

> A PMTiles archive is a single file beginning with a fixed-size header followed by a hierarchical directory structure and then tile data, designed so that a client can locate and retrieve an individual tile using HTTP range requests without a server-side component. Clients require the storage layer and any intermediaries to honour range requests and, for browser use, to permit the `Range` header through CORS. See the [PMTiles specification](https://github.com/protomaps/PMTiles) for the header layout and directory format.

## Frequently Asked Questions

<details>
<summary>Why does my map work from the command line but not in a browser?</summary>

Almost always CORS. A browser sends a preflight request naming the `Range` header before it will issue a ranged fetch to another origin, and a configuration that permits the origin but not that specific header rejects the preflight. Command-line clients do not preflight, so the same archive works perfectly from a shell. Test with an explicit options request carrying the origin and the requested header.
</details>

<details>
<summary>How do I know range requests are really being honoured?</summary>

Ask for a small range and count the bytes that come back. A layer that ignores ranges returns the entire file with an ordinary success status, which looks like success to every naive check. Requiring a partial-content status and exactly the requested number of bytes distinguishes the two unambiguously, and it is worth running against the public URL rather than the origin, because an edge network is a common place for ranges to be lost.
</details>

<details>
<summary>Can I update a single tile in a published archive?</summary>

Not practically. The format is laid out for read efficiency rather than in-place modification, so changing a tile means rewriting the file. That is fine for a tile set rebuilt as a unit on a daily or weekly cadence, and unworkable for one updated from minutely diffs. If your tile set changes continuously, use an updateable archive behind a server instead.
</details>

<details>
<summary>What cache lifetime should I set?</summary>

A very long one, provided the object key carries a version token. Because a rebuild produces a new key, the object behind any given URL never changes, so there is no reason for a cache anywhere in the path ever to revalidate it. That combination — versioned keys plus an immutable, long-lived cache policy — is what makes serverless tile delivery cheap.
</details>

## Related

- [Serving & Invalidating OSM Tiles](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/) — the parent topic and the format comparison behind this choice.
- [Invalidating Tile Caches After an OSM Diff](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/invalidating-tile-caches-after-an-osm-diff/) — the approach for archives that do change in place.
- [Generating MBTiles from OSM GeoJSON](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/generating-mbtiles-from-osm-geojson/) — producing the archive this converts.
- [Running Planetiler on a Regional Extract](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/running-planetiler-on-a-regional-extract/) — a generator that can emit this format directly.
- [Automating ODbL Attribution in Derived Products](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/automating-odbl-attribution-in-derived-products/) — the attribution the archive metadata must carry.

Up one level: [Serving & Invalidating OSM Tiles](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Serving PMTiles from Object Storage",
  "description": "Deliver a vector tile set with no server: convert an MBTiles archive to PMTiles, upload it, and configure the range requests, CORS headers and caching a client reader depends on.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Vector Tiles & Rendering Pipelines",
  "about": ["PMTiles", "HTTP range requests", "serverless tile delivery"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Vector Tiles & Rendering Pipelines", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/" },
    { "@type": "ListItem", "position": 3, "name": "Serving & Invalidating OSM Tiles", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/" },
    { "@type": "ListItem", "position": 4, "name": "Serving PMTiles from Object Storage", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/serving-and-invalidating-osm-tiles/serving-pmtiles-from-object-storage/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Publish a PMTiles archive to object storage",
  "description": "Convert an MBTiles archive, upload it under a versioned key with an immutable cache policy, and verify that range requests and the CORS preflight both work through the full delivery path.",
  "step": [
    { "@type": "HowToStep", "name": "Convert and inspect", "text": "Convert the archive and read back its zoom range, bounds and layer list to confirm it matches the build." },
    { "@type": "HowToStep", "name": "Version the object key", "text": "Include a build token in the file name so each rebuild is a new URL that no cache has seen." },
    { "@type": "HowToStep", "name": "Set an immutable cache policy", "text": "Because versioned keys never change content, set a long lifetime with an immutable directive." },
    { "@type": "HowToStep", "name": "Test a small range", "text": "Request a few bytes and require a partial-content status and exactly that many bytes in return." },
    { "@type": "HowToStep", "name": "Test the CORS preflight", "text": "Send an options request naming the origin and the range header, and confirm the header is allowed." },
    { "@type": "HowToStep", "name": "Expose the length header", "text": "Make content length visible to page scripts, which some client readers require." }
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
      "name": "Why does my PMTiles map work from the command line but not in a browser?",
      "acceptedAnswer": { "@type": "Answer", "text": "Almost always CORS. A browser sends a preflight request naming the Range header before it will issue a ranged fetch to another origin, and a configuration that permits the origin but not that specific header rejects the preflight. Command-line clients do not preflight, so the same archive works perfectly from a shell." }
    },
    {
      "@type": "Question",
      "name": "How do I know HTTP range requests are really being honoured?",
      "acceptedAnswer": { "@type": "Answer", "text": "Ask for a small range and count the bytes that come back. A layer that ignores ranges returns the entire file with an ordinary success status, which looks like success to every naive check. Requiring a partial-content status and exactly the requested number of bytes distinguishes the two, and it is worth running against the public URL rather than the origin." }
    },
    {
      "@type": "Question",
      "name": "Can I update a single tile in a published PMTiles archive?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not practically. The format is laid out for read efficiency rather than in-place modification, so changing a tile means rewriting the file. That is fine for a tile set rebuilt as a unit on a daily or weekly cadence, and unworkable for one updated from minutely diffs." }
    },
    {
      "@type": "Question",
      "name": "What cache lifetime should I set for a PMTiles archive?",
      "acceptedAnswer": { "@type": "Answer", "text": "A very long one, provided the object key carries a version token. Because a rebuild produces a new key, the object behind any given URL never changes, so there is no reason for a cache anywhere in the path ever to revalidate it. Versioned keys plus an immutable, long-lived cache policy is what makes serverless tile delivery cheap." }
    }
  ]
}
</script>
