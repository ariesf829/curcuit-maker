import { Canvas } from './components/Canvas';
import { CodePanel } from './components/CodePanel';
import { FileMenu } from './components/FileMenu';
import { NetPanel } from './components/NetPanel';
import { Palette } from './components/Palette';

export default function App() {
  return (
    <div className="app">
      <header>
        <strong>ESP32 Circuit Simulator</strong>
        <span className="phase">Phase 7 · Projects</span>
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
