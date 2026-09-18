import { CPU, Bus, SCREEN_BASE, SCREEN_BYTES } from './68k';
import romUrl from './mac.rom?url';
import diskUrl from './boot.dsk?url';
import disk2Url from './paint.dsk?url';

// Unwrap a DiskCopy 4.2 image to its raw sector data, else pass through
export function rawSectorsFromDsk(bytes) {
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

  runtime = { cpu: null, bus: null, error: null, stopped: false, listeners: new Set(), videoListeners: new Set() };
  // Capture the instance so the async loops keep working on *this* runtime even
  // after stopRuntime() nulls the module-level reference on shutdown.
  const rt = runtime;
  const notify = () => { if (rt.stopped) return; rt.listeners.forEach((fn) => fn()); };
  const notifyVideo = () => { if (rt.stopped) return; rt.videoListeners.forEach((fn) => fn()); };

  Promise.all([
    fetch(romUrl).then((res) => res.arrayBuffer()),
    fetch(diskUrl).then((res) => res.arrayBuffer()),
    fetch(disk2Url).then((res) => res.arrayBuffer()),
  ])
    .then(([romBuf, diskBuf, disk2Buf]) => {
      // Bail out if the app was closed while the ROM/disks were still loading
      if (rt.stopped) return;
      const bus = new Bus(
        new Uint8Array(romBuf),
        new Uint8Array(diskBuf),
        rawSectorsFromDsk(new Uint8Array(disk2Buf)),
      );
      // Label the drives with the images they booted from
      if (bus.drives[0]) bus.drives[0].imageName = 'boot.dsk';
      if (bus.drives[1]) bus.drives[1].imageName = 'paint.dsk';
      const cpu = new CPU(bus);
      cpu.reset();
      rt.bus = bus;
      rt.cpu = cpu;
      rt.mhz = 0;
      notify();

      // Effective throughput as instructions/second, not cycle accurate
      let mhzSampleTime = performance.now();
      let mhzSampleInstrs = cpu.instructionCount;

      const runLoop = () => {
        if (rt.stopped || cpu.halted) return;
        cpu.run(INSTRUCTIONS_PER_CHUNK);
        setTimeout(runLoop, 0);
      };
      setTimeout(runLoop, 0);

      // Real rAF video loop, advancing one simulated scanline per frame
      const videoLoop = () => {
        if (rt.stopped) return;
        bus.advanceFrame();
        notifyVideo();
        if (!cpu.halted) requestAnimationFrame(videoLoop);
      };
      requestAnimationFrame(videoLoop);

      let lastRender = 0;
      const renderLoop = (now) => {
        if (rt.stopped) return;
        if (now - lastRender >= PANEL_RENDER_INTERVAL_MS) {
          lastRender = now;

          const elapsed = now - mhzSampleTime;
          if (elapsed >= MHZ_SAMPLE_MS) {
            const instrs = cpu.instructionCount - mhzSampleInstrs;
            rt.mhz = (instrs / elapsed) / 1000;
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
      if (rt.stopped) return;
      rt.error = err;
      notify();
    });

  return runtime;
}

// Tear down the shared CPU/Bus: stops every loop, drops subscribers, and clears
// the singleton so the next getRuntime() boots a fresh core. Called when the
// Contrast app is closed.
export function stopRuntime() {
  if (!runtime) return;
  runtime.stopped = true;
  if (runtime.cpu) runtime.cpu.halted = true;
  runtime.listeners.clear();
  runtime.videoListeners.clear();
  runtime = null;
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
