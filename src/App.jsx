import React, { useState, useEffect, useCallback } from 'react'
import { AppProvider, useApp } from './context/AppContext'
import AppSidebar from './components/shell/AppSidebar'
import AppHeader from './components/shell/AppHeader'
import LandingPage from './pages/LandingPage'
import DashboardPage from './pages/DashboardPage'
import CrawlResultsPage from './pages/CrawlResultsPage'
import KeyboardTestPage from './pages/KeyboardTestPage'
import AIFixPage from './pages/AIFixPage'
import SettingsPage from './pages/SettingsPage'
import NewScanPage from './pages/NewScanPage'
import ScanHistoryView from './components/ScanHistory/ScanHistoryView'
import ADAResultsView from './components/ADAResultsView/ADAResultsView'

function AppInner() {
  const { activePage, dark, setDark, navigate, sidebarOpen, setSidebarOpen, scanHistoryId, setScanHistoryId } = useApp()

  const toggleDark = useCallback(() => {
    setDark((prev) => !prev)
  }, [setDark])

  if (activePage === 'landing') {
    return (
      <LandingPage
        onOpenApp={() => navigate('dashboard')}
        dark={dark}
        toggleDark={toggleDark}
      />
    )
  }

  return (
    <div className={`${dark ? 'dark' : ''} h-screen`}>
      <div className="flex h-screen overflow-hidden bg-ivory dark:bg-night">
        {/* Sidebar */}
        <div
          className={`${
            sidebarOpen ? 'flex' : 'hidden'
          } lg:flex flex-col w-72 flex-shrink-0 border-r border-gray-100 dark:border-white/[0.06]`}
        >
          <AppSidebar />
        </div>

        {/* Mobile sidebar backdrop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/30 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <AppHeader />
          <main className="flex-1 overflow-auto">
            {activePage === 'dashboard' && <DashboardPage />}
            {activePage === 'new-scan' && <NewScanPage />}
            {activePage === 'scan-history' && scanHistoryId == null && (
                <ScanHistoryView onScanClick={(id) => setScanHistoryId(id)} />
              )}
            {activePage === 'scan-history' && scanHistoryId != null && (
                <ADAResultsView
                  scanIdToLoad={scanHistoryId}
                  onClearResult={() => setScanHistoryId(null)}
                />
              )}
            {activePage === 'crawl-results' && <CrawlResultsPage />}
            {activePage === 'keyboard-test' && <KeyboardTestPage />}
            {activePage === 'ai-fix' && <AIFixPage />}
            {activePage === 'settings' && <SettingsPage />}
          </main>
        </div>
      </div>
    </div>
  )
}

function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  )
}

export default App
