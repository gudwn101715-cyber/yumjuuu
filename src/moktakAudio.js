/** A licensed wooden-fish recording, played only in the striking player's browser. */
export const MOKTAK_AUDIO_URL = '/audio/moktak-hit.wav';

/** Play the original recorded waveform, with short edge fades to avoid clicks. */
export function playMoktakBuffer(
  context,
  destination,
  buffer,
  when = context.currentTime,
  strength = 0.85,
  playbackRate = 1,
) {
  if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration <= 0)
    throw new Error('목탁 녹음 파일을 읽지 못했어요.');
  const source = context.createBufferSource();
  const gain = context.createGain();
  const rate = Math.max(0.98, Math.min(1.02, playbackRate));
  const level = Math.max(0.05, Math.min(1, strength));
  const start = Math.max(context.currentTime, when);
  const duration = buffer.duration / rate;
  const fadeIn = Math.min(0.0015, duration * 0.04);
  const fadeOut = Math.min(0.012, duration * 0.1);
  source.buffer = buffer;
  source.playbackRate.setValueAtTime(rate, start);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + fadeIn);
  gain.gain.setValueAtTime(level, start + duration - fadeOut);
  gain.gain.linearRampToValueAtTime(0, start + duration);
  source.connect(gain);
  gain.connect(destination);
  source.addEventListener(
    'ended',
    () => {
      source.disconnect();
      gain.disconnect();
    },
    { once: true },
  );
  source.start(start);
  return source;
}

export function createMoktakAudio({ onError } = {}) {
  let context = null;
  let output = null;
  let buffer = null;
  let loading = null;
  let request = null;
  let muted = false;
  let disposed = false;
  let lastStrike = -Infinity;
  let lastFailureAt = -Infinity;
  let lastError = null;
  let notifiedError = false;
  const voices = new Set();

  async function prime() {
    if (disposed) return false;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      lastError = '이 브라우저에서는 목탁 소리를 재생할 수 없어요.';
      return false;
    }
    try {
      if (!context) {
        context = new AudioContext();
        output = context.createGain();
        output.gain.value = muted ? 0 : 0.65;
        output.connect(context.destination);
      }
      if (!buffer && !loading && performance.now() - lastFailureAt < 1200) return false;
      // Resume synchronously from the user gesture before waiting on the file.
      const resuming = context.state === 'suspended' ? context.resume() : Promise.resolve();
      if (!buffer && !loading) {
        request = new AbortController();
        const decodingContext = context;
        loading = fetch(MOKTAK_AUDIO_URL, { signal: request.signal })
          .then((response) => {
            if (!response.ok) throw new Error('목탁 녹음 파일을 불러오지 못했어요.');
            return response.arrayBuffer();
          })
          .then((data) => decodingContext.decodeAudioData(data))
          .then((decoded) => {
            if (!disposed) buffer = decoded;
          });
      }
      await Promise.all([resuming, loading]);
      if (disposed) return false;
      lastError = null;
      notifiedError = false;
      return Boolean(buffer && context.state === 'running');
    } catch {
      if (!disposed) {
        lastError = '목탁 녹음 소리를 불러오지 못했어요. 잠시 후 다시 눌러 주세요.';
        lastFailureAt = performance.now();
      }
      return false;
    } finally {
      loading = null;
    }
  }

  return {
    prime,
    async strike() {
      if (muted || disposed) return false;
      if (!(await prime())) {
        if (!disposed && !notifiedError && lastError) {
          notifiedError = true;
          onError?.(lastError);
        }
        return false;
      }
      const now = context.currentTime;
      if (now - lastStrike < 0.11) return false;
      lastStrike = now;
      const voice = playMoktakBuffer(
        context,
        output,
        buffer,
        now,
        0.82 + Math.random() * 0.08,
        0.994 + Math.random() * 0.012,
      );
      voices.add(voice);
      voice.addEventListener('ended', () => voices.delete(voice), { once: true });
      return true;
    },
    setMuted(value) {
      muted = Boolean(value);
      if (output && context?.state !== 'closed')
        output.gain.setTargetAtTime(muted ? 0 : 0.65, context.currentTime, 0.015);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      request?.abort();
      for (const voice of voices) {
        try {
          voice.stop();
        } catch {
          /* The recording may have already ended. */
        }
      }
      voices.clear();
      output?.disconnect();
      if (context && context.state !== 'closed') context.close().catch(() => {});
      context = output = buffer = null;
    },
  };
}
