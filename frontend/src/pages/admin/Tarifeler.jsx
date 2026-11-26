import { useCallback, useEffect, useState } from 'react';
import { createTariff, deleteTariff, getSettings, getTariffs, updateSettings, updateTariff } from '../../api/admin';
import PageHeader from '../../components/PageHeader';
import Loading from '../../components/Loading';
import ErrorAlert from '../../components/ErrorAlert';
import EmptyState from '../../components/EmptyState';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import { useToast } from '../../components/Toast';
import { formatCurrency, formatDuration } from '../../utils/format';

const EMPTY_TARIFF = { name: '', minMinutes: 0, maxMinutes: 60, price: 0, isActive: true };

const SETTING_FIELDS = [
  { key: 'confidenceThreshold', label: 'Plaka güven eşiği', help: 'Bu değerin altındaki okumalar onay kuyruğuna düşer (0–1).', min: 0, max: 1, step: 0.01, suffix: '' },
  { key: 'freeMinutes', label: 'Ücretsiz süre', help: 'Bu süreden kısa kalışlar ücretsizdir.', min: 0, max: 240, step: 1, suffix: 'dk' },
  { key: 'gracePeriodMinutes', label: 'Ödeme sonrası çıkış süresi', help: 'Ödemeden sonra bu süre içinde çıkış serbesttir.', min: 0, max: 240, step: 1, suffix: 'dk' },
  { key: 'dailyMaxFee', label: 'Günlük azami ücret', help: '24 saatlik dilim için tavan ücret.', min: 0, max: 100000, step: 0.5, suffix: '₺' },
  { key: 'reservationHourlyPrice', label: 'Rezervasyon saatlik ücreti', help: 'Rezervasyon ön ödemesi saat başı.', min: 0, max: 10000, step: 0.5, suffix: '₺' },
  { key: 'abandonedThresholdHours', label: 'Terk edilmiş araç eşiği', help: 'Bu süreyi aşan açık oturumlar terk edilmiş sayılır (UC-09).', min: 1, max: 2000, step: 1, suffix: 'sa' },
  { key: 'dataRetentionDays', label: 'Veri saklama süresi (KVKK)', help: 'Bu süre sonunda plakalar anonimleştirilir.', min: 1, max: 3650, step: 1, suffix: 'gün' },
];

function TariffForm({ value, onChange }) {
  const set = (k, num = false) => (e) =>
    onChange({ ...value, [k]: e.target.type === 'checkbox' ? e.target.checked : num ? e.target.value === '' ? '' : Number(e.target.value) : e.target.value });
  return (
    <div className="row g-3">
      <div className="col-12">
        <label className="form-label" htmlFor="tf-name">
          Dilim adı
        </label>
        <input id="tf-name" className="form-control" value={value.name} onChange={set('name')} placeholder="ör. 1-2 saat" maxLength={60} />
      </div>
      <div className="col-sm-4">
        <label className="form-label" htmlFor="tf-min">
          Başlangıç (dk)
        </label>
        <input id="tf-min" type="number" min={0} className="form-control" value={value.minMinutes} onChange={set('minMinutes', true)} />
      </div>
      <div className="col-sm-4">
        <label className="form-label" htmlFor="tf-max">
          Bitiş (dk)
        </label>
        <input id="tf-max" type="number" min={1} className="form-control" value={value.maxMinutes} onChange={set('maxMinutes', true)} />
      </div>
      <div className="col-sm-4">
        <label className="form-label" htmlFor="tf-price">
          Ücret (₺)
        </label>
        <input id="tf-price" type="number" min={0} step={0.5} className="form-control" value={value.price} onChange={set('price', true)} />
      </div>
      <div className="col-12">
        <div className="form-check form-switch">
          <input id="tf-active" type="checkbox" className="form-check-input" checked={!!value.isActive} onChange={set('isActive')} />
          <label className="form-check-label" htmlFor="tf-active">
            Aktif
          </label>
        </div>
      </div>
      {value.minMinutes !== '' && value.maxMinutes !== '' && (
        <div className="col-12 small text-secondary">
          Bu dilim {formatDuration(value.minMinutes)} ile {formatDuration(value.maxMinutes)} arası kalışlara uygulanır.
        </div>
      )}
    </div>
  );
}

function validateTariff(t) {
  if (!String(t.name).trim()) return 'Dilim adı zorunludur.';
  if (t.minMinutes === '' || t.maxMinutes === '' || t.price === '') return 'Tüm alanları doldurunuz.';
  if (t.minMinutes < 0) return 'Başlangıç negatif olamaz.';
  if (t.maxMinutes <= t.minMinutes) return 'Bitiş süresi başlangıçtan büyük olmalıdır.';
  if (t.price < 0) return 'Ücret negatif olamaz.';
  return null;
}

/** UC-12: Fiyat tarifesini belirle + sistem ayarları */
export default function Tarifeler() {
  const toast = useToast();
  const [tariffs, setTariffs] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // { ...tariff } (id yoksa yeni)
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [t, s] = await Promise.all([getTariffs(), getSettings()]);
      setTariffs(Array.isArray(t) ? t : []);
      setSettings(s);
      setSettingsDirty(false);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sorted = [...tariffs].sort((a, b) => a.minMinutes - b.minMinutes);

  // Boşluk / çakışma uyarıları (yalnızca aktif dilimler)
  const warnings = [];
  const activeSorted = sorted.filter((t) => t.isActive);
  for (let i = 1; i < activeSorted.length; i += 1) {
    const prev = activeSorted[i - 1];
    const cur = activeSorted[i];
    if (cur.minMinutes > prev.maxMinutes) warnings.push(`${prev.maxMinutes}–${cur.minMinutes} dk arası için tarife yok.`);
    if (cur.minMinutes < prev.maxMinutes) warnings.push(`"${prev.name}" ile "${cur.name}" dilimleri çakışıyor.`);
  }

  const saveTariff = async () => {
    const v = validateTariff(editing);
    setFormError(v);
    if (v) return;
    setSaving(true);
    try {
      const body = {
        name: String(editing.name).trim(),
        minMinutes: Number(editing.minMinutes),
        maxMinutes: Number(editing.maxMinutes),
        price: Number(editing.price),
        isActive: !!editing.isActive,
      };
      if (editing.id) {
        await updateTariff(editing.id, { id: editing.id, ...body });
        toast.success('Tarife güncellendi.');
      } else {
        await createTariff(body);
        toast.success('Tarife eklendi.');
      }
      setEditing(null);
      const t = await getTariffs();
      setTariffs(Array.isArray(t) ? t : []);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (t) => {
    try {
      await updateTariff(t.id, { ...t, isActive: !t.isActive });
      setTariffs((list) => list.map((x) => (x.id === t.id ? { ...x, isActive: !t.isActive } : x)));
    } catch (err) {
      toast.error(err);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await deleteTariff(toDelete.id);
      setTariffs((list) => list.filter((x) => x.id !== toDelete.id));
      toast.success('Tarife silindi.');
      setToDelete(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setDeleting(false);
    }
  };

  const setSetting = (key) => (e) => {
    const v = e.target.value;
    setSettings((s) => ({ ...s, [key]: v === '' ? '' : Number(v) }));
    setSettingsDirty(true);
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    for (const f of SETTING_FIELDS) {
      const v = settings[f.key];
      if (v === '' || v === undefined || Number.isNaN(Number(v)) || v < f.min || v > f.max) {
        toast.warning(`${f.label}: ${f.min} ile ${f.max} arasında bir değer giriniz.`);
        return;
      }
    }
    setSettingsSaving(true);
    try {
      const res = await updateSettings(settings);
      if (res && typeof res === 'object') setSettings(res);
      setSettingsDirty(false);
      toast.success('Ayarlar kaydedildi.');
    } catch (err) {
      toast.error(err);
    } finally {
      setSettingsSaving(false);
    }
  };

  if (loading) return <Loading text="Tarifeler yükleniyor…" />;

  return (
    <div>
      <PageHeader
        icon="bi-tags"
        title="Tarifeler ve Ayarlar"
        subtitle="Süre dilimi tarifelerini ve ücretlendirme/KVKK ayarlarını yönetin."
        actions={
          <button
            type="button"
            className="btn btn-accent"
            onClick={() => {
              const last = sorted[sorted.length - 1];
              setFormError(null);
              setEditing({ ...EMPTY_TARIFF, minMinutes: last ? last.maxMinutes : 0, maxMinutes: last ? last.maxMinutes + 60 : 60 });
            }}
          >
            <i className="bi bi-plus-lg me-1" />
            Yeni Dilim
          </button>
        }
      />

      <ErrorAlert error={error} onRetry={load} className="mb-4" />

      <div className="row g-4">
        <div className="col-xl-7">
          <div className="card">
            <div className="card-header">
              <i className="bi bi-list-ol me-2 text-accent" />
              Süre Dilimi Tarifeleri
            </div>
            <div className="card-body p-0">
              {warnings.length > 0 && (
                <div className="alert alert-warning m-3 small">
                  <i className="bi bi-exclamation-triangle me-1" />
                  {warnings.join(' ')}
                </div>
              )}
              {sorted.length === 0 ? (
                <EmptyState icon="bi-tags" title="Tarife tanımlı değil">
                  &quot;Yeni Dilim&quot; ile ilk tarifeyi ekleyin.
                </EmptyState>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover">
                    <thead>
                      <tr>
                        <th>Ad</th>
                        <th>Süre aralığı</th>
                        <th className="text-end">Ücret</th>
                        <th>Aktif</th>
                        <th className="text-end">İşlemler</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((t) => (
                        <tr key={t.id} className={t.isActive ? '' : 'text-secondary'}>
                          <td className="fw-semibold">{t.name}</td>
                          <td className="small">
                            {t.minMinutes}–{t.maxMinutes} dk
                            <span className="text-secondary">
                              {' '}
                              ({formatDuration(t.minMinutes)} – {formatDuration(t.maxMinutes)})
                            </span>
                          </td>
                          <td className="text-end fw-bold">{formatCurrency(t.price)}</td>
                          <td>
                            <div className="form-check form-switch mb-0">
                              <input
                                type="checkbox"
                                className="form-check-input"
                                checked={!!t.isActive}
                                onChange={() => toggleActive(t)}
                                aria-label="Aktif"
                              />
                            </div>
                          </td>
                          <td className="text-end text-nowrap">
                            <button
                              type="button"
                              className="btn btn-sm btn-light me-1"
                              onClick={() => {
                                setFormError(null);
                                setEditing({ ...t });
                              }}
                              title="Düzenle"
                            >
                              <i className="bi bi-pencil" />
                            </button>
                            <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setToDelete(t)} title="Sil">
                              <i className="bi bi-trash" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="small text-secondary px-3 py-2 border-top">
                <i className="bi bi-info-circle me-1" />
                Ücretsiz süre altı ücretsizdir; aksi hâlde süreyi kapsayan aktif dilim uygulanır. 24 saati aşan sürelerde her
                tam gün için günlük azami ücret + kalan süre dilimi uygulanır.
              </div>
            </div>
          </div>
        </div>

        <div className="col-xl-5">
          <div className="card">
            <div className="card-header d-flex justify-content-between align-items-center">
              <span>
                <i className="bi bi-sliders me-2 text-accent" />
                Sistem Ayarları
              </span>
              {settingsDirty && <span className="badge text-bg-warning">Kaydedilmedi</span>}
            </div>
            <div className="card-body">
              {settings ? (
                <form onSubmit={saveSettings} noValidate>
                  {SETTING_FIELDS.map((f) => (
                    <div className="mb-3" key={f.key}>
                      <label className="form-label fw-semibold mb-1" htmlFor={`st-${f.key}`}>
                        {f.label}
                      </label>
                      <div className="input-group">
                        <input
                          id={`st-${f.key}`}
                          type="number"
                          className="form-control"
                          min={f.min}
                          max={f.max}
                          step={f.step}
                          value={settings[f.key] ?? ''}
                          onChange={setSetting(f.key)}
                        />
                        {f.suffix && <span className="input-group-text">{f.suffix}</span>}
                        {f.key === 'confidenceThreshold' && settings[f.key] !== '' && (
                          <span className="input-group-text">{Math.round(Number(settings[f.key]) * 100)}%</span>
                        )}
                      </div>
                      <div className="form-text">{f.help}</div>
                    </div>
                  ))}
                  <button type="submit" className="btn btn-primary w-100" disabled={settingsSaving || !settingsDirty}>
                    {settingsSaving ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-save me-2" />}
                    Ayarları Kaydet
                  </button>
                </form>
              ) : (
                <div className="text-secondary">Ayarlar yüklenemedi.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Modal
        show={!!editing}
        title={editing?.id ? 'Tarife dilimini düzenle' : 'Yeni tarife dilimi'}
        icon="bi-tag"
        onClose={saving ? undefined : () => setEditing(null)}
        footer={
          <>
            <button type="button" className="btn btn-light" onClick={() => setEditing(null)} disabled={saving}>
              Vazgeç
            </button>
            <button type="button" className="btn btn-primary" onClick={saveTariff} disabled={saving}>
              {saving && <span className="spinner-border spinner-border-sm me-2" />}
              Kaydet
            </button>
          </>
        }
      >
        {editing && (
          <>
            {formError && <div className="alert alert-danger py-2">{formError}</div>}
            <TariffForm value={editing} onChange={setEditing} />
          </>
        )}
      </Modal>

      <ConfirmModal
        show={!!toDelete}
        title="Tarifeyi sil"
        icon="bi-trash"
        variant="danger"
        confirmText="Sil"
        busy={deleting}
        onConfirm={doDelete}
        onCancel={() => setToDelete(null)}
        message={toDelete ? `"${toDelete.name}" dilimini silmek istediğinize emin misiniz? Silmek yerine pasif yapmayı da düşünebilirsiniz.` : ''}
      />
    </div>
  );
}
