// Hands-free dictation for a whole consultation: one tap starts, one tap stops.
//
// The mic stays open; audio is cut into clips at natural pauses (and at 25 s,
// under Sarvam's 30 s REST limit). Each clip is handed to onClip the moment it
// ends, so transcription runs while the doctor keeps talking. Clips with no
// speech in them are dropped, so silence never costs Sarvam credits.
//
// Speech detection is a simple loudness gate against a noise floor measured
// when the mic opens — good enough for a quiet consultation room, not a VAD
// model. Each clip is its own MediaRecorder session, so every blob is a
// complete, independently decodable file (webm in Chrome, mp4 in Safari).

const TICK_MS = 50;

export async function startContinuousDictation({
  onClip,
  onLevel,
  maxClipMs = 25000,
  pauseMs = 700,
  minSpeechMs = 350,
} = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  const openedAt = performance.now();
  let noiseFloor = null;
  let lastSpeechAt = 0;
  let stopped = false;
  let finalClipDone = null;

  function startClip() {
    const recorder = new MediaRecorder(stream);
    const clip = { recorder, parts: [], speechMs: 0, startedAt: performance.now() };
    recorder.ondataavailable = (e) => e.data.size > 0 && clip.parts.push(e.data);
    recorder.start();
    return clip;
  }

  function finishClip(clip) {
    return new Promise((resolve) => {
      clip.recorder.onstop = () => {
        if (clip.speechMs >= minSpeechMs) {
          onClip(new Blob(clip.parts, { type: clip.recorder.mimeType || 'audio/webm' }));
        }
        resolve();
      };
      if (clip.recorder.state !== 'inactive') clip.recorder.stop();
      else resolve();
    });
  }

  let current = startClip();

  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const v of samples) sum += v * v;
    const rms = Math.sqrt(sum / samples.length);
    const now = performance.now();

    // Noise floor: the quietest level in the first 400 ms, then it drifts
    // slowly with quiet frames so a fan or AC doesn't count as speech.
    if (now - openedAt < 400) noiseFloor = noiseFloor == null ? rms : Math.min(noiseFloor, rms);
    const threshold = Math.max(0.01, (noiseFloor ?? 0.004) * 3);
    const speaking = rms > threshold;
    if (speaking) {
      current.speechMs += TICK_MS;
      lastSpeechAt = now;
    } else if (noiseFloor != null && now - openedAt >= 400) {
      noiseFloor = noiseFloor * 0.99 + rms * 0.01;
    }
    onLevel?.(Math.min(1, rms / (threshold * 4)), speaking);

    const clipAge = now - current.startedAt;
    const paused = current.speechMs >= minSpeechMs && now - lastSpeechAt >= pauseMs;
    if (paused || clipAge >= maxClipMs) {
      const done = current;
      current = startClip();
      finishClip(done);
    }
  }, TICK_MS);

  return {
    /** Stop listening; resolves once the last clip has been handed to onClip. */
    stop() {
      if (stopped) return finalClipDone;
      stopped = true;
      clearInterval(timer);
      finalClipDone = finishClip(current).then(() => {
        stream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => {});
      });
      return finalClipDone;
    },
  };
}
