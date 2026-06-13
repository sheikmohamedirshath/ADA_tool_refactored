import { useState, useCallback, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { apiFetch } from '../utils/api';
import {
  Keyboard, Eye, Play, AlertCircle, Search,
  Layers, FileText, MousePointer, ArrowUpDown, AlignLeft, Image, Volume2,
} from 'lucide-react';
import GlowInput from '../components/ui/GlowInput';
import ScanProgress from '../components/newscan/ScanProgress';
import './NewScanPage.css';
import ModuleSelector from '../components/assistive/ModuleSelector';
import KeyboardNavigationModule from '../components/assistive/KeyboardNavigationModule';
import ColorContrastModule from '../components/assistive/ColorContrastModule';
import PageStructureModule from '../components/assistive/PageStructureModule';
import PlaceholderModule from '../components/assistive/PlaceholderModule';

// ─── Module registry ────────────────────────────────────────────────────────
// Add new modules here. Set status: 'active' + endpoint when ready to ship.
const MODULES = [
  {
    id: 'keyboard',
    label: 'Keyboard Navigation',
    icon: Keyboard,
    status: 'active',
    description: 'Tab order, focus traps, skip links, visible focus indicators',
    endpoint: '/api/assisted/keyboard',
  },
  {
    id: 'color-contrast',
    label: 'Color Contrast',
    icon: Eye,
    status: 'active',
    description: 'WCAG 1.4.3 contrast ratio analysis across all text elements',
    endpoint: '/api/assisted/color-contrast',
  },
  {
    id: 'modal',
    label: 'Modal Accessibility',
    icon: Layers,
    status: 'planned',
    description: 'Focus trapping, dialog roles, escape key handling',
  },
  {
    id: 'forms',
    label: 'Forms Accessibility',
    icon: FileText,
    status: 'planned',
    description: 'Labels, error messages, grouping, autocomplete attributes',
  },
  {
    id: 'interactive',
    label: 'Interactive Components',
    icon: MousePointer,
    status: 'planned',
    description: 'Custom widgets, ARIA states, keyboard interaction patterns',
  },
  {
    id: 'focus-order',
    label: 'Focus Order Analysis',
    icon: ArrowUpDown,
    status: 'planned',
    description: 'Visual vs DOM order comparison, focus sequence logic',
  },
  {
    id: 'page-structure',
    label: 'Page Structure',
    icon: AlignLeft,
    status: 'active',
    description: 'Heading hierarchy, landmark regions, document outline',
    endpoint: '/api/assisted/page-structure',
  },
  {
    id: 'alt-text',
    label: 'Images & Alt Text',
    icon: Image,
    status: 'planned',
    description: 'Alt text quality, decorative image detection, figure elements',
  },
  {
    id: 'screen-reader',
    label: 'Screen Reader Readiness',
    icon: Volume2,
    status: 'planned',
    description: 'ARIA labels, live regions, announcement quality',
  },
];

// ─── Generic result normalizer ───────────────────────────────────────────────
// Wraps raw API data into the AssistiveTestResult shape.
// Module components access result.metadata for raw API fields.
function buildResult(rawData, testType, url) {
  return {
    testType,
    url,
    score: null,
    findings: rawData?.issues ?? rawData?.elements ?? rawData?.results ?? rawData?.items ?? [],
    metadata: rawData,
    executedAt: new Date().toISOString(),
  };
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function AssistiveTestingPage() {
  const { pendingAssistiveUrl, setPendingAssistiveUrl, pendingAssistiveModule, setPendingAssistiveModule } = useApp();
  const [activeModuleId, setActiveModuleId] = useState('keyboard');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [autoRun, setAutoRun] = useState(false);

  useEffect(() => {
    if (pendingAssistiveUrl) {
      setUrl(pendingAssistiveUrl);
      setPendingAssistiveUrl('');
    }
    if (pendingAssistiveModule) {
      setActiveModuleId(pendingAssistiveModule);
      setPendingAssistiveModule(null);
      setAutoRun(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (autoRun && url.trim()) {
      setAutoRun(false);
      handleRunTest();
    }
  // handleRunTest is stable via useCallback, url is set before autoRun
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, url]);

  const activeModule = MODULES.find((m) => m.id === activeModuleId);

  function handleModuleSelect(id) {
    setActiveModuleId(id);
    setResult(null);
    setError('');
  }

  const handleRunTest = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError('Please enter a URL to test.');
      return;
    }
    if (!activeModule || activeModule.status !== 'active') return;

    setLoading(true);
    setResult(null);
    setError('');

    try {
      const res = await apiFetch(activeModule.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? 'Test failed. Please check the URL and try again.');
      } else {
        setResult(buildResult(data.result ?? data, activeModuleId, trimmed));
      }
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [url, activeModule, activeModuleId]);

  // ─── Result renderer — dispatches to the correct module component ──────────
  function renderResults() {
    if (!result) {
      const ModIcon = activeModule?.icon;
      return (
        <div className="card p-12 flex flex-col items-center justify-center gap-4 text-body dark:text-gray-400">
          <div className="w-14 h-14 rounded-2xl bg-teal/10 flex items-center justify-center">
            {ModIcon && <ModIcon size={24} className="text-teal opacity-60" />}
          </div>
          <div className="text-center">
            <p className="font-heading font-semibold text-ink dark:text-white text-base">
              No results yet
            </p>
            <p className="text-sm mt-1">
              Enter a URL above and run the test to see accessibility insights.
            </p>
          </div>
        </div>
      );
    }

    if (activeModuleId === 'keyboard') return <KeyboardNavigationModule result={result} />;
    if (activeModuleId === 'color-contrast') return <ColorContrastModule result={result} />;
    if (activeModuleId === 'page-structure') return <PageStructureModule result={result} />;
    return <PlaceholderModule module={activeModule} />;
  }

  return (
    <div className="flex-1 overflow-auto bg-ivory dark:bg-night p-6 space-y-6">

      {/* HEADER */}
      <div>
        <h1 className="font-heading font-bold text-2xl text-ink dark:text-white">
          Assistive Testing
        </h1>
        <p className="text-sm text-body dark:text-gray-400 mt-1">
          Run advanced accessibility validations that go beyond automated WCAG scanning.
        </p>
      </div>

      {/* MODULE SELECTOR */}
      <ModuleSelector
        modules={MODULES}
        activeModuleId={activeModuleId}
        onSelect={handleModuleSelect}
      />

      {/* URL INPUT — morphs into loader while test runs */}
      {activeModule?.status === 'active' && (
        <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft">
          {loading ? (
            <ScanProgress bare url={url} />
          ) : (
            <div className="px-6 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-body dark:text-gray-400 mb-3">
                Enter URL
              </p>
              <GlowInput
                large
                icon={Search}
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRunTest(); }}
                placeholder="https://example.com"
                aria-label="URL to test"
              />

              <div className="border-t border-gray-100 dark:border-white/[0.06] my-4" />

              <button
                onClick={handleRunTest}
                disabled={!url.trim()}
                className="btn-primary w-full justify-center py-4 text-base font-semibold"
              >
                <Play className="w-5 h-5" />
                Run Test
              </button>

              {error && (
                <div className="mt-3 flex items-start gap-2 bg-coral/15 text-coral rounded-xl px-4 py-3 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* RESULTS */}
      {renderResults()}

    </div>
  );
}
