---
title: "Detecting Turn Restriction Errors in OSM"
description: "Find the turn restrictions a router silently ignores: missing members, cardinality violations, unknown values, and via members that do not actually connect from to to."
pageTitle: "Detect Turn Restriction Errors in OSM Data"
pageDescription: "A two-pass turn-restriction validator for OSM — role cardinality, only_ versus no_ semantics, via node and via way-chain connectivity, and defect rates from a real extract."
slug: "detecting-turn-restriction-errors-in-osm"
type: "article"
breadcrumb: "Turn Restriction Errors"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Detecting Turn Restriction Errors in OSM

Find the turn restrictions a router will silently ignore, before they become a route that tells a driver to turn where they cannot.

## Prerequisites

- [ ] Python 3.10+ with `osmium` (pyosmium 3.6+)
- [ ] An extract cut with `smart`, so relation members are present — see [Choosing complete_ways vs smart in osmium extract](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/choosing-complete-ways-vs-smart-in-osmium-extract/)
- [ ] Enough memory for the highway way index — a few hundred megabytes per country
- [ ] Familiarity with relations, per [Node, Way & Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/)

## Conceptual minimum

A turn restriction is a relation with `type=restriction`, three roled members and a `restriction` tag naming the rule.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="tr-anatomy-t tr-anatomy-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="tr-anatomy-t">The four required parts of a turn-restriction relation</title>
  <desc id="tr-anatomy-d">A four-stage chain. The from member is exactly one way, the approach. The via member is a node or one or more ways, the junction itself. The to member is exactly one way, the departure. The restriction tag names the rule, such as no_left_turn or only_straight_on.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="tr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">A turn restriction is a relation, and every member has a job</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">from</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">exactly one way</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">the approach</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#tr)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">via</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">a node, or 1+ ways</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">the junction itself</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#tr)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">to</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">exactly one way</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">the departure</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#tr)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">restriction=</text>
  <text x="761" y="107" text-anchor="middle" font-size="9.0" fill="currentColor" opacity="0.85">no_left_turn, only_straight_on …</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">the rule</text>
  <text x="440" y="158" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">Two of these four constraints are routinely violated in real data: multiple from members, and a via that is neither a node nor a connected way chain.</text>
</svg>
<figcaption>The cardinality constraints are the part most often broken: extra from members, and via chains that do not actually connect.</figcaption>
</figure>

Routers are uniformly forgiving: a relation they cannot interpret is skipped, not reported. That is the right behaviour for a router and it means every defect below has the same visible symptom — the restriction has no effect and nothing says so.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 358" role="img" aria-labelledby="tr-defects-t tr-defects-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="tr-defects-t">Six turn-restriction defects and how a router responds</title>
  <desc id="tr-defects-d">A grid of six defects. A missing from, via or to member makes the router ignore the relation, so the restriction is silently unenforced. Two from members make the router ignore it or pick one non-deterministically. A via node not on the from way means the junction is not where it claims. A deleted to way is a stale reference after an edit. An unknown restriction value comes from a typo or a local convention. An only-type restriction with several to members is contradictory, since only means exactly one permitted exit.</desc>
  <rect x="0" y="0" width="880" height="358" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Six defects, and what a router does with each</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">what a router does</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">severity</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">missing from / via / to</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">ignores the relation</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">restriction silently unenforced</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">two from members</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">ignores, or picks one</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">depends on the router — non-deterministic</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">via node not on the from way</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">ignores the relation</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">the junction is not where it claims</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">to way deleted</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">ignores the relation</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">stale reference after an edit</text>
  <text x="198" y="264" text-anchor="end" font-size="11.5" fill="currentColor">unknown restriction value</text>
  <rect x="213" y="244" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">ignores the relation</text>
  <rect x="535" y="244" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="693" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">typo, or a local convention</text>
  <text x="198" y="304" text-anchor="end" font-size="11.0" fill="currentColor">only_* with several to members</text>
  <rect x="213" y="284" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="304" text-anchor="middle" font-size="10.5" fill="currentColor">contradictory</text>
  <rect x="535" y="284" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="304" text-anchor="middle" font-size="10.5" fill="currentColor">only_ means exactly one permitted exit</text>
  <text x="440" y="340" text-anchor="middle" font-size="8.5" fill="currentColor" opacity="0.85">Every defect here has the same visible symptom — the restriction quietly does nothing — which is why they have to be found by validation rather than by testing routes.</text>
</svg>
<figcaption>They all present identically: the restriction has no effect and nothing reports it.</figcaption>
</figure>

The `only_*` family deserves separate attention. `no_left_turn` forbids one movement; `only_straight_on` forbids *every* movement except one. A malformed `no_*` restriction loses one prohibition, while a malformed `only_*` restriction loses several — so the same defect rate carries more consequence on the `only_` half.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="tr-rates-t tr-rates-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="tr-rates-t">Defect rates across 84 210 turn restrictions</title>
  <desc id="tr-rates-d">A bar chart of 84 210 turn restrictions in a European country extract. 96.9 percent are valid. 1.4 percent carry an unknown restriction value from typos or local variants. 0.9 percent have a via that is not connected to the from way. 0.5 percent have a missing or deleted member. 0.3 percent violate cardinality with two from members or several to members.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">How often each defect appears</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">84 210 turn restrictions in a European country extract</text>
  <line x1="250" y1="68" x2="250" y2="270" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">valid</text>
  <rect x="250" y="74" width="470" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="868" y="89" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">96.9% — the healthy majority</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">unknown restriction value</text>
  <rect x="250" y="116" width="7" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="267" y="131" font-size="11" fill="currentColor" opacity="0.9">1.4% — typos and local variants</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">via not connected to from</text>
  <rect x="250" y="158" width="6" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="266" y="173" font-size="11" fill="currentColor" opacity="0.9">0.9% — the geometry is wrong</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">member missing or deleted</text>
  <rect x="250" y="200" width="6" height="21" rx="3" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="266" y="215" font-size="11" fill="currentColor" opacity="0.9">0.5% — stale after an edit</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">cardinality violated</text>
  <rect x="250" y="242" width="6" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="266" y="257" font-size="11" fill="currentColor" opacity="0.9">0.3% — two from, or several to</text>
  <text x="440" y="306" text-anchor="middle" font-size="11.0" fill="currentColor" opacity="0.85">Around three percent of turn restrictions in a typical country do nothing at all, and the affected junctions route as if unrestricted.</text>
</svg>
<figcaption>Three percent sounds small until it is three percent of the junctions a route passes through, each one silently permitting a turn that is not allowed.</figcaption>
</figure>

## Runnable solution

```python
#!/usr/bin/env python3
"""Validate OSM turn restrictions against what a router actually requires."""
from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

import osmium

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

NO_TURNS = frozenset({
    "no_left_turn", "no_right_turn", "no_straight_on", "no_u_turn",
    "no_entry", "no_exit",
})
ONLY_TURNS = frozenset({"only_left_turn", "only_right_turn", "only_straight_on", "only_u_turn"})
VALID_RESTRICTIONS = NO_TURNS | ONLY_TURNS


class Defect(str, Enum):
    MISSING_MEMBER = "missing_member"
    EXTRA_FROM = "extra_from"
    EXTRA_TO_ON_ONLY = "extra_to_on_only"
    MEMBER_ABSENT = "member_absent"
    VIA_NOT_CONNECTED = "via_not_connected"
    UNKNOWN_RESTRICTION = "unknown_restriction"
    NOT_A_HIGHWAY = "not_a_highway"


@dataclass
class Finding:
    relation: int
    defect: Defect
    detail: str


class WayIndex(osmium.SimpleHandler):
    """Pass 1 — the endpoints and node set of every highway way.

    Only highways: a restriction whose members are not routable ways is itself a
    defect, and indexing everything would cost several times the memory.
    """

    def __init__(self) -> None:
        super().__init__()
        self.nodes: dict[int, frozenset[int]] = {}
        self.ends: dict[int, tuple[int, int]] = {}

    def way(self, w) -> None:
        if "highway" not in w.tags or len(w.nodes) < 2:
            return
        refs = [n.ref for n in w.nodes]
        self.nodes[w.id] = frozenset(refs)
        self.ends[w.id] = (refs[0], refs[-1])


class RestrictionValidator(osmium.SimpleHandler):
    """Pass 2 — check each restriction relation against the indexed ways."""

    def __init__(self, index: WayIndex) -> None:
        super().__init__()
        self.index = index
        self.findings: list[Finding] = []
        self.checked = 0

    def relation(self, r) -> None:
        if r.tags.get("type") != "restriction":
            return
        self.checked += 1

        roles: dict[str, list[tuple[str, int]]] = defaultdict(list)
        for member in r.members:
            if member.role in ("from", "via", "to"):
                roles[member.role].append((member.type, member.ref))

        for role in ("from", "via", "to"):
            if not roles[role]:
                self._add(r.id, Defect.MISSING_MEMBER, f"no {role} member")
                return                       # nothing else is checkable

        value = r.tags.get("restriction") or next(
            (v for k, v in r.tags if k.startswith("restriction:")), None)
        if value not in VALID_RESTRICTIONS:
            self._add(r.id, Defect.UNKNOWN_RESTRICTION, f"restriction={value!r}")

        # Cardinality. `from` is always exactly one; `to` may be several only
        # for no_* restrictions, because only_* names the single permitted exit.
        if len(roles["from"]) > 1:
            self._add(r.id, Defect.EXTRA_FROM, f"{len(roles['from'])} from members")
        if value in ONLY_TURNS and len(roles["to"]) > 1:
            self._add(r.id, Defect.EXTRA_TO_ON_ONLY,
                      f"{value} with {len(roles['to'])} to members")

        from_type, from_ref = roles["from"][0]
        to_type, to_ref = roles["to"][0]
        for label, mtype, ref in (("from", from_type, from_ref), ("to", to_type, to_ref)):
            if mtype != "w":
                self._add(r.id, Defect.NOT_A_HIGHWAY, f"{label} member is a {mtype}")
                return
            if ref not in self.index.nodes:
                self._add(r.id, Defect.MEMBER_ABSENT, f"{label} way {ref} not a highway here")
                return

        self._check_via(r.id, roles["via"], from_ref, to_ref)

    def _check_via(self, rel_id: int, via: list[tuple[str, int]],
                   from_ref: int, to_ref: int) -> None:
        """The via must actually join the from way to the to way."""
        from_nodes = self.index.nodes[from_ref]
        to_nodes = self.index.nodes[to_ref]

        if via[0][0] == "n":
            node = via[0][1]
            if node not in from_nodes:
                self._add(rel_id, Defect.VIA_NOT_CONNECTED,
                          f"via node {node} is not on from way {from_ref}")
            if node not in to_nodes:
                self._add(rel_id, Defect.VIA_NOT_CONNECTED,
                          f"via node {node} is not on to way {to_ref}")
            return

        # A via way chain: from must touch the first, to must touch the last, and
        # consecutive via ways must share an endpoint.
        via_ways = [ref for mtype, ref in via if mtype == "w"]
        missing = [w for w in via_ways if w not in self.index.ends]
        if missing:
            self._add(rel_id, Defect.MEMBER_ABSENT, f"via way(s) absent: {missing}")
            return
        if not (from_nodes & self.index.nodes[via_ways[0]]):
            self._add(rel_id, Defect.VIA_NOT_CONNECTED,
                      f"from way {from_ref} does not touch via way {via_ways[0]}")
        if not (to_nodes & self.index.nodes[via_ways[-1]]):
            self._add(rel_id, Defect.VIA_NOT_CONNECTED,
                      f"to way {to_ref} does not touch via way {via_ways[-1]}")
        for a, b in zip(via_ways, via_ways[1:]):
            if not (self.index.nodes[a] & self.index.nodes[b]):
                self._add(rel_id, Defect.VIA_NOT_CONNECTED,
                          f"via ways {a} and {b} are not connected")

    def _add(self, rel_id: int, defect: Defect, detail: str) -> None:
        self.findings.append(Finding(rel_id, defect, detail))


def validate(path: Path) -> list[Finding]:
    index = WayIndex()
    index.apply_file(str(path))
    logger.info("indexed %d highway way(s)", len(index.nodes))

    validator = RestrictionValidator(index)
    validator.apply_file(str(path))

    by_defect: dict[Defect, int] = defaultdict(int)
    for finding in validator.findings:
        by_defect[finding.defect] += 1
    affected = len({f.relation for f in validator.findings})
    logger.info("%d restriction(s) checked, %d affected (%.1f%%)",
                validator.checked, affected, 100 * affected / max(validator.checked, 1))
    for defect, count in sorted(by_defect.items(), key=lambda kv: -kv[1]):
        logger.info("  %-22s %5d", defect.value, count)
    return validator.findings
```

## Step-by-step walkthrough

`WayIndex` stores each highway way's full node set as a `frozenset`, not just its endpoints. Connectivity for a `via` node is a membership test anywhere along the way — a restriction at a mid-block junction is perfectly normal — so endpoints alone would report thousands of false positives.

The relation handler returns early after a missing member. Everything downstream dereferences `roles["from"][0]`, and continuing past a missing role turns a clear finding into an `IndexError` on a subset of the data.

The `restriction:` prefix fallback catches conditional and mode-specific forms such as `restriction:hgv=no_left_turn`, which are valid and would otherwise be reported as missing.

The `only_*` cardinality check is separate from the `from` check because the rules genuinely differ. Several `to` members are legitimate on a `no_*` restriction — one prohibition covering several departures — and contradictory on an `only_*`, which by definition names the single permitted exit.

`_check_via` handles both forms the specification allows. The node form is the common one; the way-chain form appears at dual-carriageway junctions and roundabouts, and it needs the chain to be connected end to end, which is the check most validators omit.

## Verification

Cross-check against a router's own view, which is the only end-to-end confirmation:

```bash
# Build a graph and ask it how many restrictions it accepted.
osrm-extract -p car.lua country.osm.pbf 2>&1 | grep -i 'restriction'
```

The count OSRM reports as usable should be close to your valid count. A large gap in either direction means one of you is interpreting the specification differently, and finding out which is worth the hour.

Then confirm a known-good and a known-bad case by hand:

```python
findings = validate(Path("country.osm.pbf"))
by_relation = {f.relation: f for f in findings}
assert KNOWN_GOOD_RELATION not in by_relation
assert by_relation[KNOWN_BROKEN_RELATION].defect is Defect.VIA_NOT_CONNECTED
```

Finally, watch the rate rather than the count. A defect rate that jumps between extracts usually means the extract was cut differently — a `complete_ways` cut drops relation members and manufactures `MEMBER_ABSENT` findings that say nothing about the map.

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Thousands of `member_absent` findings | Extract cut with `complete_ways` | Re-cut with `smart` |
| False `via_not_connected` at mid-block junctions | Only way endpoints indexed | Index the full node set |
| `IndexError` on some relations | Continued past a missing member | Return early after `MISSING_MEMBER` |
| `restriction:hgv` reported as unknown | Prefix form not handled | Fall back to `restriction:*` keys |
| Memory blows up on a continent | Every way indexed, not just highways | Filter to `highway` in pass 1 |
| Router accepts fewer than you validate | Router requires more, e.g. no `via` ways | Compare against the router's own rules |

## Frequently Asked Questions

<details>
<summary>Should a broken restriction be repaired automatically?</summary>

No. Every defect here is ambiguous in the direction that matters: a via node not on the from way could mean the wrong node, the wrong way, or a junction that has since been re-drawn, and picking one makes a routing rule up. Report them, and fix them upstream in the map — this is a case for the Osmose or JOSM path in [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/) rather than for a pipeline repair.
</details>

<details>
<summary>What about no_u_turn on a single way?</summary>

Legitimate and common: `from` and `to` are the same way, with a `via` node at the end where the turn would happen. The validator above handles it because it never assumes `from` and `to` differ. A check that rejects same-way restrictions produces a large false-positive rate on any urban extract.
</details>

<details>
<summary>Do restriction relations need the members to be in order?</summary>

No — roles carry the meaning, and member order is not significant for `from`, `via` and `to`. Order does matter *within* a multi-way `via` chain in practice, because a chain listed out of order is much harder to validate, but the specification does not require it and the connectivity check above does not depend on it.
</details>

<details>
<summary>How does this relate to connectivity checking?</summary>

They are complementary and catch different things. The component analysis in [Finding Disconnected Road Network Components](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/finding-disconnected-road-network-components/) finds places a router cannot reach at all; this finds places it can reach in ways it should not. A network can be perfectly connected and full of unenforced restrictions.
</details>

## Specification reference

> A turn restriction is a relation tagged `type=restriction` with a `restriction` value from the `no_*` and `only_*` families, optionally suffixed by transport mode as `restriction:hgv` and similar. It requires exactly one member with role `from`, exactly one with role `to`, and a `via` member that is either one node or an ordered, connected sequence of ways. `only_*` values permit exactly one `to`.

## Related

- [Routing-Graph Topology QA](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/) — the topic this check belongs to.
- [Finding Disconnected Road Network Components](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/finding-disconnected-road-network-components/) — the complementary connectivity check.
- [Node, Way & Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) — the relation model being validated.
- [Choosing complete_ways vs smart in osmium extract](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/osm-extract-clipping-and-boundaries/choosing-complete-ways-vs-smart-in-osmium-extract/) — why the cut strategy changes the results.
- [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/) — getting these fixed in the map rather than in your copy.

Up one level: [Routing-Graph Topology QA](https://www.osm-data-processing.org/osm-data-quality-validation/routing-graph-topology-qa/).
