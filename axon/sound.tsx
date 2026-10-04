"use client";

/**
 * Axon · Interface sounds (Cuelume)
 *
 * Synthesized cues for taps, toggles, menus and results — no audio files.
 * Off by default: a viewer turns them on in the sound panel, the choice and
 * the material (theme) live in localStorage. Declarative cues are the
 * `data-cuelume-*` attributes on primitives (Button, switches, menus), wired
 * by one delegated `bind()`; events without a DOM gesture call `cue()`.
 * The notification chime is separate (`axon/notifications.tsx`).
 */

import { useEffect, useSyncExternalStore } from "react";
import { bind, play, setEnabled, setTheme, themes, type PlayOptions, type SoundName, type ThemeName } from "cuelume";

const ENABLED_KEY = "synapth_ui_sounds";
const THEME_KEY = "synapth_ui_sound_theme";
const DEFAULT_THEME: ThemeName = "mech";

export const SOUND_THEMES = themes;
export type SoundTheme = ThemeName;

interface SoundPrefs {
  enabled: boolean;
  theme: SoundTheme;
}

const SERVER_PREFS: SoundPrefs = { enabled: false, theme: DEFAULT_THEME };
let prefs: SoundPrefs = SERVER_PREFS;
let booted = false;
const listeners = new Set<() => void>();

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — the choice lasts for this page only */
  }
}

function apply(next: SoundPrefs) {
  prefs = next;
  setEnabled(next.enabled);
  setTheme(next.theme);
  if (next.enabled) bind();
  listeners.forEach((fn) => fn());
}

function boot() {
  if (booted) return;
  booted = true;
  let enabled = false;
  let theme = DEFAULT_THEME;
  try {
    enabled = localStorage.getItem(ENABLED_KEY) === "1";
    const saved = localStorage.getItem(THEME_KEY);
    if (saved && (themes as readonly string[]).includes(saved)) theme = saved as ThemeName;
  } catch {
    /* storage blocked — stay silent */
  }
  apply({ enabled, theme });
}

/** Mount once in the root layout. */
export function SoundBoot() {
  useEffect(boot, []);
  return null;
}

/** Plays a cue when the viewer turned interface sounds on. */
export function cue(name: SoundName, options?: PlayOptions) {
  if (prefs.enabled) play(name, options);
}

export function useSoundPrefs() {
  const current = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => prefs,
    () => SERVER_PREFS,
  );
  return {
    ...current,
    setEnabled(enabled: boolean) {
      store(ENABLED_KEY, enabled ? "1" : "0");
      apply({ ...prefs, enabled });
      if (enabled) play("toggle", { emphasis: "subtle" });
    },
    setTheme(theme: SoundTheme) {
      store(THEME_KEY, theme);
      apply({ ...prefs, theme });
      cue("tap");
    },
  };
}
