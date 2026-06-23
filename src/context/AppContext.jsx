import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const CRAWL_ID_KEY = 'ada_crawl_id';
const AUTH_KEY     = 'ada_auth';

const PAGE_TO_PATH = {
  landing:              '/',
  login:                '/login',
  signup:               '/signup',
  'verify-email':       '/verify-email',
  dashboard:            '/dashboard',
  'new-scan':           '/new-scan',
  'scan-history':       '/scan-history',
  'crawl-history':      '/crawl-history',
  'crawl-results':      '/crawl-results',
  'crawl-schedules':    '/crawl-schedules',
  'executive-summary':  '/executive-summary',
  alerts:               '/alerts',
  'digest-history':     '/digest-history',
  'keyboard-test':      '/keyboard-test',   // legacy route — kept for backward compat
  'assistive-test':     '/assistive-test',
  'assistive-results':  '/assistive-results',
  'ai-fix':             '/ai-fix',
  'wcag-reference':     '/wcag-reference',
  integrations:         '/integrations',
  settings:             '/settings',
};

const PATH_TO_PAGE = Object.fromEntries(
  Object.entries(PAGE_TO_PATH).map(([page, path]) => [path, page])
);

function pageFromPath(pathname) {
  return PATH_TO_PAGE[pathname] ?? 'landing';
}

function getInitialPage() {
  try {
    const params = new URLSearchParams(window.location.search);
    const extPage = params.get('_ext_page');
    if (extPage && PAGE_TO_PATH[extPage]) return extPage;
  } catch {}
  return pageFromPath(window.location.pathname);
}

function readStoredCrawlId() {
  try { return sessionStorage.getItem(CRAWL_ID_KEY) || null; } catch { return null; }
}

function readStoredAuth() {
  // Extension auth handoff: _ext_auth param carries {token, user} JSON from the popup.
  // Read it synchronously before first render so we never flash the login screen.
  try {
    const params = new URLSearchParams(window.location.search);
    const extAuth = params.get('_ext_auth');
    if (extAuth) {
      const parsed = JSON.parse(decodeURIComponent(extAuth));
      if (parsed.token && parsed.user) {
        sessionStorage.setItem(AUTH_KEY, JSON.stringify(parsed));
        return parsed;
      }
    }
  } catch {}

  try {
    const raw = sessionStorage.getItem(AUTH_KEY);
    if (!raw) return { user: null, token: null };
    return JSON.parse(raw);
  } catch {
    return { user: null, token: null };
  }
}

export const AppContext = createContext({
  dark: false,
  setDark: () => {},
  activePage: 'landing',
  navigate: () => {},
  crawlId: null,
  setCrawlId: () => {},
  clearCrawlId: () => {},
  sidebarOpen: true,
  setSidebarOpen: () => {},
  scanHistoryId: null,
  setScanHistoryId: () => {},
  wcagCriterionId: null,
  setWcagCriterionId: () => {},
  pendingAssistiveUrl: '',
  setPendingAssistiveUrl: () => {},
  pendingAssistiveModule: null,
  setPendingAssistiveModule: () => {},
  assistiveResult: null,
  setAssistiveResult: () => {},
  user: null,
  token: null,
  isAuthenticated: false,
  login: () => {},
  logout: () => {},
});

export function AppProvider({ children }) {
  const [dark, setDark] = useState(false);
  const [activePage, setActivePage] = useState(getInitialPage);
  const [crawlId, setCrawlIdState] = useState(readStoredCrawlId);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [scanHistoryId, setScanHistoryId] = useState(null);
  const [wcagCriterionId, setWcagCriterionId] = useState(null);
  const [pendingAssistiveUrl, setPendingAssistiveUrl] = useState('');
  const [pendingAssistiveModule, setPendingAssistiveModule] = useState(null);
  const [assistiveResult, setAssistiveResult] = useState(null);

  const stored = readStoredAuth();
  const [user, setUser] = useState(stored.user);
  const [token, setToken] = useState(stored.token);

  const login = useCallback((userData, tokenValue) => {
    setUser(userData);
    setToken(tokenValue);
    try { sessionStorage.setItem(AUTH_KEY, JSON.stringify({ user: userData, token: tokenValue })); } catch {}
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    try { sessionStorage.removeItem(AUTH_KEY); } catch {}
  }, []);

  function setCrawlId(id) {
    try {
      if (id) sessionStorage.setItem(CRAWL_ID_KEY, id);
      else sessionStorage.removeItem(CRAWL_ID_KEY);
    } catch {}
    setCrawlIdState(id);
  }

  function clearCrawlId() {
    setCrawlId(null);
  }

  function navigate(page) {
    const path = PAGE_TO_PATH[page] ?? '/';
    window.history.pushState({ page }, '', path);
    setActivePage(page);
    setScanHistoryId(null);
    if (page !== 'wcag-reference') setWcagCriterionId(null);
  }

  // Clean up extension handoff params from the URL so they're not visible or bookmarked.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('_ext_auth')) {
      const targetPage = params.get('_ext_page') ?? 'scan-history';
      const cleanPath  = PAGE_TO_PATH[targetPage] ?? '/scan-history';
      window.history.replaceState({ page: targetPage }, '', cleanPath);
    }
  }, []);

  useEffect(() => {
    function handlePopState(event) {
      const page = event.state?.page ?? pageFromPath(window.location.pathname);
      setActivePage(page);
      setScanHistoryId(null);
    }
    window.addEventListener('popstate', handlePopState);
    const initialPage = pageFromPath(window.location.pathname);
    window.history.replaceState({ page: initialPage }, '', window.location.pathname);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    function handleAuthExpired() {
      setUser(null);
      setToken(null);
      try { sessionStorage.removeItem(AUTH_KEY); } catch {}
      setActivePage('login');
      window.history.pushState({ page: 'login' }, '', '/login');
    }
    window.addEventListener('ada:auth-expired', handleAuthExpired);
    return () => window.removeEventListener('ada:auth-expired', handleAuthExpired);
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
        clearCrawlId,
        sidebarOpen,
        setSidebarOpen,
        scanHistoryId,
        setScanHistoryId,
        wcagCriterionId,
        setWcagCriterionId,
        pendingAssistiveUrl,
        setPendingAssistiveUrl,
        pendingAssistiveModule,
        setPendingAssistiveModule,
        assistiveResult,
        setAssistiveResult,
        user,
        token,
        isAuthenticated: !!token,
        login,
        logout,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
