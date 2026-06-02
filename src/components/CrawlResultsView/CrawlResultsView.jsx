import React, { useState, useEffect, useMemo } from 'react'
import './CrawlResultsView.css'

const STATUS_LABELS = {
  scanned: 'Scanned',
  failed: 'Failed',
  pending: 'Pending',
  skipped: 'Skipped',
}

function SortIcon({ active, dir }) {
  if (!active) {
    return <span className="crawl-results__sort-icon crawl-results__sort-icon--idle" aria-hidden>⇅</span>
  }
  return <span className="crawl-results__sort-icon" aria-hidden>{dir === 'asc' ? '▲' : '▼'}</span>
}

const COLUMNS = [
  { key: 'url', label: 'URL' },
  { key: 'depth', label: 'Depth' },
  { key: 'status', label: 'Status' },
  { key: 'violations', label: 'Violations' },
  { key: 'passes', label: 'Passes' },
  { key: 'pass_rate', label: 'Pass Rate' },
]

export default function CrawlResultsView({ crawlId, rootUrl, onBack, onNewCrawl }) {
  const [job, setJob] = useState(null)
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortKey, setSortKey] = useState('url')
  const [sortDir, setSortDir] = useState('asc')

  useEffect(() => {
    if (!crawlId) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const [jobRes, pagesRes] = await Promise.all([
          fetch(`/api/crawl/${encodeURIComponent(crawlId)}`),
          fetch(`/api/crawl/${encodeURIComponent(crawlId)}/pages`),
        ])
        const [jobData, pagesData] = await Promise.all([jobRes.json(), pagesRes.json()])
        if (cancelled) return
        if (!jobRes.ok || !jobData.ok) throw new Error(jobData.error || 'Failed to load crawl')
        if (!pagesRes.ok || !pagesData.ok) throw new Error(pagesData.error || 'Failed to load pages')
        setJob(jobData.job)
        setPages(pagesData.pages || [])
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load results')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [crawlId])

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const filtered = useMemo(() => {
    let rows = pages
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter((p) => p.url?.toLowerCase().includes(q))
    }
    if (statusFilter !== 'all') {
      rows = rows.filter((p) => p.status === statusFilter)
    }
    return rows
  }, [pages, search, statusFilter])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
      let cmp = 0
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv
      } else {
        cmp = String(av).localeCompare(String(bv))
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortKey, sortDir])

  const scannedPages = pages.filter((p) => p.status === 'scanned')
  const totalScanned = scannedPages.length
  const totalFailed = pages.filter((p) => p.status === 'failed').length
  const totalViolations = pages.reduce((sum, p) => sum + (p.violations || 0), 0)
  const avgPassRate =
    totalScanned > 0
      ? (scannedPages.reduce((sum, p) => sum + (p.pass_rate || 0), 0) / totalScanned).toFixed(1) + '%'
      : '—'

  const displayUrl = rootUrl || job?.root_url || ''

  const exportCSV = () => {
    const headers = ['URL', 'Depth', 'Status', 'Violations', 'Passes', 'Pass Rate (%)']
    const rows = sorted.map((p) => [
      `"${(p.url || '').replace(/"/g, '""')}"`,
      p.depth ?? '',
      p.status || '',
      p.violations ?? '',
      p.passes ?? '',
      p.pass_rate != null ? Number(p.pass_rate).toFixed(1) : '',
    ])
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `crawl-${crawlId}-results.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportJSON = () => {
    const payload = { crawlId, rootUrl: displayUrl, pages: sorted }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `crawl-${crawlId}-results.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <main className="crawl-results" role="main">
        <div className="crawl-results__inner">
          <p className="crawl-results__loading">Loading results…</p>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="crawl-results" role="main">
        <div className="crawl-results__inner">
          <p className="crawl-results__error" role="alert">{error}</p>
          <div className="crawl-results__actions">
            <button type="button" className="crawl-results__btn crawl-results__btn--secondary" onClick={onBack}>
              Back to Progress
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="crawl-results" role="main">
      <div className="crawl-results__inner">

        {/* Header */}
        <div className="crawl-results__header">
          <div className="crawl-results__header-row">
            <h2 className="crawl-results__title">Crawl Results</h2>
            <span className="crawl-results__badge crawl-results__badge--completed">Completed</span>
          </div>
          {displayUrl && (
            <p className="crawl-results__url" title={displayUrl}>{displayUrl}</p>
          )}
        </div>

        {/* Summary cards */}
        <div className="crawl-results__cards">
          <div className="crawl-results__card">
            <span className="crawl-results__card-value">{totalScanned}</span>
            <span className="crawl-results__card-label">Pages Scanned</span>
          </div>
          <div className="crawl-results__card">
            <span className="crawl-results__card-value">{avgPassRate}</span>
            <span className="crawl-results__card-label">Avg Pass Rate</span>
          </div>
          <div className={`crawl-results__card ${totalViolations > 0 ? 'crawl-results__card--warn' : ''}`}>
            <span className="crawl-results__card-value">{totalViolations}</span>
            <span className="crawl-results__card-label">Total Violations</span>
          </div>
          <div className={`crawl-results__card ${totalFailed > 0 ? 'crawl-results__card--warn' : ''}`}>
            <span className="crawl-results__card-value">{totalFailed}</span>
            <span className="crawl-results__card-label">Pages Failed</span>
          </div>
        </div>

        {/* Controls: search + filter + export */}
        <div className="crawl-results__controls">
          <div className="crawl-results__search-wrap">
            <svg
              className="crawl-results__search-icon"
              width="16" height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="search"
              className="crawl-results__search"
              placeholder="Filter by URL…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Filter pages by URL"
            />
          </div>

          <div className="crawl-results__filter-group">
            {['all', 'scanned', 'failed'].map((s) => (
              <button
                key={s}
                type="button"
                className={`crawl-results__filter-btn ${statusFilter === s ? 'crawl-results__filter-btn--active' : ''}`}
                onClick={() => setStatusFilter(s)}
              >
                {s === 'all' ? 'All' : STATUS_LABELS[s] || s}
              </button>
            ))}
          </div>

          <div className="crawl-results__export-group">
            <button type="button" className="crawl-results__export-btn" onClick={exportCSV}>
              ↓ CSV
            </button>
            <button type="button" className="crawl-results__export-btn" onClick={exportJSON}>
              ↓ JSON
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="crawl-results__table-wrap">
          {sorted.length === 0 ? (
            <p className="crawl-results__empty">
              {pages.length === 0 ? 'No pages were recorded for this crawl.' : 'No pages match your filter.'}
            </p>
          ) : (
            <table className="crawl-results__table" aria-label="Crawled pages results">
              <thead>
                <tr>
                  {COLUMNS.map(({ key, label }) => (
                    <th
                      key={key}
                      className={`crawl-results__th crawl-results__th--${key} ${sortKey === key ? 'crawl-results__th--sorted' : ''}`}
                      onClick={() => handleSort(key)}
                      aria-sort={sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && handleSort(key)}
                    >
                      <span className="crawl-results__th-content">
                        {label}
                        <SortIcon active={sortKey === key} dir={sortDir} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((page) => (
                  <tr key={page.id ?? page.url} className="crawl-results__row">
                    <td className="crawl-results__td crawl-results__td--url">
                      <a
                        href={page.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="crawl-results__url-link"
                        title={page.url}
                      >
                        {page.url}
                      </a>
                    </td>
                    <td className="crawl-results__td crawl-results__td--center">
                      {page.depth ?? '—'}
                    </td>
                    <td className="crawl-results__td">
                      <span className={`crawl-results__status-badge crawl-results__status-badge--${page.status}`}>
                        {STATUS_LABELS[page.status] || page.status}
                      </span>
                    </td>
                    <td className={`crawl-results__td crawl-results__td--center ${(page.violations || 0) > 0 ? 'crawl-results__td--violations' : ''}`}>
                      {page.violations ?? '—'}
                    </td>
                    <td className="crawl-results__td crawl-results__td--center">
                      {page.passes ?? '—'}
                    </td>
                    <td className="crawl-results__td">
                      {page.pass_rate != null ? (
                        <div className="crawl-results__pass-rate">
                          <div className="crawl-results__pass-bar-track" aria-hidden>
                            <div
                              className="crawl-results__pass-bar-fill"
                              style={{ width: `${Math.min(100, Math.max(0, page.pass_rate))}%` }}
                            />
                          </div>
                          <span className="crawl-results__pass-pct">{Number(page.pass_rate).toFixed(1)}%</span>
                        </div>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Row count */}
        <p className="crawl-results__count">
          {sorted.length === pages.length
            ? `${pages.length} page${pages.length !== 1 ? 's' : ''} total`
            : `${sorted.length} of ${pages.length} pages`}
        </p>

        {/* Actions */}
        <div className="crawl-results__actions">
          <button
            type="button"
            className="crawl-results__btn crawl-results__btn--secondary"
            onClick={onBack}
          >
            Back to Progress
          </button>
          <button
            type="button"
            className="crawl-results__btn crawl-results__btn--secondary"
            onClick={onNewCrawl}
          >
            New Crawl
          </button>
        </div>

      </div>
    </main>
  )
}
