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

export function useTiltControls(active: boolean, onCorrect: () => void, onSkip: () => void): TiltStatus {
  const [status, setStatus] = useState<TiltStatus>('calibrating');
  const baselineRef = useRef<number | null>(null);
  const armedRef = useRef(true);
  const onCorrectRef = useRef(onCorrect);
  const onSkipRef = useRef(onSkip);

  onCorrectRef.current = onCorrect;
  onSkipRef.current = onSkip;

  useEffect(() => {
    if (!active) {
      baselineRef.current = null;
      armedRef.current = true;
      setStatus('calibrating');
      return;
    }

    setStatus('calibrating');
    baselineRef.current = null;
    armedRef.current = true;

    function handleOrientation(event: DeviceOrientationEvent) {
      if (event.beta === null) {
        return;
      }

      if (baselineRef.current === null) {
        baselineRef.current = event.beta;
        setStatus('ready');
        return;
      }

      const diff = event.beta - baselineRef.current;

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

    window.addEventListener('deviceorientation', handleOrientation);
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, [active]);

  return status;
}
