import { NavLink } from 'react-router-dom';

const items = [
  { to: '/', label: 'ホーム', icon: '🏠' },
  { to: '/words', label: '単語', icon: '📚' },
  { to: '/stats', label: '統計', icon: '📊' },
  { to: '/settings', label: '設定', icon: '⚙️' }
];

export function BottomNav() {
  return (
    <nav className="bottom-nav">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
          end={item.to === '/'}
        >
          <span className="bottom-nav-icon">{item.icon}</span>
          <span className="bottom-nav-label">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
