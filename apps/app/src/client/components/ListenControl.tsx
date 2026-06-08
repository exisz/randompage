import { useEffect, useRef, useState } from 'react';

type ListenState = 'idle' | 'speaking' | 'paused';

interface ListenControlProps {
  text: string;
  title?: string;
  compact?: boolean;
  className?: string;
}

function speechAvailable() {
  return typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && 'SpeechSynthesisUtterance' in window;
}

export default function ListenControl({ text, title = 'passage', compact = false, className = '' }: ListenControlProps) {
  const [state, setState] = useState<ListenState>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const textToRead = text.replace(/\s+/g, ' ').trim();

  useEffect(() => () => {
    if (utteranceRef.current && speechAvailable()) {
      window.speechSynthesis.cancel();
    }
  }, []);

  if (!textToRead) return null;

  const unsupported = !speechAvailable();

  const stop = () => {
    if (!speechAvailable()) return;
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setState('idle');
  };

  const start = () => {
    if (!speechAvailable()) {
      setNotice('Listen is not available in this browser. You can still read the passage normally.');
      return;
    }

    if (state === 'paused') {
      window.speechSynthesis.resume();
      setState('speaking');
      return;
    }

    window.speechSynthesis.cancel();
    const voices = window.speechSynthesis.getVoices();
    const utterance = new SpeechSynthesisUtterance(textToRead);
    utterance.rate = 0.92;
    utterance.pitch = 1;
    utterance.lang = /[\u3400-\u9fff]/.test(textToRead) ? 'zh-CN' : 'en-US';
    const preferredVoice = voices.find((voice) => voice.lang?.toLowerCase().startsWith(utterance.lang.toLowerCase().slice(0, 2)));
    if (preferredVoice) utterance.voice = preferredVoice;

    utterance.onend = () => {
      utteranceRef.current = null;
      setState('idle');
    };
    utterance.onerror = () => {
      utteranceRef.current = null;
      setState('idle');
      setNotice('Could not start speech on this device. Reading mode is still available.');
    };

    utteranceRef.current = utterance;
    setState('speaking');
    setNotice(voices.length === 0 ? 'Using your browser default voice. If you hear nothing, this device has no speech voice installed.' : null);
    window.speechSynthesis.speak(utterance);
  };

  const pause = () => {
    if (!speechAvailable()) return;
    window.speechSynthesis.pause();
    setState('paused');
  };

  const primaryLabel = state === 'speaking' ? 'Pause' : state === 'paused' ? 'Resume' : 'Listen';
  const primaryAction = state === 'speaking' ? pause : start;

  return (
    <div className={`space-y-1 ${className}`}>
      <div className={`flex ${compact ? 'flex-row flex-wrap items-center gap-2' : 'flex-col gap-2 sm:flex-row sm:items-center'}`}>
        <button
          type="button"
          className={`${compact ? 'btn btn-outline btn-xs rounded-full' : 'btn btn-outline rounded-2xl'} ${state !== 'idle' ? 'btn-secondary' : ''}`}
          onClick={primaryAction}
          disabled={unsupported}
          aria-label={`${primaryLabel} ${title}`}
        >
          {state === 'speaking' ? '⏸ Pause' : state === 'paused' ? '▶ Resume' : '🔊 Listen'}
        </button>
        {state !== 'idle' && (
          <button
            type="button"
            className={compact ? 'btn btn-ghost btn-xs rounded-full' : 'btn btn-ghost rounded-2xl'}
            onClick={stop}
            aria-label={`Stop listening to ${title}`}
          >
            Stop
          </button>
        )}
      </div>
      {(unsupported || notice) && (
        <p className="text-xs leading-relaxed opacity-60" role="status">
          {unsupported ? 'Listen is not available in this browser. You can still read the passage normally.' : notice}
        </p>
      )}
    </div>
  );
}
