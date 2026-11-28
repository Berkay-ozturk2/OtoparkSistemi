import { useEffect, useState } from 'react';
import { SERVER_STATUS_EVENT, request } from '../api/client';

/** Backend'e ulaşılamadığında sayfanın üstünde uyarı gösterir. */
export default function ServerStatusBanner() {
  const [offline, setOffline] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const onStatus = (e) => {
      if (e.detail?.source !== 'api') return;
      setOffline(!e.detail.online);
    };
    window.addEventListener(SERVER_STATUS_EVENT, onStatus);
    return () => window.removeEventListener(SERVER_STATUS_EVENT, onStatus);
  }, []);

  // Çevrimdışıyken 15 sn'de bir otomatik kontrol
  useEffect(() => {
    if (!offline) return undefined;
    const t = setInterval(() => {
      request('/api/parking/summary', { auth: false }).catch(() => {});
    }, 15000);
    return () => clearInterval(t);
  }, [offline]);

  if (!offline) return null;

  const retry = async () => {
    setChecking(true);
    try {
      await request('/api/parking/summary', { auth: false });
    } catch {
      // durum olayla güncellenir
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="server-banner alert alert-warning rounded-0 mb-0 border-0 border-bottom d-flex flex-wrap align-items-center justify-content-center gap-2 py-2" role="alert">
      <i aria-hidden="true" className="bi bi-wifi-off fs-5" />
      <strong>Sunucuya ulaşılamıyor.</strong>
      <span className="d-none d-sm-inline">Backend servisi (http://localhost:5080) kapalı olabilir; veriler güncel olmayabilir.</span>
      <button type="button" className="btn btn-sm btn-dark ms-2" onClick={retry} disabled={checking}>
        {checking ? <span className="spinner-border spinner-border-sm" aria-hidden="true" /> : <i aria-hidden="true" className="bi bi-arrow-clockwise" />}
        <span className="ms-1">Tekrar dene</span>
      </button>
    </div>
  );
}
