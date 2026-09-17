import { React, useEffect, useState } from 'react';
import Terminal from './terminal';
import { getRuntime, subscribeRuntime } from './runtime';

const LOADING_LINES = ['MEMORY CONTROLLER', '-----------------------', 'status: loading mac.rom...'];

// Live readout of the shared Bus's memory-controller state (bus arbitration,
// wait states, contention stalls, device access counts — see
// Bus.statusLines() in 68k/bus.js).
const MemoryController = () => {
  const [lines, setLines] = useState(LOADING_LINES);

  useEffect(() => {
    const rt = getRuntime();
    const update = () => {
      if (rt.error) {
        setLines(['MEMORY CONTROLLER', '-----------------------', `status: failed to load mac.rom (${rt.error.message})`]);
      } else if (rt.bus) {
        setLines(rt.bus.statusLines());
      }
    };
    update();
    return subscribeRuntime(update);
  }, []);

  return <Terminal lines={lines} />;
};

export default MemoryController;
