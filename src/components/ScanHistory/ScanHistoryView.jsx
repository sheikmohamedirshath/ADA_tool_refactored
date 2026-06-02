import React, { useState, useEffect } from 'react'
import './ScanHistoryView.css'

function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export default function ScanHistoryView({ onScanClick }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [historyMessage, setHistoryMessage] = useState('')
  const [historyAvailable, setHistoryAvailable] = useState(true)

  const handleScanIdClick = (item) => {
    if (!onScanClick || !item?.id) return
    const numId = item.id.replace(/^SCAN-/, '')
    const id = parseInt(numId, 10)
    if (!Number.isNaN(id)) onScanClick(id)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setHistoryMessage('')
    setHistoryAvailable(true)
    fetch('/api/history')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        if (data.ok && Array.isArray(data.items)) {
          setItems(data.items)
          setHistoryAvailable(data.available !== false)
          setHistoryMessage(data.message || '')
        } else {
          setError(data.error || 'Failed to load history')
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Network error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  return (
    <main className="scan-history" role="main">
      <div className="scan-history__inner">
        <h1 className="scan-history__title">Scan history</h1>
        <p className="scan-history__intro">
          Each run is saved in the database with URL, timestamp, pass rate, and violation count
          so you can use it as a regression log.
        </p>
        {!loading && !error && historyMessage && (
          <p className={historyAvailable ? 'scan-history__empty' : 'scan-history__error'} role={historyAvailable ? undefined : 'status'}>
            {historyMessage}
          </p>
        )}

        {loading && (
          <p className="scan-history__empty">Loading scan history…</p>
        )}
        {error && (
          <p className="scan-history__error" role="alert">
            {error}
          </p>
        )}
        {!loading && !error && items.length === 0 && historyAvailable && (
          <p className="scan-history__empty">
            No scans yet. Run a URL from the Home page and the results will appear here.
          </p>
        )}
        {!loading && !error && items.length > 0 && historyAvailable && (
          <div className="scan-history__table-wrap">
            <table className="scan-history__table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>URL</th>
                  <th>Timestamp</th>
                  <th>Pass rate</th>
                  <th>Violations</th>
                  <th>Profile</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="scan-history__cell-id">
                      {onScanClick ? (
                        <button
                          type="button"
                          className="scan-history__id-link"
                          onClick={() => handleScanIdClick(item)}
                        >
                          {item.id}
                        </button>
                      ) : (
                        item.id
                      )}
                    </td>
                    <td className="scan-history__cell-url">
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noopener noreferrer">
                          {item.url}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{formatDate(item.timestamp)}</td>
                    <td>{item.passRate != null ? `${item.passRate}%` : '—'}</td>
                    <td>{item.violations ?? '—'}</td>
                    <td>{item.includeBestPractices ? 'WCAG 2.1 AA + Best Practices' : 'WCAG 2.1 AA'}</td>
                    <td>{item.usedFallback ? 'Fallback' : 'Live run'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}
