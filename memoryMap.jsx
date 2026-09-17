import { React, useEffect, useState } from 'react';
import { getRuntime, subscribeRuntime } from './runtime';
import { RAM_BLOCK_SIZE, RAM_BLOCK_COUNT } from './68k';

// How many frames a block stays "hot" (white) after a write before fading
// back down to its region's base colour.
const FADE_FRAMES = 24;
const RAM_COLS = 16;

const RAM_RGB = [51, 255, 102]; // matches the terminal's green theme

// Everything past RAM, in address order, each with a fixed base colour and
// (where the region is writable) the deviceWriteFrame key that flashes it.
const DEVICE_REGIONS = [
  { label: 'ROM   $400000-$4FFFFF  (64K, mirrored)', rgb: [64, 170, 255], key: null },
  { label: 'SCC   $800000-$9FFFFF  (read)', rgb: [230, 200, 40], key: null },
  { label: 'SCC   $A00000-$BFFFFF  (write)', rgb: [230, 140, 40], key: 'sccWrite' },
  { label: 'IWM   $C00000-$DFFFFF  (disk)', rgb: [210, 90, 210], key: 'iwm' },
  { label: 'VIA   $E80000-$EFFFFF', rgb: [150, 150, 150], key: 'via' },
];

// Blend a region's base colour toward white based on how recently
// (in frames) it was written — a fresh write is white-hot, fading back to
// its base colour over FADE_FRAMES.
function heatColor(rgb, frame, lastWriteFrame) {
  if (lastWriteFrame == null || lastWriteFrame < 0) return `rgb(${rgb.join(',')})`;
  const t = Math.max(0, 1 - (frame - lastWriteFrame) / FADE_FRAMES);
  const r = Math.round(255 * t + rgb[0] * (1 - t));
  const g = Math.round(255 * t + rgb[1] * (1 - t));
  const b = Math.round(255 * t + rgb[2] * (1 - t));
  return `rgb(${r},${g},${b})`;
}

const MemoryMap = () => {
  const [, setTick] = useState(0);

  useEffect(() => subscribeRuntime(() => setTick((t) => t + 1)), []);

  const bus = getRuntime().bus;

  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: '10px 12px',
      background: '#000',
      color: '#33ff66',
      fontFamily: "'Courier New', Courier, monospace",
      fontSize: '13px',
      lineHeight: 1.5,
      overflow: 'auto',
    }}>
      <div>RAM / ROM LAYOUT</div>
      <div>--------------------------------</div>
      {!bus ? (
        <div>status: no memory attached</div>
      ) : (
        <>
          <div style={{ marginTop: 4 }}>
            RAM   $000000-$1FFFFF  (2MB, mirrors to $3FFFFF)
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${RAM_COLS}, 1fr)`,
            gap: '1px',
            margin: '4px 0 10px',
          }}>
            {Array.from({ length: RAM_BLOCK_COUNT }, (_, i) => (
              <span
                key={i}
                title={`$${(i * RAM_BLOCK_SIZE).toString(16).padStart(6, '0')}`}
                style={{
                  fontSize: '11px',
                  lineHeight: '11px',
                  textAlign: 'center',
                  color: heatColor(RAM_RGB, bus.frame, bus.ramBlockWriteFrame[i]),
                }}
              >
                █
              </span>
            ))}
          </div>

          {DEVICE_REGIONS.map((r) => (
            <div key={r.label} style={{ marginBottom: 3 }}>
              <span style={{ color: heatColor(r.rgb, bus.frame, r.key ? bus.deviceWriteFrame[r.key] : -1) }}>
                ████{' '}
              </span>
              {r.label}
            </div>
          ))}

          <div style={{ marginTop: 6 }}>--------------------------------</div>
          <div>
            status: live — {RAM_BLOCK_SIZE / 1024}K/block, {' '}
            {bus.stats.sccWrites + bus.stats.iwmWrites + bus.stats.viaWrites} device writes
          </div>
        </>
      )}
    </div>
  );
};

export default MemoryMap;
