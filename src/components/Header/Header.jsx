import React from 'react'
import './Header.css'

/**
 * Top header bar. Pass navItems to show right-side links; omit or pass [] for brand only.
 */
const defaultNavItems = []

export default function Header({ brandName = 'Internal Project', navItems = defaultNavItems }) {
  return (
    <header className="app-header">
      <div className="app-header__brand">
        <span className="app-header__logo" aria-hidden />
        <span className="app-header__title">{brandName}</span>
      </div>
      {navItems.length > 0 && (
        <nav className="app-header__nav" aria-label="Main navigation">
          <ul className="app-header__nav-list">
            {navItems.map((item) => (
              <li key={item.label}>
                <a className="app-header__nav-link" href={item.href}>
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  )
}
