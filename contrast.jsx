import { React, useEffect, useRef } from 'react';
import Terminal from './terminal';
import VideoScreen from './videoscreen';
import CpuMonitor from './cpuMonitor';
import MemoryMap from './memoryMap';
import MemoryController from './memoryController';

// Must match meta.x / meta.y in index.jsx — used only to lay out the
// panels spawned alongside the video screen, since init doesn't carry
// this window's own position.
const ORIGIN_X = 20;
const ORIGIN_Y = 40;
const GAP = 16;
const TERM_W = 460;
const TERM_H = 300;

const VIA_LINES = [
  'VIA 6522 — INTERFACE ADAPTOR',
  '-----------------------------',
  ' ORA/IRA  00   DDRA  00',
  ' ORB/IRB  00   DDRB  00',
  ' T1C-L    00   T1C-H 00',
  ' T1L-L    00   T1L-H 00',
  ' T2C-L    00   T2C-H 00',
  ' SR       00   ACR   00',
  ' PCR      00   IFR   00',
  ' IER      00',
  '-----------------------------',
  'status: not connected to a bus',
];

const Contrast = ({ init }) => {
  const openWindow = init.openWindow || null;
  const spawnedRef = useRef(false);

  useEffect(() => {
    if (!openWindow || spawnedRef.current) return;
    spawnedRef.current = true;

    const videoW = init.width || 560;
    const colX0 = ORIGIN_X + videoW + GAP;
    const colX1 = colX0 + TERM_W + GAP;
    const rowY0 = ORIGIN_Y;
    const rowY1 = ORIGIN_Y + TERM_H + GAP;

    openWindow(colX0, rowY0, TERM_H, TERM_W, '68000 CPU', <CpuMonitor />);
    openWindow(colX1, rowY0, TERM_H, TERM_W, 'Interface Adaptor', <Terminal lines={VIA_LINES} />);
    openWindow(colX0, rowY1, TERM_H, TERM_W, 'RAM/ROM Layout', <MemoryMap />);
    openWindow(colX1, rowY1, TERM_H, TERM_W, 'Memory Controller', <MemoryController />);
  }, []);

  return <VideoScreen />;
};

export default Contrast;
