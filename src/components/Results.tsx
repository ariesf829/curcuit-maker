import { formatAmps, formatVolts, useSimulation } from './useSimulation';

export function Results() {
  const sim = useSimulation();
  return (
    <section>
      <h3>Simulation</h3>
      <p className={`status ${sim.converged ? 'ok' : 'bad'}`}>
        {sim.converged ? `Solved in ${sim.iterations} iteration${sim.iterations === 1 ? '' : 's'}` : 'Did not converge'}
      </p>
      {sim.warnings.map((w) => (
        <p key={w} className="warn">
          ⚠ {w}
        </p>
      ))}
      {sim.elements.length > 0 && (
        <table className="results">
          <thead>
            <tr>
              <th>Part</th>
              <th>Voltage</th>
              <th>Current</th>
            </tr>
          </thead>
          <tbody>
            {sim.elements
              .filter((e) => e.role !== 'internal')
              .map((e) => (
                <tr key={e.id}>
                  <td>
                    {e.partName}
                    {e.label === 'upper half' || e.label === 'lower half' ? ` (${e.label})` : ''}
                    {['coil', 'contact', 'collector-emitter', 'drain-source'].includes(e.label) ? ` (${e.label})` : ''}
                  </td>
                  <td>{formatVolts(e.voltage)}</td>
                  <td>{formatAmps(e.current)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
      <p className="hint">Current is positive when it flows from a part's first pin to its second. Sources show negative while delivering power.</p>
    </section>
  );
}
