import { useEffect, useRef, useState } from 'react';

import type { HtmlInCanvasContext, HtmlInCanvasElement } from './htmlInCanvas';
import type { SiteCopy } from './siteCopy';

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
uniform float uAngle;
out vec2 vUv;

void main() {
  vec3 point = vec3(aPosition.x, aPosition.y, 0.0);
  float c = cos(uAngle);
  float s = sin(uAngle);
  float depth = 1.72 + point.y * s * 0.42;
  float perspective = 1.0 / depth;
  gl_Position = vec4(point.x * 1.28 * perspective, point.y * c * 1.16 * perspective - 0.04, 0.0, 1.0);
  vUv = vec2(aPosition.x * 0.5 + 0.5, 1.0 - (aPosition.y * 0.5 + 0.5));
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D uTexture;
in vec2 vUv;
out vec4 color;

void main() {
  color = texture(uTexture, vUv);
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create the About hero shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'Could not compile the About hero shader.');
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext) {
  const program = gl.createProgram();
  if (!program) throw new Error('Could not create the About hero program.');
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'Could not link the About hero program.');
  }
  return program;
}

function renderTerrainContent(copy: SiteCopy) {
  return (
    <div className="about-native-terrain" data-drawable="">
      <svg className="about-native-contours" viewBox="0 0 640 440" preserveAspectRatio="none" aria-hidden="true">
        <path d="M-20 350C70 285 95 390 180 310S330 250 390 300s105 70 170-5 100-50 150-100" />
        <path d="M-30 390C80 315 105 425 200 340s130-35 205 20 100 47 160-30 105-35 145-90" />
        <path d="M-10 260c105-35 105 75 205-5s145-60 220 10 95 45 160-15 100-30 150-70" />
        <path d="M70 210c80-15 80 45 150-10s125-50 185 5 85 38 140-18 90-20 125-55" />
        <path d="M190 160c65 15 72 45 125-5s95-48 140-5 73 45 115 0" />
        <path d="M255 105c40 24 78 34 106 0s68-36 104-5 60 38 91 8" />
      </svg>
      <div className="about-native-paper">
        <strong>{copy.heroTitle}</strong>
        <span>{copy.footer}</span>
      </div>
      <div className="about-native-credits" aria-label={copy.heroLead}>
        <p>{copy.heroTitle}</p>
        <p>{copy.heroLead}</p>
        <p>{copy.canItems[2]}</p>
        <p>{copy.canItems[3]}</p>
        <p>{copy.canItems[4]}</p>
      </div>
    </div>
  );
}

export default function AboutHero({ copy }: { copy: SiteCopy }) {
  const canvasRef = useRef<HtmlInCanvasElement | null>(null);
  const terrainRef = useRef<HTMLDivElement | null>(null);
  const angleRef = useRef(0);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const terrain = terrainRef.current;
    if (!canvas || !terrain) return;
    const gl = canvas.getContext('webgl2') as HtmlInCanvasContext | null;
    if (!gl || typeof gl.texElementSubImage2D !== 'function') return;

    canvas.setAttribute('content', 'drawable');
    canvas.setAttribute('layoutsubtree', '');
    const program = createProgram(gl);
    const position = gl.getAttribLocation(program, 'aPosition');
    const angle = gl.getUniformLocation(program, 'uAngle');
    const texture = gl.createTexture();
    const buffer = gl.createBuffer();
    if (position < 0 || !angle || !texture || !buffer) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const targetAngle = 0.78;
    let frame = 0;
    let startedAt = performance.now();
    let textureWidth = 0;
    let textureHeight = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const draw = (nextAngle: number) => {
      const width = Math.max(1, terrain.offsetWidth);
      const height = Math.max(1, terrain.offsetHeight);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      if (textureWidth !== width || textureHeight !== height) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        textureWidth = width;
        textureHeight = height;
      }
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, terrain, { width, height });
      gl.clearColor(0.93, 0.93, 0.91, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(angle, nextAngle);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      canvas.requestPaint?.();
    };

    const tick = (now: number) => {
      if (pausedRef.current) return;
      const progress = reducedMotion ? 1 : Math.min(1, (now - startedAt - 280) / 1400);
      const eased = progress <= 0 ? 0 : 1 - (1 - progress) ** 3;
      angleRef.current = targetAngle * eased;
      resize();
      draw(angleRef.current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    resize();
    tick(startedAt);
    if (reducedMotion) angleRef.current = targetAngle;
    else frame = requestAnimationFrame(tick);
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, []);

  return (
    <div
      className={`about-native-scene${paused ? ' is-paused' : ''}`}
      onPointerDown={() => {
        pausedRef.current = true;
        setPaused(true);
      }}
    >
      <canvas ref={canvasRef} className="about-native-canvas" aria-label={copy.heroTitle}>
        <div ref={terrainRef} className="about-native-terrain-host">
          {renderTerrainContent(copy)}
        </div>
      </canvas>
      <span className="about-native-status" aria-live="polite">
        {paused ? copy.heroTitle : ''}
      </span>
    </div>
  );
}
