import { useRef, useState } from 'react';
import { isRecordingSupported, recordClip, blobToBase64 } from '../lib/recorder';
import { Mic, Square } from 'lucide-react';
import { careApi } from '../lib/careApi';

/** Small mic button that records a short clip, sends it to Sarvam STT, and
 * appends the transcript to the caller's text via onTranscript. Hidden
 * entirely when SARVAM_API_KEY isn't configured server-side. */
export default function MicButton({ language = 'hi', onTranscript, sarvamConfigured, disabled }) {
  const [state, setState] = useState('idle'); // idle | starting | recording | transcribing | error
  const activeRef = useRef(null);

  if (!sarvamConfigured || !isRecordingSupported()) return null;

  async function toggle() {
    if (state === 'recording') {
      // Null until the mic permission prompt resolves; a click before then is ignored.
      activeRef.current?.stop();
      return;
    }
    if (state === 'starting') return;
    activeRef.current = null;
    // "Starting…" until the mic is actually live. Showing "● Stop" earlier made
    // doctors start talking too soon, and the first word (e.g. "Dolo") was lost.
    setState('starting');
    try {
      const { stop, result } = await recordClip({ maxMs: 30000 });
      activeRef.current = { stop };
      setState('recording');
      const blob = await result;
      activeRef.current = null;
      setState('transcribing');
      const audioBase64 = await blobToBase64(blob);
      const res = await careApi.transcribe({ audioBase64, mimeType: blob.type || 'audio/webm', language });
      if (res.transcript) onTranscript(res.transcript);
      setState(res.transcript ? 'idle' : 'error');
    } catch {
      setState('error');
    }
  }

  return (
    <button
      type="button"
      className={`mic-btn ${state === 'recording' ? 'mic-btn--active' : ''}`}
      onClick={toggle}
      disabled={disabled || state === 'transcribing' || state === 'starting'}
      title={state === 'error' ? 'Transcription failed. Try again, or type instead.' : 'Dictate into this box'}
    >
      {state === 'recording' ? <><Square size={11} /> Stop</> : <><Mic size={12} /> {{ starting: 'Starting…', transcribing: 'Typing…', error: 'Retry' }[state] || 'Speak'}</>}
    </button>
  );
}
