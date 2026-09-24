// js/features/crtWarp.js
// Fondo "CRT Warp" (port de reactbits.dev/backgrounds/crt-warp) en WebGL puro,
// sin three.js. Se monta en cualquier [data-crt] y se configura con data-crt-*.
// Costo controlado: resolución interna reducida, fps limitado, pausa fuera de
// viewport o con la pestaña oculta, modo liviano en mobile y frame estático con
// prefers-reduced-motion.
import { prefersReducedMotion } from "../core/motion.js";

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 vUv;
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uBackgroundColor;
uniform float uCurvature;
uniform float uScanlineStrength;
uniform float uScanlineFrequency;
uniform float uWaveAmplitude;
uniform float uWaveFrequency;
uniform float uBloom;
uniform float uBloomRadius;
uniform float uNoise;
uniform float uVignette;
uniform float uBrightness;
uniform float uRgbShift;
uniform vec2 uPointer;
uniform float uMouseStrength;
uniform float uGlow;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 crtCurve(vec2 uv, float radius) {
  vec2 p = (uv - 0.5) * 2.0;
  float r = max(radius, 1.415);
  float cornerScale = r / sqrt(max(r * r - 2.0, 0.001));
  p = r * p / sqrt(max(r * r - dot(p, p), 0.001));
  p /= cornerScale;
  return p * 0.5 + 0.5;
}

float plasma(vec2 uv, float t) {
  float fs = max(uWaveFrequency / 2.2, 0.001);
  uv = (uv - 0.5) * fs + 0.5;

  float scan = 0.5 - 0.5 * cos(uv.y * 3.14159265 * uScanlineFrequency);
  scan = mix(1.0, scan, uScanlineStrength);

  uv *= vec2(80.0, 24.0);
  uv = ceil(uv);
  uv /= vec2(80.0, 24.0);

  float amp = uWaveAmplitude / 0.28;
  float f = 0.0;
  f += 0.7 * sin(0.5 * uv.x + t / 5.0);
  f += 3.0 * sin(1.6 * uv.y + t / 5.0);
  f += sin(10.0 * (uv.y * sin(t / 2.0) + uv.x * cos(t / 5.0)) + t / 2.0);

  float cx = uv.x + 0.5 * sin(t / 2.0);
  float cy = uv.y + 0.5 * cos(t / 4.0);
  f += 0.4 * sin(sqrt(100.0 * cx * cx + 100.0 * cy * cy + 1.0) + t);
  f += 0.9 * sin(sqrt(75.0 * cx * cx + 25.0 * cy * cy + 1.0) + t);
  f -= 1.4 * sin(sqrt(256.0 * cx * cx + 25.0 * cy * cy + 1.0) + t);
  f += 0.3 * sin(0.5 * uv.y + uv.x + sin(t));

  return scan * floor(3.0 * (0.5 + 0.499 * sin(f * amp))) / 3.0;
}

void main() {
  float curveRadius = 1.1 + 0.42 / max(uCurvature, 0.001);
  curveRadius *= exp(-uPointer.y * uMouseStrength * 0.4);
  vec2 cuv = crtCurve(vUv, curveRadius);
  cuv.x -= uPointer.x * uMouseStrength * 0.035;

  float signal = plasma(cuv, uTime);
  float glow = signal * 0.2;

  // Bloom: 8 muestras extra. Se apaga en mobile (uGlow = 0).
  if (uGlow > 0.5) {
    float r = 0.01 * uBloomRadius;
    glow += plasma(cuv + vec2(r, 0.0), uTime) * 0.12;
    glow += plasma(cuv - vec2(r, 0.0), uTime) * 0.12;
    glow += plasma(cuv + vec2(0.0, r), uTime) * 0.12;
    glow += plasma(cuv - vec2(0.0, r), uTime) * 0.12;
    glow += plasma(cuv + vec2(r), uTime) * 0.08;
    glow += plasma(cuv - vec2(r), uTime) * 0.08;
    glow += plasma(cuv + vec2(r, -r), uTime) * 0.08;
    glow += plasma(cuv + vec2(-r, r), uTime) * 0.08;
  }

  vec3 wave = uColor * (0.3 + signal * 0.7 + glow * uBloom * 0.65);

  // Aberración cromática: 2 muestras extra, también opcional.
  if (uRgbShift > 0.0001) {
    float rs = plasma(cuv + vec2(uRgbShift, 0.0), uTime);
    float bs = plasma(cuv - vec2(uRgbShift, 0.0), uTime);
    wave += (vec3(rs, signal, bs) - signal) * 0.42;
  }

  float edge = clamp(1.0 - dot(vUv - 0.5, vUv - 0.5) * 2.0, 0.0, 1.0);
  float edgeFade = mix(1.0, smoothstep(0.0, 1.0, edge), uVignette);
  float mask = clamp(signal * 0.82 + glow * 0.52, 0.0, 1.0) * edgeFade;

  float grain = hash21(gl_FragCoord.xy + vec2(fract(uTime) * 173.0));
  wave = max(wave * uBrightness, vec3(0.0));
  vec3 color = mix(uBackgroundColor, wave, mask);
  color += (grain - 0.5) * uNoise;
  gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
}`;

const DEFAULTS = {
  color: "#59c6ba",
  bg: "#050509",
  speed: 0.35,
  curvature: 0.25,
  scanlineStrength: 0.3,
  scanlineFrequency: 200,
  waveAmplitude: 0.3,
  waveFrequency: 2.5,
  bloom: 1.2,
  bloomRadius: 1,
  noise: 0.06,
  vignette: 0.35,
  brightness: 1,
  rgbShift: 0.012,
  mouseStrength: 0.5,
  fps: 30,
};

const hexToRgb = (hex) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

function readOptions(el) {
  const o = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    const attr = el.dataset["crt" + key[0].toUpperCase() + key.slice(1)];
    if (attr == null) continue;
    o[key] = typeof DEFAULTS[key] === "number" ? parseFloat(attr) : attr;
  }
  return o;
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn("[crtWarp] shader:", gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function mount(host) {
  if (host.dataset.crtMounted === "1") return;
  host.dataset.crtMounted = "1";

  const opts = readOptions(host);
  const mobile = window.matchMedia("(max-width: 720px), (pointer: coarse)").matches;
  const reduce = prefersReducedMotion();

  // Presupuesto de píxeles internos: el canvas se renderiza chico y el CSS lo
  // escala. En un efecto CRT la pérdida de nitidez no se nota y ahorra GPU.
  const pixelBudget = mobile ? 110000 : 340000;
  const fps = mobile ? Math.min(opts.fps, 24) : opts.fps;

  const canvas = document.createElement("canvas");
  canvas.className = "crt-canvas";
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);

  const gl = canvas.getContext("webgl", {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
    preserveDrawingBuffer: false,
  });
  if (!gl) {
    canvas.remove();
    return; // queda el fallback CSS del contenedor
  }

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { canvas.remove(); return; }
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); return; }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const u = (name) => gl.getUniformLocation(prog, name);
  const U = {
    res: u("uResolution"), time: u("uTime"), pointer: u("uPointer"),
  };
  gl.uniform3fv(u("uColor"), hexToRgb(opts.color));
  gl.uniform3fv(u("uBackgroundColor"), hexToRgb(opts.bg));
  gl.uniform1f(u("uCurvature"), opts.curvature);
  gl.uniform1f(u("uScanlineStrength"), opts.scanlineStrength);
  gl.uniform1f(u("uScanlineFrequency"), opts.scanlineFrequency);
  gl.uniform1f(u("uWaveAmplitude"), opts.waveAmplitude);
  gl.uniform1f(u("uWaveFrequency"), opts.waveFrequency);
  gl.uniform1f(u("uBloom"), opts.bloom);
  gl.uniform1f(u("uBloomRadius"), opts.bloomRadius);
  gl.uniform1f(u("uNoise"), opts.noise);
  gl.uniform1f(u("uVignette"), opts.vignette);
  gl.uniform1f(u("uBrightness"), opts.brightness);
  gl.uniform1f(u("uRgbShift"), mobile ? 0 : opts.rgbShift);
  gl.uniform1f(u("uMouseStrength"), mobile ? 0 : opts.mouseStrength);
  gl.uniform1f(u("uGlow"), mobile ? 0 : 1);

  const resize = () => {
    const w = Math.max(host.clientWidth, 1);
    const h = Math.max(host.clientHeight, 1);
    const scale = Math.min(1, Math.sqrt(pixelBudget / (w * h)));
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.res, canvas.width, canvas.height);
    if (!running) draw(); // repinta el frame estático al redimensionar
  };

  let time = 4; // arranca con el plasma ya "formado"
  let last = 0;
  let prev = 0;
  let raf = 0;
  let running = false;
  let visible = true;
  const target = [0, 0];
  const pointer = [0, 0];

  const draw = () => {
    pointer[0] += (target[0] - pointer[0]) * 0.08;
    pointer[1] += (target[1] - pointer[1]) * 0.08;
    gl.uniform2f(U.pointer, pointer[0], pointer[1]);
    gl.uniform1f(U.time, time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const interval = 1000 / fps;
    if (now - last < interval) return;
    last = now - ((now - last) % interval);
    const dt = prev ? Math.min((now - prev) / 1000, 0.1) : 0;
    prev = now;
    time += dt * opts.speed;
    draw();
  };

  const start = () => {
    if (running || reduce || !visible || document.hidden) return;
    running = true;
    prev = 0;
    raf = requestAnimationFrame(frame);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };

  new ResizeObserver(resize).observe(host);
  resize();
  draw();
  host.classList.add("crt-ready");

  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    visible ? start() : stop();
  }).observe(host);

  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));

  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); stop(); });

  // Interacción con el mouse sobre el bloque que contiene el fondo
  if (!mobile && !reduce) {
    const zone = host.closest("[data-crt-zone]") || host.parentElement;
    zone.addEventListener("pointermove", (e) => {
      const r = host.getBoundingClientRect();
      target[0] = ((e.clientX - r.left) / Math.max(r.width, 1)) * 2 - 1;
      target[1] = -(((e.clientY - r.top) / Math.max(r.height, 1)) * 2 - 1);
    }, { passive: true });
    zone.addEventListener("pointerleave", () => { target[0] = 0; target[1] = 0; });
  }

  start();
}

export function initCrtWarp() {
  document.querySelectorAll("[data-crt]").forEach(mount);
}
