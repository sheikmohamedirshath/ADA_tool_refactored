import { useState, useCallback, useRef, useEffect } from 'react';
import { Globe, Search, FileCode, Play, CheckCircle, AlertTriangle, RotateCcw, Monitor, Shield, TrendingUp } from 'lucide-react';
import { useApp } from '../context/AppContext';
import './NewScanPage.css';
import { getRuleFixTips, getRuleFixExamples, getRuleWhyMatters } from '../config/axeFixGuidance';

// ─── Accessibility Score Utilities ───────────────────────────────────────────

const WCAG_AA_CRITERIA_NS = new Set([
  '1.2.4','1.2.5','1.3.4','1.3.5','1.4.3','1.4.4','1.4.5',
  '1.4.10','1.4.11','1.4.12','1.4.13','2.4.5','2.4.6','2.4.7',
  '3.1.2','3.2.3','3.2.4','3.3.3','3.3.4','4.1.3',
]);

function nsWcagTagToMeta(tags) {
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const lower = tag.toLowerCase();
    if (/^wcag\d*a+$/.test(lower)) continue;
    const m = lower.match(/^wcag(\d{3,})$/);
    if (!m) continue;
    const digits = m[1];
    const criterion = `${digits[0]}.${digits[1]}.${digits.slice(2)}`;
    const level = WCAG_AA_CRITERIA_NS.has(criterion) ? 'AA' : 'A';
    return { criterion, level };
  }
  return null;
}

const NS_SCORE_WEIGHTS = { critical: 10, serious: 5, moderate: 2, minor: 1 };

function nsComputeScore(violations) {
  let penalty = 0;
  for (const v of violations) {
    const w = NS_SCORE_WEIGHTS[(v.impact || 'minor').toLowerCase()] ?? 1;
    penalty += (v.nodes?.length ?? 1) * w;
  }
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

function nsScoreGradeInfo(score) {
  if (score >= 90) return { grade: 'A', dialCls: 'text-teal border-teal',       badgeCls: 'bg-teal/10 text-teal' };
  if (score >= 75) return { grade: 'B', dialCls: 'text-sage border-sage',       badgeCls: 'bg-sage/10 text-sage' };
  if (score >= 60) return { grade: 'C', dialCls: 'text-amber border-amber',     badgeCls: 'bg-amber/10 text-amber' };
  if (score >= 45) return { grade: 'D', dialCls: 'text-terracotta border-terracotta', badgeCls: 'bg-terracotta/10 text-terracotta' };
  return              { grade: 'F', dialCls: 'text-coral border-coral',         badgeCls: 'bg-coral/10 text-coral' };
}

function nsScoreMessage(score) {
  if (score >= 90) return 'Excellent accessibility compliance. Minor or no issues found.';
  if (score >= 75) return 'Good accessibility baseline with some issues requiring attention.';
  if (score >= 60) return 'Moderate accessibility issues found. Prioritize critical and serious violations.';
  if (score >= 45) return 'Significant accessibility barriers detected. Remediation required.';
  return 'Critical accessibility failures present. Immediate remediation required.';
}

function nsBuildSeverityBreakdown(violations) {
  const c = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of violations) {
    const impact = (v.impact || 'minor').toLowerCase();
    if (impact in c) c[impact] += (v.nodes?.length ?? 1);
  }
  return c;
}

function nsBuildTopIssues(violations) {
  const map = {};
  for (const v of violations) {
    const id = v.id || 'unknown';
    if (!map[id]) map[id] = { id, title: v.help || v.description || v.id || 'Unknown issue', count: 0 };
    map[id].count += (v.nodes?.length ?? 1);
  }
  return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 8);
}

const NS_SEVERITY_ROWS = [
  { key: 'critical', label: 'Critical', dot: 'bg-coral',       sublabel: 'High Risk'   },
  { key: 'serious',  label: 'Serious',  dot: 'bg-terracotta',  sublabel: 'Medium Risk' },
  { key: 'moderate', label: 'Moderate', dot: 'bg-amber',       sublabel: 'Low Risk'    },
  { key: 'minor',    label: 'Minor',    dot: 'bg-sage',        sublabel: 'Info'        },
];

const NS_IMPACT_FILTER = ['critical', 'serious', 'moderate', 'minor'];

function truncateHtml(html, maxLen = 280) {
  if (!html) return '';
  return html.length <= maxLen ? html : html.slice(0, maxLen) + '…';
}

/* ── Phase 3: colors, localStorage, grouping, donut ── */
const SEV_COLORS = {
  critical: '#E76F51',
  serious:  '#D97757',
  moderate: '#F59E0B',
  minor:    '#6BA368',
};

const ADA_SCAN_KEY = 'ada_last_scan_summary';

function loadPrevScan() {
  try { return JSON.parse(localStorage.getItem(ADA_SCAN_KEY) || 'null'); } catch { return null; }
}

function saveScanSummary(summary) {
  try { localStorage.setItem(ADA_SCAN_KEY, JSON.stringify(summary)); } catch {}
}

function nsInferPageArea(nodes) {
  const t = (nodes || []).flatMap(n => [].concat(n.target || '').flat()).join(' ').toLowerCase();
  if (/\bnav\b|navbar|\bnavigation\b/.test(t)) return 'Navigation';
  if (/\bheader\b/.test(t)) return 'Header';
  if (/\bfooter\b/.test(t)) return 'Footer';
  if (/\bform\b|\binput\b|\bselect\b|\btextarea\b|\blabel\b/.test(t)) return 'Forms';
  if (/\bimg\b|\bimage\b|\bpicture\b|\bfigure\b/.test(t)) return 'Images & Media';
  if (/\ba\[href\]|\ba\./.test(t)) return 'Links';
  if (/\bbutton\b|\bbtn\b/.test(t)) return 'Controls';
  if (/h[1-6]/.test(t)) return 'Headings';
  if (/\bmain\b/.test(t)) return 'Main Content';
  return 'General';
}

function nsGroupByArea(violations) {
  const groups = {};
  for (const v of violations) {
    const area = nsInferPageArea(v.nodes);
    if (!groups[area]) groups[area] = [];
    groups[area].push(v);
  }
  const ORDER = ['Navigation', 'Header', 'Main Content', 'Forms', 'Controls', 'Links', 'Images & Media', 'Headings', 'Footer', 'General'];
  return Object.keys(groups)
    .sort((a, b) => {
      const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    })
    .map(area => ({ area, violations: groups[area] }));
}

function buildDonutPaths(sevBreak) {
  const total = NS_SEVERITY_ROWS.reduce((s, r) => s + (sevBreak[r.key] || 0), 0);
  if (total === 0) return { paths: [], total: 0 };
  const CX = 50, CY = 50, OR = 44, IR = 28;
  let angle = -Math.PI / 2;
  const paths = [];
  for (const { key } of NS_SEVERITY_ROWS) {
    const val = sevBreak[key] || 0;
    if (!val) continue;
    const sweep = (val / total) * Math.PI * 2;
    const endA = angle + sweep;
    const laf = sweep > Math.PI ? 1 : 0;
    const x1o = CX + OR * Math.cos(angle), y1o = CY + OR * Math.sin(angle);
    const x2o = CX + OR * Math.cos(endA),  y2o = CY + OR * Math.sin(endA);
    const x1i = CX + IR * Math.cos(angle), y1i = CY + IR * Math.sin(angle);
    const x2i = CX + IR * Math.cos(endA),  y2i = CY + IR * Math.sin(endA);
    paths.push({
      key,
      fill: SEV_COLORS[key],
      d: `M${x1o.toFixed(2)},${y1o.toFixed(2)} A${OR},${OR} 0 ${laf} 1 ${x2o.toFixed(2)},${y2o.toFixed(2)} L${x2i.toFixed(2)},${y2i.toFixed(2)} A${IR},${IR} 0 ${laf} 0 ${x1i.toFixed(2)},${y1i.toFixed(2)} Z`,
    });
    angle = endA;
  }
  return { paths, total };
}

/* ── Phase 4: helpers ── */

const ADA_TL_PREFIX = 'ada_tl_';

function p4tlKey(url) {
  try { return ADA_TL_PREFIX + btoa(unescape(encodeURIComponent(url || ''))).slice(0, 48); }
  catch { return ADA_TL_PREFIX + String(url || '').length; }
}

function p4loadTimeline(url) {
  try { return JSON.parse(localStorage.getItem(p4tlKey(url)) || '[]'); } catch { return []; }
}

function p4saveToTimeline(url, entry) {
  try {
    const arr = p4loadTimeline(url);
    arr.push(entry);
    localStorage.setItem(p4tlKey(url), JSON.stringify(arr.slice(-10)));
  } catch {}
}

const P4_KB_IDS = new Set([
  'bypass', 'focus-order-semantics', 'focusable-content', 'focus-visible',
  'keyboard', 'keyboard-trap', 'tabindex', 'skip-link',
  'scrollable-region-focusable', 'aria-hidden-focus', 'interactive-supports-focus',
]);

function p4keyboardViolations(violations) {
  return violations.filter(v => P4_KB_IDS.has(v.id));
}

function p4riskLevel(score, sevBreak) {
  const c = sevBreak.critical || 0;
  if (score < 45 || c >= 5) return { level: 'Critical', badgeCls: 'bg-coral/10 text-coral border-coral/20',           action: 'Immediate remediation required' };
  if (score < 65 || c >= 2) return { level: 'High',     badgeCls: 'bg-terracotta/10 text-terracotta border-terracotta/20', action: 'Prioritize critical and serious issues' };
  if (score < 80)           return { level: 'Medium',   badgeCls: 'bg-amber/10 text-amber border-amber/20',           action: 'Address moderate issues to improve compliance' };
  if (score < 95)           return { level: 'Low',      badgeCls: 'bg-sage/10 text-sage border-sage/20',              action: 'Monitor and address remaining minor issues' };
  return                           { level: 'Minimal',  badgeCls: 'bg-teal/10 text-teal border-teal/20',              action: 'Maintain current accessibility practices' };
}

function p4wcagLabel(violations) {
  let hasA = false, hasAA = false;
  for (const v of violations) {
    for (const tag of (v.tags || [])) {
      const t = (tag || '').toLowerCase();
      if (/^wcag\d+aa$/.test(t)) hasAA = true;
      else if (/^wcag\d+a$/.test(t)) hasA = true;
    }
  }
  if (!hasA && !hasAA) return 'AA Full';
  if (hasAA) return 'AA Partial';
  if (hasA)  return 'A Partial';
  return 'A';
}

function p4wcagLevel(v) {
  for (const tag of (v.tags || [])) {
    const t = (tag || '').toLowerCase();
    if (/^wcag\d+aa$/.test(t)) return 'AA';
    if (/^wcag\d+a$/.test(t))  return 'A';
    if (t === 'best-practice') return 'BP';
  }
  return 'AA';
}

const ADA_VP_PREFIX = 'ada_vp_';

function p4vpKey(url) {
  try { return ADA_VP_PREFIX + btoa(unescape(encodeURIComponent(url || ''))).slice(0, 48); }
  catch { return ADA_VP_PREFIX + String(url || '').length; }
}

function p4loadVpResults(url) {
  try { return JSON.parse(localStorage.getItem(p4vpKey(url)) || 'null'); } catch { return null; }
}

function p4saveVpResults(url, results) {
  try { localStorage.setItem(p4vpKey(url), JSON.stringify(results)); } catch {}
}

const P4_VIEWPORTS = [
  { id: 'desktop', label: 'Desktop', width: 1280 },
  { id: 'tablet',  label: 'Tablet',  width: 768  },
  { id: 'mobile',  label: 'Mobile',  width: 375  },
];

const P4_IMPACT_GROUPS = {
  'button-name':                  ['Screen reader users', 'Voice control users'],
  'color-contrast':               ['Low vision users', 'Color-blind users'],
  'image-alt':                    ['Screen reader users', 'Users with images disabled'],
  'label':                        ['Screen reader users', 'Voice control users', 'Motor-impaired users'],
  'link-name':                    ['Screen reader users', 'Keyboard-only users'],
  'keyboard':                     ['Keyboard-only users', 'Switch device users'],
  'keyboard-trap':                ['Keyboard-only users', 'Switch device users'],
  'focus-visible':                ['Keyboard-only users', 'Cognitive disability users'],
  'bypass':                       ['Keyboard-only users', 'Screen reader users'],
  'heading-order':                ['Screen reader users', 'Cognitive disability users'],
  'html-has-lang':                ['Screen reader users', 'Machine translation users'],
  'region':                       ['Screen reader users', 'Keyboard-only users'],
  'meta-viewport':                ['Low vision users', 'Mobile users with pinch-to-zoom'],
  'frame-title':                  ['Screen reader users'],
  'scrollable-region-focusable':  ['Keyboard-only users'],
  'interactive-supports-focus':   ['Keyboard-only users', 'Screen reader users'],
};

const P4_EFFORT = {
  'color-contrast':               'Complex',
  'keyboard':                     'Complex',
  'keyboard-trap':                'Complex',
  'focus-order-semantics':        'Complex',
  'region':                       'Moderate',
  'heading-order':                'Moderate',
  'bypass':                       'Moderate',
  'label':                        'Quick',
  'button-name':                  'Quick',
  'image-alt':                    'Quick',
  'link-name':                    'Quick',
  'html-has-lang':                'Quick',
  'meta-viewport':                'Quick',
  'frame-title':                  'Quick',
  'tabindex':                     'Quick',
  'focus-visible':                'Quick',
};

/* ── Toggle switch ── */
function Toggle({ id, checked, onChange, disabled }) {
  return (
    <label
      htmlFor={id}
      className={`relative inline-flex items-center flex-shrink-0 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <input id={id} type="checkbox" className="sr-only" checked={checked} onChange={onChange} disabled={disabled} />
      <div
        className={[
          'relative w-11 h-6 rounded-full transition-all duration-200',
          checked
            ? 'bg-teal shadow-[0_0_0_2px_rgba(15,118,110,0.25)]'
            : 'bg-gray-300 dark:bg-gray-500 shadow-[inset_0_1px_3px_rgba(0,0,0,0.18)]',
        ].join(' ')}
      >
        <div
          className={[
            'absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform duration-200',
            checked ? 'translate-x-5' : 'translate-x-0',
          ].join(' ')}
        />
      </div>
    </label>
  );
}

/* ── Glow input ── */
function GlowInput({ icon: Icon, type = 'text', disabled, large, ...props }) {
  return (
    <div className={`glow-input-wrapper${large ? ' glow-input-wrapper--large' : ''}${disabled ? ' opacity-60' : ''}`}>
      {Icon && (
        <Icon
          className={
            large
              ? 'absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-gray-400 pointer-events-none z-10'
              : 'absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-400 pointer-events-none z-10'
          }
        />
      )}
      <input
        type={type}
        disabled={disabled}
        className={`glow-input${Icon ? ' has-left-icon' : ''}${large ? ' glow-input--large-text' : ''}`}
        {...props}
      />
    </div>
  );
}

/* ── Speeder scan loader ── */
function ScanLoader({ url }) {
  return (
    <div className="p-8 flex flex-col items-center gap-5">
      <div className="scan-loader-wrapper w-full bg-ivory dark:bg-night/50">
        <div className="loader">
          <span><span></span><span></span><span></span><span></span></span>
          <div className="base">
            <span></span>
            <div className="face"></div>
          </div>
        </div>
        <div className="longfazers">
          <span></span><span></span><span></span><span></span>
        </div>
      </div>
      <div className="text-center">
        <p className="font-heading font-semibold text-ink dark:text-white text-lg">Scanning in progress</p>
        {url && <p className="text-sm text-body dark:text-gray-400 mt-1 font-mono break-all max-w-lg mx-auto">{url}</p>}
        <p className="text-xs text-body dark:text-gray-500 mt-2">This may take 1–2 minutes</p>
      </div>
    </div>
  );
}

/* ── Violation card (expandable) ── */
function ViolationRow({ violation }) {
  const [expanded, setExpanded] = useState(false);
  const [copiedNode, setCopiedNode] = useState(null);
  const [copiedFix, setCopiedFix] = useState(false);

  const impact = (violation.impact ?? 'minor').toLowerCase();
  const impactConfig = {
    critical: { badge: 'bg-coral/10 text-coral border border-coral/20',               dot: 'bg-coral',       sublabel: 'High Risk',   sublabelCls: 'text-coral/60' },
    serious:  { badge: 'bg-terracotta/10 text-terracotta border border-terracotta/20', dot: 'bg-terracotta',  sublabel: 'Medium Risk', sublabelCls: 'text-terracotta/60' },
    moderate: { badge: 'bg-amber/10 text-amber border border-amber/20',                dot: 'bg-amber',       sublabel: 'Low Risk',    sublabelCls: 'text-amber/60' },
    minor:    { badge: 'bg-sage/10 text-sage border border-sage/20',                   dot: 'bg-sage',        sublabel: 'Info',        sublabelCls: 'text-sage/60' },
  }[impact] ?? { badge: 'bg-gray-100 text-gray-600 border border-gray-200', dot: 'bg-gray-400', sublabel: '', sublabelCls: '' };

  const wcag = nsWcagTagToMeta(violation.tags);
  const fixTips = getRuleFixTips(violation.id);
  const fixExamples = getRuleFixExamples(violation.id);
  const whyMatters = getRuleWhyMatters(violation.id, violation.impact);
  const nodes = violation.nodes ?? [];

  const copyText = (text, setter) => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      setter(true);
      setTimeout(() => setter(false), 2000);
    });
  };

  return (
    <div className="border border-gray-100 dark:border-white/[0.07] rounded-xl overflow-hidden">
      {/* ── Header (always visible, click to expand) ── */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full flex items-start gap-3 px-4 py-3.5 text-left bg-white dark:bg-charcoal hover:bg-gray-50/80 dark:hover:bg-white/[0.03] transition-colors"
      >
        <span className={`mt-[18px] w-2 h-2 rounded-full flex-shrink-0 ${impactConfig.dot}`} />
        <div className="flex-1 min-w-0 py-0.5">
          <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
            <span className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${impactConfig.badge}`}>
              {impact.charAt(0).toUpperCase() + impact.slice(1)}
              {impactConfig.sublabel && (
                <span className={`ml-1 font-normal normal-case ${impactConfig.sublabelCls}`}>· {impactConfig.sublabel}</span>
              )}
            </span>
            {wcag && (
              <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-teal/10 text-teal border border-teal/20">
                WCAG {wcag.criterion} {wcag.level}
              </span>
            )}
            {P4_EFFORT[violation.id] && (
              <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                P4_EFFORT[violation.id] === 'Quick'   ? 'bg-sage/10 text-sage border-sage/20' :
                P4_EFFORT[violation.id] === 'Moderate'? 'bg-amber/10 text-amber border-amber/20' :
                'bg-coral/10 text-coral border-coral/20'
              }`}>{P4_EFFORT[violation.id]} Fix</span>
            )}
          </div>
          <p className="text-sm font-semibold text-ink dark:text-white leading-snug">{violation.help || violation.description}</p>
          <p className="text-[11px] font-mono text-body dark:text-gray-500 mt-0.5">{violation.id}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 pt-3">
          <span className="text-xs text-body dark:text-gray-400 whitespace-nowrap">
            {nodes.length} element{nodes.length !== 1 ? 's' : ''}
          </span>
          <span className={`text-body dark:text-gray-500 text-xs transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>▼</span>
        </div>
      </button>

      {/* ── Expanded body ── */}
      {expanded && (
        <div className="border-t border-gray-100 dark:border-white/[0.05] bg-gray-50/50 dark:bg-white/[0.02] px-4 pb-5 pt-4 space-y-5">

          {/* Why this matters */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400 mb-1.5">Why This Matters</p>
            <p className="text-sm text-body dark:text-gray-300 leading-relaxed">{whyMatters}</p>
          </div>

          {/* Who's affected */}
          {P4_IMPACT_GROUPS[violation.id] && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400 mb-1.5">Who's Affected</p>
              <div className="flex flex-wrap gap-1.5">
                {P4_IMPACT_GROUPS[violation.id].map((group) => (
                  <span key={group} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber/10 text-amber border border-amber/20">{group}</span>
                ))}
              </div>
            </div>
          )}

          {/* Affected elements */}
          {nodes.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400 mb-2">
                Affected Elements <span className="font-normal normal-case tracking-normal">({nodes.length})</span>
              </p>
              <div className="space-y-2">
                {nodes.slice(0, 3).map((node, ni) => (
                  <div key={ni}>
                    {node.failureSummary && (
                      <p className="text-[11px] text-amber mb-1">
                        {node.failureSummary.replace(/^Fix (?:all|any|one) of the following:\s*/i, '').trim()}
                      </p>
                    )}
                    <div className="relative group">
                      <pre className="text-xs bg-gray-900 dark:bg-black/50 text-emerald-300 rounded-lg px-3 py-2.5 overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed max-h-24 m-0">
                        {truncateHtml(node.html)}
                      </pre>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); copyText(node.html || '', (v) => setCopiedNode(v ? ni : null)); }}
                        className="absolute top-1.5 right-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white/10 text-gray-300 hover:bg-white/20 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                      >
                        {copiedNode === ni ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                ))}
                {nodes.length > 3 && (
                  <p className="text-xs text-body dark:text-gray-500">… and {nodes.length - 3} more element{nodes.length - 3 !== 1 ? 's' : ''}</p>
                )}
              </div>
            </div>
          )}

          {/* Remediation guidance */}
          <div>
            <div className="flex items-center justify-between mb-2 gap-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400">Recommended Fix</p>
              {fixTips.length > 0 && (
                <button
                  type="button"
                  onClick={() => copyText(fixTips.join('\n'), setCopiedFix)}
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors flex-shrink-0 ${copiedFix ? 'bg-teal/20 text-teal border-teal/40' : 'bg-teal/10 text-teal border-teal/20 hover:bg-teal/20'}`}
                >
                  {copiedFix ? '✓ Copied' : 'Copy Guidance'}
                </button>
              )}
            </div>
            {fixTips.length > 0 ? (
              <ul className="space-y-1.5">
                {fixTips.map((tip, ti) => (
                  <li key={ti} className="flex items-start gap-2 text-sm text-body dark:text-gray-300 leading-relaxed">
                    <span className="text-teal mt-0.5 flex-shrink-0">·</span>
                    {tip}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-body dark:text-gray-300 leading-relaxed">{violation.description}</p>
            )}
            {fixExamples.length > 0 && (
              <div className="mt-3 space-y-2">
                {fixExamples.map((ex, ei) => (
                  <div key={ei}>
                    <p className="text-[10px] font-semibold text-body dark:text-gray-500 mb-1">{ex.label}</p>
                    <pre className="text-xs bg-teal/5 border border-teal/15 text-teal dark:text-teal-300 rounded-lg px-3 py-2 overflow-x-auto font-mono m-0">{ex.code}</pre>
                  </div>
                ))}
              </div>
            )}
            {violation.helpUrl && (
              <a
                href={violation.helpUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-teal hover:underline mt-3"
              >
                Full axe documentation →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Severity donut chart ── */
function SeverityDonut({ sevBreak }) {
  const { paths, total } = buildDonutPaths(sevBreak);
  if (total === 0) return (
    <p className="text-sm text-sage font-semibold text-center py-4">No violations found</p>
  );
  return (
    <div className="flex items-center gap-5 mt-1">
      <svg viewBox="0 0 100 100" className="w-28 h-28 flex-shrink-0" role="img" aria-label="Severity distribution donut chart">
        {paths.map(p => <path key={p.key} d={p.d} fill={p.fill} />)}
        <text x="50" y="46" textAnchor="middle" fontSize="15" fontWeight="700" fill="currentColor" className="text-ink dark:text-white">{total}</text>
        <text x="50" y="59" textAnchor="middle" fontSize="8" fill="currentColor" className="text-body dark:text-gray-400">issues</text>
      </svg>
      <div className="flex-1 space-y-2.5">
        {NS_SEVERITY_ROWS.map(({ key, label, sublabel }) => {
          const count = sevBreak[key] || 0;
          if (!count) return null;
          const pct = Math.round((count / total) * 100);
          return (
            <div key={key} className="space-y-0.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: SEV_COLORS[key] }} />
                  <span className="text-xs text-ink dark:text-white font-medium">{label}</span>
                  <span className="text-[10px] text-body dark:text-gray-500">{sublabel}</span>
                </div>
                <span className="text-xs font-bold text-ink dark:text-white">{count}</span>
              </div>
              <div className="h-1.5 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden ml-3.5">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: SEV_COLORS[key] }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Scan comparison card ── */
function ScanComparison({ currentScore, currentTotal, scanUrl, prevScan }) {
  if (!prevScan) return (
    <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">
      <div className="flex items-center gap-2 mb-2">
        <p className="font-heading font-semibold text-base text-ink dark:text-white">Comparison</p>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-body dark:text-gray-500 bg-gray-100 dark:bg-white/5 px-2 py-0.5 rounded-full">No prior scan</span>
      </div>
      <p className="text-sm text-body dark:text-gray-400 leading-relaxed">
        After fixing accessibility issues and re-scanning, improvement metrics will appear here automatically.
      </p>
    </div>
  );
  const violDiff  = currentTotal - prevScan.totalViolations;
  const scoreDiff = currentScore - prevScan.score;
  return (
    <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">
      <div className="flex items-center gap-2 mb-4">
        <p className="font-heading font-semibold text-base text-ink dark:text-white">Comparison</p>
        {prevScan.url && prevScan.url !== scanUrl && (
          <span className="text-[10px] text-body dark:text-gray-500 font-mono truncate max-w-[180px]" title={prevScan.url}>
            vs {prevScan.url}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="bg-gray-50 dark:bg-white/[0.03] rounded-xl p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400 mb-2">Previous</p>
          <p className="text-2xl font-heading font-bold text-body dark:text-gray-300">{prevScan.totalViolations}</p>
          <p className="text-[11px] text-body dark:text-gray-500 mt-0.5">violations</p>
          <p className="text-xs font-semibold text-body dark:text-gray-500 mt-1">{prevScan.score}/100</p>
        </div>
        <div className="flex flex-col items-center justify-center gap-1">
          <p className={`text-2xl font-heading font-bold ${violDiff < 0 ? 'text-sage' : violDiff > 0 ? 'text-coral' : 'text-body dark:text-gray-400'}`}>
            {violDiff > 0 ? '+' : ''}{violDiff}
          </p>
          <p className="text-[10px] text-body dark:text-gray-500">violations</p>
          <p className={`text-xs font-semibold ${scoreDiff > 0 ? 'text-teal' : scoreDiff < 0 ? 'text-coral' : 'text-body dark:text-gray-400'}`}>
            {scoreDiff !== 0 ? `${scoreDiff > 0 ? '+' : ''}${scoreDiff} score` : 'No change'}
          </p>
        </div>
        <div className="bg-gray-50 dark:bg-white/[0.03] rounded-xl p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400 mb-2">Current</p>
          <p className="text-2xl font-heading font-bold text-ink dark:text-white">{currentTotal}</p>
          <p className="text-[11px] text-body dark:text-gray-500 mt-0.5">violations</p>
          <p className="text-xs font-semibold text-body dark:text-gray-500 mt-1">{currentScore}/100</p>
        </div>
      </div>
      {violDiff < 0 && (
        <div className="mt-4 flex items-center gap-2 bg-teal/5 border border-teal/15 rounded-xl px-4 py-2.5">
          <span className="text-teal font-bold text-sm">↑</span>
          <p className="text-sm text-teal font-medium">
            {Math.abs(violDiff)} fewer violation{Math.abs(violDiff) !== 1 ? 's' : ''} since last scan
          </p>
        </div>
      )}
      {violDiff > 0 && (
        <div className="mt-4 flex items-center gap-2 bg-coral/5 border border-coral/15 rounded-xl px-4 py-2.5">
          <span className="text-coral font-bold text-sm">↓</span>
          <p className="text-sm text-coral font-medium">
            {violDiff} more violation{violDiff !== 1 ? 's' : ''} than last scan — review recent changes
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Issue navigator sidebar ── */
function IssueNavigator({ sevBreak, totalViolations, onNavigate }) {
  if (totalViolations === 0) return null;
  return (
    <nav aria-label="Issue navigator" className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400 mb-3">Navigate</p>
      <div className="space-y-0.5">
        <button
          type="button"
          onClick={() => onNavigate('all')}
          className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs hover:bg-teal/5 dark:hover:bg-teal/10 transition-colors text-left"
        >
          <span className="font-semibold text-ink dark:text-white">All Issues</span>
          <span className="font-bold text-body dark:text-gray-400">{totalViolations}</span>
        </button>
        {NS_SEVERITY_ROWS.map(({ key, label, dot }) => {
          const count = sevBreak[key] || 0;
          if (!count) return null;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onNavigate(key)}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors text-left"
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
              <span className="flex-1 text-body dark:text-gray-400">{label}</span>
              <span className="font-bold text-ink dark:text-white">{count}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* ── Accessibility Readiness Card ── */
function AccessibilityReadinessCard({ score, sevBreak, violations, passes }) {
  const risk = p4riskLevel(score, sevBreak);
  const wcag = p4wcagLabel(violations);
  const criticalCount = sevBreak.critical || 0;
  const totalChecks = violations.length + passes.length;
  const passRate = totalChecks > 0 ? Math.round((passes.length / totalChecks) * 100) : 100;

  return (
    <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-teal" />
          <p className="font-heading font-semibold text-base text-ink dark:text-white">Accessibility Readiness</p>
        </div>
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${risk.badgeCls}`}>
          {risk.level} Risk
        </span>
      </div>
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="bg-gray-50 dark:bg-white/[0.03] rounded-xl p-3 text-center">
          <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400 mb-1">Score</p>
          <p className="text-xl font-heading font-bold text-ink dark:text-white">{score}<span className="text-xs font-normal text-body dark:text-gray-500">/100</span></p>
        </div>
        <div className="bg-gray-50 dark:bg-white/[0.03] rounded-xl p-3 text-center">
          <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400 mb-1">WCAG</p>
          <p className="text-sm font-heading font-bold text-ink dark:text-white leading-tight mt-1">{wcag}</p>
        </div>
        <div className="bg-gray-50 dark:bg-white/[0.03] rounded-xl p-3 text-center">
          <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400 mb-1">Critical</p>
          <p className={`text-xl font-heading font-bold ${criticalCount > 0 ? 'text-coral' : 'text-sage'}`}>{criticalCount}</p>
        </div>
        <div className="bg-gray-50 dark:bg-white/[0.03] rounded-xl p-3 text-center">
          <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400 mb-1">Pass Rate</p>
          <p className="text-xl font-heading font-bold text-ink dark:text-white">{passRate}<span className="text-xs font-normal text-body dark:text-gray-500">%</span></p>
        </div>
      </div>
      <div className="bg-teal/5 border border-teal/15 rounded-xl px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-teal mb-1">Recommended Priority</p>
        <p className="text-sm text-ink dark:text-white font-medium">{risk.action}</p>
      </div>
    </div>
  );
}

/* ── Scan Timeline ── */
function ScanTimeline({ timeline }) {
  if (!timeline || timeline.length < 2) return null;
  const maxS = Math.max(...timeline.map(e => e.score));
  const minS = Math.min(...timeline.map(e => e.score));
  const range = maxS - minS || 1;
  const first = timeline[0];
  const last  = timeline[timeline.length - 1];
  const improved = last.score > first.score;
  const diff = last.score - first.score;

  return (
    <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-teal" />
          <p className="font-heading font-semibold text-base text-ink dark:text-white">Accessibility Timeline</p>
        </div>
        <div className="flex items-center gap-2">
          {diff !== 0 && (
            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${improved ? 'bg-teal/10 text-teal' : 'bg-coral/10 text-coral'}`}>
              {improved ? '↑' : '↓'} {Math.abs(diff)} pts over {timeline.length} scans
            </span>
          )}
          <span className="text-[10px] text-body dark:text-gray-500 bg-gray-100 dark:bg-white/5 px-2 py-0.5 rounded-full font-semibold">
            {timeline.length} scan{timeline.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
      <div className="flex items-end gap-1 h-20 mb-2">
        {timeline.map((entry, i) => {
          const pct = Math.max(12, ((entry.score - minS) / range) * 72 + 12);
          const isLast = i === timeline.length - 1;
          const color = entry.score >= 90 ? '#0F766E' : entry.score >= 75 ? '#6BA368' : entry.score >= 60 ? '#F59E0B' : entry.score >= 45 ? '#D97757' : '#E76F51';
          return (
            <div key={i} className="flex-1 flex flex-col items-center group relative">
              <div
                className="w-full rounded-t transition-all duration-300"
                style={{ height: `${pct}%`, background: color, opacity: isLast ? 1 : 0.55 }}
              />
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-ink dark:bg-white text-white dark:text-ink text-[10px] font-bold px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10 shadow-lg">
                {entry.score}/100 · {entry.total}v
                {entry.ts && <><br />{new Date(entry.ts).toLocaleDateString()}</>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-body dark:text-gray-500">
        <span>{timeline[0]?.ts ? new Date(timeline[0].ts).toLocaleDateString() : 'Oldest'}</span>
        <span className="font-semibold text-teal">Current →</span>
      </div>
    </div>
  );
}

/* ── Keyboard Insights Card ── */
function KeyboardInsightsCard({ violations }) {
  const kbViolations = p4keyboardViolations(violations);
  const hasTrap      = kbViolations.some(v => v.id === 'keyboard-trap');
  const hasSkip      = violations.some(v => v.id === 'bypass');
  const focusRisks   = kbViolations.filter(v => v.id === 'interactive-supports-focus' || v.id === 'focusable-content' || v.id === 'tabindex').length;

  const tabSequence = kbViolations
    .flatMap(v => (v.nodes || []).slice(0, 2).map(n => ({
      rule: v.help || v.id,
      target: [].concat(n.target || '').flat().join(' › '),
    })))
    .slice(0, 5);

  const stats = [
    { label: 'Keyboard Issues', value: kbViolations.length, cls: kbViolations.length > 0 ? 'text-coral' : 'text-sage' },
    { label: 'Focus Traps',     value: hasTrap ? 'Found' : 'None',    cls: hasTrap ? 'text-coral' : 'text-sage' },
    { label: 'Skip Nav',        value: hasSkip ? 'Missing' : 'Present', cls: hasSkip ? 'text-amber' : 'text-sage' },
    { label: 'Focus Risks',     value: focusRisks, cls: focusRisks > 0 ? 'text-amber' : 'text-sage' },
  ];

  return (
    <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="font-heading font-semibold text-base text-ink dark:text-white">Keyboard Accessibility</p>
        {kbViolations.length === 0
          ? <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-teal/10 text-teal border border-teal/20">Pass</span>
          : <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-coral/10 text-coral border border-coral/20">{kbViolations.length} Issue{kbViolations.length !== 1 ? 's' : ''}</span>
        }
      </div>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {stats.map(({ label, value, cls }) => (
          <div key={label} className="bg-gray-50 dark:bg-white/[0.03] rounded-xl p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400 mb-1">{label}</p>
            <p className={`text-lg font-heading font-bold ${cls}`}>{value}</p>
          </div>
        ))}
      </div>
      {tabSequence.length > 0 ? (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400 mb-2">Focus Issue Sequence</p>
          <div className="space-y-1.5">
            {tabSequence.map((item, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center text-[10px] font-bold text-body dark:text-gray-400 flex-shrink-0 mt-0.5">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-mono text-body dark:text-gray-400 truncate">{item.target || '—'}</p>
                  <p className="text-[10px] text-amber leading-tight">{item.rule}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : kbViolations.length === 0 ? (
        <p className="text-sm text-body dark:text-gray-400 leading-relaxed">
          No keyboard accessibility issues detected. All interactive elements are reachable via keyboard navigation.
        </p>
      ) : null}
    </div>
  );
}

/* ── Viewport Comparison Panel ── */
function ViewportComparisonPanel({ scanUrl, currentViolations }) {
  const currentScore = nsComputeScore(currentViolations);
  const currentTotal = currentViolations.length;

  const [vpResults, setVpResults] = useState(() => p4loadVpResults(scanUrl));
  const [scanning, setScanning]   = useState(null);

  const pollJob = (jobId) => new Promise((resolve) => {
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`/api/scan/${jobId}`);
        const d = await r.json();
        const s = d.job?.status;
        if (s === 'completed' || s === 'failed') {
          clearInterval(iv);
          resolve(s === 'completed' ? (d.job?.result ?? null) : null);
        }
      } catch { clearInterval(iv); resolve(null); }
    }, 2500);
  });

  const runScan = async (vp) => {
    if (!scanUrl) return;
    setScanning(vp.id);
    try {
      const res  = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: scanUrl, includeBestPractices: false }),
      });
      const data = await res.json();
      if (!data.ok) { setScanning(null); return; }
      const result = await pollJob(data.jobId);
      if (result) {
        const viol    = result?.axeResult?.violations ?? [];
        const updated = { ...(vpResults || {}), [vp.id]: { violations: viol.length, score: nsComputeScore(viol) } };
        setVpResults(updated);
        p4saveVpResults(scanUrl, updated);
      }
    } catch {}
    setScanning(null);
  };

  const rows = P4_VIEWPORTS.map(vp => ({
    ...vp,
    isBase: vp.id === 'desktop',
    data:   vp.id === 'desktop' ? { violations: currentTotal, score: currentScore } : (vpResults?.[vp.id] ?? null),
  }));

  return (
    <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-teal" />
          <p className="font-heading font-semibold text-base text-ink dark:text-white">Viewport Comparison</p>
        </div>
        <span className="text-[10px] font-semibold text-body dark:text-gray-500 bg-gray-100 dark:bg-white/5 px-2 py-0.5 rounded-full">Beta</span>
      </div>
      <p className="text-xs text-body dark:text-gray-500 mb-4 leading-relaxed">
        Run independent scans per viewport to detect responsive layout differences.
      </p>
      <div className="space-y-2">
        {rows.map(vp => (
          <div key={vp.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-white/[0.03]">
            <div className="w-16 flex-shrink-0">
              <p className="text-xs font-semibold text-ink dark:text-white">{vp.label}</p>
              <p className="text-[10px] text-body dark:text-gray-500">{vp.width}px</p>
            </div>
            {vp.data ? (
              <div className="flex-1 flex items-center gap-2 min-w-0">
                <span className="text-sm font-bold text-ink dark:text-white">{vp.data.violations}</span>
                <span className="text-xs text-body dark:text-gray-500 truncate">violations · {vp.data.score}/100</span>
                {!vp.isBase && vp.data.violations !== currentTotal && (
                  <span className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${vp.data.violations > currentTotal ? 'text-coral bg-coral/10' : 'text-sage bg-sage/10'}`}>
                    {vp.data.violations > currentTotal ? '+' : ''}{vp.data.violations - currentTotal}
                  </span>
                )}
                {vp.isBase && <span className="ml-auto text-[10px] font-semibold text-teal bg-teal/10 px-2 py-0.5 rounded-full flex-shrink-0">Current</span>}
                {!vp.isBase && vp.data.violations === currentTotal && (
                  <span className="ml-auto text-[10px] text-body dark:text-gray-500 flex-shrink-0">No diff</span>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => runScan(vp)}
                disabled={!!scanning}
                className="flex-1 flex items-center gap-1.5 text-xs text-teal font-semibold hover:text-teal/80 disabled:opacity-50 transition-colors"
              >
                {scanning === vp.id
                  ? <><span className="w-3 h-3 border border-teal/40 border-t-teal rounded-full animate-spin flex-shrink-0" />Scanning {vp.label}…</>
                  : <>+ Scan {vp.label}</>
                }
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Scan results view (owns filter + group state) ── */
function ScanResultsView({ violations, incomplete, passes, scanRan, scanUrl, onReset }) {
  const [filterImpact, setFilterImpact] = useState('all');
  const [groupMode, setGroupMode]       = useState('rule');
  const [searchQuery, setSearchQuery]   = useState('');
  const [wcagFilter, setWcagFilter]     = useState('all');
  const [timeline, setTimeline]         = useState([]);
  const savedRef = useRef(false);

  const score     = nsComputeScore(violations);
  const gradeInfo = nsScoreGradeInfo(score);
  const sevBreak  = nsBuildSeverityBreakdown(violations);
  const topIssues = nsBuildTopIssues(violations);
  const maxCount  = topIssues.length > 0 ? topIssues[0].count : 1;

  const [prevScan] = useState(() => loadPrevScan());

  useEffect(() => {
    if (!savedRef.current && scanRan) {
      savedRef.current = true;
      saveScanSummary({ url: scanUrl, score, totalViolations: violations.length, sevBreak });
      p4saveToTimeline(scanUrl, { ts: new Date().toISOString(), score, total: violations.length, sevBreak });
      setTimeline(p4loadTimeline(scanUrl));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredViolations = filterImpact === 'all'
    ? violations
    : violations.filter(v => (v.impact || 'minor').toLowerCase() === filterImpact);

  const searchFiltered = searchQuery.trim()
    ? filteredViolations.filter(v => {
        const q = searchQuery.toLowerCase();
        return (
          (v.help        || '').toLowerCase().includes(q) ||
          (v.id          || '').toLowerCase().includes(q) ||
          (v.description || '').toLowerCase().includes(q)
        );
      })
    : filteredViolations;

  const finalViolations = wcagFilter === 'all'
    ? searchFiltered
    : searchFiltered.filter(v => p4wcagLevel(v) === wcagFilter);

  const impactCount = (imp) => violations.filter(v => (v.impact || 'minor').toLowerCase() === imp).length;

  const scrollToViolation = (ruleId) => {
    setFilterImpact('all');
    setTimeout(() => {
      document.getElementById(`nsvi-${ruleId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  const handleNavigate = (key) => {
    setFilterImpact(key);
    setSearchQuery('');
    setWcagFilter('all');
    setTimeout(() => {
      document.getElementById('ns-violations-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const areaGroups = groupMode === 'area' ? nsGroupByArea(finalViolations) : [];

  const hasActiveFilter = filterImpact !== 'all' || searchQuery.trim() || wcagFilter !== 'all';

  return (
    <div className="space-y-4">
      {/* ── Scan complete header ── */}
      <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <CheckCircle className="w-4 h-4 text-sage" />
              <span className="text-sm font-semibold text-sage">Scan complete</span>
            </div>
            <p className="text-xs font-mono text-body dark:text-gray-400 break-all max-w-sm">{scanUrl}</p>
          </div>
          <button onClick={onReset} className="btn-secondary text-sm flex items-center gap-2 flex-shrink-0">
            <RotateCcw className="w-3.5 h-3.5" />
            Scan another
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className={`rounded-xl px-4 py-3 text-center ${violations.length > 0 ? 'bg-coral/10' : 'bg-gray-50 dark:bg-white/5'}`}>
            <p className={`font-heading font-bold text-2xl leading-none ${violations.length > 0 ? 'text-coral' : 'text-body dark:text-gray-400'}`}>{violations.length}</p>
            <p className="text-[11px] text-body dark:text-gray-500 mt-1 font-medium">Violations</p>
          </div>
          <div className={`rounded-xl px-4 py-3 text-center ${incomplete.length > 0 ? 'bg-amber/10' : 'bg-gray-50 dark:bg-white/5'}`}>
            <p className={`font-heading font-bold text-2xl leading-none ${incomplete.length > 0 ? 'text-amber' : 'text-body dark:text-gray-400'}`}>{incomplete.length}</p>
            <p className="text-[11px] text-body dark:text-gray-500 mt-1 font-medium">Needs Review</p>
          </div>
          <div className="rounded-xl px-4 py-3 text-center bg-gray-50 dark:bg-white/5">
            <p className="font-heading font-bold text-2xl leading-none text-sage">{passes.length}</p>
            <p className="text-[11px] text-body dark:text-gray-500 mt-1 font-medium">Passed</p>
          </div>
        </div>
        {!scanRan && (
          <div className="flex items-start gap-2.5 bg-amber/10 px-4 py-3 rounded-xl mt-4">
            <AlertTriangle className="w-4 h-4 text-amber flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber leading-relaxed">
              Axe returned no data — the page may have blocked the scanner (bot protection, CSP, or login required).
            </p>
          </div>
        )}
      </div>

      {/* ── Score + Severity Distribution ── */}
      {scanRan && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-body dark:text-gray-400 mb-4">
              Accessibility Score
            </p>
            <div className="flex items-center gap-4">
              <div className={`w-20 h-20 rounded-full border-4 flex flex-col items-center justify-center flex-shrink-0 ${gradeInfo.dialCls}`}>
                <span className="font-heading font-bold text-2xl leading-none">{score}</span>
                <span className="text-[10px] opacity-60 mt-0.5">/ 100</span>
              </div>
              <div className="min-w-0">
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full mb-2 inline-block ${gradeInfo.badgeCls}`}>
                  Grade {gradeInfo.grade}
                </span>
                <p className="text-sm text-body dark:text-gray-400 leading-snug">{nsScoreMessage(score)}</p>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-body dark:text-gray-400 mb-1">
              Severity Distribution
            </p>
            <SeverityDonut sevBreak={sevBreak} />
          </div>
        </div>
      )}

      {/* ── Accessibility Readiness ── */}
      {scanRan && (
        <AccessibilityReadinessCard score={score} sevBreak={sevBreak} violations={violations} passes={passes} />
      )}

      {/* ── Scan Comparison ── */}
      {scanRan && (
        <ScanComparison
          currentScore={score}
          currentTotal={violations.length}
          scanUrl={scanUrl}
          prevScan={prevScan}
        />
      )}

      {/* ── Accessibility Timeline ── */}
      {scanRan && <ScanTimeline timeline={timeline} />}

      {/* ── Keyboard + Viewport (2-col on lg) ── */}
      {scanRan && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <KeyboardInsightsCard violations={violations} />
          <ViewportComparisonPanel scanUrl={scanUrl} currentViolations={violations} />
        </div>
      )}

      {/* ── Top Issues ── */}
      {topIssues.length > 0 && (
        <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">
          <p className="font-heading font-semibold text-base text-ink dark:text-white mb-4">Top Issues</p>
          <div className="space-y-2">
            {topIssues.map((issue) => (
              <button
                key={issue.id}
                type="button"
                onClick={() => scrollToViolation(issue.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-white/5 hover:bg-teal/5 dark:hover:bg-teal/10 transition-colors text-left"
              >
                <span className="flex-1 text-sm font-medium text-ink dark:text-white truncate min-w-0">{issue.title}</span>
                <span className="w-24 h-1.5 bg-gray-200 dark:bg-white/10 rounded-full overflow-hidden flex-shrink-0">
                  <span className="block h-full bg-teal rounded-full" style={{ width: `${Math.round((issue.count / maxCount) * 100)}%` }} />
                </span>
                <span className="text-xs font-bold text-coral flex-shrink-0 min-w-[20px] text-right">{issue.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Violations + Issue Navigator sidebar ── */}
      {violations.length > 0 && (
        <div id="ns-violations-section" className="flex gap-4 items-start">
          <div className="flex-1 min-w-0 bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">

            {/* Header row */}
            <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
              <p className="font-heading font-semibold text-base text-ink dark:text-white">
                Violations{' '}
                <span className="text-sm font-normal text-body dark:text-gray-400">
                  ({finalViolations.length}{hasActiveFilter ? ` of ${violations.length}` : ''})
                </span>
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search violations…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-7 pr-3 py-1 text-xs rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-ink dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-teal dark:focus:border-teal w-36 transition-colors"
                  />
                </div>
                {/* WCAG level filter */}
                {['all', 'A', 'AA', 'BP'].map(lvl => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setWcagFilter(wcagFilter === lvl ? 'all' : lvl)}
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                      wcagFilter === lvl
                        ? 'bg-teal text-white border-teal'
                        : 'border-gray-200 dark:border-white/10 text-body dark:text-gray-400 hover:border-teal/50 dark:hover:border-teal/50'
                    }`}
                  >
                    {lvl === 'all' ? 'WCAG: All' : lvl === 'BP' ? 'Best Practice' : `WCAG ${lvl}`}
                  </button>
                ))}
              </div>
            </div>

            {/* Second header row: group toggle + impact pills */}
            <div className="flex items-center gap-2 flex-wrap mb-4">
              {/* Group mode */}
              <div className="flex items-center bg-gray-100 dark:bg-white/5 rounded-lg p-0.5 border border-gray-200 dark:border-white/5">
                <button
                  type="button"
                  onClick={() => setGroupMode('rule')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${groupMode === 'rule' ? 'bg-white dark:bg-charcoal text-teal shadow-sm' : 'text-body dark:text-gray-400 hover:text-ink dark:hover:text-white'}`}
                >
                  By Rule
                </button>
                <button
                  type="button"
                  onClick={() => setGroupMode('area')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${groupMode === 'area' ? 'bg-white dark:bg-charcoal text-teal shadow-sm' : 'text-body dark:text-gray-400 hover:text-ink dark:hover:text-white'}`}
                >
                  By Area
                </button>
              </div>
              {/* Impact pills */}
              <button
                type="button"
                onClick={() => setFilterImpact('all')}
                className={`text-xs font-semibold px-3 py-1 rounded-full border transition-colors ${filterImpact === 'all' ? 'bg-ink dark:bg-white text-white dark:text-night border-ink dark:border-white' : 'border-gray-200 dark:border-white/10 text-body dark:text-gray-400 hover:border-gray-400 dark:hover:border-white/30'}`}
              >
                All
              </button>
              {NS_IMPACT_FILTER.map((imp) => {
                const count = impactCount(imp);
                if (count === 0) return null;
                const activeStyle = { critical: 'bg-coral text-white border-coral', serious: 'bg-terracotta text-white border-terracotta', moderate: 'bg-amber text-white border-amber', minor: 'bg-sage text-white border-sage' }[imp];
                const idleStyle   = { critical: 'text-coral border-coral/30 hover:border-coral', serious: 'text-terracotta border-terracotta/30 hover:border-terracotta', moderate: 'text-amber border-amber/30 hover:border-amber', minor: 'text-sage border-sage/30 hover:border-sage' }[imp];
                return (
                  <button key={imp} type="button" onClick={() => setFilterImpact(filterImpact === imp ? 'all' : imp)}
                    className={`text-xs font-semibold px-3 py-1 rounded-full border transition-colors ${filterImpact === imp ? activeStyle : idleStyle}`}>
                    {imp.charAt(0).toUpperCase() + imp.slice(1)} · {count}
                  </button>
                );
              })}
            </div>

            {/* Violation list */}
            {finalViolations.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-body dark:text-gray-500">No violations match your filters.</p>
                {hasActiveFilter && (
                  <button type="button" onClick={() => { setFilterImpact('all'); setSearchQuery(''); setWcagFilter('all'); }}
                    className="mt-2 text-xs text-teal hover:underline">Clear all filters</button>
                )}
              </div>
            ) : groupMode === 'area' ? (
              <div className="space-y-5">
                {areaGroups.map(({ area, violations: aViolations }) => (
                  <div key={area}>
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-body dark:text-gray-400">{area}</p>
                      <span className="text-[10px] font-semibold text-body dark:text-gray-500 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded-full">{aViolations.length}</span>
                    </div>
                    <div className="space-y-2">
                      {aViolations.map((v, i) => (
                        <div key={v.id ?? i} id={`nsvi-${v.id ?? i}`}>
                          <ViolationRow violation={v} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {finalViolations.map((v, i) => (
                  <div key={v.id ?? i} id={`nsvi-${v.id ?? i}`}>
                    <ViolationRow violation={v} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sticky issue navigator — lg screens only */}
          <div className="hidden lg:block w-48 flex-shrink-0 sticky top-4 self-start">
            <IssueNavigator
              sevBreak={sevBreak}
              totalViolations={violations.length}
              onNavigate={handleNavigate}
            />
          </div>
        </div>
      )}

      {/* ── Needs Review ── */}
      {incomplete.length > 0 && (
        <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-6">
          <div className="flex items-center gap-2 mb-1">
            <p className="font-heading font-semibold text-base text-ink dark:text-white">Needs Review</p>
            <span className="text-xs font-semibold text-amber bg-amber/10 px-2 py-0.5 rounded-full">{incomplete.length}</span>
          </div>
          <p className="text-xs text-body dark:text-gray-500 mb-4">
            Axe could not automatically confirm these — they require manual inspection.
          </p>
          <div className="space-y-2">
            {incomplete.map((v, i) => (
              <ViolationRow key={v.id ?? i} violation={{ ...v, impact: v.impact ?? 'moderate' }} />
            ))}
          </div>
        </div>
      )}

      {/* ── All clear ── */}
      {violations.length === 0 && incomplete.length === 0 && scanRan && (
        <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft p-10 text-center">
          <div className="w-16 h-16 rounded-2xl bg-teal/10 flex items-center justify-center mx-auto mb-5">
            <CheckCircle className="w-8 h-8 text-teal" />
          </div>
          <p className="font-heading font-bold text-2xl text-ink dark:text-white mb-3">Excellent accessibility</p>
          <div className={`inline-flex items-baseline gap-1.5 rounded-full px-5 py-2 mb-5 ${gradeInfo.badgeCls}`}>
            <span className="font-heading font-bold text-3xl">{score}</span>
            <span className="text-sm opacity-70">/ 100 · Grade {gradeInfo.grade}</span>
          </div>
          <p className="text-sm text-body dark:text-gray-400 max-w-sm mx-auto leading-relaxed mb-6">
            No accessibility violations detected.{passes.length > 0 ? ` ${passes.length} rules passed.` : ''}{' '}
            Automated tools catch ~35% of WCAG issues — manual testing is still recommended.
          </p>
          <div className="inline-flex items-center gap-2 bg-teal/5 border border-teal/15 rounded-xl px-4 py-2.5 text-sm text-teal font-medium">
            Continue monitoring accessibility as your site evolves
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Field wrapper ── */
function Field({ label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-semibold uppercase tracking-widest text-body dark:text-gray-400">
        {label}
        {hint && <span className="ml-1 normal-case font-normal text-body dark:text-gray-500">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

/* ── Option row (full-width toggle row, no nested card) ── */
function OptionRow({ title, description, children }) {
  return (
    <div className="flex items-start justify-between gap-8 py-5 border-b border-gray-100 dark:border-white/[0.06] last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink dark:text-white">{title}</p>
        {description && (
          <p className="text-sm text-body dark:text-gray-400 mt-1 leading-relaxed">{description}</p>
        )}
      </div>
      <div className="flex-shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

/* ── Section divider ── */
function Divider() {
  return <div className="border-t border-gray-100 dark:border-white/[0.06]" />;
}

/* ── Page ── */
export default function NewScanPage() {
  const { navigate, setCrawlId } = useApp();

  const [activeTab, setActiveTab] = useState('single');

  /* single scan */
  const [scanUrl, setScanUrl]                           = useState('');
  const [includeBestPractices, setIncludeBestPractices] = useState(false);
  const [scanPhase, setScanPhase]                       = useState('idle');
  const [scanResult, setScanResult]                     = useState(null);
  const [scanError, setScanError]                       = useState('');

  /* crawl */
  const [crawlUrl, setCrawlUrl]         = useState('');
  const [maxPages, setMaxPages]         = useState(50);
  const [maxDepth, setMaxDepth]         = useState(3);
  const [fullSite, setFullSite]         = useState(false);
  const [notifyEmail, setNotifyEmail]   = useState('');
  const [crawlLoading, setCrawlLoading] = useState(false);

  const resetScan = useCallback(() => {
    setScanPhase('idle');
    setScanResult(null);
    setScanError('');
    setScanUrl('');
  }, []);

  /* ── poll scan job ── */
  const pollScan = useCallback((jobId) => {
    const iv = setInterval(async () => {
      try {
        const res  = await fetch(`/api/scan/${jobId}`);
        const data = await res.json();
        if (!data.ok) { clearInterval(iv); setScanPhase('failed'); setScanError('Could not retrieve scan status.'); return; }
        const s = data.job?.status;
        if (s === 'completed') { clearInterval(iv); setScanPhase('done'); setScanResult(data.job?.result ?? null); }
        else if (s === 'failed') { clearInterval(iv); setScanPhase('failed'); setScanError('Scan failed. Please check the URL and try again.'); }
      } catch { clearInterval(iv); setScanPhase('failed'); setScanError('Network error while polling scan status.'); }
    }, 2500);
  }, []);

  /* ── start single scan ── */
  const handleStartScan = useCallback(async () => {
    const url = scanUrl.trim();
    if (!url) return;
    setScanPhase('scanning'); setScanResult(null); setScanError('');
    try {
      const res  = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, includeBestPractices }),
      });
      const data = await res.json();
      if (!data.ok) { setScanPhase('failed'); setScanError(data.message ?? 'Failed to start scan.'); return; }
      pollScan(data.jobId);
    } catch { setScanPhase('failed'); setScanError('Network error. Please try again.'); }
  }, [scanUrl, includeBestPractices, pollScan]);

  /* ── start crawl ── */
  const handleStartCrawl = useCallback(async () => {
    const url = crawlUrl.trim();
    if (!url) return;
    setCrawlLoading(true);
    try {
      const res  = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, maxPages, maxDepth, fullSite, notifyEmail: notifyEmail.trim() || undefined }),
      });
      const data = await res.json();
      if (!data.ok) { setCrawlLoading(false); return; }
      setCrawlId(data.crawl_id);
      navigate('crawl-results');
    } catch { setCrawlLoading(false); }
  }, [crawlUrl, maxPages, maxDepth, fullSite, notifyEmail, setCrawlId, navigate]);

  const violations = scanResult?.axeResult?.violations ?? [];
  const incomplete = scanResult?.axeResult?.incomplete  ?? [];
  const passes     = scanResult?.axeResult?.passes      ?? [];
  const scanRan    = passes.length > 0 || violations.length > 0 || incomplete.length > 0;

  const tabs = [
    { id: 'single', label: 'Single Page Scan', icon: Search   },
    { id: 'html',   label: 'HTML Validation',  icon: FileCode },
    { id: 'crawl',  label: 'Site Crawl',       icon: Globe    },
  ];

  return (
    <div className="flex-1 overflow-auto bg-ivory dark:bg-night">
      <div className="px-8 py-8 lg:px-12">

        {/* ── PAGE HEADER ── */}
        <div className="mb-8">
          <h1 className="font-heading font-bold text-3xl text-ink dark:text-white mb-2">New Scan</h1>
          <p className="text-base text-body dark:text-gray-400">
            Run accessibility audits, site crawls, and validation checks across your websites.
          </p>
        </div>

        {/* ── SEGMENTED TABS ── */}
        <div className="inline-flex bg-gray-100 dark:bg-charcoal/80 rounded-xl p-1 gap-0.5 mb-8 border border-gray-200 dark:border-white/[0.06]">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => {
                if (id === 'single' && scanPhase === 'done') resetScan();
                setActiveTab(id);
              }}
              className={[
                'flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                activeTab === id
                  ? 'bg-white dark:bg-night shadow-sm text-teal font-semibold'
                  : 'text-gray-500 dark:text-gray-400 hover:text-ink dark:hover:text-white hover:bg-white/60 dark:hover:bg-white/5',
              ].join(' ')}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>

        {/* ═══ SINGLE PAGE SCAN ═══ */}
        {activeTab === 'single' && (
          <>
            {(scanPhase === 'idle' || scanPhase === 'failed') && (
              <>
                {/* URL Section */}
                <section className="pb-3">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-body dark:text-gray-400 mb-3">
                    Website URL
                  </p>
                  <GlowInput
                    large
                    icon={Search}
                    type="url"
                    value={scanUrl}
                    onChange={e => setScanUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && scanUrl.trim() && handleStartScan()}
                    placeholder="https://example.com"
                  />
                </section>

                <Divider />

                {/* Scan Options */}
                <section className="pt-2 pb-1">
                  <div className="flex items-start justify-between gap-8 py-3 border-b border-gray-100 dark:border-white/[0.06]">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink dark:text-white">Best Practices</p>
                      <p className="text-sm text-body dark:text-gray-400 mt-1 leading-relaxed">Includes non-WCAG rules to provide broader accessibility guidance. Issue count may increase.</p>
                    </div>
                    <div className="flex-shrink-0 pt-0.5">
                      <Toggle
                        id="best-practices"
                        checked={includeBestPractices}
                        onChange={e => setIncludeBestPractices(e.target.checked)}
                      />
                    </div>
                  </div>
                </section>

                {scanPhase === 'failed' && scanError && (
                  <div className="flex items-center gap-2.5 bg-coral/10 text-coral px-4 py-3 rounded-xl text-sm mb-3">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    {scanError}
                  </div>
                )}

                <Divider />

                {/* CTA */}
                <div className="pt-4">
                  <button
                    onClick={handleStartScan}
                    disabled={!scanUrl.trim()}
                    className="btn-primary w-full justify-center py-4 text-base font-semibold"
                  >
                    <Play className="w-5 h-5" />
                    Start Scan
                  </button>
                </div>
              </>
            )}

            {scanPhase === 'scanning' && (
              <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft">
                <ScanLoader url={scanUrl} />
              </div>
            )}

            {scanPhase === 'done' && (
              <ScanResultsView
                violations={violations}
                incomplete={incomplete}
                passes={passes}
                scanRan={scanRan}
                scanUrl={scanUrl}
                onReset={resetScan}
              />
            )}
          </>
        )}

        {/* ═══ HTML VALIDATION ═══ */}
        {activeTab === 'html' && (
          <div className="py-20 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-teal/10 flex items-center justify-center mb-4">
              <FileCode className="w-8 h-8 text-teal" />
            </div>
            <p className="font-heading font-bold text-xl text-ink dark:text-white">HTML Validation</p>
            <p className="text-sm text-body dark:text-gray-400 mt-2 max-w-xs leading-relaxed">
              Upload an HTML file for offline accessibility validation. Coming in the next release.
            </p>
            <span className="inline-block mt-5 text-xs font-semibold text-teal bg-teal/10 px-3 py-1.5 rounded-full">Coming Soon</span>
          </div>
        )}

        {/* ═══ SITE CRAWL ═══ */}
        {activeTab === 'crawl' && (
          <>
            {/* Root URL Section */}
            <section className="pb-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-body dark:text-gray-400 mb-3">
                Root URL
              </p>
              <GlowInput
                large
                icon={Globe}
                type="url"
                value={crawlUrl}
                onChange={e => setCrawlUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !crawlLoading && handleStartCrawl()}
                placeholder="https://example.com"
                disabled={crawlLoading}
              />
            </section>

            <Divider />

            {/* Crawl Options */}
            <section className="pt-5 pb-1">
              <p className="font-heading font-semibold text-lg text-ink dark:text-white mb-1">Crawl Options</p>
              <p className="text-sm text-body dark:text-gray-500 mb-3">Configure how deep and wide the crawler explores your site.</p>

              {!fullSite && (
                <div className="grid grid-cols-2 gap-4 mb-2">
                  <Field label="Max Pages">
                    <GlowInput
                      type="number"
                      value={maxPages}
                      onChange={e => setMaxPages(Math.max(1, Math.min(500, Number(e.target.value))))}
                      min={1} max={500}
                      disabled={crawlLoading}
                    />
                  </Field>
                  <Field label="Max Depth">
                    <GlowInput
                      type="number"
                      value={maxDepth}
                      onChange={e => setMaxDepth(Math.max(1, Math.min(10, Number(e.target.value))))}
                      min={1} max={10}
                      disabled={crawlLoading}
                    />
                  </Field>
                  <p className="col-span-2 text-xs text-body dark:text-gray-500 -mt-2">
                    Crawls up to <strong className="text-ink dark:text-gray-300">{maxPages} pages</strong> from the root URL,
                    following links up to depth <strong className="text-ink dark:text-gray-300">{maxDepth}</strong>.
                  </p>
                </div>
              )}

              <div className="flex items-start justify-between gap-8 py-3 border-b border-gray-100 dark:border-white/[0.06]">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink dark:text-white">Full Site Crawl</p>
                  <p className="text-sm text-body dark:text-gray-400 mt-1 leading-relaxed">No page limit — crawls the entire site (up to 10,000 pages).</p>
                </div>
                <div className="flex-shrink-0 pt-0.5">
                  <Toggle id="full-site" checked={fullSite} onChange={e => setFullSite(e.target.checked)} disabled={crawlLoading} />
                </div>
              </div>

              {fullSite && (
                <div className="flex items-start gap-2.5 bg-amber/10 px-4 py-3 rounded-xl mt-3">
                  <AlertTriangle className="w-4 h-4 text-amber flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber leading-relaxed">
                    Full site crawl enabled. This may take several hours for large sites.
                    The crawl runs in the background — you can close this page anytime.
                  </p>
                </div>
              )}
            </section>

            <Divider />

            {/* Notifications */}
            <section className="pt-3 pb-5">
              <p className="font-heading font-semibold text-lg text-ink dark:text-white mb-1">Notifications</p>
              <p className="text-sm text-body dark:text-gray-500 mb-3">Receive an email report when the crawl completes.</p>
              <Field label="Email Address" hint="(optional)">
                <GlowInput
                  type="email"
                  value={notifyEmail}
                  onChange={e => setNotifyEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={crawlLoading}
                />
              </Field>
            </section>

            <Divider />

            {/* CTA */}
            <div className="pt-5">
              <button
                onClick={handleStartCrawl}
                disabled={crawlLoading || !crawlUrl.trim()}
                className="btn-primary w-full justify-center py-4 text-base font-semibold"
              >
                {crawlLoading
                  ? <><span className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Starting Crawl…</>
                  : <><Play className="w-5 h-5" /> Start Site Crawl</>
                }
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
