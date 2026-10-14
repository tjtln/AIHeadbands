import { useEffect, useRef, useState } from 'react';

const DOWN_THRESHOLD = 35;
const UP_THRESHOLD = 35;
const NEUTRAL_THRESHOLD = 15;

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

function getScreenAngle(): number {
  const orientation = window.screen?.orientation;
  if (orientation && typeof orientation.angle === 'number') {
    return orientation.angle;
  }
  // Legacy iOS Safari fallback.
  const legacyAngle = (window as unknown as { orientation?: number }).orientation;
  return typeof legacyAngle === 'number' ? legacyAngle : 0;
}

/**
 * Device orientation's beta/gamma axes are fixed to the physical device, not the screen.
 * Rotating into landscape swaps which axis corresponds to "tilting the top of the phone
 * away from you" — this picks the right axis (and sign) for whatever rotation is active.
 */
function getEffectiveTilt(event: DeviceOrientationEvent, screenAngle: number): number | null {
  if (event.beta === null || event.gamma === null) {
    return null;
  }

  switch (screenAngle) {
    case 90:
      return event.gamma;
    case -90:
    case 270:
      return -event.gamma;
    case 180:
      return -event.beta;
    default:
      return event.beta;
  }
}

export function useTiltControls(
  active: boolean,
  inverted: boolean,
  onCorrect: () => void,
  onSkip: () => void
): TiltStatus {
  const [status, setStatus] = useState<TiltStatus>('calibrating');
  const baselineRef = useRef<number | null>(null);
  const armedRef = useRef(true);
  const onCorrectRef = useRef(onCorrect);
  const onSkipRef = useRef(onSkip);
  const invertedRef = useRef(inverted);

  onCorrectRef.current = onCorrect;
  onSkipRef.current = onSkip;
  invertedRef.current = inverted;

  useEffect(() => {
    if (!active) {
      baselineRef.current = null;
      armedRef.current = true;
      setStatus('calibrating');
      return;
    }

    function recalibrate() {
      baselineRef.current = null;
      armedRef.current = true;
      setStatus('calibrating');
    }

    recalibrate();

    function handleOrientation(event: DeviceOrientationEvent) {
      const tilt = getEffectiveTilt(event, getScreenAngle());
      if (tilt === null) {
        return;
      }

      if (baselineRef.current === null) {
        baselineRef.current = tilt;
        setStatus('ready');
        return;
      }

      const rawDiff = tilt - baselineRef.current;
      const diff = invertedRef.current ? -rawDiff : rawDiff;

      if (armedRef.current) {
        if (diff > DOWN_THRESHOLD) {
          armedRef.current = false;
          onCorrectRef.current();
        } else if (diff < -UP_THRESHOLD) {
          armedRef.current = false;
          onSkipRef.current();
        }
      } else if (Math.abs(diff) < NEUTRAL_THRESHOLD) {
        armedRef.current = true;
      }
    }

    // Rotating mid-round changes which physical axis maps to "tilt" — recalibrate
    // against the new orientation rather than carrying over a stale baseline.
    window.addEventListener('deviceorientation', handleOrientation);
    window.addEventListener('orientationchange', recalibrate);
    window.screen?.orientation?.addEventListener?.('change', recalibrate);

    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
      window.removeEventListener('orientationchange', recalibrate);
      window.screen?.orientation?.removeEventListener?.('change', recalibrate);
    };
  }, [active]);

  return status;
}
