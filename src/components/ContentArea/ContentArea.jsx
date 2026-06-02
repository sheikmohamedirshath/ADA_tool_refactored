import React, { useState } from 'react'
import './ContentArea.css'

const searchIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
)

const uploadIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" x2="12" y1="3" y2="15" />
  </svg>
)

const scanIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <rect width="7" height="7" x="3" y="10" rx="1" />
    <rect width="7" height="7" x="14" y="10" rx="1" />
  </svg>
)

const crawlIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
)

export default function ContentArea({
  onProcessUrl,
  onStartCrawl,
  isCrawling = false,
  status = { type: 'idle', message: '' },
}) {
  const [url, setUrl] = useState('')
  const [scanMode, setScanMode] = useState('url') // 'url' | 'upload' | 'crawl'
  const [includeBestPractices, setIncludeBestPractices] = useState(false)
  const [crawlUrl, setCrawlUrl] = useState('')
  const [maxPages, setMaxPages] = useState(50)
  const [maxDepth, setMaxDepth] = useState(3)
  const [fullSite, setFullSite] = useState(false)
  const isLoading = status.type === 'loading'

  const handleSubmit = (e) => {
    e.preventDefault()
    if (scanMode === 'url') {
      const trimmed = url.trim()
      if (trimmed) onProcessUrl?.(trimmed, { includeBestPractices })
    } else if (scanMode === 'crawl') {
      const trimmed = crawlUrl.trim()
      if (trimmed) onStartCrawl?.(trimmed, { maxPages, maxDepth, fullSite })
    }
  }

  const isSubmitDisabled =
    scanMode === 'url' ? (isLoading || !url.trim()) :
    scanMode === 'crawl' ? (isCrawling || !crawlUrl.trim()) :
    true

  const submitLabel =
    scanMode === 'crawl'
      ? (isCrawling ? 'Starting…' : 'START SITE CRAWL')
      : (isLoading ? 'Scanning…' : 'START ACCESSIBILITY SCAN')

  return (
    <main className="app-content" role="main">
      <div className="app-content__inner">
        <h1 className="app-content__title">
          <span className="app-content__title-main">Scan for Accessibility</span>
          <span className="app-content__title-accent"> Violations</span>
        </h1>
        <p className="app-content__description">
          Detect WCAG 2.1 Level AA violations, get detailed reports, and fix issues with code examples.
        </p>

        <form className="app-content__form" onSubmit={handleSubmit}>
          <div className="app-content__card">
            <div className="app-content__tabs">
              <button
                type="button"
                className={`app-content__tab ${scanMode === 'url' ? 'app-content__tab--active' : ''}`}
                onClick={() => setScanMode('url')}
                aria-pressed={scanMode === 'url'}
              >
                <span className="app-content__tab-icon">{searchIcon}</span>
                Scan URL
              </button>
              <button
                type="button"
                className={`app-content__tab ${scanMode === 'upload' ? 'app-content__tab--active' : ''}`}
                onClick={() => setScanMode('upload')}
                aria-pressed={scanMode === 'upload'}
                disabled
                title="Coming soon"
              >
                <span className="app-content__tab-icon">{uploadIcon}</span>
                Upload HTML
              </button>
              <button
                type="button"
                className={`app-content__tab ${scanMode === 'crawl' ? 'app-content__tab--active' : ''}`}
                onClick={() => setScanMode('crawl')}
                aria-pressed={scanMode === 'crawl'}
              >
                <span className="app-content__tab-icon">{crawlIcon}</span>
                Crawl Site
              </button>
            </div>

            {scanMode === 'url' && (
              <>
                <label className="app-content__label" htmlFor="scan-url">
                  ENTER WEBSITE URL
                </label>
                <input
                  id="scan-url"
                  type="url"
                  className="app-content__input"
                  placeholder="https://example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  aria-label="Website URL to scan"
                  autoComplete="url"
                  disabled={isLoading}
                />
                <div className="app-content__scan-option">
                  <label className="app-content__toggle" htmlFor="best-practice-toggle">
                    <span className="app-content__toggle-label">
                      Best Practices
                      <small className="app-content__toggle-help">Adds non-WCAG checks; issue count may increase.</small>
                    </span>
                    <input
                      id="best-practice-toggle"
                      type="checkbox"
                      checked={includeBestPractices}
                      onChange={(e) => setIncludeBestPractices(e.target.checked)}
                      disabled={isLoading}
                    />
                    <span className="app-content__toggle-track" aria-hidden>
                      <span className="app-content__toggle-thumb" />
                    </span>
                  </label>
                </div>
              </>
            )}

            {scanMode === 'upload' && (
              <div className="app-content__upload-placeholder">
                <p>Upload HTML file (coming soon)</p>
              </div>
            )}

            {scanMode === 'crawl' && (
              <>
                <label className="app-content__label" htmlFor="crawl-url">
                  ENTER ROOT URL TO CRAWL
                </label>
                <input
                  id="crawl-url"
                  type="url"
                  className="app-content__input"
                  placeholder="https://example.com"
                  value={crawlUrl}
                  onChange={(e) => setCrawlUrl(e.target.value)}
                  aria-label="Root URL to crawl"
                  autoComplete="url"
                  disabled={isCrawling}
                />

                <div className="app-content__scan-option">
                  <label className="app-content__toggle" htmlFor="full-site-toggle">
                    <span className="app-content__toggle-label">
                      Full Site Crawl
                      <small className="app-content__toggle-help">
                        No page limit — crawls the entire site (up to 10,000 pages).
                      </small>
                    </span>
                    <input
                      id="full-site-toggle"
                      type="checkbox"
                      checked={fullSite}
                      onChange={(e) => setFullSite(e.target.checked)}
                      disabled={isCrawling}
                    />
                    <span className="app-content__toggle-track" aria-hidden>
                      <span className="app-content__toggle-thumb" />
                    </span>
                  </label>
                </div>

                {!fullSite && (
                  <div className="app-content__crawl-config">
                    <div className="app-content__crawl-field">
                      <label className="app-content__label" htmlFor="crawl-max-pages">
                        MAX PAGES
                      </label>
                      <input
                        id="crawl-max-pages"
                        type="number"
                        className="app-content__input app-content__input--number"
                        min={1}
                        max={500}
                        value={maxPages}
                        onChange={(e) => setMaxPages(Math.max(1, Math.min(500, Number(e.target.value))))}
                        disabled={isCrawling}
                      />
                    </div>
                    <div className="app-content__crawl-field">
                      <label className="app-content__label" htmlFor="crawl-max-depth">
                        MAX DEPTH
                      </label>
                      <input
                        id="crawl-max-depth"
                        type="number"
                        className="app-content__input app-content__input--number"
                        min={1}
                        max={10}
                        value={maxDepth}
                        onChange={(e) => setMaxDepth(Math.max(1, Math.min(10, Number(e.target.value))))}
                        disabled={isCrawling}
                      />
                    </div>
                  </div>
                )}

                {fullSite ? (
                  <p className="app-content__crawl-warn">
                    Full site crawl enabled. This may take several hours for large sites.
                    The crawl runs in the background — you can close this page anytime.
                  </p>
                ) : (
                  <p className="app-content__crawl-hint">
                    Crawls up to {maxPages} pages starting from the root URL, following internal links up to depth {maxDepth}.
                  </p>
                )}
              </>
            )}

            <button
              type="submit"
              className="app-content__submit"
              disabled={isSubmitDisabled}
            >
              <span className="app-content__submit-icon">
                {scanMode === 'crawl' ? crawlIcon : scanIcon}
              </span>
              {submitLabel}
            </button>
          </div>
        </form>

        {status.message && status.type !== 'idle' && !isLoading && (
          <p
            className={`app-content__status app-content__status--${status.type}`}
            role="status"
          >
            {status.message}
          </p>
        )}

        {isLoading && (
          <section className="app-content__loader" aria-live="polite" aria-label="Scan in progress">
            <div className="app-content__loader-bars" aria-hidden>
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <p className="app-content__loader-text">
              Running accessibility scan
              <span className="app-content__loader-note"> (this may take 1-2 minutes)</span>
              <span className="app-content__loader-dots" aria-hidden>
                <span>.</span><span>.</span><span>.</span>
              </span>
            </p>
          </section>
        )}
      </div>
    </main>
  )
}
