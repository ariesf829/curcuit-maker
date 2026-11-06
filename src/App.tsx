import { Canvas } from './components/Canvas';
import { CodePanel } from './components/CodePanel';
import { FileMenu } from './components/FileMenu';
import { NetPanel } from './components/NetPanel';
import { Palette } from './components/Palette';

export default function App() {
  return (
    <div className="app">
      <header>
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path d="M3 12h4l2-6 4 12 2-6h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <strong>ESP32 Circuit Simulator</strong>
        <span className="phase">Beta</span>
        <FileMenu />
      </header>
      <Palette />
      <div className="workspace">
        <main>
          <Canvas />
        </main>
        <CodePanel />
      </div>
      <NetPanel />
    </div>
  );
}
