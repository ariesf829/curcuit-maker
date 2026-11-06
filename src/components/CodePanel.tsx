import { useEffect, useRef } from 'react';
import { useScript } from '../state/scriptStore';

const STATUS_LABEL = { stopped: 'Stopped', running: 'Running', finished: 'Finished', error: 'Error' } as const;

export function CodePanel() {
  const { source, status, error, output, setSource, run, stop, clearOutput } = useScript();
  const consoleRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  return (
    <section className="code-panel">
      <div className="code-bar">
        <button onClick={run} disabled={status === 'running'}>
          ▶ Run
        </button>
        <button onClick={stop} disabled={status === 'stopped'}>
          ■ Stop
        </button>
        <span className={`code-status ${status}`}>{STATUS_LABEL[status]}</span>
        {error && (
          <span className="code-error">
            {error.line > 0 ? `Line ${error.line}: ` : ''}
            {error.message}
          </span>
        )}
      </div>
      <div className="code-body">
        <textarea
          className="code-editor"
          value={source}
          spellCheck={false}
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Tab') return;
            e.preventDefault();
            const t = e.currentTarget;
            const { selectionStart: a, selectionEnd: b } = t;
            setSource(source.slice(0, a) + '  ' + source.slice(b));
            requestAnimationFrame(() => t.setSelectionRange(a + 2, a + 2));
          }}
        />
        <div className="code-console">
          <div className="code-bar">
            <strong>Serial monitor</strong>
            <button onClick={clearOutput}>Clear</button>
          </div>
          <pre ref={consoleRef}>{output.join('\n')}</pre>
        </div>
      </div>
    </section>
  );
}
