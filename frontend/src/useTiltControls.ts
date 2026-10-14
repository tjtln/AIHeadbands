import { useEffect, useRef, useState } from 'react';

// How much of the demonstrated calibration tilt you need to reach to trigger —
// lower than 1.0 so you don't have to hit your exact calibration extreme every time.
const TRIGGER_FRACTION = 0.55;
const NEUTRAL_FRACTION = 0.25;
const MIN_NEUTRAL = 4;
const MIN_SAMPLE_MAGNITUDE = 6;
const COOLDOWN_MS = 1000;

/**
 * Signed tilt values (relative to whatever baseline was active when they were
 * captured) demonstrated during calibration for each gesture. The sign itself
 * carries the direction, so there's no separate "inverted" concept needed —
 * whichever way the user actually tilted is what gets matched at runtime.
 */
export interface TiltProfile {
  down: number;
  up: number;
}

// Reasonable starting point before the user calibrates their own gesture.
export const DEFAULT_TILT_PROFILE: TiltProfile = { down: 25, up: -25 };

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

/** Live raw tilt reading (axis-aware, not baseline-relative) — used by the calibration UI. */
export function useRawTilt(active: boolean): number | null {
  const [tilt, setTilt] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      setTilt(null);
      return;
    }

    function handle(event: DeviceOrientationEvent) {
      const value = getEffectiveTilt(event);
      if (value !== null) {
        setTilt(value);
      }
    }

    window.addEventListener('deviceorientation', handle);
    return () => window.removeEventListener('deviceorientation', handle);
  }, [active]);

  return tilt;
}

export type TiltStatus = 'calibrating' | 'ready';

export function useTiltControls(
  active: boolean,
  profile: TiltProfile,
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
  const profileRef = useRef(profile);

  onCorrectRef.current = onCorrect;
  onSkipRef.current = onSkip;
  profileRef.current = profile;

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

      const diff = tilt - baselineRef.current;

      // Hard cooldown after any trigger — ignore everything (including the
      // neutral-zone reset) until it expires, so a held tilt can't immediately
      // re-fire the moment the direction-based gate would otherwise allow it.
      if (Date.now() < cooldownUntilRef.current) {
        return;
      }

      const { down, up } = profileRef.current;
      const downMagnitude = Math.abs(down);
      const upMagnitude = Math.abs(up);
      const neutralThreshold = Math.max(MIN_NEUTRAL, Math.min(downMagnitude, upMagnitude) * NEUTRAL_FRACTION);

      const downHit =
        downMagnitude >= MIN_SAMPLE_MAGNITUDE &&
        Math.sign(diff) === Math.sign(down) &&
        Math.abs(diff) > downMagnitude * TRIGGER_FRACTION;

      const upHit =
        upMagnitude >= MIN_SAMPLE_MAGNITUDE &&
        Math.sign(diff) === Math.sign(up) &&
        Math.abs(diff) > upMagnitude * TRIGGER_FRACTION;

      if (downHit) {
        if (lastFiredRef.current !== 'correct') {
          lastFiredRef.current = 'correct';
          cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
          onCorrectRef.current();
        }
      } else if (upHit) {
        if (lastFiredRef.current !== 'skip') {
          lastFiredRef.current = 'skip';
          cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
          onSkipRef.current();
        }
      } else if (Math.abs(diff) < neutralThreshold) {
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
