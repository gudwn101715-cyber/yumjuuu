/** A short, hollow wooden-fish strike synthesized entirely in this browser. */
export function synthesizeMoktak(context, destination, when = context.currentTime, strength = 0.8) {
  const level = Math.max(0.1, Math.min(1, strength));
  const modes = [
    [430, 0.24, 0.21],
    [687, 0.2, 0.16],
    [1114, 0.11, 0.12],
    [1680, 0.065, 0.085],
    [2570, 0.025, 0.045],
  ];
  const voices = [];
  for (const [frequency, volume, decay] of modes) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, when);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.985, when + decay);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume * level, when + 0.0015);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + decay * 3);
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(when);
    oscillator.stop(when + decay * 3 + 0.02);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    voices.push(oscillator);
  }
  const attack = context.createBuffer(1, Math.ceil(context.sampleRate * 0.022), context.sampleRate);
  const samples = attack.getChannelData(0);
  for (let i = 0; i < samples.length; i++)
    samples[i] = (Math.random() * 2 - 1) * Math.exp(-i / (context.sampleRate * 0.003));
  const noise = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  noise.buffer = attack;
  filter.type = 'bandpass';
  filter.frequency.value = 1450;
  filter.Q.value = 0.6;
  gain.gain.value = 0.16 * level;
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  noise.start(when);
  noise.onended = () => {
    noise.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
  voices.push(noise);
  return voices;
}

export function createMoktakAudio() {
  let context = null;
  let output = null;
  let muted = false;
  let disposed = false;
  let lastStrike = -Infinity;
  async function prime() {
    if (disposed) return false;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;
    try {
      if (!context) {
        context = new AudioContext();
        output = context.createGain();
        output.gain.value = muted ? 0 : 0.65;
        output.connect(context.destination);
      }
      if (context.state === 'suspended') await context.resume();
      return context.state === 'running';
    } catch {
      return false;
    }
  }
  return {
    prime,
    async strike() {
      if (muted || disposed || !(await prime())) return false;
      const now = context.currentTime;
      if (now - lastStrike < 0.11) return false;
      lastStrike = now;
      synthesizeMoktak(context, output, now, 0.8 + Math.random() * 0.12);
      return true;
    },
    setMuted(value) {
      muted = Boolean(value);
      if (output && context?.state !== 'closed')
        output.gain.setTargetAtTime(muted ? 0 : 0.65, context.currentTime, 0.015);
    },
    dispose() {
      disposed = true;
      if (context && context.state !== 'closed') context.close().catch(() => {});
      context = output = null;
    },
  };
}
