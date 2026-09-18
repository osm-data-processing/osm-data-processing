---
title: "Choosing Between Overpass and a Local Extract"
description: "A cost model for deciding whether an OSM question belongs on a live query engine or a file on disk — frequency, breadth, freshness, reproducibility — and how to migrate in either direction."
pageTitle: "Overpass or a Local Extract? A Decision Model"
pageDescription: "Decide whether an OSM question belongs in Overpass or in a local extract using frequency, breadth, freshness and reproducibility, and migrate mechanically once the answer changes."
slug: choosing-between-overpass-and-a-local-extract
type: guide
breadcrumb: "Overpass or Extract"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Choosing Between Overpass and a Local Extract

Almost every OSM pipeline eventually has the same argument, usually after something has already broken: should this question be answered by a live query or by a file on disk? The argument is winnable, because the decision is governed by four measurable properties rather than by taste.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="cbo1-t cbo1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cbo1-t">The four properties that decide where an OSM question should be answered</title>
  <desc id="cbo1-d">A grid of four properties against what each one implies. Frequency favours a local extract as soon as a question repeats on a schedule. Breadth favours a local extract once the answer covers a whole region rather than a bounded neighbourhood. Freshness favours a live query only when minutes matter, since extracts are daily. Reproducibility favours a local extract absolutely, because a file can be archived and a live query cannot be replayed.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four properties, and three of them point the same way</text>
  <rect x="196" y="48" width="219" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="306" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Favours Overpass</text>
  <rect x="415" y="48" width="219" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="525" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Favours a file</text>
  <rect x="635" y="48" width="219" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="744" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Which dominates</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Frequency</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">one-off</text>
  <text x="525" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">scheduled</text>
  <text x="744" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">frequency</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Breadth</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a neighbourhood</text>
  <text x="525" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">a region</text>
  <text x="744" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">breadth</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Freshness</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">minutes matter</text>
  <text x="525" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">daily is fine</text>
  <text x="744" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">freshness</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Reproducibility</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="306" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">never</text>
  <text x="525" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">always</text>
  <text x="744" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">reproducibility</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only freshness ever argues for a live query in a scheduled job, and the replication stream answers that argument without one.</text>
</svg>
<figcaption>Two of these can be traded off; reproducibility cannot, which is why an auditable pipeline ends up on files regardless.</figcaption>
</figure>

## The Problem This Topic Solves

You have a question about OSM data. Overpass will answer it, and so will a filtered extract, and both look reasonable in a prototype. The decision matters because the two paths diverge sharply as the work grows: one of them degrades into rate limits and non-reproducible results, and the other degrades into storage and a parsing stack.

The concrete failure scenario is familiar by now. A prototype queries Overpass, works beautifully, and gets scheduled. Six weeks later the query is slower, then intermittently failing, then blocked; a colleague cannot reproduce last month's numbers because the query returns different data now; and the fix — moving to a local extract — is a rewrite rather than a configuration change, because the code was shaped around a query engine's response format. Deciding correctly at the start costs nothing; deciding late costs a rewrite.

## Prerequisites

Know what Overpass actually does, from [Overpass API Query Language](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/). Know what a local extract costs to obtain and keep current, from [OSM Extract Providers & Automated Downloads](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/). And know the filtering tools available on the file side, from [Choosing an OSM Parser: pyosmium, pyrosm or osmium-tool](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/).

## The Four Properties in Detail

**Frequency.** A question asked once is cheap anywhere. A question asked on a schedule accumulates: cost to the shared server, exposure to its availability, and — the part people forget — exposure to its *changes*. A file is fetched once and reused; a query is re-run and can return something different every time.

**Breadth.** Overpass is at its best with a tight spatial bound. As the bound widens the candidate set the server must consider grows, and past a region-sized area the query is doing work a local `osmium tags-filter` pass does in seconds. There is no sharp threshold, but the practical rule is that if the answer covers more than a city, a file is probably cheaper for everybody.

**Freshness.** This is the only property that genuinely argues for a live query. Overpass tracks the map within minutes; a published extract is daily. If your consumers need an edit made twenty minutes ago, a daily file cannot serve them. But note the alternative: a local extract kept current with replication diffs is also minutes-fresh, which removes this argument in exchange for running an update pipeline.

**Reproducibility.** A file is an artefact you can archive, checksum and cite. A query is a request whose answer depends on when you asked. For anything whose output will be defended later — a published figure, a regulatory report, a model's training data — this property alone decides the question.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 306" role="img" aria-labelledby="cbo2-t cbo2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cbo2-t">A decision procedure for placing one OSM question</title>
  <desc id="cbo2-d">A decision node asking whether the question will run more than once, with three outcomes. A genuinely one-off question bounded to a small area belongs in Overpass, where it costs a single request and no setup. A recurring question, or one covering a region, belongs in a local extract filtered with osmium, which is reproducible and costs a shared server nothing. A recurring question that also needs minute-level freshness belongs in a local extract kept current by replication diffs, which gives both properties at the cost of an update pipeline.</desc>
  <defs><marker id="cbo2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="306" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Ask once: will this run more than once?</text>
  <rect x="26" y="117" width="250" height="88" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.6"/>
  <text x="151" y="145" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Once, or on a schedule?</text>
  <text x="151" y="167" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Frequency first, then freshness</text>
  <text x="151" y="185" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">Breadth usually follows frequency</text>
  <line x1="276" y1="161" x2="314" y2="161" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="314" y2="239" stroke="currentColor" stroke-width="1.5"/>
  <line x1="314" y1="83" x2="353" y2="83" stroke="currentColor" stroke-width="1.4" marker-end="url(#cbo2-a)"/>
  <rect x="356" y="52" width="498" height="62" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="370" y="77" font-size="12" font-weight="700" fill="currentColor">Overpass</text>
  <text x="370" y="97" font-size="10.5" fill="currentColor" opacity="0.88">Genuinely one-off, small area, no archive needed</text>
  <line x1="314" y1="161" x2="353" y2="161" stroke="currentColor" stroke-width="1.4" marker-end="url(#cbo2-a)"/>
  <rect x="356" y="130" width="498" height="62" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="370" y="155" font-size="12" font-weight="700" fill="currentColor">Local extract</text>
  <text x="370" y="175" font-size="10.5" fill="currentColor" opacity="0.88">Recurring or region-wide; daily freshness is enough</text>
  <line x1="314" y1="239" x2="353" y2="239" stroke="currentColor" stroke-width="1.4" marker-end="url(#cbo2-a)"/>
  <rect x="356" y="208" width="498" height="62" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="370" y="233" font-size="12" font-weight="700" fill="currentColor">Extract plus diffs</text>
  <text x="370" y="253" font-size="10.5" fill="currentColor" opacity="0.88">Recurring and minute-fresh; run the update pipeline</text>
  <text x="868" y="290" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The third branch is the one teams reach for last and should reach for second, because it removes the only real argument for querying.</text>
</svg>
<figcaption>Notice that two of the three branches end at a file — the live query survives only the genuinely one-off case.</figcaption>
</figure>

## Translating a Query into a Filter

The migration from a query to a file is more mechanical than it looks, because most production Overpass queries are one spatial bound plus one tag filter plus an output mode, and all three have direct equivalents on the file side.

A spatial bound becomes either the choice of extract (for a region-sized bound) or an `osmium extract` with a boundary polygon. A tag filter becomes `osmium tags-filter`, whose expression language covers the same key-existence, exact-value and value-set cases that dominate real queries. An output mode becomes a choice of output format and whether to resolve geometry. The one genuinely awkward case is a recursion that follows relation membership upward, which has no single-command equivalent and needs a small script.

[Replacing an Overpass Query with an osmium Filter](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/replacing-an-overpass-query-with-an-osmium-filter/) walks a real query through that translation, clause by clause.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="cbo3-t cbo3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="cbo3-t">How an Overpass query translates clause by clause into a file pipeline</title>
  <desc id="cbo3-d">Four translations shown in order. A spatial bound becomes either the choice of published extract or an osmium extract against a boundary polygon. A tag filter becomes an osmium tags-filter expression covering the same key existence, exact value and value set cases. A recursion becomes either an osmium reference-completing pass or, for upward relation traversal, a short script. An output mode becomes a choice of output format and whether geometry is resolved during parsing.</desc>
  <defs><marker id="cbo3-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four clauses, four direct equivalents</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">spatial bound</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">pick the extract</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">or osmium extract</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cbo3-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">tag filter</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">osmium tags-filter</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">same match forms</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cbo3-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">recursion</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">reference completion</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">upward needs a script</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#cbo3-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">output mode</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">format plus geometry</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">decided at parse time</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the third clause lacks a single-command equivalent, and only in the upward direction, which most production queries never use.</text>
</svg>
<figcaption>The translation is this mechanical because production queries are far simpler than the language permits.</figcaption>
</figure>

## Estimating Before Committing

Both sides can be sized before you build anything, and doing so converts the argument into arithmetic.

On the query side, `out count` returns the element count for a query in one cheap request. Multiply by a rough bytes-per-element figure for your chosen output mode and you have the response size; compare against the query's declared timeout and the server's ceilings and you know whether it will finish. [Estimating the Cost of an Overpass Query](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/estimating-the-cost-of-an-overpass-query/) develops this into a repeatable procedure.

On the file side, the numbers are the extract's download size, the storage for it and its derived outputs, and the wall-clock time of a filtering pass. All three are measurable on a small region and scale predictably.

## Validation and Error Handling

| Condition | Root cause | Detection | Remediation |
| --- | --- | --- | --- |
| Scheduled query starts failing | Volume grew past the shared quota | Intermittent rate limits, then blocks | Migrate the question to a local extract |
| Last month's numbers cannot be reproduced | Live query re-run against a changed map | Counts differ with no code change | Archive the extract and its digest, not the query |
| Query times out only at month end | Data volume grows over time | Failures correlate with the calendar | Size with `out count` and re-check periodically |
| File-based pipeline is always a day behind | Daily extract without replication | Consumers see stale edits | Attach the diff stream to the local copy |
| Migration turns into a rewrite | Code shaped around the query response | Response parsing spread through the codebase | Isolate the source behind one function from day one |
| Local pipeline slower than the query | Filtering the wrong way round | Full parse before tag filtering | Filter with osmium before anything reads the file |

## Performance and Scale

The crossover is not a single number, but its shape is consistent. Below a few queries a day over a bounded area, the live query wins on effort and costs nobody anything measurable. Above a scheduled daily run over a region, the file wins decisively — usually by more than an order of magnitude in wall-clock time, and by removing an external dependency from the critical path.

The middle ground is where judgement is needed, and the tie-breaker is almost always reproducibility. If somebody will ever ask "why did this number change", the file is the right answer even when the query is technically adequate, because a file can be archived and re-run and a query cannot.

One structural recommendation makes the whole decision reversible: **isolate the data source behind a single function** that returns normalized features, and let the rest of the pipeline consume that. When the crossover arrives, you replace one implementation rather than unpicking response-shaped assumptions from across a codebase.

## Failure Modes and Gotchas

- **Prototypes lie about scale.** A query tested on a neighbourhood tells you nothing about the same query on a country; the cost is in the candidate set, not the result.
- **Rate limits arrive as success, then failure.** Throttling degrades gradually, so a job can be "working" for weeks while quietly slowing.
- **A live query is not archivable.** Storing the query text is not storing the data; the same text returns different data later.
- **Daily is not the only file cadence.** Replication diffs make a local copy minute-fresh, which removes the one property that favours querying.
- **Filtering order matters on the file side too.** Running `osmium tags-filter` before parsing is the difference between seconds and minutes.
- **Two sources means two answers.** Running some questions against Overpass and others against a file of a different date produces inconsistencies nobody can explain later.

## Integration Points

Whichever side you land on, the output should be the same shape: normalized features entering the workflows in [Parsing & Tag Normalization Workflows](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/). On the query side that conversion is [Converting Overpass JSON to a GeoDataFrame](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/converting-overpass-json-to-a-geodataframe/); on the file side it is whichever parser [Choosing an OSM Parser: pyosmium, pyrosm or osmium-tool](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/) recommends for your access pattern. Keeping those two converters behind one interface is what makes the migration a swap rather than a project.

## Guides in This Topic

- [Estimating the Cost of an Overpass Query](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/estimating-the-cost-of-an-overpass-query/) — sizing a query with counting requests before it is ever run in full.
- [Replacing an Overpass Query with an osmium Filter](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/replacing-an-overpass-query-with-an-osmium-filter/) — the clause-by-clause translation from a query to a file pipeline.

## Frequently Asked Questions

<details>
<summary>Is there a hard threshold where I should switch to a file?</summary>

Not a single number, but there is a reliable trigger: the moment a question moves from being asked by a person to being asked by a scheduler. A one-off query costs a shared server nothing and needs no setup; a scheduled query accumulates cost, exposes your pipeline to an external dependency, and returns different data every run. If the question is on a timer and covers more than a neighbourhood, the file is almost always right.
</details>

<details>
<summary>What if I need data fresher than a daily extract?</summary>

Then attach the replication diff stream to your local copy rather than reaching for a live query. Replication gives a local file the same minute-level freshness Overpass has, while keeping the reproducibility and the independence from a shared server. It costs an update pipeline to operate, which is real work, but it removes the only property that genuinely favours querying on a schedule.
</details>

<details>
<summary>How do I keep the choice reversible?</summary>

Put exactly one function between your pipeline and the data source, returning normalized features rather than a service's response shape. Every consumer talks to that function. When the crossover arrives you replace its implementation and nothing else changes. Pipelines that become expensive to migrate are the ones where response parsing leaked into a dozen call sites, and preventing that costs one interface on day one.
</details>

<details>
<summary>Can I use both, for different questions?</summary>

You can, but be careful about consistency. Answering one question from a live query and another from a file cut yesterday produces results that disagree in ways nobody can reconstruct later, especially when the two are joined. If both sources are genuinely needed, record which source and which version answered each question, and avoid joining outputs derived from different vintages of the map.
</details>

<details>
<summary>Does a private Overpass instance change the calculus?</summary>

It removes the quota argument but not the reproducibility one. A private instance answers unlimited queries against data you control, which is genuinely useful when you need the query language's expressiveness at volume. It still returns whatever it holds at the moment you ask, so archiving a result still means archiving the data rather than the query, and you have added a database to operate. It is the right answer when the query language itself is what you need, and overkill when you only wanted the data.
</details>

## Related

- [Querying OSM: Overpass, Nominatim & APIs](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/) — the parent section and the wider service-layer context.
- [Overpass API Query Language](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/) — what the query side actually costs.
- [OSM Extract Providers & Automated Downloads](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/osm-extract-providers-and-downloads/) — what the file side actually costs.
- [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/) — how a local file becomes as fresh as a live query.
- [Choosing an OSM Parser: pyosmium, pyrosm or osmium-tool](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/choosing-an-osm-parser-pyosmium-pyrosm-osmium/) — what reads the file once you choose one.
- [Running a Local Overpass Instance for Bulk Queries](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/overpass-api-query-language/running-a-local-overpass-instance-for-bulk-queries/) — the third option when the query language itself is the requirement.

Up one level: [Querying OSM: Overpass, Nominatim & APIs](https://www.osm-data-processing.org/querying-osm-overpass-and-apis/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Choosing Between Overpass and a Local Extract",
  "description": "A cost model for deciding whether an OSM question belongs on a live query engine or a file on disk — frequency, breadth, freshness, reproducibility — and how to migrate in either direction.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "Querying OSM: Overpass, Nominatim & APIs",
  "about": ["Overpass versus extract", "pipeline reproducibility", "data source selection"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "Querying OSM: Overpass, Nominatim & APIs", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/" },
    { "@type": "ListItem", "position": 3, "name": "Choosing Between Overpass and a Local Extract", "item": "https://www.osm-data-processing.org/querying-osm-overpass-and-apis/choosing-between-overpass-and-a-local-extract/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Decide whether an OSM question belongs in Overpass or a local extract",
  "description": "Score the question on frequency, breadth, freshness and reproducibility, size both options before committing, and keep the choice reversible behind a single source interface.",
  "step": [
    { "@type": "HowToStep", "name": "Ask about frequency first", "text": "Establish whether the question is genuinely one-off or will run on a schedule, because a scheduled question accumulates cost and variability." },
    { "@type": "HowToStep", "name": "Measure the breadth", "text": "Determine whether the answer covers a neighbourhood or a whole region, since a region-sized answer is cheaper from a file." },
    { "@type": "HowToStep", "name": "Separate freshness from recency", "text": "Decide whether consumers need minute-level currency, and remember replication gives a local file the same property." },
    { "@type": "HowToStep", "name": "Check reproducibility needs", "text": "If any output will be defended later, choose the file, because a query cannot be archived or replayed." },
    { "@type": "HowToStep", "name": "Size both options", "text": "Use a counting query to size the Overpass side and a small-region trial run to size the file side." },
    { "@type": "HowToStep", "name": "Isolate the source", "text": "Place one function between the pipeline and the data source so the decision can be reversed without a rewrite." }
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
      "name": "Is there a hard threshold where I should switch from Overpass to a file?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not a single number, but there is a reliable trigger: the moment a question moves from being asked by a person to being asked by a scheduler. A one-off query costs a shared server nothing and needs no setup; a scheduled query accumulates cost, exposes your pipeline to an external dependency, and returns different data every run." }
    },
    {
      "@type": "Question",
      "name": "What if I need OSM data fresher than a daily extract?",
      "acceptedAnswer": { "@type": "Answer", "text": "Then attach the replication diff stream to your local copy rather than reaching for a live query. Replication gives a local file the same minute-level freshness Overpass has, while keeping the reproducibility and the independence from a shared server. It costs an update pipeline to operate, but removes the only property that genuinely favours querying on a schedule." }
    },
    {
      "@type": "Question",
      "name": "How do I keep the Overpass-or-extract choice reversible?",
      "acceptedAnswer": { "@type": "Answer", "text": "Put exactly one function between your pipeline and the data source, returning normalized features rather than a service's response shape. Every consumer talks to that function. When the crossover arrives you replace its implementation and nothing else changes. Pipelines that become expensive to migrate are the ones where response parsing leaked into a dozen call sites." }
    },
    {
      "@type": "Question",
      "name": "Can I use both Overpass and local extracts for different questions?",
      "acceptedAnswer": { "@type": "Answer", "text": "You can, but be careful about consistency. Answering one question from a live query and another from a file cut yesterday produces results that disagree in ways nobody can reconstruct later, especially when the two are joined. Record which source and which version answered each question, and avoid joining outputs derived from different vintages of the map." }
    },
    {
      "@type": "Question",
      "name": "Does a private Overpass instance change the calculus?",
      "acceptedAnswer": { "@type": "Answer", "text": "It removes the quota argument but not the reproducibility one. A private instance answers unlimited queries against data you control, which is useful when you need the query language's expressiveness at volume. It still returns whatever it holds at the moment you ask, and you have added a database to operate." }
    }
  ]
}
</script>
