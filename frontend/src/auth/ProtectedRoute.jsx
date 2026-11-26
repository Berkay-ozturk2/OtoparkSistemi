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
          <i className="bi bi-shield-lock display-4 text-danger" />
          <h2 className="h4 mt-3">Bu sayfaya erişim yetkiniz yok</h2>
          <p className="text-secondary mb-4">
            Bu bölüm yalnızca yetkili roller tarafından görüntülenebilir.
          </p>
          <Link to={homePathForRole(user?.role)} className="btn btn-primary">
            <i className="bi bi-house-door me-2" />
            Kendi panelime dön
          </Link>
        </div>
      </div>
    );
  }

  return children ?? <Outlet />;
}
