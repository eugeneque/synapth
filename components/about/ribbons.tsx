"use client";

/**
 * Ribbons — the /about background. A fullscreen WebGL fragment shader draws
 * 3–5 long, curved trails of light (lime → blue, additive, with fine fibres
 * inside) that loop every 24 s and drift at 0.3× the scroll. On top sit a 1px
 * dot grid and a vignette. Reduced motion renders one still frame; without
 * WebGL an SVG approximation of the same frame is shown instead.
 *
 * It paints the page background itself, so it marks the page `data-pixel-mute`
 * and the global PixelField stops drawing underneath.
 */

import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "./motion";

const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uScroll;
uniform float uCount;
const vec3 BG = vec3(0.039, 0.043, 0.035);
const vec3 LIME = vec3(0.776, 1.0, 0.2);
const vec3 BLUE = vec3(0.353, 0.663, 0.902);

void main() {
  vec2 uv = gl_FragCoord.xy / uRes.y;
  float ax = uRes.x / uRes.y;
  uv.y -= uScroll;
  // One full cycle every 24 s: every time term below is an integer multiple of T.
  float T = uTime * 6.2831853 / 24.0;
  vec3 light = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    if (fi >= uCount) break;
    float ang = -0.42 + 0.21 * fi;
    vec2 q = uv - vec2(ax * 0.5, 0.5);
    q = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * q;
    float x = q.x;
    float mid = -0.42 + fi * 0.23 + 0.09 * sin(x * 1.25 + T + fi * 1.7) + 0.045 * sin(x * 2.6 - 2.0 * T + fi * 0.9);
    float d = q.y - mid;
    float w = 0.045 + 0.022 * sin(x * 1.8 + fi * 2.3 + T);
    float core = exp(-d * d / (w * w));
    // Fibres: thin strands across the ribbon, slowly braiding along its length.
    float strands = pow(0.5 + 0.5 * cos((d / w) * 17.0 + 2.2 * sin(x * 3.1 + fi + T)), 7.0);
    float halo = exp(-d * d / (w * w * 10.0));
    // Trails fade in and out along their length, so they read as streaks, not bands.
    float len = smoothstep(-ax * 0.7, -ax * 0.15 + 0.12 * fi, x) * (1.0 - smoothstep(ax * 0.05 + 0.14 * fi, ax * 0.72, x));
    float g = clamp(0.35 + x / ax * 1.1 + 0.18 * sin(fi * 2.1), 0.0, 1.0);
    vec3 tint = mix(LIME, BLUE, g);
    light += tint * len * (core * (0.18 + 0.5 * strands) + halo * 0.07);
  }
  vec3 col = BG + (1.0 - exp(-light * 1.1)) * 0.62;
  gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

/** Still frame shown when WebGL is unavailable: the same four streaks, blurred SVG strokes. */
function StaticRibbons() {
  const paths = [
    "M-100 690 C 300 520, 620 700, 980 470 S 1500 300, 1800 360",
    "M-100 560 C 260 430, 640 560, 1000 350 S 1500 170, 1800 220",
    "M-100 820 C 360 700, 700 820, 1080 600 S 1560 460, 1800 520",
    "M-100 420 C 320 330, 600 420, 940 250 S 1460 90, 1800 120",
  ];
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="rb-g" x1="0" x2="1">
          <stop offset="0" stopColor="#c6ff33" stopOpacity="0" />
          <stop offset="0.3" stopColor="#c6ff33" stopOpacity="0.5" />
          <stop offset="0.75" stopColor="#5aa9e6" stopOpacity="0.45" />
          <stop offset="1" stopColor="#5aa9e6" stopOpacity="0" />
        </linearGradient>
        <filter id="rb-b" x="-10%" y="-50%" width="120%" height="200%">
          <feGaussianBlur stdDeviation="22" />
        </filter>
      </defs>
      <g filter="url(#rb-b)" opacity="0.55">
        {paths.map((d) => (
          <path key={d} d={d} fill="none" stroke="url(#rb-g)" strokeWidth="46" />
        ))}
      </g>
      <g opacity="0.35">
        {paths.map((d) => (
          <path key={d} d={d} fill="none" stroke="url(#rb-g)" strokeWidth="1" />
        ))}
      </g>
    </svg>
  );
}

export function Ribbons() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!gl) {
      setFallback(true);
      return;
    }

    let program: WebGLProgram;
    try {
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("link");
    } catch {
      setFallback(true);
      return;
    }
    gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    // One oversized triangle covers the viewport.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(program, "uRes");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uScroll = gl.getUniformLocation(program, "uScroll");
    const uCount = gl.getUniformLocation(program, "uCount");

    const still = reducedMotion();
    const mobile = window.matchMedia("(max-width: 767px)");
    let raf = 0;
    const t0 = performance.now();

    function resize() {
      // The light is soft; ~0.6 of CSS pixels is plenty and keeps the fill rate low on phones.
      const scale = mobile.matches ? 0.5 : 0.65;
      canvas!.width = Math.max(1, Math.round(window.innerWidth * scale));
      canvas!.height = Math.max(1, Math.round(window.innerHeight * scale));
      gl!.viewport(0, 0, canvas!.width, canvas!.height);
    }

    function frame(now: number) {
      gl!.uniform2f(uRes, canvas!.width, canvas!.height);
      // Reduced motion: always the same frame, no parallax.
      gl!.uniform1f(uTime, still ? 7.5 : (now - t0) / 1000);
      gl!.uniform1f(uScroll, still ? 0 : (window.scrollY * 0.3) / window.innerHeight);
      // Phones get half the trails.
      gl!.uniform1f(uCount, mobile.matches ? 2 : 4);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      if (!still) raf = requestAnimationFrame(frame);
    }

    const start = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    };
    const onResize = () => {
      resize();
      start();
    };
    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else start();
    };

    resize();
    start();
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <div className="about-bg" aria-hidden="true" data-pixel-mute="">
      {fallback ? <StaticRibbons /> : <canvas ref={ref} className="absolute inset-0 h-full w-full" />}
      <div className="about-dots" />
      <div className="about-vignette" />
    </div>
  );
}
