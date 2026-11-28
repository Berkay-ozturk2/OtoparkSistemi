import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { homePathForRole } from './roles';

/**
 * Rol bazlı koruma. Düzen (layout) rotası olarak kullanılır:
 *   <Route element={<ProtectedRoute roles={['Admin']} />}> ... </Route>
 * children verilirse Outlet yerine onları çizer.
 */
export default function ProtectedRoute({ roles, children }) {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/giris" replace state={{ from: location.pathname + location.search }} />;
  }

  if (roles && roles.length && !roles.includes(user?.role)) {
    return (
      <div className="container py-5">
        <div className="empty-state card-soft p-5 text-center mx-auto" style={{ maxWidth: 560 }}>
          <i aria-hidden="true" className="bi bi-shield-lock display-4 text-danger" />
          <h1 className="h4 mt-3">Bu sayfaya erişim yetkiniz yok</h1>
          <p className="text-secondary mb-4">
            Hesabınızın rolü bu bölümü açmaya yetmiyor. Yetki gerekiyorsa yöneticinize başvurun.
          </p>
          <Link to={homePathForRole(user?.role)} className="btn btn-primary">
            <i aria-hidden="true" className="bi bi-house-door me-2" />
            Kendi panelime dön
          </Link>
        </div>
      </div>
    );
  }

  return children ?? <Outlet />;
}
