import React, { useState, useEffect } from 'react'
import ADAToolHeader from './components/ADAToolHeader/ADAToolHeader'
import Sidebar from './components/Sidebar/Sidebar'
import ContentArea from './components/ContentArea/ContentArea'
import ADAResultsView from './components/ADAResultsView/ADAResultsView'
import ScanHistoryView from './components/ScanHistory/ScanHistoryView'
import AssistedTestView from './components/AssistedTestView/AssistedTestView'
import FooterPagesView from './components/FooterPages/FooterPagesView'
import CrawlProgressView from './components/CrawlProgressView/CrawlProgressView'
import CrawlResultsView from './components/CrawlResultsView/CrawlResultsView'
import Footer from './components/Footer/Footer'
import { footerPages } from './config/footerConfig'
import './App.css'

const THEME_KEY = 'ada-tool-theme'
const POLL_INTERVAL_MS = 2500

export default function App() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'light'
    return (window.localStorage.getItem(THEME_KEY) || 'light')
  })
  const [activeSidebarId, setActiveSidebarId] = useState('home')
  const [status, setStatus] = useState({ type: 'idle', message: '' })
  const [lastAxeResult, setLastAxeResult] = useState(null)
  const [lastProcessResult, setLastProcessResult] = useState(null)
  const [selectedScanId, setSelectedScanId] = useState(null)
  const [lastScannedUrl, setLastScannedUrl] = useState('')
  const [crawlJobId, setCrawlJobId] = useState(null)
  const [crawlRootUrl, setCrawlRootUrl] = useState('')
  const [isCrawling, setIsCrawling] = useState(false)

  useEffect(() => {
    try {
      document.documentElement.setAttribute('data-theme', theme)
      window.localStorage.setItem(THEME_KEY, theme)
    } catch {
      // ignore
    }
  }, [theme])

  const handleThemeToggle = () => {
    setTheme((t) => (t === 'light' ? 'dark' : 'light'))
  }

  const handleProcessUrl = async (url, options = {}) => {
    const includeBestPractices = Boolean(options?.includeBestPractices)
    setStatus({ type: 'loading', message: 'Queuing accessibility scan…' })
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000)

    const pollScanStatus = async (jobId, signal) => {
      while (!signal.aborted) {
        const statusResponse = await fetch(`/api/scan/${encodeURIComponent(jobId)}`, {
          method: 'GET',
          signal,
        })
        const statusText = await statusResponse.text()
        let statusData
        try {
          statusData = statusText ? JSON.parse(statusText) : {}
        } catch {
          throw new Error('Invalid response while polling scan status')
        }
        if (!statusResponse.ok) {
          throw new Error(statusData.error || 'Failed to poll scan status')
        }
        const job = statusData.job
        if (!job) {
          throw new Error('Scan job data missing in status response')
        }
        if (job.status === 'completed') {
          return job
        }
        if (job.status === 'failed') {
          throw new Error(job.failure_reason || job.error || 'Scan job failed')
        }
        setStatus({ type: 'loading', message: `Scan ${job.status}…` })
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      }
      throw new Error('Scan polling was cancelled')
    }

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, includeBestPractices }),
        signal: controller.signal,
      })
      const text = await res.text()
      let data
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        setStatus({
          type: 'error',
          message: 'Server returned invalid response. Make sure Flask is running (python app.py) and try again.',
        })
        return
      }
      if (!res.ok) {
        setStatus({ type: 'error', message: data.error || 'Request failed' })
        return
      }
      const jobId = data.jobId
      if (!jobId) {
        setStatus({ type: 'error', message: 'Unexpected server response: missing job ID' })
        return
      }
      const job = await pollScanStatus(jobId, controller.signal)
      const result = job.result
      setStatus({
        type: 'success',
        message: result?.usedFallback
          ? 'Live scan failed, so the app loaded a fallback sample result for review.'
          : (result?.message || 'Done'),
      })
      if (result?.axeResult) {
        setLastAxeResult(result.axeResult)
        setLastProcessResult(result)
        setLastScannedUrl(result?.axeResult?.url || url || '')
        setActiveSidebarId('ada-results')
      } else {
        setStatus({ type: 'error', message: result?.message || 'No ADA result returned. Try again.' })
      }
    } catch (err) {
      const msg = err.name === 'AbortError'
        ? 'ADA check timed out. Try a simpler URL or run the check locally and upload the JSON.'
        : (err.message || 'Network error')
      setStatus({ type: 'error', message: msg })
    } finally {
      clearTimeout(timeoutId)
    }
  }

  const handleStartCrawl = async (url, { maxPages, maxDepth, fullSite = false }) => {
    setIsCrawling(true)
    setStatus({ type: 'idle', message: '' })
    try {
      const res = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, maxDepth, maxPages, fullSite }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setStatus({ type: 'error', message: data.error || 'Failed to start crawl' })
        return
      }
      setCrawlJobId(data.crawl_id)
      setCrawlRootUrl(url)
      setActiveSidebarId('crawl-progress')
    } catch (err) {
      setStatus({ type: 'error', message: err.message || 'Network error starting crawl' })
    } finally {
      setIsCrawling(false)
    }
  }

  const handleNavigate = (id) => {
    setActiveSidebarId(id)
    if (id === 'home') {
      setStatus({ type: 'idle', message: '' })
    }
    if (id !== 'ada-results') {
      setSelectedScanId(null)
    }
  }

  const handleScanClick = (scanId) => {
    setSelectedScanId(scanId)
    setActiveSidebarId('ada-results')
  }

  const handleClearResult = () => {
    setLastAxeResult(null)
    setLastProcessResult(null)
    setSelectedScanId(null)
  }

  return (
    <div className="app">
      <ADAToolHeader theme={theme} onThemeToggle={handleThemeToggle} onHomeClick={() => handleNavigate('home')} />
      <div className="app-body">
        <Sidebar activeId={activeSidebarId} onNavigate={handleNavigate} />
        <div className="app-content-column">
          {activeSidebarId === 'ada-results' ? (
            <ADAResultsView
              initialResult={lastAxeResult}
              processResult={lastProcessResult}
              scanIdToLoad={selectedScanId}
              onClearResult={handleClearResult}
            />
          ) : activeSidebarId === 'scan-history' ? (
            <ScanHistoryView onScanClick={handleScanClick} />
          ) : activeSidebarId === 'assisted-test' ? (
            <AssistedTestView lastScannedUrl={lastScannedUrl} />
          ) : activeSidebarId === 'crawl-progress' ? (
            <CrawlProgressView
              crawlId={crawlJobId}
              rootUrl={crawlRootUrl}
              onBack={() => handleNavigate('home')}
              onViewResults={(id) => {
                setCrawlJobId(id)
                setActiveSidebarId('crawl-results')
              }}
            />
          ) : activeSidebarId === 'crawl-results' ? (
            <CrawlResultsView
              crawlId={crawlJobId}
              rootUrl={crawlRootUrl}
              onBack={() => setActiveSidebarId('crawl-progress')}
              onNewCrawl={() => handleNavigate('home')}
            />
          ) : footerPages.some((p) => p.id === activeSidebarId) ? (
            <FooterPagesView pageId={activeSidebarId} onBack={() => handleNavigate('home')} />
          ) : (
            <ContentArea
              onProcessUrl={handleProcessUrl}
              onStartCrawl={handleStartCrawl}
              isCrawling={isCrawling}
              status={status}
            />
          )}
          <Footer onNavigate={handleNavigate} />
        </div>
      </div>
    </div>
  )
}
