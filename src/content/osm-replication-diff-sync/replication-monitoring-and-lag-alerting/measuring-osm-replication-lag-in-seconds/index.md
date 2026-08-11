---
title: "Measuring OSM Replication Lag in Seconds"
description: "Compute how far behind upstream an OSM extract is: parsing state.txt correctly, the timezone and escaped-colon traps, monotonic versus wall clocks, and what a healthy lag distribution looks like."
pageTitle: "Measure OSM Replication Lag in Seconds"
pageDescription: "A correct lag calculation for an OSM diff-sync pipeline — aware UTC parsing, unescaping state.txt, monotonic heartbeats, and reading the resulting distribution."
slug: measuring-osm-replication-lag-in-seconds
type: article
breadcrumb: "Measuring Replication Lag"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Measuring OSM Replication Lag in Seconds

Answer the question "how old is my copy of OpenStreetMap" as a number of seconds, correctly, including the week the clocks change.

## Prerequisites

- [ ] A diff-sync pipeline that records the sequence it has applied, as in [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/)
- [ ] The replication base URL for the stream you follow
- [ ] Python 3.11+ (for `datetime.fromisoformat` accepting a `Z` suffix directly)
- [ ] Outbound HTTPS to the replication server

## Conceptual minimum

Four clocks are involved and only two of them are available to you.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="lag-clocks-t lag-clocks-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="lag-clocks-t">The four timestamps involved in a replication lag calculation</title>
  <desc id="lag-clocks-d">A four-stage chain of clocks. The diff timestamp records when the edits were cut and is carried in the applied state.txt. The publish time is when the file appeared upstream and is not recorded anywhere. The apply time is when you ingested it, from your own clock. Now is the moment the question is asked, always as an aware UTC value.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="clk" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four clocks, and only one of them is yours</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">diff timestamp</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">when the edits were cut</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">in the applied state.txt</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#clk)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">publish time</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">when the file appeared</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">not recorded anywhere</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#clk)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">apply time</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">when you ingested it</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">your own clock</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#clk)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">now</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">the moment you ask</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">aware UTC, always</text>
  <text x="440" y="158" text-anchor="middle" font-size="9.0" fill="currentColor" opacity="0.85">Data age is now minus the first clock. Pipeline delay is the third minus the second. Confusing the two is how a healthy pipeline gets blamed for an upstream stall.</text>
</svg>
<figcaption>Data age is now minus the diff timestamp; pipeline delay is apply time minus publish time. Only the first is computable from what the stream gives you.</figcaption>
</figure>

The number worth reporting is **data age**: now, minus the timestamp of the newest diff you have applied. It answers what a consumer cares about and it degrades under every failure — a stopped loop, a slow loop, and an upstream stall alike. The number people often compute instead is the gap between sequence numbers, which is useful for a different question and reads as zero during an upstream stall.

The timestamp itself comes from the `state.txt` that accompanies the diff you applied, and that file has one quirk worth knowing before writing any parsing code: it is a Java properties file, so the colons inside the ISO timestamp are backslash-escaped.

```text
#Mon Aug 11 00:00:02 UTC 2026
sequenceNumber=6123456
timestamp=2026-08-11T00\:00\:00Z
```

<figure class="diagram-wrap">
<svg viewBox="0 0 880 251" role="img" aria-labelledby="lag-traps-t lag-traps-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="lag-traps-t">Three timestamp handling mistakes in a lag calculation</title>
  <desc id="lag-traps-d">Three panels. A naive datetime from datetime.now with no timezone compared against a UTC stamp is off by the UTC offset and changes by an hour twice a year; the fix is datetime.now with timezone.utc. Unescaped colons: state.txt backslash-escapes the colons in its timestamp, so fromisoformat raises or a regex mis-parses; the fix is to unescape first. Wall clock for elapsed time: time.time deltas go backwards across an NTP step, giving negative ages or an alert that never fires; the fix is time.monotonic.</desc>
  <rect x="0" y="0" width="880" height="251" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Three ways the same calculation goes wrong</text>
  <rect x="26" y="52" width="258" height="157" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Naive datetime</text>
  <text x="40" y="104" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">datetime.now()` — no tzinfo</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Compared against a UTC stamp</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Off by the UTC offset</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Changes by an hour twice a year</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Fix: `datetime.now(timezone.utc)</text>
  <rect x="310" y="52" width="258" height="157" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="439" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Unescaped colons</text>
  <text x="324" y="104" font-size="10.0" fill="currentColor" opacity="0.92">state.txt writes `2026-08-11T00\:00\:00Z</text>
  <text x="324" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Colons are backslash-escaped</text>
  <text x="324" y="146" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">fromisoformat` raises on it</text>
  <text x="324" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Or worse, a regex silently mis-parses</text>
  <text x="324" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Fix: replace `\\:` with `:` first</text>
  <rect x="594" y="52" width="258" height="157" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="723" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Wall clock for elapsed</text>
  <text x="608" y="104" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">time.time()` deltas for heartbeat</text>
  <text x="608" y="125" font-size="10.5" fill="currentColor" opacity="0.92">NTP steps make it go backwards</text>
  <text x="608" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Negative ages, or never alerting</text>
  <text x="608" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Only affects elapsed, not absolute</text>
  <text x="608" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Fix: `time.monotonic()</text>
  <text x="440" y="235" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">All three produce a number. None raises in the common case, and two of them are only wrong for part of the year.</text>
</svg>
<figcaption>Two of the three are seasonal. They work through testing, through the first deployment, and then produce a wrong number the week the clocks change.</figcaption>
</figure>

## Runnable solution

```python
#!/usr/bin/env python3
"""Compute OSM replication lag for a locally applied sequence."""
from __future__ import annotations

import logging
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

BASE_URL = "https://planet.osm.org/replication/minute/"


@dataclass(frozen=True)
class State:
    sequence: int
    timestamp: datetime          # always aware, always UTC


def parse_state(text: str) -> State:
    """Parse an Osmosis state.txt. Colons in the timestamp are backslash-escaped."""
    fields: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        fields[key.strip()] = value.strip().replace("\\:", ":")
    stamp = datetime.fromisoformat(fields["timestamp"].replace("Z", "+00:00"))
    if stamp.tzinfo is None:                      # belt and braces: never return naive
        stamp = stamp.replace(tzinfo=timezone.utc)
    return State(sequence=int(fields["sequenceNumber"]), timestamp=stamp)


def sequence_path(sequence: int) -> str:
    """6123456 → '006/123/456' — the path is computed, never listed."""
    padded = f"{sequence:09d}"
    return f"{padded[0:3]}/{padded[3:6]}/{padded[6:9]}"


def fetch_state(url: str, timeout: float = 10.0) -> State:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return parse_state(response.read().decode("utf-8"))


def lag_seconds(applied_sequence: int, base_url: str = BASE_URL) -> dict[str, float]:
    """Data age, upstream age and sequence lag, computed from one pair of fetches."""
    head = fetch_state(f"{base_url}state.txt")
    applied = fetch_state(f"{base_url}{sequence_path(applied_sequence)}.state.txt")
    now = datetime.now(timezone.utc)
    result = {
        "data_age_seconds": (now - applied.timestamp).total_seconds(),
        "upstream_age_seconds": (now - head.timestamp).total_seconds(),
        "sequence_lag": float(head.sequence - applied.sequence),
    }
    logger.info(
        "applied seq %d (%s) · head seq %d (%s) · data age %.0f s",
        applied.sequence, applied.timestamp.isoformat(),
        head.sequence, head.timestamp.isoformat(),
        result["data_age_seconds"],
    )
    return result


class Heartbeat:
    """Elapsed time since the last success, measured on a clock that cannot go backwards."""

    def __init__(self) -> None:
        self._last = time.monotonic()

    def beat(self) -> None:
        self._last = time.monotonic()

    @property
    def age_seconds(self) -> float:
        return time.monotonic() - self._last


if __name__ == "__main__":
    print(lag_seconds(applied_sequence=6_123_456))
```

## Step-by-step walkthrough

`parse_state` does the unescaping before anything else touches the value, which is the only place that quirk needs to be known. Everything downstream receives an aware UTC `datetime` and cannot reintroduce the problem. The defensive `tzinfo is None` branch exists because a state file with a timestamp lacking its `Z` — rare, but present on some mirrors — would otherwise return a naive value that poisons every comparison made with it.

`sequence_path` reproduces the three-level directory arithmetic described in [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/). Fetching the applied sequence's own `state.txt` rather than remembering its timestamp locally is deliberate: it removes any possibility of the recorded timestamp disagreeing with the sequence, at the cost of one HTTP request.

`lag_seconds` returns three numbers from one consistent moment. Computing them from a single `now` matters more than it looks — calling `datetime.now()` separately for each would let the values disagree slightly and, on a slow link, noticeably.

`Heartbeat` uses `time.monotonic` rather than `time.time`. Elapsed-time measurements taken from the wall clock go backwards when NTP steps the clock, which yields a negative age and, depending on the comparison, either a spurious alert or an alert that can never fire again.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 282" role="img" aria-labelledby="lag-normal-t lag-normal-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="lag-normal-t">Four lag readings from one day of a healthy pipeline</title>
  <desc id="lag-normal-d">A bar chart of observed timestamp lag in seconds. The median is 47 seconds, one diff cut and applied. During a nightly reindex the lag reaches 210 seconds, a known scheduled dip. After a twenty-minute outage the lag peaks at 1240 seconds and returns to normal within six minutes. An upstream publishing gap shows 900 seconds with nothing wrong locally.</desc>
  <rect x="0" y="0" width="880" height="282" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What the number looks like when it is right</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">one minutely-synced country extract, values sampled every minute for a day</text>
  <line x1="250" y1="68" x2="250" y2="228" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">median lag</text>
  <rect x="250" y="74" width="18" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="278" y="89" font-size="11" fill="currentColor" opacity="0.9">47 s — a diff, cut and applied</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">during a nightly reindex</text>
  <rect x="250" y="116" width="80" height="21" rx="3" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="340" y="131" font-size="11" fill="currentColor" opacity="0.9">210 s — a known, scheduled dip</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">after a 20-minute outage</text>
  <rect x="250" y="158" width="470" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="868" y="173" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">1 240 s peak, back to normal in 6 min</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">upstream publish gap</text>
  <rect x="250" y="200" width="341" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="601" y="215" font-size="11" fill="currentColor" opacity="0.9">900 s — nothing wrong locally</text>
  <text x="440" y="264" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.85">Knowing the shape of your own normal is the whole point of measuring: three of these four are healthy, and only the sustained version of any of them is not.</text>
</svg>
<figcaption>Three of these four readings come from a pipeline behaving correctly. Thresholds that do not account for them page someone on a Tuesday for nothing.</figcaption>
</figure>

## Verification

Run it against a pipeline you know to be current and expect a data age comparable to the cadence — under two minutes on a minutely stream. Then verify the failure directions rather than only the happy path:

```bash
# Data age should rise roughly one second per second while the loop is stopped.
systemctl stop osm-diff-sync.timer
sleep 300 && python3 lag.py     # expect ~300 s more than before
systemctl start osm-diff-sync.timer
```

Two assertions are worth keeping as tests. The parsed timestamp must be timezone-aware, which catches the naive-datetime regression the moment someone simplifies the parser. And data age must never be negative: a negative value means either a clock skew on your host or a checkpoint recording a sequence that has not been applied, and both deserve to fail loudly.

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Lag off by exactly one or two hours | Naive `datetime.now()` compared with a UTC stamp | Use `datetime.now(timezone.utc)` |
| `ValueError: Invalid isoformat string` | Colons still backslash-escaped | Unescape `\:` before parsing |
| Lag changes by an hour overnight in spring | Local time used somewhere in the chain | Keep everything aware and in UTC |
| Occasional negative heartbeat age | `time.time()` used for elapsed | Use `time.monotonic()` |
| Lag reads zero while data is stale | Sequence lag reported instead of data age | Report the timestamp difference |
| 404 fetching the applied state | Sequence padded to the wrong width | Pad to nine digits, split 3/3/3 |

## Frequently Asked Questions

<details>
<summary>Why fetch the applied sequence's state.txt instead of storing its timestamp?</summary>

Because the stored value can drift from the sequence it claims to describe — after a manual intervention, a partial restore, or a bug in the checkpoint write. Fetching it means the timestamp is by definition the one belonging to that sequence. The cost is one small HTTP request per measurement, which is negligible next to the diff fetches the loop already makes.
</details>

<details>
<summary>What is a normal lag on the minutely stream?</summary>

Between about thirty and ninety seconds for a healthy pipeline, with a long right tail from publishing jitter. Anything below thirty seconds means you are fetching faster than the stream publishes, and anything sustained above a few minutes means the loop is not keeping up. Measure your own distribution over a month before choosing thresholds.
</details>

<details>
<summary>Should the lag include the time my own processing takes?</summary>

That depends on what you promise consumers. Data age as computed here measures the age of the edits in your database. If downstream artefacts — tiles, a routing graph — are rebuilt on a slower cadence, their age is later still, and a consumer of those needs the age of the artefact, not of the database row. Measure both if both are published.
</details>

<details>
<summary>Can I compute lag without any network access?</summary>

Partly. Now minus the applied diff's timestamp is computable from local state alone, provided the timestamp was recorded alongside the sequence at apply time. What needs the network is the upstream head, and without it you cannot distinguish your pipeline falling behind from the stream having stopped.
</details>

## Where to compute it

The measurement can live in three places and the choice affects what it can detect.

Inside the loop, computed at the end of each iteration, it is cheapest and most accurate — the applied sequence is already in hand and no extra state file read is needed. Its weakness is that it stops being computed exactly when the loop stops, which is the moment you most want a number. A gauge frozen at a healthy value is indistinguishable from a healthy pipeline unless the alerting rule also treats staleness of the metric itself as a fault.

In a sidecar process reading the same checkpoint, it keeps reporting when the loop dies, which turns a silent freeze into a visibly rising number. The cost is a second reader of the checkpoint, which is safe for a file written by atomic rename and is not safe for one written in place — another reason the checkpoint-writing discipline in [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/) matters beyond crash safety.

In a remote prober that only knows the public artefact — the timestamp embedded in a published file, or an endpoint your service exposes — it measures what a consumer actually experiences, including any delay between the database being current and the artefact being rebuilt. It cannot distinguish which stage is behind, so it complements the other two rather than replacing them.

Most pipelines want the sidecar as the primary source and, if anything is published externally, a remote prober as the check that the promise made to consumers is being kept.

## Related

- [Replication Monitoring & Lag Alerting](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/) — the topic this measurement feeds.
- [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) — the state.txt format and the path arithmetic.
- [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/) — the loop that produces the applied sequence.
- [Finding the Replication Sequence for a Timestamp](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/finding-the-replication-sequence-for-a-timestamp/) — the inverse lookup, with the same timezone trap.
- [Scheduling OSM Diff Sync with systemd Timers](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/scheduling-osm-diff-sync-with-systemd-timers/) — where the heartbeat comes from.

Up one level: [Replication Monitoring & Lag Alerting](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/).
