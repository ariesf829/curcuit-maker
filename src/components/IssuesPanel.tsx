import { useCircuit } from '../state/circuitStore';
import { useIssues } from './useSimulation';

const ICON = { error: '⛔', warning: '⚠', info: 'ℹ' } as const;

export function IssuesPanel() {
  const issues = useIssues();
  const select = useCircuit((s) => s.select);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;

  return (
    <section>
      <h3>
        Checks ({errors} error{errors === 1 ? '' : 's'}, {warnings} warning{warnings === 1 ? '' : 's'})
      </h3>
      {issues.length === 0 && <p className="status ok">No problems found.</p>}
      <ul className="issues">
        {issues.map((i) => (
          <li
            key={i.id}
            className={`issue ${i.severity}`}
            onClick={() => i.partIds[0] && select({ kind: 'part', id: i.partIds[0] })}
          >
            <strong>
              {ICON[i.severity]} {i.title}
            </strong>
            <span>{i.detail}</span>
            {i.suggestion && (
              <span className="suggestion">
                <b>Suggested fix:</b> {i.suggestion}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
