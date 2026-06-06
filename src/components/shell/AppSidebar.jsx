import { LayoutDashboard, Globe, Keyboard, Wand2, Settings, X, ShieldCheck, ScanLine, History } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { APP_USER } from '../../config/appConfig';

const navItems = [
  { id: 'dashboard',     label: 'Dashboard',        icon: LayoutDashboard },
  { id: 'new-scan',      label: 'New Scan',         icon: ScanLine         },
  { id: 'scan-history',  label: 'Scan History',     icon: History          },
  { id: 'crawl-results', label: 'Crawl Results',    icon: Globe            },
  { id: 'keyboard-test', label: 'Keyboard Test',    icon: Keyboard         },
  { id: 'ai-fix',        label: 'AI Fix Assistant', icon: Wand2            },
  { id: 'settings',      label: 'Settings',         icon: Settings         },
];

export default function AppSidebar() {
  const { activePage, navigate, sidebarOpen, setSidebarOpen } = useApp();

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={[
        'fixed inset-y-0 left-0 z-30 w-64 bg-white dark:bg-charcoal flex flex-col h-full',
        'border-r border-gray-100 dark:border-white/[0.06]',
        'lg:relative lg:translate-x-0 lg:flex transition-transform duration-200',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
      ].join(' ')}>

        {/* ── LOGO ── */}
        <div className="px-4 py-4 flex items-center justify-between flex-shrink-0">
          <button
            onClick={() => navigate('landing')}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-teal rounded-xl"
            aria-label="Go to home page"
          >
            <div className="w-10 h-10 rounded-xl bg-teal flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="w-5 h-5 text-white" strokeWidth={2} />
            </div>
            <div className="text-left leading-tight">
              <span className="block font-heading font-bold text-ink dark:text-white text-[17px]">ADA</span>
              <span className="block text-[11px] text-body dark:text-gray-400">Accessibility intelligence</span>
            </div>
          </button>

          <button
            className="lg:hidden p-1.5 rounded-lg text-body hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── NAV ── */}
        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          {navItems.map(({ id, label, icon: Icon }) => {
            const active = activePage === id;
            return (
              <button
                key={id}
                onClick={() => { navigate(id); setSidebarOpen(false); }}
                style={{ fontFamily: "'Inter', sans-serif" }}
                className={[
                  'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[13.5px] border-0 transition-all duration-150',
                  active
                    ? 'bg-teal text-white font-semibold'
                    : 'text-gray-500 dark:text-gray-400 font-medium hover:bg-gray-100 dark:hover:bg-white/5 hover:text-ink dark:hover:text-white',
                ].join(' ')}
              >
                <Icon
                  size={17}
                  className={active ? 'text-white flex-shrink-0' : 'text-gray-400 dark:text-gray-500 flex-shrink-0'}
                  strokeWidth={active ? 2 : 1.75}
                />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        {/* ── FOOTER ── */}
        <div className="px-4 py-4 border-t border-gray-100 dark:border-white/[0.06] flex-shrink-0">
          <div className="flex items-center gap-3 px-2">
            <div className="w-8 h-8 rounded-full bg-teal flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold">{APP_USER.initials}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-ink dark:text-white leading-tight truncate">{APP_USER.displayName}</p>
              <p className="text-[11px] text-body dark:text-gray-500 leading-tight truncate">{APP_USER.email}</p>
            </div>
          </div>
        </div>

      </aside>
    </>
  );
}
