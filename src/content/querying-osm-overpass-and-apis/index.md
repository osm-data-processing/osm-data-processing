---
title: "Querying OSM: Overpass, Nominatim & APIs"
description: "The read and write service layer of OpenStreetMap — Overpass QL, Nominatim geocoding, the editing API, and extract providers — and the engineering rules that keep a pipeline inside their limits."
pageTitle: "Querying OSM: Overpass, Nominatim & API Pipelines"
pageDescription: "Engineer against the OpenStreetMap service layer: Overpass QL semantics and quotas, Nominatim geocoding, the editing API and changeset upload, extract providers, and when a local file beats a live query."
slug: querying-osm-overpass-and-apis
type: overview
breadcrumb: "Querying & APIs"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Querying OSM: Overpass, Nominatim & APIs

<figure class="diagram-wrap">
<svg viewBox="0 0 880 362" role="img" aria-labelledby="qoa1-t qoa1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="qoa1-t">The four OpenStreetMap services a pipeline talks to and what each returns</title>
  <desc id="qoa1-d">A pipeline in the centre reaches four OpenStreetMap services. Overpass answers ad hoc element queries and returns JSON or XML. Nominatim answers place and address lookups and returns ranked candidates. The editing API reads single objects and accepts changeset uploads. Extract providers serve whole regional PBF files on a daily cadence. Each service returns a different shape of data and carries a different quota, so the pipeline chooses one per question rather than defaulting to whichever is easiest to call.</desc>
  <defs><marker id="qoa1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="362" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four services, four answer shapes, four quotas</text>
  <rect x="26" y="158" width="240" height="56" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="146" y="182" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">your pipeline</text>
  <text x="146" y="200" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">asks one question</text>
  <rect x="320" y="50" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="74" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Overpass API</text>
  <text x="440" y="92" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">ad hoc element query</text>
  <rect x="320" y="122" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Nominatim</text>
  <text x="440" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">place and address search</text>
  <rect x="320" y="194" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="218" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Editing API</text>
  <text x="440" y="236" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">single object, upload</text>
  <rect x="320" y="266" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="290" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Extract provider</text>
  <text x="440" y="308" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">whole region, daily</text>
  <rect x="614" y="50" width="240" height="56" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="734" y="74" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">JSON or XML</text>
  <text x="734" y="92" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">elements, tags, members</text>
  <rect x="614" y="122" width="240" height="56" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="734" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">ranked places</text>
  <text x="734" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">with address detail</text>
  <rect x="614" y="194" width="240" height="56" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="734" y="218" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">object versions</text>
  <text x="734" y="236" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">and changeset ids</text>
  <rect x="614" y="266" width="240" height="56" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="734" y="290" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">PBF file</text>
  <text x="734" y="308" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">read locally, no quota</text>
  <line x1="266" y1="186" x2="293" y2="186" stroke="currentColor" stroke-width="1.4"/>
  <line x1="293" y1="78" x2="293" y2="294" stroke="currentColor" stroke-width="1.4"/>
  <line x1="293" y1="78" x2="317" y2="78" stroke="currentColor" stroke-width="1.4" marker-end="url(#qoa1-a)"/>
  <line x1="293" y1="150" x2="317" y2="150" stroke="currentColor" stroke-width="1.4" marker-end="url(#qoa1-a)"/>
  <line x1="293" y1="222" x2="317" y2="222" stroke="currentColor" stroke-width="1.4" marker-end="url(#qoa1-a)"/>
  <line x1="293" y1="294" x2="317" y2="294" stroke="currentColor" stroke-width="1.4" marker-end="url(#qoa1-a)"/>
  <line x1="560" y1="78" x2="587" y2="78" stroke="currentColor" stroke-width="1.4"/>
  <line x1="560" y1="150" x2="587" y2="150" stroke="currentColor" stroke-width="1.4"/>
  <line x1="560" y1="222" x2="587" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="560" y1="294" x2="587" y2="294" stroke="currentColor" stroke-width="1.4"/>
  <line x1="587" y1="78" x2="587" y2="294" stroke="currentColor" stroke-width="1.4"/>
  <line x1="587" y1="78" x2="611" y2="78" stroke="currentColor" stroke-width="1.4" marker-end="url(#qoa1-a)"/>
  <line x1="587" y1="150" x2="611" y2="150" stroke="currentColor" stroke-width="1.4" marker-end="url(#qoa1-a)"/>
  <line x1="587" y1="222" x2="611" y2="222" stroke="currentColor" stroke-width="1.4" marker-end="url(#qoa1-a)"/>
  <line x1="587" y1="294" x2="611" y2="294" stroke="currentColor" stroke-width="1.4" marker-end="url(#qoa1-a)"/>
  <text x="868" y="346" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Nothing here is interchangeable: asking Overpass for a country, or the editing API for a bulk read, is how a pipeline gets blocked.</text>
</svg>
<figcaption>Choosing the wrong service is rarely a performance problem first — it is a quota problem first, and a correctness problem second.</figcaption>
</figure>

Everything on this site up to now assumes a file: an extract on disk, parsed with a streaming reader, normalized and written to a sink. That assumption is right most of the time, and it is why [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/) opens with the PBF container rather than with an HTTP client. But real pipelines also talk to the live OpenStreetMap service layer: to ask a question too small to justify downloading a continent, to geocode a column of addresses, to read the current version of one object before deciding whether a cached copy is stale, or — rarely and carefully — to write an edit back.

This section covers that service layer as an engineering surface. It serves mapping engineers who need a query answered today, ETL developers wiring an external call into a scheduled job, and GIS analysts who want a bounded dataset without standing up a parsing stack. The unifying theme is that every one of these services is a shared public resource with a quota, and the difference between a pipeline that works for years and one that gets its address blocked in a week is almost entirely about respecting those quotas by design rather than by apology.

## What Each Service Actually Is

The four services differ in what they store, not just in what they return, and confusing them is the root of most misuse.

**Overpass API** is a read-only query engine over a continuously updated copy of the OSM database, exposed through its own language, Overpass QL. It is not a REST API over objects; it is closer to a database with a query planner, and it will happily accept a query that scans a continent and then refuse to finish it. Its unit of work is a *set* of elements produced by filters and set operations, and its cost model is dominated by how many elements a filter must touch before the bounding box narrows the search.

**Nominatim** is a geocoder built on an imported OSM database with its own indexing of places, addresses and administrative hierarchies. It answers two questions — "where is this text?" and "what is at this coordinate?" — and it answers them with a *ranking*, not a lookup. Treating a Nominatim result as a deterministic key is the classic mistake; it is a search result, and search results change when the underlying map changes.

**The editing API** (the `/api/0.6/` endpoints) is the authoritative interface to the live database. It serves single objects and small bounding boxes, and it accepts changeset uploads. It is deliberately hostile to bulk reads, because it is the same machinery every editor depends on. Its read half is useful for checking one object's current version; its write half is the only legitimate way to put data back into the map, and it is covered with the care it deserves in [The OSM Editing API & Changeset Upload](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/).

**Extract providers** are not an API at all — they are file servers publishing pre-cut regional PBF files, usually daily. They have no quota worth worrying about, they are the cheapest possible source per element, and they are the right answer far more often than the other three. [OSM Extract Providers & Automated Downloads](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/) covers how to consume them reproducibly.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="qoa2-t qoa2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="qoa2-t">The four OSM services compared on freshness, volume ceiling, cost and failure mode</title>
  <desc id="qoa2-d">A grid comparing Overpass, Nominatim, the editing API and extract providers across four questions. Freshness ranges from minutes for Overpass and the editing API to daily for extracts. The practical volume ceiling is thousands of elements for Overpass, one request per second for Nominatim, one object per call for the editing API, and unlimited for a local extract. The cost falls on a shared public server for the first three and on your own disk for extracts. The typical failure mode is a timeout for Overpass, a block for Nominatim, a rejected upload for the editing API, and a stale file for extracts.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Pick the service from the row that matters to your job</text>
  <rect x="196" y="48" width="164" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="278" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Overpass</text>
  <rect x="360" y="48" width="164" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="443" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Nominatim</text>
  <rect x="525" y="48" width="164" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="607" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Editing API</text>
  <rect x="690" y="48" width="164" height="30" rx="6" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="772" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Extracts</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Freshness</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="278" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">minutes</text>
  <text x="443" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">hours to days</text>
  <text x="607" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">live</text>
  <text x="772" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">daily</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Volume ceiling</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="278" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">thousands</text>
  <text x="443" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">1 req/sec</text>
  <text x="607" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">one object</text>
  <text x="772" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">none</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Who pays</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="278" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">shared server</text>
  <text x="443" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">shared server</text>
  <text x="607" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">shared server</text>
  <text x="772" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">your disk</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Fails as</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="278" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">timeout</text>
  <text x="443" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">HTTP 429</text>
  <text x="607" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">rejected upload</text>
  <text x="772" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">stale data</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The bottom row is the one to design against: each service fails in a different way, and only the extract's failure is silent.</text>
</svg>
<figcaption>A stale extract is the most dangerous failure here precisely because nothing errors — the pipeline succeeds against yesterday's map.</figcaption>
</figure>

## Overpass QL: the Model Behind the Syntax

Overpass QL reads like a filter language, but it is a set algebra. Each statement produces a set of elements; `->.name` binds a set to a variable, a bare statement writes into the default set `_`, and the final `out` statement serialises whatever is in the set you point it at. Understanding this is what turns "why does my query return nothing" into a five-second diagnosis, because an empty result almost always means a set was overwritten rather than that the data is missing.

Three primitives carry most real work. A **tag filter** like `node["amenity"="pharmacy"]` narrows by key and value, with regular-expression forms (`~`), negations (`!=`) and existence tests (`["amenity"]`). A **spatial filter** — a bounding box `(s,w,n,e)`, an `(around:radius,lat,lon)` clause, or an `(area)` reference resolved from an administrative relation — narrows by geography. And a **recursion operator** — `>` for "and their members and nodes", `<` for "and the parents that reference them" — completes a partial result into something geometrically usable. The overwhelming majority of Overpass queries in production are one tag filter, one spatial filter, and one recursion, and the ones that time out are usually the ones that got the order wrong. [Overpass API Query Language](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/) develops the full model with worked queries.

The output format matters as much as the filter. `out body;` emits elements with tags but no geometry for ways; `out geom;` inlines coordinates onto each way and relation member, which is far larger but removes the need to resolve node references yourself; `out center;` collapses each way or relation to a single representative point, which is exactly what you want for a point-of-interest layer and a fraction of the bytes. Choosing `out geom` when `out center` would do is one of the easiest order-of-magnitude savings available, and it costs one word.

## Quotas, Timeouts and the Etiquette That Is Actually a Spec

Every public instance of these services publishes usage limits, and they are enforced, not aspirational. Overpass applies a per-query timeout (settable with `[timeout:n]`, capped server-side) and a memory ceiling (`[maxsize:n]`), and it queues requests per client with a slot system that returns HTTP 429 when you exceed your share. Nominatim's public instance permits roughly one request per second from a single source, requires an identifying `User-Agent`, and blocks sources that ignore either. The editing API rate-limits writes and rejects changesets that are too large or that lack a meaningful comment.

The engineering consequence is that retry logic is not optional garnish, it is the main event. A client that retries immediately on a 429 converts a soft throttle into a hard block; a client that retries with exponential backoff and honours a `Retry-After` header rides the throttle out and finishes. Equally important is the *shape* of the workload: a hundred small queries issued back-to-back are much harder on a shared server than one query that asks for the same data in a single pass, and they are also slower for you. [Handling Overpass Timeouts and Rate Limits](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/handling-overpass-timeouts-and-rate-limits/) turns this into a concrete client, and [Batch Geocoding with Nominatim Without Getting Blocked](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/batch-geocoding-with-nominatim-without-getting-blocked/) does the same for the geocoder.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="qoa3-t qoa3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="qoa3-t">What a well-behaved client does when a shared OSM service pushes back</title>
  <desc id="qoa3-d">A four-step response to a rate limit. First, read the status: a 429 with a Retry-After header is an instruction, not an error. Second, wait the full interval with jitter so a fleet of workers does not retry in lockstep. Third, halve the concurrency for the rest of the run rather than restoring it immediately. Fourth, cache the successful response so a rerun of the same job never asks twice. A note adds that retrying immediately is what converts a soft throttle into a hard block.</desc>
  <defs><marker id="qoa3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">A 429 is an instruction, not an error</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">read</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">429 plus Retry-After</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">the server said how long</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#qoa3-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">wait</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">full interval, jittered</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">never in lockstep</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#qoa3-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">back off</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">halve concurrency</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">for the rest of the run</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#qoa3-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">cache</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">store the response</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">a rerun asks once</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Caching is the step teams skip, and it is the one that removes most of the traffic: reruns during development dominate real production volume.</text>
</svg>
<figcaption>Three of these four steps are about the next request; the fourth is about never needing to make it.</figcaption>
</figure>

## Geocoding Is a Ranking Problem, Not a Lookup

Nominatim answers with candidates ordered by an importance score derived from place rank, address completeness and, where present, external popularity signals. A forward geocode of "Springfield" returns many real answers, and the right one depends entirely on context your query did not supply. This has two practical consequences for a pipeline.

First, **always constrain**. A `countrycodes` parameter, a `viewbox` with `bounded=1`, or a structured query that supplies `street`, `city` and `postalcode` separately narrows the candidate space far more effectively than any post-hoc filtering of a free-text result. Structured queries also sidestep the parser's guesswork about which token is a street and which is a suburb.

Second, **never treat a geocode as stable**. The coordinate returned for an address can move when a mapper improves the data, and the `osm_id` attached to a result can change when a way is replaced by a relation. If you need stability, store the returned identifier *and* the coordinate *and* the date, and re-resolve on a schedule rather than assuming yesterday's answer. The identity question underneath this is the same one [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/) works through for the file-based pipeline.

For anything beyond a few thousand lookups, the honest answer is to stop calling the public service and run your own. A Nominatim import from a regional extract is a well-trodden path, it removes the rate limit entirely, and it makes the geocoder reproducible — the same input gives the same output until you choose to re-import. [Importing Nominatim from an OSM Extract](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/importing-nominatim-from-an-osm-extract/) covers the sizing and the import itself.

## Writing Back: the Editing API and the Duty of Care

Reading OSM is a technical decision; writing to it is a social one. The editing API will accept a changeset from any authenticated account, and the community's tolerance for automated edits is conditional on those edits being discussed, documented, reversible and small. The mechanics are straightforward — open a changeset, upload an `osmChange` document, close the changeset — and they are covered in [Uploading an OSM Changeset from Python](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/uploading-an-osm-changeset-from-python/). The discipline around them is what matters.

Three rules carry most of the weight. Every automated edit needs a **changeset comment that names the source, the script and a contact point**, because the first thing a reviewer does with a suspicious edit is look for a human to ask. Every bulk edit needs a **dry run against the development API** before it touches the live database, which costs an hour and has saved countless reverts; [Dry-Running a Bulk Edit Against the Dev API](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/dry-running-a-bulk-edit-against-the-dev-api/) shows the setup. And every edit needs **a version check immediately before upload**, because the API rejects a change to an object whose version has moved on, and a client that blindly retries with a bumped version silently overwrites somebody else's work.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 239" role="img" aria-labelledby="qoa4-t qoa4-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="qoa4-t">Three ways an automated OSM edit goes wrong and what prevents each</title>
  <desc id="qoa4-d">Three panels describing failure modes of automated editing. A conflict happens when the object version moved between read and write, and is prevented by re-reading the version immediately before upload. An unreviewable edit happens when the changeset comment names no source, script or contact, and is prevented by a comment template enforced in code. An irreversible edit happens when one changeset carries thousands of unrelated objects, and is prevented by splitting the work into small, single-purpose changesets that a reviewer can revert independently.</desc>
  <rect x="0" y="0" width="880" height="239" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three failure modes of automated editing</text>
  <rect x="26" y="52" width="259" height="153" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Version conflict</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Object changed between read and write</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">API returns HTTP 409</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Blind retry overwrites a mapper</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Fix: re-read version before upload</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Never bump the version yourself</text>
  <rect x="311" y="52" width="259" height="153" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Unreviewable edit</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Comment names no source or script</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Reviewer has nobody to ask</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Trust cost lands on everyone</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Fix: template the comment in code</text>
  <text x="325" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Include source, script, contact</text>
  <rect x="595" y="52" width="259" height="153" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Irreversible edit</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">One changeset, thousands of objects</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Mixed unrelated changes</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Revert takes the good with the bad</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Fix: small single-purpose changesets</text>
  <text x="609" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Group by what a revert should undo</text>
  <text x="868" y="223" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">All three are prevented by code you write once, and all three are normally discovered by somebody else after the fact.</text>
</svg>
<figcaption>The changeset is the unit of review and the unit of revert, so its size and scope are engineering decisions, not incidentals.</figcaption>
</figure>

## When Not to Query at All

The most valuable judgement in this section is knowing when the whole service layer is the wrong tool. A live query is right when the question is *small*, *ad hoc*, and *needs current data*. It is wrong when any of those three fail, and it is wrong in a way that gets worse the more successful your pipeline becomes, because a nightly job that queries a public server does not degrade gracefully — it works until somebody notices and blocks it.

The alternative is almost always a regional extract filtered locally. An `osmium tags-filter` pass over a country extract answers the same question as a large Overpass query, runs in seconds on a laptop, costs a shared server nothing, and is reproducible because the input file is a fixed artefact you can archive. The migration path from one to the other is mechanical, and [Replacing an Overpass Query with an osmium Filter](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/replacing-an-overpass-query-with-an-osmium-filter/) walks it end to end. [Choosing Between Overpass and a Local Extract](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/) frames the decision itself.

The inverse case is real too. If your question covers a handful of features in a city and must reflect an edit made ten minutes ago, downloading a daily extract answers the wrong question no matter how efficiently you parse it. Freshness is a requirement like any other, and the replication machinery in [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/) exists precisely because "current" and "local" are not mutually exclusive — they just cost more engineering than either one alone.

## Client Engineering: the Parts Every Integration Needs

Whichever service you talk to, the client-side requirements are nearly identical, which is why it pays to build them once.

- **An identifying `User-Agent`.** A string naming your project and a contact address. Anonymous traffic is the first thing an operator blocks, and a named client is the one that gets an email instead.
- **A response cache keyed on the exact request.** Development reruns dominate real traffic in most projects; a disk cache keyed on the normalized query text removes nearly all of it and makes your test suite deterministic.
- **Bounded concurrency with a single shared limiter.** One semaphore for the whole process, not one per worker, so adding workers never multiplies your request rate.
- **Retry with jittered exponential backoff, capped.** Honour `Retry-After` when present; give up after a bounded number of attempts and surface the failure rather than looping.
- **A hard result-size guard.** Refuse to materialise a response larger than an explicit ceiling, so a mis-scoped query fails fast rather than exhausting memory.
- **Structured logging of query, duration and element count.** The three numbers that let you find the query that got you throttled, weeks later.

That list is short enough to implement in an afternoon and is the difference between an integration that survives contact with production and one that has to be rewritten the first time it is scheduled.

## Validation and Error Handling

Service responses need the same defensive treatment as parsed files, and a few failure classes recur often enough to deserve named handling.

| Condition | Root cause | Detection | Remediation |
| --- | --- | --- | --- |
| Empty Overpass result | A later statement overwrote the default set | Result has zero elements but no error | Bind sets explicitly with `->.name` and union at the end |
| Overpass HTTP 504 | Query exceeded the server timeout | Gateway timeout after the declared `[timeout:n]` | Narrow the spatial filter first, then raise the timeout |
| Overpass HTTP 429 | Too many concurrent slots for your address | Rate-limit response with `Retry-After` | Back off, halve concurrency, cache successes |
| Nominatim returns the wrong country | Unconstrained free-text search | Result `country_code` differs from expectation | Use a structured query plus `countrycodes` |
| Nominatim blocked | Missing `User-Agent` or over one request per second | Persistent 403 or 429 | Add an identifying agent, throttle, or self-host |
| Changeset upload 409 | Object version moved since you read it | Conflict response naming the object | Re-read the object, re-apply intent, never bump blindly |
| Downloaded extract truncated | Interrupted transfer, no integrity check | Parser fails at a blob boundary | Verify the published checksum before use |
| Extract silently stale | Mirror stopped updating | File timestamp older than the expected cadence | Assert freshness on the file date as a pipeline gate |

The last two rows are worth dwelling on because they fail *quietly*. An HTTP error is loud and a monitoring system will catch it; a daily extract that stopped refreshing two weeks ago produces perfectly valid output derived from stale input, and the only defence is an explicit assertion on the file's publication date before parsing begins.

## Performance and Scale

Throughput on the service layer is governed by round trips, not by bytes. A query that returns ten megabytes in one response is almost always faster and cheaper than a hundred queries returning a hundred kilobytes each, because per-request overhead — queueing, planning, TLS, and the server's own slot accounting — dominates. The practical patterns that follow from this are: batch spatially (one bounding box covering a work area rather than one per feature), batch by tag (one query with a union of filters rather than one query per amenity type), and prefer `out center` over `out geom` whenever a representative point is enough.

For geocoding, the corresponding rule is to deduplicate before you call. Address lists from real systems are heavily repetitive, and normalising case, whitespace and punctuation before the lookup routinely removes a third of the calls without changing a single result. [Parsing Nominatim Address Details into Columns](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/parsing-nominatim-address-details-into-columns/) covers the structured response that makes this deduplication reliable on the way back out.

Beyond a few thousand requests an hour, the answer stops being tuning and starts being hosting. Running your own Overpass instance, described in [Running a Local Overpass Instance for Bulk Queries](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/running-a-local-overpass-instance-for-bulk-queries/), converts a quota problem into a capacity-planning problem, which is a much better problem to have.

## Licensing and Attribution

Data retrieved through any of these services is OpenStreetMap data and carries the Open Database Licence exactly as a downloaded extract does. The service you used to fetch it changes nothing about your attribution obligation or about whether a derived database triggers share-alike. Because API-sourced data often arrives in small pieces and gets blended into other datasets, it is *easier* to lose track of its provenance than with a single downloaded file — which makes recording provenance at fetch time more important, not less. The obligations themselves are worked through in [OSM Licensing & ODbL Compliance](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/), and the mechanics of carrying provenance through a pipeline are in [Recording OSM Data Provenance in a Pipeline](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-licensing-and-odbl-compliance/recording-osm-data-provenance-in-a-pipeline/).

## Topics in This Section

- [Overpass API Query Language](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/) — the set algebra behind Overpass QL, the filters that matter, output modes, and the client behaviour a shared server expects.
- [Nominatim Geocoding Pipelines](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/) — forward and reverse geocoding as a ranking problem, structured queries, and the point at which self-hosting wins.
- [The OSM Editing API & Changeset Upload](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-editing-api-and-changeset-upload/) — reading current object versions, building an `osmChange` document, and uploading edits that survive review.
- [OSM Extract Providers & Automated Downloads](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/) — choosing a provider, verifying integrity, and making a scheduled download reproducible.
- [Choosing Between Overpass and a Local Extract](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/) — the decision itself, with a cost model and a mechanical migration path in both directions.

## Frequently Asked Questions

<details>
<summary>Is Overpass a REST API I can just call in a loop?</summary>

No. Overpass is a query engine with a planner, a per-query timeout and a memory ceiling, and public instances allocate concurrent slots per client address. A loop of small queries is both slower for you and far harder on the server than a single query that asks for the same data in one pass. Design the workload as few large queries with explicit set bindings, cache every successful response, and back off when the server returns a rate-limit status.
</details>

<details>
<summary>How many Nominatim requests per second is acceptable?</summary>

The public instance's usage policy allows roughly one request per second from a single source, and requires a User-Agent that identifies your application. Above that, the correct answer is not a faster client but your own instance imported from a regional extract, which removes the limit entirely and makes results reproducible. Deduplicating addresses before lookup typically removes a large fraction of calls at no cost to correctness.
</details>

<details>
<summary>When should I download an extract instead of querying?</summary>

Whenever the question is repeated, covers a whole region, or will run on a schedule. A local extract filtered with osmium answers most large Overpass queries in seconds, costs a shared server nothing, and is reproducible because the input is a fixed file you can archive. Keep live queries for questions that are small, one-off, and genuinely need data fresher than the extract's daily cadence.
</details>

<details>
<summary>Do I need permission to upload automated edits?</summary>

The API will accept an authenticated changeset without asking, but the community expects automated and bulk edits to be discussed beforehand, documented in the changeset comment with a source and contact, and kept small enough to revert independently. Dry-run against the development API first, re-read each object's version immediately before upload, and never bump a version to force a conflicting change through.
</details>

<details>
<summary>Does data fetched from an API carry different licence terms?</summary>

No. Data retrieved through Overpass, Nominatim or the editing API is OpenStreetMap data under the Open Database Licence exactly as a downloaded file is. Because API responses are small and get blended into other datasets, provenance is easier to lose, so record the source, the query and the fetch time alongside the data at the moment you receive it rather than reconstructing it later.
</details>

## Related

- [OSM Data Fundamentals & Architecture](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/) — the element model and file formats every response here is expressed in.
- [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) — where fetched elements go once they are in hand.
- [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/) — the alternative route to freshness that does not depend on a shared query server.
- [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) — the rule catalogue that should run over fetched data before it is trusted.
- [OSM Conflation & Data Enrichment](https://www.osm-data-processing.org/osm-conflation-and-enrichment/) — the usual destination for geocoded and API-sourced records.
- [Choosing an OSM Parser: pyosmium, pyrosm or osmium-tool](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/) — the local-file alternative most large queries should become.

Up one level: [OSM Data Processing & QA Pipelines](https://www.osm-data-processing.org/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Querying OSM: Overpass, Nominatim & APIs",
  "description": "The read and write service layer of OpenStreetMap — Overpass QL, Nominatim geocoding, the editing API, and extract providers — and the engineering rules that keep a pipeline inside their limits.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Querying OSM: Overpass, Nominatim & APIs",
  "about": ["Overpass API", "Nominatim geocoding", "OpenStreetMap API"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Querying OSM: Overpass, Nominatim & APIs", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Choose and call the right OpenStreetMap service for a pipeline question",
  "description": "Decide between Overpass, Nominatim, the editing API and a downloaded extract, then build a client that respects the quota of whichever service you chose.",
  "step": [
    { "@type": "HowToStep", "name": "Classify the question", "text": "Decide whether the question is small and ad hoc, repeated and regional, or a write, because each maps to a different service with a different quota." },
    { "@type": "HowToStep", "name": "Prefer a file when you can", "text": "If the question is repeated or covers a whole region, download a regional extract and filter it locally instead of querying a shared server." },
    { "@type": "HowToStep", "name": "Constrain every live query", "text": "Bind Overpass sets explicitly and narrow spatially before filtering by tag; supply country codes and structured fields to Nominatim rather than free text." },
    { "@type": "HowToStep", "name": "Build the client once", "text": "Add an identifying User-Agent, a disk cache keyed on the request, one shared concurrency limiter, jittered backoff honouring Retry-After, and a response-size guard." },
    { "@type": "HowToStep", "name": "Record provenance at fetch time", "text": "Store the service, the exact query and the fetch timestamp alongside the data so attribution and reproducibility survive later blending." }
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
      "name": "Is Overpass a REST API I can just call in a loop?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. Overpass is a query engine with a planner, a per-query timeout and a memory ceiling, and public instances allocate concurrent slots per client address. A loop of small queries is both slower for you and far harder on the server than a single query that asks for the same data in one pass. Design the workload as few large queries with explicit set bindings, cache every successful response, and back off when the server returns a rate-limit status." }
    },
    {
      "@type": "Question",
      "name": "How many Nominatim requests per second is acceptable?",
      "acceptedAnswer": { "@type": "Answer", "text": "The public instance's usage policy allows roughly one request per second from a single source, and requires a User-Agent that identifies your application. Above that, the correct answer is not a faster client but your own instance imported from a regional extract, which removes the limit entirely and makes results reproducible. Deduplicating addresses before lookup typically removes a large fraction of calls at no cost to correctness." }
    },
    {
      "@type": "Question",
      "name": "When should I download an extract instead of querying?",
      "acceptedAnswer": { "@type": "Answer", "text": "Whenever the question is repeated, covers a whole region, or will run on a schedule. A local extract filtered with osmium answers most large Overpass queries in seconds, costs a shared server nothing, and is reproducible because the input is a fixed file you can archive. Keep live queries for questions that are small, one-off, and genuinely need data fresher than the extract's daily cadence." }
    },
    {
      "@type": "Question",
      "name": "Do I need permission to upload automated edits?",
      "acceptedAnswer": { "@type": "Answer", "text": "The API will accept an authenticated changeset without asking, but the community expects automated and bulk edits to be discussed beforehand, documented in the changeset comment with a source and contact, and kept small enough to revert independently. Dry-run against the development API first, re-read each object's version immediately before upload, and never bump a version to force a conflicting change through." }
    },
    {
      "@type": "Question",
      "name": "Does data fetched from an API carry different licence terms?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. Data retrieved through Overpass, Nominatim or the editing API is OpenStreetMap data under the Open Database Licence exactly as a downloaded file is. Because API responses are small and get blended into other datasets, provenance is easier to lose, so record the source, the query and the fetch time alongside the data at the moment you receive it rather than reconstructing it later." }
    }
  ]
}
</script>
