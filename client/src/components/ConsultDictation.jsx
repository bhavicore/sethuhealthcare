import { useEffect, useRef, useState } from 'react';
import { isRecordingSupported, blobToBase64 } from '../lib/recorder';
import { startContinuousDictation } from '../lib/dictation';
import { Mic, Square } from 'lucide-react';
import { careApi } from '../lib/careApi';

const METHOD_LABEL = {
  'section-words': 'Sorted by the section words you said.',
  'gemini-verified': 'Sorted automatically using your exact words. Please check each box.',
  rules: null, // the server's note explains the fallback
};

/**
 * One tap to start, one tap to finish, for the whole consultation. Clips are
 * transcribed while the doctor talks (shown live); on finish the full text is
 * sorted into complaint / diagnosis / medicines / advice (section words if
 * spoken, else verified Gemini sorting) and handed to onDone, which fills the
 * form and runs Draft.
 */
export default function ConsultDictation({ language, patientId, sarvamConfigured, onDone, disabled }) {
  const [state, setState] = useState('idle'); // idle | starting | listening | finishing | error
  const [pieces, setPieces] = useState([]); // [{ id, text, pending, failed }]
  const [level, setLevel] = useState({ value: 0, speaking: false });
  const [error, setError] = useState(null);
  const [sortInfo, setSortInfo] = useState(null); // { text, unplaced }
  const sessionRef = useRef(null);
  const pendingRef = useRef([]);
  const textsRef = useRef(new Map());

  useEffect(() => () => sessionRef.current?.stop(), []);

  if (!sarvamConfigured || !isRecordingSupported()) return null;

  // Three outcomes per clip: words (shown), no words — a cough or background
  // noise that crossed the loudness gate (quietly dropped), or a real failure
  // (shown with the actual reason, so "server down" isn't mistaken for bad audio).
  function transcribeClip(blob, id) {
    const settle = (patch) => setPieces((ps) => ps.map((p) => (p.id === id ? { ...p, pending: false, ...patch } : p)));
    const job = blobToBase64(blob)
      .then((audioBase64) => careApi.transcribe({ audioBase64, mimeType: blob.type || 'audio/webm', language }))
      .then((res) => {
        const text = (res.transcript || '').trim();
        textsRef.current.set(id, text);
        if (text) settle({ text });
        else if (res.note) settle({ failed: true, reason: res.note });
        else settle({ empty: true });
      })
      .catch((err) => {
        textsRef.current.set(id, '');
        const offline = err instanceof TypeError; // fetch() throws TypeError when the server can't be reached
        settle({ failed: true, reason: offline ? "Can't reach the Sethu server. Is it running?" : err.message });
      });
    pendingRef.current.push(job);
  }

  async function start() {
    setError(null);
    setSortInfo(null);
    setPieces([]);
    pendingRef.current = [];
    textsRef.current = new Map();
    setState('starting');
    let nextId = 0;
    try {
      sessionRef.current = await startContinuousDictation({
        onClip: (blob) => {
          const id = nextId++;
          setPieces((ps) => [...ps, { id, text: '', pending: true, failed: false }]);
          transcribeClip(blob, id);
        },
        onLevel: (value, speaking) => setLevel({ value, speaking }),
      });
      setState('listening');
    } catch (err) {
      setError(`Microphone unavailable: ${err.message || err}`);
      setState('error');
    }
  }

  async function finish() {
    setState('finishing');
    await sessionRef.current?.stop();
    sessionRef.current = null;
    await Promise.all(pendingRef.current);
    const ids = [...textsRef.current.keys()].sort((a, b) => a - b);
    const fullText = ids.map((id) => textsRef.current.get(id)).filter(Boolean).join('\n');
    if (!fullText.trim()) {
      setError("No speech was heard. Try again closer to the microphone, or type instead.");
      setState('error');
      return;
    }
    try {
      setState('sorting');
      const { fields, method, note, unplaced } = await careApi.routeDictation(fullText, patientId);
      setSortInfo({ text: note || METHOD_LABEL[method] || null, unplaced });
      setState('idle');
      onDone(fields, fullText);
    } catch (err) {
      setError(err.message);
      setState('error');
    }
  }

  const listening = state === 'listening';
  return (
    <div className="consult-dictation">
      <div className="consult-dictation__row">
        <button
          type="button"
          className={`btn ${listening ? 'btn--danger' : 'btn--primary'} consult-dictation__btn`}
          onClick={listening ? finish : start}
          disabled={disabled || ['starting', 'finishing', 'sorting'].includes(state)}
        >
          {listening ? <Square size={14} /> : <Mic size={16} />}
          {{ starting: 'Starting microphone…', listening: 'Stop Dictation', finishing: 'Transcribing…', sorting: 'Filling the form…' }[state] || 'Dictate Consultation'}
        </button>
        {listening && (
          <div className="consult-dictation__meter" aria-label="Mic level">
            <div
              className={`consult-dictation__level ${level.speaking ? 'consult-dictation__level--on' : ''}`}
              style={{ width: `${Math.round(level.value * 100)}%` }}
            />
          </div>
        )}
      </div>
      <p className="muted small" style={{ margin: '0.5rem 0 0' }}>
        {listening
          ? 'Listening. Speak normally and pause briefly between medicines.'
          : 'Speak the whole visit; the form fills itself. Saying "diagnosis", "medicines" or "advice" makes it exact.'}
      </p>
      {sortInfo?.text && <p className="muted small" style={{ margin: '0.5rem 0 0' }}>{sortInfo.text}</p>}
      {sortInfo?.unplaced && (
        <p className="form-error small" style={{ margin: '0.5rem 0 0' }}>
          Not placed in any box. Check if it matters: “{sortInfo.unplaced}”
        </p>
      )}
      {pieces.some((p) => !p.empty) && (
        <ol className="consult-dictation__live small">
          {pieces.filter((p) => !p.empty).map((p) => (
            <li key={p.id} className={p.failed ? 'form-error' : p.pending ? 'muted' : ''}>
              {p.pending ? 'Transcribing…' : p.failed ? `This part was not transcribed: ${p.reason}` : p.text}
            </li>
          ))}
        </ol>
      )}
      {error && <p className="form-error small">{error}</p>}
    </div>
  );
}
