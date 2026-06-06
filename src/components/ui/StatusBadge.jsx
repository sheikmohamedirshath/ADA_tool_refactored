import React from 'react';

const STATUS_CLASSES = {
  Passed: 'bg-sage/15 text-sage',
  'Needs review': 'bg-amber/15 text-amber',
  Failed: 'bg-coral/15 text-coral',
  Running: 'bg-teal/15 text-teal',
};

const SEVERITY_CLASSES = {
  Critical: 'bg-coral/15 text-coral',
  Serious: 'bg-terracotta/15 text-terracotta',
  Moderate: 'bg-amber/15 text-amber',
  Minor: 'bg-sage/15 text-sage',
};

export function StatusBadge({ status }) {
  const classes = STATUS_CLASSES[status] ?? 'bg-body/15 text-body';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${classes}`}>
      {status}
    </span>
  );
}

export function StatusPill({ severity }) {
  const classes = SEVERITY_CLASSES[severity] ?? 'bg-body/15 text-body';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${classes}`}>
      {severity}
    </span>
  );
}

export default StatusBadge;
