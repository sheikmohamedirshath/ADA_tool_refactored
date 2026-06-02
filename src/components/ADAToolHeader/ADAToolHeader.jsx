import React from 'react'
import './ADAToolHeader.css'

const shieldIcon = (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
)

const sunIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
)

const moonIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
)

export default function ADAToolHeader({ theme = 'light', onThemeToggle, onHomeClick }) {
  const isDark = theme === 'dark'

  return (
    <header className="ada-tool-header" role="banner">
      <button
        type="button"
        className="ada-tool-header__brand"
        onClick={onHomeClick}
        aria-label="Go to home"
      >
        <span className="ada-tool-header__logo" aria-hidden>
          {shieldIcon}
        </span>
        <div className="ada-tool-header__text">
          <h1 className="ada-tool-header__title">ADA Tool</h1>
          <p className="ada-tool-header__subtitle">WCAG 2.1 LEVEL AA COMPLIANCE SCANNER</p>
        </div>
      </button>
      <button
        type="button"
        className="ada-tool-header__theme-toggle"
        onClick={onThemeToggle}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        title={isDark ? 'Light mode' : 'Dark mode'}
      >
        <span className="ada-tool-header__theme-icon">
          {isDark ? sunIcon : moonIcon}
        </span>
      </button>
    </header>
  )
}
