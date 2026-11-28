import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { canAccessPath, homePathForRole } from '../../auth/roles';
import ErrorAlert from '../../components/ErrorAlert';
import { roleLabel } from '../../utils/format';

const DEMO_ACCOUNTS = [
  { email: 'admin@otopark.local', password: 'Admin123!', role: 'Admin', icon: 'bi-person-gear' },
  { email: 'operator@otopark.local', password: 'Operator123!', role: 'Operator', icon: 'bi-person-badge' },
  { email: 'surucu@otopark.local', password: 'Surucu123!', role: 'Driver', icon: 'bi-person' },
];

export default function Giris() {
  const { login, isAuthenticated, user, clearSessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (isAuthenticated && !busy) {
    return <Navigate to={homePathForRole(user?.role)} replace />;
  }

  const submit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('E-posta ve parola zorunludur.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const u = await login(email, password);
      clearSessionExpired();
      const target = from && from !== '/giris' && canAccessPath(u.role, from) ? from : homePathForRole(u.role);
      navigate(target, { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrapper py-lg-4">
      <div className="card overflow-hidden">
        <div className="row g-0">
          <div className="col-md-5 auth-side p-4 p-lg-5 d-flex flex-column justify-content-between">
            <div>
              <div className="d-flex align-items-center gap-2 mb-4">
                <span className="brand-logo">
                  <i aria-hidden="true" className="bi bi-p-square-fill" />
                </span>
                <span className="brand-text fw-bold">
                  Akıllı<span className="brand-accent">Park</span>
                </span>
              </div>
              <h1 className="h3 fw-bold">Hoş geldiniz</h1>
              <p className="text-white-50">
                Sürücü panelinden araçlarınızı ve rezervasyonlarınızı yönetin; görevliler canlı izleme ekranına,
                yöneticiler raporlara buradan ulaşır.
              </p>
            </div>
            <ul className="list-unstyled small text-white-50 mb-0 mt-4">
              <li className="mb-2">
                <i aria-hidden="true" className="bi bi-camera-video me-2 text-accent" />
                Plaka tanıma ile temassız giriş-çıkış
              </li>
              <li className="mb-2">
                <i aria-hidden="true" className="bi bi-broadcast me-2 text-accent" />
                Anlık doluluk ve kroki
              </li>
              <li>
                <i aria-hidden="true" className="bi bi-shield-lock me-2 text-accent" />
                KVKK uyumlu veri işleme
              </li>
            </ul>
          </div>
          <div className="col-md-7 p-4 p-lg-5 bg-white">
            <h2 className="h4 mb-4">Giriş Yap</h2>
            <ErrorAlert error={error} className="mb-3" />
            <form onSubmit={submit} noValidate>
              <div className="mb-3">
                <label className="form-label" htmlFor="login-email">
                  E-posta
                </label>
                <div className="input-group">
                  <span className="input-group-text">
                    <i aria-hidden="true" className="bi bi-envelope" />
                  </span>
                  <input
                    id="login-email"
                    type="email"
                    className="form-control"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>
              <div className="mb-4">
                <label className="form-label" htmlFor="login-pw">
                  Parola
                </label>
                <div className="input-group">
                  <span className="input-group-text">
                    <i aria-hidden="true" className="bi bi-key" />
                  </span>
                  <input
                    id="login-pw"
                    type={showPw ? 'text' : 'password'}
                    className="form-control"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => setShowPw((s) => !s)}
                    aria-label={showPw ? 'Parolayı gizle' : 'Parolayı göster'}
                  >
                    <i aria-hidden="true" className={`bi ${showPw ? 'bi-eye-slash' : 'bi-eye'}`} />
                  </button>
                </div>
              </div>
              <button type="submit" className="btn btn-primary btn-lg w-100" disabled={busy}>
                {busy ? <span className="spinner-border spinner-border-sm me-2" /> : <i aria-hidden="true" className="bi bi-box-arrow-in-right me-2" />}
                Giriş Yap
              </button>
            </form>
            <p className="text-center mt-3 mb-0">
              Hesabınız yok mu? <Link to="/kayit">Sürücü olarak kayıt olun</Link>
            </p>

            <hr className="my-4" />
            <div className="small text-secondary mb-2">
              <i aria-hidden="true" className="bi bi-info-circle me-1" />
              Demo hesapları (tıklayınca form doldurulur):
            </div>
            <div className="d-flex flex-column gap-1">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  type="button"
                  key={a.email}
                  className="demo-account btn btn-light text-start d-flex align-items-center gap-3 border-0"
                  onClick={() => {
                    setEmail(a.email);
                    setPassword(a.password);
                    setError(null);
                  }}
                >
                  <i aria-hidden="true" className={`bi ${a.icon} fs-4 text-primary`} />
                  <span className="flex-grow-1">
                    <span className="d-block fw-semibold small">{roleLabel(a.role)}</span>
                    <span className="d-block small text-secondary">
                      {a.email} · <code>{a.password}</code>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
