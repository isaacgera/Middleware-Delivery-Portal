import { NavLink, Outlet } from 'react-router-dom';

/** App shell: header with brand + nav, routed content, and the branding footer. */
export function Layout() {
  const year = new Date().getFullYear();
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          Middleware <span>Delivery Portal</span>
        </div>
        <nav className="app-nav" aria-label="Primary">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/estimates">Estimates</NavLink>
          <NavLink to="/catalogue">Catalogue</NavLink>
          <NavLink to="/menu-cards">Menu Cards</NavLink>
        </nav>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <footer className="app-footer">
        <span className="app-footer-brand">Powered by Forj&eacute;</span>
        <span className="app-footer-copy">&copy; {year} Isaac A Gera. All rights reserved.</span>
      </footer>
    </div>
  );
}
