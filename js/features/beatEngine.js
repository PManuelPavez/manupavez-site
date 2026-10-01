// beatEngine.js — Motor de audio de Frequency Beat (Web Audio API).
// Todo suena del lado del cliente: cada one-shot se baja y decodifica una sola vez,
// y un programador con anticipación agenda los golpes en el reloj del AudioContext.
// (El setInterval solo despierta al programador; el tiempo real lo marca el audio,
// por eso el tempo no se corre aunque el navegador esté ocupado.)

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;
const STEPS = 16;

let ctx = null;
let master = null;

// Llamar SIEMPRE dentro de un toque/clic: iOS solo habilita el audio así.
export function audioContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: "interactive" });
    // Compresor suave en el master: 7 filas golpeando juntas no saturan
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -8;
    comp.knee.value = 6;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(comp).connect(ctx.destination);
    // iPhone: que suene aunque el switch de silencio esté activado (Safari 16.4+)
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch { /* no soportado */ }
    // Desbloqueo para Safari viejo: un buffer mudo dentro del gesto
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
  }
  if (ctx.state !== "running") ctx.resume();
  return ctx;
}

// One-shot: MP3 del género; si falta, un sonido sintetizado de reemplazo.
export async function loadVoice(url, rowId) {
  const c = audioContext();
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("sin sample");
    const buffer = await c.decodeAudioData(await res.arrayBuffer());
    return { buffer, offset: leadingSilence(buffer), real: true };
  } catch {
    return { buffer: await synthesize(rowId, c.sampleRate), offset: 0, real: false };
  }
}

// El MP3 agrega unos ms de silencio al principio: se saltean para que el golpe caiga en la grilla.
function leadingSilence(buf) {
  const max = Math.min(buf.length, Math.floor(buf.sampleRate * 0.06));
  const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  for (let i = 0; i < max; i++) {
    for (const d of chans) if (Math.abs(d[i]) > 0.0015) return i / buf.sampleRate;
  }
  return 0;
}

// Suena una vez (vista previa o golpe programado). Cada fila corta su golpe anterior.
export function trigger(voice, when = 0) {
  if (!ctx || !voice) return;
  const t = Math.max(when, ctx.currentTime);
  if (voice.last) {
    voice.last.gain.gain.setTargetAtTime(0, t, 0.006);
    try { voice.last.src.stop(t + 0.05); } catch { /* ya terminó */ }
  }
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  src.buffer = voice.buffer;
  gain.gain.value = voice.gain ?? 1;
  src.connect(gain).connect(master);
  src.start(t, voice.offset || 0);
  voice.last = { src, gain };
  src.onended = () => { if (voice.last?.src === src) voice.last = null; };
}

// state: { pattern: Map(fila → boolean[16]), voices: Map(fila → voice), bpm }
// onStep(i): paso que está sonando (-1 al frenar), sincronizado con lo que se oye.
export function createSequencer(state, onStep) {
  let timer = null;
  let raf = 0;
  let step = 0;
  let nextTime = 0;
  const queue = [];

  function schedule() {
    while (nextTime < ctx.currentTime + SCHEDULE_AHEAD) {
      for (const [id, steps] of state.pattern) if (steps[step]) trigger(state.voices.get(id), nextTime);
      queue.push({ step, time: nextTime });
      nextTime += 60 / state.bpm / 4;
      step = (step + 1) % STEPS;
    }
  }

  function draw() {
    let current = null;
    while (queue.length && queue[0].time <= ctx.currentTime) current = queue.shift().step;
    if (current !== null) onStep(current);
    raf = requestAnimationFrame(draw);
  }

  return {
    get playing() { return timer !== null; },
    start() {
      if (timer) return;
      audioContext();
      step = 0;
      nextTime = ctx.currentTime + 0.05;
      schedule();
      timer = setInterval(schedule, LOOKAHEAD_MS);
      raf = requestAnimationFrame(draw);
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      cancelAnimationFrame(raf);
      queue.length = 0;
      onStep(-1);
    },
  };
}

// ── Sonidos de reemplazo (hasta que estén los MP3) ─────────────
// Se renderizan una vez a un buffer, así suenan por el mismo camino que un sample.
const C2 = 65.41;
const C4 = 261.63;

function noise(o, dur) {
  const buf = o.createBuffer(1, Math.ceil(o.sampleRate * dur), o.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = o.createBufferSource();
  src.buffer = buf;
  return src;
}

function filter(o, type, freq, q = 0.7) {
  const f = o.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

const RECIPES = {
  kick: [0.5, (o) => {
    const osc = o.createOscillator(), g = o.createGain();
    osc.frequency.setValueAtTime(165, 0);
    osc.frequency.exponentialRampToValueAtTime(46, 0.11);
    g.gain.setValueAtTime(1, 0);
    g.gain.exponentialRampToValueAtTime(0.001, 0.45);
    osc.connect(g).connect(o.destination);
    osc.start(0);
  }],
  clap: [0.3, (o) => {
    const src = noise(o, 0.3), g = o.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    for (const t of [0, 0.011, 0.022]) {
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.009);
    }
    g.gain.setValueAtTime(0.8, 0.033);
    g.gain.exponentialRampToValueAtTime(0.001, 0.26);
    src.connect(filter(o, "bandpass", 1300, 1.1)).connect(g).connect(o.destination);
    src.start(0);
  }],
  hat: [0.1, (o) => {
    const src = noise(o, 0.1), g = o.createGain();
    g.gain.setValueAtTime(0.7, 0);
    g.gain.exponentialRampToValueAtTime(0.001, 0.08);
    src.connect(filter(o, "highpass", 7500)).connect(g).connect(o.destination);
    src.start(0);
  }],
  shaker: [0.12, (o) => {
    const src = noise(o, 0.12), g = o.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.linearRampToValueAtTime(0.5, 0.014);
    g.gain.exponentialRampToValueAtTime(0.001, 0.1);
    src.connect(filter(o, "bandpass", 6200, 0.8)).connect(g).connect(o.destination);
    src.start(0);
  }],
  perc: [0.22, (o) => {
    const osc = o.createOscillator(), g = o.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(540, 0);
    osc.frequency.exponentialRampToValueAtTime(330, 0.04);
    g.gain.setValueAtTime(0.9, 0);
    g.gain.exponentialRampToValueAtTime(0.001, 0.2);
    osc.connect(g).connect(o.destination);
    osc.start(0);
  }],
  bass: [0.4, (o) => {
    const saw = o.createOscillator(), sub = o.createOscillator(), g = o.createGain();
    const lp = filter(o, "lowpass", 900, 5);
    saw.type = "sawtooth";
    saw.frequency.value = C2;
    sub.frequency.value = C2;
    lp.frequency.setValueAtTime(1100, 0);
    lp.frequency.exponentialRampToValueAtTime(180, 0.25);
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.linearRampToValueAtTime(0.7, 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, 0.36);
    saw.connect(lp);
    sub.connect(lp);
    lp.connect(g).connect(o.destination);
    saw.start(0);
    sub.start(0);
  }],
  synth: [0.45, (o) => {
    const g = o.createGain(), lp = filter(o, "lowpass", 3200, 2);
    for (const [freq, det] of [[C4, -9], [C4, 9], [C4 * 2, 0]]) {
      const osc = o.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      osc.detune.value = det;
      osc.connect(lp);
      osc.start(0);
    }
    lp.frequency.setValueAtTime(3600, 0);
    lp.frequency.exponentialRampToValueAtTime(600, 0.3);
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.linearRampToValueAtTime(0.35, 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, 0.42);
    lp.connect(g).connect(o.destination);
  }],
};

async function synthesize(rowId, sampleRate) {
  const [dur, build] = RECIPES[rowId] || RECIPES.perc;
  const o = new OfflineAudioContext(1, Math.ceil(sampleRate * dur), sampleRate);
  build(o);
  return o.startRendering();
}
