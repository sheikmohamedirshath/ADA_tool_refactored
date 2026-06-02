import React, { useState, useEffect } from 'react'
import './CrawlProgressView.css'

const STATUS_LABELS = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
}

export default function CrawlProgressView({ crawlId, rootUrl, onBack, onViewResults }) {
  const [job, setJob] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!crawlId) return
    let cancelled = false

    const fetchStatus = async () => {
      if (cancelled) return
      try {
        const res = await fetch(`/api/crawl/${encodeURIComponent(crawlId)}`)
        const data = await res.json()
        if (cancelled) return
        if (!res.ok || !data.ok) {
          setError(data.error || 'Failed to fetch crawl status')
          return
        }
        setError(null)
        setJob(data.job)
        if (data.job.status === 'completed' || data.job.status === 'failed') {
          clearInterval(timerId)
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Network error')
      }
    }

    fetchStatus()
    let timerId = setInterval(fetchStatus, 3000)

    return () => {
      cancelled = true
      clearInterval(timerId)
    }
  }, [crawlId])

  const status = job?.status || 'pending'
  const maxPages = job?.max_pages || 50
  const discovered = job?.total_discovered || 0
  const scanned = job?.total_scanned || 0
  const failed = job?.total_failed || 0
  const processed = scanned + failed
  const progressPct = maxPages > 0 ? Math.min(100, Math.round((processed / maxPages) * 100)) : 0

  return (
    <main className="crawl-progress" role="main">
      <div className="crawl-progress__inner">

        <div className="crawl-progress__header">
          <div className="crawl-progress__header-row">
            <h2 className="crawl-progress__title">Site Crawl</h2>
            <span className={`crawl-progress__badge crawl-progress__badge--${status}`}>
              {STATUS_LABELS[status] || status}
            </span>
          </div>
          <p className="crawl-progress__url" title={rootUrl}>{rootUrl}</p>
        </div>

        <div className="crawl-progress__cards">
          <div className="crawl-progress__card">
            <span className="crawl-progress__card-value">{discovered}</span>
            <span className="crawl-progress__card-label">Pages Discovered</span>
          </div>
          <div className="crawl-progress__card">
            <span className="crawl-progress__card-value">{scanned}</span>
            <span className="crawl-progress__card-label">Pages Scanned</span>
          </div>
          <div className={`crawl-progress__card ${failed > 0 ? 'crawl-progress__card--warn' : ''}`}>
            <span className="crawl-progress__card-value">{failed}</span>
            <span className="crawl-progress__card-label">Pages Failed</span>
          </div>
        </div>

        <div className="crawl-progress__bar-section">
          <div className="crawl-progress__bar-header">
            <span>Progress</span>
            <span>{processed} / {maxPages} pages</span>
          </div>
          <div
            className="crawl-progress__bar-track"
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Crawl progress: ${progressPct}%`}
          >
            <div
              className={`crawl-progress__bar-fill ${status === 'running' ? 'crawl-progress__bar-fill--animate' : ''}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="crawl-progress__bar-pct">{progressPct}%</span>
        </div>

        {job && (
          <div className="crawl-progress__meta">
            <div className="crawl-progress__meta-item">
              <span className="crawl-progress__meta-label">Crawl ID</span>
              <span className="crawl-progress__meta-value crawl-progress__meta-value--mono">{crawlId}</span>
            </div>
            <div className="crawl-progress__meta-item">
              <span className="crawl-progress__meta-label">Started</span>
              <span className="crawl-progress__meta-value">
                {job.created_at ? new Date(job.created_at).toLocaleTimeString() : '—'}
              </span>
            </div>
            <div className="crawl-progress__meta-item">
              <span className="crawl-progress__meta-label">Max Pages</span>
              <span className="crawl-progress__meta-value">{job.max_pages}</span>
            </div>
            <div className="crawl-progress__meta-item">
              <span className="crawl-progress__meta-label">Max Depth</span>
              <span className="crawl-progress__meta-value">{job.max_depth}</span>
            </div>
          </div>
        )}

        {(error || status === 'failed') && (
          <p className="crawl-progress__error" role="alert">
            {error || job?.failure_reason || 'Crawl job failed.'}
          </p>
        )}

        {!job && !error && (
          <p className="crawl-progress__loading">Loading crawl status…</p>
        )}

        <div className="crawl-progress__actions">
          <button
            type="button"
            className="crawl-progress__btn crawl-progress__btn--secondary"
            onClick={onBack}
          >
            Back to Home
          </button>
          {status === 'completed' && (
            <button
              type="button"
              className="crawl-progress__btn crawl-progress__btn--primary"
              onClick={() => onViewResults(crawlId)}
            >
              View Results
            </button>
          )}
        </div>

      </div>
    </main>
  )
}
