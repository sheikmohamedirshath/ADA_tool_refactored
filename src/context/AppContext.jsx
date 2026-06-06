import React, { createContext, useContext, useState, useEffect } from 'react';

const PAGE_TO_PATH = {
  landing:        '/',
  dashboard:      '/dashboard',
  'new-scan':     '/new-scan',
  'scan-history': '/scan-history',
  'crawl-results': '/crawl-results',
  'keyboard-test': '/keyboard-test',
  'ai-fix':       '/ai-fix',
  settings:       '/settings',
};

const PATH_TO_PAGE = Object.fromEntries(
  Object.entries(PAGE_TO_PATH).map(([page, path]) => [path, page])
);

function pageFromPath(pathname) {
  return PATH_TO_PAGE[pathname] ?? 'landing';
}

export const AppContext = createContext({
  dark: false,
  setDark: () => {},
  activePage: 'landing',
  navigate: () => {},
  crawlId: null,
  setCrawlId: () => {},
  sidebarOpen: true,
  setSidebarOpen: () => {},
  scanHistoryId: null,
  setScanHistoryId: () => {},
});

export function AppProvider({ children }) {
  const [dark, setDark] = useState(false);
  const [activePage, setActivePage] = useState(() => pageFromPath(window.location.pathname));
  const [crawlId, setCrawlId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [scanHistoryId, setScanHistoryId] = useState(null);

  function navigate(page) {
    const path = PAGE_TO_PATH[page] ?? '/';
    window.history.pushState({ page }, '', path);
    setActivePage(page);
    if (page !== 'scan-history') setScanHistoryId(null);
  }

  useEffect(() => {
    function handlePopState(event) {
      const page = event.state?.page ?? pageFromPath(window.location.pathname);
      setActivePage(page);
    }
    window.addEventListener('popstate', handlePopState);
    // Replace the initial history entry so the first back-press works correctly
    const initialPage = pageFromPath(window.location.pathname);
    window.history.replaceState({ page: initialPage }, '', window.location.pathname);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return (
    <AppContext.Provider
      value={{
        dark,
        setDark,
        activePage,
        navigate,
        crawlId,
        setCrawlId,
        sidebarOpen,
        setSidebarOpen,
        scanHistoryId,
        setScanHistoryId,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
