import { useEffect, useMemo, useRef, useState } from 'react';
import topicsData from './data/topics.json';
import { isTiltSupported, requestTiltPermission, useTiltControls } from './useTiltControls';

const DEFAULT_DURATION = 180;
const CLICK_DELAY_MS = 220;
const CATEGORY_MAP: Record<string, Record<string, string[]>> = topicsData;
const CATEGORY_NAMES = Object.keys(CATEGORY_MAP);

type Phase = 'setup' | 'playing' | 'finished';

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
  const [tiltInverted, setTiltInverted] = useState(false);

  const [queue, setQueue] = useState<string[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [allWords, setAllWords] = useState<string[]>([]);

  const currentWord = queue[queueIndex] ?? '';
  const clickTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) {
        window.clearTimeout(clickTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (phase !== 'playing' || timeLeft <= 0) {
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
  }, [phase, timeLeft]);

  useEffect(() => {
    if (phase === 'playing' && timeLeft === 0) {
      setPhase('finished');
    }
  }, [phase, timeLeft]);

  useEffect(() => {
    if (phase !== 'playing') {
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
  }, [phase, queue, queueIndex]);

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
    setPhase('playing');
  }

  function markCurrent(result: 'correct' | 'skipped') {
    if (!currentWord) {
      return;
    }

    setHistory((prev) => [...prev, { word: currentWord, result }]);

    setQueueIndex((index) => {
      const nextIndex = index + 1;
      if (nextIndex >= queue.length) {
        setQueue(shuffle(allWords));
        return 0;
      }
      return nextIndex;
    });
  }

  function handleWordClick() {
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
    }
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      markCurrent('correct');
    }, CLICK_DELAY_MS);
  }

  function handleWordDoubleClick() {
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    markCurrent('skipped');
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
    tiltEnabled && phase === 'playing',
    tiltInverted,
    () => markCurrent('correct'),
    () => markCurrent('skipped')
  );

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
          <h1>AI Headbands</h1>

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
                <button type="button" className="invert-toggle" onClick={() => setTiltInverted((value) => !value)}>
                  {tiltInverted ? 'Direction flipped — tap to undo' : 'Feels backwards? Flip direction'}
                </button>
              ) : null}
              {tiltError ? <div className="banner error">{tiltError}</div> : null}
            </div>
          ) : null}
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
    <div className="app-shell">
      <header className="top-bar">
        <button className="settings-button" onClick={() => setSettingsOpen((open) => !open)}>
          Settings
        </button>

        <div className="timer-wrap">
          <span className="timer-label">Timer</span>
          <strong>{formatTime(timeLeft)}</strong>
        </div>
      </header>

      <main className="board-area">
        <div className="topic-row">
          <span className="topic-pill">{category} › {topic}</span>
          <span className="progress-pill">Score: {score}</span>
        </div>

        <button
          type="button"
          className="word-card tappable"
          onClick={handleWordClick}
          onDoubleClick={handleWordDoubleClick}
          disabled={!currentWord}
        >
          {currentWord || 'Loading...'}
        </button>

        <div className="controls">
          <button className="skip" onClick={() => markCurrent('skipped')} disabled={!currentWord}>
            Skip
          </button>
          <button className="primary" onClick={() => markCurrent('correct')} disabled={!currentWord}>
            Correct
          </button>
        </div>
        {tiltEnabled ? (
          <p className="hint">
            {tiltStatus === 'calibrating'
              ? 'Calibrating tilt — hold the phone steady against your forehead...'
              : 'Tilt down for correct · Tilt up to skip'}
          </p>
        ) : (
          <p className="hint">Tap the word (or press Space) for correct · Double-tap, Skip button, or ↓ to pass</p>
        )}
      </main>

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
                <button type="button" className="invert-toggle" onClick={() => setTiltInverted((value) => !value)}>
                  {tiltInverted ? 'Direction flipped — tap to undo' : 'Feels backwards? Flip direction'}
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
    </div>
  );
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export default App;
