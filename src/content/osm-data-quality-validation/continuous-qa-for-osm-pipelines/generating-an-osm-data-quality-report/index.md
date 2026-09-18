---
title: "Generating an OSM Data Quality Report"
description: "Turn validation output into a report somebody reads at eight in the morning: the verdict first, the failures ranked by consequence, and enough context to act without re-running anything."
pageTitle: "Writing an OSM Data Quality Report People Act On"
pageDescription: "Produce a machine-readable metrics document and a human-readable report from one pass, lead with the verdict, rank failures by impact and give every finding a next step."
slug: generating-an-osm-data-quality-report
type: article
breadcrumb: "Quality Reports"
datePublished: 2026-09-17
dateModified: 2026-09-17
date: 2026-09-17
---
# Generating an OSM Data Quality Report

A validation run that ends in a hundred lines of log output has technically reported its findings, and in practice has communicated nothing — which is why the report is a deliverable rather than a byproduct.

## Prerequisites

- [ ] Check results with verdicts, per [Setting Quality Thresholds That Fail a Build](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/setting-quality-thresholds-that-fail-a-build/).
- [ ] Python 3.10+; the code below uses only the standard library.
- [ ] Somewhere the report is delivered — a CI summary, an issue, a channel — decided before it is written.
- [ ] Metric history, so a finding can carry its own trend.

## Conceptual minimum

A report has two audiences and they want opposite things.

**A person, in a hurry.** They need the verdict in the first line, the worst thing that happened in the second, and enough context to decide whether to act now or later. Everything else is noise until they have decided that.

**A machine, later.** Trend dashboards, historical comparison and the next run's threshold derivation all read the same run's output, and they need every metric as structured data, not as prose.

Writing these separately means computing everything twice and letting them disagree. The workable shape is **one metrics document, two renderings**: a canonical JSON object produced by the validation pass, and a Markdown rendering generated from it. The JSON is the record; the report is a view. Nothing appears in the report that is not in the JSON, which also means a person can always get the number behind a sentence.

Within the report, ordering carries most of the value. **Rank by consequence, not by check order.** A blocking failure on a critical metric goes first; a warning on something cosmetic goes near the bottom or into a collapsed section. Reports that preserve execution order bury the important finding among the twelve checks that happened to run before it.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 218" role="img" aria-labelledby="qdr1-t qdr1-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="qdr1-t">Two readers, two formats, one source of truth</title>
  <desc id="qdr1-d">Three panels. A person reading in a hurry wants the verdict in the first line, the worst failure next, and a next step for each finding, with everything else collapsed. A machine reading later wants every metric as structured data with stable names, including the ones that passed, because trend analysis and the next run's threshold derivation both read them. Producing these as two independent outputs means computing everything twice and eventually letting them disagree, so the workable shape is one canonical metrics document with the report generated from it as a view.</desc>
  <rect x="0" y="0" width="880" height="218" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Person, machine, and the shared record</text>
  <rect x="26" y="52" width="259" height="132" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">A person, in a hurry</text>
  <text x="40" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Verdict in line one</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Worst failure next</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">A next step each</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Everything else collapsed</text>
  <rect x="311" y="52" width="259" height="132" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="440" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">A machine, later</text>
  <text x="325" y="104" font-size="10.5" fill="currentColor" opacity="0.92">Every metric, structured</text>
  <text x="325" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Stable names</text>
  <text x="325" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Passes included too</text>
  <text x="325" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Feeds the next band</text>
  <rect x="595" y="52" width="259" height="132" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="725" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">One document, two views</text>
  <text x="609" y="104" font-size="10.5" fill="currentColor" opacity="0.92">JSON is the record</text>
  <text x="609" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Markdown is a view</text>
  <text x="609" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Nothing only in prose</text>
  <text x="609" y="167" font-size="10.5" fill="currentColor" opacity="0.92">They cannot disagree</text>
  <text x="868" y="202" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Generating the report from the metrics rather than beside them also guarantees every sentence has a number behind it.</text>
</svg>
<figcaption>The third panel is the only arrangement where the two readers never see different answers.</figcaption>
</figure>

## Runnable solution

```python
from __future__ import annotations

import json
import logging
from collections.abc import Sequence
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("osm.qa.report")

SEVERITY_ORDER = {"blocking": 0, "warning": 1, "info": 2}


@dataclass
class Finding:
    check: str
    severity: str            # blocking | warning | info
    metric: str
    value: float
    expected: str            # human phrasing of the band or floor
    delta_pct: float | None
    next_step: str           # what the reader should do, not what happened
    sample: list[str] = field(default_factory=list)  # a few offending ids


@dataclass
class Run:
    run_id: str
    dataset: str
    sequence: int | None
    started_at: str
    metrics: dict[str, float]
    findings: list[Finding]

    @property
    def blocking(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "blocking"]

    @property
    def verdict(self) -> str:
        if self.blocking:
            return "FAIL"
        return "PASS WITH WARNINGS" if self.findings else "PASS"


def write_metrics(run: Run, path: Path) -> None:
    """The canonical record. The report is generated from this, never beside it."""
    path.write_text(json.dumps({
        "run_id": run.run_id, "dataset": run.dataset,
        "sequence": run.sequence, "started_at": run.started_at,
        "verdict": run.verdict,
        "metrics": run.metrics,
        "findings": [asdict(f) for f in run.findings],
    }, indent=1, sort_keys=True), encoding="utf-8")


def _table(rows: Sequence[Sequence[str]], header: Sequence[str]) -> list[str]:
    out = ["| " + " | ".join(header) + " |",
           "| " + " | ".join("---" for _ in header) + " |"]
    out += ["| " + " | ".join(r) + " |" for r in rows]
    return out


def render(run: Run, history: dict[str, list[float]] | None = None) -> str:
    history = history or {}
    ordered = sorted(run.findings,
                     key=lambda f: (SEVERITY_ORDER[f.severity], -abs(f.delta_pct or 0)))

    lines: list[str] = []
    # Line one is the verdict. Everything else is context for it.
    lines.append(f"# {run.verdict} — {run.dataset}")
    lines.append("")
    lines.append(f"Run `{run.run_id}` at {run.started_at}"
                 + (f", upstream sequence {run.sequence:,}" if run.sequence else ""))
    lines.append("")

    if run.blocking:
        worst = ordered[0]
        lines.append(f"**Blocking:** {worst.check} — {worst.metric} is "
                     f"{worst.value:,.0f}, expected {worst.expected}.")
        lines.append("")
        lines.append(f"**Do this:** {worst.next_step}")
        lines.append("")

    if ordered:
        lines.append("## Findings")
        lines.append("")
        lines += _table(
            [[f.severity, f.check,
              f"{f.value:,.2f}".rstrip("0").rstrip("."),
              f.expected,
              f"{f.delta_pct:+.1f}%" if f.delta_pct is not None else "—",
              f.next_step]
             for f in ordered],
            ["Severity", "Check", "Value", "Expected", "Change", "Next step"])
        lines.append("")

    # Everything that passed goes in a collapsed block: present for the record,
    # absent from the reader's first thirty seconds.
    lines.append("<details>")
    lines.append("<summary>All metrics for this run</summary>")
    lines.append("")
    lines += _table(
        [[name, f"{value:,.2f}".rstrip("0").rstrip("."),
          f"{len(history.get(name, []))} run(s)"]
         for name, value in sorted(run.metrics.items())],
        ["Metric", "Value", "History"])
    lines.append("")
    lines.append("</details>")
    return "\n".join(lines) + "\n"


def emit(run: Run, out_dir: Path, history: dict[str, list[float]] | None = None
         ) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    metrics_path = out_dir / "metrics.json"
    report_path = out_dir / "report.md"
    write_metrics(run, metrics_path)
    report_path.write_text(render(run, history), encoding="utf-8")
    logger.info("%s: %s", run.verdict, report_path)
    return metrics_path, report_path


if __name__ == "__main__":
    example = Run(
        run_id="8821", dataset="bavaria", sequence=6_231_890,
        started_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        metrics={"buildings.count": 2_712_004.0, "geometry.invalid_pct": 0.002},
        findings=[Finding(
            check="building-count-band", severity="blocking",
            metric="buildings.count", value=2_712_004,
            expected="3.9M to 4.3M (14-day median 4.1M)", delta_pct=-33.9,
            next_step="Check the upstream extract size before reprocessing; "
                      "a 34% drop on one region is usually a truncated download.",
            sample=["w118203344", "w118203351"])])
    emit(example, Path("build/qa"))
```

## Step-by-step walkthrough

1. **Put the verdict on line one.** The reader's first decision is whether this needs them now, and burying it behind a preamble costs everyone time.
2. **Lead with the single worst finding.** One blocking failure stated concretely does more than a table of twelve, and the table is still there below.
3. **Write a next step, not a description.** "Building count fell 34 percent" says what happened; "check the upstream extract size before reprocessing" says what to do.
4. **Rank by severity then by magnitude.** Within a severity, the larger deviation is nearly always the more informative one.
5. **Carry the expectation with the value.** A number without its band is unactionable, and re-deriving it means opening another tool.
6. **Include a handful of offending identifiers.** Three examples turn an abstract finding into something a person can open in an editor.
7. **Collapse the full metric list.** It has to be present for the record and absent from the first thirty seconds of reading.
8. **Emit the JSON first.** The report is derived from it, so a rendering bug cannot cost you the run's data.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 176" role="img" aria-labelledby="qdr2-t qdr2-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="qdr2-t">From checks to two artifacts, in the order that keeps them consistent</title>
  <desc id="qdr2-d">Four steps. The validation pass produces findings and a full metric map in memory. The canonical metrics document is written first, as JSON, so a failure while rendering the report cannot lose the run's data. The report is then rendered purely from that document, which guarantees every sentence in it has a number behind it and that the two artifacts can never disagree. Finally the report is delivered to wherever people actually look, whether a continuous integration summary, an issue or a chat channel, while the metrics document is retained as history for the next run's threshold derivation.</desc>
  <defs><marker id="qdr2-a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="currentColor"/></marker></defs>
  <rect x="0" y="0" width="880" height="176" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Metrics first, report derived, both delivered</text>
  <rect x="26" y="62" width="182" height="68" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="117" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">validate</text>
  <text x="117" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">findings and metrics</text>
  <text x="117" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">held in memory</text>
  <line x1="208" y1="96" x2="238" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#qdr2-a)"/>
  <rect x="242" y="62" width="182" height="68" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="332" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">write metrics</text>
  <text x="332" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">JSON, written first</text>
  <text x="332" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">the canonical record</text>
  <line x1="423" y1="96" x2="453" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#qdr2-a)"/>
  <rect x="457" y="62" width="182" height="68" rx="8" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.5"/>
  <text x="548" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">render report</text>
  <text x="548" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">purely from the JSON</text>
  <text x="548" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">cannot disagree</text>
  <line x1="638" y1="96" x2="668" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#qdr2-a)"/>
  <rect x="672" y="62" width="182" height="68" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="763" y="86" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">deliver</text>
  <text x="763" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.88">summary, issue, channel</text>
  <text x="763" y="121" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.82">metrics kept as history</text>
  <text x="868" y="160" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Writing the report first and the metrics afterwards loses the run's data whenever rendering fails, which it eventually will.</text>
</svg>
<figcaption>The order is not stylistic; it decides what survives a bug in the presentation layer.</figcaption>
</figure>

<figure class="diagram-wrap">
<svg viewBox="0 0 880 342" role="img" aria-labelledby="qdr3-t qdr3-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="qdr3-t">What each part of a finding gives the reader</title>
  <desc id="qdr3-d">A grid of five parts of a finding against what the reader learns from it and what its absence costs. The severity tells them whether to act now, and without it every finding competes equally for attention. The value and the expectation together tell them how far out of range the metric is, and a value alone is unactionable because the reader must go and find the band. The percentage change tells them the magnitude at a glance. The next step tells them what to do, and without it the report describes rather than directs. Sample identifiers let them inspect the actual features, and without them the first move is always to re-run something.</desc>
  <rect x="0" y="0" width="880" height="342" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">Five parts, five things the reader gets</text>
  <rect x="194" y="48" width="330" height="30" rx="6" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.3"/>
  <text x="359" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">The reader learns</text>
  <rect x="524" y="48" width="330" height="30" rx="6" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.3"/>
  <text x="689" y="68" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">Without it</text>
  <text x="30" y="105" font-size="11.5" font-weight="600" fill="currentColor">Severity</text>
  <line x1="26" y1="124" x2="854" y2="124" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="359" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">whether to act now</text>
  <text x="689" y="105" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">all findings compete</text>
  <text x="30" y="151" font-size="11.5" font-weight="600" fill="currentColor">Value and expectation</text>
  <line x1="26" y1="170" x2="854" y2="170" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="359" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">how far out of range</text>
  <text x="689" y="151" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">must go find the band</text>
  <text x="30" y="197" font-size="11.5" font-weight="600" fill="currentColor">Percentage change</text>
  <line x1="26" y1="216" x2="854" y2="216" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="359" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">magnitude at a glance</text>
  <text x="689" y="197" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">mental arithmetic</text>
  <text x="30" y="243" font-size="11.5" font-weight="600" fill="currentColor">Next step</text>
  <line x1="26" y1="262" x2="854" y2="262" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="359" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">what to do</text>
  <text x="689" y="243" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">describes, does not direct</text>
  <text x="30" y="289" font-size="11.5" font-weight="600" fill="currentColor">Sample identifiers</text>
  <line x1="26" y1="308" x2="854" y2="308" stroke="currentColor" stroke-width="1" opacity="0.28"/>
  <text x="359" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">what to open first</text>
  <text x="689" y="289" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.92">re-run to investigate</text>
  <text x="868" y="326" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">The fourth row is the one most often missing, and it is the difference between a report that informs and one that resolves.</text>
</svg>
<figcaption>Each part costs a line in the check definition and saves minutes on every read.</figcaption>
</figure>

## Verification

- **The verdict is unambiguous.** Confirm a reader can tell pass from fail without scrolling.
- **The JSON and the report agree.** Change a metric and confirm both outputs move together.
- **Ordering holds.** Inject findings in a scrambled order and confirm the rendered report ranks them correctly.
- **Samples are present.** Confirm each finding carries offending identifiers a person can look up.
- **The report renders where it is delivered.** Check the collapsed block and the table in the actual destination, not only locally.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Nobody reads the report | Verdict buried below a preamble | Put pass or fail on the first line |
| Findings do not lead to action | Descriptions instead of next steps | Give every finding an imperative next step |
| Important failure missed among many | Report ordered by execution | Sort by severity, then by magnitude |
| Report and dashboard disagree | Two independent computations | Render the report from the metrics document |
| Run data lost when rendering fails | Report written before the metrics | Write the JSON first |
| Reader has to re-run to investigate | No sample identifiers included | Attach a few offending identifiers per finding |
| Long report skimmed past | Every passing metric listed inline | Collapse the full list into a details block |

## Specification reference

> GitHub Flavored Markdown renders tables introduced by a header row and a delimiter row, and passes through HTML block elements such as `details` and `summary`, which browsers render as a disclosure widget. A `details` element without the `open` attribute renders collapsed. See the GFM specification for tables, and the HTML standard for the `details` element.

## Frequently Asked Questions

<details>
<summary>Should a passing run produce a report at all?</summary>

A short one, yes. A run that produces nothing when it passes gives no way to distinguish "everything is fine" from "the job did not run", which is the failure mode continuous QA exists to prevent. A single line stating the verdict, the dataset and the metrics document's location costs nothing and makes the absence of a report meaningful.
</details>

<details>
<summary>How much detail belongs in the report versus a linked artifact?</summary>

Anything the reader needs to decide what to do goes in the report. Anything they need to actually do it can be linked — a full list of ten thousand offending identifiers is an artifact, three examples are a report. The test is whether the reader can form a plan without clicking anything; if they cannot, something that belongs inline has been moved out.
</details>

<details>
<summary>Should reports be delivered by email, chat or an issue?</summary>

Wherever the person who will act on it already looks, which is a question about the team rather than the tooling. What matters more than the channel is that a failing run creates something with a state — an issue that can be closed, a thread that can be resolved — because a notification with no state is indistinguishable from one that was already handled.
</details>

<details>
<summary>Should the report include trends as well as the current run?</summary>

A per-finding trend is worth its space: knowing a metric has been drifting for six runs changes the diagnosis entirely compared with a single sudden move. A general trend section is not, because it belongs on a dashboard where somebody can interact with it. The rule of thumb is that trend belongs in the report only where it changes the interpretation of a finding already there.
</details>

## Related

- [Continuous QA for OSM Pipelines](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/) — the parent topic.
- [Setting Quality Thresholds That Fail a Build](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/setting-quality-thresholds-that-fail-a-build/) — where the expectations in each finding come from.
- [Running OSM Validation in GitHub Actions](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/running-osm-validation-in-github-actions/) — the delivery path for this report.
- [Writing Custom OSM Validation Rules in Python](https://www.osm-data-processing.org/osm-data-quality-validation/writing-custom-osm-validation-rules-in-python/) — the checks that produce findings.
- [Monitoring an Area for Suspicious OSM Edits](https://www.osm-data-processing.org/osm-data-quality-validation/changeset-analysis-and-vandalism-detection/monitoring-an-area-for-suspicious-osm-edits/) — a report with a different audience and the same structure.

Up one level: [Continuous QA for OSM Pipelines](https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Generating an OSM Data Quality Report",
  "description": "Turn validation output into a report somebody reads at eight in the morning: the verdict first, the failures ranked by consequence, and enough context to act without re-running anything.",
  "datePublished": "2026-09-17",
  "dateModified": "2026-09-17",
  "articleSection": "OSM Data Quality & Validation",
  "about": ["quality reporting", "actionable findings", "pipeline observability"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Quality & Validation", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/" },
    { "@type": "ListItem", "position": 3, "name": "Continuous QA for OSM Pipelines", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/" },
    { "@type": "ListItem", "position": 4, "name": "Generating an OSM Data Quality Report", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/continuous-qa-for-osm-pipelines/generating-an-osm-data-quality-report/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Generate an actionable OSM data quality report",
  "description": "Write a canonical metrics document first, render the human report from it, lead with the verdict and the worst finding, and give every finding an expectation, a change and a next step.",
  "step": [
    { "@type": "HowToStep", "name": "Write the metrics document first", "text": "Emit the canonical JSON before rendering, so a presentation bug cannot lose the run's data." },
    { "@type": "HowToStep", "name": "Render the report from it", "text": "Generate the Markdown purely from the metrics document so the two can never disagree." },
    { "@type": "HowToStep", "name": "Lead with the verdict", "text": "Put pass or fail on the first line, followed by the single worst finding stated concretely." },
    { "@type": "HowToStep", "name": "Rank by severity and magnitude", "text": "Sort findings by blocking status first, then by the size of the deviation." },
    { "@type": "HowToStep", "name": "Give each finding a next step", "text": "Write an imperative instruction rather than a description of what happened." },
    { "@type": "HowToStep", "name": "Attach sample identifiers", "text": "Include a few offending feature identifiers so the reader can inspect them directly." },
    { "@type": "HowToStep", "name": "Collapse the full metric list", "text": "Keep every metric available in a disclosure block without spending the reader's first thirty seconds." }
  ]
}
</script>
