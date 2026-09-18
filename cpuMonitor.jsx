import { React, useEffect, useState } from 'react';
import Terminal from './terminal';
import { getRuntime, subscribeRuntime } from './runtime';

const LOADING_LINES = ['MC68000', '-----------------------', 'status: loading mac.rom...'];

// Live register/status readout for the shared 68000 core
const CpuMonitor = () => {
  const [lines, setLines] = useState(LOADING_LINES);

  useEffect(() => {
    const rt = getRuntime();
    const update = () => {
      if (rt.error) {
        setLines(['MC68000', '-----------------------', `status: failed to load mac.rom (${rt.error.message})`]);
      } else if (rt.cpu) {
        const mhz = (rt.mhz || 0).toFixed(2);
        setLines([...rt.cpu.statusLines(), ` clock: ~${mhz} MHz (effective)`]);
      }
    };
    update();
    return subscribeRuntime(update);
  }, []);

  return <Terminal lines={lines} />;
};

export default CpuMonitor;
