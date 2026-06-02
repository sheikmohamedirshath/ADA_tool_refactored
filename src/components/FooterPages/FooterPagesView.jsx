import React from 'react'
import './FooterPagesView.css'

const PAGE_CONTENT = {
  'related-info': {
    title: 'Related information',
    body: (
      <>
        <p>Useful resources for accessibility and this tool:</p>
        <ul>
          <li><a href="https://www.w3.org/WAI/WCAG21/quickref/" target="_blank" rel="noopener noreferrer">WCAG 2.1 Quick Reference</a></li>
          <li><a href="https://github.com/dequelabs/axe-core" target="_blank" rel="noopener noreferrer">axe-core (GitHub)</a></li>
          <li><a href="https://www.w3.org/WAI/standards-guidelines/wcag/" target="_blank" rel="noopener noreferrer">W3C WCAG Overview</a></li>
        </ul>
      </>
    ),
  },
  about: {
    title: 'About',
    body: (
      <>
        <p>This ADA Tool runs WCAG 2.1 Level AA checks on web pages using axe-core. Enter a URL to scan or upload HTML to review results and suggested fixes.</p>
      </>
    ),
  },
  privacy: {
    title: 'Privacy',
    body: (
      <>
        <p>Scans and results may be stored for history. We do not share your data with third parties. For details, contact your administrator.</p>
      </>
    ),
  },
  terms: {
    title: 'Terms',
    body: (
      <>
        <p>Use this tool in line with your organization’s policies. Results are for guidance only and do not replace a full accessibility audit.</p>
      </>
    ),
  },
}

export default function FooterPagesView({ pageId, onBack }) {
  const page = PAGE_CONTENT[pageId]
  if (!page) return null

  return (
    <div className="footer-page">
      <button type="button" className="footer-page__back" onClick={onBack} aria-label="Back">
        ← Back
      </button>
      <h1 className="footer-page__title">{page.title}</h1>
      <div className="footer-page__body">
        {page.body}
      </div>
    </div>
  )
}
