import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsDesktopApp } from './useIsNativeApp';
import {
  clearDevtoolsTrapState,
  isDevtoolsGuardBypassedHost,
  isDevtoolsLockActive,
  persistDevtoolsTrapState,
} from '@/lib/devtoolsTrap';

// ─────────────────────────────────────────────────────────────────────────────
// TUNING — adjust these without touching logic
// ─────────────────────────────────────────────────────────────────────────────

/** px – DevTools panels are 300-500 px wide/tall; zoom never reaches this */
const VIEWPORT_THRESHOLD = 380;

/** How many consecutive 1-second ticks with viewport diff > threshold before redirect */
const VIEWPORT_CONFIRM_TICKS = 5;

/** How many times console-getter must fire in a row before redirect */
const CONSOLE_CONFIRM_COUNT = 4;

/** How many times the disable-devtool LIBRARY must fire before redirect.
 *  Protects against the one spurious event that can happen on tab resume. */
const LIBRARY_CONFIRM_COUNT = 2;

/** ms after tab hidden before checks resume */
const TAB_SWITCH_GRACE_MS = 6000;

/** ms after window focus (alt-tab / screen switch) before checks resume */
const FOCUS_GRACE_MS = 3000;

/** ms after last resize event before viewport baseline is refreshed */
const RESIZE_SETTLE_MS = 1500;

// ─────────────────────────────────────────────────────────────────────────────
// DETECTION LOG  (in-memory, survives page navigation, cleared on unlock)
// ─────────────────────────────────────────────────────────────────────────────
export type DetectionLogEntry = {
  ts: string;          // ISO timestamp
  reason: string;      // detection method
  detail?: string;     // extra context
  blocked: boolean;    // true = redirect happened
};

const DETECTION_LOG_KEY = 'tatakai.devtools-detection-log';

function appendDetectionLog(entry: DetectionLogEntry) {
  try {
    const raw = sessionStorage.getItem(DETECTION_LOG_KEY);
    const log: DetectionLogEntry[] = raw ? JSON.parse(raw) : [];
    log.push(entry);
    // Keep last 50 entries
    if (log.length > 50) log.splice(0, log.length - 50);
    sessionStorage.setItem(DETECTION_LOG_KEY, JSON.stringify(log));
  } catch { /* ignore storage errors */ }
}

function logDetection(reason: string, detail: string, blocked: boolean) {
  const entry: DetectionLogEntry = {
    ts: new Date().toISOString(),
    reason,
    detail,
    blocked,
  };
  appendDetectionLog(entry);
  // Keep a developer-facing console trace (suppressed in production by production.ts)
  // eslint-disable-next-line no-console
  console.warn('[AntiDevTools]', reason, '|', detail, '| blocked:', blocked);
}

/** Public helper – other parts of the app can read the log for admin display */
export function readDetectionLog(): DetectionLogEntry[] {
  try {
    const raw = sessionStorage.getItem(DETECTION_LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function clearDetectionLog() {
  try { sessionStorage.removeItem(DETECTION_LOG_KEY); } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HOOK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detects open developer tools and redirects to /devtools-blocked.
 *
 * FALSE-POSITIVE GUARANTEES
 * ─────────────────────────
 * ✔ Zoom in / out         → DPR change detected → baseline refreshed, skipped
 * ✔ Window resize / snap  → outerWidth change   → baseline refreshed, skipped
 *                           + checks paused during active resize
 * ✔ Tab switch            → 6 s grace period after tab goes hidden + all
 *                           counters reset
 * ✔ Alt-Tab / screen sw.  → 3 s grace period on focus + counter reset
 * ✔ Slow device / battery → debugger-timing detector fully removed
 * ✔ Lib spurious event    → library must fire LIBRARY_CONFIRM_COUNT times
 *                           AND not be in a grace period before redirect
 *
 * WHAT STILL CATCHES REAL DEVTOOLS
 * ─────────────────────────────────
 * • disable-devtool library  detectors 2-6 (toString, defineId, date,
 *   function, canvas) — unaffected by zoom / tab / resize
 * • Viewport shrink sustained for VIEWPORT_CONFIRM_TICKS seconds
 * • console-getter fired CONSOLE_CONFIRM_COUNT times in a row
 * • Keyboard shortcuts (F12, Ctrl+Shift+I/J/C/K, Ctrl+U) → instant
 * • All checks log to sessionStorage for admin inspection
 */
export function useAntiDevTools() {
  const navigate  = useNavigate();
  const isDesktop = useIsDesktopApp();

  // refs never cause re-renders
  const intervalRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const triggeredRef       = useRef(false);
  const disableDevtoolRef  = useRef<any>(null);

  // Per-method hit counters
  const viewportHitsRef  = useRef(0);
  const consoleHitsRef   = useRef(0);
  const libraryHitsRef   = useRef(0);
  const tickCountRef     = useRef(0);

  // Grace-period + resize state
  const gracePeriodUntilRef  = useRef(0);
  const resizingRef          = useRef(false);
  const resizeTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable dimension baseline
  const baselineRef = useRef({ outerW: 0, outerH: 0, dpr: 1 });

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

    // ── Baseline helpers ──────────────────────────────────────────────
    const captureBaseline = () => {
      baselineRef.current = {
        outerW: window.outerWidth,
        outerH: window.outerHeight,
        dpr:    window.devicePixelRatio,
      };
      viewportHitsRef.current = 0; // reset on every baseline shift
    };
    captureBaseline();

    // ── Grace helpers ─────────────────────────────────────────────────
    const isInGracePeriod = () => Date.now() < gracePeriodUntilRef.current;

    const setGracePeriod = (ms: number, source: string) => {
      gracePeriodUntilRef.current = Date.now() + ms;
      logDetection('grace-period-set', source, false);
      // Reset ALL counters — noise before the gap is irrelevant
      viewportHitsRef.current = 0;
      consoleHitsRef.current  = 0;
      libraryHitsRef.current  = 0;
    };

    // ── Redirect ──────────────────────────────────────────────────────
    const redirect = (reason: string, detail = '') => {
      logDetection(reason, detail, true);
      const payload = persistDevtoolsTrapState(reason);

      if (window.location.pathname === '/devtools-blocked') {
        triggeredRef.current = true;
        return;
      }
      if (triggeredRef.current) return;
      triggeredRef.current = true;

      navigate('/devtools-blocked', { replace: true, state: { trapPayload: payload } });
    };

    if (isDevtoolsLockActive() && window.location.pathname !== '/devtools-blocked') {
      redirect('lock-active', 'previous session lock still valid');
      return;
    }

    // ─────────────────────────────────────────────────────────────────
    // METHOD 1 · Viewport size  (zoom-safe, baseline-relative, sustained)
    //
    // ZOOM false-positive prevention:
    //   In every browser, Ctrl+/- changes window.devicePixelRatio in
    //   proportion to the zoom level. If DPR shifted even slightly, we
    //   treat this as a zoom/display event and refresh the baseline.
    //
    //   Additionally: if outerWidth itself changed, that's a window
    //   resize — also refresh baseline.
    //
    //   Only when both outerWidth AND dpr are stable but innerWidth
    //   shrank do we count a DevTools hit.
    // ─────────────────────────────────────────────────────────────────
    const checkViewport = (): boolean => {
      if (resizingRef.current) return false;

      const dpr    = window.devicePixelRatio;
      const dprDelta = Math.abs(dpr - baselineRef.current.dpr);

      if (dprDelta > 0.04) {
        // DPR changed → zoom or display scaling change → update baseline
        logDetection('viewport-baseline-refresh', `dpr ${baselineRef.current.dpr} → ${dpr}`, false);
        captureBaseline();
        return false;
      }

      const outerWDelta = Math.abs(window.outerWidth  - baselineRef.current.outerW);
      const outerHDelta = Math.abs(window.outerHeight - baselineRef.current.outerH);

      if (outerWDelta > 20 || outerHDelta > 20) {
        // outerWidth changed → genuine window resize → update baseline
        logDetection('viewport-baseline-refresh', `outerW ${baselineRef.current.outerW} → ${window.outerWidth}`, false);
        captureBaseline();
        return false;
      }

      // outerW stable + DPR stable + innerW shrank → DevTools docked
      const shrinkW = baselineRef.current.outerW - window.innerWidth;
      const shrinkH = baselineRef.current.outerH - window.innerHeight;

      if (shrinkW > VIEWPORT_THRESHOLD || shrinkH > VIEWPORT_THRESHOLD) {
        viewportHitsRef.current++;
        logDetection(
          'viewport-hit',
          `shrinkW=${shrinkW} shrinkH=${shrinkH} hits=${viewportHitsRef.current}/${VIEWPORT_CONFIRM_TICKS}`,
          false,
        );
      } else {
        viewportHitsRef.current = Math.max(0, viewportHitsRef.current - 1);
      }

      return viewportHitsRef.current >= VIEWPORT_CONFIRM_TICKS;
    };

    // ─────────────────────────────────────────────────────────────────
    // METHOD 2 · console-getter  (sustained)
    //
    // DevTools eagerly calls getters on objects logged to the console.
    // Requires CONSOLE_CONFIRM_COUNT consecutive fires.
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
        logDetection(
          'console-getter-hit',
          `hits=${consoleHitsRef.current}/${CONSOLE_CONFIRM_COUNT}`,
          false,
        );
      } else {
        consoleHitsRef.current = Math.max(0, consoleHitsRef.current - 1);
      }

      return consoleHitsRef.current >= CONSOLE_CONFIRM_COUNT;
    };

    // ─────────────────────────────────────────────────────────────────
    // PRIMARY · disable-devtool library  (high-confidence, confirmed)
    //
    // NOTE: Detector 0 (size) excluded — zoom-sensitive.
    //       Detector 1 (debugger timing) excluded — triggers on tab
    //         resume when JS was suspended (false positive on tab switch).
    //       Detector 7 (performance) excluded — slow-device-sensitive.
    //
    //       Remaining: 2 toString · 3 defineId · 4 date · 5 function · 6 canvas
    //
    // CONFIRMATION: the library must fire LIBRARY_CONFIRM_COUNT times
    // outside of any grace period before we redirect. This absorbs the
    // one spurious event that occasionally fires on page load or focus.
    // ─────────────────────────────────────────────────────────────────
    import('disable-devtool').then((mod) => {
      const DisableDevtool: any = mod.default;
      disableDevtoolRef.current = DisableDevtool({
        ondevtoolopen: (type: string) => {
          // Ignore if we're still in a grace period
          if (isInGracePeriod()) {
            logDetection('library-skipped-grace', `type=${type}`, false);
            return;
          }

          libraryHitsRef.current++;
          logDetection(
            'library-hit',
            `type=${type} hits=${libraryHitsRef.current}/${LIBRARY_CONFIRM_COUNT}`,
            false,
          );

          if (libraryHitsRef.current >= LIBRARY_CONFIRM_COUNT) {
            redirect('library-confirmed', `type=${type}`);
          }
        },
        disableMenu:          true,
        clearLog:             true,
        clearIntervalWhenDev: false,
        interval:             1500,
        detectors: [2, 3, 4, 5, 6],
        // 0 size       → EXCLUDED (zoom)
        // 1 debugger   → EXCLUDED (tab-resume false positive)
        // 7 performance → EXCLUDED (slow device)
      });
    }).catch(() => { /* fall back to manual checks */ });

    // ─────────────────────────────────────────────────────────────────
    // POLLING LOOP  (1 s tick)
    // ─────────────────────────────────────────────────────────────────
    const runChecks = () => {
      if (triggeredRef.current) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        return;
      }

      if (isDevtoolsLockActive() && window.location.pathname !== '/devtools-blocked') {
        redirect('lock-active-poll', 'detected on tick');
        return;
      }

      if (isInGracePeriod() || resizingRef.current) return;

      tickCountRef.current++;

      if (checkViewport()) {
        redirect('viewport-sustained', `after ${VIEWPORT_CONFIRM_TICKS}s`);
        return;
      }

      // Console getter: every 4 ticks
      if (tickCountRef.current % 4 === 0) {
        if (checkConsole()) {
          redirect('console-getter-sustained', `after ${CONSOLE_CONFIRM_COUNT} fires`);
          return;
        }
      }
    };

    // Give the page 2 s to settle fully before first probe
    const initTimer = setTimeout(() => {
      if (!triggeredRef.current && !isInGracePeriod()) checkConsole();
    }, 2000);

    intervalRef.current = setInterval(runChecks, 1000);

    // ─────────────────────────────────────────────────────────────────
    // EVENT LISTENERS
    // ─────────────────────────────────────────────────────────────────

    // Resize: pause checks, then refresh baseline once stable
    const handleResize = () => {
      if (!resizingRef.current) {
        resizingRef.current = true;
        viewportHitsRef.current = 0;
      }
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(() => {
        captureBaseline();
        resizingRef.current = false;
        logDetection('resize-baseline-refresh', `outerW=${window.outerWidth} dpr=${window.devicePixelRatio}`, false);
      }, RESIZE_SETTLE_MS);
    };

    // Tab becomes hidden → start long grace + reset counters
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        setGracePeriod(TAB_SWITCH_GRACE_MS, 'tab-hidden');
      }
    };

    // Window regains focus (alt-tab / screen switch) → short grace + reset
    const handleFocus = () => {
      setGracePeriod(FOCUS_GRACE_MS, 'window-focus');
    };

    // Keyboard shortcuts → instant redirect (100 % certainty)
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
        redirect(`shortcut-${key}`, `ctrl=${ctrlLike} shift=${event.shiftKey}`);
      }
    };

    window.addEventListener('resize', handleResize);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('keydown', handleKeydown, { capture: true });

    return () => {
      clearTimeout(initTimer);
      if (intervalRef.current)   clearInterval(intervalRef.current);
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
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
