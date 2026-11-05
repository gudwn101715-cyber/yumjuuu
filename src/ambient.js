// User-initiated, locally generated ambience: no media downloads or autoplay.
export function createAmbience() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0.035;
  master.connect(ctx.destination);
  const oscillators = [];
  [146.83, 220, 293.66].forEach((frequency, index) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.value = 0.23 / (index + 1);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start();
    oscillators.push(oscillator);
  });
  function bell() {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = [440, 587.33, 659.25, 880][Math.floor(Math.random() * 4)];
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 5);
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    osc.stop(ctx.currentTime + 5);
  }
  bell();
  const interval = setInterval(bell, 8500);
  ctx.resume();
  return {
    stop() {
      clearInterval(interval);
      oscillators.forEach((o) => o.stop());
      ctx.close();
    },
  };
}
