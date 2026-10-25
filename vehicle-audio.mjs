// Vehicle sound, all synthesized: no downloads or decoding. A handful of
// continuous voices (engine, propeller, wind, tyres, skids, water, transform
// motors) follow the vehicle every frame, and short one-shots (thumps,
// splashes, scrapes, strikes, exhaust pops) are rendered once at startup.
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Upper speed (m/s) of each gear. Revs scale with speed inside a gear, so they
// climb, drop on the upshift and climb again instead of rising like a siren.
export const GEARS = [10, 20, 33, 48, 65, 92];
export function shiftGear(gear, speed) {
  const v = Math.abs(speed);
  while (gear < GEARS.length - 1 && v > GEARS[gear]) gear++;
  while (gear > 0 && v < GEARS[gear - 1] * .85) gear--;
  return gear;
}
export function engineRpm(gear, speed, throttle, grounded) {
  // A big, low-revving V8: about 700 rpm idle and a 4,800 rpm redline.
  const turning = 700 + 4100 * Math.abs(speed) / GEARS[gear];
  // Wheels off the ground spin freely, so the engine revs up with throttle.
  return clamp(grounded ? turning + Math.max(0, throttle) * 200 : Math.max(turning, 1100 + Math.max(0, throttle) * 3300), 650, 5000);
}

// The engine is a loop of individual exhaust pulses rather than oscillators:
// a V8's eight firings per two revolutions, each noticeably stronger or weaker
// and a touch early or late, as a real engine's are. Playing the loop faster
// raises the revs. The pulses carry no resonance of their own (a pulse train
// through one resonance is how a voice works, and sounds like one); the
// exhaust's character comes from a convolution applied live, so it stays put
// at any pitch. Recorded at ENGINE_BASE_RPM.
export const ENGINE_BASE_RPM = 1200;
export function synthesizeEngine(sampleRate = 44100, cycles = 40) {
  const cycle = 120 / ENGINE_BASE_RPM, length = Math.round(cycle * cycles * sampleRate), samples = new Float32Array(length);
  const bank = [1, .74, .92, .66, .97, .8, .88, .7]; // cross-plane firing: the two banks pulse unevenly
  let seed = 8080;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const span = Math.round(.012 * sampleRate);
  for (let c = 0; c < cycles; c++) for (let k = 0; k < 8; k++) {
    const start = ((c * 8 + k) / 8 * cycle + (random() - .5) * .0014) * sampleRate;
    const amp = bank[k] * (.65 + random() * .7) * (random() < .05 ? .5 : 1), decay = .0012 + random() * .0012;
    for (let j = 0; j < span; j++) {
      const u = j / sampleRate, i = (Math.round(start) + j) % length;
      samples[i] += amp * ((Math.exp(-u / decay) - Math.exp(-u / .0005)) * 1.6 + (random() * 2 - 1) * Math.exp(-u / .0015) * .08);
    }
  }
  let mean = 0, peak = 0;
  for (const x of samples) mean += x / length;
  for (let i = 0; i < length; i++) { samples[i] -= mean; peak = Math.max(peak, Math.abs(samples[i])); }
  for (let i = 0; i < length; i++) samples[i] *= .9 / peak;
  return samples;
}
// Headers and muffler as an impulse response: the direct pulse, a dense,
// darkening noise tail (many overlapping resonances, so no single vowel-like
// one) and a pipe echo a few milliseconds later.
export function exhaustResponse(sampleRate = 44100, seed = 1) {
  const samples = new Float32Array(Math.round(.045 * sampleRate));
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2147483648 - 1;
  let low = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    low += (random() - low) * (.08 + .3 * Math.exp(-t / .004));
    samples[i] = low * 2.2 * (Math.exp(-t / .007) + .5 * Math.exp(-Math.abs(t - .0062) / .0012));
  }
  samples[0] += 1; samples[1] += .6;
  return samples;
}

export function synthesizeEffect(type, sampleRate = 44100) {
  const duration = { thump: .45, splash: 1.15, scrape: .75, clang: .6, pop: .09 }[type];
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  let seed = { thump: 101, splash: 202, scrape: 303, clang: 404, pop: 505 }[type], low = 0, low2 = 0, grit = 0;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2147483648 - 1;
  const drops = Array.from({ length: 9 }, (_, i) => [.14 + i * .085 + Math.abs(random()) * .05, 900 + Math.abs(random()) * 1300]);
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate, noise = random(), tail = Math.min(1, (duration - t) / .03);
    let s = 0;
    if (type === 'thump') {
      // A falling body thud, a dull crunch and a short panel rattle.
      low += (noise - low) * .08;
      const sweep = 2 * Math.PI * (45 * t + 45 * (1 - Math.exp(-t * 14)) / 14);
      s = Math.sin(sweep * 2) * Math.exp(-t * 9) * .9 + low * 2.2 * Math.exp(-t * 28) + noise * .12 * Math.exp(-t * 18) * (1 + Math.sin(t * 190));
    } else if (type === 'splash') {
      // A bright crash darkening into hiss, then droplets falling back.
      const k = .5 * Math.exp(-t * 3.5) + .03;
      low += (noise - low) * k; low2 += (low - low2) * .3;
      s = (low2 * 1.6) * (Math.min(1, t / .006)) * (Math.exp(-t * 3.4) * .9 + Math.exp(-t * 14) * .6);
      for (const [at, f] of drops) if (t > at && t < at + .03) s += Math.sin(2 * Math.PI * (f + (t - at) * 9000) * (t - at)) * Math.exp(-(t - at) * 140) * .22;
    } else if (type === 'scrape') {
      // Gritty, uneven grinding.
      low += (noise - low) * .25; grit += (Math.abs(random()) - grit) * .004;
      s = (noise - low) * (.25 + grit * 2.2) * Math.min(1, t / .015) * Math.exp(-t * 2.6);
    } else if (type === 'clang') {
      // A hollow metal knock: inharmonic partials over a click.
      for (const [f, d, a] of [[176, 7, .5], [431, 10, .35], [699, 14, .25], [1043, 20, .15]]) s += Math.sin(2 * Math.PI * f * t) * Math.exp(-t * d) * a;
      s += noise * Math.exp(-t * 90) * .6;
    } else {
      // Exhaust pop on a lifted throttle.
      low += (noise - low) * .2;
      s = (low * 2.5 + Math.sin(2 * Math.PI * 70 * t) * .6) * Math.exp(-t * 55);
    }
    samples[i] = Math.tanh(s * 1.2) * tail;
  }
  return samples;
}

export function createVehicleAudio(context, output, capacity = 10) {
  const now = () => context.currentTime;
  const set = (param, value, time = .08) => param.setTargetAtTime(value, now(), time);
  const gainNode = (value = 0) => { const g = context.createGain(); g.gain.value = value; return g; };
  const filter = (type, frequency, Q = .7) => { const f = context.createBiquadFilter(); f.type = type; f.frequency.value = frequency; f.Q.value = Q; return f; };
  const osc = (type, frequency) => { const o = context.createOscillator(); o.type = type; o.frequency.value = frequency; o.start(); return o; };
  const noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  { const data = noiseBuffer.getChannelData(0); let seed = 99; for (let i = 0; i < data.length; i++) data[i] = (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2147483648 - 1; }
  const noise = offset => { const n = context.createBufferSource(); n.buffer = noiseBuffer; n.loop = true; n.start(0, offset); return n; };

  // A short open-air echo for one-shots.
  const echo = context.createDelay(1), feedback = gainNode(.26), echoTone = filter('lowpass', 2000), echoOut = gainNode(.55);
  echo.delayTime.value = .21; echo.connect(echoTone).connect(feedback).connect(echo); echoTone.connect(echoOut).connect(output);

  // Engine: the pulse loop through a light drive, the exhaust response, a
  // chesty low shelf and a load-dependent lowpass (it barks under power and
  // goes soft on the overrun).
  const engineBus = gainNode(1); engineBus.connect(output);
  const engineGain = gainNode(0), engineTone = filter('lowpass', 900, .5), drive = context.createWaveShaper();
  drive.curve = Float32Array.from({ length: 256 }, (_, i) => Math.tanh((i / 127.5 - 1) * 1.4));
  drive.oversample = '4x'; // distortion harmonics past Nyquist would fold back as fizz
  const body = filter('lowshelf', 140), exhaust = context.createConvolver();
  body.gain.value = 5;
  const response = context.createBuffer(2, Math.round(.045 * context.sampleRate), context.sampleRate);
  response.copyToChannel(exhaustResponse(context.sampleRate, 11), 0); response.copyToChannel(exhaustResponse(context.sampleRate, 23), 1);
  exhaust.buffer = response; // normalized, so a makeup gain follows it
  const pulses = synthesizeEngine(context.sampleRate);
  const engineLoop = context.createBuffer(1, pulses.length, context.sampleRate); engineLoop.copyToChannel(pulses, 0);
  const engine = context.createBufferSource(); engine.buffer = engineLoop; engine.loop = true; engine.start();
  // Two lowpasses in series roll off steeply, keeping the pulse edges from
  // turning into hiss.
  const engineTone2 = filter('lowpass', 900, .5);
  engine.connect(drive).connect(exhaust).connect(gainNode(9)).connect(body).connect(engineTone).connect(engineTone2).connect(engineGain).connect(engineBus);

  // Propeller: a soft whoosh chopped at the blade-pass rate, over a low thrum.
  const propAir = filter('lowpass', 600, .5), propGain = gainNode(0), propChop = osc('sine', 120), propDepth = gainNode(0);
  const thrum = osc('sine', 120), thrumGain = gainNode(0);
  noise(1.9).connect(propAir).connect(propGain).connect(engineBus); propChop.connect(propDepth).connect(propGain.gain);
  thrum.connect(thrumGain).connect(engineBus);

  // Wind rush, gusting slowly.
  const windTone = filter('lowpass', 300, .5), windGain = gainNode(0), gust = osc('sine', .17), gustDepth = gainNode(0);
  noise(0).connect(windTone).connect(windGain).connect(output); gust.connect(gustDepth).connect(windGain.gain);

  // Tyres: a smooth roar on tarmac, an uneven crunch on dirt and sand, and a
  // squeal when the tyres slide.
  const roadTone = filter('lowpass', 500), roadGain = gainNode(0);
  noise(.5).connect(roadTone).connect(roadGain).connect(output);
  const dirtTone = filter('lowpass', 700, .5), dirtGain = gainNode(0), crunch = filter('lowpass', 40), crunchDepth = gainNode(0);
  noise(1).connect(dirtTone).connect(dirtGain).connect(output); noise(1.3).connect(crunch).connect(crunchDepth).connect(dirtGain.gain);
  const squealGain = gainNode(0), squeal = osc('triangle', 820), squeal2 = osc('triangle', 1135), squealHiss = filter('bandpass', 2600, 2);
  squeal.connect(squealGain); squeal2.connect(squealGain); noise(1.6).connect(squealHiss).connect(gainNode(.25)).connect(squealGain); squealGain.connect(output);
  const wobble = osc('sine', 5.5), wobbleDepth = gainNode(18); wobble.connect(wobbleDepth); wobbleDepth.connect(squeal.frequency); wobbleDepth.connect(squeal2.frequency);

  // Water: a jet hiss under way and lapping against the hull when slow.
  const jetTone = filter('bandpass', 600, .7), jetGain = gainNode(0);
  noise(.2).connect(jetTone).connect(jetGain).connect(output);
  const lapTone = filter('lowpass', 380), lapGain = gainNode(0), lap = osc('sine', .31), lap2 = osc('sine', .53), lapDepth = gainNode(0);
  noise(.8).connect(lapTone).connect(lapGain).connect(output); lap.connect(lapDepth); lap2.connect(lapDepth); lapDepth.connect(lapGain.gain);

  // Weather: a soft, dark rain wash (kept low and rolled off: bright hiss
  // reads as static) and a low wind moan in snow.
  const rainTone = filter('lowpass', 1400, .5), rainLow = filter('highpass', 250, .5), rainGain = gainNode(0), rainSwell = osc('sine', .21), rainDepth = gainNode(0);
  noise(1.1).connect(rainLow).connect(rainTone).connect(rainGain).connect(output); rainSwell.connect(rainDepth).connect(rainGain.gain);
  const snowTone = filter('lowpass', 320, .7), snowGain = gainNode(0), snowSwell = osc('sine', .13), snowDepth = gainNode(0);
  noise(1.7).connect(snowTone).connect(snowGain).connect(output); snowSwell.connect(snowDepth).connect(snowGain.gain);

  // The Roadster: an electric drive's whine rising with road speed, in place
  // of the V8, and the rushing hiss and low roar of cold gas from the thrusters.
  const whine = osc('sawtooth', 120), whine2 = osc('triangle', 180), whineTone = filter('bandpass', 900, 1.1), whineGain = gainNode(0);
  whine.connect(whineTone); whine2.connect(whineTone); whineTone.connect(whineGain).connect(engineBus);
  const gasTone = filter('bandpass', 1100, .5), gasGain = gainNode(0), gasLow = filter('lowpass', 260, .6), gasRoar = gainNode(0);
  noise(1.4).connect(gasTone).connect(gasGain).connect(output); noise(.35).connect(gasLow).connect(gasRoar).connect(output);

  // Transform motors: a servo whine while hulls or wings move.
  const motor = osc('triangle', 160), motorTone = filter('bandpass', 700, 2.5), motorGain = gainNode(0);
  motor.connect(motorTone).connect(motorGain).connect(output);

  const buffers = new Map();
  for (const type of ['thump', 'splash', 'scrape', 'clang', 'pop']) {
    const data = synthesizeEffect(type, context.sampleRate), buffer = context.createBuffer(1, data.length, context.sampleRate);
    buffer.copyToChannel(data, 0); buffers.set(type, buffer);
  }
  const voices = new Set();
  let played = 0;
  const playedBy = {};
  function play(type, volume, pan = 0, rate = 1, send = .25) {
    playedBy[type] = (playedBy[type] ?? 0) + 1;
    if (voices.size >= capacity) voices.values().next().value.stop();
    const source = context.createBufferSource(), gain = gainNode(volume), panner = context.createStereoPanner(), wet = gainNode(send);
    source.buffer = buffers.get(type); source.playbackRate.value = rate; panner.pan.value = clamp(pan, -1, 1);
    source.connect(gain).connect(panner).connect(output); panner.connect(wet).connect(echo);
    const release = () => { source.disconnect(); gain.disconnect(); panner.disconnect(); wet.disconnect(); voices.delete(voice); };
    const voice = { stop() { source.stop(); release(); } };
    source.onended = release; voices.add(voice); source.start(); played++;
  }
  // Big hits briefly push the engine down under them.
  function duck(power) {
    const t = now();
    engineBus.gain.cancelScheduledValues(t); engineBus.gain.setTargetAtTime(1 - .55 * power, t, .012); engineBus.gain.setTargetAtTime(1, t + .09, .25);
  }

  let gear = 0, held = 0, burble = 0, lastTransform = null, lastFlight = 0, lastThump = 0;
  function update(s, dt) {
    const car = (1 - s.transform) * (1 - s.flight), boat = s.transform * (1 - s.flight), plane = s.flight;
    const v = Math.abs(s.speed), air = s.flying ? s.airspeed : v, load = Math.max(0, s.throttle);
    gear = shiftGear(gear, s.speed);
    const carRpm = engineRpm(gear, s.speed, s.throttle, s.grounded || s.floating);
    const boatRpm = 1000 + smooth(0, 26, v) * 3600 + load * 600, planeRpm = 1900 + load * 650 + air * 2.5;
    const rpm = carRpm * car + boatRpm * boat + planeRpm * plane;
    set(engine.playbackRate, rpm / ENGINE_BASE_RPM, .05);
    const electric = s.electric ? 1 : 0;
    set(engineGain.gain, (1 - electric) * (car * (.055 + load * .04) + boat * (.07 + load * .04) + plane * (.06 + load * .04)), .1);
    set(whineGain.gain, electric * (.006 + load * .014) * (.3 + .7 * smooth(.5, 12, v)), .1);
    set(whine.frequency, 70 + v * 19, .06); set(whine2.frequency, 105 + v * 28.5, .06); set(whineTone.frequency, 500 + v * 22, .08);
    const thrust = s.thrust ?? 0;
    set(gasGain.gain, thrust * .045, .04); set(gasRoar.gain, thrust * .07, .05); set(gasTone.frequency, 800 + thrust * 700, .1);
    const tone = car * (320 + rpm * .12 + load * 450) + boat * (240 + rpm * .05) + plane * (420 + load * 300);
    set(engineTone.frequency, tone, .08); set(engineTone2.frequency, tone * 1.4, .08);
    // Lifting off after a long pull at high revs pops a few times; quick
    // throttle taps stay quiet.
    if (car > .5 && !electric && held > 1.2 && s.throttle < .1 && rpm > 3200) burble = .45;
    held = s.throttle > .5 ? held + dt : 0; burble = Math.max(0, burble - dt);
    if (burble > 0 && Math.random() < dt * 6) play('pop', .03 + Math.random() * .03, (Math.random() - .5) * .3, .8 + Math.random() * .4, .1);

    // A direct-drive three-blade propeller: blade pass is three times the revs.
    const blade = planeRpm / 60 * 3, prop = plane * (.012 + load * .02 + smooth(20, 90, air) * .012);
    set(propChop.frequency, blade, .08); set(thrum.frequency, blade, .08);
    set(propGain.gain, prop, .12); set(propDepth.gain, prop * .8, .12); set(thrumGain.gain, prop * .9, .12);

    // Wind and tyre noise stay dark and soft: bright hiss reads as radio static.
    const wind = smooth(8, 95, air) ** 1.5 * (s.flying ? .12 : .035) + (s.grounded || s.floating ? 0 : smooth(5, 30, v) * .02);
    set(windGain.gain, wind, .15); set(gustDepth.gain, wind * .3, .2); set(windTone.frequency, 200 + air * 6, .15);

    const rolling = (s.grounded ? 1 : 0) * car * smooth(.5, 28, v);
    const road = s.surface === 'road', sand = s.surface === 'sand';
    const slide = (s.grounded ? 1 : 0) * car * smooth(3.5, 10, s.slip) * smooth(5, 14, v);
    set(roadGain.gain, road ? rolling * .04 : 0, .06); set(roadTone.frequency, 260 + v * 5, .1);
    // The crunch gently varies the level (the 40 Hz noise swings about ±0.025),
    // never enough to flip it past zero, which crackles.
    const dirt = road ? 0 : rolling * (sand ? .035 : .045) + slide * .04;
    set(dirtGain.gain, dirt * .6, .06); set(crunchDepth.gain, dirt * 8, .06); set(dirtTone.frequency, (sand ? 450 : 700) + v * 4, .1);
    set(squealGain.gain, road ? slide * .035 : slide * .008, .05);

    set(jetGain.gain, s.floating ? boat * (.008 + smooth(1, 22, v) * .045 + load * .012) : 0, .1); set(jetTone.frequency, 500 + v * 18, .1);
    const lapping = s.floating ? .03 + smooth(0, 18, v) * .03 : s.waterDepth > .05 ? .02 : 0;
    set(lapGain.gain, lapping, .2); set(lapDepth.gain, lapping * .35, .2); set(lapTone.frequency, 320 + v * 25, .2);

    const rainLevel = (s.rain ?? 0) * .022, snowLevel = (s.snow ?? 0) * .02;
    set(rainGain.gain, rainLevel, .5); set(rainDepth.gain, rainLevel * .25, .5);
    set(snowGain.gain, snowLevel, .6); set(snowDepth.gain, snowLevel * .5, .6);

    const moving = lastTransform === null || dt <= 0 ? 0 : (Math.abs(s.transform - lastTransform) + Math.abs(s.flight - lastFlight)) / dt;
    lastTransform = s.transform; lastFlight = s.flight;
    set(motorGain.gain, Math.min(1, moving * 2.2) * .04, .05); set(motor.frequency, 140 + (s.transform + s.flight) * 70 + moving * 40, .1);
  }
  const effects = {
    thump(power, pan = 0) { if (power < .06 || now() - lastThump < .18) return; lastThump = now(); play('thump', clamp(.06 + power * .6, 0, .24), pan * .4, .9 + Math.random() * .2, .15 + power * .3); duck(clamp(power * 1.5, 0, .6)); },
    splash(power, pan = 0) { play('splash', clamp(.05 + power * .22, 0, .26), pan, .85 + (1 - power) * .3, .25); if (power > .5) duck(.25); },
    scrape(power, pan = 0) { play('scrape', clamp(.1 + power * .22, 0, .25), pan, 1, .25); play('thump', .16, pan, .8, .3); duck(.45); },
    strike(heavy, pan = 0) { play('clang', heavy ? .22 : .13, pan, heavy ? .8 : 1.05, .3); if (heavy) duck(.35); },
  };
  function clear() {
    for (const voice of [...voices]) voice.stop();
    burble = 0; held = 0; lastTransform = null; gear = 0; lastThump = 0;
    for (const g of [engineGain, propGain, thrumGain, rainGain, snowGain, windGain, roadGain, dirtGain, squealGain, jetGain, lapGain, motorGain, whineGain, gasGain, gasRoar]) { g.gain.cancelScheduledValues(now()); g.gain.setValueAtTime(0, now()); }
  }
  return { update, ...effects, clear, echo, get played() { return played; }, get playedBy() { return { ...playedBy }; }, get active() { return voices.size; }, get gear() { return gear; } };
}
