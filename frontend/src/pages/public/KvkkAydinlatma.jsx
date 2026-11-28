import { useState } from 'react';
import { createPrivacyRequest } from '../../api/privacy';
import PageHeader from '../../components/PageHeader';
import ErrorAlert from '../../components/ErrorAlert';
import { normalizePlate } from '../../utils/plate';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TYPES = [
  { value: 'Info', label: 'Verilerim hakkında bilgi almak istiyorum' },
  { value: 'Delete', label: 'Verilerimin silinmesini / anonimleştirilmesini istiyorum' },
  { value: 'Objection', label: 'Veri işlemeye itiraz ediyorum' },
];

function BasvuruFormu() {
  const [form, setForm] = useState({ fullName: '', email: '', plate: '', type: 'Info', message: '' });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const errors = {};
  if (form.fullName.trim().length < 3) errors.fullName = 'Ad soyad giriniz.';
  if (!EMAIL_RE.test(form.email.trim())) errors.email = 'Geçerli bir e-posta giriniz.';
  if (form.message.trim().length < 10) errors.message = 'Talebinizi en az 10 karakterle açıklayınız.';

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const cls = (k) => (touched && errors[k] ? 'is-invalid' : '');

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length) return;
    setBusy(true);
    setError(null);
    try {
      await createPrivacyRequest({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        plate: normalizePlate(form.plate),
        type: form.type,
        message: form.message.trim(),
      });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="text-center py-4">
        <i aria-hidden="true" className="bi bi-envelope-check display-4 text-success" />
        <h3 className="h5 mt-3">Başvurunuz alındı</h3>
        <p className="text-secondary mb-3">
          KVKK md. 13 uyarınca başvurunuz en geç <strong>30 gün</strong> içinde sonuçlandırılarak e-posta adresinize
          bildirilecektir.
        </p>
        <button
          type="button"
          className="btn btn-outline-primary"
          onClick={() => {
            setDone(false);
            setTouched(false);
            setForm({ fullName: '', email: '', plate: '', type: 'Info', message: '' });
          }}
        >
          Yeni başvuru
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <ErrorAlert error={error} className="mb-3" />
      <div className="mb-3">
        <label className="form-label" htmlFor="pr-name">
          Ad Soyad
        </label>
        <input id="pr-name" className={`form-control ${cls('fullName')}`} value={form.fullName} onChange={set('fullName')} />
        <div className="invalid-feedback">{errors.fullName}</div>
      </div>
      <div className="mb-3">
        <label className="form-label" htmlFor="pr-email">
          E-posta
        </label>
        <input id="pr-email" type="email" className={`form-control ${cls('email')}`} value={form.email} onChange={set('email')} />
        <div className="invalid-feedback">{errors.email}</div>
      </div>
      <div className="mb-3">
        <label className="form-label" htmlFor="pr-plate">
          Plaka <span className="text-secondary small">(isteğe bağlı)</span>
        </label>
        <input id="pr-plate" className="form-control text-uppercase" placeholder="34 ABC 123" value={form.plate} onChange={set('plate')} maxLength={12} />
      </div>
      <div className="mb-3">
        <label className="form-label" htmlFor="pr-type">
          Talep türü
        </label>
        <select id="pr-type" className="form-select" value={form.type} onChange={set('type')}>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="mb-3">
        <label className="form-label" htmlFor="pr-msg">
          Açıklama
        </label>
        <textarea id="pr-msg" rows={4} className={`form-control ${cls('message')}`} value={form.message} onChange={set('message')} maxLength={2000} />
        <div className="invalid-feedback">{errors.message}</div>
      </div>
      <button type="submit" className="btn btn-primary w-100" disabled={busy}>
        {busy ? <span className="spinner-border spinner-border-sm me-2" /> : <i aria-hidden="true" className="bi bi-send me-2" />}
        Başvuruyu Gönder
      </button>
    </form>
  );
}

export default function KvkkAydinlatma() {
  return (
    <div>
      <PageHeader
        icon="bi-shield-check"
        title="KVKK Aydınlatma Metni"
        subtitle="6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında bilgilendirme ve ilgili kişi başvurusu"
      />
      <div className="row g-4">
        <div className="col-lg-7">
          <div className="card">
            <div className="card-body p-4 legal-text">
              <p>
                AkıllıPark Görüntü İşleme Destekli Akıllı Otopark Sistemi (&quot;Sistem&quot;) olarak, 6698 sayılı Kişisel
                Verilerin Korunması Kanunu (&quot;KVKK&quot;) md. 10 uyarınca, kişisel verilerinizin işlenmesine ilişkin
                sizi bilgilendirmek isteriz.
              </p>

              <h2>1. Veri sorumlusu</h2>
              <p>
                Kişisel verileriniz, otopark işletmecisi sıfatıyla veri sorumlusu tarafından aşağıda açıklanan
                kapsamda işlenmektedir. (Bu sistem Gazi Üniversitesi BMT-315 dersi kapsamında geliştirilmiş bir pilot
                uygulamadır.)
              </p>

              <h2>2. İşlenen kişisel veriler</h2>
              <ul>
                <li>
                  <strong>Araç plakası</strong> ve giriş/çıkış zamanları, park süresi, bölge bilgisi
                </li>
                <li>
                  <strong>Plaka bölgesi görüntü kırpıntısı</strong> (yalnızca okunamayan plakaların görevli tarafından
                  doğrulanması için; araç içi ve yüz görüntüsü işlenmez, kamera görüntüleri kaydedilmez)
                </li>
                <li>Kayıtlı kullanıcılar için ad soyad, e-posta, telefon</li>
                <li>Ödeme işlem bilgisi (tutar, tarih, kartın yalnızca son 4 hanesi; kart numarası saklanmaz)</li>
                <li>Sistem güvenliği için işlem (denetim) kayıtları ve IP adresi</li>
              </ul>

              <h2>3. İşleme amaçları</h2>
              <ul>
                <li>Otoparka giriş-çıkışın otomatik yönetilmesi ve bariyer kontrolü</li>
                <li>Park ücretinin hesaplanması ve tahsili, rezervasyon hizmeti</li>
                <li>Boş yer ve doluluk bilgisinin sunulması, aracınızın konumunun size gösterilmesi</li>
                <li>Terk edilmiş araçların tespiti, güvenlik ve yasal yükümlülüklerin yerine getirilmesi</li>
              </ul>

              <h2>4. Hukuki sebepler</h2>
              <p>
                Verileriniz KVKK md. 5/2-(c) <em>sözleşmenin kurulması ve ifası</em>, (ç) <em>hukuki yükümlülük</em> ve
                (f) <em>meşru menfaat</em> hukuki sebeplerine dayanılarak işlenir. Pazarlama amaçlı iletiler yalnızca
                <strong> açık rızanız</strong> (md. 5/1) bulunması hâlinde gönderilir.
              </p>

              <h2>5. Aktarım</h2>
              <p>
                Ödeme işlemleri için yalnızca gerekli bilgiler lisanslı ödeme kuruluşuna (iyzico) aktarılır. Yetkili
                kamu kurumlarının talepleri dışında üçüncü kişilere aktarım yapılmaz.
              </p>

              <h2>6. Saklama süresi</h2>
              <p>
                Giriş-çıkış kayıtlarındaki plaka bilgisi, sistem ayarlarında belirlenen saklama süresi (varsayılan 30 gün)
                sonunda otomatik olarak anonimleştirilir (geri döndürülemez şekilde özetlenir). Mali kayıtlar ilgili
                mevzuattaki süreler boyunca saklanır.
              </p>

              <h2>7. Haklarınız (KVKK md. 11)</h2>
              <ul>
                <li>Kişisel verinizin işlenip işlenmediğini öğrenme ve bilgi talep etme</li>
                <li>İşleme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme</li>
                <li>Eksik veya yanlış işlenmişse düzeltilmesini isteme</li>
                <li>KVKK md. 7 çerçevesinde silinmesini veya yok edilmesini isteme</li>
                <li>Münhasıran otomatik sistemlerle analiz sonucu aleyhinize bir sonuca itiraz etme</li>
                <li>Kanuna aykırı işleme nedeniyle zarara uğramanız hâlinde zararın giderilmesini talep etme</li>
              </ul>
              <p className="mb-0">
                Başvurularınızı yandaki form aracılığıyla iletebilirsiniz. Başvurular en geç 30 gün içinde ücretsiz
                olarak sonuçlandırılır.
              </p>
            </div>
          </div>
        </div>
        <div className="col-lg-5">
          <div className="card position-sticky" style={{ top: 90 }}>
            <div className="card-header">
              <i aria-hidden="true" className="bi bi-envelope-paper me-2 text-accent" />
              İlgili Kişi Başvuru Formu
            </div>
            <div className="card-body">
              <BasvuruFormu />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
