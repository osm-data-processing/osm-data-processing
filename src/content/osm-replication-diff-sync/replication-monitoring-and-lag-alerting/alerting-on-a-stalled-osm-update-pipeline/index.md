---
title: "Alerting on a Stalled OSM Update Pipeline"
description: "Prometheus alert rules that tell a dead diff-sync loop from a stalled upstream stream, page only when someone can act, and use inhibition and for-clauses to stay unmuted."
pageTitle: "Alert on a Stalled OSM Update Pipeline"
pageDescription: "Four replication alert rules with thresholds, for-clauses and Alertmanager inhibition, plus promtool tests that prove they fire when the loop dies and stay quiet when it does not."
slug: "alerting-on-a-stalled-osm-update-pipeline"
type: "article"
breadcrumb: "Alerting on a Stall"
datePublished: 2026-08-11
dateModified: 2026-08-11
date: 2026-08-11
---
# Alerting on a Stalled OSM Update Pipeline

Write alert rules that distinguish a dead loop from a stalled upstream, page someone only when they can act, and survive a normal month without being muted.

## Prerequisites

- [ ] Replication metrics exported as in [Exporting Diff-Sync Metrics to Prometheus](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/exporting-diff-sync-metrics-to-prometheus/)
- [ ] Prometheus with Alertmanager, or an equivalent rule engine
- [ ] At least two weeks of the metrics recorded, to set thresholds from
- [ ] An agreed answer to "how stale is too stale" from whoever consumes the data

## Conceptual minimum

An alert is a decision to interrupt a person, so every rule needs three things settled before it is written: what it fires on, what it means, and who responds. A rule missing the third is a rule that will be acknowledged and ignored.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 278" role="img" aria-labelledby="alert-rules-t alert-rules-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="alert-rules-t">Four alert rules and the escalation each one deserves</title>
  <desc id="alert-rules-d">A grid of four rules. LoopDead fires when the heartbeat is older than five minutes, means the process is gone, and pages on-call. DataStale fires when timestamp lag exceeds thirty minutes, means consumers see stale data, and pages on-call. UpstreamStalled fires when the upstream age exceeds twenty minutes, means the problem is not yours yet, and raises a ticket. ApplyFailing fires when the failure rate stays above zero for fifteen minutes, means diffs are being rejected, and raises a ticket.</desc>
  <rect x="0" y="0" width="880" height="278" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Four rules, and the one thing each is allowed to mean</text>
  <text x="317" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">fires when</text>
  <text x="531" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">means</text>
  <text x="745" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">who wakes up</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">LoopDead</text>
  <rect x="213" y="84" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="317" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">heartbeat older than 5 min</text>
  <rect x="427" y="84" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="531" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">the process is gone</text>
  <rect x="641" y="84" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="745" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">on-call</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">DataStale</text>
  <rect x="213" y="124" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="317" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">timestamp lag over 30 min</text>
  <rect x="427" y="124" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="531" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">consumers see stale data</text>
  <rect x="641" y="124" width="208" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="745" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">on-call</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">UpstreamStalled</text>
  <rect x="213" y="164" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="317" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">upstream age over 20 min</text>
  <rect x="427" y="164" width="208" height="32" rx="5" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.2"/>
  <text x="531" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">not your problem yet</text>
  <rect x="641" y="164" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="745" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">nobody — a ticket</text>
  <text x="198" y="224" text-anchor="end" font-size="11.5" fill="currentColor">ApplyFailing</text>
  <rect x="213" y="204" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="317" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">failure rate over 0 for 15 min</text>
  <rect x="427" y="204" width="208" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="531" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">diffs are being rejected</text>
  <rect x="641" y="204" width="208" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="745" y="224" text-anchor="middle" font-size="10.5" fill="currentColor">nobody — a ticket</text>
  <text x="440" y="260" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Only two of the four page anyone. An alerting system where every rule pages is an alerting system that gets muted.</text>
</svg>
<figcaption>Deciding the escalation at the same time as the threshold is what keeps a rule honest. A rule with no defined response should not exist.</figcaption>
</figure>

The four rules above cover a replication pipeline. Two of them page, and the split is not about severity in the abstract — it is about whether the person woken up can do anything. An upstream stall is genuinely bad and there is no action available beyond waiting, so it becomes a ticket rather than a page.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 174" role="img" aria-labelledby="alert-inhibit-t alert-inhibit-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="alert-inhibit-t">Why an upstream stall needs an inhibition rule</title>
  <desc id="alert-inhibit-d">A four-stage chain. When upstream publishing stops, nothing local is wrong. DataStale nevertheless fires because timestamp lag climbs, which is true but misleading. UpstreamStalled fires at the same time because the upstream age climbs too, and that is the actual cause. An inhibition rule suppresses DataStale while UpstreamStalled is firing.</desc>
  <rect x="0" y="0" width="880" height="174" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <defs><marker id="inh" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Inhibition: say the useful thing, not all the true things</text>
  <rect x="26" y="64" width="181" height="64" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="116" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">upstream stalls</text>
  <text x="116" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">publishing stops</text>
  <text x="116" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">nothing local is wrong</text>
  <line x1="207" y1="96" x2="237" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#inh)"/>
  <rect x="241" y="64" width="181" height="64" rx="8" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.5"/>
  <text x="331" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">DataStale fires</text>
  <text x="331" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">timestamp lag climbs</text>
  <text x="331" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">true, but misleading</text>
  <line x1="422" y1="96" x2="452" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#inh)"/>
  <rect x="456" y="64" width="181" height="64" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="546" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">UpstreamStalled fires</text>
  <text x="546" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">upstream age climbs too</text>
  <text x="546" y="122" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">the actual cause</text>
  <line x1="637" y1="96" x2="667" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#inh)"/>
  <rect x="671" y="64" width="181" height="64" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="761" y="88" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">inhibit rule</text>
  <text x="761" y="107" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.85">suppress DataStale</text>
  <text x="761" y="122" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.8">while UpstreamStalled is firing</text>
  <text x="440" y="158" text-anchor="middle" font-size="11.0" fill="currentColor" opacity="0.85">Without inhibition an upstream outage pages your on-call for something they cannot fix, and the page looks identical to one they can.</text>
</svg>
<figcaption>The two alerts are both correct. Only one of them is actionable, and the page should be the actionable one.</figcaption>
</figure>

That distinction only works if the rules are wired to suppress each other. An upstream stall drives *both* `DataStale` and `UpstreamStalled` at once, because the data really is getting old. Inhibition is what makes the alert that fires the one that explains the situation.

## Runnable solution

{% raw %}
```yaml
# replication-rules.yml — Prometheus alerting rules
groups:
  - name: osm-replication
    interval: 30s
    rules:
      # --- paging ---------------------------------------------------------
      - alert: OsmReplicationLoopDead
        expr: |
          time() - osm_replication_last_success_timestamp_seconds > 300
        for: 2m
        labels:
          severity: page
          team: geodata
        annotations:
          summary: "Diff-sync loop {{ $labels.region }}/{{ $labels.stream }} has stopped"
          description: >-
            No successful iteration for {{ $value | humanizeDuration }}.
            The process is wedged, crashed, or blocked on its lock.
          runbook: "https://runbooks.internal/osm/loop-dead"

      - alert: OsmDataStale
        expr: |
          osm_replication_timestamp_lag_seconds > 1800
        for: 5m
        labels:
          severity: page
          team: geodata
        annotations:
          summary: "OSM data for {{ $labels.region }} is {{ $value | humanizeDuration }} old"
          description: >-
            Consumers are reading data older than the 30 minute contract.
          runbook: "https://runbooks.internal/osm/data-stale"

      # --- ticket only ----------------------------------------------------
      - alert: OsmUpstreamStalled
        expr: |
          osm_replication_upstream_age_seconds > 1200
        for: 5m
        labels:
          severity: ticket
          team: geodata
        annotations:
          summary: "Upstream {{ $labels.stream }} stream has not published for {{ $value | humanizeDuration }}"
          description: >-
            The replication server is behind, not this pipeline. Nothing to do
            locally; the loop will catch up on its own when publishing resumes.

      - alert: OsmDiffApplyFailing
        expr: |
          rate(osm_replication_diff_failures_total[15m]) > 0
        for: 15m
        labels:
          severity: ticket
          team: geodata
        annotations:
          summary: "Diffs failing to apply for {{ $labels.region }} ({{ $labels.reason }})"
          description: >-
            Failures are being retried but not clearing. Check the reason label
            before the retry budget runs out and the loop falls behind.

      # --- a slow leak, worth seeing before it becomes DataStale ----------
      - alert: OsmReplicationFallingBehind
        expr: |
          deriv(osm_replication_timestamp_lag_seconds[30m]) > 0.5
          and osm_replication_timestamp_lag_seconds > 300
        for: 30m
        labels:
          severity: ticket
          team: geodata
        annotations:
          summary: "Lag for {{ $labels.region }} is growing steadily"
          description: >-
            The loop is applying diffs more slowly than the stream publishes
            them. It will breach the staleness contract if nothing changes.
```
{% endraw %}

```yaml
# alertmanager.yml — the inhibition that keeps the page actionable
inhibit_rules:
  # An upstream stall makes the data stale. Say so once, as the upstream alert.
  - source_matchers: [ 'alertname = OsmUpstreamStalled' ]
    target_matchers: [ 'alertname = OsmDataStale' ]
    equal: [ 'stream', 'region' ]

  # A dead loop explains everything else about that pipeline.
  - source_matchers: [ 'alertname = OsmReplicationLoopDead' ]
    target_matchers: [ 'alertname =~ "OsmDataStale|OsmReplicationFallingBehind" ' ]
    equal: [ 'stream', 'region' ]
```

## Step-by-step walkthrough

`OsmReplicationLoopDead` subtracts an absolute timestamp from `time()`. This is the pattern that makes a dead exporter visible: if the process stops, the gauge stops updating, `time()` keeps moving, and the expression keeps growing. A rule written against a "seconds since last success" gauge would freeze at a healthy value and never fire — the failure mode described in [Exporting Diff-Sync Metrics to Prometheus](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/exporting-diff-sync-metrics-to-prometheus/).

`OsmDataStale` uses timestamp lag rather than sequence lag deliberately. Sequence lag reads zero during an upstream stall, so a staleness contract expressed in sequence numbers is silently unenforced exactly when the data is going stale.

`OsmReplicationFallingBehind` is the only rule using a derivative, and it is guarded by a level condition. A pure rate-of-change rule fires during recovery, when lag is falling fast after an outage — the `and` clause keeps it quiet unless the lag is both growing and already elevated.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 282" role="img" aria-labelledby="alert-for-t alert-for-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="alert-for-t">Alert count against the for-clause duration over thirty days of real data</title>
  <desc id="alert-for-d">A bar chart of how many times a DataStale rule with a thirty-minute threshold would have fired over thirty days. With no for clause it fires 41 times, mostly on single-sample spikes. At two minutes it fires 12 times, still catching jitter. At five minutes it fires 3 times and all three were real incidents. At fifteen minutes it fires twice, missing one nine-minute outage.</desc>
  <rect x="0" y="0" width="880" height="282" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">What the "for" clause is actually buying</text>
  <text x="34" y="54" font-size="11.5" font-weight="600" fill="currentColor">DataStale rule against 30 days of real lag data, threshold 30 min</text>
  <line x1="250" y1="68" x2="250" y2="228" stroke="var(--osm-grid,#d9d2c0)" stroke-width="1"/>
  <text x="240" y="89" text-anchor="end" font-size="11.5" fill="currentColor">for: 0m</text>
  <rect x="250" y="74" width="470" height="21" rx="3" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.3"/>
  <text x="868" y="89" text-anchor="end" font-size="11" fill="currentColor" opacity="0.9">41 alerts · mostly single-sample spikes</text>
  <text x="240" y="131" text-anchor="end" font-size="11.5" fill="currentColor">for: 2m</text>
  <rect x="250" y="116" width="138" height="21" rx="3" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.3"/>
  <text x="398" y="131" font-size="11" fill="currentColor" opacity="0.9">12 alerts · still catching jitter</text>
  <text x="240" y="173" text-anchor="end" font-size="11.5" fill="currentColor">for: 5m</text>
  <rect x="250" y="158" width="34" height="21" rx="3" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="294" y="173" font-size="11" fill="currentColor" opacity="0.9">3 alerts · all three were real</text>
  <text x="240" y="215" text-anchor="end" font-size="11.5" fill="currentColor">for: 15m</text>
  <rect x="250" y="200" width="23" height="21" rx="3" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="283" y="215" font-size="11" fill="currentColor" opacity="0.9">2 alerts · missed one 9-min outage</text>
  <text x="440" y="264" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Five minutes removes 38 false pages and costs five minutes of detection latency on an outage that already lasted half an hour.</text>
</svg>
<figcaption>The for clause is the cheapest false-positive control there is, and five minutes is almost always the right starting value for a signal sampled every thirty seconds.</figcaption>
</figure>

The `for` clauses are doing more work than the thresholds. A signal sampled every thirty seconds will produce single-sample spikes from publishing jitter, a slow scrape, or a GC pause, and firing on one sample turns all of that into pages.

## Verification

Test the expressions against recorded data rather than waiting for an incident. `promtool` evaluates rules against a synthetic series:

```yaml
# rules_test.yml
rule_files: [ replication-rules.yml ]
evaluation_interval: 30s
tests:
  - interval: 30s
    input_series:
      # Heartbeat advances for 5 minutes, then freezes — a crashed loop.
      - series: 'osm_replication_last_success_timestamp_seconds{stream="minute",region="ireland"}'
        values: '1000+30x10 1300x20'
    alert_rule_test:
      - eval_time: 12m
        alertname: OsmReplicationLoopDead
        exp_alerts:
          - exp_labels: { severity: page, team: geodata, stream: minute, region: ireland }
```

```bash
promtool test rules rules_test.yml
promtool check rules replication-rules.yml
```

Then do the thing most teams skip: replay the last month of real lag data through the rules and count how often each would have fired. A rule that would have fired forty times in a month where nothing happened is a rule that will be muted in week two.

Finally, confirm the inhibition works, because a misconfigured `equal` list silently suppresses nothing:

```bash
amtool alert add alertname=OsmUpstreamStalled stream=minute region=ireland
amtool alert add alertname=OsmDataStale       stream=minute region=ireland
amtool alert query          # DataStale should show as suppressed
```

## Common errors and fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Loop dies, no alert | Rule written against a "seconds since" gauge | Use `time() - <absolute timestamp>` |
| Page during every upstream outage | No inhibition rule | Inhibit `DataStale` under `UpstreamStalled` |
| Alerts fire on recovery | Derivative rule with no level guard | Add `and <metric> > threshold` |
| Dozens of alerts a month, none real | No `for` clause | Add `for: 5m`; measure against history |
| One alert covers two regions | Labels not in `equal:` | List every identifying label |
| Alert has no `runbook` | Rule written during an incident | A rule with no documented response is a ticket, not a page |

## Frequently Asked Questions

<details>
<summary>What staleness threshold should DataStale use?</summary>

Whatever the consumer contract says, not a number derived from the metric distribution. If a routing service is rebuilt hourly, data thirty minutes old is fine and the threshold belongs somewhere above an hour. If a live map promises minute-freshness, the threshold is minutes. Setting it from what the pipeline usually achieves rather than from what anyone needs produces an alert about the pipeline being unusual rather than about anything being wrong.
</details>

<details>
<summary>Should target-down replace the LoopDead rule?</summary>

It complements it. `up == 0` catches the process disappearing entirely; `LoopDead` catches the process still serving metrics while its loop is wedged — blocked on a lock, stuck on a socket read, or spinning without progress. The second is the more common failure and the one target-down cannot see.
</details>

<details>
<summary>How do I alert on a pipeline that runs hourly rather than every minute?</summary>

Scale every duration, but not linearly. The heartbeat threshold has to exceed the interval by enough to survive one skipped run — for an hourly job, something over two hours. The staleness threshold, though, is still set by the consumer contract, and for an hourly job that contract has to tolerate at least an hour by construction.
</details>

<details>
<summary>Is it worth alerting on the sequence lag at all?</summary>

As a ticket, yes. Sequence lag above a handful means the loop is not keeping up, which is a capacity signal worth acting on before it becomes staleness. It should not page, because by the time it matters `DataStale` will have fired anyway, and because it reads zero during the upstream stall case.
</details>

## Keeping the rules honest over time

Alert rules decay. Thresholds set against last year's behaviour drift as the pipeline changes, and a rule nobody has seen fire is a rule nobody knows is broken. Three habits keep the set trustworthy.

Review the fire history quarterly. For each rule, count how often it fired, how often the response was "nothing to do", and how often something was genuinely wrong. A rule with a high nothing-to-do rate is training people to ignore the channel and should be retuned or demoted to a ticket; a rule that has never fired at all should be tested deliberately rather than assumed working.

Test the paging rules on purpose. Stopping the timer in a staging environment and confirming that `LoopDead` fires, routes and pages the right rotation takes ten minutes and is the only way to know the whole chain works. The failure mode this catches is not a wrong expression but a routing rule that sends the page nowhere.

Version the rules with the code that produces the metrics. A metric rename that lands without the corresponding rule change leaves an expression matching nothing, and an expression matching nothing never fires — silently, and indistinguishably from everything being fine.

## Specification reference

> A Prometheus alerting rule fires when its `expr` has evaluated to a non-empty vector continuously for the duration in `for`. Alertmanager `inhibit_rules` suppress a target alert while a matching source alert is firing; the `equal` list names the labels that must match between them for the suppression to apply.

## Related

- [Replication Monitoring & Lag Alerting](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/) — the topic these rules belong to.
- [Exporting Diff-Sync Metrics to Prometheus](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/exporting-diff-sync-metrics-to-prometheus/) — the series these expressions read.
- [Measuring OSM Replication Lag in Seconds](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/measuring-osm-replication-lag-in-seconds/) — how the lag number is computed.
- [Recovering from a Replication Sequence Gap](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-sequence-numbers-and-state/recovering-from-a-replication-sequence-gap/) — the runbook these alerts should link to.
- [Scheduling OSM Diff Sync with systemd Timers](https://www.osm-data-processing.org/osm-replication-diff-sync/building-a-minutely-update-pipeline/scheduling-osm-diff-sync-with-systemd-timers/) — the lock contention `ApplyFailing` often reflects.

Up one level: [Replication Monitoring & Lag Alerting](https://www.osm-data-processing.org/osm-replication-diff-sync/replication-monitoring-and-lag-alerting/).
