import { React, useEffect, useRef, useState } from 'react';
import { getRuntime, subscribeRuntime, rawSectorsFromDsk } from './runtime';
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

// Terminal-styled button matching the panel's green-on-black theme
const btnStyle = {
  font: 'inherit',
  color: '#33ff66',
  background: 'transparent',
  border: '1px solid #33ff66',
  padding: '1px 8px',
  cursor: 'pointer',
};

const DriveGrid = ({ bus, drive, activity, frame, index, onChange }) => {
  const label = index === 0 ? 'DRIVE 1 (internal)' : 'DRIVE 2 (external)';
  const present = !!(drive && drive.hasDisk);
  const head = drive ? drive.headTrack : 0;
  const state = present ? (drive.motor ? 'spinning' : 'idle') : 'no disk';
  const fileRef = useRef(null);

  // Load a disk image from the host into this drive
  const handleLoad = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file || !bus) return;
    const buf = await file.arrayBuffer();
    // Unwrap DiskCopy 4.2 containers down to raw sectors, else use bytes as-is
    const bytes = rawSectorsFromDsk(new Uint8Array(buf));
    bus.insertDisk(index, bytes, file.name);
    if (onChange) onChange();
  };

  // Save this drive's current image (including any writes) to a host file
  const handleSave = () => {
    if (!drive || !drive.image || drive.image.length === 0) return;
    // Copy into a fresh buffer so the Blob owns bytes independent of the live image
    const blob = new Blob([drive.image.slice()], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = drive.imageName || `drive${index + 1}.dsk`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const name = present ? (drive.imageName || 'untitled') : null;

  return (
    <div style={{ marginBottom: 12 }}>
      <div>
        {label}{name ? ` — ${name}` : ''} [{state}]
      </div>
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
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button type="button" style={btnStyle} onClick={() => fileRef.current && fileRef.current.click()}>
          Load…
        </button>
        <button
          type="button"
          style={{ ...btnStyle, opacity: present ? 1 : 0.4, cursor: present ? 'pointer' : 'default' }}
          onClick={handleSave}
          disabled={!present}
        >
          Save
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".dsk,.img,.image,application/octet-stream"
          onChange={handleLoad}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  );
};

const DiskActivity = () => {
  const [, setTick] = useState(0);
  const rerender = () => setTick((n) => n + 1);
  useEffect(() => subscribeRuntime(rerender), []);

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
          <DriveGrid bus={bus} drive={bus.drives[0]} activity={bus.diskActivity[0]} frame={bus.frame} index={0} onChange={rerender} />
          <DriveGrid bus={bus} drive={bus.drives[1]} activity={bus.diskActivity[1]} frame={bus.frame} index={1} onChange={rerender} />
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
