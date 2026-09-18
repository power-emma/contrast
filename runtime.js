import { CPU, Bus, SCREEN_BASE, SCREEN_BYTES } from './68k';
import romUrl from './mac.rom?url';
import diskUrl from './boot.dsk?url';
import disk2Url from './paint.dsk?url';

// Unwrap a DiskCopy 4.2 image to its raw sector data, else pass through
function rawSectorsFromDsk(bytes) {
  if (bytes.length >= 84) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dataSize = dv.getUint32(0x40, false);
    const tagSize = dv.getUint32(0x44, false);
    const magic = dv.getUint16(0x52, false);
    if (magic === 0x0100 && dataSize > 0 && 84 + dataSize + tagSize === bytes.length) {
      return bytes.subarray(84, 84 + dataSize);
    }
  }
  return bytes;
}

// Run the CPU continuously off setTimeout, decoupled from rendering
const INSTRUCTIONS_PER_CHUNK = 100000;
// Panels redraw far slower than the 60fps video canvas
const PANEL_RENDER_INTERVAL_MS = 66;
// How often to refresh the effective clock speed estimate
const MHZ_SAMPLE_MS = 250;

// Re-exported here since videoscreen.jsx imports it from this module
export { SCREEN_BASE, SCREEN_BYTES };

// A single shared CPU/Bus instance sampled by every window
let runtime = null;

export function getRuntime() {
  if (runtime) return runtime;

  runtime = { cpu: null, bus: null, error: null, listeners: new Set(), videoListeners: new Set() };
  const notify = () => runtime.listeners.forEach((fn) => fn());
  const notifyVideo = () => runtime.videoListeners.forEach((fn) => fn());

  Promise.all([
    fetch(romUrl).then((res) => res.arrayBuffer()),
    fetch(diskUrl).then((res) => res.arrayBuffer()),
    fetch(disk2Url).then((res) => res.arrayBuffer()),
  ])
    .then(([romBuf, diskBuf, disk2Buf]) => {
      const bus = new Bus(
        new Uint8Array(romBuf),
        new Uint8Array(diskBuf),
        rawSectorsFromDsk(new Uint8Array(disk2Buf)),
      );
      const cpu = new CPU(bus);
      cpu.reset();
      runtime.bus = bus;
      runtime.cpu = cpu;
      runtime.mhz = 0;
      notify();

      // Effective throughput as instructions/second, not cycle accurate
      let mhzSampleTime = performance.now();
      let mhzSampleInstrs = cpu.instructionCount;

      const runLoop = () => {
        if (cpu.halted) return;
        cpu.run(INSTRUCTIONS_PER_CHUNK);
        setTimeout(runLoop, 0);
      };
      setTimeout(runLoop, 0);

      // Real rAF video loop, advancing one simulated scanline per frame
      const videoLoop = () => {
        bus.advanceFrame();
        notifyVideo();
        if (!cpu.halted) requestAnimationFrame(videoLoop);
      };
      requestAnimationFrame(videoLoop);

      let lastRender = 0;
      const renderLoop = (now) => {
        if (now - lastRender >= PANEL_RENDER_INTERVAL_MS) {
          lastRender = now;

          const elapsed = now - mhzSampleTime;
          if (elapsed >= MHZ_SAMPLE_MS) {
            const instrs = cpu.instructionCount - mhzSampleInstrs;
            runtime.mhz = (instrs / elapsed) / 1000;
            mhzSampleTime = now;
            mhzSampleInstrs = cpu.instructionCount;
          }

          notify();
        }
        if (!cpu.halted) requestAnimationFrame(renderLoop);
        else notify();
      };
      requestAnimationFrame(renderLoop);
    })
    .catch((err) => {
      runtime.error = err;
      notify();
    });

  return runtime;
}

// Subscribe to throttled panel updates. Returns an unsubscribe function
export function subscribeRuntime(fn) {
  const rt = getRuntime();
  rt.listeners.add(fn);
  return () => rt.listeners.delete(fn);
}

// Subscribe to 60fps video frame updates. Returns an unsubscribe function
export function subscribeVideoFrame(fn) {
  const rt = getRuntime();
  rt.videoListeners.add(fn);
  return () => rt.videoListeners.delete(fn);
}
