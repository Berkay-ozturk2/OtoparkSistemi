import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAdminLots, updateLot, updateSlot } from '../../api/admin';
import useParkingLive from '../../realtime/useParkingLive';
import PageHeader from '../../components/PageHeader';
import ParkingMap, { STATE_LABEL, slotState } from '../../components/ParkingMap';
import LiveBadge from '../../components/LiveBadge';
import Loading from '../../components/Loading';
import ErrorAlert from '../../components/ErrorAlert';
import EmptyState from '../../components/EmptyState';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { useLot } from '../../lot/LotContext';
import { formatDateTime, formatPercent, slotTypeLabel } from '../../utils/format';

/** Krokide seçilen cebin düzenleme paneli: tür (Standart/Engelli) ve kullanım dışı */
function SlotPanel({ slot, zoneName, floorName, onClose, onSaved }) {
  const toast = useToast();
  const [type, setType] = useState(slot.type || 'Standard');
  const [isActive, setIsActive] = useState(slot.isActive !== false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setType(slot.type || 'Standard');
    setIsActive(slot.isActive !== false);
  }, [slot]);

  const dirty = type !== (slot.type || 'Standard') || isActive !== (slot.isActive !== false);
  const st = slotState(slot);

  const save = async (override) => {
    const body = { type, isActive, ...(override || {}) };
    setBusy(true);
    try {
      const res = await updateSlot(slot.id, body);
      onSaved({ ...slot, ...body, ...(res && typeof res === 'object' && res.code ? res : {}) });
      toast.success(`${slot.code} cebi güncellendi: ${slotTypeLabel(body.type)}${body.isActive ? '' : ', kullanım dışı'}.`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card border-primary-subtle shadow-sm">
      <div className="card-header d-flex align-items-center gap-2">
        <i className="bi bi-pencil-square text-accent" />
        <span>
          Cep <strong>{slot.code}</strong>
        </span>
        <button type="button" className="btn-close ms-auto" aria-label="Kapat" onClick={onClose} />
      </div>
      <div className="card-body">
        <dl className="row small mb-3">
          <dt className="col-5 text-secondary fw-normal">Bölge</dt>
          <dd className="col-7 mb-1">{zoneName || slot.zoneCode}</dd>
          <dt className="col-5 text-secondary fw-normal">Kat</dt>
          <dd className="col-7 mb-1">{floorName}</dd>
          <dt className="col-5 text-secondary fw-normal">Durum</dt>
          <dd className="col-7 mb-1">
            {STATE_LABEL[st]}
            {slot.hasViolation && <span className="badge text-bg-danger ms-1">İhlal</span>}
          </dd>
          {slot.updatedAt && (
            <>
              <dt className="col-5 text-secondary fw-normal">Güncelleme</dt>
              <dd className="col-7 mb-0">{formatDateTime(slot.updatedAt)}</dd>
            </>
          )}
        </dl>

        <div className="form-label small fw-semibold">Cep türü</div>
        <div className="btn-group w-100 mb-3" role="group" aria-label="Cep türü">
          <input type="radio" className="btn-check" id="sp-std" checked={type === 'Standard'} onChange={() => setType('Standard')} />
          <label className="btn btn-outline-success" htmlFor="sp-std">
            <i className="bi bi-p-square me-1" />
            Standart
          </label>
          <input type="radio" className="btn-check" id="sp-dis" checked={type === 'Disabled'} onChange={() => setType('Disabled')} />
          <label className="btn btn-outline-primary" htmlFor="sp-dis">
            <span aria-hidden="true">♿</span> Engelli
          </label>
        </div>

        <div className="form-check form-switch mb-3">
          <input className="form-check-input" type="checkbox" role="switch" id="sp-active" checked={!isActive} onChange={(e) => setIsActive(!e.target.checked)} />
          <label className="form-check-label" htmlFor="sp-active">
            Kullanım dışı (bakım, kapalı alan vb.)
          </label>
        </div>

        {type === 'Disabled' && (slot.type || 'Standard') !== 'Disabled' && (
          <div className="alert alert-info small py-2">
            Engelli cepler yalnızca onaylı izinli araçlara ayrılır; normal araçların boş yer sayısından düşer.
          </div>
        )}
        {!isActive && slot.isActive !== false && slot.isOccupied && (
          <div className="alert alert-warning small py-2">Cep şu anda dolu görünüyor; kullanım dışı bırakılınca boş yer sayımına girmez.</div>
        )}

        <div className="d-flex gap-2">
          <button type="button" className="btn btn-primary flex-grow-1" disabled={!dirty || busy} onClick={() => save()}>
            {busy ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-check2 me-1" />}
            Kaydet
          </button>
          <button
            type="button"
            className="btn btn-outline-primary"
            disabled={busy}
            title="Türü hemen değiştir"
            onClick={() => {
              const next = (slot.type || 'Standard') === 'Disabled' ? 'Standard' : 'Disabled';
              setType(next);
              save({ type: next });
            }}
          >
            {(slot.type || 'Standard') === 'Disabled' ? 'Standart yap' : '♿ Engelli yap'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Otopark bilgisi düzenleme penceresi */
function LotEditModal({ lot, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', address: '', description: '', isActive: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (lot) {
      setForm({ name: lot.name || '', address: lot.address || '', description: lot.description || '', isActive: lot.isActive !== false });
      setErr(null);
    }
  }, [lot]);

  const submit = async (e) => {
    e.preventDefault();
    if (form.name.trim().length < 3) return setErr('Otopark adı en az 3 karakter olmalıdır.');
    setBusy(true);
    try {
      const body = { name: form.name.trim(), address: form.address.trim(), description: form.description.trim(), isActive: form.isActive };
      const res = await updateLot(lot.code, body);
      toast.success('Otopark bilgileri güncellendi.');
      onSaved({ ...lot, ...body, ...(res && typeof res === 'object' && res.code ? res : {}) });
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      show={!!lot}
      title={`Otoparkı düzenle${lot ? ` — ${lot.code}` : ''}`}
      icon="bi-buildings"
      onClose={busy ? undefined : onClose}
      staticBackdrop={busy}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>
            Vazgeç
          </button>
          <button type="submit" form="lot-edit" className="btn btn-primary" disabled={busy}>
            {busy && <span className="spinner-border spinner-border-sm me-2" />}
            Kaydet
          </button>
        </>
      }
    >
      <form id="lot-edit" onSubmit={submit} noValidate>
        <div className="mb-2">
          <label htmlFor="le-name" className="form-label small fw-semibold">
            Ad
          </label>
          <input id="le-name" className="form-control" maxLength={120} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="mb-2">
          <label htmlFor="le-addr" className="form-label small fw-semibold">
            Adres
          </label>
          <input id="le-addr" className="form-control" maxLength={250} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
        </div>
        <div className="mb-3">
          <label htmlFor="le-desc" className="form-label small fw-semibold">
            Açıklama
          </label>
          <textarea id="le-desc" className="form-control" rows={3} maxLength={500} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </div>
        <div className="form-check form-switch">
          <input className="form-check-input" type="checkbox" role="switch" id="le-active" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
          <label className="form-check-label" htmlFor="le-active">
            Aktif (herkese açık listede ve otopark seçicide görünür)
          </label>
        </div>
        {err && <div className="alert alert-danger py-2 small mt-3 mb-0">{err}</div>}
      </form>
    </Modal>
  );
}

/** Yönetici: otoparklar ve kroki düzenleme (cep türü / kullanım dışı) */
export default function Otoparklar() {
  const { lotCode: ctxLot, reloadLots, lots: publicLots } = useLot();
  const [lots, setLots] = useState([]);
  const [lotsLoading, setLotsLoading] = useState(true);
  const [lotsError, setLotsError] = useState(null);
  const [selected, setSelected] = useState(ctxLot);
  const [editLot, setEditLot] = useState(null);
  const [selectedSlotCode, setSelectedSlotCode] = useState(null);

  const loadLots = useCallback(async () => {
    setLotsError(null);
    try {
      const res = await getAdminLots();
      setLots(Array.isArray(res) ? res : []);
    } catch (err) {
      setLotsError(err);
    } finally {
      setLotsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLots();
  }, [loadLots]);

  const live = useParkingLive({}, { lotCode: selected });
  const { lot, slots, zones, loading, error, hubStatus, reload, setSlots } = live;

  useEffect(() => {
    setSelectedSlotCode(null);
  }, [selected]);

  const selectedSlot = slots.find((s) => s.code === selectedSlotCode) || null;
  const zoneByCode = useMemo(() => Object.fromEntries(zones.map((z) => [z.code, z])), [zones]);
  const floorName = (f) => lot?.floors?.find((x) => Number(x.floor) === Number(f))?.name || `Kat ${f ?? 0}`;

  const stats = useMemo(() => {
    const disabled = slots.filter((s) => s.type === 'Disabled').length;
    const inactive = slots.filter((s) => s.isActive === false).length;
    return { total: slots.length, disabled, inactive };
  }, [slots]);

  // Herkese açık listedeki anlık sayılarla birleştir (doluluk sütunu için)
  const rows = lots.map((l) => ({ ...(publicLots.find((p) => p.code === l.code) || {}), ...l }));

  return (
    <div>
      <PageHeader
        icon="bi-buildings"
        title="Otoparklar ve Kroki"
        subtitle="Otopark bilgilerini düzenleyin; krokide bir cebe tıklayarak engelli/standart yapın veya kullanım dışı bırakın."
        actions={
          <button
            type="button"
            className="btn btn-outline-primary"
            onClick={() => {
              loadLots();
              reload();
            }}
            title="Yenile"
          >
            <i className="bi bi-arrow-clockwise" />
          </button>
        }
      />

      <ErrorAlert error={lotsError} onRetry={loadLots} className="mb-3" />

      <div className="card mb-4">
        <div className="card-body p-0">
          {lotsLoading ? (
            <Loading text="Otoparklar yükleniyor…" />
          ) : rows.length === 0 ? (
            <EmptyState icon="bi-buildings" title="Otopark bulunamadı" />
          ) : (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead>
                  <tr>
                    <th>Kod</th>
                    <th>Ad / Adres</th>
                    <th>Kat</th>
                    <th>Cep</th>
                    <th>Doluluk</th>
                    <th>Durum</th>
                    <th className="text-end">İşlemler</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => {
                    const active = l.code === selected;
                    return (
                      <tr key={l.code} className={active ? 'table-active' : ''} style={{ cursor: 'pointer' }} onClick={() => setSelected(l.code)}>
                        <td>
                          <span className="badge text-bg-primary">{l.code}</span>
                        </td>
                        <td>
                          <div className="fw-semibold">{l.name}</div>
                          <div className="small text-secondary">{l.address || '—'}</div>
                        </td>
                        <td className="small">{Array.isArray(l.floors) ? l.floors.length : '—'}</td>
                        <td className="small text-nowrap">
                          {l.totalSlots ?? '—'}
                          {l.disabledTotal > 0 && (
                            <span className="badge badge-disabled-soft ms-1">
                              <span aria-hidden="true">♿</span> {l.disabledTotal}
                            </span>
                          )}
                        </td>
                        <td className="small">{l.occupancyRate != null ? formatPercent(l.occupancyRate) : '—'}</td>
                        <td>
                          {l.isActive === false ? <span className="badge text-bg-secondary">Pasif</span> : <span className="badge text-bg-success">Aktif</span>}
                        </td>
                        <td className="text-end text-nowrap">
                          <button
                            type="button"
                            className={`btn btn-sm me-1 ${active ? 'btn-primary' : 'btn-outline-primary'}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelected(l.code);
                            }}
                          >
                            <i className="bi bi-map me-1" />
                            Kroki
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-light border"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditLot(l);
                            }}
                          >
                            <i className="bi bi-pencil me-1" />
                            Düzenle
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="row g-4">
        <div className={selectedSlot ? 'col-xl-9' : 'col-12'}>
          <div className="card">
            <div className="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
              <span>
                <i className="bi bi-map me-2 text-accent" />
                {lot?.name || selected} krokisi
              </span>
              <span className="d-flex align-items-center gap-2 small fw-normal text-secondary">
                {stats.total} cep · <span aria-hidden="true">♿</span> {stats.disabled} engelli · {stats.inactive} kullanım dışı
                <LiveBadge status={hubStatus} />
              </span>
            </div>
            <div className="card-body">
              <ErrorAlert error={error} onRetry={reload} className="mb-3" />
              {loading ? (
                <Loading text="Kroki yükleniyor…" />
              ) : (
                <ParkingMap
                  lot={lot}
                  slots={slots}
                  zones={zones}
                  selectedSlot={selectedSlotCode}
                  highlightSlot={null}
                  onSlotClick={(s) => setSelectedSlotCode(s.code === selectedSlotCode ? null : s.code)}
                />
              )}
              <div className="small text-secondary mt-2">
                <i className="bi bi-hand-index me-1" />
                Düzenlemek için bir cebe tıklayın. Değişiklik krokide anında görünür ve denetim kaydına yazılır.
              </div>
            </div>
          </div>
        </div>
        {selectedSlot && (
          <div className="col-xl-3">
            <div style={{ position: 'sticky', top: 80 }}>
              <SlotPanel
                slot={selectedSlot}
                zoneName={zoneByCode[selectedSlot.zoneCode]?.name}
                floorName={floorName(selectedSlot.floor ?? zoneByCode[selectedSlot.zoneCode]?.floor)}
                onClose={() => setSelectedSlotCode(null)}
                onSaved={(updated) => {
                  setSlots((list) => list.map((s) => (s.code === updated.code ? { ...s, ...updated, _flash: Date.now() } : s)));
                  reloadLots();
                  loadLots();
                }}
              />
            </div>
          </div>
        )}
      </div>

      <LotEditModal
        lot={editLot}
        onClose={() => setEditLot(null)}
        onSaved={(updated) => {
          setLots((list) => list.map((l) => (l.code === updated.code ? { ...l, ...updated } : l)));
          setEditLot(null);
          reloadLots();
        }}
      />
    </div>
  );
}
