import { useRef, useState } from 'react';
import { EXAMPLES } from '../examples';
import { loadExample, openProject, projectJson } from '../state/project';

export function FileMenu() {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');

  const save = () => {
    const url = URL.createObjectURL(new Blob([projectJson()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'circuit.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const open = async (file: File) => {
    try {
      openProject(await file.text());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="filemenu">
      <button onClick={save}>Save</button>
      <button onClick={() => input.current?.click()}>Open…</button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void open(f);
        }}
      />
      <select
        value=""
        aria-label="Load an example"
        onChange={(e) => {
          const ex = EXAMPLES.find((x) => x.id === e.target.value);
          if (ex && window.confirm('Load this example? Your current circuit will be replaced.')) loadExample(ex);
        }}
      >
        <option value="">Examples…</option>
        {EXAMPLES.map((x) => (
          <option key={x.id} value={x.id}>
            {x.title}
          </option>
        ))}
      </select>
      {error && (
        <span className="file-error" role="alert" onClick={() => setError('')}>
          {error}
        </span>
      )}
    </div>
  );
}
