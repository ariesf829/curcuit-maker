import { Canvas } from './components/Canvas';
import { NetPanel } from './components/NetPanel';
import { Palette } from './components/Palette';

export default function App() {
  return (
    <div className="app">
      <header>
        <strong>ESP32 Circuit Simulator</strong>
        <span className="phase">Phase 1 · editor &amp; connectivity</span>
      </header>
      <Palette />
      <main>
        <Canvas />
      </main>
      <NetPanel />
    </div>
  );
}
