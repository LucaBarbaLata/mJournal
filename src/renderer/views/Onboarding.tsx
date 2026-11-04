/**
 * The welcome guide: five short steps shown on first launch. It can be skipped
 * at any time and opened again from Settings → Guide & tips.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ThemePreference, WritingFont } from '@core/api';
import type { MoodColor, MoodIcon as MoodIconName } from '@core/moods';
import { Sparkle } from '../components/Decorations';
import { Icon, type IconName } from '../components/Icon';
import { LogoMark } from '../components/Logo';
import { MoodIcon } from '../components/MoodIcon';
import { useApp } from '../lib/app';
import { burst, reducedMotion, withThemeFade } from '../lib/motion';
import { href, navigate } from '../lib/router';
import './onboarding.css';

const STEP_COUNT = 5;

interface Point {
  icon: IconName | 'mood';
  title: string;
  text: string;
}

function Points({ items }: { items: Point[] }) {
  return (
    <ul className="guide-points">
      {items.map((point, i) => (
        <li key={point.title} style={{ '--i': i } as CSSProperties}>
          <span className="guide-point-icon" aria-hidden="true">
            {point.icon === 'mood' ? <MoodIcon icon="happy" color="rose" size={22} /> : <Icon name={point.icon} size={18} />}
          </span>
          <span>
            <strong>{point.title}</strong> {point.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Illustrations (decorative)

const MOCK_MOODS: [MoodIconName, MoodColor][] = [
  ['radiant', 'gold'],
  ['happy', 'rose'],
  ['calm', 'sage'],
  ['tired', 'lavender'],
  ['mixed', 'blend'],
];

function WelcomeArt() {
  return (
    <div className="art-welcome">
      <span className="art-glow" />
      <span className="art-logo">
        <LogoMark size={96} />
      </span>
      <Sparkle className="art-spark s1" size={20} />
      <Sparkle className="art-spark s2" size={13} color="var(--lavender-300)" />
      <Sparkle className="art-spark s3" size={15} color="var(--rose-300)" />
      <p className="art-motto">
        My life doesn’t have to be perfect
        <br />
        for it to be beautiful.
      </p>
    </div>
  );
}

function DailyArt() {
  return (
    <div className="mock-page">
      <p className="mock-eyebrow">
        <Sparkle size={9} /> Today’s question
      </p>
      <p className="mock-question">What small thing made today better?</p>
      <span className="mock-line" style={{ width: '84%' }} />
      <span className="mock-line" style={{ width: '58%' }} />
      <div className="mock-moods">
        {MOCK_MOODS.map(([icon, color], i) => (
          <span key={icon} className="mock-mood" style={{ '--i': i } as CSSProperties}>
            <MoodIcon icon={icon} color={color} size={26} />
          </span>
        ))}
      </div>
      <div className="mock-energy">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} style={{ '--i': i, height: `${8 + i * 4}px` } as CSSProperties} />
        ))}
      </div>
      <span className="mock-saved">
        <Icon name="check" size={11} strokeWidth={2.4} /> Saved
      </span>
    </div>
  );
}

const CALENDAR_MOODS: (MoodColor | null)[] = [
  null, 'sage', 'rose', null, 'gold', 'sky', 'rose',
  'lavender', null, 'sage', 'peach', null, 'rose', 'mint',
  'gold', 'rose', null, 'sage', 'lavender', 'rose', null,
  'coral', 'sage', 'gold', null, 'rose', 'mauve', 'sage',
];

function LookBackArt() {
  return (
    <div className="art-lookback">
      <div className="mock-calendar">
        {CALENDAR_MOODS.map((color, i) => (
          <span
            key={i}
            className={color ? 'filled' : undefined}
            style={{ '--i': i, '--c': color ? `var(--mood-${color})` : undefined } as CSSProperties}
          />
        ))}
      </div>
      <div className="mock-polaroid">
        <svg viewBox="0 0 80 64" width="100%">
          <rect width="80" height="64" rx="3" fill="var(--sage-100)" />
          <circle cx="58" cy="18" r="8" fill="var(--gold-300)" />
          <path d="M0 50 18 34l13 11 10-8 17 13 22-15v29H0Z" fill="var(--sage-300)" />
        </svg>
        <span>a good day</span>
      </div>
      <span className="mock-letter">
        <Icon name="month" size={22} />
      </span>
    </div>
  );
}

function PrivateArt() {
  return (
    <div className="art-private">
      <svg viewBox="0 0 200 170" width="230">
        <ellipse cx="100" cy="156" rx="64" ry="7" fill="var(--rose-100)" />
        <rect x="50" y="22" width="104" height="124" rx="14" fill="var(--rose-300)" />
        <rect x="50" y="22" width="20" height="124" rx="8" fill="var(--rose-400)" opacity="0.55" />
        <rect x="82" y="44" width="48" height="6" rx="3" fill="var(--paper-raised)" opacity="0.7" />
        <rect x="82" y="56" width="32" height="6" rx="3" fill="var(--paper-raised)" opacity="0.55" />
        <rect x="138" y="70" width="28" height="34" rx="8" fill="var(--paper-raised)" stroke="var(--rose-400)" strokeWidth="2" />
        <g className="art-heart">
          <path d="M152 97s-9-5.6-9-11.5a5 5 0 0 1 9-2.9 5 5 0 0 1 9 2.9c0 5.9-9 11.5-9 11.5Z" fill="var(--rose-600)" />
        </g>
      </svg>
      <Sparkle className="art-spark s1" size={18} />
      <Sparkle className="art-spark s2" size={12} color="var(--lavender-300)" />
    </div>
  );
}

function MiniWindow({ variant }: { variant: 'light' | 'dark' | 'system' }) {
  return (
    <span className={`mini-window ${variant}`} aria-hidden="true">
      <span className="mw-side" />
      <span className="mw-body">
        <span className="mw-line" />
        <span className="mw-line short" />
        <span className="mw-card" />
      </span>
    </span>
  );
}

function YoursArt() {
  return (
    <div className="art-yours">
      <MiniWindow variant="light" />
      <MiniWindow variant="dark" />
      <Sparkle className="art-spark s1" size={18} />
      <Sparkle className="art-spark s3" size={13} color="var(--rose-300)" />
    </div>
  );
}

// ---------------------------------------------------------------------------

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Match system' },
];

const FONTS: { value: WritingFont; label: string }[] = [
  { value: 'serif', label: 'Classic' },
  { value: 'sans', label: 'Clean' },
  { value: 'hand', label: 'Handwritten' },
];

export function Onboarding() {
  const { settings, updateSettings } = useApp();
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [name, setName] = useState(settings.displayName);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, [step]);

  const saveName = async () => {
    const trimmed = name.trim();
    if (trimmed !== settings.displayName) await updateSettings({ displayName: trimmed });
  };

  const close = async (finished: boolean) => {
    if (closing) return;
    setClosing(true);
    await saveName().catch(() => undefined);
    await new Promise((resolve) => window.setTimeout(resolve, reducedMotion() ? 0 : 280));
    await updateSettings({ onboardingDone: true }).catch(() => undefined);
    if (finished) navigate(href.today());
  };

  const go = async (delta: number) => {
    if (step === 0) await saveName().catch(() => undefined);
    setDirection(delta > 0 ? 'forward' : 'back');
    setStep((s) => Math.min(STEP_COUNT - 1, Math.max(0, s + delta)));
  };

  const steps: { eyebrow: string; title: string; art: ReactNode; body: ReactNode }[] = [
    {
      eyebrow: 'Welcome',
      title: 'Hello, and welcome to mJournal',
      art: <WelcomeArt />,
      body: (
        <>
          <p className="guide-lead">
            A private little place for the good, difficult, ordinary and meaningful moments of your days.
          </p>
          <label className="field guide-name">
            <span className="field-label">What should mJournal call you?</span>
            <input
              className="input"
              value={name}
              maxLength={40}
              placeholder="Your name or nickname (optional)"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void go(1);
              }}
            />
            <span className="field-hint">Only used for your greeting. It never leaves this computer.</span>
          </label>
        </>
      ),
    },
    {
      eyebrow: 'Every day',
      title: 'A page for every day',
      art: <DailyArt />,
      body: (
        <Points
          items={[
            { icon: 'sparkle', title: 'A gentle question.', text: 'Ask for another one or skip it — every prompt is optional.' },
            { icon: 'mood', title: 'How you feel.', text: 'Tap a mood and your energy. A mood on its own is enough for a day.' },
            { icon: 'feather', title: 'Write freely.', text: 'A few words or a whole page, plus photos you love.' },
            { icon: 'check', title: 'Saved as you type.', text: 'Look for “Saved” at the top of the page.' },
          ]}
        />
      ),
    },
    {
      eyebrow: 'Looking back',
      title: 'Little moments, gathered',
      art: <LookBackArt />,
      body: (
        <Points
          items={[
            { icon: 'calendar', title: 'Calendar', text: '— your month at a glance.' },
            { icon: 'journal', title: 'Journal', text: '— search everything you’ve written.' },
            { icon: 'memories', title: 'Memories', text: '— your photos, like a little scrapbook.' },
            { icon: 'month', title: 'Monthly', text: '— a letter to yourself each month.' },
            { icon: 'insights', title: 'Insights', text: '— gentle numbers. A missed day is simply a day.' },
          ]}
        />
      ),
    },
    {
      eyebrow: 'Just for you',
      title: 'Private by design',
      art: <PrivateArt />,
      body: (
        <Points
          items={[
            {
              icon: 'lock',
              title: 'Stays on this computer.',
              text: 'No account, no cloud, no tracking. mJournal only goes online to check for a new version.',
            },
            {
              icon: 'info',
              title: 'Not encrypted by mJournal.',
              text: 'A password on your computer account keeps your journal safe. You can add a PIN in Settings, too.',
            },
            { icon: 'download', title: 'Back up now and then', text: 'in Settings → Backup & export, to a USB drive or another disk.' },
          ]}
        />
      ),
    },
    {
      eyebrow: 'Almost there',
      title: 'Make it yours',
      art: <YoursArt />,
      body: (
        <>
          <div className="guide-themes" role="radiogroup" aria-label="Theme">
            {THEMES.map((theme) => (
              <button
                key={theme.value}
                type="button"
                role="radio"
                aria-checked={settings.theme === theme.value}
                className="guide-theme"
                onClick={() => void withThemeFade(() => updateSettings({ theme: theme.value }))}
              >
                <MiniWindow variant={theme.value} />
                <span className="guide-theme-label">{theme.label}</span>
              </button>
            ))}
          </div>
          <div className="guide-font">
            <span className="field-label" id="guide-font-label">
              Writing font
            </span>
            <div className="segmented" role="radiogroup" aria-labelledby="guide-font-label">
              {FONTS.map((font) => (
                <button
                  key={font.value}
                  type="button"
                  role="radio"
                  aria-checked={settings.writingFont === font.value}
                  onClick={() => void updateSettings({ writingFont: font.value })}
                >
                  {font.label}
                </button>
              ))}
            </div>
            <p className={`guide-font-sample font-${settings.writingFont}`}>Today I noticed the light on the wall…</p>
          </div>
        </>
      ),
    },
  ];
  const current = steps[step];
  const last = step === STEP_COUNT - 1;

  return (
    <dialog
      ref={ref}
      className={`guide${closing ? ' closing' : ''}`}
      aria-labelledby="guide-title"
      onCancel={(event) => {
        event.preventDefault();
        void close(false);
      }}
    >
      <div className="guide-art" aria-hidden="true">
        <span className="guide-blob one" />
        <span className="guide-blob two" />
        <div key={step} className="guide-art-inner">
          {current.art}
        </div>
      </div>
      <div className="guide-content">
        <div className="guide-top">
          <p className="eyebrow">{current.eyebrow}</p>
          {!last && (
            <button type="button" className="link-btn guide-skip" onClick={() => void close(false)}>
              Skip guide
            </button>
          )}
        </div>
        <div key={step} className={`guide-step ${direction === 'forward' ? 'slide-from-right' : 'slide-from-left'}`}>
          <h2 id="guide-title" ref={titleRef} tabIndex={-1}>
            {current.title}
          </h2>
          {current.body}
        </div>
        <p className="guide-note">You can open this guide again any time in Settings.</p>
        <div className="guide-footer">
          <div className="guide-dots" aria-hidden="true">
            {steps.map((_, i) => (
              <span key={i} className={i === step ? 'active' : i < step ? 'done' : undefined} />
            ))}
          </div>
          <span className="visually-hidden" aria-live="polite">
            Step {step + 1} of {STEP_COUNT}
          </span>
          <div className="guide-buttons">
            {step > 0 && (
              <button type="button" className="btn btn-ghost nudge-left" onClick={() => void go(-1)}>
                <Icon name="chevron-left" size={16} /> Back
              </button>
            )}
            {last ? (
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={(event) => {
                  burst(event.currentTarget, { count: 16, distance: 60 });
                  void close(true);
                }}
              >
                <Icon name="sparkle" size={16} /> Start writing
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-lg nudge-right" onClick={() => void go(1)}>
                {step === 0 ? 'Let’s begin' : 'Next'} <Icon name="chevron-right" size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
