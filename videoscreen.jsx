import { React, useEffect, useRef } from 'react';
import { getRuntime, subscribeVideoFrame, SCREEN_BASE, SCREEN_BYTES } from './runtime';
import { keyEventBytes } from './68k';

// Classic Macintosh video generator: 512x342, 1 bit per pixel, 64 bytes/row.
const SCREEN_W = 512;
const SCREEN_H = 342;
const BYTES_PER_ROW = SCREEN_W / 8;

// 1 = black, matches the real hardware's framebuffer convention.
function decode1bpp(bytes) {
  const img = new ImageData(SCREEN_W, SCREEN_H);
  const data = img.data;
  for (let y = 0; y < SCREEN_H; y++) {
    const rowStart = y * BYTES_PER_ROW;
    for (let bx = 0; bx < BYTES_PER_ROW; bx++) {
      const byte = bytes[rowStart + bx] || 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = bx * 8 + bit;
        const black = (byte >> (7 - bit)) & 1;
        const v = black ? 0 : 255;
        const idx = (y * SCREEN_W + x) * 4;
        data[idx] = v; data[idx + 1] = v; data[idx + 2] = v; data[idx + 3] = 255;
      }
    }
  }
  return img;
}

// Paints the shared core's framebuffer to the canvas every frame
const VideoScreen = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d');
    const rt = getRuntime();
    const draw = () => {
      const bus = rt.bus;
      if (!bus) return;
      const bytes = bus.ram.subarray(SCREEN_BASE, SCREEN_BASE + SCREEN_BYTES);
      ctx.putImageData(decode1bpp(bytes), 0, 0);
    };
    return subscribeVideoFrame(draw);
  }, []);

  // Forward every host key to the Bus as M0110 bytes, regardless of focus
  useEffect(() => {
    const forward = (code, down) => {
      const bus = getRuntime().bus;
      if (!bus) return false;
      const bytes = keyEventBytes(code, down);
      if (!bytes) return false;
      bus.keyEvent(bytes);
      return true;
    };
    const onKeyDown = (e) => { if (forward(e.code, true)) e.preventDefault(); };
    const onKeyUp = (e) => { if (forward(e.code, false)) e.preventDefault(); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Map the host pointer straight to Mac screen coordinates
  const sendMousePos = (e) => {
    const bus = getRuntime().bus;
    const canvas = canvasRef.current;
    if (!bus || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * SCREEN_W;
    const y = ((e.clientY - rect.top) / rect.height) * SCREEN_H;
    bus.setMouseLoc(x, y);
  };
  // Pointer capture keeps events flowing during a drag off the canvas
  const handlePointerDown = (e) => {
    e.preventDefault();
    canvasRef.current.focus();
    canvasRef.current.setPointerCapture(e.pointerId);
    sendMousePos(e);
    const bus = getRuntime().bus;
    if (bus) bus.setMouseButton(true);
  };
  const handlePointerUp = (e) => {
    canvasRef.current.releasePointerCapture(e.pointerId);
    sendMousePos(e);
    const bus = getRuntime().bus;
    if (bus) bus.setMouseButton(false);
  };
  const handlePointerMove = (e) => {
    sendMousePos(e);
  };

  return (
    <div style={{
      width: '100%', height: '100%', boxSizing: 'border-box',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#222', padding: '8px',
    }}>
      <canvas
        ref={canvasRef}
        width={SCREEN_W}
        height={SCREEN_H}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerMove={handlePointerMove}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          width: `${SCREEN_W * 2}px`, height: `${SCREEN_H * 2}px`, maxWidth: '100%', maxHeight: '100%',
          aspectRatio: `${SCREEN_W} / ${SCREEN_H}`, imageRendering: 'pixelated', border: '1px solid #555',
          outline: 'none', touchAction: 'none',
        }}
      />
    </div>
  );
};

export default VideoScreen;
