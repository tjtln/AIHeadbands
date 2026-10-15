import { useEffect, useMemo, useRef, useState } from 'react';
import topicsData from './data/topics.json';
import {
  DEFAULT_TILT_PROFILE,
  isTiltSupported,
  requestTiltPermission,
  useRawTilt,
  useTiltControls,
  type TiltProfile
} from './useTiltControls';

type CalibrationStep = 'neutral' | 'down' | 'up';

const DEFAULT_DURATION = 180;
const DOUBLE_TAP_MS = 260;
const FEEDBACK_DELAY_MS = 280;
const COUNTDOWN_SECONDS = 3;
const CATEGORY_MAP: Record<string, Record<string, string[]>> = topicsData;
const CATEGORY_NAMES = Object.keys(CATEGORY_MAP);

type Phase = 'setup' | 'countdown' | 'playing' | 'finished';

type HistoryEntry = {
  word: string;
  result: 'correct' | 'skipped';
};

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function App() {
  const [phase, setPhase] = useState<Phase>('setup');
  const [category, setCategory] = useState<string | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(DEFAULT_DURATION);
  const [timeLeft, setTimeLeft] = useState(DEFAULT_DURATION);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tiltEnabled, setTiltEnabled] = useState(false);
  const [tiltError, setTiltError] = useState<string | null>(null);
  const [tiltProfile, setTiltProfile] = useState<TiltProfile>(DEFAULT_TILT_PROFILE);
  const [tiltCalibrated, setTiltCalibrated] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [calibrationStep, setCalibrationStep] = useState<CalibrationStep>('neutral');
  const [calibrationBaseline, setCalibrationBaseline] = useState<number | null>(null);
  const [calibrationDown, setCalibrationDown] = useState<number | null>(null);

  const [queue, setQueue] = useState<string[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [allWords, setAllWords] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<'correct' | 'skipped' | null>(null);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);

  const currentWord = queue[queueIndex] ?? '';
  const clickTimerRef = useRef<number | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) {
        window.clearTimeout(clickTimerRef.current);
      }
      if (feedbackTimerRef.current) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (phase !== 'playing' || timeLeft <= 0 || settingsOpen) {
      return;
    }

    const timer = window.setInterval(() => {
      setTimeLeft((previous) => {
        if (previous <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return previous - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [phase, timeLeft, settingsOpen]);

  useEffect(() => {
    if (phase === 'playing' && timeLeft === 0) {
      setPhase('finished');
    }
  }, [phase, timeLeft]);

  useEffect(() => {
    if (phase !== 'countdown') {
      return;
    }

    if (countdown <= 0) {
      setPhase('playing');
      return;
    }

    const timer = window.setTimeout(() => {
      setCountdown((previous) => previous - 1);
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [phase, countdown]);

  // Lock the page in place during a round so a tap that drifts can't turn into a scroll.
  useEffect(() => {
    if (phase !== 'playing' && phase !== 'countdown') {
      return;
    }

    document.documentElement.classList.add('no-scroll');

    function blockTouchMove(event: TouchEvent) {
      const target = event.target as Element | null;
      if (target?.closest('.settings-panel, .calibration-overlay')) {
        return;
      }
      event.preventDefault();
    }

    document.addEventListener('touchmove', blockTouchMove, { passive: false });
    return () => {
      document.documentElement.classList.remove('no-scroll');
      document.removeEventListener('touchmove', blockTouchMove);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== 'playing' || settingsOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.code === 'Space' || event.code === 'ArrowUp') {
        event.preventDefault();
        markCurrent('correct');
      } else if (event.code === 'ArrowDown') {
        event.preventDefault();
        markCurrent('skipped');
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, queue, queueIndex, settingsOpen]);

  function selectCategory(nextCategory: string) {
    setError(null);
    setCategory(nextCategory);
  }

  function backToCategories() {
    setError(null);
    setCategory(null);
    setTopic(null);
  }

  function backToTopics() {
    setError(null);
    setTopic(null);
  }

  function startRound(nextCategory: string, nextTopic: string) {
    const words = CATEGORY_MAP[nextCategory]?.[nextTopic];
    if (!words || !words.length) {
      setError(`No words found for "${nextTopic}".`);
      return;
    }

    setError(null);
    setCategory(nextCategory);
    setTopic(nextTopic);
    setAllWords(words);
    setQueue(shuffle(words));
    setQueueIndex(0);
    setHistory([]);
    setTimeLeft(durationSeconds);
    setSettingsOpen(false);
    setCountdown(COUNTDOWN_SECONDS);
    setPhase('countdown');
  }

  function markCurrent(result: 'correct' | 'skipped') {
    if (!currentWord || feedback || settingsOpen) {
      return;
    }

    const wordAtPress = currentWord;
    setFeedback(result);

    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current);
    }

    feedbackTimerRef.current = window.setTimeout(() => {
      feedbackTimerRef.current = null;
      setFeedback(null);
      setHistory((prev) => [...prev, { word: wordAtPress, result }]);

      setQueueIndex((index) => {
        const nextIndex = index + 1;
        if (nextIndex >= queue.length) {
          setQueue(shuffle(allWords));
          return 0;
        }
        return nextIndex;
      });
    }, FEEDBACK_DELAY_MS);
  }

  // One tap = correct, a second tap within DOUBLE_TAP_MS = skip.
  function handleScreenTap() {
    if (settingsOpen || calibrating) {
      return;
    }

    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      markCurrent('skipped');
      return;
    }

    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      markCurrent('correct');
    }, DOUBLE_TAP_MS);
  }

  async function toggleTilt() {
    if (tiltEnabled) {
      setTiltEnabled(false);
      return;
    }

    setTiltError(null);
    const granted = await requestTiltPermission();
    if (granted) {
      setTiltEnabled(true);
    } else {
      setTiltError('Tilt permission was denied. Enable motion access for this site in Settings to use tilt controls.');
    }
  }

  const tiltStatus = useTiltControls(
    tiltEnabled && phase === 'playing' && !settingsOpen && !calibrating,
    tiltProfile,
    () => markCurrent('correct'),
    () => markCurrent('skipped')
  );

  const rawTilt = useRawTilt(calibrating);

  function startCalibration() {
    setCalibrationStep('neutral');
    setCalibrationBaseline(null);
    setCalibrationDown(null);
    setCalibrating(true);
  }

  function cancelCalibration() {
    setCalibrating(false);
  }

  function calibrationCaptureNeutral() {
    if (rawTilt === null) {
      return;
    }
    setCalibrationBaseline(rawTilt);
    setCalibrationStep('down');
  }

  function calibrationCaptureDown() {
    if (rawTilt === null || calibrationBaseline === null) {
      return;
    }
    setCalibrationDown(rawTilt - calibrationBaseline);
    setCalibrationStep('up');
  }

  function calibrationCaptureUp() {
    if (rawTilt === null || calibrationBaseline === null || calibrationDown === null) {
      return;
    }
    const upValue = rawTilt - calibrationBaseline;
    setTiltProfile({ down: calibrationDown, up: upValue });
    setTiltCalibrated(true);
    setCalibrating(false);
  }

  function renderCalibrationOverlay() {
    if (!calibrating) {
      return null;
    }

    const liveDiff = rawTilt !== null && calibrationBaseline !== null ? Math.round(rawTilt - calibrationBaseline) : null;

    return (
      <div className="calibration-overlay">
        <div className="calibration-card">
          <h2>Calibrate Tilt</h2>

          {calibrationStep === 'neutral' ? (
            <>
              <p>Hold the phone exactly how you will during play, then tap Set.</p>
              <button type="button" className="primary" onClick={calibrationCaptureNeutral}>
                Set Neutral
              </button>
            </>
          ) : calibrationStep === 'down' ? (
            <>
              <p>Now tilt into your CORRECT position and hold it, then tap Set.</p>
              {liveDiff !== null ? <div className="calibration-reading">{liveDiff}°</div> : null}
              <button type="button" className="primary" onClick={calibrationCaptureDown}>
                Set Correct
              </button>
            </>
          ) : (
            <>
              <p>Now tilt into your SKIP position and hold it, then tap Set.</p>
              {liveDiff !== null ? <div className="calibration-reading">{liveDiff}°</div> : null}
              <button type="button" className="primary" onClick={calibrationCaptureUp}>
                Set Skip
              </button>
            </>
          )}

          <button type="button" onClick={cancelCalibration}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  function endRoundEarly() {
    setSettingsOpen(false);
    setPhase('finished');
  }

  function exitToSetup() {
    setSettingsOpen(false);
    setCategory(null);
    setTopic(null);
    setPhase('setup');
  }

  const score = useMemo(() => history.filter((entry) => entry.result === 'correct').length, [history]);
  const skippedCount = history.length - score;

  if (phase === 'setup') {
    const topicNames = category ? Object.keys(CATEGORY_MAP[category] ?? {}) : [];

    return (
      <div className="app-shell setup-shell">
        <div className="setup-card menu-card">
          <h1>TJs Headbands</h1>

          {error ? <div className="banner error">{error}</div> : null}

          {!category ? (
            <>
              <p className="setup-subtitle">Choose a category.</p>
              {CATEGORY_NAMES.length ? (
                <div className="tile-grid">
                  {CATEGORY_NAMES.map((name) => (
                    <button key={name} type="button" className="tile" onClick={() => selectCategory(name)}>
                      {name}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="banner error">No categories found. Add some to src/data/topics.json.</div>
              )}
            </>
          ) : !topic ? (
            <>
              <div className="menu-breadcrumb">
                <button type="button" className="breadcrumb-back" onClick={backToCategories}>
                  ‹ Categories
                </button>
                <span>{category}</span>
              </div>
              <p className="setup-subtitle">Choose a topic.</p>
              {topicNames.length ? (
                <div className="tile-grid">
                  {topicNames.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className="tile"
                      onClick={() => startRound(category, name)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="banner error">No topics found in "{category}".</div>
              )}
            </>
          ) : null}

          <label className="timer-setting">
            Timer length (seconds)
            <input
              type="number"
              min={30}
              max={600}
              step={30}
              value={durationSeconds}
              onChange={(event) => setDurationSeconds(Math.max(30, Number(event.target.value) || DEFAULT_DURATION))}
            />
          </label>

          {isTiltSupported() ? (
            <div className="tilt-setting">
              <button type="button" className={`tilt-toggle${tiltEnabled ? ' active' : ''}`} onClick={() => void toggleTilt()}>
                {tiltEnabled ? 'Tilt Controls: On' : 'Tilt Controls: Off'}
              </button>
              <p className="tilt-hint">
                Tilt the phone down for correct, up to skip — works in portrait or landscape, and
                re-calibrates automatically when you rotate.
              </p>
              {tiltEnabled ? (
                <button type="button" className="invert-toggle" onClick={startCalibration}>
                  {tiltCalibrated ? 'Recalibrate tilt' : 'Calibrate tilt to your grip (recommended)'}
                </button>
              ) : null}
              {tiltError ? <div className="banner error">{tiltError}</div> : null}
            </div>
          ) : null}
        </div>

        {renderCalibrationOverlay()}
      </div>
    );
  }

  if (phase === 'countdown') {
    return (
      <div className="app-shell setup-shell">
        <div className="countdown-screen">
          <p className="setup-subtitle">{category} › {topic}</p>
          <div key={countdown} className="countdown-number">{countdown > 0 ? countdown : 'Go!'}</div>
          <p className="tilt-hint">Get the phone in position — round starts automatically.</p>
        </div>
      </div>
    );
  }

  if (phase === 'finished') {
    return (
      <div className="app-shell setup-shell">
        <div className="setup-card results-card">
          <h1>Round complete</h1>
          <p className="setup-subtitle">{category} › {topic}</p>

          <div className="score-row">
            <div className="score-pill correct">
              <strong>{score}</strong>
              <span>Correct</span>
            </div>
            <div className="score-pill skipped">
              <strong>{skippedCount}</strong>
              <span>Skipped</span>
            </div>
          </div>

          <ul className="history-list">
            {history.map((entry, index) => (
              <li key={`${entry.word}-${index}`} className={entry.result}>
                {entry.word}
              </li>
            ))}
          </ul>

          <div className="settings-actions">
            <button className="primary" onClick={() => category && topic && startRound(category, topic)}>
              Play again
            </button>
            <button onClick={backToTopics}>Change topic</button>
            <button onClick={exitToSetup}>New category</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="game-shell">
      <main
        className={`tap-surface${feedback ? ` ${feedback}` : ''}`}
        onPointerUp={handleScreenTap}
        aria-label="Tap for correct, double-tap to skip"
      >
        <div className="game-hud">
          <div className="timer-wrap">
            <span className="timer-label">Timer</span>
            <strong>{formatTime(timeLeft)}</strong>
          </div>
        </div>

        <div className="game-word">{currentWord || 'Loading...'}</div>

        <div className="game-footer">
          <div className="game-pills">
            <span className="topic-pill">{topic}</span>
            <span className="progress-pill">Score: {score}</span>
          </div>
          <p className="hint">
            {tiltEnabled
              ? tiltStatus === 'calibrating'
                ? 'Calibrating tilt — hold the phone steady against your forehead...'
                : 'Tilt down for correct · Tilt up to skip · or tap / double-tap'
              : 'Tap anywhere for correct · Double-tap to skip'}
          </p>
        </div>
      </main>

      <button
        type="button"
        className="settings-button game-settings"
        onPointerUp={(event) => event.stopPropagation()}
        onClick={() => setSettingsOpen((open) => !open)}
      >
        Settings
      </button>

      {settingsOpen ? (
        <aside className="settings-panel">
          <h2>Round settings</h2>
          <p className="setup-subtitle">{category} › {topic}</p>

          {isTiltSupported() ? (
            <div className="tilt-setting">
              <button type="button" className={`tilt-toggle${tiltEnabled ? ' active' : ''}`} onClick={() => void toggleTilt()}>
                {tiltEnabled ? 'Tilt Controls: On' : 'Tilt Controls: Off'}
              </button>
              {tiltEnabled ? (
                <button type="button" className="invert-toggle" onClick={startCalibration}>
                  {tiltCalibrated ? 'Recalibrate tilt' : 'Calibrate tilt to your grip (recommended)'}
                </button>
              ) : null}
              {tiltError ? <div className="banner error">{tiltError}</div> : null}
            </div>
          ) : null}

          <div className="settings-actions">
            <button onClick={endRoundEarly}>End round</button>
            <button onClick={exitToSetup}>Exit to menu</button>
            <button onClick={() => setSettingsOpen(false)}>Resume</button>
          </div>
        </aside>
      ) : null}

      {renderCalibrationOverlay()}
    </div>
  );
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export default App;
