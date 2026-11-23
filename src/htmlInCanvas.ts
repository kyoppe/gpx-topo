// HTML-in-Canvas is not part of lib.dom yet, so describe only the surface used here.
export type HtmlInCanvasElement = HTMLCanvasElement & {
  requestPaint(): void;
  getElementImageDefaultSize(element: Element): { width: number; height: number };
  /**
   * Tells the browser where a drawable child really appears on the canvas, so pointer input,
   * hover, focus and text selection reach the real element there.
   */
  updateElementGeometry?(element: Element, options: { canvasTransform?: DOMMatrix }): void;
};

export type HtmlInCanvasContext = WebGL2RenderingContext & {
  texElementSubImage2D(
    target: number,
    level: number,
    xoffset: number,
    yoffset: number,
    element: Element,
    options?: { width: number; height: number },
  ): void;
};

export type PaintEvent = Event & { changedElements?: Element[] };

// Decided by probing for the feature itself, never by browser name or version.
export function supportsHtmlInCanvas() {
  if (typeof document === 'undefined' || typeof WebGL2RenderingContext === 'undefined') {
    return false;
  }
  const probe = document.createElement('canvas');
  probe.setAttribute('content', 'drawable');
  return (
    (probe as { content?: string }).content === 'drawable' &&
    'requestPaint' in probe &&
    'updateElementGeometry' in probe &&
    'texElementSubImage2D' in WebGL2RenderingContext.prototype
  );
}

// Diagnostic context only; browser identity does not determine feature support.
export function getHtmlInCanvasContext() {
  const { userAgentData } = navigator as Navigator & {
    userAgentData?: { brands?: { brand: string; version: string }[] };
  };
  return {
    is_webview: /\bwv\b/.test(navigator.userAgent),
    ...(userAgentData?.brands ? { user_agent_data_brands: userAgentData.brands } : {}),
  };
}
