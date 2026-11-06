/** Licensed Buddhist audio recording; playback starts only after the player's click. */
export const AMBIENCE_AUDIO_URL = '/audio/buddhist-chant.mp3';

export function createAmbience({ onError } = {}) {
  if (typeof Audio === 'undefined') return null;
  const recording = new Audio(AMBIENCE_AUDIO_URL);
  recording.preload = 'none';
  recording.loop = true;
  recording.volume = 0.18;
  let stopped = false;
  let reported = false;

  function reportFailure() {
    if (stopped || reported) return;
    reported = true;
    onError?.('배경음을 재생하지 못했어요. 파일 연결과 브라우저의 소리 권한을 확인해 주세요.');
  }
  recording.addEventListener('error', reportFailure);

  return {
    async play() {
      if (stopped) return false;
      try {
        await recording.play();
        return !stopped && !recording.paused;
      } catch {
        reportFailure();
        return false;
      }
    },
    get playing() {
      return !stopped && !recording.paused && !recording.ended;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      recording.removeEventListener('error', reportFailure);
      recording.pause();
      recording.removeAttribute('src');
      recording.load();
    },
  };
}
