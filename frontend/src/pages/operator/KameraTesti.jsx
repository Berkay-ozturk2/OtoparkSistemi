import { useCallback, useEffect, useState } from 'react';
import {
  agentSnapshotUrl,
  agentStreamUrl,
  analyzeOccupancy,
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
function SnapshotPreview({ agentId }) {
  const [stamp, setStamp] = useState(Date.now());
  const [auto, setAuto] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    setStamp(Date.now());
  }, [agentId]);

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
          key={`${agentId}-${auto ? 'live' : 'still'}-${stamp}`}
          src={auto ? agentStreamUrl(agentId, stamp) : agentSnapshotUrl(agentId, stamp)}
          alt={`${agentId} son kare`}
          style={failed ? { display: 'none' } : undefined}
          onError={() => setFailed(true)}
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
      setResult(await recognizePlate(file, { gate, forward }));
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
              Gerçek bir {gateLabel(gate).toLocaleLowerCase('tr-TR')} olayı oluşturulur (oturum açılır/kapanır).
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

function OccupancyTest() {
  const [file, setFile] = useState(null);
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
      setResult(await analyzeOccupancy(file, { forward }));
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
        <form onSubmit={run} className="mb-3">
          <FilePicker id="occ-file" file={file} onChange={setFile} />
          <div className="form-check form-switch mt-2">
            <input id="occ-fwd" type="checkbox" className="form-check-input" checked={forward} onChange={(e) => setForward(e.target.checked)} />
            <label className="form-check-label" htmlFor="occ-fwd">
              Sonucu backend&apos;e gönder (kroki güncellenir)
            </label>
          </div>
          <button type="submit" className="btn btn-primary w-100 mt-3" disabled={!file || busy}>
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
                Tespit edilen araç: <strong>{result.vehicles ?? '—'}</strong>
              </span>
              <span>
                Dolu cep: <strong>{occupied}</strong>/{slots.length}
              </span>
              <span className="text-secondary">Süre: {result.elapsedMs != null ? `${Math.round(result.elapsedMs)} ms` : '—'}</span>
            </div>
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

/** Görüntü işleme servisi test ve yönetim ekranı */
export default function KameraTesti() {
  const toast = useToast();
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
              <SnapshotPreview agentId={selected} />
            </div>
          </div>
        </div>
        <div className="col-md-6 col-xl-4">
          <RecognizeTest />
        </div>
        <div className="col-md-6 col-xl-4">
          <OccupancyTest />
        </div>
      </div>
    </div>
  );
}
