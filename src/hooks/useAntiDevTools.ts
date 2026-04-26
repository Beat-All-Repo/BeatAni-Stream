import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsDesktopApp } from './useIsNativeApp';
import {
  clearDevtoolsTrapState,
  isDevtoolsGuardBypassedHost,
  isDevtoolsLockActive,
  isLikelyDevtoolsOpenByDebugger,
  persistDevtoolsTrapState,
} from '@/lib/devtoolsTrap';

// ─────────────────────────────────────────────────────────────────────────────
// TUNING CONSTANTS
// Each method must fire this many consecutive times before it triggers a
// redirect. This makes every individual method immune to one-off false triggers.
// ─────────────────────────────────────────────────────────────────────────────
const VIEWPORT_CONFIRM_COUNT  = 4;    // ~4 s of sustained viewport shrink
const DEBUGGER_CONFIRM_COUNT  = 3;    // 3 consecutive slow debugger pairs
const CONSOLE_CONFIRM_COUNT   = 3;    // 3 consecutive console-getter fires
const VIEWPORT_THRESHOLD      = 380;  // px — typical DevTools panel width/height
const DEBUGGER_THRESHOLD_MS   = 260;  // ms — generous so suspended tabs are safe
const TAB_SWITCH_GRACE_MS     = 5000; // ms after tab-switch before checks resume
const FOCUS_GRACE_MS          = 2500; // ms after alt-tab / screen-switch
const RESIZE_SETTLE_MS        = 1500; // ms after resize stops before re-checking

/**
 * Detects open developer tools and redirects to the blocked page.
 *
 * IMPROVEMENTS OVER THE ORIGINAL:
 *
 * 1. ZOOM-SAFE viewport check
 *    – Captures a baseline (outerWidth, outerHeight, devicePixelRatio) on mount
 *      and after every genuine window resize.
 *    – Flags ONLY when outerWidth is stable AND DPR is stable but innerWidth
 *      has shrunk by > VIEWPORT_THRESHOLD px — the exact fingerprint of a docked
 *      DevTools panel, not zoom.
 *    – When DPR or outerWidth changes (zoom / display change / snap), the
 *      baseline is refreshed automatically so the next measurement is clean.
 *
 * 2. SUSTAINED-confirmation for every heuristic method
 *    – A single positive reading no longer triggers a redirect.
 *    – Each method keeps its own hit-counter that increments on a positive and
 *      decrements on a negative. Redirect fires only when counter reaches
 *      its CONFIRM_COUNT — filters out momentary glitches completely.
 *
 * 3. GRACE PERIODS for normal browser interactions
 *    – Tab switch  (visibilitychange → hidden) : 5 s grace + counter reset.
 *    – Alt-Tab / screen switch (focus)         : 2.5 s grace + counter reset.
 *    – Window resize : checks pause; baseline refreshed 1.5 s after last event.
 *
 * 4. DUAL-SAMPLE debugger timing
 *    – Two back-to-back samples must both be slow before the counter increments.
 *      A single slow sample (suspended / throttled tab) is ignored.
 *
 * 5. disable-devtool library — all non-size/non-perf detectors enabled
 *    – Detector 0 (size) excluded: zoom-sensitive.
 *    – Detector 7 (performance) excluded: slow-device-sensitive.
 *    – Detectors 1–6 run at 1.5 s intervals and fire an immediate redirect.
 *
 * 6. Keyboard shortcuts → immediate redirect (certainty = 100 %).
 */
export function useAntiDevTools() {
  const navigate    = useNavigate();
  const isDesktop   = useIsDesktopApp();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const triggeredRef = useRef(false);
  const disableDevtoolRef = useRef<any>(null);

  // Sustained hit counters — each method manages its own
  const viewportHitsRef = useRef(0);
  const debuggerHitsRef = useRef(0);
  const consoleHitsRef  = useRef(0);
  const tickCountRef    = useRef(0);

  // Grace-period state
  const gracePeriodUntilRef  = useRef(0);
  const resizingRef          = useRef(false);
  const resizeSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable baseline captured at mount & after every genuine window resize
  const baselineRef = useRef({
    outerWidth:  0,
    outerHeight: 0,
    innerWidth:  0,
    innerHeight: 0,
    dpr:         1,
  });

  useEffect(() => {
    if (isDesktop) return;
    if (typeof window === 'undefined') return;

    const disableGuard =
      String(import.meta.env.VITE_DISABLE_DEVTOOLS_GUARD ?? 'false').toLowerCase() === 'true';
    if (disableGuard) return;

    if (isDevtoolsGuardBypassedHost()) {
      clearDevtoolsTrapState();
      return;
    }

    // ── Capture baseline ──────────────────────────────────────────────
    const captureBaseline = () => {
      baselineRef.current = {
        outerWidth:  window.outerWidth,
        outerHeight: window.outerHeight,
        innerWidth:  window.innerWidth,
        innerHeight: window.innerHeight,
        dpr:         window.devicePixelRatio,
      };
      viewportHitsRef.current = 0;
    };
    captureBaseline();

    // ── Redirect helper ───────────────────────────────────────────────
    const redirect = (reason: string) => {
      const payload = persistDevtoolsTrapState(reason);
      if (window.location.pathname === '/devtools-blocked') {
        triggeredRef.current = true;
        return;
      }
      if (triggeredRef.current) return;
      triggeredRef.current = true;
      // eslint-disable-next-line no-console
      console.error(JSON.stringify(payload, null, 2));
      navigate('/devtools-blocked', { replace: true, state: { trapPayload: payload } });
    };

    if (isDevtoolsLockActive() && window.location.pathname !== '/devtools-blocked') {
      redirect('lock-active');
      return;
    }

    // ── Grace-period helpers ──────────────────────────────────────────
    const isInGracePeriod = () => Date.now() < gracePeriodUntilRef.current;

    const setGracePeriod = (ms: number) => {
      gracePeriodUntilRef.current = Date.now() + ms;
      // Reset all counters so noise from before the gap is discarded
      viewportHitsRef.current = 0;
      debuggerHitsRef.current = 0;
      consoleHitsRef.current  = 0;
    };

    // ─────────────────────────────────────────────────────────────────
    // METHOD 1 · Viewport-size (zoom-safe, baseline-relative, sustained)
    //
    // DevTools opens on the SIDE  → outerWidth stays, innerWidth  shrinks.
    // DevTools opens on the BOTTOM → outerHeight stays, innerHeight shrinks.
    // Zoom IN/OUT              → DPR changes OR outerWidth changes too.
    // Window resize            → outerWidth changes  → baseline refreshed.
    // ─────────────────────────────────────────────────────────────────
    const checkViewport = (): boolean => {
      if (resizingRef.current) return false;

      const dpr = window.devicePixelRatio;

      // DPR changed → zoom or display switch → refresh baseline and skip
      if (Math.abs(dpr - baselineRef.current.dpr) > 0.05) {
        captureBaseline();
        return false;
      }

      // outerWidth / outerHeight changed → genuine window resize → refresh baseline
      if (
        Math.abs(window.outerWidth  - baselineRef.current.outerWidth)  > 20 ||
        Math.abs(window.outerHeight - baselineRef.current.outerHeight) > 20
      ) {
        captureBaseline();
        return false;
      }

      // outerWidth stable, DPR stable, but innerWidth fell → DevTools fingerprint
      const shrinkW = baselineRef.current.outerWidth  - window.innerWidth;
      const shrinkH = baselineRef.current.outerHeight - window.innerHeight;

      if (shrinkW > VIEWPORT_THRESHOLD || shrinkH > VIEWPORT_THRESHOLD) {
        viewportHitsRef.current++;
      } else {
        viewportHitsRef.current = Math.max(0, viewportHitsRef.current - 1);
      }

      return viewportHitsRef.current >= VIEWPORT_CONFIRM_COUNT;
    };

    // ─────────────────────────────────────────────────────────────────
    // METHOD 2 · Debugger timing (dual-sample, sustained)
    //
    // DevTools slows down the `debugger` statement significantly.
    // Two consecutive slow samples are required to increment the counter,
    // preventing a single slow event (throttled/re-activated tab) from firing.
    // ─────────────────────────────────────────────────────────────────
    const checkDebuggerTiming = (): boolean => {
      const slow1 = isLikelyDevtoolsOpenByDebugger(DEBUGGER_THRESHOLD_MS);
      const slow2 = isLikelyDevtoolsOpenByDebugger(DEBUGGER_THRESHOLD_MS);

      if (slow1 && slow2) {
        debuggerHitsRef.current++;
      } else {
        debuggerHitsRef.current = Math.max(0, debuggerHitsRef.current - 1);
      }

      return debuggerHitsRef.current >= DEBUGGER_CONFIRM_COUNT;
    };

    // ─────────────────────────────────────────────────────────────────
    // METHOD 3 · console-getter object (sustained)
    //
    // DevTools eagerly expands objects in the console, triggering getters.
    // Requires CONSOLE_CONFIRM_COUNT consecutive positives.
    // ─────────────────────────────────────────────────────────────────
    let consoleGetterFired = false;
    const detectObj = Object.defineProperty({}, '_', {
      get() { consoleGetterFired = true; return undefined; },
    });

    const checkConsole = (): boolean => {
      consoleGetterFired = false;
      // eslint-disable-next-line no-console
      console.log('%c', detectObj);
      if (consoleGetterFired) {
        consoleHitsRef.current++;
      } else {
        consoleHitsRef.current = Math.max(0, consoleHitsRef.current - 1);
      }
      return consoleHitsRef.current >= CONSOLE_CONFIRM_COUNT;
    };

    // ─────────────────────────────────────────────────────────────────
    // PRIMARY · disable-devtool library (immediate, high-confidence)
    // ─────────────────────────────────────────────────────────────────
    import('disable-devtool').then((mod) => {
      const DisableDevtool: any = mod.default;
      disableDevtoolRef.current = DisableDevtool({
        ondevtoolopen: (_type: string) => {
          redirect('disable-devtool-detector');
        },
        disableMenu:          true,
        clearLog:             true,
        clearIntervalWhenDev: false,
        interval:             1500,
        // 0 = size (zoom-sensitive)  →  EXCLUDED
        // 7 = performance            →  EXCLUDED (slow devices)
        // 1 debugger · 2 toString · 3 defineId · 4 date · 5 function · 6 canvas
        detectors: [1, 2, 3, 4, 5, 6],
      });
    }).catch(() => { /* Fall back to manual checks only */ });

    // ─────────────────────────────────────────────────────────────────
    // POLLING LOOP  (1 s interval)
    // ─────────────────────────────────────────────────────────────────
    const runChecks = () => {
      if (triggeredRef.current) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        return;
      }

      if (isDevtoolsLockActive() && window.location.pathname !== '/devtools-blocked') {
        redirect('lock-active');
        return;
      }

      // Skip all heuristics during grace periods or active resize
      if (isInGracePeriod() || resizingRef.current) return;

      tickCountRef.current++;

      // Viewport: every tick  (lightweight — just math)
      if (checkViewport()) { redirect('viewport-sustained'); return; }

      // Console getter: every 4 ticks  (reduces log noise)
      if (tickCountRef.current % 4 === 0) {
        if (checkConsole()) { redirect('console-getter-sustained'); return; }
      }

      // Debugger timing: every 7 ticks  (CPU-intensive — keep infrequent)
      if (tickCountRef.current % 7 === 0) {
        if (checkDebuggerTiming()) { redirect('debugger-timing-sustained'); }
      }
    };

    // Let page fully settle before first probe
    const initTimer = setTimeout(() => {
      if (!triggeredRef.current && !isInGracePeriod()) checkConsole();
    }, 2000);

    intervalRef.current = setInterval(runChecks, 1000);

    // ─────────────────────────────────────────────────────────────────
    // EVENT LISTENERS
    // ─────────────────────────────────────────────────────────────────

    // Resize: pause, then refresh baseline after window settles
    const handleResize = () => {
      resizingRef.current = true;
      viewportHitsRef.current = 0;
      if (resizeSettleTimerRef.current) clearTimeout(resizeSettleTimerRef.current);
      resizeSettleTimerRef.current = setTimeout(() => {
        captureBaseline();          // New size is now the normal state
        resizingRef.current = false;
      }, RESIZE_SETTLE_MS);
    };

    // Tab switch → page hidden: long grace + reset
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') setGracePeriod(TAB_SWITCH_GRACE_MS);
    };

    // Alt-Tab / screen switch → window focus: short grace + reset
    const handleFocus = () => setGracePeriod(FOCUS_GRACE_MS);

    // Keyboard shortcuts: immediate redirect (no ambiguity)
    const handleKeydown = (event: KeyboardEvent) => {
      const key      = event.key.toLowerCase();
      const ctrlLike = event.ctrlKey || event.metaKey;

      const blocked =
        key === 'f12' ||
        (ctrlLike && event.shiftKey && ['i', 'j', 'c', 'k'].includes(key)) ||
        (ctrlLike && !event.shiftKey && key === 'u');

      if (blocked) {
        event.preventDefault();
        event.stopPropagation();
        redirect(`blocked-shortcut-${key}`);
      }
    };

    window.addEventListener('resize', handleResize);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('keydown', handleKeydown, { capture: true });

    return () => {
      clearTimeout(initTimer);
      if (intervalRef.current)          clearInterval(intervalRef.current);
      if (resizeSettleTimerRef.current) clearTimeout(resizeSettleTimerRef.current);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('keydown', handleKeydown, { capture: true } as EventListenerOptions);
      if (disableDevtoolRef.current && typeof disableDevtoolRef.current === 'function') {
        try { disableDevtoolRef.current(); } catch { /* ignore */ }
      }
    };
  }, [isDesktop, navigate]);
}
