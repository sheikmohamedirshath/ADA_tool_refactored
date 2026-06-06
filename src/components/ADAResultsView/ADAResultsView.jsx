import React, { useState, useEffect } from 'react'
import './ADAResultsView.css'
import { getRuleFixTips, getRuleFixExamples, getRuleWhyMatters, splitFailureSummary } from '../../config/axeFixGuidance'

const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor']

// ─── WCAG Utilities ──────────────────────────────────────────────────
const WCAG_AA_CRITERIA = new Set([
  '1.2.4','1.2.5','1.3.4','1.3.5','1.4.3','1.4.4','1.4.5',
  '1.4.10','1.4.11','1.4.12','1.4.13','2.4.5','2.4.6','2.4.7',
  '3.1.2','3.2.3','3.2.4','3.3.3','3.3.4','4.1.3',
])

const WCAG_CRITERION_NAMES = {
  '1.1.1':'Non-text Content','1.3.1':'Info and Relationships','1.3.2':'Meaningful Sequence',
  '1.3.5':'Identify Input Purpose','1.4.1':'Use of Color','1.4.3':'Contrast (Minimum)',
  '1.4.4':'Resize Text','1.4.10':'Reflow','1.4.11':'Non-text Contrast','1.4.12':'Text Spacing',
  '2.1.1':'Keyboard','2.1.2':'No Keyboard Trap','2.4.1':'Bypass Blocks','2.4.2':'Page Titled',
  '2.4.3':'Focus Order','2.4.4':'Link Purpose (In Context)','2.4.6':'Headings and Labels',
  '2.4.7':'Focus Visible','3.1.1':'Language of Page','3.2.2':'On Input',
  '3.3.1':'Error Identification','3.3.2':'Labels or Instructions',
  '4.1.1':'Parsing','4.1.2':'Name, Role, Value','4.1.3':'Status Messages',
}

function wcagTagToMeta(tags) {
  if (!Array.isArray(tags)) return null
  for (const tag of tags) {
    if (typeof tag !== 'string') continue
    const lower = tag.toLowerCase()
    if (/^wcag\d*a+$/.test(lower)) continue // skip conformance-level tags (wcag2aa, wcag2a)
    const m = lower.match(/^wcag(\d{3,})$/)
    if (!m) continue
    const digits = m[1]
    const criterion = `${digits[0]}.${digits[1]}.${digits.slice(2)}`
    const level = WCAG_AA_CRITERIA.has(criterion) ? 'AA' : 'A'
    const name = WCAG_CRITERION_NAMES[criterion] || null
    return { criterion, level, name }
  }
  return null
}

const SCORE_WEIGHTS = { critical: 10, serious: 5, moderate: 2, minor: 1 }

function computeScore(violations) {
  let penalty = 0
  for (const v of violations) {
    const w = SCORE_WEIGHTS[(v.impact || 'minor').toLowerCase()] ?? 1
    penalty += (v.nodes?.length ?? 1) * w
  }
  return Math.max(0, Math.min(100, Math.round(100 - penalty)))
}

function scoreGradeInfo(score) {
  if (score >= 90) return { grade: 'A', color: 'success' }
  if (score >= 75) return { grade: 'B', color: 'good' }
  if (score >= 60) return { grade: 'C', color: 'warning' }
  if (score >= 45) return { grade: 'D', color: 'serious' }
  return              { grade: 'F', color: 'critical' }
}

function scoreMessage(score) {
  if (score >= 90) return 'Excellent accessibility compliance. Minor or no issues found.'
  if (score >= 75) return 'Good accessibility baseline with some issues requiring attention.'
  if (score >= 60) return 'Moderate accessibility issues found. Prioritize critical and serious violations.'
  if (score >= 45) return 'Significant accessibility barriers detected. Remediation required.'
  return 'Critical accessibility failures present. Immediate remediation required.'
}

function buildSeverityBreakdown(violations) {
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 }
  for (const v of violations) {
    const impact = (v.impact || 'minor').toLowerCase()
    if (impact in counts) counts[impact] += (v.nodes?.length ?? 1)
  }
  return counts
}

function buildTopIssues(violations) {
  const map = {}
  for (const v of violations) {
    const id = v.id || 'unknown'
    if (!map[id]) map[id] = { id, title: formatRuleTitle(v), count: 0 }
    map[id].count += (v.nodes?.length ?? 1)
  }
  return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 8)
}

const SEVERITY_ROWS = [
  { key: 'critical', label: 'Critical', sublabel: 'High Risk'   },
  { key: 'serious',  label: 'Serious',  sublabel: 'Medium Risk' },
  { key: 'moderate', label: 'Moderate', sublabel: 'Low Risk'    },
  { key: 'minor',    label: 'Minor',    sublabel: 'Info'        },
]

function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function ImpactBadge({ impact }) {
  if (!impact) return null
  const c = impact.toLowerCase()
  const label = c.charAt(0).toUpperCase() + c.slice(1)
  return <span className={`ada-impact ada-impact--${c}`}>{label}</span>
}

function formatRuleTitle(rule) {
  if (rule?.help && typeof rule.help === 'string') return rule.help
  const rawId = (rule?.id || '').toString().trim()
  if (!rawId) return 'Accessibility issue'
  return rawId
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
}

function simplifyFailureLine(line) {
  if (!line) return ''
  const text = line
    .replace(/^Fix all of the following:\s*/i, '')
    .replace(/^Fix any of the following:\s*/i, '')
    .replace(/^Fix one of the following:\s*/i, '')
    .trim()
  if (!text) return ''
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function getNodeSummary(node) {
  const lines = splitFailureSummary(node?.failureSummary)
  for (const line of lines) {
    const simplified = simplifyFailureLine(line)
    if (simplified) return simplified
  }
  return ''
}

export default function ADAResultsView({ initialResult = null, processResult = null, scanIdToLoad = null, onClearResult }) {
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [filterImpact, setFilterImpact] = useState([])
  const [search, setSearch] = useState('')
  const [showPasses, setShowPasses] = useState(false)
  const [expandedRule, setExpandedRule] = useState(null)
  const [screenshotError, setScreenshotError] = useState(false)
  // Modal: null = closed, 'full' = full page screenshot, or detail object for rule screenshot
  const [screenshotModal, setScreenshotModal] = useState(null)
  const [copied, setCopied] = useState({})
  // When opening a scan from history
  const [loadedScanResult, setLoadedScanResult] = useState(null)
  const [loadingScan, setLoadingScan] = useState(false)
  const [loadScanError, setLoadScanError] = useState(null)

  const copyText = (key, text) => {
    if (!navigator.clipboard) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied((prev) => ({ ...prev, [key]: true }))
      setTimeout(() => setCopied((prev) => { const n = { ...prev }; delete n[key]; return n }), 2000)
    })
  }

  useEffect(() => {
    if (scanIdToLoad == null || scanIdToLoad === '') {
      setLoadedScanResult(null)
      setLoadScanError(null)
      return
    }
    let cancelled = false
    setLoadingScan(true)
    setLoadScanError(null)
    fetch(`/api/history/${scanIdToLoad}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        if (data.ok && data.result) {
          setLoadedScanResult(data.result)
          setError('')
        } else {
          setLoadedScanResult(null)
          setLoadScanError(data.error || 'Failed to load scan result')
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadedScanResult(null)
          setLoadScanError(err.message || 'Network error')
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingScan(false)
      })
    return () => { cancelled = true }
  }, [scanIdToLoad])

  const effectiveProcessResult = loadedScanResult ?? processResult
  const displayResult = loadedScanResult?.axeResult ?? result ?? initialResult
  const scanProfile = effectiveProcessResult?.includeBestPractices
    ? 'WCAG 2.1 AA + Best Practices'
    : 'WCAG 2.1 AA'
  const screenshotData = displayResult?.screenshot && typeof displayResult.screenshot === 'string'
    ? displayResult.screenshot.trim()
    : ''
  const screenshotType = displayResult?.screenshotType && typeof displayResult.screenshotType === 'string'
    ? displayResult.screenshotType.trim()
    : 'image/jpeg'
  const hasScreenshot = screenshotData.length > 0

  useEffect(() => {
    setScreenshotError(false)
  }, [displayResult])

  const handleFile = (e) => {
    const file = e.target?.files?.[0]
    if (!file) return
    setError('')
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result || '{}')
        if (!data.passes && !data.violations && !data.url) {
          setError('Not a valid axe-core result (expected url, passes, violations)')
          setResult(null)
          return
        }
        setResult(data)
        setExpandedRule(null)
        setScreenshotError(false)
      } catch (err) {
        setError('Invalid JSON: ' + (err.message || 'parse error'))
        setResult(null)
      }
    }
    reader.readAsText(file)
  }

  const violations = displayResult?.violations ?? []
  const passes = displayResult?.passes ?? []
  const incomplete = displayResult?.incomplete ?? []
  const impactCounts = violations.reduce((acc, v) => {
    const i = (v.impact || 'other').toLowerCase()
    acc[i] = (acc[i] || 0) + 1
    return acc
  }, {})

  const filteredViolations = violations.filter((v) => {
    const matchImpact = filterImpact.length === 0 || filterImpact.includes((v.impact || '').toLowerCase())
    const matchSearch =
      !search ||
      (v.id && v.id.toLowerCase().includes(search.toLowerCase())) ||
      (v.description && v.description.toLowerCase().includes(search.toLowerCase())) ||
      (v.help && v.help.toLowerCase().includes(search.toLowerCase()))
    return matchImpact && matchSearch
  })

  const findRuleByKey = (key) => {
    const idx = filteredViolations.findIndex((r, i) => `${r.id || JSON.stringify(r)}-${i}` === key)
    return idx >= 0 ? filteredViolations[idx] : null
  }

  // Resolve what to show in the screenshot modal
  const modalContent =
    screenshotModal?.kind === 'full' && hasScreenshot
      ? { src: `data:${screenshotType};base64,${screenshotData}`, title: 'Page as tested' }
      : screenshotModal?.kind === 'rule'
        ? (() => {
            const rule = findRuleByKey(screenshotModal.ruleKey)
            const shot = rule?.screenshot && typeof rule.screenshot === 'string' ? rule.screenshot.trim() : ''
            const type = rule?.screenshotType && typeof rule.screenshotType === 'string' ? rule.screenshotType.trim() : 'image/jpeg'
            return shot ? { src: `data:${type};base64,${shot}`, title: `${rule?.id || 'Violation'} – screenshot` } : null
          })()
        : null

  const totalRules = (displayResult?.passes?.length ?? 0) + (displayResult?.violations?.length ?? 0)
  const passRate = totalRules > 0 ? Math.round((displayResult?.passes?.length / totalRules) * 100) : 0

  const score = displayResult ? computeScore(violations) : null
  const gradeInfo = score !== null ? scoreGradeInfo(score) : null
  const severityBreakdown = displayResult ? buildSeverityBreakdown(violations) : null
  const topIssues = displayResult ? buildTopIssues(violations) : []
  const maxTopCount = topIssues.length > 0 ? topIssues[0].count : 1

  const scrollToViolation = (ruleId) => {
    setFilterImpact([])
    setSearch('')
    setTimeout(() => {
      document.getElementById(`vi-${ruleId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
  }

  const handleClearResult = () => {
    setResult(null)
    setError('')
    onClearResult?.()
  }

  return (
    <main className="ada-results">
      <div className="ada-results__inner">
        <h1 className="ada-results__title">ADA Automation Results</h1>
        <p className="ada-results__intro">
          Upload an axe-core (or compatible) JSON result to view summary, violations, and passed rules.
        </p>

        {displayResult && effectiveProcessResult?.usedFallback && (
          <div className="ada-results__error" role="alert">
            This result came from the fallback sample, not a live accessibility scan.
            {effectiveProcessResult.fallbackError ? ` Scan error: ${effectiveProcessResult.fallbackError}` : ''}
          </div>
        )}

        <div className="ada-results__upload">
          <label className="ada-results__file-label">
            <span className="ada-results__file-btn">Choose result file</span>
            <input type="file" accept=".json,application/json" onChange={handleFile} className="ada-results__file-input" />
          </label>
          {displayResult && (
            <button type="button" className="ada-results__clear-btn" onClick={handleClearResult}>
              Clear result / Load another
            </button>
          )}
        </div>

        {error && <div className="ada-results__error" role="alert">{error}</div>}

        {scanIdToLoad != null && loadingScan && (
          <p className="ada-results__empty">Loading scan result…</p>
        )}
        {scanIdToLoad != null && loadScanError && !loadingScan && (
          <div className="ada-results__error" role="alert">
            {loadScanError}
            {onClearResult && (
              <button type="button" className="ada-results__clear-btn" style={{ marginLeft: 12 }} onClick={onClearResult}>
                Close
              </button>
            )}
          </div>
        )}

        {displayResult && loadedScanResult && (
          <p className="ada-results__from-run">Viewing stored scan from history (URL: {displayResult.url || '—'}).</p>
        )}
        {displayResult && initialResult && !result && !loadedScanResult && (
          <p className="ada-results__from-run">Showing result from your last ADA check (URL: {displayResult.url || '—'}).</p>
        )}

        {!displayResult && !error && !(scanIdToLoad != null && (loadingScan || loadScanError)) && (
          <div className="ada-results__empty">
            <p>No result loaded. Use the button above to upload a JSON file (e.g. CollectionPageADACheck*.json).</p>
          </div>
        )}

        {displayResult && hasScreenshot && (
          <section className="ada-screenshot" aria-label="Screenshot of tested page">
            <h2 className="ada-screenshot__heading">Page screenshot</h2>
            <p className="ada-screenshot__caption">
              View the page as it was when the accessibility check ran.
            </p>
            <button
              type="button"
              className="ada-screenshot__btn"
              onClick={() => setScreenshotModal({ kind: 'full' })}
            >
              View page screenshot
            </button>
          </section>
        )}
        {displayResult && !hasScreenshot && (
          <div className="ada-results__no-screenshot">
            {effectiveProcessResult?.usedFallback ? (
              <>
                <p><strong>Screenshots are not available</strong> because the accessibility check could not run; a fallback result was used instead.</p>
                {effectiveProcessResult.fallbackError && (
                  <p className="ada-results__no-screenshot-error">Error: {effectiveProcessResult.fallbackError}</p>
                )}
                {(effectiveProcessResult.fallbackError || '').toLowerCase().includes('greenlet') || (effectiveProcessResult.fallbackError || '').toLowerCase().includes('dll') ? (
                  <>
                    <p><strong>Fix (Windows):</strong> Install the <strong>Microsoft Visual C++ Redistributable</strong>, then re-run.</p>
                    <ol className="ada-results__no-screenshot-list">
                      <li>Download and install: <a href="https://aka.ms/vs/17/release/vc_redist.x64.exe" target="_blank" rel="noopener noreferrer">VC++ Redistributable x64</a> (one-time).</li>
                      <li>Restart your terminal, then from the project folder run:</li>
                    </ol>
                    <pre className="ada-results__no-screenshot-code">python -m playwright install chromium</pre>
                    <p>Then run <code>python app.py</code> and try <strong>Process</strong> again. See <code>TROUBLESHOOTING.md</code> in the project for more.</p>
                  </>
                ) : (
                  <>
                    <p>To get screenshots, install Playwright’s Chromium from the project folder:</p>
                    <pre className="ada-results__no-screenshot-code">python -m playwright install chromium</pre>
                    <p>Then run the app with <code>python app.py</code> and try <strong>Process</strong> again.</p>
                  </>
                )}
              </>
            ) : (
              <p>
                No screenshot for this result. Screenshots are included when you run <strong>Process</strong> from the app; they are not in sample or uploaded results from older runs.
              </p>
            )}
          </div>
        )}

        {displayResult && (
          <>
            {/* ── Phase 1: Score hero + Severity breakdown ── */}
            <div className="ada-intel-grid">
              <section className="ada-score-card" aria-label="Accessibility Score">
                <h2 className="ada-score-card__heading">Accessibility Score</h2>
                <div className="ada-score-card__body">
                  <div className={`ada-score-card__dial ada-score-card__dial--${gradeInfo.color}`}>
                    <span className="ada-score-card__number">{score}</span>
                    <span className="ada-score-card__denom">/ 100</span>
                  </div>
                  <div className="ada-score-card__meta">
                    <span className={`ada-score-card__grade ada-score-card__grade--${gradeInfo.color}`}>
                      Grade {gradeInfo.grade}
                    </span>
                    <p className="ada-score-card__message">{scoreMessage(score)}</p>
                  </div>
                </div>
              </section>

              <section className="ada-severity-card" aria-label="Severity Breakdown">
                <h2 className="ada-severity-card__heading">Severity Breakdown</h2>
                <div className="ada-severity-card__rows">
                  {SEVERITY_ROWS.map(({ key, label, sublabel }) => (
                    <div key={key} className="ada-severity-row">
                      <span className={`ada-severity-row__dot ada-severity-row__dot--${key}`} />
                      <span className="ada-severity-row__label-group">
                        <span className="ada-severity-row__label">{label}</span>
                        <span className="ada-severity-row__sublabel">{sublabel}</span>
                      </span>
                      <span className={`ada-severity-row__count ada-severity-row__count--${key}`}>
                        {severityBreakdown[key]}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* Summary */}
            <section className="ada-summary" aria-label="Run summary">
              <h2 className="ada-summary__heading">Summary</h2>
              <div className="ada-summary__grid">
                <div className="ada-summary__card">
                  <span className="ada-summary__label">URL</span>
                  <a href={displayResult.url} target="_blank" rel="noopener noreferrer" className="ada-summary__url">
                    {displayResult.url || '—'}
                  </a>
                </div>
                <div className="ada-summary__card">
                  <span className="ada-summary__label">Timestamp</span>
                  <span>{formatDate(displayResult.timestamp)}</span>
                </div>
                <div className="ada-summary__card">
                  <span className="ada-summary__label">Engine</span>
                  <span>{displayResult.testEngine?.name} {displayResult.testEngine?.version}</span>
                </div>
                <div className="ada-summary__card">
                  <span className="ada-summary__label">Viewport</span>
                  <span>{displayResult.testEnvironment?.windowWidth} × {displayResult.testEnvironment?.windowHeight}</span>
                </div>
                <div className="ada-summary__card">
                  <span className="ada-summary__label">Scan profile</span>
                  <span>{scanProfile}</span>
                </div>
              </div>
              <div className="ada-summary__kpis">
                <div className="ada-summary__kpi ada-summary__kpi--pass">
                  <span className="ada-summary__kpi-value">{passes.length}</span>
                  <span className="ada-summary__kpi-label">Passed</span>
                </div>
                <div className="ada-summary__kpi ada-summary__kpi--fail">
                  <span className="ada-summary__kpi-value">{violations.length}</span>
                  <span className="ada-summary__kpi-label">Violations</span>
                </div>
                <div className="ada-summary__kpi ada-summary__kpi--incomplete">
                  <span className="ada-summary__kpi-value">{incomplete.length}</span>
                  <span className="ada-summary__kpi-label">Incomplete</span>
                </div>
                <div className="ada-summary__kpi">
                  <span className="ada-summary__kpi-value">{passRate}%</span>
                  <span className="ada-summary__kpi-label">Pass rate</span>
                </div>
              </div>
              {Object.keys(impactCounts).length > 0 && (
                <div className="ada-summary__impacts">
                  <span className="ada-summary__label">By impact:</span>
                  {IMPACT_ORDER.filter((i) => impactCounts[i]).map((i) => (
                    <span key={i} className="ada-summary__impact-row">
                      <ImpactBadge impact={i} /> {impactCounts[i]}
                    </span>
                  ))}
                </div>
              )}
            </section>

            {/* Filters */}
            {(violations.length > 0 || search) && (
              <div className="ada-filters">
                <input
                  type="search"
                  placeholder="Search by rule id or description"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="ada-filters__search"
                  aria-label="Search violations"
                />
                <div className="ada-filters__impacts">
                  {IMPACT_ORDER.map((i) => (
                    <label key={i} className="ada-filters__check">
                      <input
                        type="checkbox"
                        checked={filterImpact.includes(i)}
                        onChange={(e) =>
                          setFilterImpact((prev) =>
                            e.target.checked ? [...prev, i] : prev.filter((x) => x !== i)
                          )
                        }
                      />
                      <ImpactBadge impact={i} />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* ── Phase 1: Top Issues summary ── */}
            {topIssues.length > 0 && (
              <section className="ada-top-issues" aria-label="Top issues summary">
                <h2 className="ada-top-issues__heading">Top Issues</h2>
                <ul className="ada-top-issues__list">
                  {topIssues.map((issue) => (
                    <li key={issue.id} className="ada-top-issue">
                      <button
                        type="button"
                        className="ada-top-issue__btn"
                        onClick={() => scrollToViolation(issue.id)}
                        title={`Scroll to ${issue.id}`}
                      >
                        <span className="ada-top-issue__title">{issue.title}</span>
                        <span className="ada-top-issue__bar-wrap">
                          <span
                            className="ada-top-issue__bar"
                            style={{ width: `${Math.round((issue.count / maxTopCount) * 100)}%` }}
                          />
                        </span>
                        <span className="ada-top-issue__count">{issue.count}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Violations */}
            <section className="ada-violations" aria-label="Violations">
              <h2 className="ada-violations__heading">Violations ({filteredViolations.length})</h2>
              {filteredViolations.length === 0 ? (
                <p className="ada-violations__none">No violations match the current filters.</p>
              ) : (
                <ul className="ada-violations__list">
                  {filteredViolations.map((rule, violationIndex) => {
                    const key = `${rule.id || JSON.stringify(rule)}-${violationIndex}`
                    const isExpanded = expandedRule === key
                    const wcagMeta = wcagTagToMeta(rule.tags)
                    return (
                      <li key={key} id={`vi-${rule.id || violationIndex}`} className="ada-violation">
                        <div
                          className="ada-violation__header"
                          onClick={() => setExpandedRule(isExpanded ? null : key)}
                          onKeyDown={(e) => e.key === 'Enter' && setExpandedRule(isExpanded ? null : key)}
                          role="button"
                          tabIndex={0}
                          aria-expanded={isExpanded}
                        >
                          <div className="ada-violation__main">
                            <span className="ada-violation__title">{formatRuleTitle(rule)}</span>
                            {rule.id && <span className="ada-violation__id">Rule: {rule.id}</span>}
                          </div>
                          <span className="ada-violation__nodes" title="Affected elements">{rule.nodes?.length ?? 0}</span>
                          <ImpactBadge impact={rule.impact} />
                          {wcagMeta && (
                            <span className="ada-wcag-badge">
                              WCAG {wcagMeta.criterion} {wcagMeta.level}
                            </span>
                          )}
                          <span className="ada-violation__toggle">{isExpanded ? '▼' : '▶'}</span>
                        </div>
                        {isExpanded && (
                          <div className="ada-violation__body">
                            {rule.screenshot && typeof rule.screenshot === 'string' && rule.screenshot.trim() && (
                              <div className="ada-violation__screenshot-wrap">
                                <button
                                  type="button"
                                  className="ada-violation__screenshot-btn"
                                  onClick={() => setScreenshotModal({ kind: 'rule', ruleKey: key })}
                                >
                                  View screenshot
                                </button>
                              </div>
                            )}
                            <p className="ada-violation__desc">{rule.description}</p>
                            <p className="ada-violation__help">{rule.help}</p>

                            {/* Why This Matters */}
                            <div className="ada-why-matters">
                              <span className="ada-why-matters__label">Why This Matters</span>
                              <p className="ada-why-matters__text">{getRuleWhyMatters(rule.id, rule.impact)}</p>
                            </div>

                            {wcagMeta && (
                              <div className="ada-wcag-detail">
                                <span className="ada-wcag-detail__criterion">WCAG {wcagMeta.criterion}</span>
                                {wcagMeta.name && <span className="ada-wcag-detail__name">{wcagMeta.name}</span>}
                                <span className={`ada-wcag-detail__level ada-wcag-detail__level--${wcagMeta.level.toLowerCase()}`}>
                                  Level {wcagMeta.level}
                                </span>
                              </div>
                            )}
                            {rule.helpUrl && (
                              <a href={rule.helpUrl} target="_blank" rel="noopener noreferrer" className="ada-violation__link">
                                Full axe documentation →
                              </a>
                            )}
                            <div className="ada-violation__nodes-list">
                              <strong>Affected elements ({rule.nodes?.length ?? 0})</strong>
                              {(rule.nodes || []).slice(0, 20).map((node, idx) => (
                                <div key={idx} className="ada-violation__node">
                                  <div className="ada-violation__node-header">
                                    <code className="ada-violation__target">
                                      {(node.target && (Array.isArray(node.target) ? node.target.flat().join(' ') : node.target)) || '—'}
                                    </code>
                                    <button
                                      type="button"
                                      className={`ada-copy-btn ada-copy-btn--sm ${copied[`node-${key}-${idx}`] ? 'ada-copy-btn--copied' : ''}`}
                                      onClick={() => copyText(`node-${key}-${idx}`, node.html || '')}
                                    >
                                      {copied[`node-${key}-${idx}`] ? '✓' : 'Copy'}
                                    </button>
                                  </div>
                                  {getNodeSummary(node) && (
                                    <p className="ada-violation__node-summary">
                                      {getNodeSummary(node)}
                                    </p>
                                  )}
                                  <pre className="ada-violation__html">{node.html || '—'}</pre>
                                </div>
                              ))}
                              <div className="ada-violation__fix">
                                <div className="ada-violation__fix-header">
                                  <p className="ada-violation__fix-title">
                                    <span className="ada-violation__fix-icon" aria-hidden>
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M9 21h6v-1H9v1zm3-19C7.93 2 5 4.93 5 8.5c0 2.38 1.19 4.27 2.5 5.74V17c0 .55.45 1 1 1h7c.55 0 1-.45 1-1v-2.76c1.31-1.47 2.5-3.36 2.5-5.74C19 4.93 16.07 2 12 2zm3.02 11.92-.52.58V16h-5v-1.5l-.52-.58C7.79 12.59 7 10.86 7 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.86-.79 3.59-1.98 4.92z" />
                                      </svg>
                                    </span>
                                    Recommended fix
                                  </p>
                                  {getRuleFixTips(rule.id).length > 0 && (
                                    <button
                                      type="button"
                                      className={`ada-copy-btn ${copied[`fix-${key}`] ? 'ada-copy-btn--copied' : ''}`}
                                      onClick={() => copyText(`fix-${key}`, getRuleFixTips(rule.id).join('\n'))}
                                    >
                                      {copied[`fix-${key}`] ? '✓ Copied' : 'Copy Guidance'}
                                    </button>
                                  )}
                                </div>
                                <ul className="ada-violation__fix-list">
                                  {getRuleFixTips(rule.id).length > 0 ? (
                                    getRuleFixTips(rule.id).map((tip) => (
                                      <li key={tip}>{tip}</li>
                                    ))
                                  ) : (
                                    <li>Review this rule guidance and apply semantic HTML/valid ARIA where applicable.</li>
                                  )}
                                </ul>
                                {getRuleFixExamples(rule.id).length > 0 && (
                                  <div className="ada-fix-examples">
                                    {getRuleFixExamples(rule.id).map((ex, ei) => (
                                      <div key={ei} className="ada-fix-example">
                                        <span className="ada-fix-example__label">{ex.label}</span>
                                        <pre className="ada-fix-example__code">{ex.code}</pre>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {(rule.nodes?.length ?? 0) > 20 && (
                                <p className="ada-violation__more">… and {(rule.nodes?.length ?? 0) - 20} more</p>
                              )}
                            </div>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            {/* Passes (collapsible) */}
            <section className="ada-passes" aria-label="Passed rules">
              <button
                type="button"
                className="ada-passes__toggle"
                onClick={() => setShowPasses((p) => !p)}
                aria-expanded={showPasses}
              >
                {showPasses ? '▼' : '▶'} Passed rules ({passes.length})
              </button>
              {showPasses && (
                <ul className="ada-passes__list">
                  {passes.map((rule) => (
                    <li key={rule.id || JSON.stringify(rule)} className="ada-passes__item">
                      <span className="ada-passes__id">{rule.id}</span>
                      <span className="ada-passes__nodes">{rule.nodes?.length ?? 0} nodes</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {/* Screenshot popup modal */}
        {modalContent && (
          <div
            className="ada-screenshot-modal"
            role="dialog"
            aria-modal="true"
            aria-label={modalContent.title}
            onClick={() => setScreenshotModal(null)}
          >
            <div className="ada-screenshot-modal__backdrop" />
            <div className="ada-screenshot-modal__box" onClick={(e) => e.stopPropagation()}>
              <div className="ada-screenshot-modal__head">
                <h3 className="ada-screenshot-modal__title">{modalContent.title}</h3>
                <button
                  type="button"
                  className="ada-screenshot-modal__close"
                  onClick={() => setScreenshotModal(null)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className="ada-screenshot-modal__body">
                <img
                  src={modalContent.src}
                  alt={modalContent.title}
                  className="ada-screenshot-modal__img"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
