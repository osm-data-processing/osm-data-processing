---
title: "Replication Monitoring & Lag Alerting"
description: "Instrument an OSM diff-sync pipeline: sequence lag, timestamp lag and heartbeat signals, what each one misses, threshold selection from observed data, and the end-to-end checks that catch a silently no-op loop."
pageTitle: "Monitoring OSM Replication Lag and Alerting on It"
pageDescription: "Measure OSM diff-sync health properly — sequence lag, timestamp lag, loop heartbeat and data-level checks — and set alert thresholds from your own observed distribution."
slug: replication-monitoring-and-lag-alerting
type: guide
breadcrumb: "Monitoring & Lag Alerting"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Replication Monitoring & Lag Alerting

A diff-sync pipeline is unusually good at failing quietly. The loop described in [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/) runs every minute, writes a log line every minute, and exits zero every minute, and none of that says whether the data it manages is current. A pipeline whose lock is permanently held, whose upstream stream has stalled, or whose apply step silently no-ops will produce exactly the same log stream as a healthy one. The gap between "the process is running" and "the data is fresh" is where replication incidents live, and closing it is a monitoring problem rather than a coding one.

This topic sets out what to measure, where each measurement is blind, how to choose thresholds that survive an ordinary day, and how to wire the result into an alerting system without producing an alert people mute. It assumes the sequence-number model from [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) — every signal below is derived from that integer and its timestamp.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="mon-points-t mon-points-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mon-points-t">The four places a replication pipeline can be measured</title>
  <desc id="mon-points-d">A four-stage chain of measurement points. Upstream: the head sequence and its timestamp, from one HTTP fetch of state.txt. Local state: the applied sequence and its timestamp, read from the checkpoint. The process: the time of the last successful iteration, a heartbeat. The data: row counts and spot checks, which is the only end-to-end signal.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="mon" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four measurements, taken at four different places in the loop</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">upstream</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">head sequence + its time</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">one HTTP GET of state.txt</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#mon)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">local state</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">applied sequence + its time</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">read the checkpoint</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#mon)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">the process</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">last successful iteration</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">a heartbeat timestamp</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#mon)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">the data</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">row counts, spot checks</text>
  <text x="761" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">the only end-to-end signal</text>
  <text x="440" y="158" text-anchor="middle" font-size="10.0" fill="currentColor" opacity="0.85">Three of these can look healthy while the fourth is wrong, which is why a replication dashboard with one number on it is a dashboard that lies.</text>
</svg>
<figcaption>Instrument all four. Each answers a question the others cannot, and the failure that costs you a week is always the one measured by the signal you skipped.</figcaption>
</figure>

## Prerequisite concepts

Two things need to be in place before any of this is measurable. The checkpoint must be readable from outside the loop, because a metrics exporter that has to interrupt the pipeline to ask its state will eventually interrupt it at the wrong moment; a state file or a database row satisfies this and an in-memory variable does not. And the upstream stream has to be identified, because sequence lag is meaningless without knowing which `state.txt` the local sequence should be compared against — which is exactly the `osmosis_replication_base_url` header discussed in [PBF File Structure Deep Dive](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/pbf-file-structure-deep-dive/).

## The four signals

**Sequence lag** is the upstream head sequence minus the locally applied sequence. It is an integer, it is exact, and it is the best measure of whether the loop is keeping up. Its blind spot is that both terms come from the same conceptual place: if the upstream stream stops advancing, the local sequence catches up to it and the lag falls to zero while the data grows steadily staler.

**Timestamp lag** is the current wall-clock time minus the timestamp of the most recently applied diff. It catches the upstream stall that sequence lag misses, and it is the number that actually answers "how old is my data". Its cost is noise: replication files are not published on an exact cadence, so this signal has a naturally wide distribution.

**Loop heartbeat** is the time since the last successful iteration. It catches a crashed, wedged or lock-blocked process, and it says nothing at all about correctness — a loop spinning fast and applying nothing has a perfect heartbeat.

**Data-level checks** are row counts, object counts by type, and spot checks of known objects against the live API. They are the only end-to-end signal, they are the most expensive, and they are the only thing that catches a loop that is healthy by every other measure and wrong.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 318" role="img" aria-labelledby="mon-matrix-t mon-matrix-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mon-matrix-t">Reading the three replication signals together to identify the fault</title>
  <desc id="mon-matrix-d">A grid of five pipeline states against the three signals. Healthy shows sequence lag of nought to two, timestamp lag under two minutes and a fresh heartbeat. A stopped loop shows all three degraded. An upstream stall shows sequence lag at zero, which is misleading, timestamp lag rising and a fresh heartbeat. A loop slower than the stream shows both lags rising slowly with a fresh heartbeat. A loop that runs fast but applies nothing shows all three healthy, which is why row counts and API spot checks are needed.</desc>
  <rect x="0" y="0" width="880" height="318" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">One symptom, four different causes — the signal pair tells them apart</text>
  <text x="317" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">sequence lag</text>
  <text x="531" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">timestamp lag</text>
  <text x="745" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">heartbeat</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">everything healthy</text>
  <rect x="213" y="84" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="317" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">0–2</text>
  <rect x="427" y="84" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="531" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">under 2 min</text>
  <rect x="641" y="84" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="745" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">fresh</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">loop stopped</text>
  <rect x="213" y="124" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="317" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">rising fast</text>
  <rect x="427" y="124" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="531" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">rising fast</text>
  <rect x="641" y="124" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="745" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">stale</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">upstream stream stalled</text>
  <rect x="213" y="164" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="317" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">0 — misleading</text>
  <rect x="427" y="164" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="531" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">rising</text>
  <rect x="641" y="164" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="745" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">fresh</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">loop slower than the stream</text>
  <rect x="213" y="204" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="317" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">rising slowly</text>
  <rect x="427" y="204" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="531" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">rising slowly</text>
  <rect x="641" y="204" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="745" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">fresh</text>
  <text x="198" y="264" text-anchor="end" font-size="11.0" fill="currentColor">loop fast but applying nothing</text>
  <rect x="213" y="244" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="317" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">0 — misleading</text>
  <rect x="427" y="244" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="531" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">0 — misleading</text>
  <rect x="641" y="244" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="745" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">fresh</text>
  <text x="440" y="300" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">The last row is the dangerous one: every replication signal reads healthy, and only a row count or a spot check against the API reveals it.</text>
</svg>
<figcaption>No single row is diagnosable from one signal. The pair of sequence lag at zero with timestamp lag rising is the fingerprint of an upstream problem, and it is the one people misdiagnose as their own.</figcaption>
</figure>

The matrix is the reason to export all three cheap signals rather than picking one. Read individually each is ambiguous; read together they identify the fault.

## Computing the signals

```python
import logging
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

STATE_URL = "https://planet.osm.org/replication/minute/state.txt"


@dataclass(frozen=True)
class ReplicationState:
    sequence: int
    timestamp: datetime


def parse_state(text: str) -> ReplicationState:
    """Parse an Osmosis state.txt. Colons in the timestamp are backslash-escaped."""
    fields: dict[str, str] = {}
    for line in text.splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        fields[key.strip()] = value.strip().replace("\\:", ":")
    return ReplicationState(
        sequence=int(fields["sequenceNumber"]),
        timestamp=datetime.fromisoformat(fields["timestamp"].replace("Z", "+00:00")),
    )


def fetch_head(url: str = STATE_URL, timeout: float = 10.0) -> ReplicationState:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return parse_state(response.read().decode("utf-8"))


def signals(local: ReplicationState, last_success_monotonic: float) -> dict[str, float]:
    """The three cheap signals, computed together so they are always consistent."""
    head = fetch_head()
    now = datetime.now(timezone.utc)
    out = {
        "sequence_lag": head.sequence - local.sequence,
        "timestamp_lag_seconds": (now - local.timestamp).total_seconds(),
        "heartbeat_age_seconds": time.monotonic() - last_success_monotonic,
        "upstream_age_seconds": (now - head.timestamp).total_seconds(),
    }
    logger.info("replication signals: %s", out)
    return out
```

The fourth value, `upstream_age_seconds`, is what makes the upstream-stall case unambiguous. When it rises alongside timestamp lag while sequence lag stays at zero, the problem is not yours, and knowing that in the first minute of an incident rather than the fortieth is worth the extra HTTP field.

Note the `monotonic` clock for the heartbeat. Wall-clock time goes backwards across an NTP correction, and a heartbeat computed from it will occasionally report a negative age and, depending on the comparison, either alert or never alert again.

## Choosing thresholds

<figure class="diagram-wrap">
<svg viewBox="0 0 880 324" role="img" aria-labelledby="mon-thresholds-t mon-thresholds-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mon-thresholds-t">Observed lag distribution and where to put the thresholds</title>
  <desc id="mon-thresholds-d">A bar chart of timestamp lag on a minutely stream over thirty days. The median is 47 seconds, the 95th percentile 96 seconds and the 99th percentile 184 seconds, the last reflecting normal publishing jitter. A warning threshold is placed at 600 seconds and a paging threshold at 1800 seconds, both well above the observed distribution.</desc>
  <rect x="0" y="0" width="880" height="324" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Alert thresholds that survive a normal day</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">minutely stream, observed distribution over 30 days</text>
  <line x1="250" y1="68" x2="250" y2="270" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">p50 timestamp lag</text>
  <rect x="250" y="74" width="12" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="272" y="89" font-size="11" fill="currentColor" opacity="0.9">47 s — normal</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">p95</text>
  <rect x="250" y="116" width="25" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="285" y="131" font-size="11" fill="currentColor" opacity="0.9">96 s — still normal</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">p99</text>
  <rect x="250" y="158" width="48" height="21" rx="3" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="308" y="173" font-size="11" fill="currentColor" opacity="0.9">184 s — publishing jitter</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">warn threshold</text>
  <rect x="250" y="200" width="157" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="417" y="215" font-size="11" fill="currentColor" opacity="0.9">600 s — investigate</text>
  <text x="240" y="257" text-anchor="end" font-size="11.5" fill="currentColor">page threshold</text>
  <rect x="250" y="242" width="470" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="730" y="257" font-size="11" fill="currentColor" opacity="0.9">1 800 s — 30 min behind</text>
  <text x="440" y="306" text-anchor="middle" font-size="10.0" fill="currentColor" opacity="0.85">Setting the warning at p99 produces roughly fourteen pages a day from ordinary publishing jitter, which is how a replication alert gets muted.</text>
</svg>
<figcaption>Derive thresholds from a month of your own data rather than from the cadence. A minutely stream does not publish every sixty seconds, and an alert that assumes it does will fire on the stream being normal.</figcaption>
</figure>

Thresholds derived from the nominal cadence are wrong in both directions. A minutely stream does not publish every sixty seconds; publication jitter routinely pushes the observed lag past three minutes with nothing wrong. Setting a warning at two minutes produces a pager that fires on normal operation, and the reliable consequence of that is a muted alert channel.

Collect thirty days of the signal, take the observed distribution, and place the warning threshold comfortably above the 99th percentile and the paging threshold at the point where the staleness genuinely matters to a consumer. For most pipelines those are two very different numbers, and the gap between them is the useful part: a warning that a human looks at during working hours, and a page that means a downstream system is serving stale data.

One threshold should not be derived from the distribution at all. Sequence lag has a hard meaning — anything above a handful means the loop is not keeping up — and a fixed threshold of five is appropriate regardless of what the last month looked like.

## Validation and error-handling matrix

| Condition | Signal pattern | Root cause | Action |
|---|---|---|---|
| Data stale, all signals green | lag 0, heartbeat fresh | Apply step is a no-op | Compare row counts; check the lock |
| Sequence lag 0, timestamp lag rising | upstream age rising too | Upstream stream stalled | Wait; alert at a longer threshold |
| Both lags rising in step | heartbeat fresh | Loop slower than the stream | Batch diffs, or move to hourly |
| Heartbeat stale, lags frozen | last iteration long ago | Process crashed or lock held | Restart; inspect the lock holder |
| Lag negative | local sequence ahead of head | Checkpoint written before apply | Rebuild — the checkpoint is lying |
| Alerts fire nightly at the same time | lag spikes on a schedule | A competing job saturates I/O | Stagger the schedule |

The negative-lag row deserves attention because it is a symptom of the checkpoint-ordering bug described in [Recovering from a Replication Sequence Gap](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/recovering-from-a-replication-sequence-gap/). A local sequence ahead of the published head cannot happen through normal operation; it means the checkpoint records work that was never done, and no amount of replaying will fix it.

## Performance and scale considerations

The metrics themselves are cheap: one HTTP fetch of a file under two hundred bytes, one read of a state file, and some arithmetic. The only real cost is the upstream fetch, and the only real risk is doing it too often. Scraping `state.txt` every fifteen seconds from a fleet of hosts is a meaningful load on the replication server and gains nothing over a per-minute fetch on a stream that publishes per minute. Fetch once per loop iteration, cache the result for the exporter, and never let the metrics endpoint trigger a fetch of its own — a scrape storm should not become an outbound request storm.

Data-level checks are the expensive ones and should be scheduled rather than continuous. An hourly count of rows by feature class against the previous hour is enough to catch a no-op loop within an hour, and costs one aggregate query.

## Failure modes and gotchas

The most common instrumentation bug is exporting a metric from inside the loop only on the success path. When the loop starts failing, the metric stops being updated, and a gauge that stops updating looks — to most alerting systems — exactly like a gauge holding a healthy value. Export from a separate path that runs regardless of outcome, or use a metric type where staleness is visible, and always alert on the absence of data as well as on its value.

A second is timezone handling in the timestamp comparison. `state.txt` timestamps are UTC with a trailing `Z`; comparing them against a naive local `datetime` produces a lag that is wrong by the UTC offset and, in a location with summer time, changes by an hour twice a year. Parse to an aware UTC datetime and compare against `datetime.now(timezone.utc)`.

Third, alerting on the derivative rather than the value catches problems earlier but fires on catch-up: after a legitimate outage the lag falls rapidly, and a rate-of-change alert will interpret recovery as an anomaly. Alert on the value; use the derivative for dashboards.

## Integration points

The signals belong in whatever the rest of the platform uses. For Prometheus, expose them as gauges from the loop process; for a push-based system, emit them at the end of each iteration. Either way the metric names should distinguish the stream, because a host syncing two regions has two independent lags and one alert that merges them is unactionable.

```python
from prometheus_client import Gauge

SEQ_LAG = Gauge("osm_replication_sequence_lag", "Head sequence minus applied sequence", ["stream"])
TS_LAG = Gauge("osm_replication_timestamp_lag_seconds", "Age of the newest applied diff", ["stream"])
HEARTBEAT = Gauge("osm_replication_last_success_timestamp", "Unix time of the last good iteration", ["stream"])

def publish(stream: str, values: dict[str, float], last_success_epoch: float) -> None:
    SEQ_LAG.labels(stream).set(values["sequence_lag"])
    TS_LAG.labels(stream).set(values["timestamp_lag_seconds"])
    HEARTBEAT.labels(stream).set(last_success_epoch)
```

Exporting the heartbeat as an absolute timestamp rather than an age is deliberate: a timestamp that stops advancing is unambiguous to an alerting rule, whereas an age gauge that stops updating holds whatever value it had when the process died.

## Dashboards versus alerts

The signals above serve two audiences with opposite needs, and building one artefact for both produces something neither can use.

An alert exists to interrupt someone, so it must be unambiguous, actionable and rare. That argues for very few alerting rules — realistically two: timestamp lag beyond a threshold that matters to a consumer, and a heartbeat that has stopped. Everything else is context that helps once someone is already looking.

A dashboard exists to be read while nothing is wrong, so it can afford to be dense and can show things that are interesting rather than actionable. The rate of change of lag, the distribution of per-diff apply durations, the size of each diff, and the ratio of creates to modifies to deletes all belong here. None of them should page anyone, and all of them shorten an investigation, because the first question in any replication incident is what changed and the dashboard is where that is visible.

The pairing worth building deliberately is an alert that links to the dashboard filtered to the affected stream. It sounds like a small thing and it is the difference between an on-call engineer starting from a symptom and starting from a picture.

## In this section

- [Measuring OSM Replication Lag in Seconds](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/measuring-osm-replication-lag-in-seconds/) — the lag calculation itself, including the timezone and escaped-colon traps.

## Frequently Asked Questions

<details>
<summary>Which single metric should I alert on if I can only have one?</summary>

Timestamp lag. It is the only one of the three cheap signals that answers the question a consumer actually cares about — how old is this data — and it degrades under both a stalled loop and a stalled upstream. It is noisier than sequence lag, so set the threshold from an observed distribution rather than from the nominal cadence.
</details>

<details>
<summary>Why is my sequence lag zero while the data is clearly stale?</summary>

Two possibilities, and the upstream timestamp distinguishes them. If the upstream head timestamp is also old, the replication stream itself has stopped publishing and there is nothing for you to do but wait. If the upstream head is current and your applied sequence somehow equals it, your checkpoint is being advanced without the diffs being applied — check whether the apply step is silently exiting on a held lock.
</details>

<details>
<summary>How often should the pipeline fetch state.txt?</summary>

Once per loop iteration, and never from the metrics endpoint. A minutely loop fetching once a minute is proportionate; a fleet of exporters each fetching on every scrape is not, and it turns a monitoring system into a source of load on a shared community server.
</details>

<details>
<summary>Should replication lag page someone at night?</summary>

Only if a downstream consumer is genuinely harmed by data that is thirty minutes old. For most analytics workloads it is not, and the right configuration is a warning that is picked up in the morning. Reserve paging for pipelines feeding something with a real-time contract, and set the threshold at the point that contract breaks.
</details>

<details>
<summary>Do I need data-level checks if the three cheap signals are green?</summary>

Yes, at a low frequency. The one failure mode that all three cheap signals miss — a loop that runs, commits and applies nothing — is also the one that goes unnoticed longest. An hourly row-count comparison is enough to bound the damage to an hour, and costs one aggregate query.
</details>

## Related

- [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/) — the section this monitoring layer watches.
- [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/) — the loop that produces these signals.
- [Replication Sequence Numbers & State Tracking](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/) — the checkpoint every signal is derived from.
- [Recovering from a Replication Sequence Gap](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/recovering-from-a-replication-sequence-gap/) — what to do when the lag says something is wrong.
- [Scheduling OSM Diff Sync with systemd Timers](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/scheduling-osm-diff-sync-with-systemd-timers/) — the unit model that supplies the heartbeat.
- [Applying .osc Change Files with osmium](https://www.osm-data-processing.org/osm-replication-diff-sync/applying-osc-change-files-with-osmium/) — the apply step whose silence these signals detect.

Up one level: [OSM Replication & Diff Sync](https://www.osm-data-processing.org/osm-replication-diff-sync/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Which single OSM replication metric should I alert on?",
      "acceptedAnswer": { "@type": "Answer", "text": "Timestamp lag. It is the only cheap signal that answers how old the data is, and it degrades under both a stalled loop and a stalled upstream. It is noisier than sequence lag, so set the threshold from an observed distribution rather than from the nominal cadence." }
    },
    {
      "@type": "Question",
      "name": "Why is my OSM sequence lag zero while the data is stale?",
      "acceptedAnswer": { "@type": "Answer", "text": "Two possibilities, distinguished by the upstream timestamp. If the upstream head timestamp is also old, the replication stream has stopped publishing. If the upstream head is current and your applied sequence equals it, your checkpoint is being advanced without the diffs being applied, so check whether the apply step is exiting silently on a held lock." }
    },
    {
      "@type": "Question",
      "name": "How often should an OSM pipeline fetch state.txt?",
      "acceptedAnswer": { "@type": "Answer", "text": "Once per loop iteration, and never from the metrics endpoint. A minutely loop fetching once a minute is proportionate; a fleet of exporters fetching on every scrape turns a monitoring system into a source of load on a shared community server." }
    },
    {
      "@type": "Question",
      "name": "Should OSM replication lag page someone at night?",
      "acceptedAnswer": { "@type": "Answer", "text": "Only if a downstream consumer is genuinely harmed by data thirty minutes old. For most analytics workloads it is not, and a warning picked up in the morning is the right configuration. Reserve paging for pipelines feeding something with a real-time contract." }
    },
    {
      "@type": "Question",
      "name": "Do I need data-level checks if replication signals are green?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes, at low frequency. The failure mode all three cheap signals miss, a loop that runs and commits but applies nothing, is the one that goes unnoticed longest. An hourly row-count comparison bounds the damage to an hour and costs one aggregate query." }
    }
  ]
}
</script>
