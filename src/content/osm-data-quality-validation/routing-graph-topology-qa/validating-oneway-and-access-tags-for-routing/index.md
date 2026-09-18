---
title: "Validating Oneway and Access Tags for Routing"
description: "Catch the directional and access tagging that makes a routing graph produce impossible routes: reversed oneways, unreachable pockets, and access values that mean nothing to your profile."
pageTitle: "Checking OSM Oneway and Access Tags Before Routing"
pageDescription: "Validate oneway and access tagging against the routing profile that consumes it, find the pockets a reversed oneway creates, and separate genuine restrictions from tagging errors."
slug: validating-oneway-and-access-tags-for-routing
type: article
breadcrumb: "Oneway & Access QA"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Validating Oneway and Access Tags for Routing

A single reversed `oneway` tag can make a city block unreachable, and nothing about the data looks wrong: the geometry is valid, the tags parse, and the router simply refuses to go there.

## Prerequisites

- [ ] Python 3.10+ with `networkx` for the connectivity work, or an equivalent graph library.
- [ ] A routing graph built from OSM, per [Routing Graph Topology QA](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/).
- [ ] The routing profile being validated against — car, bicycle and foot answer differently.
- [ ] The tag normalisation from [Normalizing OSM Yes/No Tag Values](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/normalizing-osm-yes-no-tag-values/).

## Conceptual minimum

Directional and access tagging is validated against a **profile**, not in the abstract. `oneway=yes` restricts cars and, unless `oneway:bicycle=no` says otherwise, often bicycles too; it means nothing to a pedestrian. A check that reports "this way is oneway" has found nothing. A check that reports "under the car profile, this way's direction makes eleven addresses unreachable" has found something.

Three classes of problem are worth separating.

**Syntactic problems** are values the profile cannot interpret: `oneway=1`, `oneway=true`, `access=allowed`, a `maxspeed` in a form nothing parses. These are cheap to find, unambiguous, and usually a small fixed list of variants once you look.

**Structural problems** are consistent tagging that produces an impossible graph. A reversed oneway on a short link creates a pocket that can be entered and not left, or reached only by an absurd detour. These do not show up as invalid anything; they show up as connectivity.

**Semantic problems** are tags that are individually valid and collectively contradictory: `access=no` on a way with `bicycle=yes` and `foot=no`, or a `oneway` on a roundabout that opposes the others in the same loop. These need the profile's precedence rules to detect, which is why the check has to share those rules with the router rather than reimplement them.

The structural class is where the real damage is, and finding it needs a graph rather than a tag scan: **strongly connected components under the profile's directional rules**. A healthy road network for cars is very nearly one giant strongly connected component, and everything outside it is either a genuine dead end or a bug.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="voa1-t voa1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="voa1-t">Three classes of oneway and access problem, and what finds each</title>
  <desc id="voa1-d">Three panels. Syntactic problems are unparseable values such as oneway equals one or access equals allowed, which a tag scan finds instantly and which usually reduce to a small fixed list of variants. Structural problems are consistently tagged directions that produce an impossible graph, such as a reversed oneway creating a pocket that can be entered but never left, which only a strongly connected component analysis finds. Semantic problems are individually valid tags that contradict each other under the profile's precedence rules, such as access equals no alongside bicycle equals yes, which need the router's own rules to detect.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Syntactic, structural, semantic</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Syntactic</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">oneway=1, access=allowed</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">A tag scan finds it</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">A short list of variants</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Unambiguous to fix</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Structural</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Reversed oneway</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Pocket you cannot leave</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Needs a graph analysis</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Where the damage is</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Semantic</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">access=no, bicycle=yes</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Individually valid</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Needs profile precedence</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Share rules with the router</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Only the first class is found by looking at tags alone, and it is the least consequential of the three.</text>
</svg>
<figcaption>A validator that scans tags covers the cheapest third of the problem.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import logging
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

import networkx as nx

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.routing.access")

# Values the specification recognises. Anything else is a finding, not a guess.
ONEWAY_FORWARD = {"yes", "true", "1"}
ONEWAY_REVERSE = {"-1", "reverse"}
ONEWAY_NONE = {"no", "false", "0"}
ACCESS_DENY = {"no", "private", "agricultural", "forestry", "delivery",
               "customers", "permit"}
ACCESS_ALLOW = {"yes", "designated", "permissive", "destination", "official"}


@dataclass(frozen=True)
class Profile:
    """Which keys the router reads, in precedence order. Must match the router."""
    name: str
    access_keys: tuple[str, ...]          # most specific LAST
    honours_oneway: bool = True
    oneway_exception_key: str | None = None   # e.g. "oneway:bicycle"


CAR = Profile("car", ("access", "vehicle", "motor_vehicle", "motorcar"))
BIKE = Profile("bike", ("access", "vehicle", "bicycle"),
               oneway_exception_key="oneway:bicycle")
FOOT = Profile("foot", ("access", "foot"), honours_oneway=False)


@dataclass
class Findings:
    unparseable: list[tuple[int, str, str]] = field(default_factory=list)
    contradictory: list[tuple[int, str]] = field(default_factory=list)
    unreachable: list[int] = field(default_factory=list)
    inescapable: list[int] = field(default_factory=list)


def direction(tags: Mapping[str, str], profile: Profile
              ) -> tuple[bool, bool, str | None]:
    """Return (forward_allowed, backward_allowed, problem)."""
    if not profile.honours_oneway:
        return True, True, None

    value = tags.get("oneway", "no").strip().lower()
    if profile.oneway_exception_key:
        value = tags.get(profile.oneway_exception_key, value).strip().lower()

    if value in ONEWAY_NONE:
        return True, True, None
    if value in ONEWAY_FORWARD:
        return True, False, None
    if value in ONEWAY_REVERSE:
        return False, True, None
    # Never guess: an unrecognised value is a finding, and treating it as
    # bidirectional invents a route while treating it as oneway removes one.
    return True, True, f"unparseable oneway value {value!r}"


def accessible(tags: Mapping[str, str], profile: Profile
               ) -> tuple[bool, str | None]:
    """Apply the profile's keys in order; the most specific one present wins."""
    allowed: bool | None = None
    seen: list[tuple[str, str]] = []
    for key in profile.access_keys:
        value = tags.get(key)
        if value is None:
            continue
        value = value.strip().lower()
        seen.append((key, value))
        if value in ACCESS_DENY:
            allowed = False
        elif value in ACCESS_ALLOW:
            allowed = True
        else:
            return True, f"unparseable {key} value {value!r}"

    if len(seen) > 1 and len({v for _, v in seen}) > 1:
        # Not an error by itself — specific overrides general is the point —
        # but worth surfacing when the general key denies and no specific
        # key re-permits for THIS profile.
        general = dict(seen).get("access")
        if general in ACCESS_DENY and allowed is False:
            return False, None
    return (True if allowed is None else allowed), None


def build(ways: Iterable[tuple[int, list[int], Mapping[str, str]]],
          profile: Profile, findings: Findings) -> nx.DiGraph:
    graph = nx.DiGraph()
    for way_id, nodes, tags in ways:
        ok, problem = accessible(tags, profile)
        if problem:
            findings.unparseable.append((way_id, "access", problem))
        if not ok:
            continue
        forward, backward, problem = direction(tags, profile)
        if problem:
            findings.unparseable.append((way_id, "oneway", problem))
        for a, b in zip(nodes, nodes[1:]):
            if forward:
                graph.add_edge(a, b, way=way_id)
            if backward:
                graph.add_edge(b, a, way=way_id)
    return graph


def connectivity(graph: nx.DiGraph, findings: Findings,
                 min_component: int = 20) -> None:
    """A healthy car network is nearly one giant strongly connected component.

    Everything outside it is a genuine dead end or a directional bug, and the
    two are distinguished by whether the pocket has an undirected connection
    to the giant component that the directions have closed off.
    """
    components = sorted(nx.strongly_connected_components(graph),
                        key=len, reverse=True)
    if not components:
        return
    giant = components[0]
    logger.info("giant component holds %.2f%% of nodes",
                100 * len(giant) / graph.number_of_nodes())

    undirected = graph.to_undirected(as_view=True)
    for component in components[1:]:
        if len(component) < min_component:
            continue
        touches_giant = any(neighbour in giant
                            for node in component
                            for neighbour in undirected.neighbors(node))
        if not touches_giant:
            continue
        # Physically connected, directionally isolated: a oneway bug.
        into = any(graph.has_edge(n, m) for n in giant for m in component
                   if graph.has_edge(n, m))
        (findings.inescapable if into else findings.unreachable).extend(
            sorted(component)[:5])


if __name__ == "__main__":
    logger.info("validate against the profile the router actually uses")
```

## Step-by-step walkthrough

1. **Take the profile as a parameter.** The same data is correct for one profile and broken for another, so a check without a profile is answering an undefined question.
2. **Never guess an unparseable value.** Defaulting `oneway=1` to bidirectional invents a route; defaulting it to oneway removes one. Report it and leave the graph unchanged.
3. **Apply access keys in precedence order.** `motorcar` overrides `motor_vehicle` overrides `vehicle` overrides `access`, and a check that ignores that reports a private-access finding on every service road.
4. **Build the directed graph the router would build.** The whole point is to find what the router will do, and any divergence in the graph construction makes the findings advisory rather than real.
5. **Compute strongly connected components.** For a car profile the giant component should hold almost everything, and a component of twenty nodes sitting outside it is a strong signal.
6. **Distinguish unreachable from inescapable.** A pocket you can enter but not leave and one you can leave but not enter are different bugs with the same connectivity signature, and naming which is which halves the diagnosis.
7. **Filter tiny components.** Genuine cul-de-sacs, service yards and driveways produce small components legitimately, and a floor of around twenty nodes removes most of that noise.
8. **Check physical adjacency before reporting.** A component with no undirected connection to the giant one is simply a disconnected area, not a directional bug.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="voa2-t voa2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="voa2-t">How a single reversed oneway becomes an unreachable block</title>
  <desc id="voa2-d">Four steps. One short link in a grid of streets is tagged oneway in the wrong direction, which is a single character difference from correct and passes every syntactic check. Because the surrounding streets are themselves oneway in an alternating pattern, that link was the only inbound route into a block. The block remains physically connected to the network in the undirected sense, so no geometry or topology check notices anything. Under the directed graph the router builds, the block becomes its own strongly connected component that can be left but never entered, and every address inside it is unroutable as a destination.</desc>
  <defs><marker id="voa2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">One tag, one unreachable block</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">reversed link</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">one character wrong</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">passes tag checks</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#voa2-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">only inbound route</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">neighbours alternate</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">no other way in</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#voa2-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">still connected</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">undirected view fine</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">geometry checks pass</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#voa2-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">own component</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">can leave, cannot enter</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">addresses unroutable</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Nothing in the third step is wrong, which is why every check that ignores direction reports a clean result here.</text>
</svg>
<figcaption>The signature is a small strongly connected component adjacent to the giant one.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 296" role="img" aria-labelledby="voa3-t voa3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="voa3-t">How three routing profiles read the same tags differently</title>
  <desc id="voa3-d">A grid of four tag combinations against how the car, bicycle and foot profiles each interpret them. A way tagged oneway equals yes is directional for cars and bicycles but irrelevant to pedestrians. A way tagged oneway equals yes with oneway colon bicycle equals no is directional for cars and bidirectional for bicycles and pedestrians. A way tagged access equals no with bicycle equals yes is closed to cars and open to bicycles, with pedestrians closed unless a foot key permits them. A way tagged highway equals footway is closed to cars, usually closed to bicycles unless permitted, and open to pedestrians.</desc>
  <rect x="0" y="0" width="880" height="296" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">One set of tags, three answers</text>
  <rect x="212" y="48" width="214" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="319" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Car</text>
  <rect x="426" y="48" width="214" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="533" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Bicycle</text>
  <rect x="640" y="48" width="214" height="30" rx="6" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="747" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Foot</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">oneway=yes</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="319" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">directional</text>
  <text x="533" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">directional</text>
  <text x="747" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">irrelevant</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">+ oneway:bicycle=no</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="319" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">directional</text>
  <text x="533" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">both ways</text>
  <text x="747" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">irrelevant</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">access=no, bicycle=yes</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="319" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">closed</text>
  <text x="533" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">open</text>
  <text x="747" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">closed</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">highway=footway</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="319" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">closed</text>
  <text x="533" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">usually closed</text>
  <text x="747" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">open</text>
  <text x="868" y="280" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">A validator with no profile parameter has to pick one column and will report the other two as findings on correct data.</text>
</svg>
<figcaption>Every row is correctly tagged; only the profile decides what the data means.</figcaption>
</figure>

## Verification

- **A synthetic reversal is caught.** Flip one `oneway` in a test grid and confirm the component analysis finds the pocket.
- **The giant component dominates.** For a car profile on a city extract, it should hold well over ninety-nine percent of nodes.
- **Profiles differ.** Run car and foot profiles over the same data and confirm the foot graph has far fewer components.
- **Unparseable values are reported, not absorbed.** Introduce `oneway=true` and confirm it appears as a finding.
- **Precedence works.** Tag a way `access=no` with `motorcar=yes` and confirm the car profile treats it as open.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Router refuses plausible destinations | Reversed oneway creating a pocket | Report small components adjacent to the giant one |
| Every service road flagged as private | Access keys applied without precedence | Evaluate general to specific, most specific wins |
| Findings disagree with the router | Check builds a different graph | Share the profile rules with the router |
| Unusual oneway values silently ignored | Unrecognised value defaulted | Report unparseable values rather than guessing |
| Thousands of tiny components reported | No minimum component size | Filter below about twenty nodes |
| Disconnected islands reported as bugs | Physical adjacency never checked | Require an undirected link to the giant component |
| Cyclists routed the wrong way | `oneway:bicycle` not consulted | Let the profile name its own exception key |

## Specification reference

> The `oneway` key takes `yes`, `no` or `-1`, where `-1` indicates the restriction applies against the way's drawn direction; `true`, `false` and `1` are documented as deprecated equivalents. Transport-mode access keys form a hierarchy in which a more specific key overrides a more general one for the modes it covers, so `motorcar` overrides `motor_vehicle`, which overrides `vehicle`, which overrides `access`. Mode-specific oneway exceptions take the form `oneway:<mode>`. See the OpenStreetMap wiki pages for `oneway`, conditional restrictions and access.

## Frequently Asked Questions

<details>
<summary>How do you tell a genuine dead end from a directional bug?</summary>

By whether the component is physically adjacent to the rest of the network in the undirected graph. A cul-de-sac is its own small component only if it is oneway inward or outward, which is unusual; normally it is part of the giant component because you can drive both ways along it. A component that touches the giant one undirectedly but not directionally is almost always a tagging error, and that adjacency test removes nearly all the false positives.
</details>

<details>
<summary>Should the validator fix what it finds?</summary>

No, and especially not by reversing tags automatically. Some of these are genuine: a street really can be oneway in a way that makes a block awkward to reach, and mappers survey the ground. The validator's output belongs in a review queue where somebody can check imagery or local knowledge, and an automated fix pushed upstream is how a corrective edit becomes a mapping dispute.
</details>

<details>
<summary>What about conditional restrictions?</summary>

`oneway:conditional` and time-based access are real and widely used, and a validator that ignores them will report findings on correctly tagged data. The pragmatic approach is to evaluate them for a representative time — a weekday midday — and to mark findings on conditionally restricted ways as lower confidence, since the check has picked one moment out of a schedule. Treating them as unconditional is the alternative, and it produces confident nonsense.
</details>

<details>
<summary>Does this need the whole network, or can it run on an extract?</summary>

The connectivity analysis needs enough of the network that the giant component is genuinely giant, which an extract clipped to a city boundary does not give you — every road crossing the boundary becomes a false dead end. Running it on an extract with a generous buffer, and ignoring findings within that buffer, is the usual compromise. The clipping strategies in the extract material apply directly.
</details>

## Related

- [Routing Graph Topology QA](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/) — the parent topic.
- [Continuous QA for OSM Pipelines](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/) — running this as a semantic check in the gate.
- [Normalizing OSM Yes/No Tag Values](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/normalizing-osm-yes-no-tag-values/) — the variants this check reports.
- [Finding Statistical Outliers in OSM Tag Values](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/finding-statistical-outliers-in-osm-tag-values/) — the complementary tag-level approach.
- [OSM Extract Clipping & Boundaries](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/) — why an extract's edge creates false dead ends.

Up one level: [Routing Graph Topology QA](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Validating Oneway and Access Tags for Routing",
  "description": "Catch the directional and access tagging that makes a routing graph produce impossible routes: reversed oneways, unreachable pockets, and access values that mean nothing to your profile.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Quality & Validation",
  "about": ["oneway validation", "access tags", "routing connectivity"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Quality & Validation", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/" },
    { "@type": "ListItem", "position": 3, "name": "Routing Graph Topology QA", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/" },
    { "@type": "ListItem", "position": 4, "name": "Validating Oneway and Access Tags for Routing", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/validating-oneway-and-access-tags-for-routing/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Validate OSM oneway and access tags against a routing profile",
  "description": "Build the directed graph the router would build for a given profile, report unparseable values rather than guessing, and use strongly connected components to find pockets a directional error created.",
  "step": [
    { "@type": "HowToStep", "name": "Take the profile as a parameter", "text": "Validate against the car, bicycle or foot profile explicitly, since the same data is correct for one and broken for another." },
    { "@type": "HowToStep", "name": "Report unparseable values", "text": "Never default an unrecognised oneway or access value, because either guess invents or removes a route." },
    { "@type": "HowToStep", "name": "Apply access keys in precedence order", "text": "Let the most specific present key win, so a general denial with a specific permission is read correctly." },
    { "@type": "HowToStep", "name": "Build the router's graph", "text": "Construct the same directed edges the router would, so findings describe real behaviour." },
    { "@type": "HowToStep", "name": "Compute strongly connected components", "text": "Expect one giant component for a car profile and treat sizeable others as candidates." },
    { "@type": "HowToStep", "name": "Require undirected adjacency", "text": "Only report a component that physically touches the giant one, which removes genuinely separate areas." },
    { "@type": "HowToStep", "name": "Distinguish unreachable from inescapable", "text": "Say whether the pocket can be entered or left, which halves the diagnosis time." }
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
      "name": "How do you tell a genuine dead end from a oneway tagging bug?",
      "acceptedAnswer": { "@type": "Answer", "text": "By whether the component is physically adjacent to the network in the undirected graph. A cul-de-sac is normally part of the giant component because you can drive both ways along it. A component touching the giant one undirectedly but not directionally is almost always a tagging error." }
    },
    {
      "@type": "Question",
      "name": "Should a oneway validator fix what it finds?",
      "acceptedAnswer": { "@type": "Answer", "text": "No, and especially not by reversing tags automatically. Some findings are genuine — a street really can be oneway in an awkward way — and mappers survey the ground. Output belongs in a review queue, since an automated fix pushed upstream turns a correction into a dispute." }
    },
    {
      "@type": "Question",
      "name": "What about conditional oneway and access restrictions?",
      "acceptedAnswer": { "@type": "Answer", "text": "They are real and widely used, so ignoring them produces findings on correct data. Evaluate them for a representative time such as a weekday midday and mark those findings lower confidence, since the check has picked one moment from a schedule. Treating them as unconditional produces confident nonsense." }
    },
    {
      "@type": "Question",
      "name": "Can connectivity validation run on a clipped OSM extract?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only with a buffer. An extract clipped to a city boundary turns every road crossing that boundary into a false dead end. Run with a generous buffer and ignore findings inside it, which is the usual compromise." }
    }
  ]
}
</script>
