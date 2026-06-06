import { StatusPill } from './StatusBadge';

export function IssueCard({ title, detail, severity, wcag, onClick }) {
  return (
    <div
      className="bg-ivory dark:bg-night/50 border border-gray-200 dark:border-white/5 rounded-2xl p-4 cursor-pointer hover:border-teal/40 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          {wcag && (
            <span className="text-xs font-mono bg-gray-100 dark:bg-white/5 px-2 py-0.5 rounded">
              {wcag}
            </span>
          )}
        </div>
        <StatusPill severity={severity} />
      </div>
      {title && (
        <p className="font-heading font-semibold text-ink dark:text-white text-sm mt-2">
          {title}
        </p>
      )}
      {detail && (
        <p className="text-xs text-body dark:text-gray-400 mt-1 line-clamp-2">
          {detail}
        </p>
      )}
    </div>
  );
}

export default IssueCard;
