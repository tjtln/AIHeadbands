import { useEffect, useRef, useState } from 'react';

// Correct was firing far too easily and skip was nearly unreachable at 28/16 —
// swapping the balance the other way: require a deliberate tilt for correct,
// and much less motion to register a skip.
const DOWN_THRESHOLD = 36;
const UP_THRESHOLD = 10;
const NEUTRAL_THRESHOLD = 8;
const COOLDOWN_MS = 1000;

interface DeviceOrientationEventIOS {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export function isTiltSupported(): boolean {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
}

export async function requestTiltPermission(): Promise<boolean> {
  if (!isTiltSupported()) {
    return false;
  }

  const DeviceOrientationEventIOS = window.DeviceOrientationEvent as unknown as DeviceOrientationEventIOS;
  if (typeof DeviceOrientationEventIOS.requestPermission === 'function') {
    try {
      return (await DeviceOrientationEventIOS.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }

  // Browsers without the iOS permission gate don't need an explicit request.
  return true;
}

export type TiltStatus = 'calibrating' | 'ready';

function getLandscapeQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia('(orientation: landscape)') : null;
}

function isLandscapeLayout(): boolean {
  const query = getLandscapeQuery();
  return query ? query.matches : window.innerWidth > window.innerHeight;
}

/**
 * Device orientation's beta/gamma axes are fixed to the physical device, not the screen.
 * Rotating into landscape swaps which axis corresponds to "tilting the top of the phone
 * away from you". `screen.orientation.angle` / `window.orientation` are unreliable inside
 * an installed standalone iOS PWA (often stuck at 0 since there's no browser chrome to
 * rotate), so this goes off the actual rendered CSS layout instead, which is always correct.
 */
function getEffectiveTilt(event: DeviceOrientationEvent): number | null {
  if (event.beta === null || event.gamma === null) {
    return null;
  }

  return isLandscapeLayout() ? event.gamma : event.beta;
}

export function useTiltControls(
  active: boolean,
  inverted: boolean,
  onCorrect: () => void,
  onSkip: () => void
): TiltStatus {
  const [status, setStatus] = useState<TiltStatus>('calibrating');
  const baselineRef = useRef<number | null>(null);
  // Tracks which direction last fired so each direction only fires once per
  // "trip" past its threshold, without requiring a return to dead-center in
  // between — a strict return-to-neutral gate can get skipped over entirely
  // by a fast tilt that jumps straight from one threshold to the other.
  const lastFiredRef = useRef<'correct' | 'skip' | null>(null);
  const cooldownUntilRef = useRef(0);
  const onCorrectRef = useRef(onCorrect);
  const onSkipRef = useRef(onSkip);
  const invertedRef = useRef(inverted);

  onCorrectRef.current = onCorrect;
  onSkipRef.current = onSkip;
  invertedRef.current = inverted;

  useEffect(() => {
    if (!active) {
      baselineRef.current = null;
      lastFiredRef.current = null;
      setStatus('calibrating');
      return;
    }

    function recalibrate() {
      baselineRef.current = null;
      lastFiredRef.current = null;
      cooldownUntilRef.current = 0;
      setStatus('calibrating');
    }

    recalibrate();

    function handleOrientation(event: DeviceOrientationEvent) {
      const tilt = getEffectiveTilt(event);
      if (tilt === null) {
        return;
      }

      if (baselineRef.current === null) {
        baselineRef.current = tilt;
        lastFiredRef.current = null;
        setStatus('ready');
        return;
      }

      const rawDiff = tilt - baselineRef.current;
      const diff = invertedRef.current ? -rawDiff : rawDiff;

      // Hard cooldown after any trigger — ignore everything (including the
      // neutral-zone reset) until it expires, so a held tilt can't immediately
      // re-fire the moment the direction-based gate would otherwise allow it.
      if (Date.now() < cooldownUntilRef.current) {
        return;
      }

      if (diff > DOWN_THRESHOLD) {
        if (lastFiredRef.current !== 'correct') {
          lastFiredRef.current = 'correct';
          cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
          onCorrectRef.current();
        }
      } else if (diff < -UP_THRESHOLD) {
        if (lastFiredRef.current !== 'skip') {
          lastFiredRef.current = 'skip';
          cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
          onSkipRef.current();
        }
      } else if (Math.abs(diff) < NEUTRAL_THRESHOLD) {
        lastFiredRef.current = null;
      }
    }

    // Rotating mid-round changes which physical axis maps to "tilt" — recalibrate
    // against the new orientation rather than carrying over a stale baseline.
    const landscapeQuery = getLandscapeQuery();

    window.addEventListener('deviceorientation', handleOrientation);
    window.addEventListener('orientationchange', recalibrate);
    landscapeQuery?.addEventListener('change', recalibrate);

    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
      window.removeEventListener('orientationchange', recalibrate);
      landscapeQuery?.removeEventListener('change', recalibrate);
    };
  }, [active]);

  return status;
}
