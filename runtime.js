import { CPU, Bus, SCREEN_BASE, SCREEN_BYTES } from './68k';
import romUrl from './mac.rom?url';

const INSTRUCTIONS_PER_FRAME = 4000;

// Screen geometry lives in bus.js (the memory controller's simulated
// video fetch address needs the same location); re-exported here since
// videoscreen.jsx already imports it from this module.
export { SCREEN_BASE, SCREEN_BYTES };

// A single shared CPU/Bus instance, stepped once per animation frame,
// so every window (register readout, video) observes the same machine
// instead of each spinning up its own divergent core.
let runtime = null;

export function getRuntime() {
  if (runtime) return runtime;

  runtime = { cpu: null, bus: null, error: null, listeners: new Set() };
  const notify = () => runtime.listeners.forEach((fn) => fn());

  fetch(romUrl)
    .then((res) => res.arrayBuffer())
    .then((buf) => {
      const bus = new Bus(new Uint8Array(buf));
      const cpu = new CPU(bus);
      cpu.reset();
      runtime.bus = bus;
      runtime.cpu = cpu;
      notify();

      const tick = () => {
        if (cpu.halted) {
          notify();
          return;
        }
        bus.advanceFrame();
        cpu.run(INSTRUCTIONS_PER_FRAME);
        notify();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })
    .catch((err) => {
      runtime.error = err;
      notify();
    });

  return runtime;
}

// Subscribe to per-frame updates (or ROM-load completion/failure).
// Returns an unsubscribe function.
export function subscribeRuntime(fn) {
  const rt = getRuntime();
  rt.listeners.add(fn);
  return () => rt.listeners.delete(fn);
}
