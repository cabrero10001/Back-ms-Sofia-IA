import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../store/auth';

const navItems = [
  { to: '/', label: 'Resumen', icon: '\u2302' },
  { to: '/casos', label: 'Casos', icon: '\uD83D\uDCC1' },
  { to: '/citas', label: 'Citas', icon: '\uD83D\uDCC5' },
];

export function Sidebar() {
  const { user, logout } = useAuthStore();

  return (
    <aside className="w-64 bg-primary-dark text-white min-h-screen flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-primary">
        <h1 className="text-xl font-bold">SOFIA</h1>
        <p className="text-sm text-blue-200 mt-1">Consultorio Juridico</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-6 py-3 text-sm transition-colors ${
                isActive
                  ? 'bg-primary text-white font-medium'
                  : 'text-blue-200 hover:bg-primary hover:text-white'
              }`
            }
          >
            <span>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* User info + logout */}
      <div className="p-4 border-t border-primary">
        <div className="text-sm">
          <p className="font-medium truncate">{user?.nombreCompleto}</p>
          <p className="text-blue-200 text-xs mt-0.5">
            {user?.rol === 'ADMIN_CONSULTORIO' ? 'Administrador' : 'Estudiante'}
          </p>
        </div>
        <button
          onClick={logout}
          className="mt-3 w-full text-left text-sm text-blue-200 hover:text-white transition-colors"
        >
          Cerrar sesion
        </button>
      </div>
    </aside>
  );
}
