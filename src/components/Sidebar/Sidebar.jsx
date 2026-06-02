import React, { useState } from 'react'
import { sidebarNavItems } from '../../config/sidebarNav'
import './Sidebar.css'

const iconMap = {
  home: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
    </svg>
  ),
  monitor: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z" />
    </svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
    </svg>
  ),
  doc: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6zm2-4h8v-2H8v2zm0-4h8v-2H8v2zm0-4h5v-2H8v2z" />
    </svg>
  ),
  history: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M13 3a9 9 0 1 0 8.95 10h-2.02A7 7 0 1 1 13 5v3l4-4-4-4v3z" />
      <path d="M12 8h2v5h-5v-2h3z" />
    </svg>
  ),
  assist: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2a8 8 0 0 0-8 8c0 3.54 2.29 6.53 5.47 7.59L10 22l2-1 2 1 .53-4.41A8 8 0 1 0 12 2zm0 2a6 6 0 0 1 4.24 10.24l-.39.39-.29 2.4-1.56-.78L12 17.12l-2 .13-1.56.78-.29-2.4-.39-.39A6 6 0 0 1 12 4zm-1 4h2v4h-2V8zm0 5h2v2h-2v-2z" />
    </svg>
  ),
  crawl: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
}

export default function Sidebar({ activeId = 'home', onNavigate }) {
  const [isHovered, setIsHovered] = useState(false)
  const isOpen = isHovered

  return (
    <>
      {/* Invisible strip at viewport left edge: hover here opens the sidebar */}
      <div
        className="app-sidebar-edge-trigger"
        onMouseEnter={() => setIsHovered(true)}
        aria-hidden
      />
      <div
        className={`app-sidebar-wrapper ${isOpen ? 'app-sidebar-wrapper--open' : ''}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        aria-label="Sidebar"
      >
        <aside className="app-sidebar" aria-label="Sidebar navigation">
          <div className="app-sidebar__title" aria-hidden={!isOpen}>
            Navigation
          </div>
          <nav className="app-sidebar__nav">
            <ul className="app-sidebar__list">
              {sidebarNavItems.map((item) => {
                const isActive = activeId === item.id
                return (
                  <li key={item.id} className="app-sidebar__item">
                    <button
                      type="button"
                      className={`app-sidebar__link ${isActive ? 'app-sidebar__link--active' : ''}`}
                      onClick={() => onNavigate?.(item.id)}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <span className="app-sidebar__icon">
                        {iconMap[item.icon] || iconMap.home}
                      </span>
                      <span className="app-sidebar__label">{item.label}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>
        </aside>
      </div>
    </>
  )
}
