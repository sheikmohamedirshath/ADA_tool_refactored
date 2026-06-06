import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  Download,
  ArrowUpDown,
  ChevronRight,
  Globe,
  AlertTriangle,
  CheckCircle,
  BarChart2,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useApp } from '../context/AppContext';
import { StatusBadge } from '../components/ui/StatusBadge';
import MetricCard from '../components/ui/MetricCard';
import { ChartCard } from '../components/ui/ChartCard';
import DetailsDrawer from '../components/ui/DetailsDrawer';
import ScoreGauge from '../components/ui/ScoreGauge';


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normaliseStatus(raw) {
  if (!raw) return 'Needs review';
  const s = raw.toLowerCase();
  if (s === 'passed' || s === 'pass' || s === 'scanned' || s === 'completed') return 'Passed';
  if (s === 'failed' || s === 'fail' || s === 'error') return 'Failed';
  if (s === 'running') return 'Running';
  if (s === 'pending') return 'Running';
  return 'Needs review';
}

function violationCount(page) {
  if (typeof page.violations === 'number') return page.violations;
  if (Array.isArray(page.violations)) return page.violations.length;
  return page.violation_count ?? 0;
}

function computePageScore(page) {
  if (page.score !== undefined && page.score !== null) return Math.round(page.score);
  const raw = Math.max(0, 100 - violationCount(page) * 5);
  return Math.round(raw);
}

function exportCSV(pages) {
  const header = ['URL', 'Score', 'Violations', 'Status'];
  const rows = pages.map((p) => [
    `"${p.url}"`,
    computePageScore(p),
    violationCount(p),
    normaliseStatus(p.status),
  ]);
  const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'crawl-results.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SortableHeader({ label, sortKey: key, currentSort, currentDir, onSort }) {
  const active = currentSort === key;
  return (
    <th
      className="px-4 py-3 text-left text-xs font-semibold text-body dark:text-gray-400 uppercase tracking-wide cursor-pointer select-none whitespace-nowrap"
      onClick={() => onSort(key)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown
          size={13}
          className={active ? 'text-teal' : 'text-gray-300 dark:text-gray-600'}
        />
      </span>
    </th>
  );
}

function ScoreMiniBar({ score }) {
  const colour =
    score >= 80 ? '#0F766E' : score >= 60 ? '#F59E0B' : '#E76F51';
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${score}%`, backgroundColor: colour }}
        />
      </div>
      <span className="text-xs font-semibold text-ink dark:text-white w-7 text-right">
        {score}
      </span>
    </div>
  );
}

function FilterPill({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
        active
          ? 'bg-teal text-white'
          : 'bg-gray-100 dark:bg-white/5 text-body dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10'
      }`}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function CrawlResultsPage() {
  const { crawlId, navigate } = useApp();

  const [job, setJob] = useState(null);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState('url');
  const [sortDir, setSortDir] = useState('asc');

  const pollRef = useRef(null);

  // ---- fetch helpers -------------------------------------------------------
  const fetchJob = useCallback(async () => {
    if (!crawlId) return null;
    try {
      const res = await fetch(`/api/crawl/${crawlId}`);
      const data = await res.json();
      if (data.ok && data.job) return data.job;
    } catch {
      // network error — ignore, keep existing state
    }
    return null;
  }, [crawlId]);

  const fetchPages = useCallback(async () => {
    if (!crawlId) return [];
    try {
      const res = await fetch(`/api/crawl/${crawlId}/pages`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.pages)) return data.pages;
    } catch {
      // ignore
    }
    return [];
  }, [crawlId]);

  // ---- mount / crawlId change ----------------------------------------------
  useEffect(() => {
    if (!crawlId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      const [j, p] = await Promise.all([fetchJob(), fetchPages()]);
      if (cancelled) return;
      setJob(j);
      setPages(p);
      setLoading(false);

      const isActive = j && (j.status === 'running' || j.status === 'pending');
      setPolling(isActive);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [crawlId, fetchJob, fetchPages]);

  // ---- polling -------------------------------------------------------------
  useEffect(() => {
    if (!polling) {
      clearInterval(pollRef.current);
      return;
    }

    pollRef.current = setInterval(async () => {
      const [j, p] = await Promise.all([fetchJob(), fetchPages()]);
      setJob(j);
      setPages(p);
      const isActive = j && (j.status === 'running' || j.status === 'pending');
      if (!isActive) setPolling(false);
    }, 2500);

    return () => clearInterval(pollRef.current);
  }, [polling, fetchJob, fetchPages]);

  // ---- sort handler --------------------------------------------------------
  function handleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  // ---- derived data --------------------------------------------------------
  const enrichedPages = pages.map((p) => ({
    ...p,
    _score: computePageScore(p),
    _violations: violationCount(p),
    _status: normaliseStatus(p.status),
  }));

  const filteredPages = enrichedPages
    .filter((p) => {
      const matchSearch =
        !searchQuery || (p.url && p.url.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchStatus =
        statusFilter === 'all' ||
        (statusFilter === 'scanned' && p._status !== 'Failed') ||
        (statusFilter === 'failed' && p._status === 'Failed');
      return matchSearch && matchStatus;
    })
    .sort((a, b) => {
      let av, bv;
      if (sortKey === 'url') {
        av = a.url ?? '';
        bv = b.url ?? '';
      } else if (sortKey === 'score') {
        av = a._score;
        bv = b._score;
      } else if (sortKey === 'violations') {
        av = a._violations;
        bv = b._violations;
      } else if (sortKey === 'status') {
        av = a._status;
        bv = b._status;
      } else {
        av = '';
        bv = '';
      }
      if (typeof av === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });

  // totals
  const totalPages = enrichedPages.length;
  const totalViolations = enrichedPages.reduce((s, p) => s + p._violations, 0);
  const avgScore =
    totalPages > 0
      ? Math.round(enrichedPages.reduce((s, p) => s + p._score, 0) / totalPages)
      : 0;
  // "Passed" = scanned successfully with 0 violations
  const passed = enrichedPages.filter((p) => p._violations === 0 && p._status !== 'Failed').length;
  const passRate = totalPages > 0 ? Math.round((passed / totalPages) * 100) : 0;

  // Passing vs Failing pie chart (based on violation count, not scan status)
  const failingPages = enrichedPages.filter((p) => p._violations > 0).length;
  const passingPages = enrichedPages.filter((p) => p._violations === 0 && p._status !== 'Failed').length;
  const errorPages   = enrichedPages.filter((p) => p._status === 'Failed').length;
  const statusPieData = [
    passingPages > 0 && { name: 'Passing',  value: passingPages, color: '#6BA368' },
    failingPages > 0 && { name: 'Has Issues', value: failingPages, color: '#E76F51' },
    errorPages   > 0 && { name: 'Error',    value: errorPages,   color: '#9CA3AF' },
  ].filter(Boolean);

  // Top pages by violations bar chart (uses int counts — always available)
  const topViolationPages = [...enrichedPages]
    .filter((p) => p._violations > 0)
    .sort((a, b) => b._violations - a._violations)
    .slice(0, 10)
    .map((p) => ({
      name: (p.url || '').replace(/^https?:\/\/[^/]+/, '').slice(0, 30) || '/',
      violations: p._violations,
      url: p.url,
    }));

  // progress
  const maxPages = job?.max_pages ?? job?.total_discovered ?? 1;
  const scanned = job?.total_scanned ?? 0;
  const progressPct = maxPages > 0 ? Math.min(100, Math.round((scanned / maxPages) * 100)) : 0;

  const jobUrl = job?.root_url ?? job?.url ?? job?.start_url ?? '';
  const isActive = job && (job.status === 'running' || job.status === 'pending');

  // ---- empty state ---------------------------------------------------------
  if (!crawlId) {
    return (
      <div className="flex-1 overflow-auto bg-ivory dark:bg-night p-6 flex items-center justify-center">
        <div className="card p-10 max-w-md w-full text-center space-y-4">
          <Globe className="w-12 h-12 text-teal mx-auto" />
          <h2 className="font-heading text-2xl text-ink dark:text-white">No crawl selected</h2>
          <p className="text-body dark:text-gray-400 text-sm">
            No crawl in progress. Start a site crawl from New Scan.
          </p>
          <button className="btn-primary" onClick={() => navigate('new-scan')}>
            New Scan
          </button>
        </div>
      </div>
    );
  }

  // ---- loading skeleton ----------------------------------------------------
  if (loading) {
    return (
      <div className="flex-1 overflow-auto bg-ivory dark:bg-night p-6 space-y-6">
        <div className="h-10 w-64 bg-gray-200 dark:bg-white/10 rounded-2xl animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <MetricCard key={i} loading />
          ))}
        </div>
        <div className="h-64 bg-gray-200 dark:bg-white/10 rounded-2xl animate-pulse" />
      </div>
    );
  }

  // ---- main render ---------------------------------------------------------
  return (
    <>
      <div className="flex-1 overflow-auto bg-ivory dark:bg-night p-6 space-y-6">

        {/* 1. HEADER */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="font-heading font-bold text-2xl text-ink dark:text-white">
              Crawl Results
            </h2>
            {job?.status && (
              <StatusBadge status={normaliseStatus(job.status)} />
            )}
          </div>
          {jobUrl && (
            <code className="text-xs font-mono bg-white dark:bg-charcoal border border-gray-200 dark:border-white/10 px-3 py-1.5 rounded-2xl text-body dark:text-gray-400 max-w-xs truncate">
              {jobUrl}
            </code>
          )}
        </div>

        {/* 2. METRIC CARDS */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Total Pages"
            value={totalPages}
            icon={Globe}
            color="teal"
          />
          <MetricCard
            title="Total Violations"
            value={totalViolations}
            icon={AlertTriangle}
            color="coral"
          />
          <MetricCard
            title="Avg Score"
            value={avgScore}
            icon={BarChart2}
            color={avgScore >= 80 ? 'sage' : avgScore >= 60 ? 'amber' : 'coral'}
          />
          <MetricCard
            title="Pass Rate"
            value={`${passRate}%`}
            icon={CheckCircle}
            color="sage"
          />
        </div>

        {/* 3. PROGRESS (running/pending only) */}
        {isActive && (
          <div className="card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-heading font-bold text-ink dark:text-white">
                Crawl in Progress
              </h3>
              <span className="text-sm text-body dark:text-gray-400">
                {progressPct}%
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-teal transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex gap-6 flex-wrap text-sm">
              <div>
                <span className="text-body dark:text-gray-400">Discovered </span>
                <span className="font-semibold text-ink dark:text-white">
                  {job?.total_discovered ?? 0}
                </span>
              </div>
              <div>
                <span className="text-body dark:text-gray-400">Scanned </span>
                <span className="font-semibold text-teal">{job?.total_scanned ?? 0}</span>
              </div>
              <div>
                <span className="text-body dark:text-gray-400">Failed </span>
                <span className="font-semibold text-coral">{job?.total_failed ?? 0}</span>
              </div>
            </div>
          </div>
        )}

        {/* 4. CHARTS ROW */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Pie — passing vs failing pages */}
          <ChartCard
            title="Pages: Passing vs Has Issues"
            subtitle="Pages with 0 violations vs pages with at least one violation"
          >
            {statusPieData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-body dark:text-gray-400 text-sm">
                No pages scanned yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={statusPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {statusPieData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-charcoal, #1F1F1F)',
                      border: 'none',
                      borderRadius: 12,
                      color: '#F8F6F1',
                      fontSize: 12,
                    }}
                    formatter={(v, name) => [`${v} page${v !== 1 ? 's' : ''}`, name]}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    formatter={(value) => (
                      <span style={{ color: '#4B5563', fontSize: 12 }}>{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Bar — top pages by violation count */}
          <ChartCard
            title="Top Pages by Violations"
            subtitle="Pages with the most accessibility violations"
          >
            {topViolationPages.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-body dark:text-gray-400 text-sm">
                No violations found across scanned pages
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={topViolationPages}
                  layout="vertical"
                  barCategoryGap="20%"
                  margin={{ left: 8, right: 24, top: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" horizontal={false} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#4B5563' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={100}
                    tick={{ fontSize: 10, fill: '#4B5563' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-charcoal, #1F1F1F)',
                      border: 'none',
                      borderRadius: 12,
                      color: '#F8F6F1',
                      fontSize: 12,
                    }}
                    formatter={(v) => [v, 'Violations']}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.url ?? ''}
                  />
                  <Bar dataKey="violations" fill="#E76F51" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        {/* 5. CONTROLS */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-body dark:text-gray-400 pointer-events-none"
            />
            <input
              type="text"
              className="input-base pl-9 py-2 text-sm w-full"
              placeholder="Search URLs…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Status filters */}
          <div className="flex gap-2">
            {['all', 'scanned', 'failed'].map((f) => (
              <FilterPill
                key={f}
                label={f.charAt(0).toUpperCase() + f.slice(1)}
                active={statusFilter === f}
                onClick={() => setStatusFilter(f)}
              />
            ))}
          </div>

          {/* Export */}
          <button
            className="btn-secondary flex items-center gap-2 text-sm ml-auto"
            onClick={() => exportCSV(enrichedPages)}
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>

        {/* 6. PAGES TABLE */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 dark:border-white/5">
                <tr>
                  <SortableHeader
                    label="URL"
                    sortKey="url"
                    currentSort={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Score"
                    sortKey="score"
                    currentSort={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Violations"
                    sortKey="violations"
                    currentSort={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Status"
                    sortKey="status"
                    currentSort={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                  <th className="px-4 py-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                {filteredPages.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-10 text-center text-body dark:text-gray-400"
                    >
                      {pages.length === 0 ? 'No pages scanned yet.' : 'No pages match your filters.'}
                    </td>
                  </tr>
                ) : (
                  filteredPages.map((page, idx) => (
                    <tr
                      key={page.url ?? idx}
                      className="hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer transition-colors"
                      onClick={() => setSelectedRow(page)}
                    >
                      {/* URL */}
                      <td className="px-4 py-3 max-w-xs">
                        <span
                          className="block truncate font-mono text-xs text-ink dark:text-white"
                          title={page.url}
                        >
                          {page.url}
                        </span>
                      </td>

                      {/* Score */}
                      <td className="px-4 py-3 min-w-[120px]">
                        <ScoreMiniBar score={page._score} />
                      </td>

                      {/* Violations */}
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`font-semibold ${
                            page._violations > 0 ? 'text-coral' : 'text-sage'
                          }`}
                        >
                          {page._violations}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <StatusBadge status={page._status} />
                      </td>

                      {/* Arrow */}
                      <td className="px-4 py-3 text-right">
                        <ChevronRight
                          size={16}
                          className="text-body dark:text-gray-400 inline"
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Table footer */}
          {filteredPages.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-100 dark:border-white/5 text-xs text-body dark:text-gray-400">
              Showing {filteredPages.length} of {totalPages} pages
            </div>
          )}
        </div>
      </div>

      {/* 7. DETAILS DRAWER */}
      {selectedRow && (
        <DetailsDrawer
          row={{
            url: selectedRow.url,
            score: selectedRow._score,
            violations: Array.isArray(selectedRow.violations)
              ? selectedRow.violations
              : [],
            status: selectedRow._status,
          }}
          onClose={() => setSelectedRow(null)}
        />
      )}
    </>
  );
}
