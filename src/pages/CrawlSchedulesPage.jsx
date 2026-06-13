import { apiFetch } from '../utils/api';
import { useState, useEffect } from 'react';
import { CalendarClock, Plus, Trash2, Play, Pause, RefreshCw } from 'lucide-react';
import GlowInput from '../components/ui/GlowInput';

const FREQ_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const FREQ_OPTIONS = ['daily', 'weekly', 'monthly'];

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function FrequencyBadge({ freq }) {
  const cls = {
    daily:   'bg-teal/10 text-teal',
    weekly:  'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    monthly: 'bg-amber/10 text-amber',
  }[freq] || 'bg-gray-100 dark:bg-white/5 text-body dark:text-gray-400';
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      {FREQ_LABELS[freq] || freq}
    </span>
  );
}

export default function CrawlSchedulesPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [available, setAvailable] = useState(true);

  // Create form state
  const [showForm, setShowForm] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newFreq, setNewFreq] = useState('weekly');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // In-flight action trackers
  const [togglingId, setTogglingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => { loadSchedules(); }, []);

  async function loadSchedules() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/crawl-schedules');
      const data = await res.json();
      if (data.ok) {
        setItems(data.items || []);
        setAvailable(data.available !== false);
      } else {
        setError(data.error || 'Failed to load schedules');
      }
    } catch (e) {
      setError(e.message || 'Network error');
    }
    setLoading(false);
  }

  async function handleCreate(e) {
    e.preventDefault();
    const url = newUrl.trim();
    if (!url) { setCreateError('URL is required'); return; }
    setCreating(true);
    setCreateError('');
    try {
      const res = await apiFetch('/api/crawl-schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, frequency: newFreq }),
      });
      const data = await res.json();
      if (data.ok) {
        setNewUrl('');
        setNewFreq('weekly');
        setShowForm(false);
        loadSchedules();
      } else {
        setCreateError(data.error || 'Failed to create schedule');
      }
    } catch (e) {
      setCreateError(e.message);
    }
    setCreating(false);
  }

  async function handleToggle(item) {
    setTogglingId(item.id);
    try {
      await apiFetch(`/api/crawl-schedules/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !item.enabled }),
      });
      loadSchedules();
    } catch {}
    setTogglingId(null);
  }

  async function handleDelete(id) {
    if (!confirm('Delete this schedule?')) return;
    setDeletingId(id);
    try {
      await apiFetch(`/api/crawl-schedules/${id}`, { method: 'DELETE' });
      loadSchedules();
    } catch {}
    setDeletingId(null);
  }

  return (
    <main className="flex-1 overflow-auto bg-ivory dark:bg-night p-6 min-h-0" role="main">
      <div className="max-w-[900px] mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[1.75rem] font-bold text-ink dark:text-white mt-0 mb-1">
              Crawl Schedules
            </h1>
            <p className="text-body dark:text-gray-400 text-[0.9375rem]">
              Automatically run site crawls on a recurring schedule. Duplicate crawls for the same URL are skipped.
            </p>
          </div>
          <button
            onClick={() => { setShowForm((v) => !v); setCreateError(''); }}
            className="btn-primary flex items-center gap-2 shrink-0"
          >
            <Plus className="w-4 h-4" />
            {showForm ? 'Cancel' : 'New Schedule'}
          </button>
        </div>

        {/* Create form */}
        {showForm && (
          <form
            onSubmit={handleCreate}
            className="bg-white dark:bg-charcoal border border-teal/20 rounded-2xl shadow-soft p-5 space-y-4"
          >
            <p className="font-heading font-semibold text-sm text-ink dark:text-white">
              New Crawl Schedule
            </p>
            <div className="flex gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-semibold text-body dark:text-gray-400 mb-1">
                  Root URL
                </label>
                <GlowInput
                  type="url"
                  placeholder="https://example.com"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-body dark:text-gray-400 mb-1">
                  Frequency
                </label>
                <select
                  className="h-10 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-night text-ink dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                  value={newFreq}
                  onChange={(e) => setNewFreq(e.target.value)}
                >
                  {FREQ_OPTIONS.map((f) => (
                    <option key={f} value={f}>{FREQ_LABELS[f]}</option>
                  ))}
                </select>
              </div>
            </div>
            {createError && (
              <p className="text-xs text-coral">{createError}</p>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={creating}
                className="btn-primary flex items-center gap-2 text-sm py-2 px-4"
              >
                {creating ? <RefreshCw size={14} className="animate-spin" /> : <CalendarClock size={14} />}
                {creating ? 'Creating…' : 'Create Schedule'}
              </button>
            </div>
          </form>
        )}

        {/* States */}
        {loading && (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-16 bg-gray-200 dark:bg-white/10 rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <p className="text-sm text-coral bg-coral/10 px-4 py-3 rounded-xl border border-coral/30">
            {error}
          </p>
        )}

        {!loading && !error && !available && (
          <p className="text-sm text-body dark:text-gray-400 bg-teal/10 px-4 py-3 rounded-xl border border-teal">
            Database not configured — schedules require MSSQL to persist.
          </p>
        )}

        {!loading && !error && available && items.length === 0 && !showForm && (
          <div className="mt-16 flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-teal/10 flex items-center justify-center">
              <CalendarClock className="w-8 h-8 text-teal" />
            </div>
            <p className="font-heading font-bold text-xl text-ink dark:text-white">No schedules yet</p>
            <p className="text-sm text-body dark:text-gray-400 max-w-xs leading-relaxed">
              Create a schedule to automatically crawl a site daily, weekly, or monthly.
            </p>
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <div className="bg-white dark:bg-charcoal border border-gray-100 dark:border-white/[0.06] rounded-xl shadow-soft overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-gray-50 dark:bg-night border-b border-gray-100 dark:border-white/[0.06]">
                  <tr>
                    {['Site URL', 'Frequency', 'Status', 'Last Run', 'Next Run', ''].map((h) => (
                      <th key={h} className="py-3 px-4 text-left text-xs font-semibold text-body dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className={`border-b border-gray-100 dark:border-white/[0.06] last:border-b-0 transition-colors ${
                        item.enabled ? '' : 'opacity-60'
                      }`}
                    >
                      <td className="py-3 px-4 max-w-[220px]">
                        <span className="block truncate text-teal text-sm font-medium" title={item.root_url}>
                          {item.root_url}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <FrequencyBadge freq={item.frequency} />
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={`text-xs font-semibold ${item.enabled ? 'text-sage' : 'text-body dark:text-gray-500'}`}>
                          {item.enabled ? 'Active' : 'Paused'}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-xs text-body dark:text-gray-400">
                        {formatDate(item.last_run_at)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-xs text-body dark:text-gray-400">
                        {formatDate(item.next_run_at)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button
                            title={item.enabled ? 'Pause schedule' : 'Resume schedule'}
                            onClick={() => handleToggle(item)}
                            disabled={togglingId === item.id}
                            className="p-1.5 rounded-lg text-body dark:text-gray-400 hover:text-teal hover:bg-teal/10 transition-colors disabled:opacity-40"
                          >
                            {togglingId === item.id
                              ? <RefreshCw size={14} className="animate-spin" />
                              : item.enabled
                              ? <Pause size={14} />
                              : <Play size={14} />
                            }
                          </button>
                          <button
                            title="Delete schedule"
                            onClick={() => handleDelete(item.id)}
                            disabled={deletingId === item.id}
                            className="p-1.5 rounded-lg text-body dark:text-gray-400 hover:text-coral hover:bg-coral/10 transition-colors disabled:opacity-40"
                          >
                            {deletingId === item.id
                              ? <RefreshCw size={14} className="animate-spin" />
                              : <Trash2 size={14} />
                            }
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Info box */}
        <div className="text-xs text-body dark:text-gray-500 bg-gray-50 dark:bg-white/[0.03] rounded-xl p-4 space-y-1">
          <p className="font-semibold text-ink dark:text-gray-300">How scheduling works</p>
          <p>The scheduler checks every minute for due schedules.</p>
          <p>If a crawl for the same URL is already running, the scheduled trigger is skipped and the next run time advances.</p>
        </div>

      </div>
    </main>
  );
}
