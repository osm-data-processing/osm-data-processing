---
title: "Writing Custom JOSM Validation Presets"
description: "Pair a JOSM tagging preset with a MapCSS validator rule so the editor flags a house-rule tag error the moment you select an offending element."
pageTitle: "Writing Custom JOSM Validation Presets and MapCSS Rules"
pageDescription: "Author a JOSM tagging preset plus a MapCSS validator rule that raises a warning on a missing name for amenity=fuel, loaded through Preferences and evaluated live while editing."
slug: writing-custom-josm-validation-presets
type: article
breadcrumb: "Custom JOSM Presets"
datePublished: 2026-07-14
dateModified: 2026-07-14
date: 2026-07-14
---
# Writing Custom JOSM Validation Presets

Make the JOSM editor raise a warning the moment a mapper selects a fuel station tagged `amenity=fuel` but left `name` empty — by shipping a tagging preset that offers the field and a MapCSS validator rule that flags its absence, both loaded from local files.

## Prerequisites

Work through each item before loading anything; a preset that silently fails to appear is almost always a schema or encoding slip in one of these.

- [ ] JOSM installed and launched at least once, so the `Preferences` dialog and its `Tagging Presets` and `Data Validator` panels exist.
- [ ] A text editor that writes UTF-8 without a byte-order mark — JOSM's XML parser rejects a leading BOM.
- [ ] Familiarity with how tags attach to primitives, covered in the [Node-Way-Relation Data Model](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/node-way-relation-data-model/) reference.
- [ ] The house-rule vocabulary you intend to enforce, grounded in the conventions from [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/).
- [ ] Write access to a local directory where the `.xml` (preset) and `.mapcss` (validator) files will live.
- [ ] The parent workflow context in [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/), so the preset and rule fit an intentional rule set rather than a one-off.

## Conceptual minimum

A JOSM tagging preset and a JOSM validator rule are two separate mechanisms that happen to cooperate. The preset is a form definition: an XML file that declares a dialog with fields, so that when a mapper opens the preset for a selected element, JOSM offers structured inputs — a text box for `name`, a combo for `fuel:diesel`, a checkbox for `self_service`. A preset never enforces anything; it only makes correct tagging easier to enter. Enforcement lives in the validator, which JOSM drives from MapCSS. A MapCSS validator rule is a selector plus an assertion: it matches primitives by tag and geometry, and when a matched primitive violates the condition encoded in the selector, JOSM emits a warning or error into the validation results panel. The two are complementary — the preset shapes input, the validator polices output — and a house rule usually wants both so that the field the preset offers is the field the validator insists on.

<figure class="diagram-wrap">
<svg viewBox="0 0 880 230" role="img" aria-labelledby="mapcss-anatomy-t mapcss-anatomy-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mapcss-anatomy-t">The parts of a MapCSS validator rule and what each contributes</title>
  <desc id="mapcss-anatomy-d">An annotated breakdown of a MapCSS validator rule. The selector way[highway][!maxspeed] chooses which objects the rule considers. The throwWarning declaration supplies the mapper-facing message. The assertMatch and assertNoMatch declarations are test cases JOSM itself runs against the rule. And an optional fixAdd or fixChangeKey offers a one-click correction, which is what turns a warning into an edit.</desc>
  <rect x="0" y="0" width="880" height="230" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">A MapCSS rule is a selector, a message, its own tests, and optionally a fix</text>
  <rect x="26" y="52" width="258" height="136" rx="8" fill="var(--osm-accent-bg,#e0f2fe)" stroke="var(--osm-accent,#0369a1)" stroke-width="1.5"/>
  <text x="155" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Selector</text>
  <text x="40" y="104" font-size="10.5" font-family="monospace" fill="currentColor" opacity="0.92">way[highway][!maxspeed]</text>
  <text x="40" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Standard MapCSS matching</text>
  <text x="40" y="146" font-size="10.5" fill="currentColor" opacity="0.92">Tag presence, absence, regex</text>
  <text x="40" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Combine with , for alternatives</text>
  <rect x="310" y="52" width="258" height="136" rx="8" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.5"/>
  <text x="439" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Message + level</text>
  <text x="324" y="104" font-size="10.5" font-family="monospace" fill="currentColor" opacity="0.92">throwWarning: tr("...")</text>
  <text x="324" y="125" font-size="10.5" fill="currentColor" opacity="0.92">Or throwError for a hard stop</text>
  <text x="324" y="146" font-size="10.5" fill="currentColor" opacity="0.92">tr() makes it translatable</text>
  <text x="324" y="167" font-size="10.5" fill="currentColor" opacity="0.92">Say what to do, not what is wrong</text>
  <rect x="594" y="52" width="258" height="136" rx="8" fill="var(--osm-alt-bg,#ede9fe)" stroke="var(--osm-alt,#6d28d9)" stroke-width="1.5"/>
  <text x="723" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">Tests and fix</text>
  <text x="608" y="104" font-size="10.5" font-family="monospace" fill="currentColor" opacity="0.92">assertMatch: "way highway=primary"</text>
  <text x="608" y="125" font-size="10.5" font-family="monospace" fill="currentColor" opacity="0.92">assertNoMatch:` for the clean case</text>
  <text x="608" y="146" font-size="10.5" fill="currentColor" opacity="0.92">JOSM runs these on load</text>
  <text x="608" y="167" font-size="10.5" font-family="monospace" fill="currentColor" opacity="0.92">fixAdd:` offers a one-click repair</text>
  <text x="868" y="214" text-anchor="end" font-size="11" fill="currentColor" opacity="0.85">Ship every rule with at least one assertMatch and one assertNoMatch — they cost two lines and they are the reason the rule still works next release.</text>
</svg>
<figcaption>The assertions are the underused part: JOSM validates your validator, so a rule with assertions cannot silently stop matching after a selector change.</figcaption>
</figure>

The selector syntax is the load-bearing part. MapCSS matches on attribute presence and value: `*[amenity=fuel]` matches any primitive carrying that exact tag, and chaining a second condition with `[!name]` narrows the match to those additionally missing a `name` key. When such a primitive is selected or the validator runs, the rule body fires `throwWarning` with a human-readable message, and optionally a `fixAdd`/`fixRemove` auto-fix suggestion. Because MapCSS evaluation is scoped to the current selection and dataset in memory, the check is immediate: there is no server round-trip and no upload required, which is what makes it a live editing guardrail rather than a post-hoc audit. The diagram below traces how a single selected element flows through both mechanisms.

<svg viewBox="0 0 960 380" role="img" aria-label="How a JOSM preset and a MapCSS validator rule evaluate one selected element. A selected primitive tagged amenity=fuel with no name flows two ways. Upward, the tagging preset XML opens a form offering a name text field, a fuel combo, and a self_service checkbox, which writes structured tags back onto the element. Downward, the MapCSS validator rule tests the selector amenity=fuel and not name; because name is absent the rule matches and throwWarning emits a Missing name on fuel station entry into the JOSM validation results panel, with an optional fix suggestion." xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:1.5rem auto;font-family:inherit;">
  <title>Preset and MapCSS validator evaluating one selected element</title>
  <desc>A selected amenity=fuel element with no name feeds a tagging preset form above and a MapCSS validator rule below; the selector amenity=fuel plus not-name matches, and throwWarning writes a warning into the validation results panel.</desc>
  <defs>
    <marker id="josmpresetArrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="960" height="380" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <g fill="currentColor" text-anchor="middle">
    <!-- selected element -->
    <rect x="30" y="150" width="180" height="80" rx="6" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="1.5"/>
    <text x="120" y="178" font-size="12.5">selected element</text>
    <text x="120" y="196" font-size="10.5" opacity="0.8">amenity=fuel</text>
    <text x="120" y="212" font-size="10.5" opacity="0.8">name = (empty)</text>
    <!-- to preset -->
    <line x1="210" y1="170" x2="330" y2="96" stroke="currentColor" stroke-width="1.5" marker-end="url(#josmpresetArrow)"/>
    <text x="252" y="118" font-size="9.5" opacity="0.75">opens form</text>
    <!-- to validator -->
    <line x1="210" y1="210" x2="330" y2="286" stroke="currentColor" stroke-width="1.5" marker-end="url(#josmpresetArrow)"/>
    <text x="252" y="268" font-size="9.5" opacity="0.75">is tested by</text>
    <!-- preset box -->
    <rect x="332" y="40" width="250" height="110" rx="6" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
    <text x="457" y="62" font-size="12.5">tagging preset (XML)</text>
    <text x="457" y="84" font-size="10" opacity="0.85">text: name</text>
    <text x="457" y="102" font-size="10" opacity="0.85">combo: fuel:diesel</text>
    <text x="457" y="120" font-size="10" opacity="0.85">check: self_service</text>
    <text x="457" y="140" font-size="9.5" opacity="0.7">shapes input</text>
    <!-- validator box -->
    <rect x="332" y="250" width="250" height="96" rx="6" fill="currentColor" fill-opacity="0.05" stroke="currentColor" stroke-width="1.5"/>
    <text x="457" y="272" font-size="12.5">MapCSS validator rule</text>
    <text x="457" y="294" font-size="10" opacity="0.85">*[amenity=fuel][!name]</text>
    <text x="457" y="312" font-size="10" opacity="0.85">throwWarning: ...</text>
    <text x="457" y="332" font-size="9.5" opacity="0.7">polices output</text>
    <!-- preset writes back -->
    <line x1="457" y1="150" x2="457" y2="188" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#josmpresetArrow)"/>
    <text x="530" y="172" font-size="9.5" opacity="0.75">writes tags</text>
    <line x1="420" y1="188" x2="200" y2="200" stroke="currentColor" stroke-width="1" opacity="0.3"/>
    <!-- validator to results -->
    <line x1="582" y1="298" x2="702" y2="298" stroke="currentColor" stroke-width="1.5" marker-end="url(#josmpresetArrow)"/>
    <text x="642" y="288" font-size="9.5" opacity="0.75">matches → warns</text>
    <!-- results panel -->
    <rect x="704" y="252" width="226" height="94" rx="6" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.5"/>
    <text x="817" y="276" font-size="12">validation results</text>
    <text x="817" y="296" font-size="10" opacity="0.85">Warning:</text>
    <text x="817" y="313" font-size="10" opacity="0.85">Missing name on</text>
    <text x="817" y="329" font-size="10" opacity="0.85">fuel station</text>
  </g>
</svg>

## Runnable solution

Two files. The first is the tagging preset, saved as `house-rules-preset.xml`. It declares one preset that targets nodes and closed ways carrying `amenity=fuel` and offers the fields a fuel station should have.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<presets xmlns="http://josm.openstreetmap.de/tagging-preset-1.0"
         author="data-quality-team"
         version="1.0"
         shortdescription="House Rules"
         description="Local tagging presets that mirror our validator checks.">
  <group name="House Rules">
    <item name="Fuel Station" type="node,closedway" preset_name_label="true">
      <key key="amenity" value="fuel"/>
      <text key="name" text="Station name" />
      <combo key="fuel:diesel" values="yes,no" text="Sells diesel" />
      <combo key="fuel:octane_95" values="yes,no" text="Sells petrol (95)" />
      <check key="self_service" value_on="yes" value_off="no" text="Self service" />
      <text key="operator" text="Operator" />
    </item>
  </group>
</presets>
```

The second file is the MapCSS validator rule, saved as `house-rules-validator.mapcss`. It raises a warning on any fuel station missing a `name`, and offers a paste-in fix hint.

```css
/* house-rules-validator.mapcss
   Flags fuel stations that carry amenity=fuel but no name key. */

meta {
    title: "House Rules validator";
    version: "1.0";
    description: "Local QA checks that mirror the House Rules tagging preset.";
}

*[amenity=fuel][!name] {
    throwWarning: tr("Missing name on fuel station");
    assertMatch: "node amenity=fuel";
    assertNoMatch: "node amenity=fuel name=Shell";
}

/* A second, related check: fuel station with no fuel:* detail tags. */
*[amenity=fuel][!/^fuel:/] {
    throwOther: tr("Fuel station has no fuel:* detail tags");
}
```

Load both from `Preferences`:

```text
Preferences → Tagging Presets → "+" → add house-rules-preset.xml
Preferences → Data Validator → Tag checker rules → "+" → add house-rules-validator.mapcss
```

After adding each file, restart is not required; JOSM re-reads the sources on dialog `OK`. Select a fuel-station element and run `Validation` (the "Validate" button on the selection, or the toolbar action) to see the warning appear.

## Step-by-step walkthrough

1. **Preset namespace and root.** The `<presets>` element must declare the `tagging-preset-1.0` namespace exactly as shown; a wrong or missing namespace makes JOSM ignore the file silently, which is the single most common reason a new preset never appears in the menu.
2. **Item targeting.** `type="node,closedway"` restricts the preset to the geometries a fuel station can legitimately be — a point or an enclosed building outline — so it never offers itself on a bare linear way.
3. **The fixed key.** `<key key="amenity" value="fuel"/>` stamps the defining tag when the preset is applied, so the preset both matches existing fuel stations and creates new ones consistently.
4. **Field widgets.** `<text>`, `<combo>`, and `<check>` map onto the widget types JOSM renders; each `key` attribute is the OSM key the widget writes, and the `text` attribute is only the human label, never the stored value.
5. **MapCSS meta block.** The `meta { title: ... }` block names the rule set in the validator preferences list; without a title the source shows as an anonymous entry that is hard to toggle.
6. **The core selector.** `*[amenity=fuel][!name]` reads as: any primitive (`*`) that has `amenity=fuel` and does not have a `name` key. The `!` prefix is presence-negation, distinct from `name=""`, which would test for an empty value.
7. **`throwWarning` vs `throwOther`.** `throwWarning` files the issue at warning severity, which blocks upload by default until acknowledged; `throwOther` is informational and never blocks, which suits the softer "no fuel detail" nudge.
8. **Self-testing assertions.** `assertMatch` and `assertNoMatch` are unit tests baked into the rule — JOSM evaluates them when the rule loads and reports a source error if the selector does not behave as asserted, so a typo surfaces immediately instead of at editing time.

## Verification

Confirm both halves work before relying on them:

- **Preset appears.** Open `Presets → House Rules → Fuel Station`; the dialog must list the `Station name`, `Sells diesel`, and `Self service` fields. If the menu entry is missing, the XML failed to parse.
- **Warning fires.** Create a node, tag it `amenity=fuel` only, and press `Validate`. The results panel must show `Missing name on fuel station` under Warnings.
- **Warning clears.** Add `name=Example Fuel` and re-validate; the warning must disappear, proving the `[!name]` negation is evaluated live.
- **Assertions pass.** With the rule loaded, check `Preferences → Data Validator` for a source-error badge; a clean load means `assertMatch`/`assertNoMatch` both held.
- **Upload gate.** Attempt an upload with the unnamed fuel node still present; JOSM must interrupt with the unresolved warning, confirming `throwWarning` severity is in effect.

## Common errors and fixes

| Symptom | Root cause | One-line fix |
| --- | --- | --- |
| Preset never appears in menu | Wrong or missing XML namespace | Use the exact `tagging-preset-1.0` namespace on `<presets>`. |
| JOSM reports "invalid character" on load | File saved with a UTF-8 BOM | Re-save as UTF-8 without BOM. |
| Rule loads but never warns | Value test used instead of presence test | Use `[!name]` for absence, not `[name=""]`. |
| Source error badge on the MapCSS file | `assertMatch`/`assertNoMatch` contradicts the selector | Correct the selector or the assertion so they agree. |
| Warning does not block upload | Used `throwOther` instead of `throwWarning` | Switch to `throwWarning` for upload-blocking severity. |
| Combo writes wrong value | `text` attribute confused with `value` | Put stored values in `values=`, labels in `text=`. |
| Rule matches ways it should not | Selector used `*` without a geometry guard | Prefix with `node`, `way`, or `area` to scope geometry. |

<figure class="diagram-wrap">
<svg viewBox="0 0 880 238" role="img" aria-labelledby="mapcss-err-t mapcss-err-d" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:100%;display:block;margin:0 auto;font-family:inherit;">
  <title id="mapcss-err-t">Three MapCSS mistakes that make a preset unhelpful</title>
  <desc id="mapcss-err-d">A grid of three mistakes with symptom and fix. Using throwError for a stylistic preference blocks the upload of correct data, fixed by reserving throwError for genuine breakage. Matching on a tag that is legitimately absent in whole regions produces a warning on nearly every way there, fixed by adding a region or tag guard. Offering a fixAdd that guesses a value writes a plausible but unverified tag into the map, fixed by offering a fix only where the correct value is derivable from other tags.</desc>
  <rect x="0" y="0" width="880" height="238" rx="10" fill="var(--osm-canvas,#fffdf8)"/>
  <text x="440" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor">The fix button is the one to be conservative with</text>
  <text x="371" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">symptom</text>
  <text x="693" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">fix</text>
  <text x="198" y="104" text-anchor="end" font-size="11.5" fill="currentColor">throwError for a style preference</text>
  <rect x="213" y="84" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">correct edits blocked</text>
  <rect x="535" y="84" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="104" text-anchor="middle" font-size="10.5" fill="currentColor">reserve throwError for breakage</text>
  <text x="198" y="144" text-anchor="end" font-size="11.5" fill="currentColor">matching a regionally absent tag</text>
  <rect x="213" y="124" width="316" height="32" rx="5" fill="var(--osm-warn-bg,#fef9c3)" stroke="var(--osm-warn,#a16207)" stroke-width="1.2"/>
  <text x="371" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">warning on nearly every way</text>
  <rect x="535" y="124" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="144" text-anchor="middle" font-size="10.5" fill="currentColor">guard by region or companion tag</text>
  <text x="198" y="184" text-anchor="end" font-size="11.5" fill="currentColor">fixAdd guesses a value</text>
  <rect x="213" y="164" width="316" height="32" rx="5" fill="var(--osm-bad-bg,#fee2e2)" stroke="var(--osm-bad,#b91c1c)" stroke-width="1.2"/>
  <text x="371" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">unverified data uploaded</text>
  <rect x="535" y="164" width="316" height="32" rx="5" fill="var(--osm-ok-bg,#dcfce7)" stroke="var(--osm-ok,#15803d)" stroke-width="1.2"/>
  <text x="693" y="184" text-anchor="middle" font-size="10.5" fill="currentColor">only fix what is derivable</text>
  <text x="440" y="220" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">A validator that cries wolf gets switched off, and a validator that is switched off catches nothing at all.</text>
</svg>
<figcaption>The third is the one with consequences beyond your own screen: a one-click fix that guesses turns an editor convenience into a source of unverified data in the global map.</figcaption>
</figure>

For house rules that must run outside the editor as well, mirror the same conditions in a batch check such as [Flagging Deprecated OSM Tags in a Pipeline](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/flagging-deprecated-osm-tags-in-a-pipeline/) so an unedited import cannot bypass the guardrail.

## Specification reference

> JOSM's validator is driven by MapCSS: a tag-checker rule is a MapCSS selector whose declaration block calls `throwError`, `throwWarning`, or `throwOther`, optionally with `fixAdd`, `fixRemove`, or `fixChangeKey` auto-fixes and `assertMatch`/`assertNoMatch` self-tests. Presence and absence are tested with `[key]` and `[!key]`. See the official [JOSM Validator help](https://josm.openstreetmap.de/wiki/Help/Validator) and the [MapCSS implementation notes](https://josm.openstreetmap.de/wiki/Help/Styles/MapCSSImplementation) for the exact grammar and the list of supported directives.

## Frequently Asked Questions

<details>
<summary>Does the preset enforce the validator rule on its own?</summary>

No. A tagging preset only renders a form and, at most, stamps fixed keys when applied — it has no power to reject or warn about anything. Enforcement is entirely the validator's job, driven by the separate MapCSS rule. Ship both so the field the preset offers is the field the validator insists on, and neither leans on the other for correctness.
</details>

<details>
<summary>What is the difference between throwWarning and throwError?</summary>

Both file an issue into the validation results, but severity differs. `throwWarning` marks the issue as a warning, which JOSM will interrupt an upload to have you acknowledge or resolve. `throwError` is the strongest severity and is meant for definite data corruption. `throwOther` is informational and never blocks upload, which suits soft nudges you do not want to gate a save.
</details>

<details>
<summary>How do I test a selector without waiting to hit the case while mapping?</summary>

Embed `assertMatch` and `assertNoMatch` in the rule body. JOSM evaluates these when it loads the MapCSS source: `assertMatch` names a primitive the selector must match, `assertNoMatch` one it must not. A mismatch raises a source error in the validator preferences on load, so a broken selector surfaces at load time instead of silently doing nothing while you edit.
</details>

<details>
<summary>Can I attach an automatic fix to a validator warning?</summary>

Yes. Add a `fixAdd`, `fixChangeKey`, or `fixRemove` directive to the rule body. `fixAdd: "key=value"` offers a one-click correction in the results panel. Auto-fixes are best reserved for unambiguous cases; for a missing free-text `name` there is no value to add automatically, so that rule warns without an auto-fix and leaves the mapper to type the real name.
</details>

## Related

- [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/) — the section this preset-plus-rule pairing belongs to.
- [Authoring Osmose Rule DSL Checks](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/authoring-osmose-rule-dsl-checks/) — the server-side analogue that surfaces the same class of issue on the QA map.
- [Building Python-Based OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/building-python-based-osm-validation-rules/) — a pipeline framework for enforcing house rules outside the editor.
- [Tag Taxonomy & Key-Value Standards](https://www.osm-data-processing.org/osm-data-fundamentals-architecture/tag-taxonomy-key-value-standards/) — the vocabulary reference the preset fields should follow.
- [Flagging Deprecated OSM Tags in a Pipeline](https://www.osm-data-processing.org/osm-data-quality-validation/tag-and-attribute-consistency-checks/flagging-deprecated-osm-tags-in-a-pipeline/) — a batch check that mirrors editor-time rules for imports.
- [OSM Data Quality & Validation](https://www.osm-data-processing.org/osm-data-quality-validation/) — the wider quality-assurance section around this topic.

Up one level: [Authoring OSM Validation Rules](https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Writing Custom JOSM Validation Presets",
  "description": "Pair a JOSM tagging preset with a MapCSS validator rule so the editor flags a house-rule tag error the moment you select an offending element.",
  "datePublished": "2026-07-14",
  "dateModified": "2026-07-14",
  "articleSection": "OSM Data Quality & Validation",
  "about": ["JOSM tagging presets", "MapCSS validator rules", "OSM editor-time validation"]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.osm-data-processing.org/" },
    { "@type": "ListItem", "position": 2, "name": "OSM Data Quality & Validation", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/" },
    { "@type": "ListItem", "position": 3, "name": "Authoring OSM Validation Rules", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/" },
    { "@type": "ListItem", "position": 4, "name": "Custom JOSM Presets", "item": "https://www.osm-data-processing.org/osm-data-quality-validation/authoring-osm-validation-rules/writing-custom-josm-validation-presets/" }
  ]
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "Write a custom JOSM validation preset and MapCSS rule",
  "description": "Author a JOSM tagging preset plus a MapCSS validator rule that warns on a fuel station missing a name, load both from Preferences, and verify the warning fires live while editing.",
  "step": [
    { "@type": "HowToStep", "name": "Author the tagging preset", "text": "Write an XML preset in the tagging-preset-1.0 namespace that targets amenity=fuel nodes and closed ways and offers name, fuel:*, and self_service fields." },
    { "@type": "HowToStep", "name": "Author the MapCSS validator rule", "text": "Write a MapCSS rule with the selector amenity=fuel and not name that calls throwWarning with a Missing name message, plus assertMatch and assertNoMatch self-tests." },
    { "@type": "HowToStep", "name": "Load both files from Preferences", "text": "Add the XML under Tagging Presets and the MapCSS under Data Validator tag-checker rules, then confirm the dialogs accept them without a source error." },
    { "@type": "HowToStep", "name": "Verify the warning fires and clears", "text": "Tag a node amenity=fuel with no name and validate to see the warning, then add a name and re-validate to confirm it disappears." }
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
      "name": "Does the preset enforce the validator rule on its own?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. A tagging preset only renders a form and at most stamps fixed keys when applied; it has no power to reject or warn about anything. Enforcement is entirely the validator's job, driven by the separate MapCSS rule. Ship both so the field the preset offers is the field the validator insists on, and neither leans on the other for correctness." }
    },
    {
      "@type": "Question",
      "name": "What is the difference between throwWarning and throwError?",
      "acceptedAnswer": { "@type": "Answer", "text": "Both file an issue into the validation results, but severity differs. throwWarning marks the issue as a warning, which JOSM will interrupt an upload to have you acknowledge or resolve. throwError is the strongest severity and is meant for definite data corruption. throwOther is informational and never blocks upload, which suits soft nudges you do not want to gate a save." }
    },
    {
      "@type": "Question",
      "name": "How do I test a selector without waiting to hit the case while mapping?",
      "acceptedAnswer": { "@type": "Answer", "text": "Embed assertMatch and assertNoMatch in the rule body. JOSM evaluates these when it loads the MapCSS source: assertMatch names a primitive the selector must match, assertNoMatch one it must not. A mismatch raises a source error in the validator preferences on load, so a broken selector surfaces at load time instead of silently doing nothing while you edit." }
    },
    {
      "@type": "Question",
      "name": "Can I attach an automatic fix to a validator warning?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes. Add a fixAdd, fixChangeKey, or fixRemove directive to the rule body. fixAdd with a key equals value offers a one-click correction in the results panel. Auto-fixes are best reserved for unambiguous cases; for a missing free-text name there is no value to add automatically, so that rule warns without an auto-fix and leaves the mapper to type the real name." }
    }
  ]
}
</script>
