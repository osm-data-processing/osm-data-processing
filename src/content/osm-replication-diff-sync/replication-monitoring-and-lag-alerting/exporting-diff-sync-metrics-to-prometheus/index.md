---
title: "Exporting Diff-Sync Metrics to Prometheus"
description: "Expose OSM replication health as Prometheus metrics: choosing types whose silence is visible, keeping the scrape free of network I/O, and bounding label cardinality."
pageTitle: "Export OSM Diff-Sync Metrics to Prometheus"
pageDescription: "A Prometheus exporter for an OSM replication loop — gauge, counter and histogram choices, an absolute heartbeat timestamp, and a /metrics endpoint that never fetches upstream."
slug: "exporting-diff-sync-metrics-to-prometheus"
type: "article"
breadcrumb: "Metrics to Prometheus"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Exporting Diff-Sync Metrics to Prometheus

Expose the health of an OSM replication loop as Prometheus metrics, with types whose silence is visible and a `/metrics` endpoint that never touches the network.

## Prerequisites

- [ ] A diff-sync loop that computes lag, as in [Measuring OSM Replication Lag in Seconds](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/measuring-osm-replication-lag-in-seconds/)
- [ ] Python 3.10+ with `prometheus_client`
- [ ] A Prometheus server able to reach the loop host
- [ ] A decision about which streams and regions this process is responsible for

## Conceptual minimum

Two design choices decide whether these metrics are useful during an incident: the type of each metric, and where the work happens.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 318" role="img" aria-labelledby="prom-types-t prom-types-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="prom-types-t">Metric types for replication signals and how each behaves when the exporter stops</title>
  <desc id="prom-types-d">A grid of five metrics. Sequence lag and timestamp lag are gauges and freeze at whatever healthy value they last held when the exporter stops. Last-success as an absolute epoch gauge visibly ages because now minus it keeps growing. Diffs applied is a counter whose rate falls to zero. Apply duration is a histogram that simply receives no new observations.</desc>
  <rect x="0" y="0" width="880" height="318" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Metric type decides what an alert rule can say</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">type</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">what a stopped exporter looks like</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">sequence lag</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">Gauge</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">frozen at a healthy value</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">timestamp lag</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">Gauge</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">frozen at a healthy value</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">last success (epoch)</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">Gauge, absolute time</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">visibly ages — now minus it grows</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">diffs applied</text>
  <rect x="213" y="204" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">Counter</text>
  <rect x="535" y="204" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">rate() falls to zero</text>
  <text x="198" y="264" text-anchor="end" font-size="11.5" fill="currentColor">apply duration</text>
  <rect x="213" y="244" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="371" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">Histogram</text>
  <rect x="535" y="244" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="264" text-anchor="middle" font-size="10.5" fill="currentColor">no new observations</text>
  <text x="440" y="300" text-anchor="middle" font-size="10.0" fill="currentColor" opacity="0.85">Two of these five go quiet in a way that reads as healthy. Exporting the heartbeat as an absolute timestamp rather than an age is what fixes it.</text>
</svg>
<figcaption>A gauge that stops updating is indistinguishable from a gauge that is fine. Pick types whose silence is visible.</figcaption>
</figure>

The type matters because of how each behaves when the thing producing it dies. A gauge holds its last value forever, so a lag gauge from a crashed process reads as a perfectly healthy number until someone notices the series is stale. A counter's `rate()` falls to zero, which is visible. And an absolute timestamp gauge — "the unix time of the last successful iteration" rather than "seconds since" — keeps degrading because the alert expression subtracts it from `time()`, which keeps moving even when the process does not.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="prom-flow-t prom-flow-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="prom-flow-t">Where the upstream fetch belongs relative to the metrics endpoint</title>
  <desc id="prom-flow-d">A four-stage chain. The loop iteration fetches state.txt once, the only outbound call. It then updates the registry in process, setting gauges and incrementing counters in microseconds. The metrics endpoint renders from memory with no I/O. Prometheus scrapes it every thirty seconds, so many replicas cost one upstream fetch per loop iteration rather than one per scrape.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="prm" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Scrape must never reach the network</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">loop iteration</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">fetch state.txt once</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">the only outbound call</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#prm)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">update the registry</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">set gauges, inc counters</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">in-process, microseconds</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#prm)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">/metrics</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">render from memory</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">no I/O of any kind</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#prm)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">Prometheus</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">scrapes every 30 s</text>
  <text x="761" y="122" text-anchor="middle" font-size="8.5" fill="currentColor" opacity="0.8">many replicas, one upstream fetch</text>
  <text x="440" y="158" text-anchor="middle" font-size="9.0" fill="currentColor" opacity="0.85">Ten replicas scraped every fifteen seconds is 2 400 requests an hour. If the scrape triggers the upstream fetch, that load lands on a shared community server.</text>
</svg>
<figcaption>The rule is simple and easy to violate by accident: the collector reads memory, the loop reads the network.</figcaption>
</figure>

The second choice is where the upstream fetch lives. Computing lag requires reading the stream's `state.txt`, and it is tempting to do that inside the collector so the number is always fresh. Do not: a scrape is triggered by Prometheus, on its schedule, from potentially several servers, and hooking it to an outbound HTTP request turns your monitoring into load on a shared community server. The loop already fetches `state.txt` once per iteration for its own purposes; publish that.

## Runnable solution

```python
#!/usr/bin/env python3
"""Prometheus metrics for an OSM diff-sync loop. The collector never does I/O."""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

from prometheus_client import Counter, Gauge, Histogram, start_http_server

logger = logging.getLogger(__name__)

LABELS = ["stream", "region"]

# Gauges: current state. Fine here because the heartbeat below makes staleness visible.
SEQ_LAG = Gauge("osm_replication_sequence_lag",
                "Upstream head sequence minus the locally applied sequence", LABELS)
TS_LAG = Gauge("osm_replication_timestamp_lag_seconds",
               "Age in seconds of the newest applied diff", LABELS)
UPSTREAM_AGE = Gauge("osm_replication_upstream_age_seconds",
                     "Age in seconds of the newest diff the stream has published", LABELS)
APPLIED_SEQ = Gauge("osm_replication_applied_sequence",
                    "The sequence number currently applied locally", LABELS)

# Absolute timestamp, not an age: an expression of time() - this keeps growing
# after the process dies, which is exactly what an alert needs.
LAST_SUCCESS = Gauge("osm_replication_last_success_timestamp_seconds",
                     "Unix time of the last successful loop iteration", LABELS)

# Counters: their rate() falls to zero when work stops.
DIFFS_APPLIED = Counter("osm_replication_diffs_applied_total",
                        "Diffs successfully applied", LABELS)
DIFF_FAILURES = Counter("osm_replication_diff_failures_total",
                        "Diffs that failed to apply", LABELS + ["reason"])

APPLY_SECONDS = Histogram("osm_replication_apply_duration_seconds",
                          "Wall-clock time to apply one diff", LABELS,
                          buckets=(0.5, 1, 2, 5, 10, 30, 60, 120, 300))


class ReplicationMetrics:
    """Owns the label values for one stream/region pair."""

    def __init__(self, stream: str, region: str) -> None:
        self.labels = {"stream": stream, "region": region}

    def observe_state(self, applied_seq: int, applied_ts: datetime,
                      head_seq: int, head_ts: datetime) -> None:
        """Called once per loop iteration, after the loop has already fetched state.txt."""
        now = datetime.now(timezone.utc)
        SEQ_LAG.labels(**self.labels).set(head_seq - applied_seq)
        TS_LAG.labels(**self.labels).set((now - applied_ts).total_seconds())
        UPSTREAM_AGE.labels(**self.labels).set((now - head_ts).total_seconds())
        APPLIED_SEQ.labels(**self.labels).set(applied_seq)

    def observe_apply(self, seconds: float) -> None:
        APPLY_SECONDS.labels(**self.labels).observe(seconds)
        DIFFS_APPLIED.labels(**self.labels).inc()

    def observe_failure(self, reason: str) -> None:
        """`reason` must come from a small fixed set — it is a label."""
        DIFF_FAILURES.labels(**self.labels, reason=reason).inc()

    def heartbeat(self) -> None:
        LAST_SUCCESS.labels(**self.labels).set(time.time())


FAILURE_REASONS = frozenset({"fetch", "decompress", "apply", "checkpoint", "lock"})


def classify(exc: Exception) -> str:
    """Map an exception to one of a fixed set of reasons, so the label stays bounded."""
    name = type(exc).__name__.lower()
    if "url" in name or "http" in name or "timeout" in name:
        return "fetch"
    if "zlib" in name or "gzip" in name or "eof" in name:
        return "decompress"
    if "lock" in name or "blocking" in name:
        return "lock"
    return "apply"


if __name__ == "__main__":
    start_http_server(9187)          # serves /metrics from the in-process registry
    metrics = ReplicationMetrics(stream="minute", region="ireland")
    logger.info("metrics endpoint listening on :9187")
    # ... the loop calls observe_state / observe_apply / heartbeat as it runs ...
```

Wiring it into the loop, with the ordering that matters:

```python
def iteration(metrics: ReplicationMetrics) -> None:
    head = fetch_head()                       # the ONE outbound call per iteration
    applied = read_checkpoint()
    metrics.observe_state(applied.sequence, applied.timestamp, head.sequence, head.timestamp)
    if head.sequence <= applied.sequence:
        metrics.heartbeat()                   # nothing to do is still a successful iteration
        return
    started = time.monotonic()
    try:
        apply_diff(applied.sequence + 1)
        write_checkpoint(applied.sequence + 1)
    except Exception as exc:
        metrics.observe_failure(classify(exc))
        raise
    metrics.observe_apply(time.monotonic() - started)
    metrics.heartbeat()
```

## Step-by-step walkthrough

`observe_state` takes the head values as arguments rather than fetching them. That single decision is what keeps the collector I/O-free — the loop has already paid for the fetch, and the metrics layer is a consumer of that result rather than a second caller.

`heartbeat` is called on the "nothing to do" path as well as the success path. A loop that finds itself already current has had a successful iteration, and omitting the heartbeat there means a pipeline that has caught up looks dead within minutes.

`classify` exists to keep the `reason` label bounded. Using `str(exc)` as a label value seems convenient and creates a new time series for every distinct error message, including ones containing sequence numbers and URLs.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 251" role="img" aria-labelledby="prom-labels-t prom-labels-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="prom-labels-t">Three candidate labels and their cardinality consequences</title>
  <desc id="prom-labels-d">Three panels. A stream label with values such as minute or hour is bounded at two or three values and is necessary because a host syncing two regions has two independent lags. A region label is bounded by your own deployment and lets one alert rule cover all regions. A sequence label carrying the identifier is unbounded, creating a new time series every minute and destroying the time-series database within days.</desc>
  <rect x="0" y="0" width="880" height="251" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Labels: the ones worth having and the one that will hurt</text>
  <rect x="26" y="52" width="258" height="157" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">stream</text>
  <text x="40" y="104" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">stream="minute"` / `"hour"</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Bounded: two or three values</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">A host syncing two regions</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">has two independent lags</text>
  <text x="40" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Without it they merge into nonsense</text>
  <rect x="310" y="52" width="258" height="157" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="439" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">region</text>
  <text x="324" y="104" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">region="ireland"</text>
  <text x="324" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Bounded by your own deployment</text>
  <text x="324" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Lets one alert rule cover all</text>
  <text x="324" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Keep it to deployed regions,</text>
  <text x="324" y="188" font-size="10.5" fill="currentColor" opacity="0.92">not to every region that exists</text>
  <rect x="594" y="52" width="258" height="157" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.5"/>
  <text x="723" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">sequence</text>
  <text x="608" y="104" font-size="10.0" font-family="monospace" fill="currentColor" opacity="0.92">sequence="6123456"</text>
  <text x="608" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Unbounded — new value every minute</text>
  <text x="608" y="146" font-size="10.5" fill="currentColor" opacity="0.92">A new time series per minute</text>
  <text x="608" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Kills the TSDB within days</text>
  <text x="608" y="188" font-size="10.5" fill="currentColor" opacity="0.92">Never label with an id</text>
  <text x="440" y="235" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Cardinality is the one Prometheus mistake that is expensive to undo, because the damage is in the storage rather than in the code.</text>
</svg>
<figcaption>Labels are dimensions, not data. Anything that takes a new value on every observation belongs in the metric value or in a log line.</figcaption>
</figure>

`APPLY_SECONDS` uses explicit buckets because the defaults are tuned for HTTP request latency and put almost everything in the top bucket for a job measured in seconds. Buckets should straddle the values you actually see and the value you would alert on.

## Verification

Scrape it by hand and read the output — the shape tells you most of what you need:

```bash
curl -s localhost:9187/metrics | grep '^osm_replication'
```

Three things to check. Every series carries both labels; a series with empty label values means `.labels()` was called with positional arguments in the wrong order. `osm_replication_last_success_timestamp_seconds` is a large number close to the current unix time, not a small number of seconds. And `osm_replication_diffs_applied_total` increases between two scrapes taken a minute apart on a live loop.

Then confirm the endpoint is genuinely inert:

```bash
# Watch outbound connections while scraping repeatedly.
for i in $(seq 20); do curl -s localhost:9187/metrics >/dev/null; done &
ss -tnp | grep -c planet.osm.org        # expect 0
```

Any outbound connection attributable to the scrape means the collector is doing work it should not.

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Lag looks healthy while the loop is dead | Gauge frozen at its last value | Alert on `time() - last_success_timestamp` |
| Prometheus memory grows steadily | Sequence number or error text used as a label | Bound every label to a fixed set |
| `/metrics` slow or timing out | Collector performs an HTTP fetch | Publish values the loop already computed |
| Two regions merged into one series | Labels omitted | Label by stream and region from the start |
| Counter resets on every scrape | New registry created per request | One module-level registry for the process |
| Histogram is all in the `+Inf` bucket | Default buckets, seconds-scale data | Set buckets that straddle real values |

## Frequently Asked Questions

<details>
<summary>Should the loop and the metrics endpoint be the same process?</summary>

They can be, and it is simpler, but it has the weakness that a crashed loop takes the endpoint with it — Prometheus then reports the target as down, which is actionable but tells you nothing about how far behind the data is. A small sidecar that reads the same checkpoint keeps reporting a rising lag while the loop is dead, which is a more informative failure. If you run only one, run it in-process and alert on target-down as well as on lag.
</details>

<details>
<summary>Why a counter for diffs applied when the sequence number is already a gauge?</summary>

They answer different questions. The gauge says where you are; the counter says whether you are moving. `rate(osm_replication_diffs_applied_total[5m])` going to zero is a clean signal that survives restarts and does not depend on knowing what a healthy sequence number looks like today.
</details>

<details>
<summary>What scrape interval makes sense?</summary>

Thirty seconds is fine and fifteen is unnecessary. The underlying data changes once a minute at best, so scraping faster than the loop iterates just stores duplicate samples. What matters more is that the scrape interval is comfortably shorter than the alerting window, so a rule with a five-minute `for` clause has several samples to work with.
</details>

<details>
<summary>Should I export per-diff timings or just the total?</summary>

The histogram is worth its cost. When lag starts rising the first question is whether each diff got slower or whether more diffs arrived, and a duration histogram answers it immediately. A single total gives you neither.
</details>

## Specification reference

> Prometheus metric types: a **Gauge** may go up and down and holds its last value; a **Counter** only increases and resets to zero on process restart, which client libraries and `rate()` handle; a **Histogram** samples observations into configurable buckets. Label values form part of the time-series identity, so the number of series is the product of the cardinalities of all labels.

## Related

- [Replication Monitoring & Lag Alerting](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/) — the topic this exporter serves.
- [Measuring OSM Replication Lag in Seconds](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/measuring-osm-replication-lag-in-seconds/) — where these numbers come from.
- [Alerting on a Stalled OSM Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/alerting-on-a-stalled-osm-update-pipeline/) — the rules that consume these series.
- [Building a Minutely Update Pipeline](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/) — the loop being instrumented.
- [Scheduling OSM Diff Sync with systemd Timers](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/scheduling-osm-diff-sync-with-systemd-timers/) — the unit whose failures show up in the counter.

Up one level: [Replication Monitoring & Lag Alerting](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/).
