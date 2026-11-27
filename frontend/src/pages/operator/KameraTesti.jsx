import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  agentSnapshotUrl,
  agentStreamUrl,
  analyzeOccupancy,
  assignAgent,
  getOccupancyLayouts,
  getOccupancySample,
  getVisionAgents,
  getVisionHealth,
  recognizePlate,
  startAgent,
  stopAgent,
} from '../../api/vision';
import PageHeader from '../../components/PageHeader';
import PlateBadge from '../../components/PlateBadge';
import ErrorAlert from '../../components/ErrorAlert';
import EmptyState from '../../components/EmptyState';
import Loading from '../../components/Loading';
import { useToast } from '../../components/Toast';
import { useLot } from '../../lot/LotContext';
import { decisionInfo, formatPercent, gateLabel, toImageSrc } from '../../utils/format';

function statusVariant(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'running' || s === 'ok') return 'success';
  if (s === 'error' || s === 'failed') return 'danger';
  if (s === 'stopped' || s === 'idle' || s === 'disabled') return 'secondary';
  return 'warning';
}

function isRunning(agent) {
  return String(agent.status || '').toLowerCase() === 'running';
}

/** Canlı önizleme: varsayılan MJPEG akışı (akıcı), kapatılırsa tek kare */
function SnapshotPreview({ agentId, running }) {
  const [stamp, setStamp] = useState(Date.now());
  const [auto, setAuto] = useState(true);
  const [failed, setFailed] = useState(false);
  const imgRef = useRef(null);
  // Akış yalnızca ajan ÇALIŞIRKEN açılır; duran ajan için tek kare gösterilir
  const live = auto && running;

  useEffect(() => {
    setFailed(false);
    setStamp(Date.now());
  }, [agentId, running]);

  // Görüntü adresini elle yönet: kamera değişince / durunca / sayfadan çıkınca eski akış
  // bağlantısı src boşaltılarak KESİLİR (aksi hâlde açık kalıp tarayıcıyı kilitliyordu).
  useEffect(() => {
    const img = imgRef.current;
    if (!img || !agentId) return undefined;
    img.src = live ? agentStreamUrl(agentId, stamp) : agentSnapshotUrl(agentId, stamp);
    return () => {
      img.removeAttribute('src');
      img.src = '';
    };
  }, [agentId, live, stamp]);

  if (!agentId) {
    return (
      <div className="snapshot-frame">
        <span>
          <i className="bi bi-camera-video-off me-2" />
          Önizleme için bir ajan seçin
        </span>
      </div>
    );
  }

  return (
    <div>
      <div className="snapshot-frame">
        {failed ? (
          <span className="text-center px-3">
            <i className="bi bi-image-alt d-block fs-2 mb-2" />
            Kare alınamadı (ajan çalışmıyor olabilir)
          </span>
        ) : null}
        <img
          ref={imgRef}
          alt={`${agentId} son kare`}
          style={failed ? { display: 'none' } : undefined}
          onError={(e) => { if (e.currentTarget.getAttribute('src')) setFailed(true); }}
          onLoad={() => setFailed(false)}
        />
      </div>
      <div className="d-flex justify-content-between align-items-center mt-2 small">
        <div className="form-check form-switch mb-0">
          <input id="snap-auto" className="form-check-input" type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <label className="form-check-label" htmlFor="snap-auto">
            Canlı akış
          </label>
        </div>
        <button type="button" className="btn btn-sm btn-light" onClick={() => setStamp(Date.now())}>
          <i className="bi bi-arrow-clockwise me-1" />
          {auto ? 'Akışı yeniden bağlan' : 'Şimdi yenile'}
        </button>
      </div>
      <div className="small text-secondary mt-1">
        <i className="bi bi-shield-lock me-1" />
        Kareler yalnızca bellekte tutulur, kaydedilmez (KVKK).
      </div>
    </div>
  );
}

function floorLabel(floor) {
  if (floor == null || floor === 0) return 'Zemin';
  return floor < 0 ? `B${-floor} (Kat ${floor})` : `Kat ${floor}`;
}

/** Kroki seçimi: otoparka göre gruplanmış cep yerleşimleri (çok katlıda her kat ayrı kamera) */
function LayoutOptions({ layouts, lotName }) {
  const groups = [];
  layouts.forEach((l) => {
    let g = groups.find((x) => x.lot === l.lotCode);
    if (!g) {
      g = { lot: l.lotCode, items: [] };
      groups.push(g);
    }
    g.items.push(l);
  });
  return groups.map((g) => (
    <optgroup key={g.lot} label={lotName(g.lot)}>
      {g.items.map((l) => (
        <option key={l.id} value={l.id}>
          {g.items.length > 1 ? `${floorLabel(l.floor)} — ` : ''}
          {l.slotCount} cep ({l.id})
        </option>
      ))}
    </optgroup>
  ));
}

function FilePicker({ id, file, onChange }) {
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <div>
      <input id={id} type="file" accept="image/*" className="form-control" onChange={(e) => onChange(e.target.files?.[0] || null)} />
      {preview && <img src={preview} alt="Seçilen görsel" className="annotated-img mt-2" style={{ maxHeight: 200, objectFit: 'contain' }} />}
    </div>
  );
}

function RecognizeTest() {
  const { lotCode, lotName, lots, setLotCode } = useLot();
  const [file, setFile] = useState(null);
  const [gate, setGate] = useState('Entry');
  const [forward, setForward] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const run = async (e) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await recognizePlate(file, { gate, forward, lot: lotCode }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const plates = result?.plates || [];
  const br = result?.backendResponse;
  const brInfo = br ? decisionInfo(br.decision) : null;

  return (
    <div className="card h-100">
      <div className="card-header">
        <i className="bi bi-123 me-2 text-accent" />
        Plaka Tanıma Testi
      </div>
      <div className="card-body">
        <form onSubmit={run} className="mb-3">
          <label className="form-label small fw-semibold" htmlFor="rec-lot">
            Otopark
          </label>
          <select id="rec-lot" className="form-select mb-3" value={lotCode} onChange={(e) => setLotCode(e.target.value)}>
            {lots.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
          <FilePicker id="rec-file" file={file} onChange={setFile} />
          <div className="row g-2 mt-2 align-items-center">
            <div className="col-sm-5">
              <select className="form-select" value={gate} onChange={(e) => setGate(e.target.value)} aria-label="Kapı">
                <option value="Entry">Giriş kapısı</option>
                <option value="Exit">Çıkış kapısı</option>
              </select>
            </div>
            <div className="col-sm-7">
              <div className="form-check form-switch">
                <input id="rec-fwd" type="checkbox" className="form-check-input" checked={forward} onChange={(e) => setForward(e.target.checked)} />
                <label className="form-check-label" htmlFor="rec-fwd">
                  Backend&apos;e olay olarak gönder
                </label>
              </div>
            </div>
          </div>
          {forward && (
            <div className="alert alert-warning small mt-2 mb-0 py-2">
              <i className="bi bi-exclamation-triangle me-1" />
              <strong>{lotName(lotCode)}</strong> otoparkında gerçek bir {gateLabel(gate).toLocaleLowerCase('tr-TR')} olayı
              oluşturulur (oturum açılır/kapanır).
            </div>
          )}
          <button type="submit" className="btn btn-primary w-100 mt-3" disabled={!file || busy}>
            {busy ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-play-fill me-2" />}
            Tanı
          </button>
        </form>

        <ErrorAlert error={error} />

        {result && (
          <div>
            {result.annotatedImageBase64 && <img src={toImageSrc(result.annotatedImageBase64)} alt="İşlenmiş görüntü" className="annotated-img mb-3" />}
            <div className="small text-secondary mb-2">İşlem süresi: {result.elapsedMs != null ? `${Math.round(result.elapsedMs)} ms` : '—'}</div>
            {plates.length === 0 ? (
              <div className="alert alert-secondary mb-0">Görselde plaka bulunamadı.</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Plaka</th>
                      <th>Ham metin</th>
                      <th>Güven</th>
                      <th>Biçim</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plates.map((p, i) => (
                      <tr key={i}>
                        <td>
                          <PlateBadge plate={p.plate} size="sm" />
                        </td>
                        <td className="font-monospace small">{p.rawText}</td>
                        <td>
                          {formatPercent(p.confidence)}
                          {(p.detectionConfidence != null || p.ocrConfidence != null) && (
                            <div className="text-secondary" style={{ fontSize: '0.72rem' }}>
                              {p.detectionConfidence != null && `tespit ${formatPercent(p.detectionConfidence)}`}
                              {p.detectionConfidence != null && p.ocrConfidence != null && ' · '}
                              {p.ocrConfidence != null && `OCR ${formatPercent(p.ocrConfidence)}`}
                            </div>
                          )}
                        </td>
                        <td>
                          {p.formatValid ? (
                            <span className="badge text-bg-success">Geçerli</span>
                          ) : (
                            <span className="badge text-bg-danger">Geçersiz</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {br && (
              <div className={`alert alert-${brInfo.variant} mt-3 mb-0`}>
                <div className="fw-semibold">
                  <i className="bi bi-hdd-network me-1" />
                  Backend yanıtı: {brInfo.label}
                </div>
                {br.message && <div>{br.message}</div>}
                {br.suggestedZone && <div className="small">Önerilen bölge: {br.suggestedZone}</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function OccupancyTest({ layouts, layoutsError }) {
  const { lotCode, lotName } = useLot();
  const [layoutId, setLayoutId] = useState('');
  const [file, setFile] = useState(null);
  const [detector, setDetector] = useState('yolo');
  const [ratio, setRatio] = useState(50);
  const [forward, setForward] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [pickerKey, setPickerKey] = useState(0);

  // Üst menüden otopark değişince o otoparkın ilk krokisi (en alt kat) seçilir
  useEffect(() => {
    if (!layouts.length) return;
    setLayoutId((cur) => {
      const current = layouts.find((l) => l.id === cur);
      if (current && current.lotCode === lotCode) return cur;
      return (layouts.find((l) => l.lotCode === lotCode) || layouts[0]).id;
    });
  }, [layouts, lotCode]);

  const layout = layouts.find((l) => l.id === layoutId) || null;

  const changeLayout = (id) => {
    setLayoutId(id);
    setResult(null);
    if (detector === 'color') setFile(null); // örnek görüntü eski krokiye aitti
  };

  const pickFile = (f) => {
    setFile(f);
    setDetector('yolo'); // yüklenen gerçek fotoğraf
    setResult(null);
  };

  const makeSample = async () => {
    if (!layout) return;
    setSampleBusy(true);
    setError(null);
    setResult(null);
    try {
      const seed = Math.floor(Math.random() * 100000);
      const f = await getOccupancySample(layout.id, { ratio: ratio / 100, seed });
      setPickerKey((k) => k + 1); // dosya seçicideki eski adı temizle
      setFile(f);
      setDetector('color');
    } catch (err) {
      setError(err);
    } finally {
      setSampleBusy(false);
    }
  };

  const run = async (e) => {
    e.preventDefault();
    if (!file || !layout) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await analyzeOccupancy(file, { forward, layout: layout.id, detector }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const slots = result?.slots || [];
  const occupied = slots.filter((s) => s.occupied).length;

  return (
    <div className="card h-100">
      <div className="card-header">
        <i className="bi bi-grid-3x3-gap me-2 text-accent" />
        Doluluk Analizi Testi
      </div>
      <div className="card-body">
        <ErrorAlert error={layoutsError} title="Kroki listesi alınamadı" className="mb-3" />
        <form onSubmit={run} className="mb-3">
          <label className="form-label small fw-semibold" htmlFor="occ-layout">
            Kroki / kamera görüş alanı
          </label>
          <select
            id="occ-layout"
            className="form-select"
            value={layoutId}
            onChange={(e) => changeLayout(e.target.value)}
            disabled={!layouts.length}
          >
            {!layouts.length && <option value="">Yükleniyor…</option>}
            <LayoutOptions layouts={layouts} lotName={lotName} />
          </select>
          {layout && (
            <div className="form-text">
              {lotName(layout.lotCode)} · {floorLabel(layout.floor)} · {layout.slotCount} cep
            </div>
          )}

          <div className="border rounded p-2 mt-3 bg-body-tertiary">
            <div className="d-flex align-items-center justify-content-between gap-2">
              <label className="small mb-0" htmlFor="occ-ratio">
                Örnek doluluk: <strong>%{ratio}</strong>
              </label>
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={makeSample} disabled={!layout || sampleBusy}>
                {sampleBusy ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-magic me-1" />}
                Örnek görüntü oluştur
              </button>
            </div>
            <input
              id="occ-ratio"
              type="range"
              className="form-range"
              min="0"
              max="100"
              step="10"
              value={ratio}
              onChange={(e) => setRatio(Number(e.target.value))}
            />
            <div className="small text-secondary">
              Gerçek fotoğraf yoksa seçilen krokinin üstten görünüşlü sentetik görüntüsünü üretir.
            </div>
          </div>

          <div className="small text-secondary mt-3 mb-1">ya da kendi fotoğrafınızı yükleyin:</div>
          <FilePicker key={pickerKey} id="occ-file" file={file} onChange={pickFile} />

          <div className="mt-2">
            <label className="form-label small fw-semibold mb-1" htmlFor="occ-detector">
              Araç tespiti
            </label>
            <select id="occ-detector" className="form-select form-select-sm" value={detector} onChange={(e) => setDetector(e.target.value)}>
              <option value="yolo">YOLO — gerçek fotoğraf</option>
              <option value="color">Renk dedektörü — sentetik örnek görüntü</option>
            </select>
          </div>
          <div className="form-check form-switch mt-2">
            <input id="occ-fwd" type="checkbox" className="form-check-input" checked={forward} onChange={(e) => setForward(e.target.checked)} />
            <label className="form-check-label" htmlFor="occ-fwd">
              Sonucu backend&apos;e gönder ({layout ? `${lotName(layout.lotCode)} krokisi güncellenir` : 'kroki seçin'})
            </label>
          </div>
          <button type="submit" className="btn btn-primary w-100 mt-3" disabled={!file || !layout || busy}>
            {busy ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-play-fill me-2" />}
            Analiz Et
          </button>
        </form>

        <ErrorAlert error={error} />

        {result && (
          <div>
            {result.annotatedImageBase64 && <img src={toImageSrc(result.annotatedImageBase64)} alt="İşlenmiş doluluk görüntüsü" className="annotated-img mb-3" />}
            <div className="d-flex flex-wrap gap-3 small mb-2">
              <span>
                Kroki: <strong>{result.layout || layout?.id}</strong>
              </span>
              <span>
                Tespit edilen araç: <strong>{result.vehicles ?? '—'}</strong>
              </span>
              <span>
                Dolu cep: <strong>{occupied}</strong>/{slots.length}
              </span>
              <span className="text-secondary">Süre: {result.elapsedMs != null ? `${Math.round(result.elapsedMs)} ms` : '—'}</span>
            </div>
            {result.backendResponse && (
              <div className={`small mb-2 ${result.backendResponse.sent ? 'text-success' : 'text-danger'}`}>
                <i className={`bi ${result.backendResponse.sent ? 'bi-check-circle' : 'bi-x-circle'} me-1`} />
                {result.backendResponse.sent
                  ? `${lotName(result.lotCode)} krokisi güncellendi.`
                  : `Backend'e gönderilemedi: ${result.backendResponse.error || 'bilinmeyen hata'}`}
              </div>
            )}
            {slots.length > 0 && (
              <div className="d-flex flex-wrap gap-1">
                {slots.map((s) => (
                  <span
                    key={s.code}
                    className={`badge ${s.occupied ? 'text-bg-danger' : 'text-bg-success'}`}
                    title={`Güven: ${formatPercent(s.confidence)}`}
                  >
                    {s.code}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Kameranın bağlı olduğu otopark (giriş/çıkış) ya da kroki (doluluk) seçimi */
function AgentTarget({ agent, layouts, lots, lotName, busy, onAssign }) {
  if (agent.type === 'Occupancy') {
    const known = layouts.some((l) => l.id === agent.layout);
    return (
      <select
        className="form-select form-select-sm"
        style={{ minWidth: 170 }}
        value={agent.layout || ''}
        disabled={busy || !layouts.length}
        title="Doluluk kamerasının izlediği kroki/kat"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onAssign(agent, { layout: e.target.value })}
      >
        {!known && <option value={agent.layout || ''}>{agent.layout || '—'}</option>}
        <LayoutOptions layouts={layouts} lotName={lotName} />
      </select>
    );
  }
  const code = agent.lotCode || 'GAZI';
  return (
    <select
      className="form-select form-select-sm"
      style={{ minWidth: 150 }}
      value={code}
      disabled={busy || !lots.length}
      title="Plaka olaylarının gönderileceği otopark"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onAssign(agent, { lot: e.target.value })}
    >
      {!lots.some((l) => l.code === code) && <option value={code}>{code}</option>}
      {lots.map((l) => (
        <option key={l.code} value={l.code}>
          {l.name}
        </option>
      ))}
    </select>
  );
}

/** Görüntü işleme servisi test ve yönetim ekranı */
export default function KameraTesti() {
  const toast = useToast();
  const { lots, lotName } = useLot();
  const [layouts, setLayouts] = useState([]);
  const [layoutsError, setLayoutsError] = useState(null);
  const [health, setHealth] = useState(null);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [h, a] = await Promise.all([getVisionHealth(), getVisionAgents()]);
      setHealth(h);
      const list = Array.isArray(a) ? a : Array.isArray(a?.agents) ? a.agents : [];
      setAgents(list);
      setSelected((cur) => cur || list[0]?.id || null);
    } catch (err) {
      setError(err);
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      getVisionAgents()
        .then((a) => setAgents(Array.isArray(a) ? a : Array.isArray(a?.agents) ? a.agents : []))
        .catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    let alive = true;
    getOccupancyLayouts()
      .then((list) => {
        if (!alive) return;
        setLayouts(Array.isArray(list) ? list : []);
        setLayoutsError(null);
      })
      .catch((err) => alive && setLayoutsError(err));
    return () => {
      alive = false;
    };
  }, []);

  const layoutName = useMemo(() => {
    const map = Object.fromEntries(layouts.map((l) => [l.id, l]));
    return (id) => {
      const l = map[id];
      return l ? `${lotName(l.lotCode)} · ${floorLabel(l.floor)}` : id;
    };
  }, [layouts, lotName]);

  const assign = async (agent, target) => {
    setBusyId(agent.id);
    try {
      const info = await assignAgent(agent.id, target);
      toast.success(
        agent.type === 'Occupancy'
          ? `${agent.id} artık ${layoutName(info.layout)} krokisini izliyor${isRunning(agent) ? ' (yeniden başlatıldı)' : ''}.`
          : `${agent.id} artık ${lotName(info.lotCode)} otoparkına bağlı.`,
      );
      const a = await getVisionAgents();
      setAgents(Array.isArray(a) ? a : Array.isArray(a?.agents) ? a.agents : []);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusyId(null);
    }
  };

  const toggleAgent = async (agent) => {
    setBusyId(agent.id);
    try {
      if (isRunning(agent)) {
        await stopAgent(agent.id);
        toast.info(`${agent.id} durduruldu.`);
      } else {
        // Aynı webcam'i kullanan diğer giriş/çıkış ajanı servis tarafından durdurulur (tek kamerayla test)
        const stopped = String(agent.type) === 'Gate'
          ? agents.filter((o) => o.id !== agent.id && String(o.type) === 'Gate' && o.source === agent.source && isRunning(o))
          : [];
        await startAgent(agent.id);
        setSelected(agent.id); // önizlemeyi başlatılan kameraya geçir
        toast.success(
          stopped.length
            ? `${agent.id} başlatıldı. Aynı kamerayı kullanan ${stopped.map((o) => o.id).join(', ')} durduruldu.`
            : `${agent.id} başlatıldı.`,
        );
      }
      const a = await getVisionAgents();
      setAgents(Array.isArray(a) ? a : Array.isArray(a?.agents) ? a.agents : []);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusyId(null);
    }
  };

  const models = health?.models || {};

  return (
    <div>
      <PageHeader
        icon="bi-camera-video"
        title="Kamera ve Görüntü İşleme Testi"
        subtitle="Görüntü işleme servisinin durumu, kamera ajanlarının yönetimi ve örnek görsellerle test."
        actions={
          <button type="button" className="btn btn-outline-primary" onClick={load}>
            <i className="bi bi-arrow-clockwise me-1" />
            Yenile
          </button>
        }
      />

      <ErrorAlert error={error} onRetry={load} title="Görüntü işleme servisine ulaşılamıyor" className="mb-4" />

      <div className="row g-4 mb-4">
        {/* Servis durumu */}
        <div className="col-lg-4">
          <div className="card h-100">
            <div className="card-header">
              <i className="bi bi-heart-pulse me-2 text-accent" />
              Servis Durumu
            </div>
            <div className="card-body">
              {loading ? (
                <Loading inline />
              ) : health ? (
                <>
                  <div className="d-flex align-items-center gap-2 mb-3">
                    <span className={`badge fs-6 text-bg-${health.status === 'ok' ? 'success' : 'warning'}`}>
                      {health.status === 'ok' ? 'ÇALIŞIYOR' : String(health.status || '?').toUpperCase()}
                    </span>
                    <span className="small text-secondary">http://localhost:8000</span>
                  </div>
                  <ul className="list-group list-group-flush">
                    <li className="list-group-item px-0 d-flex justify-content-between">
                      Plaka tespit modeli
                      {models.plateDetector ? <i className="bi bi-check-circle-fill text-success" /> : <i className="bi bi-x-circle-fill text-danger" />}
                    </li>
                    <li className="list-group-item px-0 d-flex justify-content-between">
                      Araç tespit modeli
                      {models.vehicleDetector ? <i className="bi bi-check-circle-fill text-success" /> : <i className="bi bi-x-circle-fill text-danger" />}
                    </li>
                    <li className="list-group-item px-0 d-flex justify-content-between">
                      OCR motoru
                      <span className={`badge ${models.ocr && models.ocr !== 'none' ? 'text-bg-success' : 'text-bg-danger'}`}>{models.ocr || 'none'}</span>
                    </li>
                  </ul>
                  {health.details && (
                    <div className="small text-secondary mt-2" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {typeof health.details === 'string' ? health.details : JSON.stringify(health.details, null, 2)}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-secondary">Servis yanıt vermiyor.</div>
              )}
            </div>
          </div>
        </div>

        {/* Ajanlar */}
        <div className="col-lg-8">
          <div className="card h-100">
            <div className="card-header">
              <i className="bi bi-cpu me-2 text-accent" />
              Kamera Ajanları
            </div>
            <div className="card-body p-0">
              {agents.length === 0 ? (
                <EmptyState icon="bi-camera-video-off" title={loading ? 'Yükleniyor…' : 'Tanımlı ajan yok'}>
                  {!loading && 'Ajanlar vision-service yapılandırmasında tanımlanır.'}
                </EmptyState>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover">
                    <thead>
                      <tr>
                        <th>Ajan</th>
                        <th>Tür</th>
                        <th>Kaynak</th>
                        <th title="Giriş/çıkış: plaka olaylarının gideceği otopark · Doluluk: izlenen kroki/kat">Otopark / Kroki</th>
                        <th>Durum</th>
                        <th title="Kamera okuma / plaka tespit">FPS (kamera / tespit)</th>
                        <th>Son plaka</th>
                        <th className="text-end">İşlem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agents.map((a) => (
                        <tr
                          key={a.id}
                          className={selected === a.id ? 'table-active' : ''}
                          style={{ cursor: 'pointer' }}
                          onClick={() => setSelected(a.id)}
                        >
                          <td className="fw-semibold">
                            <i className={`bi ${a.type === 'Occupancy' ? 'bi-grid-3x3-gap' : 'bi-upc-scan'} me-1 text-accent`} />
                            {a.id}
                          </td>
                          <td className="small">
                            {a.type === 'Occupancy' ? 'Doluluk' : `Bariyer (${gateLabel(a.gate)})`}
                          </td>
                          <td className="small text-truncate" style={{ maxWidth: 160 }} title={a.source}>
                            {a.source}
                          </td>
                          <td>
                            <AgentTarget agent={a} layouts={layouts} lots={lots} lotName={lotName} busy={busyId === a.id} onAssign={assign} />
                          </td>
                          <td>
                            <span className={`badge text-bg-${statusVariant(a.status)}`} title={a.lastError || ''}>
                              {a.status || '—'}
                            </span>
                            {a.lastError && <i className="bi bi-exclamation-triangle text-danger ms-1" title={a.lastError} />}
                          </td>
                          <td title="Kamera okuma hızı / plaka tespit hızı">
                            {a.cameraFps != null ? Number(a.cameraFps).toFixed(0) : '—'}
                            {' / '}
                            {a.fps != null ? Number(a.fps).toFixed(1) : '—'}
                          </td>
                          <td>{a.lastPlate ? <PlateBadge plate={a.lastPlate} size="sm" /> : '—'}</td>
                          <td className="text-end">
                            <button
                              type="button"
                              className={`btn btn-sm ${isRunning(a) ? 'btn-outline-danger' : 'btn-success'}`}
                              disabled={busyId === a.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleAgent(a);
                              }}
                            >
                              {busyId === a.id ? (
                                <span className="spinner-border spinner-border-sm" />
                              ) : isRunning(a) ? (
                                <>
                                  <i className="bi bi-stop-fill me-1" />
                                  Durdur
                                </>
                              ) : (
                                <>
                                  <i className="bi bi-play-fill me-1" />
                                  Başlat
                                </>
                              )}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="row g-4">
        <div className="col-xl-4">
          <div className="card h-100">
            <div className="card-header">
              <i className="bi bi-display me-2 text-accent" />
              Canlı Kare {selected ? `— ${selected}` : ''}
            </div>
            <div className="card-body">
              <SnapshotPreview
                agentId={selected}
                running={isRunning(agents.find((a) => a.id === selected) || {})}
              />
            </div>
          </div>
        </div>
        <div className="col-md-6 col-xl-4">
          <RecognizeTest />
        </div>
        <div className="col-md-6 col-xl-4">
          <OccupancyTest layouts={layouts} layoutsError={layoutsError} />
        </div>
      </div>
    </div>
  );
}
