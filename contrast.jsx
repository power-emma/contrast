import { React, useEffect, useRef } from 'react';
import VideoScreen from './videoscreen';
import CpuMonitor from './cpuMonitor';
import MemoryMap from './memoryMap';
import MemoryController from './memoryController';
import DiskActivity from './diskActivity';
import { stopRuntime } from './runtime';

// Must match meta.x / meta.y in index.jsx for laying out the panels
const ORIGIN_X = 20;
const ORIGIN_Y = 40;
const GAP = 16;
const TERM_W = 460;
const TERM_H = 300;

const Contrast = ({ init }) => {
  const openWindow = init.openWindow || null;
  const closeWindow = init.closeWindow || null;
  const registerExit = init.registerExit || null;
  const windowId = init.windowId;
  const spawnedRef = useRef(false);
  // Ids of the four panel windows we spawn, so we can close them on exit
  const childIdsRef = useRef([]);

  useEffect(() => {
    if (!openWindow) return;

    if (!spawnedRef.current) {
      spawnedRef.current = true;

      const videoW = init.width || 560;
      const colX0 = ORIGIN_X + videoW + GAP;
      const colX1 = colX0 + TERM_W + GAP;
      const rowY0 = ORIGIN_Y;
      const rowY1 = ORIGIN_Y + TERM_H + GAP;

      childIdsRef.current = [
        openWindow(colX0, rowY0, TERM_H, TERM_W, '68000 CPU', <CpuMonitor />),
        openWindow(colX1, rowY0, TERM_H, TERM_W, 'Disk Activity', <DiskActivity />),
        openWindow(colX0, rowY1, TERM_H, TERM_W, 'RAM/ROM Layout', <MemoryMap />),
        openWindow(colX1, rowY1, TERM_H, TERM_W, 'Memory Controller', <MemoryController />),
      ];
    }

    // Closing the main video window tears down the whole app: the four panels
    // plus the shared 68000 emulator. Registration is idempotent by window id,
    // so StrictMode's remount in dev doesn't leave us unregistered.
    if (registerExit && typeof windowId === 'number') {
      registerExit(windowId, () => {
        if (closeWindow) childIdsRef.current.forEach((id) => closeWindow(id));
        stopRuntime();
      });
    }
  }, [windowId]);

  return <VideoScreen />;
};

export default Contrast;
