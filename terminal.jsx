import { React } from 'react';

// Shared terminal-style readout used by the CPU / VIA / memory panels.
const Terminal = ({ lines = [] }) => (
  <div style={{
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    background: '#000',
    color: '#33ff66',
    fontFamily: "'Courier New', Courier, monospace",
    fontSize: '13px',
    lineHeight: '1.5',
    whiteSpace: 'pre',
    overflow: 'auto',
  }}>
    {lines.map((line, i) => <div key={i}>{line}</div>)}
    <span style={{ animation: 'contrast-blink 1s steps(1) infinite' }}>_</span>
    <style>{'@keyframes contrast-blink { 50% { opacity: 0; } }'}</style>
  </div>
);

export default Terminal;
