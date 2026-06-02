import React, { useEffect, useMemo, useState } from 'react'
import './AssistedTestView.css'

const MODULES = [
  { id: 'keyboard', label: 'Keyboard', wcag: 'SC 2.1.1', description: 'Keyboard access and focus flow.' },
  { id: 'forms', label: 'Forms', wcag: 'SC 1.3.1', description: 'Labels, errors, and form feedback.' },
  { id: 'images', label: 'Images', wcag: 'SC 1.1.1', description: 'Alternative text and icon labels.' },
  { id: 'color-contrast', label: 'Color Contrast', wcag: 'SC 1.4.3', description: 'Text readability and state contrast.' },
]

const MODULE_ENDPOINTS = {
  keyboard: '/api/assisted/keyboard',
  'color-contrast': '/api/assisted/color-contrast',
}
const ELEMENTS_PER_PAGE = 5

function toTitleCase(value) {
  return (value || '')
    .split(/[\s-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function guessAreaFromTarget(target) {
  const t = (target || '').toLowerCase()
  if (!t) return 'General content'
  if (t.includes('menu') || t.includes('nav') || t.includes('header')) return 'Navigation and header'
  if (t.includes('footer')) return 'Footer'
  if (t.includes('form') || t.includes('input') || t.includes('label') || t.includes('button')) return 'Forms and actions'
  if (t.includes('card') || t.includes('section') || t.includes('content')) return 'Main content'
  return 'General content'
}

function buildReadableSummary(moduleId, result) {
  const passed = Boolean(result?.passed)
  const totalAffected = Number(result?.totalAffectedElements || 0)
  if (moduleId === 'color-contrast') {
    if (passed) {
      return 'Good news: no contrast issues were detected for this page in the automated scan.'
    }
    return `${totalAffected} text element(s) may be hard to read due to low color contrast.`
  }
  if (moduleId === 'keyboard') {
    if (passed) {
      return 'Keyboard automation checks passed for this page.'
    }
    const failedCount = Array.isArray(result?.failedChecks) ? result.failedChecks.length : 0
    return `Keyboard automation found ${failedCount} issue(s) that may block keyboard users.`
  }
  return result?.summary || 'Automation completed.'
}

function getModulePurpose(moduleId) {
  if (moduleId === 'color-contrast') {
    return 'Color contrast testing checks whether text is readable against its background and across states like hover and focus.'
  }
  if (moduleId === 'keyboard') {
    return 'Keyboard testing checks whether users can navigate and operate interactive elements using only the keyboard.'
  }
  return 'This module runs automated accessibility checks for the selected area.'
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL((value || '').trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export default function AssistedTestView({ lastScannedUrl = '' }) {
  const [url, setUrl] = useState(lastScannedUrl || '')
  const [selectedModule, setSelectedModule] = useState('')
  const [viewMode, setViewMode] = useState('setup') // setup | result
  const [error, setError] = useState('')
  const [autoRunLoading, setAutoRunLoading] = useState(false)
  const [autoRunResult, setAutoRunResult] = useState(null)
  const [elementsPage, setElementsPage] = useState(0)
  const [copiedSelector, setCopiedSelector] = useState('')
  const selectedModuleConfig = useMemo(
    () => MODULES.find((m) => m.id === selectedModule) || null,
    [selectedModule]
  )

  const handleStart = async () => {
    if (!isValidHttpUrl(url)) {
      setError('Enter a valid URL (http/https) to continue.')
      return
    }
    if (!selectedModule) {
      setError('Choose one assisted module.')
      return
    }
    if (!MODULE_ENDPOINTS[selectedModule]) {
      setError('This module is not automated yet. Please choose Keyboard or Color Contrast.')
      return
    }
    setError('')
    setAutoRunResult(null)
    const endpoint = MODULE_ENDPOINTS[selectedModule]
    setAutoRunLoading(true)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        setError(data?.error || 'Automation failed.')
        return
      }
      setAutoRunResult(data.result || null)
      setViewMode('result')
    } catch (e) {
      setError(e.message || 'Automation failed.')
    } finally {
      setAutoRunLoading(false)
    }
  }

  const affectedAreas = useMemo(() => {
    const samples = autoRunResult?.affectedSamples || []
    const counts = {}
    for (const sample of samples) {
      const area = guessAreaFromTarget(sample?.target)
      counts[area] = (counts[area] || 0) + 1
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([area, count]) => ({ area, count }))
  }, [autoRunResult])

  const fixActions = useMemo(() => {
    if (selectedModule === 'color-contrast') {
      return [
        'Use text and background colors that meet WCAG 2.1 AA contrast ratios.',
        'Re-check button, menu, hover, and focus states (not just default state).',
        'Avoid light gray text on white backgrounds for body text and labels.',
      ]
    }
    if (selectedModule === 'keyboard') {
      return [
        'Ensure all interactive controls are reachable with Tab and Shift+Tab.',
        'Keep a visible focus indicator on focused elements.',
        'Support Enter/Space activation for custom buttons and controls.',
      ]
    }
    return []
  }, [selectedModule])

  const verdictText = autoRunResult?.passed ? 'Pass' : 'Needs Fix'
  const readableSummary = buildReadableSummary(selectedModule, autoRunResult)
  const modulePurpose = getModulePurpose(selectedModule)
  const affectedSamples = autoRunResult?.affectedSamples || []
  const groupedTargets = autoRunResult?.groupedTargets || []
  const ratioOverview = autoRunResult?.ratioOverview || null
  const totalElementPages = Math.max(1, Math.ceil(affectedSamples.length / ELEMENTS_PER_PAGE))
  const pagedAffectedSamples = affectedSamples.slice(
    elementsPage * ELEMENTS_PER_PAGE,
    elementsPage * ELEMENTS_PER_PAGE + ELEMENTS_PER_PAGE
  )

  useEffect(() => {
    setElementsPage(0)
    setCopiedSelector('')
  }, [autoRunResult, selectedModule])

  const handleCopySelector = async (selector) => {
    const value = (selector || '').trim()
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopiedSelector(value)
      setTimeout(() => {
        setCopiedSelector((prev) => (prev === value ? '' : prev))
      }, 1400)
    } catch {
      // ignore clipboard errors silently
    }
  }

  return (
    <main className="assisted">
      <div className="assisted__inner">
        <h1 className="assisted__title">Assisted Test</h1>
        <p className="assisted__intro">{modulePurpose}</p>

        {viewMode === 'setup' && (
          <>
            <section className="assisted__card">
              <h2 className="assisted__section-title">What this does</h2>
              <p className="assisted__text">
                Select one module, provide a page URL, and run automation. The tool will return a clear verdict,
                affected areas, and practical fix actions.
              </p>
            </section>

            <section className="assisted__card">
              <h2 className="assisted__section-title">Target URL</h2>
              <div className="assisted__url-row">
                <input
                  className="assisted__input"
                  type="url"
                  placeholder="https://example.com/page"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <button
                  type="button"
                  className="assisted__ghost"
                  onClick={() => setUrl(lastScannedUrl || '')}
                  disabled={!lastScannedUrl}
                >
                  Use last URL
                </button>
              </div>
            </section>

            <section className="assisted__card">
              <h2 className="assisted__section-title">Choose One Automated Module</h2>
              <div className="assisted__grid">
                {MODULES.map((m) => {
                  const active = selectedModule === m.id
                  const automated = Boolean(MODULE_ENDPOINTS[m.id])
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`assisted__module ${active ? 'assisted__module--active' : ''}`}
                      onClick={() => {
                        setSelectedModule(m.id)
                        setError('')
                        setAutoRunResult(null)
                      }}
                    >
                      <span className="assisted__module-title">{m.label}</span>
                      <span className="assisted__module-sc">{m.wcag} {automated ? '' : ' - Coming soon'}</span>
                      <span className="assisted__module-desc">{m.description}</span>
                    </button>
                  )
                })}
              </div>
              <div className="assisted__actions">
                <button type="button" className="assisted__start" onClick={handleStart} disabled={autoRunLoading}>
                  {autoRunLoading
                    ? `Running ${selectedModule ? toTitleCase(selectedModule) : 'automation'}...`
                    : 'Run Automated Test'}
                </button>
                {error && <p className="assisted__error">{error}</p>}
              </div>
            </section>
          </>
        )}

        {viewMode === 'result' && autoRunResult && (
          <>
            <section className="assisted__card assisted__result-head">
              <div>
                <h2 className="assisted__section-title">{selectedModuleConfig?.label || 'Automation'} Results</h2>
                <p className="assisted__text">{readableSummary}</p>
              </div>
              <div className={`assisted__verdict ${autoRunResult.passed ? 'assisted__verdict--pass' : 'assisted__verdict--fail'}`}>
                {verdictText}
              </div>
            </section>

            {selectedModule === 'color-contrast' && ratioOverview && (
              <section className="assisted__card">
                <h3 className="assisted__subheading">Contrast Ratio Overview</h3>
                <div className="assisted__ratio-grid">
                  <div className="assisted__ratio-item">
                    <span className="assisted__ratio-label">Required (WCAG AA)</span>
                    <strong className="assisted__ratio-value">{ratioOverview.requiredAA}:1</strong>
                  </div>
                  <div className="assisted__ratio-item">
                    <span className="assisted__ratio-label">Lowest found</span>
                    <strong className="assisted__ratio-value">
                      {ratioOverview.lowestFound != null ? `${ratioOverview.lowestFound}:1` : 'N/A'}
                    </strong>
                  </div>
                  <div className="assisted__ratio-item">
                    <span className="assisted__ratio-label">Average found</span>
                    <strong className="assisted__ratio-value">
                      {ratioOverview.averageFound != null ? `${ratioOverview.averageFound}:1` : 'N/A'}
                    </strong>
                  </div>
                </div>
              </section>
            )}

            <section className="assisted__card">
              <h3 className="assisted__subheading">Affected Areas</h3>
              {affectedAreas.length === 0 ? (
                <p className="assisted__text">No high-risk areas were detected.</p>
              ) : (
                <ul className="assisted__list">
                  {affectedAreas.map((item) => (
                    <li key={item.area}>{item.area} ({item.count})</li>
                  ))}
                </ul>
              )}
            </section>

            <section className="assisted__card">
              <h3 className="assisted__subheading">Priority Fix Groups</h3>
              {groupedTargets.length === 0 ? (
                <p className="assisted__text">No repeated targets found.</p>
              ) : (
                <ul className="assisted__elements">
                  {groupedTargets.slice(0, 8).map((item) => (
                    <li key={item.target} className="assisted__element-item">
                      <div className="assisted__element-head">
                        <code className="assisted__element-target">{item.target}</code>
                        <span className="assisted__repeat-count">{item.count}x</span>
                      </div>
                      <p className="assisted__element-summary">
                        {item.summary || 'Increase contrast for this repeated target.'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="assisted__card">
              <h3 className="assisted__subheading">
                Detailed Element List
                {typeof autoRunResult?.totalAffectedElements === 'number' && (
                  <span className="assisted__meta"> ({autoRunResult.totalAffectedElements} total)</span>
                )}
              </h3>
              {affectedSamples.length === 0 ? (
                <p className="assisted__text">No affected element samples are available for this run.</p>
              ) : (
                <>
                  <ul className="assisted__elements">
                    {pagedAffectedSamples.map((sample, index) => (
                      <li key={`${sample.target}-${index}`} className="assisted__element-item">
                        <div className="assisted__element-head">
                          <code className="assisted__element-target">{sample.target}</code>
                          <button
                            type="button"
                            className="assisted__copy-btn"
                            onClick={() => handleCopySelector(sample.target)}
                            title="Copy selector"
                          >
                            {copiedSelector === sample.target ? 'Copied' : 'Copy selector'}
                          </button>
                        </div>
                        <p className="assisted__element-summary">
                          {sample.summary || 'Increase contrast for this text/background combination.'}
                          {sample.ratio?.current != null && sample.ratio?.required != null && (
                            <> (Current {sample.ratio.current}:1, Required {sample.ratio.required}:1, Gap {sample.ratio.gap})</>
                          )}
                        </p>
                      </li>
                    ))}
                  </ul>
                  {totalElementPages > 1 && (
                    <div className="assisted__pagination">
                      <button
                        type="button"
                        className="assisted__ghost"
                        disabled={elementsPage === 0}
                        onClick={() => setElementsPage((p) => Math.max(0, p - 1))}
                      >
                        Previous
                      </button>
                      <span className="assisted__pagination-text">
                        Page {elementsPage + 1} of {totalElementPages}
                      </span>
                      <button
                        type="button"
                        className="assisted__ghost"
                        disabled={elementsPage >= totalElementPages - 1}
                        onClick={() => setElementsPage((p) => Math.min(totalElementPages - 1, p + 1))}
                      >
                        Next
                      </button>
                    </div>
                  )}
                  {typeof autoRunResult?.totalAffectedElements === 'number' && autoRunResult.totalAffectedElements > affectedSamples.length && (
                    <p className="assisted__text assisted__text--subtle">
                      Showing {affectedSamples.length} of {autoRunResult.totalAffectedElements} affected elements.
                    </p>
                  )}
                </>
              )}
            </section>

            <section className="assisted__card">
              <h3 className="assisted__subheading">Recommended Fixes</h3>
              <ul className="assisted__list">
                {fixActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </section>

            <section className="assisted__card">
              <details>
                <summary className="assisted__advanced-title">Advanced Technical Details</summary>
                <div className="assisted__technical-meta">
                  <div><strong>Module:</strong> {autoRunResult.module || selectedModule}</div>
                  <div><strong>Total checks:</strong> {(autoRunResult.checks || []).length}</div>
                  {'totalContrastRules' in (autoRunResult || {}) && (
                    <div><strong>Contrast rules failed:</strong> {autoRunResult.totalContrastRules}</div>
                  )}
                  {'totalAffectedElements' in (autoRunResult || {}) && (
                    <div><strong>Affected elements:</strong> {autoRunResult.totalAffectedElements}</div>
                  )}
                </div>
                <div className="assisted__advanced-grid">
                  {(autoRunResult.checks || []).map((check) => (
                    <div key={check.id} className="assisted__advanced-item">
                      <span className={`assisted__status-chip ${check.passed ? 'assisted__status-chip--pass' : 'assisted__status-chip--fail'}`}>
                        {check.passed ? 'PASS' : 'FAIL'}
                      </span>
                      <div className="assisted__advanced-content">
                        <p className="assisted__advanced-label">{check.label}</p>
                        <p className="assisted__advanced-detail">{check.details}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </section>

            <div className="assisted__actions">
              <button type="button" className="assisted__ghost" onClick={() => setViewMode('setup')}>
                Run another test
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
