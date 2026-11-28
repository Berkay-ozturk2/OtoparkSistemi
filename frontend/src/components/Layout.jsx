import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import ServerStatusBanner from './ServerStatusBanner';
import { useAuth } from '../auth/AuthContext';

/** Genel sayfa düzeni: üst menü + sunucu uyarısı + içerik + alt bilgi */
export default function Layout() {
  const location = useLocation();
  const { sessionExpired, clearSessionExpired } = useAuth();
  const wide = location.pathname.startsWith('/operator') || location.pathname.startsWith('/yonetim');

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="app-shell d-flex flex-column min-vh-100">
      <a href="#main-content" className="skip-link">
        İçeriğe geç
      </a>
      <Navbar />
      <ServerStatusBanner />
      {sessionExpired && (
        <div className="alert alert-info rounded-0 mb-0 border-0 d-flex align-items-center justify-content-center gap-2 py-2">
          <i className="bi bi-clock-history" aria-hidden="true" />
          Oturumunuz kapandı. Devam etmek için
          <Link to="/giris" onClick={clearSessionExpired} className="alert-link">
            yeniden giriş yapın
          </Link>
          .
          <button type="button" className="btn-close ms-2" aria-label="Kapat" onClick={clearSessionExpired} />
        </div>
      )}
      <main id="main-content" tabIndex={-1} className={`flex-grow-1 py-4 ${wide ? 'container-fluid px-3 px-lg-4' : 'container-xl'}`}>
        {/* Sayfa değişince içerik bir kez yumuşakça belirir */}
        <div key={location.pathname} className="page-enter">
          <Outlet />
        </div>
      </main>
      <footer className="app-footer py-3 mt-auto">
        <div className="container-xl d-flex flex-wrap justify-content-between align-items-center gap-2 small">
          <span>
            <i aria-hidden="true" className="bi bi-p-square-fill me-1 text-accent" />
            AkıllıPark — Görüntü İşleme Destekli Akıllı Otopark Sistemi · Gazi Üniversitesi BMT-315
          </span>
          <span className="d-flex gap-3">
            <Link to="/kvkk">KVKK Aydınlatma Metni</Link>
            <Link to="/aracim-nerede">Aracım Nerede?</Link>
            <Link to="/ucret-ode">Ücret Öde</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
