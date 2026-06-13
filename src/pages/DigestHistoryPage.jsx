import { apiFetch } from '../utils/api';
import { useState, useEffect } from 'react';
import { Mail, TrendingUp, TrendingDown, Minus, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';

function formatDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

function TrendIcon({ trend }) {
  if (trend === 'improving') return <TrendingUp size={13} className="text-sage" />;
  if (trend === 'declining') return <TrendingDown size={13} className="text-coral" />;
  return <Minus size={13} className="text-gray-400" />;
}

function SiteSummaryRow({ site }) {
  return (
    <tr className="border-b border-gray-50 dark:border-white/[0.04] last:border-0">
      <td className="py-2 px-3 text-xs text-teal truncate max-w-[200px]" title={site.root_url}>
        {site.root_url}
      </td>
      <td className="py-2 px-3 text-xs text-center text-body dark:text-gray-400">{site.crawl_count}</td>
      <td className="py-2 px-3 text-xs text-center font-semibold text-ink dark:text-white">
        {site.avg_score ?? '—'}
      </td>
      <td className="py-2 px-3 text-xs text-center">
        <span className="flex items-center justify-center gap-1">
          <TrendIcon trend={site.score_trend} />
        </span>
      </td>
      <td className="py-2 px-3 text-xs text-center text-body dark:text-gray-400">
        {site.total_violations ?? '—'}
      </td>
    </tr>
  );
}

function DigestCard({ digest }) {
  const [expanded, setExpanded] = useState(false);
  const data = digest.digest_data || {};
  const sites = data.sites || [];

  return (
    <div className="bg-white dark:bg-charcoal rounded-xl border border-gray-100 dark:border-white/[0.06] shadow-soft overflow-hidden">
      <button
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-teal/10 flex items-center justify-center">
            <Mail size={15} className="text-teal" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-sm text-ink dark:text-white">
              {data.week_start} – {data.week_end}
            </p>
            <p className="text-xs text-body dark:text-gray-400 mt-0.5">
              {data.total_sites || 0} site(s) · {data.total_crawls || 0} crawl(s)
              {digest.email_sent_to && (
                <span className="ml-2 text-teal">· Sent to {digest.email_sent_to}</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-body dark:text-gray-500 hidden sm:block">
            Generated {formatDate(digest.created_at)}
          </span>
          {expanded
            ? <ChevronDown size={15} className="text-body dark:text-gray-400" />
            : <ChevronRight size={15} className="text-body dark:text-gray-400" />
          }
        </div>
      </button>

      {expanded && sites.length > 0 && (
        <div className="border-t border-gray-100 dark:border-white/[0.06] px-5 py-4">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-night">
                  {['Site', 'Crawls', 'Score', 'Trend', 'Violations'].map((h) => (
                    <th key={h} className="py-2 px-3 text-left text-[10px] font-semibold text-body dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sites.map((site, i) => <SiteSummaryRow key={i} site={site} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {expanded && sites.length === 0 && (
        <p className="px-5 py-4 text-sm text-body dark:text-gray-400 border-t border-gray-100 dark:border-white/[0.06]">
          No site data in this digest.
        </p>
      )}
    </div>
  );
}

export default function DigestHistoryPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [available, setAvailable] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState('');

  useEffect(() => { loadDigests(); }, []);

  async function loadDigests() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/digests?limit=12');
      const data = await res.json();
      if (data.ok) {
        setItems(data.items || []);
        setAvailable(data.available !== false);
      } else {
        setError(data.error || 'Failed to load digests');
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  async function handleTrigger() {
    setTriggering(true);
    setTriggerMsg('');
    try {
      const res = await apiFetch('/api/digests/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ send_email: true }),
      });
      const data = await res.json();
      if (data.ok) {
        setTriggerMsg('Digest generated successfully.');
        loadDigests();
      } else {
        setTriggerMsg(data.error || 'Failed to generate digest');
      }
    } catch (e) {
      setTriggerMsg(e.message);
    }
    setTriggering(false);
  }

  return (
    <main className="flex-1 overflow-auto bg-ivory dark:bg-night p-6 min-h-0" role="main">
      <div className="max-w-[860px] mx-auto space-y-6">

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[1.75rem] font-bold text-ink dark:text-white mt-0 mb-1">
              Weekly Digest
            </h1>
            <p className="text-body dark:text-gray-400 text-[0.9375rem]">
              A weekly summary of accessibility activity across all crawled sites, emailed to your configured address.
            </p>
          </div>
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="btn-primary flex items-center gap-2 shrink-0"
          >
            {triggering ? <RefreshCw size={14} className="animate-spin" /> : <Mail size={14} />}
            {triggering ? 'Generating…' : 'Generate Now'}
          </button>
        </div>

        {triggerMsg && (
          <p className={`text-sm px-4 py-3 rounded-xl ${
            triggerMsg.includes('success')
              ? 'bg-sage/10 text-sage border border-sage/30'
              : 'bg-coral/10 text-coral border border-coral/30'
          }`}>
            {triggerMsg}
          </p>
        )}

        {!available && !loading && (
          <p className="text-sm text-body dark:text-gray-400 bg-teal/10 px-4 py-3 rounded-xl border border-teal">
            Database not configured — digest history requires MSSQL.
          </p>
        )}

        {loading && (
          <div className="space-y-3">
            {[1, 2].map((i) => <div key={i} className="h-16 bg-gray-200 dark:bg-white/10 rounded-xl animate-pulse" />)}
          </div>
        )}

        {error && (
          <p className="text-sm text-coral bg-coral/10 px-4 py-3 rounded-xl border border-coral/30">{error}</p>
        )}

        {!loading && !error && items.length === 0 && available && (
          <div className="mt-16 flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-teal/10 flex items-center justify-center">
              <Mail className="w-8 h-8 text-teal" />
            </div>
            <p className="font-heading font-bold text-xl text-ink dark:text-white">No digests yet</p>
            <p className="text-sm text-body dark:text-gray-400 max-w-xs leading-relaxed">
              Click "Generate Now" to create your first weekly accessibility digest.
            </p>
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <div className="space-y-3">
            {items.map((digest) => <DigestCard key={digest.id} digest={digest} />)}
          </div>
        )}

        <div className="text-xs text-body dark:text-gray-500 bg-gray-50 dark:bg-white/[0.03] rounded-xl p-4 space-y-1">
          <p className="font-semibold text-ink dark:text-gray-300">Email delivery</p>
          <p>Digests are sent to <code className="font-mono text-[10px]">DIGEST_EMAIL</code> (defaults to <code className="font-mono text-[10px]">SMTP_FROM</code>) when SMTP is configured.</p>
          <p>Click "Generate Now" to trigger a digest manually at any time.</p>
        </div>

      </div>
    </main>
  );
}
