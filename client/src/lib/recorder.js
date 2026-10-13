// Minimal MediaRecorder wrapper for short dictation clips, used only when
// SARVAM_API_KEY is configured server-side (checked via careApi.config()).
// Falls back gracefully: if the mic or MediaRecorder isn't available, callers
// should just leave the doctor typing directly.

export function isRecordingSupported() {
  return typeof window !== 'undefined' && 'MediaRecorder' in window && navigator.mediaDevices?.getUserMedia;
}

export async function recordClip({ maxMs = 30000 } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);

  const stopped = new Promise((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start();
  const timeoutId = setTimeout(() => recorder.state === 'recording' && recorder.stop(), maxMs);

  return {
    stop: () => {
      clearTimeout(timeoutId);
      if (recorder.state === 'recording') recorder.stop();
    },
    result: stopped.then(() => {
      stream.getTracks().forEach((t) => t.stop());
      // Chrome records webm, Safari mp4 — keep whatever the browser produced.
      return new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    }),
  };
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
