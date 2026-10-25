/** A gentle one-time tip, shown after the welcome guide until the user dismisses it. */
import { useState, type ReactNode } from 'react';
import { useApp } from '../lib/app';
import { reducedMotion } from '../lib/motion';
import { Icon, type IconName } from './Icon';

export function Tip({ id, icon = 'sparkle', children }: { id: string; icon?: IconName; children: ReactNode }) {
  const { settings, updateSettings } = useApp();
  const [leaving, setLeaving] = useState(false);
  if (!settings.onboardingDone || settings.dismissedTips.includes(id)) return null;

  const dismiss = () => {
    setLeaving(true);
    window.setTimeout(
      () =>
        void updateSettings({ dismissedTips: [...new Set([...settings.dismissedTips, id])] }).catch(() => setLeaving(false)),
      reducedMotion() ? 0 : 240,
    );
  };

  return (
    <aside className={`tip${leaving ? ' leaving' : ''}`} aria-label="Tip">
      <span className="tip-icon" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <p className="tip-text">{children}</p>
      <button type="button" className="btn btn-sm tip-dismiss" onClick={dismiss}>
        Got it
      </button>
    </aside>
  );
}
