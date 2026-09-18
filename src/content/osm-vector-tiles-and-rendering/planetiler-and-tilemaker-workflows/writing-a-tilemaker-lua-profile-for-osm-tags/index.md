---
title: "Writing a Tilemaker Lua Profile for OSM Tags"
description: "Express layer assignment, attributes and zoom ranges as a Tilemaker Lua profile, with a closed vocabulary, explicit relation handling and per-layer match counters that make it reviewable."
pageTitle: "A Tilemaker Lua Profile for OSM Tags, Step by Step"
pageDescription: "Write node, way and relation handlers in a Tilemaker Lua profile: map tags to a closed vocabulary, set zoom ranges per feature, handle multipolygons, and count matches per layer."
slug: writing-a-tilemaker-lua-profile-for-osm-tags
type: article
breadcrumb: "Tilemaker Lua Profile"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Writing a Tilemaker Lua Profile for OSM Tags

Write the one file that decides everything about what your tiles contain — and write it so that somebody who did not write it can tell what it does and prove it is working.

## Prerequisites

- [ ] `tilemaker` installed, plus a regional extract to test against.
- [ ] The tool's model from [Planetiler & Tilemaker Workflows](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/).
- [ ] A decided layer list with zoom ranges, from the schema discussion in [OSM Vector Tiles & Rendering Pipelines](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/).
- [ ] Familiarity with OSM tagging for the features you intend to render, from [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/).
- [ ] A small test extract — a single city — so a full run takes a minute rather than an hour.

## Conceptual minimum

A Tilemaker profile is two files working together. A **JSON configuration** declares the layers, each with a name and a zoom range, plus global settings. A **Lua script** implements callbacks that Tilemaker invokes per element: one for nodes, one for ways, and relation handling that decides which relations to accept and how their members contribute.

Inside a callback, three functions do the work. `Find(key)` reads a tag. `Layer(name, isArea)` assigns the current element to a layer. `Attribute(key, value)` writes an attribute onto the emitted feature. There is also `MinZoom(z)`, which sets the minimum zoom for *this feature*, overriding the layer-wide setting — and that is the function that turns a crude layer-level schema into a properly ranked one.

The callback is invoked once per element in the extract. Everything about how you write it is governed by that: no file access, no compiled patterns inside the function, no growing tables.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="wtl1-t wtl1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="wtl1-t">What happens to one OSM way as it passes through a profile</title>
  <desc id="wtl1-d">Four steps for a single way. The callback reads the tags it cares about with a lookup per key. A classification step maps the raw value onto a small closed vocabulary, returning early when the element is of no interest. The layer step assigns the element to a named layer, declaring whether it is an area. The attribute step writes the classification and a rank onto the feature and sets a per-feature minimum zoom derived from that rank.</desc>
  <defs><marker id="wtl1-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Read, classify, assign, describe</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">read tags</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">one lookup per key</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">return early if absent</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#wtl1-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">classify</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">raw value to vocabulary</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">a dozen classes</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#wtl1-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">assign layer</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">name plus area flag</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">the style's contract</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#wtl1-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">describe</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">attributes and min zoom</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">rank decides the zoom</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Returning early when the element is uninteresting is the single biggest performance decision in the whole profile.</text>
</svg>
<figcaption>Most elements in an extract exit at step one, which is why that step must be the cheapest thing in the file.</figcaption>
</figure>

## Runnable solution

```lua
-- profile.lua — layer assignment for an OSM base map.
-- Called once per element: keep every path constant-time.

-- Closed vocabularies, declared once at load time, never rebuilt per element.
local ROAD_CLASS = {
  motorway = "motorway", motorway_link = "motorway",
  trunk = "trunk", trunk_link = "trunk",
  primary = "primary", primary_link = "primary",
  secondary = "secondary", secondary_link = "secondary",
  tertiary = "tertiary", tertiary_link = "tertiary",
  unclassified = "minor", residential = "minor",
  service = "service", track = "track",
}
local ROAD_MINZOOM = {
  motorway = 4, trunk = 5, primary = 7, secondary = 9,
  tertiary = 11, minor = 13, service = 14, track = 14,
}
local WATER_KEYS = { natural = "water", landuse = "reservoir", waterway = "riverbank" }

-- Match counters, reported at the end so an empty layer is impossible to miss.
local counts = {}
local function tally(layer)
  counts[layer] = (counts[layer] or 0) + 1
end

function node_function()
  local place = Find("place")
  if place == "" then return end            -- the early exit: most nodes stop here
  local minzoom = ({ city = 6, town = 9, village = 11, hamlet = 13 })[place]
  if minzoom == nil then return end
  Layer("place", false)
  Attribute("class", place)
  Attribute("name", Find("name"))
  MinZoom(minzoom)
  tally("place")
end

function way_function()
  local highway = Find("highway")
  if highway ~= "" then
    local class = ROAD_CLASS[highway]
    if class == nil then return end          -- unknown road type: not rendered
    Layer("transportation", false)
    Attribute("class", class)
    -- A road carrying a reference number outranks its class by one level.
    local minzoom = ROAD_MINZOOM[class]
    if Find("ref") ~= "" then minzoom = math.max(3, minzoom - 1) end
    Attribute("rank", minzoom)
    MinZoom(minzoom)
    tally("transportation")
    return
  end

  for key, value in pairs(WATER_KEYS) do
    if Find(key) == value then
      Layer("water", true)                   -- true: this is an area
      Attribute("class", "water")
      MinZoom(4)
      tally("water")
      return
    end
  end

  local landuse = Find("landuse")
  if landuse ~= "" then
    Layer("landuse", true)
    Attribute("class", landuse)
    MinZoom(9)
    tally("landuse")
  end
end

-- Relations: without these two, every multipolygon lake and forest is dropped.
function relation_scan_function()
  if Find("type") == "multipolygon" then Accept() end
end

function relation_function()
  local natural = Find("natural")
  if natural == "water" then
    Layer("water", true)
    Attribute("class", "water")
    MinZoom(4)
    tally("water")
  elseif Find("landuse") ~= "" then
    Layer("landuse", true)
    Attribute("class", Find("landuse"))
    MinZoom(9)
    tally("landuse")
  end
end

function exit_function()
  for layer, n in pairs(counts) do
    print(string.format("layer %-15s %d feature(s)", layer, n))
  end
end
```

```json
{
  "layers": {
    "transportation": { "minzoom": 4,  "maxzoom": 14 },
    "water":          { "minzoom": 4,  "maxzoom": 14, "simplify_below": 12 },
    "landuse":        { "minzoom": 9,  "maxzoom": 14, "simplify_below": 12 },
    "place":          { "minzoom": 6,  "maxzoom": 14 }
  },
  "settings": {
    "minzoom": 0, "maxzoom": 14,
    "basezoom": 14, "include_ids": false,
    "name": "OSM base map",
    "attribution": "© OpenStreetMap contributors"
  }
}
```

## Step-by-step walkthrough

1. **Declare vocabularies at load time.** The lookup tables are built once when the script is loaded, not per element. A table constructed inside a callback would be allocated hundreds of millions of times.
2. **Exit early and often.** The first line of each callback reads one tag and returns when it is absent. The overwhelming majority of elements in an extract take that path.
3. **Return an explicit nil for unknown values.** A road class not in the vocabulary is not rendered rather than falling into a default, which keeps the schema closed and the tiles predictable.
4. **Set the area flag correctly.** `Layer(name, true)` declares an area; getting it wrong turns a lake outline into a line and a road into a polygon.
5. **Override the zoom per feature.** The layer's JSON minimum zoom is a floor; `MinZoom` on the feature is what makes a motorway appear at zoom 4 and a residential street at 13 within one layer.
6. **Handle relations in two functions.** The scan function decides which relations to accept, and the main function assigns the accepted ones. Omitting either silently drops every multipolygon.
7. **Count matches per layer.** The tally and the exit report are four lines and turn "the map looks wrong" into "the water layer matched zero features".
8. **Keep attribution in the configuration.** It belongs in the archive's metadata, which the settings block populates.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="wtl2-t wtl2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="wtl2-t">Which profile callback handles which OSM element, and what it must not forget</title>
  <desc id="wtl2-d">A grid of four callbacks against what each one receives and the mistake most often made in it. The node callback receives tagged nodes and most often forgets to exit early, making the build slow. The way callback receives ways and most often sets the area flag incorrectly. The relation scan callback decides which relations to accept and is most often omitted entirely, dropping every multipolygon. The relation callback assigns accepted relations and most often duplicates logic already in the way callback without keeping it in step.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four callbacks, four characteristic mistakes</text>
  <rect x="216" y="48" width="319" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="376" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Receives</text>
  <rect x="535" y="48" width="319" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="694" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Usual mistake</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">node_function</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">tagged nodes</text>
  <text x="694" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">no early exit</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">way_function</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">all ways</text>
  <text x="694" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">wrong area flag</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">relation_scan</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">all relations</text>
  <text x="694" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">omitted entirely</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">relation_function</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="376" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">accepted relations</text>
  <text x="694" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">drifts from way logic</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The third row is the one that produces a map missing every large lake and forest while looking otherwise complete.</text>
</svg>
<figcaption>The fourth row argues for a shared helper: the same tags should classify identically whether they arrive on a way or a relation.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="wtl3-t wtl3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="wtl3-t">How the two configuration files divide responsibility</title>
  <desc id="wtl3-d">Four layers describing where each decision lives. The JSON settings block holds global concerns: the overall zoom range, the archive name and the attribution text. The JSON layers block declares each layer's name and its floor and ceiling zooms, which the archive metadata advertises. The Lua vocabularies hold the closed sets mapping raw tag values onto classes, declared once at load time. The Lua callbacks hold the per-element decisions: which layer, which attributes and which minimum zoom.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four places a decision can live, and only one is right for each</text>
  <rect x="26" y="50" width="828" height="52" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="42" y="72" font-size="12.5" font-weight="700" fill="currentColor">JSON settings</text>
  <text x="42" y="90" font-size="10.5" fill="currentColor" opacity="0.88">Zoom range, name, attribution</text>
  <text x="838" y="82" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">archive metadata</text>
  <rect x="26" y="112" width="828" height="52" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="42" y="134" font-size="12.5" font-weight="700" fill="currentColor">JSON layers</text>
  <text x="42" y="152" font-size="10.5" fill="currentColor" opacity="0.88">Layer names and zoom floors</text>
  <text x="838" y="144" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">the style contract</text>
  <rect x="26" y="174" width="828" height="52" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="42" y="196" font-size="12.5" font-weight="700" fill="currentColor">Lua vocabularies</text>
  <text x="42" y="214" font-size="10.5" fill="currentColor" opacity="0.88">Tag value to class maps</text>
  <text x="838" y="206" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">load time, not per element</text>
  <rect x="26" y="236" width="828" height="52" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="42" y="258" font-size="12.5" font-weight="700" fill="currentColor">Lua callbacks</text>
  <text x="42" y="276" font-size="10.5" fill="currentColor" opacity="0.88">Layer, attributes, min zoom</text>
  <text x="838" y="268" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">per element, keep it cheap</text>
  <text x="868" y="308" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Putting a class map in a callback or a layer name in the Lua is how the two files drift out of step with each other.</text>
</svg>
<figcaption>Each band answers a different question, and the boundaries between them are what keep the profile reviewable.</figcaption>
</figure>

## Verification

- **Every layer reports a non-zero count.** The exit report is the fastest possible check that a branch is reachable.
- **A known feature appears at its intended zoom.** Pick a specific motorway and a specific residential street and confirm both.
- **Areas are areas.** Decode a tile and confirm water features are polygons, not lines.
- **Multipolygon lakes are present.** Find a large lake mapped as a relation; if it is missing, relation handling is not firing.
- **The build is not profile-bound.** Compare the run time against a trivial profile on the same extract; a large gap points at per-element work.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Large lakes missing | Relation callbacks not implemented | Accept multipolygons in the scan and assign them |
| Water renders as outlines | Area flag not set on the layer call | Pass the area flag as true for polygon features |
| Build unexpectedly slow | Table or pattern built inside a callback | Declare all lookup tables at script load time |
| A layer is empty | Branch never reached for real data | Add per-layer counters and read the exit report |
| Everything appears at once | Only layer-level zoom ranges used | Set a per-feature minimum zoom from a rank |
| Unknown road types rendered oddly | Fallback default for unmatched values | Return without emitting when the class is unknown |
| Attribution missing | Settings block incomplete | Set name and attribution in the configuration |

## Specification reference

> A Tilemaker profile consists of a JSON configuration declaring layers with their zoom ranges and a Lua script implementing `node_function`, `way_function`, and the relation scanning and processing functions. Within these, `Find` reads tags, `Layer` assigns the element to a layer with an area flag, `Attribute` writes an attribute, and `MinZoom` overrides the layer's minimum zoom for the current feature. See the [Tilemaker documentation](https://github.com/systemed/tilemaker) for the full callback list and configuration keys.

## Frequently Asked Questions

<details>
<summary>Why are my multipolygon areas missing?</summary>

Because relations need their own handling, in two parts: a scanning function that decides which relations to accept, and a processing function that assigns the accepted ones to layers. A profile copied from a minimal example usually implements only the node and way callbacks, which silently drops every area mapped as a multipolygon relation. Most large lakes, forests and complex buildings are mapped that way, so the map looks complete until somebody notices every big water body is absent.
</details>

<details>
<summary>Should the zoom range live in the JSON or in the Lua?</summary>

Both, doing different jobs. The JSON layer range is a floor and ceiling for the whole layer, which the archive's metadata advertises to clients. The per-feature override in Lua is what distinguishes a motorway from a driveway within that range. Using only the JSON gives a map where everything in a layer appears at once; using only the override leaves the metadata describing a wider range than the data occupies.
</details>

<details>
<summary>How do I keep the profile fast?</summary>

Declare every lookup table at script load time, return as early as possible, and make sure the first thing each callback does is the cheapest test that rejects most elements. The callback runs once per element, so anything allocating or compiling inside it is multiplied by hundreds of millions. Comparing a run against a trivial profile on the same extract tells you immediately whether the profile or the tool is the limit.
</details>

<details>
<summary>Should a way and a relation with the same tags be handled identically?</summary>

Yes, and the reliable way to guarantee it is a shared helper called from both callbacks. Duplicating the classification logic works initially and then drifts: somebody adds a land use class to the way path and forgets the relation path, and the map ends up rendering that class only where it happens to be mapped as a closed way. One function, two call sites.
</details>

## Related

- [Planetiler & Tilemaker Workflows](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/) — the parent topic and the comparison behind choosing this tool.
- [Running Planetiler on a Regional Extract](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/running-planetiler-on-a-regional-extract/) — the sibling tool with a compiled profile.
- [Tuning Tippecanoe Zoom and Feature Dropping](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/building-tiles-with-tippecanoe/tuning-tippecanoe-zoom-and-feature-dropping/) — the same ranking idea in the GeoJSON pipeline.
- [Understanding OSM Multipolygon Relations for GIS](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/understanding-osm-multipolygon-relations-for-gis/) — what the relation callbacks are assembling.
- [Mapping OSM Tags to a Fixed Schema with YAML](https://www.osm-data-processing.org/parsing-tag-normalization-workflows/batch-attribute-mapping-strategies/mapping-osm-tags-to-a-fixed-schema-with-yaml/) — the same closed-vocabulary discipline as configuration.

Up one level: [Planetiler & Tilemaker Workflows](https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Writing a Tilemaker Lua Profile for OSM Tags",
  "description": "Express layer assignment, attributes and zoom ranges as a Tilemaker Lua profile, with a closed vocabulary, explicit relation handling and per-layer match counters that make it reviewable.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Vector Tiles & Rendering Pipelines",
  "about": ["Tilemaker profile", "Lua layer assignment", "multipolygon handling"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Vector Tiles & Rendering Pipelines", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/" },
    { "@type": "ListItem", "position": 3, "name": "Planetiler & Tilemaker Workflows", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/" },
    { "@type": "ListItem", "position": 4, "name": "Writing a Tilemaker Lua Profile for OSM Tags", "item": "https://www.osm-data-processing.org/osm-vector-tiles-and-rendering/planetiler-and-tilemaker-workflows/writing-a-tilemaker-lua-profile-for-osm-tags/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Write a Tilemaker Lua profile for OSM data",
  "description": "Declare vocabularies at load time, exit early per element, assign layers with the correct area flag, override minimum zoom per feature, handle relations in both callbacks, and count matches per layer.",
  "step": [
    { "@type": "HowToStep", "name": "Declare vocabularies once", "text": "Build every lookup table at script load time so nothing is allocated inside a per-element callback." },
    { "@type": "HowToStep", "name": "Exit early", "text": "Make the first test in each callback the cheapest one that rejects the majority of elements." },
    { "@type": "HowToStep", "name": "Close the vocabulary", "text": "Return without emitting when a tag value is not in the vocabulary, rather than falling back to a default class." },
    { "@type": "HowToStep", "name": "Set the area flag correctly", "text": "Declare polygon features as areas when assigning the layer, since the flag decides how geometry is interpreted." },
    { "@type": "HowToStep", "name": "Override the zoom per feature", "text": "Use the per-feature minimum zoom to distinguish importance within a layer whose JSON range is only a floor." },
    { "@type": "HowToStep", "name": "Handle relations in both callbacks", "text": "Accept multipolygon relations in the scanning function and assign them in the processing function." },
    { "@type": "HowToStep", "name": "Count matches per layer", "text": "Tally features per layer and print the totals at exit so an unreachable branch is immediately visible." }
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
      "name": "Why are my multipolygon areas missing from Tilemaker output?",
      "acceptedAnswer": { "@type": "Answer", "text": "Because relations need their own handling, in two parts: a scanning function that decides which relations to accept, and a processing function that assigns the accepted ones to layers. A profile copied from a minimal example usually implements only the node and way callbacks, which silently drops every area mapped as a multipolygon relation." }
    },
    {
      "@type": "Question",
      "name": "Should the zoom range live in the JSON configuration or in the Lua profile?",
      "acceptedAnswer": { "@type": "Answer", "text": "Both, doing different jobs. The JSON layer range is a floor and ceiling for the whole layer, which the archive's metadata advertises to clients. The per-feature override in Lua is what distinguishes a motorway from a driveway within that range. Using only the JSON gives a map where everything in a layer appears at once." }
    },
    {
      "@type": "Question",
      "name": "How do I keep a Tilemaker profile fast?",
      "acceptedAnswer": { "@type": "Answer", "text": "Declare every lookup table at script load time, return as early as possible, and make sure the first thing each callback does is the cheapest test that rejects most elements. The callback runs once per element, so anything allocating or compiling inside it is multiplied by hundreds of millions." }
    },
    {
      "@type": "Question",
      "name": "Should a way and a relation with the same tags be handled identically?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes, and the reliable way to guarantee it is a shared helper called from both callbacks. Duplicating the classification logic works initially and then drifts: somebody adds a class to the way path and forgets the relation path, and the map ends up rendering that class only where it happens to be mapped as a closed way." }
    }
  ]
}
</script>
