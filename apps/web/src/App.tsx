import { Link, Outlet } from 'react-router-dom';

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand">AI Reading Partner</Link>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
