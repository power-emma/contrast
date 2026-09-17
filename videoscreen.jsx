import { React, useEffect, useRef } from 'react';
import { getRuntime, subscribeRuntime, SCREEN_BASE, SCREEN_BYTES } from './runtime';

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

// Reads the framebuffer straight out of the shared 68000 core's RAM
// (see runtime.js) at the classic compact-Mac screen buffer address and
// paints it every frame — whatever mac.rom has actually drawn there.
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
    return subscribeRuntime(draw);
  }, []);

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
        style={{ width: `${SCREEN_W * 2}px`, height: `${SCREEN_H * 2}px`, maxWidth: '100%', maxHeight: '100%', aspectRatio: `${SCREEN_W} / ${SCREEN_H}`, imageRendering: 'pixelated', border: '1px solid #555' }}
      />
    </div>
  );
};

export default VideoScreen;
