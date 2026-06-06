import { X } from 'lucide-react';
import ScoreGauge from './ScoreGauge';
import StatusBadge from './StatusBadge';
import IssueCard from './IssueCard';

export default function DetailsDrawer({ row, onClose }) {
  if (!row) return null;

  const { url, score, violations, status, pages } = row;

  const primaryIssue = violations && violations.length > 0 ? violations[0] : null;

  const recommendedStep =
    score >= 90
      ? 'Run a full manual keyboard-navigation check to confirm no focus-order issues remain.'
      : score >= 70
      ? 'Address the serious and critical violations first, then re-scan to confirm improvement.'
      : 'Engage an accessibility specialist to perform a comprehensive remediation audit before the next release.';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        className="relative h-full w-full max-w-md bg-white dark:bg-charcoal shadow-lg flex flex-col"
        style={{ transform: 'translateX(0)', transition: 'transform 0.3s ease' }}
        role="dialog"
        aria-modal="true"
        aria-label="Page Details"
      >
        {/* Header */}
        <div className="p-5 border-b border-gray-100 dark:border-white/5 flex items-center justify-between shrink-0">
          <h2 className="font-heading text-lg text-ink dark:text-ivory">Page Details</h2>
          <button
            onClick={onClose}
            className="btn-ghost p-1.5 rounded-xl text-body dark:text-ivory/60 hover:text-ink dark:hover:text-ivory transition-colors"
            aria-label="Close drawer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex flex-col gap-5 flex-1">
          {/* URL section */}
          <div>
            <p className="text-xs font-body font-medium text-body dark:text-ivory/50 uppercase tracking-wide mb-1.5">
              URL
            </p>
            <code className="block w-full bg-gray-50 dark:bg-night/60 text-ink dark:text-ivory text-sm font-mono px-3 py-2 rounded-2xl truncate border border-gray-100 dark:border-white/5">
              {url}
            </code>
          </div>

          {/* Score card */}
          <div className="card flex items-center gap-5 p-4">
            <ScoreGauge score={score} size={80} />
            <div>
              <p className="text-xs font-body font-medium text-body dark:text-ivory/50 uppercase tracking-wide mb-0.5">
                Accessibility Score
              </p>
              <p className="font-heading text-4xl text-ink dark:text-ivory leading-none">
                {score}
              </p>
              <p className="text-xs text-body dark:text-ivory/40 font-body mt-1">out of 100</p>
            </div>
          </div>

          {/* Violations count */}
          <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-gray-50 dark:bg-night/60 border border-gray-100 dark:border-white/5">
            <span className="text-sm font-body font-medium text-body dark:text-ivory/60">
              Violations Found
            </span>
            <span className="font-heading text-xl text-coral">
              {violations ? violations.length : 0}
            </span>
          </div>

          {/* Status badge */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-body font-medium text-body dark:text-ivory/60">
              Status
            </span>
            <StatusBadge status={status} />
          </div>

          {/* Pages */}
          {pages !== undefined && (
            <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-gray-50 dark:bg-night/60 border border-gray-100 dark:border-white/5">
              <span className="text-sm font-body font-medium text-body dark:text-ivory/60">
                Pages Scanned
              </span>
              <span className="font-heading text-xl text-teal">{pages}</span>
            </div>
          )}

          {/* Primary Finding */}
          {primaryIssue && (
            <div>
              <p className="text-xs font-body font-medium text-body dark:text-ivory/50 uppercase tracking-wide mb-2">
                Primary Finding
              </p>
              <IssueCard issue={primaryIssue} />
            </div>
          )}

          {/* Recommended Next Step */}
          <div className="rounded-2xl bg-teal/5 dark:bg-teal/10 border border-teal/20 dark:border-teal/20 p-4">
            <p className="text-xs font-body font-medium text-teal uppercase tracking-wide mb-1.5">
              Recommended Next Step
            </p>
            <p className="text-sm font-body text-body dark:text-ivory/70 leading-relaxed">
              {recommendedStep}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 dark:border-white/5 shrink-0">
          <button className="btn-primary w-full">Open Full Report</button>
        </div>
      </div>
    </div>
  );
}
