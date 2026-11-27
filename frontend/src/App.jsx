import { Link, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './auth/ProtectedRoute';
import { ROLES } from './auth/roles';

// Herkese açık
import AnaSayfa from './pages/public/AnaSayfa';
import AracimNerede from './pages/public/AracimNerede';
import UcretOde from './pages/public/UcretOde';
import Giris from './pages/public/Giris';
import KayitOl from './pages/public/KayitOl';
import KvkkAydinlatma from './pages/public/KvkkAydinlatma';
import YolTarifi from './pages/public/YolTarifi';

// Sürücü
import SurucuPanel from './pages/driver/Panel';
import Rezervasyon from './pages/driver/Rezervasyon';
import Abonelik from './pages/driver/Abonelik';

// Operatör
import CanliIzleme from './pages/operator/CanliIzleme';
import OnayKuyrugu from './pages/operator/OnayKuyrugu';
import AktifAraclar from './pages/operator/AktifAraclar';
import ManuelGecis from './pages/operator/ManuelGecis';
import KameraTesti from './pages/operator/KameraTesti';
import AjanOfisi from './pages/operator/AjanOfisi';
import Ihlaller from './pages/operator/Ihlaller';

// Yönetici
import Dashboard from './pages/admin/Dashboard';
import Tarifeler from './pages/admin/Tarifeler';
import Kullanicilar from './pages/admin/Kullanicilar';
import TerkEdilmis from './pages/admin/TerkEdilmis';
import DolulukRaporu from './pages/admin/DolulukRaporu';
import GelirRaporu from './pages/admin/GelirRaporu';
import DenetimKayitlari from './pages/admin/DenetimKayitlari';
import KvkkTalepleri from './pages/admin/KvkkTalepleri';
import Otoparklar from './pages/admin/Otoparklar';
import EngelliIzinleri from './pages/admin/EngelliIzinleri';
import Abonelikler from './pages/admin/Abonelikler';

function NotFound() {
  return (
    <div className="text-center py-5">
      <div className="display-1 fw-bold text-primary">404</div>
      <h1 className="h4">Sayfa bulunamadı</h1>
      <p className="text-secondary">Aradığınız sayfa taşınmış veya hiç var olmamış olabilir.</p>
      <Link to="/" className="btn btn-primary">
        <i className="bi bi-house-door me-2" />
        Ana sayfaya dön
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Herkese açık sayfalar */}
        <Route index element={<AnaSayfa />} />
        <Route path="aracim-nerede" element={<AracimNerede />} />
        <Route path="ucret-ode" element={<UcretOde />} />
        <Route path="yol-tarifi" element={<YolTarifi />} />
        <Route path="giris" element={<Giris />} />
        <Route path="kayit" element={<KayitOl />} />
        <Route path="kvkk" element={<KvkkAydinlatma />} />

        {/* Sürücü */}
        <Route path="surucu" element={<ProtectedRoute roles={[ROLES.Driver]} />}>
          <Route index element={<SurucuPanel />} />
          <Route path="rezervasyon" element={<Rezervasyon />} />
          <Route path="abonelik" element={<Abonelik />} />
        </Route>

        {/* Operatör (Yönetici de erişebilir) */}
        <Route path="operator" element={<ProtectedRoute roles={[ROLES.Operator, ROLES.Admin]} />}>
          <Route index element={<CanliIzleme />} />
          <Route path="onay-kuyrugu" element={<OnayKuyrugu />} />
          <Route path="aktif-araclar" element={<AktifAraclar />} />
          <Route path="ihlaller" element={<Ihlaller />} />
          <Route path="manuel-gecis" element={<ManuelGecis />} />
          <Route path="kamera-testi" element={<KameraTesti />} />
          <Route path="ajan-ofisi" element={<AjanOfisi />} />
        </Route>

        {/* Yönetici */}
        <Route path="yonetim" element={<ProtectedRoute roles={[ROLES.Admin]} />}>
          <Route index element={<Dashboard />} />
          <Route path="otoparklar" element={<Otoparklar />} />
          <Route path="engelli-izinleri" element={<EngelliIzinleri />} />
          <Route path="abonelikler" element={<Abonelikler />} />
          <Route path="tarifeler" element={<Tarifeler />} />
          <Route path="kullanicilar" element={<Kullanicilar />} />
          <Route path="terk-edilmis" element={<TerkEdilmis />} />
          <Route path="raporlar/doluluk" element={<DolulukRaporu />} />
          <Route path="raporlar/gelir" element={<GelirRaporu />} />
          <Route path="denetim-kayitlari" element={<DenetimKayitlari />} />
          <Route path="kvkk-talepleri" element={<KvkkTalepleri />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
