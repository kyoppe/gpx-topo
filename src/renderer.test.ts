import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HtmlInCanvasContext, HtmlInCanvasElement } from './htmlInCanvas';
import { createRenderer } from './renderer';

afterEach(() => vi.restoreAllMocks());

function setup() {
  // Shader setup and unrelated GL operations are inert; exercise the real upload path.
  const gl = new Proxy<Record<string, unknown>>({
    NO_ERROR: 0,
    ACTIVE_UNIFORMS: 0x8b86,
    getShaderParameter: vi.fn(() => true),
    getProgramParameter: vi.fn((_program: WebGLProgram, parameter: number) => parameter === 0x8b86 ? 0 : true),
    getParameter: vi.fn(() => 4096),
    getExtension: vi.fn(() => null),
    createTexture: vi.fn(() => ({})),
    texElementSubImage2D: vi.fn(),
    getError: vi.fn(() => 0),
    isContextLost: vi.fn(() => false),
  }, {
    get(target, property) {
      if (typeof property !== 'string') return Reflect.get(target, property);
      return target[property] ??= /^[A-Z0-9_]+$/.test(property) ? Object.keys(target).length + 1 : vi.fn();
    },
  }) as unknown as HtmlInCanvasContext;
  const canvas = document.createElement('canvas') as HtmlInCanvasElement;
  vi.spyOn(canvas, 'getContext').mockReturnValue(gl);
  const renderer = createRenderer(canvas);
  const layer = renderer.layer();
  const upload = () => renderer.upload(layer, document.createElement('div'), 100, 100);
  return { gl, layer, upload };
}

describe('initial HTML element texture upload', () => {
  it('verifies success once and avoids GL error polling on later uploads', () => {
    const { gl, layer, upload } = setup();
    upload();
    upload();
    expect(layer.ready).toBe(true);
    expect(gl.texElementSubImage2D).toHaveBeenCalledTimes(2);
    expect(gl.getError).toHaveBeenCalledOnce();
    expect(gl.isContextLost).toHaveBeenCalledOnce();
  });

  it('rejects a throwing upload and allows a later successful retry', () => {
    const { gl, layer, upload } = setup();
    vi.mocked(gl.texElementSubImage2D).mockImplementationOnce(() => { throw new Error('No snapshot yet'); });
    expect(upload).toThrow('No snapshot yet');
    expect(layer.ready).toBe(false);
    upload();
    expect(layer.ready).toBe(true);
    expect(gl.getError).toHaveBeenCalledOnce();
  });

  it('rejects a non-throwing GL error and verifies the next upload again', () => {
    const { gl, layer, upload } = setup();
    vi.mocked(gl.getError).mockReturnValueOnce(0x0502); // INVALID_OPERATION
    expect(upload).toThrow('HTML-in-Canvas texture upload failed.');
    expect(layer.ready).toBe(false);
    upload();
    expect(layer.ready).toBe(true);
    expect(gl.getError).toHaveBeenCalledTimes(2);
  });

  it('rejects an upload while the context is lost', () => {
    const { gl, layer, upload } = setup();
    vi.mocked(gl.isContextLost).mockReturnValueOnce(true);
    expect(upload).toThrow('HTML-in-Canvas texture upload failed.');
    expect(layer.ready).toBe(false);
    upload();
    expect(layer.ready).toBe(true);
  });
});
