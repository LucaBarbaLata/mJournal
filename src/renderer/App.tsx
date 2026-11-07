import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { TEXT_SIZES } from '@core/api';
import { ConfirmHost } from './components/Dialog';
import { QuickNoteDialog } from './components/QuickNoteDialog';
import { Icon, type IconName } from './components/Icon';
import { LogoMark, Wordmark } from './components/Logo';
import { ToastHost } from './components/Toasts';
import { UpdateNotice, UpdateResultDialog } from './components/UpdateNotice';
import { native } from './lib/api';
import { AppProvider, useApp } from './lib/app';
import { LockProvider, useLock } from './lib/lock';
import { requestQuickNote } from './lib/quickNote';
import { href, navigate, useRoute, type RouteName } from './lib/router';
import { saveQueue } from './lib/saveQueue';
import { useToday } from './lib/time';
import { CalendarView } from './views/CalendarView';
import { DayView } from './views/DayView';
import { InsightsView } from './views/InsightsView';
import { JournalView } from './views/JournalView';
import { LockScreen } from './views/LockScreen';
import { MemoriesView } from './views/MemoriesView';
import { MonthView } from './views/MonthView';
import { Onboarding } from './views/Onboarding';
import { SettingsView } from './views/SettingsView';
import { YearView } from './views/YearView';

const NAV: { name: RouteName | 'day'; label: string; icon: IconName; to: () => string; key: string }[] = [
  { name: 'today', label: 'Today', icon: 'today', to: href.today, key: '1' },
  { name: 'calendar', label: 'Calendar', icon: 'calendar', to: () => href.calendar(), key: '2' },
  { name: 'journal', label: 'Journal', icon: 'journal', to: () => href.journal(), key: '3' },
  { name: 'memories', label: 'Memories', icon: 'memories', to: () => href.memories(), key: '4' },
  { name: 'month', label: 'Monthly', icon: 'month', to: () => href.month(), key: '5' },
  { name: 'insights', label: 'Insights', icon: 'insights', to: href.insights, key: '6' },
];

function Splash() {
  return (
    <div className="splash" aria-busy="true">
      <span className="splash-logo">
        <LogoMark size={56} />
      </span>
    </div>
  );
}

/** A soft highlight that glides to the current navigation item. */
function useNavPill(navRef: RefObject<HTMLElement | null>, current: string) {
  const [pill, setPill] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const link = nav.querySelector<HTMLElement>('.nav-item[aria-current="page"]');
      if (!link) return setPill(null);
      const navBox = nav.getBoundingClientRect();
      const box = link.getBoundingClientRect();
      setPill({ x: box.left - navBox.left, y: box.top - navBox.top, width: box.width, height: box.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    // The Settings link moves when something appears in the sidebar's foot, like the update note.
    const foot = nav.querySelector('.sidebar-foot');
    if (foot) observer.observe(foot);
    return () => observer.disconnect();
  }, [navRef, current]);

  // Appear in place first; glide on later moves.
  useEffect(() => {
    if (!pill || animate) return;
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, [pill, animate]);

  return { pill, animate };
}

function Sidebar({ active }: { active: RouteName }) {
  // A day's page belongs to Today; the year in review belongs to Monthly.
  const current = active === 'day' ? 'today' : active === 'year' ? 'month' : active;
  const navRef = useRef<HTMLElement>(null);
  const { pill, animate } = useNavPill(navRef, current);
  const { status: lock, lockNow } = useLock();
  return (
    <nav className="sidebar" aria-label="Main" ref={navRef}>
      {pill && (
        <span
          className={`nav-pill${animate ? ' animate' : ''}`}
          style={{ transform: `translate(${pill.x}px, ${pill.y}px)`, width: pill.width, height: pill.height }}
          aria-hidden="true"
        />
      )}
      <div className="titlebar-drag sidebar-brand">
        <LogoMark size={28} animated />
        <Wordmark />
      </div>
      <ul className="nav-list">
        {NAV.map((item) => (
          <li key={item.name}>
            <a
              href={item.to()}
              className="nav-item"
              aria-current={current === item.name ? 'page' : undefined}
              title={`${item.label} (Ctrl+${item.key})`}
            >
              <Icon name={item.icon} size={20} />
              <span className="nav-label">{item.label}</span>
            </a>
          </li>
        ))}
      </ul>
      <div className="sidebar-foot">
        <UpdateNotice />
        {lock.enabled && (
          <button type="button" className="nav-item nav-button" onClick={() => void lockNow()} title="Lock mJournal (Ctrl+L)">
            <Icon name="lock" size={20} />
            <span className="nav-label">Lock</span>
          </button>
        )}
        <a
          href={href.settings()}
          className="nav-item"
          aria-current={current === 'settings' ? 'page' : undefined}
          title="Settings (Ctrl+,)"
        >
          <Icon name="settings" size={20} />
          <span className="nav-label">Settings</span>
        </a>
        <p className="motto">My life doesn’t have to be perfect for it to be beautiful.</p>
      </div>
    </nav>
  );
}

function Routes() {
  const route = useRoute();
  const today = useToday();
  switch (route.name) {
    case 'today':
      return <DayView date={today} />;
    case 'day':
      return <DayView date={route.date} query={route.query} />;
    case 'calendar':
      return <CalendarView month={route.month} selected={route.selected} />;
    case 'journal':
      return <JournalView params={route.params} />;
    case 'memories':
      return <MemoriesView params={route.params} />;
    case 'month':
      return <MonthView month={route.month} query={route.query} />;
    case 'year':
      return <YearView year={route.year} query={route.query} />;
    case 'insights':
      return <InsightsView />;
    case 'settings':
      return <SettingsView section={route.section} />;
  }
}

/** The text size one step larger (+1) or smaller (-1) than `current`, or 100 % for 0. */
function nextTextSize(current: number, step: -1 | 0 | 1): (typeof TEXT_SIZES)[number] {
  if (step === 0) return 100;
  const index = Math.max(0, TEXT_SIZES.findIndex((size) => size === current));
  return TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, index + step))];
}

function Shell() {
  const route = useRoute();
  const { settings, updateSettings } = useApp();
  const { status: lock, lockNow } = useLock();

  useEffect(() => {
    // Files dropped outside a drop zone must never navigate the window.
    const prevent = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      // Text size works everywhere, dialogs included: Ctrl + = (or +) larger, Ctrl + − smaller, Ctrl + 0 back to 100 %.
      const zoom = event.key === '=' || event.key === '+' ? 1 : event.key === '-' || event.key === '_' ? -1 : event.key === '0' ? 0 : null;
      if (zoom !== null) {
        event.preventDefault();
        const next = nextTextSize(settings.textSize, zoom);
        if (next !== settings.textSize) void updateSettings({ textSize: next }).catch(() => undefined);
        return;
      }
      // While a dialog (or the welcome guide) is open, shortcuts would act on the page behind it.
      if (document.querySelector('dialog[open]')) return;
      const item = NAV.find((n) => n.key === event.key);
      if (item) {
        event.preventDefault();
        navigate(item.to());
      } else if (event.key === ',') {
        event.preventDefault();
        navigate(href.settings());
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        navigate(href.journal({ focus: '1' }));
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveQueue.flush();
      } else if (event.key.toLowerCase() === 'l' && lock.enabled) {
        event.preventDefault();
        void lockNow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lock.enabled, lockNow, settings.textSize, updateSettings]);

  useEffect(() => {
    document.querySelector('.main-scroll')?.scrollTo({ top: 0 });
  }, [
    route.name,
    route.name === 'day' ? route.date : '',
    route.name === 'calendar' ? route.month : '',
    route.name === 'year' ? route.year : '',
  ]);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar active={route.name} />
      <div className="main">
        <div className="titlebar-drag main-titlebar" />
        <main id="main" className="main-scroll" tabIndex={-1}>
          <Routes />
        </main>
      </div>
      <ConfirmHost />
      <ToastHost />
      {/* Inside the lock: a quick note asked for while locked opens right after unlocking. */}
      {settings.onboardingDone && <QuickNoteDialog />}
      {!settings.onboardingDone && <Onboarding />}
      {/* After the welcome guide, and (like everything in Shell) only once the PIN is entered. */}
      {settings.onboardingDone && <UpdateResultDialog />}
    </div>
  );
}

export function App() {
  useEffect(() => {
    // Save everything before the window closes, and before reloading. Lives here, not in Shell,
    // so closing works the same while locked.
    const stopFlush = native.onFlushRequest(() => saveQueue.flush());
    const stopNavigate = native.onNavigate((hash) => navigate(hash));
    const stopQuickNote = native.onQuickNote(() => requestQuickNote());
    const beforeUnload = () => void saveQueue.flush();
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      stopFlush();
      stopNavigate();
      stopQuickNote();
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

  // While locked, the lock screen replaces everything below, so no journal data is loaded or shown.
  return (
    <LockProvider fallback={<Splash />} locked={(status, setStatus) => <LockScreen status={status} onStatus={setStatus} />}>
      <AppProvider fallback={<Splash />}>
        <Shell />
      </AppProvider>
    </LockProvider>
  );
}
