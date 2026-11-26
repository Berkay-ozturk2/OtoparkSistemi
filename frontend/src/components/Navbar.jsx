import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { homePathForRole } from '../auth/roles';
import { roleLabel } from '../utils/format';
import LotSelector from './LotSelector';
import useParkingHub from '../realtime/useParkingHub';
import { getViolations } from '../api/operator';
import { getPermits } from '../api/admin';

/**
 * Menü rozetleri: açık ihlal sayısı (operatör/yönetici) ve bekleyen engelli izni sayısı (yönetici).
 * SignalR ViolationDetected / ViolationResolved / PermitsChanged olaylarıyla güncellenir.
 */
function useOpsBadges(role) {
  const isOps = role === 'Operator' || role === 'Admin';
  const isAdmin = role === 'Admin';
  const [violations, setViolations] = useState(0);
  const [permits, setPermits] = useState(0);
  const timer = useRef(null);

  const loadViolations = useCallback(() => {
    if (!isOps) return;
    getViolations({ status: 'Open' })
      .then((list) => setViolations(Array.isArray(list) ? list.length : 0))
      .catch(() => {});
  }, [isOps]);

  const loadPermits = useCallback(() => {
    if (!isAdmin) return;
    getPermits('Pending')
      .then((list) => setPermits(Array.isArray(list) ? list.length : 0))
      .catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    setViolations(0);
    setPermits(0);
    loadViolations();
    loadPermits();
    const t = timer;
    return () => t.current && clearTimeout(t.current);
  }, [loadViolations, loadPermits]);

  const debouncedViolations = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(loadViolations, 600);
  };

  useParkingHub(
    {
      onViolationDetected: debouncedViolations,
      onViolationResolved: debouncedViolations,
      onPermitsChanged: (data) => {
        if (data && typeof data.pendingCount === 'number') setPermits(data.pendingCount);
        else loadPermits();
      },
      onReconnected: () => {
        loadViolations();
        loadPermits();
      },
    },
    { withAuth: true, enabled: isOps },
  );

  return { violations, permits: isAdmin ? permits : 0 };
}

function CountBadge({ count, variant = 'danger', className = '' }) {
  if (!count) return null;
  return <span className={`badge rounded-pill text-bg-${variant} nav-count-badge ${className}`}>{count > 99 ? '99+' : count}</span>;
}

const PUBLIC_LINKS = [
  { to: '/', label: 'Ana Sayfa', icon: 'bi-house-door', end: true },
  { to: '/aracim-nerede', label: 'Aracım Nerede?', icon: 'bi-geo-alt' },
  { to: '/yol-tarifi', label: 'Yol Tarifi', icon: 'bi-signpost-split' },
  { to: '/ucret-ode', label: 'Ücret Öde', icon: 'bi-credit-card' },
];

const DRIVER_LINKS = [
  { to: '/surucu', label: 'Panelim', icon: 'bi-speedometer2', end: true },
  { to: '/surucu/rezervasyon', label: 'Rezervasyon', icon: 'bi-calendar-check' },
];

const OPERATOR_LINKS = [
  { to: '/operator', label: 'Canlı İzleme', icon: 'bi-broadcast', end: true },
  { to: '/operator/onay-kuyrugu', label: 'Onay Kuyruğu', icon: 'bi-ui-checks' },
  { to: '/operator/aktif-araclar', label: 'Aktif Araçlar', icon: 'bi-car-front' },
  { to: '/operator/ihlaller', label: 'İhlaller', icon: 'bi-exclamation-diamond', badgeKey: 'violations' },
  { to: '/operator/manuel-gecis', label: 'Manuel Geçiş', icon: 'bi-sign-turn-right' },
  { to: '/operator/kamera-testi', label: 'Kamera Testi', icon: 'bi-camera-video' },
];

const ADMIN_LINKS = [
  { to: '/yonetim', label: 'Yönetim Paneli', icon: 'bi-grid-1x2', end: true },
  { to: '/yonetim/otoparklar', label: 'Otoparklar ve Kroki', icon: 'bi-buildings' },
  { to: '/yonetim/engelli-izinleri', label: 'Engelli İzinleri', icon: 'bi-person-wheelchair', badgeKey: 'permits', badgeVariant: 'warning' },
  { to: '/yonetim/tarifeler', label: 'Tarifeler ve Ayarlar', icon: 'bi-tags' },
  { to: '/yonetim/kullanicilar', label: 'Kullanıcılar', icon: 'bi-people' },
  { to: '/yonetim/terk-edilmis', label: 'Terk Edilmiş Araçlar', icon: 'bi-exclamation-octagon' },
  { divider: true },
  { to: '/yonetim/raporlar/doluluk', label: 'Doluluk Raporu', icon: 'bi-bar-chart-line' },
  { to: '/yonetim/raporlar/gelir', label: 'Gelir Raporu', icon: 'bi-cash-coin' },
  { divider: true },
  { to: '/yonetim/denetim-kayitlari', label: 'Denetim Kayıtları', icon: 'bi-journal-text' },
  { to: '/yonetim/kvkk-talepleri', label: 'KVKK Talepleri', icon: 'bi-shield-lock' },
];

/** Role göre menü yapısı */
function buildMenu(role) {
  switch (role) {
    case 'Admin':
      return [
        { to: '/yonetim', label: 'Panel', icon: 'bi-grid-1x2', end: true },
        { dropdown: true, label: 'Yönetim', icon: 'bi-gear', base: '/yonetim', items: ADMIN_LINKS },
        { dropdown: true, label: 'Operatör', icon: 'bi-broadcast', base: '/operator', items: OPERATOR_LINKS },
        { dropdown: true, label: 'Genel', icon: 'bi-globe2', items: PUBLIC_LINKS },
      ];
    case 'Operator':
      return [...OPERATOR_LINKS, { dropdown: true, label: 'Genel', icon: 'bi-globe2', items: PUBLIC_LINKS }];
    case 'Driver':
      return [...PUBLIC_LINKS, ...DRIVER_LINKS];
    default:
      return PUBLIC_LINKS;
  }
}

function NavDropdown({ item, pathname, badges = {} }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const active = item.base ? pathname.startsWith(item.base) : false;
  const total = item.items.reduce((sum, l) => sum + (l.badgeKey ? badges[l.badgeKey] || 0 : 0), 0);

  return (
    <li className={`nav-item dropdown ${open ? 'show' : ''}`} ref={ref}>
      <button
        type="button"
        className={`nav-link dropdown-toggle btn btn-link ${active ? 'active' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <i className={`bi ${item.icon} me-1`} />
        {item.label}
        <CountBadge count={total} className="ms-1" />
      </button>
      <ul className={`dropdown-menu dropdown-menu-end shadow ${open ? 'show' : ''}`}>
        {item.items.map((l, i) =>
          l.divider ? (
            <li key={`d-${i}`}>
              <hr className="dropdown-divider" />
            </li>
          ) : (
            <li key={l.to}>
              <NavLink to={l.to} end={l.end} className="dropdown-item d-flex align-items-center gap-2">
                <i className={`bi ${l.icon}`} />
                {l.label}
                {l.badgeKey && <CountBadge count={badges[l.badgeKey]} variant={l.badgeVariant || 'danger'} className="ms-auto" />}
              </NavLink>
            </li>
          ),
        )}
      </ul>
    </li>
  );
}

export default function Navbar() {
  const { user, isAuthenticated, logout } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const userRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setExpanded(false);
    setUserOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!userOpen) return undefined;
    const onDoc = (e) => {
      if (userRef.current && !userRef.current.contains(e.target)) setUserOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [userOpen]);

  const menu = buildMenu(user?.role);
  const badges = useOpsBadges(isAuthenticated ? user?.role : null);

  const doLogout = () => {
    logout();
    navigate('/');
  };

  const initials = (user?.fullName || user?.email || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toLocaleUpperCase('tr-TR');

  return (
    <nav className="navbar navbar-expand-xl navbar-dark app-navbar sticky-top">
      <div className="container-fluid px-3 px-lg-4">
        <Link className="navbar-brand d-flex align-items-center gap-2" to={isAuthenticated ? homePathForRole(user?.role) : '/'}>
          <span className="brand-logo">
            <i className="bi bi-p-square-fill" />
          </span>
          <span className="brand-text">
            Akıllı<span className="brand-accent">Park</span>
          </span>
        </Link>

        <button
          className="navbar-toggler"
          type="button"
          aria-controls="mainNav"
          aria-expanded={expanded}
          aria-label="Menüyü aç/kapat"
          onClick={() => setExpanded((e) => !e)}
        >
          <span className="navbar-toggler-icon" />
        </button>

        <div className={`collapse navbar-collapse ${expanded ? 'show' : ''}`} id="mainNav">
          <ul className="navbar-nav me-auto mb-2 mb-xl-0">
            {menu.map((item) =>
              item.dropdown ? (
                <NavDropdown key={item.label} item={item} pathname={location.pathname} badges={badges} />
              ) : (
                <li className="nav-item" key={item.to}>
                  <NavLink to={item.to} end={item.end} className="nav-link">
                    <i className={`bi ${item.icon} me-1`} />
                    {item.label}
                    {item.badgeKey && <CountBadge count={badges[item.badgeKey]} variant={item.badgeVariant || 'danger'} className="ms-1" />}
                  </NavLink>
                </li>
              ),
            )}
          </ul>

          <LotSelector variant="navbar" className="me-xl-3 mb-2 mb-xl-0" />

          {isAuthenticated ? (
            <div className={`dropdown user-menu ${userOpen ? 'show' : ''}`} ref={userRef}>
              <button
                type="button"
                className="btn btn-link nav-link d-flex align-items-center gap-2 text-white text-decoration-none px-0"
                onClick={() => setUserOpen((o) => !o)}
                aria-expanded={userOpen}
              >
                <span className="avatar-circle">{initials}</span>
                <span className="d-flex flex-column text-start lh-sm">
                  <span className="fw-semibold small">{user?.fullName || user?.email}</span>
                  <span className="user-role">{roleLabel(user?.role)}</span>
                </span>
                <i className="bi bi-chevron-down small" />
              </button>
              <ul className={`dropdown-menu dropdown-menu-end shadow ${userOpen ? 'show' : ''}`}>
                <li className="px-3 py-2 small text-secondary">{user?.email}</li>
                <li>
                  <Link className="dropdown-item" to={homePathForRole(user?.role)}>
                    <i className="bi bi-speedometer2 me-2" />
                    Panelim
                  </Link>
                </li>
                <li>
                  <Link className="dropdown-item" to="/kvkk">
                    <i className="bi bi-shield-check me-2" />
                    KVKK Aydınlatma Metni
                  </Link>
                </li>
                <li>
                  <hr className="dropdown-divider" />
                </li>
                <li>
                  <button type="button" className="dropdown-item text-danger" onClick={doLogout}>
                    <i className="bi bi-box-arrow-right me-2" />
                    Çıkış Yap
                  </button>
                </li>
              </ul>
            </div>
          ) : (
            <div className="d-flex gap-2">
              <NavLink to="/giris" className="btn btn-outline-light btn-sm">
                <i className="bi bi-box-arrow-in-right me-1" />
                Giriş Yap
              </NavLink>
              <NavLink to="/kayit" className="btn btn-accent btn-sm">
                <i className="bi bi-person-plus me-1" />
                Kayıt Ol
              </NavLink>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
