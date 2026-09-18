---
title: "Nominatim Geocoding Pipelines"
description: "Geocoding with Nominatim as a ranking problem: structured queries, importance scores, reverse lookup zoom levels, address detail, and the volume at which self-hosting becomes the only honest answer."
pageTitle: "Nominatim Geocoding Pipelines for OSM Data Engineering"
pageDescription: "Build a Nominatim geocoding stage that constrains queries, reads importance and place rank correctly, handles reverse lookup zoom, and knows when to stop using the public instance."
slug: nominatim-geocoding-pipelines
type: guide
breadcrumb: "Nominatim Geocoding"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Nominatim Geocoding Pipelines

A geocoder that returns an answer for every input is not the same as a geocoder that returns the right answer, and Nominatim is honest about the difference in a way that trips up pipelines built on the assumption that geocoding is a lookup. It is a search engine over OpenStreetMap places, it ranks candidates, and every ranking decision it makes is one your pipeline has to either constrain in advance or evaluate afterwards.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 290" role="img" aria-labelledby="ngp1-t ngp1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ngp1-t">How one address string becomes a ranked list of candidate places</title>
  <desc id="ngp1-d">An input address string enters a normalisation step that tokenises it and expands abbreviations. The tokens are matched against the place index, producing many candidate places. Each candidate is scored on how completely the address matched, on the place rank of the feature type, and on an importance value derived from the underlying data. The candidates are then ordered and returned, with the caller responsible for deciding whether the top one is good enough.</desc>
  <defs><marker id="ngp1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="290" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Geocoding is search, and search returns a ranking</text>
  <rect x="26" y="122" width="240" height="56" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="146" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">address string</text>
  <text x="146" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">free text or structured</text>
  <rect x="320" y="50" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="74" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">normalise</text>
  <text x="440" y="92" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">tokenise, expand</text>
  <rect x="320" y="122" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">match index</text>
  <text x="440" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">many candidates</text>
  <rect x="320" y="194" width="240" height="56" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="218" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">score</text>
  <text x="440" y="236" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">rank and importance</text>
  <rect x="614" y="122" width="240" height="56" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="734" y="146" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">ranked list</text>
  <text x="734" y="164" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.85">you pick, not it</text>
  <line x1="266" y1="150" x2="293" y2="150" stroke="currentColor" stroke-width="1.4"/>
  <line x1="293" y1="78" x2="293" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="293" y1="78" x2="317" y2="78" stroke="currentColor" stroke-width="1.4" marker-end="url(#ngp1-a)"/>
  <line x1="293" y1="150" x2="317" y2="150" stroke="currentColor" stroke-width="1.4" marker-end="url(#ngp1-a)"/>
  <line x1="293" y1="222" x2="317" y2="222" stroke="currentColor" stroke-width="1.4" marker-end="url(#ngp1-a)"/>
  <line x1="560" y1="78" x2="587" y2="78" stroke="currentColor" stroke-width="1.4"/>
  <line x1="560" y1="150" x2="587" y2="150" stroke="currentColor" stroke-width="1.4"/>
  <line x1="560" y1="222" x2="587" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="587" y1="78" x2="587" y2="222" stroke="currentColor" stroke-width="1.4"/>
  <line x1="587" y1="150" x2="611" y2="150" stroke="currentColor" stroke-width="1.4" marker-end="url(#ngp1-a)"/>
  <text x="868" y="274" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Nothing in this chain decides that a result is correct — it decides that one candidate outranked the others, which is a different claim.</text>
</svg>
<figcaption>Treating the first result as the answer is what turns an ambiguous input into a confidently wrong coordinate.</figcaption>
</figure>

## The Problem This Topic Solves

You have a column of addresses, place names or coordinates and you need geometry attached to each one. Nominatim answers both directions — forward, from text to a place, and reverse, from a coordinate to the place containing it — over the same OpenStreetMap data your other pipeline stages already use, which makes it uniquely consistent with the rest of your stack.

The failure scenario is worth stating plainly because it is so common. A pipeline geocodes fifty thousand addresses as free text against the public instance, at whatever rate the client manages, with no country constraint. Three things then happen: the source is blocked within the hour for exceeding the usage policy; the results that did arrive include a number of confident matches in the wrong country, because several place names are not unique globally; and none of it is reproducible, because a rerun a month later returns slightly different coordinates as the underlying map improves. Every one of those three is preventable, and all three prevention measures are cheap.

## Prerequisites

Read the parent [Querying OSM: Overpass, Nominatim & APIs](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/) overview for the quota context. Understand OSM address tagging as covered in [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/), because Nominatim's structured fields map onto the `addr:*` namespace and its gaps are the same gaps. And be clear about identity — a geocode returns an OSM object reference, and what that reference guarantees over time is the subject of [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/).

## The Ranking Model

Three numbers travel with every Nominatim result, and reading them correctly is most of the skill.

**Place rank** describes how specific the matched feature is, on a scale that runs from a continent at the coarse end to an individual building or address point at the fine end. A result with a place rank corresponding to a city, returned for a query that supplied a house number, tells you the house number was not matched — the geocoder fell back to the containing settlement rather than failing.

**Importance** is a normalised score used to order otherwise comparable candidates. It derives from the underlying data's prominence. It is a tie-breaker between places of similar specificity, not a confidence score, and treating it as a probability that the answer is right is a category error.

**The address detail object** — returned when you ask for it — decomposes the match into house number, road, suburb, city, state, postcode and country. This is the single most useful part of the response for a pipeline, because it lets you assert that the component you cared about actually matched rather than inferring it from a display string.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="ngp2-t ngp2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ngp2-t">Reading a Nominatim result: what each field tells you and what it does not</title>
  <desc id="ngp2-d">A grid of four response fields against what each one means and the mistake commonly made with it. Place rank indicates how specific the matched feature is and is often mistaken for a quality score. Importance orders comparable candidates and is often mistaken for a confidence probability. The address detail object decomposes the match into components and is often ignored in favour of the display name. The OSM identifier names the matched object and is often assumed to be stable across re-runs.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four fields, four common misreadings</text>
  <rect x="186" y="48" width="223" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="297" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">What it means</text>
  <rect x="409" y="48" width="223" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="520" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Common misreading</text>
  <rect x="631" y="48" width="223" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="743" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Use it for</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">place_rank</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="297" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">match specificity</text>
  <text x="520" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a quality score</text>
  <text x="743" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">detecting fallback</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">importance</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="297" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">ordering tie-break</text>
  <text x="520" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a confidence value</text>
  <text x="743" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">nothing on its own</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">address object</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="297" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">matched components</text>
  <text x="520" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">ignored for display_name</text>
  <text x="743" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">asserting the match</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">osm_type and id</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="297" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">the matched object</text>
  <text x="520" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a stable key</text>
  <text x="743" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">re-resolution later</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The third row is the one that matters: asserting on components is the only way to know which part of the query actually matched.</text>
</svg>
<figcaption>Every one of these misreadings produces a pipeline that looks like it is validating results while checking nothing.</figcaption>
</figure>

## Structured Queries Beat Free Text

Nominatim accepts a free-text query and does a creditable job of parsing it, but a pipeline almost always knows more about its own data than the parser can infer. Supplying `street`, `city`, `state`, `postalcode` and `country` as separate fields removes the guesswork about which token is which, and it makes the failure mode much better: a structured query that cannot match a house number falls back to the street, and you can see that in the returned place rank.

Constraining is equally important. A `countrycodes` parameter eliminates the entire class of wrong-country matches in one step. A `viewbox` with bounded mode restricts results to a rectangle. Both cost nothing and both convert a silent correctness problem into an empty result you can handle.

The remaining lever is deduplication before the call. Real address lists repeat heavily, and normalising case, whitespace and punctuation before lookup routinely removes a third of the requests without changing a single result. That is covered in practice in [Batch Geocoding with Nominatim Without Getting Blocked](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/batch-geocoding-with-nominatim-without-getting-blocked/), alongside the rate discipline the public instance requires.

## Reverse Geocoding and the Zoom Parameter

Reverse geocoding takes a coordinate and returns the place containing it, and its behaviour is governed by a `zoom` parameter that most integrations leave at the default and then find confusing. Zoom selects the *level of the hierarchy* you want back: a low value returns a country or state, a middle value returns a city or suburb, and a high value returns a building or address point.

The practical rule is to set zoom from the question, not from the data. "Which country is this point in" and "what is the nearest address to this point" are different questions that happen to share an endpoint, and asking one while expecting the other's answer is the usual cause of a reverse geocoder that seems to return the wrong level of detail at random.

## Validation and Error Handling

| Condition | Root cause | Detection | Remediation |
| --- | --- | --- | --- |
| Result in the wrong country | Unconstrained free-text query | `address.country_code` differs from expectation | Pass `countrycodes`, or a bounded `viewbox` |
| House number missing from the answer | No matching address point exists | `place_rank` coarser than an address | Accept the street-level fallback explicitly, or reject |
| Empty result for a valid address | Over-constrained structured query | Zero candidates with all fields supplied | Relax one field at a time, most specific first |
| Different coordinates on a rerun | The underlying map improved | Coordinate drift beyond a few metres | Store the result plus its date; re-resolve on a schedule |
| HTTP 403 or persistent 429 | Missing `User-Agent` or over one request per second | Blocked responses from every request | Identify the client, throttle, or self-host |
| Same place returned for many inputs | Inputs normalised too aggressively | Many distinct addresses share one result | Loosen normalisation; keep house numbers distinct |
| Plausible but wrong suburb | Ambiguous name matched a different feature | `osm_type` is a node where a boundary was expected | Assert on the returned address components |

## Performance, Scale and the Self-Hosting Threshold

The public Nominatim instance permits roughly one request per second from a single source. That is a hard ceiling on throughput, and it means a hundred thousand addresses is somewhere over a day of continuous, polite requesting — which is both slow for you and a poor use of a shared resource.

Three things extend the useful range. **Deduplicate** before calling, as described above. **Cache** every result keyed on the normalised query, so reruns are free and your test suite is deterministic. **Batch the work into stages** so that a failed run resumes from where it stopped rather than starting over.

Past roughly the ten-thousand-lookup mark, the right answer stops being a better client. Importing your own instance from a regional extract removes the rate limit entirely, makes results reproducible until you choose to re-import, and lets you tune the address indexing to your region. It is a real operational commitment — the import is long and the database is large — and [Importing Nominatim from an OSM Extract](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/importing-nominatim-from-an-osm-extract/) sizes it honestly.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 292" role="img" aria-labelledby="ngp3-t ngp3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="ngp3-t">How a geocoding workload's right answer changes with volume</title>
  <desc id="ngp3-d">A progression across four volume bands. Up to a few hundred lookups the public instance with a polite client is entirely appropriate. Into the low thousands, deduplication and caching are what keep it viable. Approaching ten thousand, the one request per second ceiling makes the run take hours and a private instance starts to pay for itself. Beyond that, a self-hosted import is the only approach that is both fast and reproducible.</desc>
  <defs><marker id="ngp3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="292" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The right answer changes twice as volume grows</text>
  <line x1="26" y1="150" x2="848" y2="150" stroke="currentColor" stroke-width="1.8" marker-end="url(#ngp3-a)"/>
  <rect x="35" y="52" width="189" height="66" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="130" y="76" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">hundreds</text>
  <text x="130" y="94" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">public instance</text>
  <text x="130" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">a polite client is enough</text>
  <line x1="130" y1="118" x2="130" y2="143" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="130" cy="150" r="5" fill="var(--osm-accent,#0369a1)"/>
  <rect x="242" y="176" width="189" height="66" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="336" y="200" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">thousands</text>
  <text x="336" y="218" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">dedupe and cache</text>
  <text x="336" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">still public, still fine</text>
  <line x1="336" y1="176" x2="336" y2="157" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="336" cy="150" r="5" fill="var(--osm-ok,#15803d)"/>
  <rect x="449" y="52" width="189" height="66" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="544" y="76" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">ten thousand</text>
  <text x="544" y="94" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">hours per run</text>
  <text x="544" y="110" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">self-hosting starts to pay</text>
  <line x1="544" y1="118" x2="544" y2="143" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="544" cy="150" r="5" fill="var(--osm-warn,#a16207)"/>
  <rect x="656" y="176" width="189" height="66" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="750" y="200" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">beyond</text>
  <text x="750" y="218" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">private import</text>
  <text x="750" y="234" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">fast and reproducible</text>
  <line x1="750" y1="176" x2="750" y2="157" stroke="currentColor" stroke-width="1.3" opacity="0.65"/>
  <circle cx="750" cy="150" r="5" fill="var(--osm-alt,#6d28d9)"/>
  <text x="868" y="276" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The threshold is not about politeness alone: past a few hours per run, reproducibility and restartability matter more than the rate limit.</text>
</svg>
<figcaption>Most teams cross the second threshold long before they notice, because a slow nightly job does not feel like a problem until it fails halfway.</figcaption>
</figure>

## Failure Modes and Gotchas

- **The first result is not the answer.** It is the highest-ranked candidate. Assert on the returned address components before accepting it.
- **Place rank reveals fallback.** A city-level rank for a query with a house number means the house number did not match. That is information, and discarding it means storing a city centroid as if it were a building.
- **Importance is not confidence.** Two results with importance 0.4 and 0.3 are not "57% likely" and "43% likely"; they are simply ordered.
- **Accents and abbreviations matter.** Normalisation helps, but stripping accents can merge genuinely distinct places. Normalise conservatively and keep the original string.
- **Coordinates move.** A building's centroid changes when a mapper traces it more accurately. Store the date alongside every geocode.
- **Reverse geocoding without zoom is ambiguous.** Set it from the question you are asking, not from the default.
- **Postcodes are not universally mapped.** In some countries the postcode in a Nominatim result is inferred from a containing area rather than from the feature itself.

## Integration Points

Geocoded output feeds two very different consumers. When the result is a coordinate to be stored, it belongs in the same normalized feature table as everything else, and the composite `osm_type`/`osm_id` key is what links it back to the map — the same key discussed in [Converting Overpass JSON to a GeoDataFrame](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/converting-overpass-json-to-a-geodataframe/). When the result is a *match* between your record and an OSM feature, it is the first step of a conflation workflow, and it should be scored and audited the way [OSM Conflation & Data Enrichment](https://www.osm-data-processing.org/osm-conflation-and-enrichment/) describes rather than accepted wholesale.

Upstream, address strings should be cleaned before they reach the geocoder, using the same value-standardisation discipline as any other OSM-adjacent field; [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) covers the techniques.

## Guides in This Topic

- [Batch Geocoding with Nominatim Without Getting Blocked](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/batch-geocoding-with-nominatim-without-getting-blocked/) — deduplication, caching, throttling and resumability for a large address list.
- [Importing Nominatim from an OSM Extract](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/importing-nominatim-from-an-osm-extract/) — sizing and running a private import, and keeping it current.
- [Parsing Nominatim Address Details into Columns](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/parsing-nominatim-address-details-into-columns/) — turning the address object into a typed, assertable table.

## Frequently Asked Questions

<details>
<summary>Why does Nominatim return a city when I asked for a street address?</summary>

Because no matching address point or road existed, so the geocoder fell back to the most specific containing feature it could match. The returned place rank tells you exactly what level it settled on, which is why it should be read on every result. Storing a city-level fallback as though it were a building coordinate is one of the most damaging silent errors in a geocoding pipeline, and a single assertion on place rank prevents it.
</details>

<details>
<summary>Is the importance score a confidence value?</summary>

No. It orders candidates that are otherwise comparable and derives from how prominent a place is in the underlying data, not from how well it matched your query. A high importance on a wrong match is entirely possible and entirely normal — a famous city will outrank an obscure village of the same name regardless of which one you meant. Confidence has to come from asserting that the address components you supplied appear in the result.
</details>

<details>
<summary>How do I stop getting results from the wrong country?</summary>

Constrain the query. Passing a country code restriction eliminates the whole class of problem in one parameter, and a bounded view box does the same for a smaller area. Free-text queries without any constraint are asking the geocoder to guess which of several real places sharing a name you meant, and it will guess based on prominence, which has no connection to your intent.
</details>

<details>
<summary>At what volume should I run my own instance?</summary>

Somewhere around ten thousand distinct lookups, though the honest trigger is time rather than count. The public instance's roughly one request per second ceiling means ten thousand lookups is several hours of continuous requesting, at which point a failure halfway through is expensive and reproducibility is impossible. A private import removes the rate limit, makes results stable between re-imports, and turns a slow nightly job into a fast one.
</details>

<details>
<summary>Why do my geocodes drift between runs?</summary>

Because the underlying map changed. A building traced more accurately moves its centroid; a point replaced by a polygon changes both the coordinate and the object identifier. That drift is the map improving, not the geocoder being unreliable, but a pipeline that assumes stability will see it as churn. Store the coordinate, the object reference and the resolution date together, and re-resolve deliberately on a schedule you control.
</details>

## Related

- [Querying OSM: Overpass, Nominatim & APIs](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/) — the parent section and the shared quota model.
- [Matching OSM Features to External Datasets](https://www.osm-data-processing.org/osm-conflation-and-enrichment/matching-osm-features-to-external-datasets/) — what to do with a geocode once you treat it as a match rather than a coordinate.
- [Value Standardization & Regex Cleaning](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/value-standardization-regex-cleaning/) — cleaning address strings before they reach the geocoder.
- [Validating OSM Address Tags Against a Reference](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/validating-osm-address-tags-against-a-reference/) — the quality check that pairs naturally with geocoding.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — the address namespace the structured fields map onto.
- [OSM Feature Identity & ID Stability](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-feature-identity-and-id-stability/) — what a returned object reference does and does not guarantee.

Up one level: [Querying OSM: Overpass, Nominatim & APIs](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Nominatim Geocoding Pipelines",
  "description": "Geocoding with Nominatim as a ranking problem: structured queries, importance scores, reverse lookup zoom levels, address detail, and the volume at which self-hosting becomes the only honest answer.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Querying OSM: Overpass, Nominatim & APIs",
  "about": ["Nominatim geocoding", "reverse geocoding", "address matching"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Querying OSM: Overpass, Nominatim & APIs", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/" },
    { "@type": "ListItem", "position": 3, "name": "Nominatim Geocoding Pipelines", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/nominatim-geocoding-pipelines/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Build a Nominatim geocoding stage that can be trusted",
  "description": "Constrain queries, read place rank and address components rather than the display string, set reverse zoom from the question, and scale by deduplicating, caching and eventually self-hosting.",
  "step": [
    { "@type": "HowToStep", "name": "Clean and deduplicate the input", "text": "Normalise case, whitespace and punctuation conservatively and collapse duplicates before any request is made." },
    { "@type": "HowToStep", "name": "Query structurally and constrained", "text": "Supply street, city, postcode and country as separate fields and restrict by country code or a bounded view box." },
    { "@type": "HowToStep", "name": "Read the place rank", "text": "Compare the returned specificity against what you asked for, and treat a coarser rank as a fallback rather than a match." },
    { "@type": "HowToStep", "name": "Assert on address components", "text": "Confirm the components you supplied appear in the returned address object instead of trusting the display name." },
    { "@type": "HowToStep", "name": "Cache and date every result", "text": "Store the coordinate, the object reference and the resolution date so drift is visible and reruns are free." },
    { "@type": "HowToStep", "name": "Self-host past the threshold", "text": "Import a private instance once the workload needs more than a few hours of requesting, to remove the rate limit and gain reproducibility." }
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
      "name": "Why does Nominatim return a city when I asked for a street address?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because no matching address point or road existed, so the geocoder fell back to the most specific containing feature it could match. The returned place rank tells you exactly what level it settled on, which is why it should be read on every result. Storing a city-level fallback as though it were a building coordinate is one of the most damaging silent errors in a geocoding pipeline." }
    },
    {
      "@type": "Question",
      "name": "Is the importance score a confidence value?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. It orders candidates that are otherwise comparable and derives from how prominent a place is in the underlying data, not from how well it matched your query. A high importance on a wrong match is entirely possible and entirely normal. Confidence has to come from asserting that the address components you supplied appear in the result." }
    },
    {
      "@type": "Question",
      "name": "How do I stop getting results from the wrong country?",
      "acceptedAnswer": { "@type": "Answer", "text": "Constrain the query. Passing a country code restriction eliminates the whole class of problem in one parameter, and a bounded view box does the same for a smaller area. Free-text queries without any constraint are asking the geocoder to guess which of several real places sharing a name you meant, and it will guess based on prominence." }
    },
    {
      "@type": "Question",
      "name": "At what volume should I run my own Nominatim instance?",
      "acceptedAnswer": { "@type": "Answer", "text": "Somewhere around ten thousand distinct lookups, though the honest trigger is time rather than count. The public instance's roughly one request per second ceiling means ten thousand lookups is several hours of continuous requesting, at which point a failure halfway through is expensive and reproducibility is impossible. A private import removes the rate limit and makes results stable between re-imports." }
    },
    {
      "@type": "Question",
      "name": "Why do my geocodes drift between runs?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because the underlying map changed. A building traced more accurately moves its centroid; a point replaced by a polygon changes both the coordinate and the object identifier. That drift is the map improving, not the geocoder being unreliable. Store the coordinate, the object reference and the resolution date together, and re-resolve deliberately on a schedule you control." }
    }
  ]
}
</script>
