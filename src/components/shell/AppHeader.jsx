import { Menu, Sun, Moon, Bell, Home } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { APP_USER } from '../../config/appConfig';

const pageTitles = {
  dashboard:      'Dashboard',
  'new-scan':     'New Scan',
  'scan-history': 'Scan History',
  'crawl-results': 'Crawl Results',
  'keyboard-test': 'Keyboard Test',
  'ai-fix':       'AI Fix Assistant',
  settings:       'Settings',
};

export default function AppHeader() {
  const { activePage, navigate, setSidebarOpen, dark, setDark } = useApp();

  const title = pageTitles[activePage] ?? 'Dashboard';

  return (
    <header className="sticky top-0 z-30 bg-white/80 dark:bg-charcoal/80 backdrop-blur-md border-b border-gray-100 dark:border-white/[0.06] h-16 flex items-center px-4 sm:px-6 gap-4">
      {/* Hamburger — hidden on lg+ */}
      <button
        className="lg:hidden btn-ghost p-2 rounded-2xl"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open sidebar"
      >
        <Menu className="w-5 h-5 text-ink dark:text-white" />
      </button>

      {/* Page title */}
      <span className="font-heading font-semibold text-ink dark:text-white text-lg whitespace-nowrap">
        {title}
      </span>

      {/* Right action group */}
      <div className="flex items-center gap-2 ml-auto">
        {/* Home — back to landing page */}
        <button
          className="btn-ghost p-2 rounded-2xl"
          onClick={() => navigate('landing')}
          aria-label="Back to home page"
        >
          <Home className="w-5 h-5 text-ink dark:text-white" />
        </button>
        {/* Dark mode toggle */}
        <button
          className="btn-ghost p-2 rounded-2xl"
          onClick={() => setDark(!dark)}
          aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {dark ? (
            <Sun className="w-5 h-5 text-amber" />
          ) : (
            <Moon className="w-5 h-5 text-ink dark:text-white" />
          )}
        </button>

        {/* Notifications bell */}
        <button
          className="btn-ghost p-2 rounded-2xl relative"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5 text-ink dark:text-white" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-coral" />
        </button>

        {/* User avatar */}
        <div
          className="w-8 h-8 rounded-full bg-teal flex items-center justify-center text-white text-xs font-bold select-none"
          aria-label="User avatar"
        >
          {APP_USER.initials}
        </div>
      </div>
    </header>
  );
}
