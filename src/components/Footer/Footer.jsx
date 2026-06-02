import React from 'react'
import { footerBrand, footerPages, footerCopyright } from '../../config/footerConfig'
import './Footer.css'

export default function Footer({ onNavigate }) {
  return (
    <footer className="app-footer" role="contentinfo">
      <div className="app-footer__inner">
        <div className="app-footer__brand">
          <div className="app-footer__logo-wrap">
            <div className="app-footer__logo-text">
              <span className="app-footer__label">{footerBrand.label}</span>
              <span className="app-footer__tagline">{footerBrand.tagline}</span>
            </div>
          </div>
          {footerBrand.productName && (
            <p className="app-footer__product">{footerBrand.productName}</p>
          )}
        </div>
        <div className="app-footer__bottom">
          {footerPages.map((page, i) => (
            <React.Fragment key={page.id}>
              {i > 0 && <span className="app-footer__sep" aria-hidden> </span>}
              <button
                type="button"
                className="app-footer__link app-footer__link--btn"
                onClick={() => onNavigate?.(page.id)}
              >
                {page.label}
              </button>
            </React.Fragment>
          ))}
          <span className="app-footer__sep" aria-hidden> </span>
          <span className="app-footer__copyright">{footerCopyright}</span>
        </div>
      </div>
    </footer>
  )
}
