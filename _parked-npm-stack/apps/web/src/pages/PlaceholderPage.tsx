/** Generic "coming in a later stage" placeholder for routes not yet implemented. */
export function PlaceholderPage({ title, stage }: { title: string; stage: string }) {
  return (
    <section>
      <h1>{title}</h1>
      <div className="card" style={{ marginTop: 'var(--space-5)' }}>
        <p style={{ margin: 0 }}>
          This area is part of <strong>{stage}</strong> and is not built yet. The Stage 0
          scaffold wires up routing, layout and the API connection only.
        </p>
      </div>
    </section>
  );
}
