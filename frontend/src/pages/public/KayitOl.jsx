import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { homePathForRole } from '../../auth/roles';
import ErrorAlert from '../../components/ErrorAlert';
import { useToast } from '../../components/Toast';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(f) {
  const e = {};
  if (f.fullName.trim().length < 3) e.fullName = 'Ad soyad en az 3 karakter olmalıdır.';
  if (!EMAIL_RE.test(f.email.trim())) e.email = 'Geçerli bir e-posta adresi girin.';
  const phone = f.phone.replace(/\D/g, '');
  if (phone.length < 10 || phone.length > 12) e.phone = 'Geçerli bir telefon numarası girin (ör. 0532 123 45 67).';
  if (f.password.length < 8) e.password = 'Parola en az 8 karakter olmalıdır.';
  else if (!/[A-ZÇĞİÖŞÜ]/.test(f.password) || !/\d/.test(f.password))
    e.password = 'Parola en az bir büyük harf ve bir rakam içermelidir.';
  if (f.password !== f.password2) e.password2 = 'Parolalar eşleşmiyor.';
  if (!f.kvkkAccepted) e.kvkkAccepted = 'Devam etmek için aydınlatma metnini okuduğunuzu onaylamalısınız.';
  return e;
}

export default function KayitOl() {
  const { register, isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    password2: '',
    kvkkAccepted: false,
    marketingConsent: false,
  });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (isAuthenticated && !busy) {
    return <Navigate to={homePathForRole(user?.role)} replace />;
  }

  const errors = validate(form);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const cls = (k) => (touched && errors[k] ? 'is-invalid' : '');

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length) return;
    setBusy(true);
    setError(null);
    try {
      const u = await register({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        password: form.password,
        kvkkAccepted: true,
        marketingConsent: form.marketingConsent,
      });
      toast.success('Kaydınız oluşturuldu. Hoş geldiniz!');
      navigate(homePathForRole(u.role || 'Driver'), { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 680 }}>
      <div className="card">
        <div className="card-body p-4 p-lg-5">
          <div className="d-flex align-items-center gap-3 mb-4">
            <div className="page-header-icon">
              <i aria-hidden="true" className="bi bi-person-plus" />
            </div>
            <div>
              <h1 className="h4 mb-0">Sürücü Kaydı</h1>
              <div className="text-secondary small">Araçlarınızı ekleyin, rezervasyon yapın, park geçmişinizi görün.</div>
            </div>
          </div>

          <ErrorAlert error={error} className="mb-3" />

          <form onSubmit={submit} noValidate>
            <div className="row g-3">
              <div className="col-12">
                <label className="form-label" htmlFor="reg-name">
                  Ad Soyad
                </label>
                <input id="reg-name" className={`form-control ${cls('fullName')}`} value={form.fullName} onChange={set('fullName')} autoComplete="name" />
                <div className="invalid-feedback">{errors.fullName}</div>
              </div>
              <div className="col-md-6">
                <label className="form-label" htmlFor="reg-email">
                  E-posta
                </label>
                <input id="reg-email" type="email" className={`form-control ${cls('email')}`} value={form.email} onChange={set('email')} autoComplete="email" />
                <div className="invalid-feedback">{errors.email}</div>
              </div>
              <div className="col-md-6">
                <label className="form-label" htmlFor="reg-phone">
                  Telefon
                </label>
                <input
                  id="reg-phone"
                  type="tel"
                  className={`form-control ${cls('phone')}`}
                  value={form.phone}
                  onChange={set('phone')}
                  placeholder="0532 123 45 67"
                  autoComplete="tel"
                />
                <div className="invalid-feedback">{errors.phone}</div>
              </div>
              <div className="col-md-6">
                <label className="form-label" htmlFor="reg-pw">
                  Parola
                </label>
                <input id="reg-pw" type="password" className={`form-control ${cls('password')}`} value={form.password} onChange={set('password')} autoComplete="new-password" />
                <div className="invalid-feedback">{errors.password}</div>
                <div className="form-text">En az 8 karakter, bir büyük harf ve bir rakam.</div>
              </div>
              <div className="col-md-6">
                <label className="form-label" htmlFor="reg-pw2">
                  Parola (tekrar)
                </label>
                <input id="reg-pw2" type="password" className={`form-control ${cls('password2')}`} value={form.password2} onChange={set('password2')} autoComplete="new-password" />
                <div className="invalid-feedback">{errors.password2}</div>
              </div>

              <div className="col-12">
                <div className="border rounded-3 p-3 bg-light">
                  <div className="form-check mb-2">
                    <input
                      id="reg-kvkk"
                      type="checkbox"
                      className={`form-check-input ${cls('kvkkAccepted')}`}
                      checked={form.kvkkAccepted}
                      onChange={set('kvkkAccepted')}
                    />
                    <label className="form-check-label" htmlFor="reg-kvkk">
                      <Link to="/kvkk" target="_blank" rel="noopener">
                        KVKK Aydınlatma Metni
                      </Link>
                      &apos;ni okudum ve kişisel verilerimin (ad, iletişim bilgileri, plaka, giriş-çıkış kayıtları)
                      otopark hizmetinin sunulması amacıyla işlendiği konusunda bilgilendirildim.{' '}
                      <span className="text-danger">*</span>
                    </label>
                    <div className="invalid-feedback">{errors.kvkkAccepted}</div>
                  </div>
                  <div className="form-check">
                    <input
                      id="reg-marketing"
                      type="checkbox"
                      className="form-check-input"
                      checked={form.marketingConsent}
                      onChange={set('marketingConsent')}
                    />
                    <label className="form-check-label" htmlFor="reg-marketing">
                      <span className="fw-semibold">(İsteğe bağlı)</span> Kampanya ve bilgilendirme amaçlı ileti
                      gönderilmesine <strong>açık rıza</strong> veriyorum. Bu onayı vermemeniz hizmetten yararlanmanızı
                      etkilemez ve dilediğiniz zaman geri alabilirsiniz.
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-lg w-100 mt-4" disabled={busy}>
              {busy ? <span className="spinner-border spinner-border-sm me-2" /> : <i aria-hidden="true" className="bi bi-check2-circle me-2" />}
              Kayıt Ol
            </button>
          </form>
          <p className="text-center mt-3 mb-0">
            Zaten hesabınız var mı? <Link to="/giris">Giriş yapın</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
