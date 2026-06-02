# ADA Automation Results — Frontend Design Guide

This document describes what you can build in the frontend based on the **axe-core** (ADA/accessibility) result JSON, e.g. `CollectionPageADACheck01212026235702 (1).json`.

---

## 1. Result JSON structure (axe-core v1)

Your file contains:

| Key | Purpose |
|-----|--------|
| **toolOptions** | `{ reporter: "v1" }` |
| **testEngine** | `{ name: "axe-core", version: "4.8.4" }` |
| **testEnvironment** | `userAgent`, `windowWidth`, `windowHeight`, `orientationType` |
| **testRunner** | `{ name: "axe" }` |
| **url** | Page URL that was tested |
| **timestamp** | When the run completed (ISO string) |
| **passes** | Rules that **passed** (array of rule objects) |
| **violations** | Rules that **failed** (array of rule objects) |
| **incomplete** | Rules that could not be fully evaluated |
| **inapplicable** | Rules that did not apply to the page |
| **errored** | Rules that errored during evaluation |

Each **rule object** (in passes/violations/incomplete) has:

- **id** – e.g. `aria-valid-attr-value`
- **description** – Short description of the rule
- **help** – Human-readable “what to fix”
- **helpUrl** – Link to Deque University (how to fix)
- **impact** – `critical` \| `serious` \| `moderate` \| `minor` (empty for passes)
- **tags** – e.g. `["cat.aria", "wcag2a", "wcag412", "EN-301-549"]`
- **nodes** – Array of **affected elements**:
  - **html** – HTML snippet of the element
  - **target** – CSS selector(s) to find the element
  - **any** / **all** / **none** – Check results (passed/failed messages)

---

## 2. What you can design (screens & features)

### 2.1 Summary / Dashboard

- **Run metadata**
  - Tested URL (link)
  - Timestamp (formatted)
  - Engine: axe-core version
  - Environment: browser (from userAgent), viewport (windowWidth × windowHeight), orientation
- **Counts**
  - Passed rules count
  - Violations count (and optionally incomplete / inapplicable / errored)
  - **Pass rate** (e.g. passes / (passes + violations)) or a simple score
- **Impact breakdown**
  - Count by impact: Critical, Serious, Moderate, Minor (from violations only)
- **Standards / tags**
  - Count or filter by tag (e.g. WCAG 2 A/AA, EN 301-549) using the **tags** array

**UI ideas:** KPI cards, small bar/pie chart by impact, “Environment” block.

---

### 2.2 Violations list (main screen)

- **List/table of violations**
  - Columns (or card fields): Rule **id**, **description**, **impact**, **number of nodes**, **tags** (e.g. WCAG level)
  - Sort by impact (critical first), then by node count or rule id
- **Per violation**
  - Expand/collapse or “View details” to show:
    - **help** text and **helpUrl** (button: “How to fix”)
    - List of **nodes**:
      - **target** (selector) – e.g. copy button
      - **html** – snippet (collapsible, optionally syntax-highlighted or truncated)
      - **any** / **all** / **none** – which check failed and the **message**
  - Optional: “Copy selector” for each node

**UI ideas:** Accordion or table with expandable rows; impact badge (color by critical/serious/moderate/minor).

---

### 2.3 Passes list (optional)

- Same structure as violations but for **passes** (read-only, lower priority).
- **Collapsible by default** or behind a “Show passed rules” toggle.
- Show: rule **id**, **description**, **tags**, **node count** (how many elements passed).

**UI idea:** Secondary tab or accordion “Passed rules (47)”.

---

### 2.4 Filtering & search

- **By impact** – Critical, Serious, Moderate, Minor (checkboxes or pills).
- **By tag** – e.g. “WCAG 2 Level A”, “WCAG 2 Level AA”, “EN-301-549” (from **tags**).
- **Search** – Rule **id** or **description** (and optionally **help**).
- **By section** – Show only violations, only incomplete, or only passes.

**UI ideas:** Filter bar above the list; URL query params to share “view”.

---

### 2.5 Node / element detail

- When user clicks a node (or “View element”):
  - **HTML** – Full snippet, sanitized and optionally highlighted.
  - **Target** – One or more selectors (copy to clipboard).
  - **Related nodes** – If present in the rule (e.g. **relatedNodes** in checks).
  - **Failed checks** – Which of **any** / **all** / **none** failed and the **message** for each.

**UI ideas:** Side panel or modal; “Copy selector” / “Copy HTML” buttons.

---

### 2.6 Export & sharing

- **Export**
  - Full JSON download.
  - CSV of violations: url, timestamp, rule id, impact, description, selector, (optional) html snippet.
  - Summary as text/markdown (URL, date, counts, list of violation ids).
- **Sharing**
  - Link with hash or query params to a specific violation or rule (e.g. `#violation-aria-valid-attr-value`).

---

### 2.7 Multiple runs & comparison (future)

- **List of runs**
  - Each run: URL, timestamp, summary counts; click to open that result.
- **Compare two runs**
  - Same URL or same page: “New violations”, “Fixed”, “Still failing” (by rule id and optionally by node).
- **Trend**
  - Over time: violation count, critical count, pass rate (if you store runs in backend).

**UI ideas:** Run selector dropdown; side-by-side or diff view for two JSON files.

---

## 3. Suggested implementation order

1. **Load result** – File upload or API that returns this JSON (e.g. after “Process URL”).
2. **Summary** – URL, timestamp, engine, environment, pass/violation counts, impact breakdown.
3. **Violations list** – Table or cards with rule id, impact, node count, expandable node list and helpUrl.
4. **Filter by impact** and **search** by id/description.
5. **Passes list** – Collapsible section.
6. **Export JSON/CSV** and “Copy selector” for nodes.
7. (Later) Multiple runs and compare.

---

## 4. Data flow (recommended)

- **Backend** (Flask/Java):  
  - Option A: “Process URL” runs axe (or your ADA tool), returns this JSON.  
  - Option B: “Upload result” accepts the JSON file and stores/returns it.
- **Frontend**:
  - Store current result in React state (or context).
  - Summary and violations/passes components read from that state.
  - Filters are local state (or URL params).

---

## 5. Sample counts (from your file)

- **Passes:** 47 rules
- **Violations:** 2 rules (e.g. one with impact `critical` and 10 nodes)
- **Incomplete / inapplicable / errored:** use for future columns or filters

Use these to drive summary KPIs and “Violations (2)” / “Passed (47)” labels in the UI.

---

## 6. Built-in ADA Results viewer

The app includes an **ADA Results** page (sidebar → “ADA Results”):

- **Upload** an axe-core JSON file (e.g. `CollectionPageADACheck01212026235702 (1).json`).
- **Summary**: URL, timestamp, engine, viewport, passed/violations/incomplete counts, pass rate, impact breakdown.
- **Violations**: Expandable list with rule id, impact, node count; expand to see description, “How to fix” link, and affected elements (selector + HTML snippet).
- **Filter** by impact (critical, serious, moderate, minor) and **search** by rule id or description.
- **Passed rules**: Collapsible list of all passed rule ids and node counts.

To extend this viewer, edit `src/components/ADAResultsView/` and add the features described in sections 2–4 above (e.g. export CSV, comparison, tags filter).
