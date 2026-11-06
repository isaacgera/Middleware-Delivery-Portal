import { useEffect, useState } from 'react';
import { api, ApiClientError } from '../api/client';

interface HealthResponse {
  status: string;
  service: string;
  version: string;
  db: string;
  time: string;
}

/**
 * Placeholder dashboard for Stage 0. Confirms the web app can reach the API by calling the
 * health endpoint. Real dashboards (volume / by-product / value) arrive in Stage 9.
 */
export function DashboardPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<HealthResponse>('/api/health')
      .then(setHealth)
      .catch((e: unknown) => {
        setError(e instanceof ApiClientError ? e.message : 'Could not reach the API');
      });
  }, []);

  return (
    <section>
      <h1>Dashboard</h1>
      <p style={{ color: 'var(--text-light)' }}>
        Phase 1 — Estimation &amp; Planning. This is the Stage 0 scaffold; estimation features
        arrive in later stages.
      </p>

      <div className="card" style={{ marginTop: 'var(--space-5)', maxWidth: 480 }}>
        <h2 style={{ marginTop: 0, fontSize: 'var(--fs-lg)' }}>API connectivity</h2>
        {error && (
          <p>
            <span className="badge warn">offline</span> {error}
            <br />
            <small style={{ color: 'var(--text-light)' }}>
              Start the API with <code>npm run dev:api</code>.
            </small>
          </p>
        )}
        {!error && !health && <p>Checking&hellip;</p>}
        {health && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            <li>
              Status:{' '}
              <span className={`badge ${health.status === 'ok' ? 'ok' : 'warn'}`}>
                {health.status}
              </span>
            </li>
            <li>
              Database: <span className="badge">{health.db}</span>
            </li>
            <li style={{ color: 'var(--text-light)' }}>
              {health.service} v{health.version}
            </li>
          </ul>
        )}
      </div>
    </section>
  );
}
