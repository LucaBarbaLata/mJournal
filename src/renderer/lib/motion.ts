/**
 * Motion helpers. Everything here does nothing when the user prefers reduced
 * motion (the system setting or Settings → Appearance → Reduce motion); CSS
 * animations are switched off by the rules at the end of base.css.
 */
import { useEffect, useRef, useState } from 'react';

export function reducedMotion(): boolean {
  return (
    document.documentElement.classList.contains('reduce-motion') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// ---------------------------------------------------------------------------
// Direction of the last "previous / next" move, so the next view can slide in
// from the matching side. The view that appears reads it, then clears it.

export type NavDirection = 'back' | 'forward' | null;
let pendingDirection: NavDirection = null;

export function setNavDirection(direction: NavDirection): void {
  pendingDirection = direction;
}

/** Reads the pending direction without clearing it (safe in React state initializers). */
export function peekNavDirection(): NavDirection {
  return pendingDirection;
}

export function clearNavDirection(): void {
  pendingDirection = null;
}

export function slideClass(direction: NavDirection): string {
  return direction === 'back' ? 'slide-from-left' : direction === 'forward' ? 'slide-from-right' : '';
}

// ---------------------------------------------------------------------------
// Little bursts of sparkles or hearts for moments of delight.

let layer: HTMLDivElement | null = null;

function particleLayer(): HTMLDivElement {
  if (!layer || !layer.isConnected) {
    layer = document.createElement('div');
    layer.className = 'particle-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
  }
  return layer;
}

export interface BurstOptions {
  colors?: string[];
  count?: number;
  shape?: 'sparkle' | 'heart' | 'dot';
  /** Roughly how far the particles travel, in pixels. */
  distance?: number;
}

export function burst(anchor: Element | null, options: BurstOptions = {}): void {
  if (!anchor || reducedMotion()) return;
  const {
    colors = ['var(--gold-300)', 'var(--rose-300)', 'var(--lavender-300)'],
    count = 9,
    shape = 'sparkle',
    distance = 34,
  } = options;
  const rect = anchor.getBoundingClientRect();
  const container = particleLayer();
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
    const travel = distance * (0.65 + Math.random() * 0.6);
    const particle = document.createElement('span');
    particle.className = `particle ${shape}`;
    particle.style.left = `${rect.left + rect.width / 2}px`;
    particle.style.top = `${rect.top + rect.height / 2}px`;
    particle.style.setProperty('--dx', `${Math.cos(angle) * travel}px`);
    particle.style.setProperty('--dy', `${Math.sin(angle) * travel - (shape === 'heart' ? 14 : 0)}px`);
    particle.style.setProperty('--c', colors[i % colors.length]);
    particle.style.setProperty('--s', String(0.7 + Math.random() * 0.6));
    particle.style.setProperty('--r', `${Math.round((Math.random() - 0.5) * 160)}deg`);
    particle.style.setProperty('--d', `${560 + Math.round(Math.random() * 260)}ms`);
    particle.addEventListener('animationend', () => particle.remove(), { once: true });
    container.appendChild(particle);
  }
}

// ---------------------------------------------------------------------------
// Numbers that count up when they first appear or change.

export function useCountUp(value: number, duration = 900): number {
  const [shown, setShown] = useState(() => (reducedMotion() ? value : 0));
  const from = useRef(reducedMotion() ? value : 0);

  useEffect(() => {
    if (reducedMotion() || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const initial = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setShown(initial + (value - initial) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      from.current = value;
    };
  }, [value, duration]);

  return shown;
}

// ---------------------------------------------------------------------------
// A soft color cross-fade while the theme changes.

export async function withThemeFade<T>(change: () => Promise<T>): Promise<T> {
  const root = document.documentElement;
  if (!reducedMotion()) root.classList.add('theme-fade');
  try {
    return await change();
  } finally {
    window.setTimeout(() => root.classList.remove('theme-fade'), 700);
  }
}
