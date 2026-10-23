// Short, locally synthesized effects: no downloads or decode delay on impact.
export function synthesizeBreak(type, sampleRate = 44100) {
  const tree = type === 'tree', cactus = type === 'cactus', sign = type === 'sign';
  const duration = tree ? .8 : cactus ? .38 : sign ? .9 : .6;
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  const knocks = [0.055, .12, .21, .32];
  let seed = 4919, low = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    low += (noise - low) * (cactus ? .055 : tree ? .16 : .45);
    const attack = Math.min(1, t / .002);
    const crack = Math.exp(-t * (tree ? 24 : cactus ? 35 : 45));
    let rattle = 0;
    for (let n = 0; n < knocks.length; n++) if (t >= knocks[n]) rattle += Math.exp(-(t - knocks[n]) * 65) / (n + 2);
    const texture = tree ? low * 1.8 + noise * .25 : cactus ? low * 2.5 : noise - low * .6;
    // A sign rings like struck sheet metal.
    const tone = sign ? (Math.sin(2 * Math.PI * 610 * t) + Math.sin(2 * Math.PI * 947 * t) * .6) * Math.exp(-t * 6) * 1.6 : Math.sin(2 * Math.PI * (tree ? 135 : cactus ? 85 : type === 'boulder' ? 100 : 280) * t) * Math.exp(-t * 22);
    const tail = Math.min(1, (duration - t) / .035);
    samples[i] = Math.tanh((texture * (crack + rattle * (tree ? 1.4 : .7)) + tone * .35) * 1.3) * attack * tail;
  }
  return samples;
}

// `send` (optional) is an echo input; `pan` places the break left or right.
export function createBreakAudio(context, output, capacity = 8, send = null) {
  const buffers = new Map(), voices = new Set();
  let played = 0;
  for (const type of ['tree', 'cactus', 'rock', 'boulder', 'sign']) {
    const data = synthesizeBreak(type, context.sampleRate), buffer = context.createBuffer(1, data.length, context.sampleRate);
    buffer.copyToChannel(data, 0); buffers.set(type, buffer);
  }
  function play(type, speed, pan = 0) {
    if (!buffers.has(type)) return;
    if (voices.size >= capacity) voices.values().next().value.stop();
    const source = context.createBufferSource(), gain = context.createGain(), panner = context.createStereoPanner(), wet = context.createGain();
    source.buffer = buffers.get(type); gain.gain.value = Math.min(.2, .08 + speed * .0015);
    panner.pan.value = Math.min(1, Math.max(-1, pan)); wet.gain.value = .3;
    source.connect(gain).connect(panner).connect(output);
    if (send) panner.connect(wet).connect(send);
    const release = () => { source.disconnect(); gain.disconnect(); panner.disconnect(); wet.disconnect(); voices.delete(voice); };
    const voice = { stop() { source.stop(); release(); } };
    source.onended = release;
    voices.add(voice); source.start(); played++;
  }
  return { play, clear() { for (const voice of [...voices]) voice.stop(); }, get played() { return played; }, get active() { return voices.size; } };
}
