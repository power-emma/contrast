import { React, useEffect, useState } from 'react';
import { getRuntime, subscribeRuntime } from './runtime';
import { TRACK_COUNT } from './68k';

// How many frames a track stays hot after an access before fading back
const FADE_FRAMES = 30;
const COLS = 20;

const READ_RGB = [51, 255, 102];
const WRITE_RGB = [255, 138, 48];
const IDLE_RGB = [28, 40, 32];

// Blend a base colour toward idle by how many frames ago the track was touched
function heat(base, age) {
  const t = Math.max(0, 1 - age / FADE_FRAMES);
  const r = Math.round(base[0] * t + IDLE_RGB[0] * (1 - t));
  const g = Math.round(base[1] * t + IDLE_RGB[1] * (1 - t));
  const b = Math.round(base[2] * t + IDLE_RGB[2] * (1 - t));
  return `rgb(${r},${g},${b})`;
}

// Most recent of the track's read/write frames wins the colour
function trackColor(readFrame, writeFrame, frame) {
  const rAge = readFrame < 0 ? Infinity : frame - readFrame;
  const wAge = writeFrame < 0 ? Infinity : frame - writeFrame;
  if (rAge === Infinity && wAge === Infinity) return `rgb(${IDLE_RGB.join(',')})`;
  return wAge <= rAge ? heat(WRITE_RGB, wAge) : heat(READ_RGB, rAge);
}

const DriveGrid = ({ drive, activity, frame, index }) => {
  const label = index === 0 ? 'DRIVE 1 (internal)' : 'DRIVE 2 (external)';
  const present = !!(drive && drive.hasDisk);
  const head = drive ? drive.headTrack : 0;
  const state = present ? (drive.motor ? 'spinning' : 'idle') : 'no disk';

  return (
    <div style={{ marginBottom: 12 }}>
      <div>{label} [{state}]</div>
      <div style={{ opacity: 0.7, marginBottom: 4 }}>
        head @ track {String(head).padStart(2, '0')}/{TRACK_COUNT - 1}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 2 }}>
        {Array.from({ length: TRACK_COUNT }, (_, t) => {
          const isHead = present && t === head;
          return (
            <span
              key={t}
              title={`track ${t}`}
              style={{
                height: 12,
                boxSizing: 'border-box',
                background: present ? trackColor(activity.read[t], activity.write[t], frame) : `rgb(${IDLE_RGB.join(',')})`,
                border: isHead ? '1px solid #fff' : '1px solid rgba(255,255,255,0.06)',
                boxShadow: isHead ? '0 0 5px #fff' : 'none',
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

const DiskActivity = () => {
  const [, setTick] = useState(0);
  useEffect(() => subscribeRuntime(() => setTick((n) => n + 1)), []);

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
      <div>DISK ACTIVITY</div>
      <div>--------------------------------</div>
      {!bus ? (
        <div>status: no disks attached</div>
      ) : (
        <>
          <DriveGrid drive={bus.drives[0]} activity={bus.diskActivity[0]} frame={bus.frame} index={0} />
          <DriveGrid drive={bus.drives[1]} activity={bus.diskActivity[1]} frame={bus.frame} index={1} />
          <div>--------------------------------</div>
          <div style={{ fontSize: 11 }}>
            <span style={{ color: `rgb(${READ_RGB.join(',')})` }}>█</span> read{'   '}
            <span style={{ color: `rgb(${WRITE_RGB.join(',')})` }}>█</span> write{'   '}
            <span style={{ border: '1px solid #fff', padding: '0 3px' }}>head</span>
          </div>
        </>
      )}
    </div>
  );
};

export default DiskActivity;
