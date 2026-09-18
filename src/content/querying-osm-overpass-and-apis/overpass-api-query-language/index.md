---
title: "Overpass API Query Language"
description: "Overpass QL as a set algebra: filters, spatial narrowing, recursion, output modes, and the cost model that decides whether a query returns in a second or times out."
pageTitle: "Overpass QL: Query Model, Filters & Cost Control"
pageDescription: "Write Overpass QL that finishes: understand the set algebra, order spatial and tag filters correctly, choose the right out mode, and control cost with timeout, maxsize and bounded recursion."
slug: overpass-api-query-language
type: guide
breadcrumb: "Overpass QL"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Overpass API Query Language

A query that works on a city and times out on a country is not a scaling problem — it is a query that was always doing the wrong work and only got away with it because the data was small. Overpass QL looks like a filter expression language, and that resemblance is what leads people to write `node["amenity"]` with a continent-sized bounding box and then blame the server. The language is a set algebra over a spatial database, and once you read it that way the cost of every clause becomes visible before you press run.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 226" role="img" aria-labelledby="oql1-t oql1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="oql1-t">The four parts of an Overpass query and what each one costs</title>
  <desc id="oql1-d">A single query broken into four consecutive parts. The settings block declares the output format, the query timeout and the memory ceiling, and costs nothing by itself. The element selector names which of node, way or relation to search and is free. The filters narrow by tag and by geography, and this is where essentially all of the query cost lives. The output statement decides how much data is serialised back, which dominates transfer time but not server work.</desc>
  <rect x="0" y="0" width="880" height="226" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Where the time actually goes in one query</text>
  <rect x="26" y="56" width="203" height="54" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="128" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">settings</text>
  <text x="128" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">[out:json][timeout:60]</text>
  <text x="128" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">format, timeout, maxsize</text>
  <text x="128" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">costs nothing itself</text>
  <text x="128" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">but caps everything after</text>
  <rect x="233" y="56" width="134" height="54" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="300" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">selector</text>
  <text x="300" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">node / way / rel</text>
  <text x="300" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">which element types</text>
  <text x="300" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">free</text>
  <text x="300" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">narrows nothing alone</text>
  <rect x="371" y="56" width="272" height="54" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="507" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">filters</text>
  <text x="507" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">tags + geography</text>
  <text x="507" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">almost all of the cost</text>
  <text x="507" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">order decides everything</text>
  <text x="507" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">narrow spatially first</text>
  <rect x="647" y="56" width="203" height="54" rx="6" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="748" y="79" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">output</text>
  <text x="748" y="97" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">out body / geom / center</text>
  <text x="748" y="134" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">decides bytes returned</text>
  <text x="748" y="154" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">dominates transfer</text>
  <text x="748" y="174" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.9">not server work</text>
  <text x="868" y="210" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Three of the four parts are nearly free. Tuning the settings block when the filters are wrong is the most common wasted afternoon.</text>
</svg>
<figcaption>The filters are the only part with a real cost model, which is why every optimisation below is about them.</figcaption>
</figure>

## The Problem This Topic Solves

You need a bounded set of OpenStreetMap features — every pharmacy in a metropolitan area, every cycleway crossing an administrative boundary, every building without an address in one district — and you need it now, without downloading and parsing a regional extract. Overpass is built exactly for that, and used within its design envelope it answers in seconds what a local pipeline would need an hour of setup to reproduce.

The failure scenario when this goes wrong is specific and recognisable. A team prototypes against a small bounding box, the query returns in two seconds, and the job is scheduled nightly against a whole country. The first run takes ninety seconds. The second week it starts returning HTTP 504. By the third week the client's address is rate limited and unrelated interactive queries from the same office stop working. Nothing about the query changed; the only thing that changed was the number of elements the filters had to touch. This page is about seeing that number before it bites.

## Prerequisites

Before writing queries in anger, be comfortable with the [node, way and relation data model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/), because Overpass returns raw elements and a way without its nodes is not geometry. Know the tag conventions in [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/), since every filter you write is an assertion about key-value practice. And read the parent [Querying OSM: Overpass, Nominatim & APIs](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/) overview for the quota context this page assumes throughout.

## Sets, Not Pipelines

Every Overpass statement produces a set of elements and writes it somewhere. By default it writes into the unnamed set `_`, and by default the next statement reads from `_`. That is the whole model, and two consequences follow immediately.

The first is that **the default set is overwritten, not accumulated**. Two consecutive statements do not mean "and also"; the second replaces the first. This is the single most common cause of "my query returns nothing" — a spatial filter that reads the default set after a previous statement already emptied it.

The second is that **you can name sets and combine them**. Writing `->.a` at the end of a statement binds its result to `a`; writing `.a` before a filter reads from `a`; and a union block `( .a; .b; )` produces their combination. Once you name sets deliberately, complex queries become readable and, more importantly, debuggable — you can `out` an intermediate set to see exactly where the element count collapsed.

```
[out:json][timeout:90];
// bind the search area once, reuse it twice
area["name"="Kraków"]["admin_level"="8"]->.city;
(
  node["amenity"="pharmacy"](area.city)->.pharm;
  way["amenity"="pharmacy"](area.city);
);
out center tags;
```

Two details in that snippet carry real weight. The `area` statement resolves an administrative relation into an area object once, and both element queries reference it, rather than each re-resolving the boundary. And `out center tags` asks for a representative point plus tags rather than full geometry, which for a point-of-interest layer is all you need and a fraction of the payload.

## Filters, Ordered by What They Cost

Overpass evaluates a query against indexes, and the practical cost model is simple: **a spatial filter is cheap and selective; a tag filter is cheap per element but selective only in proportion to how rare the tag is; a regular-expression tag filter cannot use the value index at all.** Ordering follows directly.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 288" role="img" aria-labelledby="oql2-t oql2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="oql2-t">Relative cost of the common Overpass filter forms</title>
  <desc id="oql2-d">Five filter forms ranked by relative cost. A bounding box or area filter is the cheapest and most selective. An exact key-value filter is nearly as cheap. A key-existence filter is more expensive because common keys match very large numbers of elements. A regular expression on a value cannot use the value index and must test candidates one by one. A regular expression on a key is the most expensive of all because every key on every candidate element must be examined.</desc>
  <rect x="0" y="0" width="880" height="288" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Filter cost, relative to a bounding box</text>
  <text x="26" y="74" font-size="11.5" font-weight="600" fill="currentColor">Bounding box or area</text>
  <rect x="276" y="60" width="11" height="18" rx="4" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="854" y="74" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">baseline</text>
  <text x="26" y="114" font-size="11.5" font-weight="600" fill="currentColor">Exact key=value</text>
  <rect x="276" y="100" width="23" height="18" rx="4" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="854" y="114" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 2x</text>
  <text x="26" y="154" font-size="11.5" font-weight="600" fill="currentColor">Key exists, any value</text>
  <rect x="276" y="140" width="103" height="18" rx="4" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="854" y="154" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 9x</text>
  <text x="26" y="194" font-size="11.5" font-weight="600" fill="currentColor">Regex on the value</text>
  <rect x="276" y="180" width="252" height="18" rx="4" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.3"/>
  <text x="854" y="194" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 22x</text>
  <text x="26" y="234" font-size="11.5" font-weight="600" fill="currentColor">Regex on the key</text>
  <rect x="276" y="220" width="458" height="18" rx="4" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="854" y="234" text-anchor="end" font-size="11" fill="currentColor" opacity="0.92">about 40x</text>
  <text x="868" y="272" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">These are shapes, not benchmarks: the ratios move with the data, but the ordering does not, and the ordering is what decides your query.</text>
</svg>
<figcaption>Every expensive filter is fine once the spatial filter has already cut the candidate set to a city.</figcaption>
</figure>

The rules that follow from that ordering are short:

1. **Put the geography first, always.** `node["amenity"="cafe"](50.0,19.8,50.1,20.1)` and the same filters in the other order describe the same set, but a query with no spatial bound at all asks the server to consider every matching element on Earth before anything narrows it.
2. **Prefer an exact value to a key existence test.** `["highway"="residential"]` touches a small slice; `["highway"]` touches every road, path, crossing and kerb in the area.
3. **Prefer a union of exact values to a regular expression.** `["amenity"~"^(cafe|bar|pub)$"]` is a regex; `(node["amenity"="cafe"](area.a); node["amenity"="bar"](area.a); node["amenity"="pub"](area.a););` is three indexed lookups and is usually faster despite being longer.
4. **Never write a regex on a key** unless you genuinely cannot enumerate the keys — `[~"^addr:"~"."]` is occasionally the only way to ask "does this have any address tag", and it is correspondingly expensive.
5. **Filter by element type.** If you want buildings, ask for `way` and `relation`; asking for `nwr` adds every node in the area to the candidate set for no benefit.

## Spatial Filters in Detail

Three spatial forms cover essentially all real use, and they differ in more than syntax.

A **bounding box** `(south,west,north,east)` is the cheapest and the most predictable. It is also the only one whose cost you can estimate by eye, which makes it the right choice for scheduled jobs where a surprise is worse than a slightly larger result.

An **area filter** `(area.name)` resolves an administrative or other closed relation into a polygon and tests membership properly. It is the right answer when the question is genuinely "inside this city", but it carries two traps: the area has to exist as a mapped relation, and `area` ids are derived from the relation id by an offset, so a hand-written id is a common source of empty results. Resolve areas by name and admin level, bind the result, and check the bound set is non-empty before relying on it.

An **`around` filter** `(around:500,50.06,19.94)` selects elements within a radius of a point, or — in its set form `(around.set:100)` — within a radius of every element of another set. The set form is extraordinarily useful (every bus stop within a hundred metres of a rail station) and extraordinarily expensive, because it evaluates a buffer per element in the driving set. Use it with a driving set you have already made small.

## Recursion: Completing Partial Results

A query for `way["building"]` returns ways whose geometry is a list of node references and nothing else. To get usable geometry you either ask the server to inline it with `out geom`, or you complete the set yourself with a recursion operator.

- `>` ("recurse down") adds the nodes of every way in the set, and the members — and their nodes — of every relation.
- `<` ("recurse up") adds the ways and relations that *reference* the elements in the set. This is how you answer "which routes include this stop".
- `>>` and `<<` are the transitive forms, following nested relation membership all the way. They are the ones that occasionally return a surprising fraction of a country when a route relation turns out to belong to a superroute that spans it.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 306" role="img" aria-labelledby="oql3-t oql3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="oql3-t">Choosing between out geom, recursion and out center</title>
  <desc id="oql3-d">A decision node asking what geometry the consumer actually needs, with three outcomes. If a representative point is enough, out center returns one coordinate per feature and is by far the smallest payload. If full geometry is needed and the result is modest, out geom inlines coordinates onto each element and needs no client-side assembly. If the result is large or nodes are shared between many ways, a recursion followed by out body returns each node once and lets the client assemble geometry, which is smaller on the wire but requires assembly code.</desc>
  <defs><marker id="oql3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="306" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What geometry does the consumer actually need?</text>
  <rect x="26" y="117" width="250" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="151" y="145" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Points, shapes, or both?</text>
  <text x="151" y="167" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Decide before writing out</text>
  <text x="151" y="185" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">It changes payload by 10x</text>
  <line x1="276" y1="161" x2="314" y2="161" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="314" y2="239" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="353" y2="83" stroke="currentColor" stroke-width="1.4" marker-end="url(#oql3-a)"/>
  <rect x="356" y="52" width="498" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="370" y="77" font-size="12" font-weight="700" fill="currentColor">out center tags</text>
  <text x="370" y="97" font-size="10.5" fill="currentColor" opacity="0.88">A representative point per feature is enough</text>
  <line x1="314" y1="161" x2="353" y2="161" stroke="currentColor" stroke-width="1.4" marker-end="url(#oql3-a)"/>
  <rect x="356" y="130" width="498" height="62" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="370" y="155" font-size="12" font-weight="700" fill="currentColor">out geom</text>
  <text x="370" y="175" font-size="10.5" fill="currentColor" opacity="0.88">Full shapes, modest result, no assembly code</text>
  <line x1="314" y1="239" x2="353" y2="239" stroke="currentColor" stroke-width="1.4" marker-end="url(#oql3-a)"/>
  <rect x="356" y="208" width="498" height="62" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="370" y="233" font-size="12" font-weight="700" fill="currentColor">recursion then out body</text>
  <text x="370" y="253" font-size="10.5" fill="currentColor" opacity="0.88">Large result with heavily shared nodes</text>
  <text x="868" y="290" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">out geom repeats a shared node once per way that uses it; on a dense street network that duplication is most of the response.</text>
</svg>
<figcaption>The third branch trades client-side assembly work for a much smaller response, which is the right trade above a few megabytes.</figcaption>
</figure>

## Output Modes and What They Cost You

The `out` statement takes modifiers that change the payload by an order of magnitude, and choosing among them is the cheapest optimisation available.

| Modifier | Returns | Typical use | Cost note |
| --- | --- | --- | --- |
| `out ids;` | Element ids only | Diffing against a cached set | Smallest possible response |
| `out tags;` | Ids and tags, no geometry | Tag analysis where location is irrelevant | Small |
| `out body;` | Tags plus node refs for ways | You will resolve geometry yourself | Needs a recursion to be usable |
| `out center;` | One representative coordinate per element | Point-of-interest layers, markers | Usually the right default |
| `out geom;` | Inlined coordinates on every element | Rendering shapes directly | Largest; duplicates shared nodes |
| `out meta;` | Adds version, timestamp, changeset, user | Provenance and audit trails | Adds roughly a third to the payload |
| `out count;` | Just the number of elements | Estimating a query before running it | Effectively free — use it first |

`out count;` deserves a special mention: running your query with `out count` before running it for real tells you exactly how big the answer is, in one cheap request. Making that a habit removes most accidental continent-scale downloads.

## Validation and Error-Handling Matrix

| Condition | Root cause | Detection | Remediation |
| --- | --- | --- | --- |
| Empty result, no error | A later statement overwrote the default set | `out count` on the intermediate set is zero | Bind sets with `->.name` and read them explicitly |
| Empty result from an area | Area relation not found, or an id offset used by hand | The `area` set itself is empty | Resolve by name and admin level; assert non-empty |
| HTTP 400 with a parse error | Missing semicolon, or a filter after `out` | Server returns the offending line | Keep one statement per line; end every statement |
| HTTP 504 gateway timeout | Query exceeded its declared or server-capped timeout | Response arrives at the timeout boundary | Narrow spatially first; only then raise `[timeout:]` |
| HTTP 429 | Too many concurrent slots from your address | Rate-limit body naming the slot state | Back off, serialise requests, cache successes |
| "runtime error: Query run out of memory" | Candidate set exceeded `[maxsize:]` | Explicit runtime error in the body | Reduce the candidate set; do not just raise maxsize |
| Ways with no coordinates | `out body` without a recursion | Consumers see node refs, not points | Add `>;` before `out`, or switch to `out geom` |
| Result larger than expected | `nwr` used where one type was meant | Element type mix in the response | Name the element types explicitly |

## Performance and Scale

Three levers matter, in this order.

**Narrow before you filter.** Every measurement of Overpass query cost comes back to the size of the candidate set that the expensive filters have to examine. A spatial bound applied first turns a regex filter from a planet scan into a city scan, and the regex then costs nothing worth discussing.

**Ask once, not many times.** Per-request overhead dominates small queries, and the server's slot accounting punishes concurrency far more than it punishes size. One query returning ten thousand elements is cheaper for everybody than fifty queries returning two hundred each. When a loop over inputs seems unavoidable, look for a set-based reformulation — an `around.set` filter, or a union of bounding boxes — that expresses it as one request.

**Stop before the ceiling.** Both `[timeout:n]` and `[maxsize:n]` are ceilings, not allocations; raising them does not make a query faster, it only lets a bad query run longer before failing. If a query needs an unusual ceiling, that is information about the query, and the right response is usually to narrow it — or, past a certain volume, to stop querying and read a file. [Handling Overpass Timeouts and Rate Limits](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/handling-overpass-timeouts-and-rate-limits/) builds the client side of that discipline, and [Running a Local Overpass Instance for Bulk Queries](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/running-a-local-overpass-instance-for-bulk-queries/) covers the point at which hosting your own is the honest answer.

## Failure Modes and Gotchas

- **The default set is a footgun.** Reading `_` after a statement you forgot writes to it is the cause of most mysterious empty results. Bind everything you will reuse.
- **`area` ids are derived, not raw.** An area is not a relation; its id is offset from the relation id. Resolve areas by tags, never by an id you computed yourself.
- **`around` on a large driving set is quadratic in feel.** It evaluates a buffer per driving element. Shrink the driving set first, and check its count.
- **Regex filters skip the value index.** `~` is not a convenience with a small cost; it changes which index can be used. Enumerate values when you can.
- **`out geom` duplicates shared nodes.** On a road network where a junction node belongs to five ways, its coordinate appears five times. That duplication is often most of the response size.
- **Timestamps need `out meta`.** If you need version or changeset information, ask for it explicitly; the default output has none, and discovering that after building a pipeline is expensive.
- **`nwr` is rarely what you want.** It is shorthand for all three element types and quietly triples the candidate set.

## Integration Points

The output of a query is JSON or XML that still has to become usable geometry and a typed table. [Converting Overpass JSON to a GeoDataFrame](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/converting-overpass-json-to-a-geodataframe/) covers that conversion, including the `center` and `geom` shapes and the relation cases that need care. Downstream, the tag values in a response are raw OSM values and need the same treatment as anything parsed from a file — the normalization stage in [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) applies unchanged, and running validation before trusting the result is as sensible here as for a local extract.

Upstream, the decision to use Overpass at all belongs to [Choosing Between Overpass and a Local Extract](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/), and for scheduled work the answer is often a local file.

## Guides in This Topic

- [Writing Overpass QL Area and Bounding Box Queries](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/writing-overpass-ql-area-and-bbox-queries/) — resolving areas reliably and choosing between area and bounding box spatial filters.
- [Handling Overpass Timeouts and Rate Limits](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/handling-overpass-timeouts-and-rate-limits/) — a client with backoff, caching and a size guard that survives a shared server's throttle.
- [Converting Overpass JSON to a GeoDataFrame](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/converting-overpass-json-to-a-geodataframe/) — turning each output mode into typed rows with valid geometry.
- [Running a Local Overpass Instance for Bulk Queries](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/running-a-local-overpass-instance-for-bulk-queries/) — sizing, importing and keeping a private instance current.

## Frequently Asked Questions

<details>
<summary>Why does my Overpass query return nothing when the data clearly exists?</summary>

Almost always because a statement overwrote the default set before the filter you care about read it. Each statement writes into the unnamed set unless you bind it with an arrow, and the next statement reads that same set, so two consecutive queries replace rather than accumulate. Bind every set you intend to reuse to a name, read it explicitly, and use out count on the intermediate sets to find the exact statement where the element count fell to zero.
</details>

<details>
<summary>Should I raise the timeout when a query times out?</summary>

Only after narrowing it. The timeout setting is a ceiling, not an allocation, so raising it lets a badly shaped query run longer before failing rather than making it finish. Apply the spatial filter first so the expensive tag filters examine a city rather than a continent, replace regular expressions with unions of exact values, and run out count to see how large the answer really is. If the query still needs an unusual ceiling after that, it is a signal to read a local extract instead.
</details>

<details>
<summary>What is the difference between out center and out geom?</summary>

out center returns one representative coordinate for each way and relation, which is all a marker layer or a point-of-interest table needs and is by far the smallest payload. out geom inlines the full coordinate list onto every element, which lets you render real shapes without any client-side assembly but repeats every shared node once per way that references it. On a dense street network that duplication is usually most of the response size.
</details>

<details>
<summary>How do I select everything inside a named city?</summary>

Resolve the boundary to an area object by its tags rather than by an id — match on the name and the administrative level, bind the result to a named set, and reference that set from each element query with an area filter. Assert that the bound area set is not empty before using it, because an unmatched name produces an empty area and therefore an empty final result with no error to explain it.
</details>

<details>
<summary>Is a regular expression filter ever the right choice?</summary>

Sometimes, but rarely as a first choice. A regular expression on a value cannot use the value index, so the server tests candidates one at a time; a regular expression on a key is worse still. When the set of values is enumerable, a union of exact key-value queries is longer to write and usually faster to run. Keep regular expressions for genuinely open-ended questions, such as whether an element carries any key in a namespace, and always apply a spatial filter first.
</details>

## Related

- [Querying OSM: Overpass, Nominatim & APIs](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/) — the parent section with the quota model these queries live inside.
- [Choosing Between Overpass and a Local Extract](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/) — when to stop querying and read a file instead.
- [Node, Way & Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — the element model every Overpass response is expressed in.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — the key-value practice your filters assert.
- [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/) — the normalization every fetched tag still needs.
- [Spatial Indexing for OSM Extracts](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/spatial-indexing-for-osm-extracts/) — the local equivalent of the spatial narrowing Overpass does server-side.

Up one level: [Querying OSM: Overpass, Nominatim & APIs](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Overpass API Query Language",
  "description": "Overpass QL as a set algebra: filters, spatial narrowing, recursion, output modes, and the cost model that decides whether a query returns in a second or times out.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Querying OSM: Overpass, Nominatim & APIs",
  "about": ["Overpass QL", "OSM spatial query", "API cost control"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Querying OSM: Overpass, Nominatim & APIs", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/" },
    { "@type": "ListItem", "position": 3, "name": "Overpass API Query Language", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Write an Overpass query that finishes",
  "description": "Structure an Overpass QL query as an explicit set algebra with the spatial filter first, enumerated values instead of regular expressions, and an output mode matched to what the consumer needs.",
  "step": [
    { "@type": "HowToStep", "name": "Declare the settings", "text": "Open with an output format, a realistic timeout and a memory ceiling, treating both limits as guards rather than as budget to spend." },
    { "@type": "HowToStep", "name": "Bind the geography once", "text": "Resolve an area by name and administrative level, or fix a bounding box, and bind it to a named set so every element query reuses the same resolution." },
    { "@type": "HowToStep", "name": "Narrow spatially, then by tag", "text": "Apply the spatial filter before tag filters so expensive predicates examine a city rather than a continent." },
    { "@type": "HowToStep", "name": "Enumerate instead of matching", "text": "Replace a regular expression over values with a union of exact key-value queries so the value index can be used." },
    { "@type": "HowToStep", "name": "Size the answer first", "text": "Run the query once with out count to learn how many elements it returns before requesting any geometry." },
    { "@type": "HowToStep", "name": "Choose the output mode", "text": "Return out center for representative points, out geom for modest shape results, or a recursion plus out body when shared nodes make inlined geometry wasteful." }
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
      "name": "Why does my Overpass query return nothing when the data clearly exists?",
      "acceptedAnswer": { "@type": "Answer", "text": "Almost always because a statement overwrote the default set before the filter you care about read it. Each statement writes into the unnamed set unless you bind it with an arrow, and the next statement reads that same set, so two consecutive queries replace rather than accumulate. Bind every set you intend to reuse to a name, read it explicitly, and use out count on the intermediate sets to find the exact statement where the element count fell to zero." }
    },
    {
      "@type": "Question",
      "name": "Should I raise the timeout when a query times out?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only after narrowing it. The timeout setting is a ceiling, not an allocation, so raising it lets a badly shaped query run longer before failing rather than making it finish. Apply the spatial filter first so the expensive tag filters examine a city rather than a continent, replace regular expressions with unions of exact values, and run out count to see how large the answer really is." }
    },
    {
      "@type": "Question",
      "name": "What is the difference between out center and out geom?",
      "acceptedAnswer": { "@type": "Answer", "text": "out center returns one representative coordinate for each way and relation, which is all a marker layer or a point-of-interest table needs and is by far the smallest payload. out geom inlines the full coordinate list onto every element, which lets you render real shapes without any client-side assembly but repeats every shared node once per way that references it." }
    },
    {
      "@type": "Question",
      "name": "How do I select everything inside a named city?",
      "acceptedAnswer": { "@type": "Answer", "text": "Resolve the boundary to an area object by its tags rather than by an id — match on the name and the administrative level, bind the result to a named set, and reference that set from each element query with an area filter. Assert that the bound area set is not empty before using it, because an unmatched name produces an empty area and therefore an empty final result with no error to explain it." }
    },
    {
      "@type": "Question",
      "name": "Is a regular expression filter ever the right choice?",
      "acceptedAnswer": { "@type": "Answer", "text": "Sometimes, but rarely as a first choice. A regular expression on a value cannot use the value index, so the server tests candidates one at a time; a regular expression on a key is worse still. When the set of values is enumerable, a union of exact key-value queries is longer to write and usually faster to run." }
    }
  ]
}
</script>
