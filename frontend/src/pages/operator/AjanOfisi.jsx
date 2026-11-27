import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  agentSnapshotUrl,
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
import ErrorAlert from '../../components/ErrorAlert';
import PlateBadge from '../../components/PlateBadge';
import { useToast } from '../../components/Toast';
import { useLot } from '../../lot/LotContext';
import { formatTime, toImageSrc } from '../../utils/format';
import { HELP_TEXT, parseCommand } from '../../utils/officeCommands';

// ----------------------------------------------------------------------------- kişiler
const NAMES = ['Ayşe', 'Mehmet', 'Zeynep', 'Emre', 'Elif', 'Burak', 'Deniz', 'Selin', 'Kerem', 'Ece', 'Onur', 'Melis'];
const SKINS = ['#f1c7a5', '#e0ac85', '#c98e66', '#f5d3b8', '#b97c55'];
const HAIRS = ['#3b2a20', '#1f1b18', '#7a4b2a', '#b5813f', '#5a3a2a'];
const ROLES = {
  Entry: { role: 'Giriş Görevlisi', shirt: '#2e9e6b', icon: 'bi-box-arrow-in-right' },
  Exit: { role: 'Çıkış Görevlisi', shirt: '#e0823b', icon: 'bi-box-arrow-right' },
  Occupancy: { role: 'Doluluk Gözcüsü', shirt: '#3b7dd8', icon: 'bi-grid-3x3-gap' },
};
const CHIEF = { id: '__chief', name: 'Nazlı', role: 'Görüntü İşleme Şefi', shirt: '#d61f2c', skin: '#e9b896', hair: '#2a1d16', icon: 'bi-cpu' };
const LOG_KEY = 'akillipark_office_log';
const MAX_LOG = 40;

function hash(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Her ajana kalıcı (kimliğe bağlı) bir insan görünümü verir; isimler birbirinden farklıdır. */
function buildPersonas(agents) {
  const used = new Set([CHIEF.name]);
  const out = {};
  [...agents]
    .sort((a, b) => a.id.localeCompare(b.id))
    .forEach((a) => {
      const h = hash(a.id);
      let i = h % NAMES.length;
      for (let k = 0; k < NAMES.length && used.has(NAMES[i]); k += 1) i = (i + 1) % NAMES.length;
      used.add(NAMES[i]);
      const r = ROLES[a.type === 'Occupancy' ? 'Occupancy' : a.gate === 'Exit' ? 'Exit' : 'Entry'];
      out[a.id] = { id: a.id, name: NAMES[i], ...r, skin: SKINS[h % SKINS.length], hair: HAIRS[(h >> 3) % HAIRS.length] };
    });
  return out;
}

const isRunning = (a) => String(a?.status || '').toLowerCase() === 'running';
const isError = (a) => String(a?.status || '').toLowerCase() === 'error' || (isRunning(a) && !!a?.lastError);

function moodOf(agent) {
  if (!agent) return 'idle';
  if (isError(agent)) return 'error';
  return isRunning(agent) ? 'working' : 'idle';
}

function floorLabel(floor) {
  if (floor == null || floor === 0) return 'Zemin';
  return floor < 0 ? `B${-floor}` : `Kat ${floor}`;
}

// ----------------------------------------------------------------------------- çizim
/** Masasında oturan çalışan (SVG). Ekranda canlı kare ya da özel içerik gösterilir. */
function Worker({ persona, mood, screen, lamp }) {
  const sleeping = mood === 'idle';
  return (
    <div className={`office-worker office-${mood}`}>
      <svg viewBox="0 0 220 190" className="office-svg" aria-hidden="true">
        <ellipse cx="110" cy="180" rx="96" ry="8" fill="rgba(0,0,0,.12)" />
        <rect x="78" y="58" width="64" height="80" rx="14" fill="#52525b" />
        <g className="office-body">
          <rect x="84" y="92" width="52" height="50" rx="20" fill={persona.shirt} />
          <path d="M100 92 L110 104 L120 92 Z" fill="#fff" opacity=".85" />
          <g className="office-head">
            <rect x="104" y="80" width="12" height="14" fill={persona.skin} />
            <circle cx="110" cy="67" r="19" fill={persona.skin} />
            <path d="M90 66 Q90 45 110 46 Q130 45 130 66 Q125 55 110 55 Q95 55 90 66 Z" fill={persona.hair} />
            {sleeping ? (
              <g stroke="#3b3b3b" strokeWidth="2" fill="none" strokeLinecap="round">
                <path d="M99 69 q4 3 8 0" />
                <path d="M113 69 q4 3 8 0" />
              </g>
            ) : (
              <g fill="#2b2b2b">
                <circle cx="103" cy="68" r="2.2" />
                <circle cx="117" cy="68" r="2.2" />
              </g>
            )}
            <path
              d={mood === 'error' ? 'M104 80 q6 -5 12 0' : 'M104 77 q6 5 12 0'}
              stroke="#8a4a3a"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
          </g>
        </g>
        <rect x="14" y="136" width="192" height="12" rx="3" fill="#b9834f" />
        <rect x="24" y="148" width="172" height="30" rx="2" fill="#94653a" />
        <path className="office-arm-l" d="M88 104 Q80 122 97 133" stroke={persona.shirt} strokeWidth="10" fill="none" strokeLinecap="round" />
        <path className="office-arm-r" d="M132 104 Q140 122 123 133" stroke={persona.shirt} strokeWidth="10" fill="none" strokeLinecap="round" />
        <circle className="office-arm-l" cx="98" cy="134" r="5" fill={persona.skin} />
        <circle className="office-arm-r" cx="122" cy="134" r="5" fill={persona.skin} />
        <rect x="92" y="131" width="36" height="6" rx="1.5" fill="#27272a" />
        <rect x="45" y="118" width="8" height="18" fill="#6b7280" />
        <rect x="35" y="133" width="28" height="4" rx="2" fill="#6b7280" />
        <rect x="14" y="68" width="70" height="52" rx="4" fill="#18181b" />
        <circle cx="78" cy="73" r="3" style={{ fill: lamp }} />
        <rect x="170" y="120" width="14" height="16" rx="2" fill="#f5f5f5" />
        <path d="M184 124 q6 0 6 5 q0 5 -6 5" stroke="#f5f5f5" strokeWidth="2.5" fill="none" />
        {sleeping && (
          <g className="office-steam" stroke="#d4d4d8" strokeWidth="1.6" fill="none" strokeLinecap="round">
            <path d="M174 116 q-3 -5 0 -9 q3 -4 0 -8" />
            <path d="M180 116 q-3 -5 0 -9 q3 -4 0 -8" />
          </g>
        )}
        {sleeping && (
          <g className="office-zzz" fill="#a1a1aa" fontWeight="700">
            <text x="134" y="46" fontSize="12">z</text>
            <text x="143" y="36" fontSize="15">z</text>
            <text x="154" y="24" fontSize="18">Z</text>
          </g>
        )}
        {mood === 'error' && (
          <g>
            <circle cx="140" cy="40" r="11" fill="#dc3545" />
            <text x="140" y="45" fontSize="15" textAnchor="middle" fill="#fff" fontWeight="700">!</text>
          </g>
        )}
      </svg>
      <div className="office-screen">{screen}</div>
    </div>
  );
}

function AgentScreen({ agent, tick }) {
  const [failed, setFailed] = useState(false);
  const running = isRunning(agent);
  useEffect(() => setFailed(false), [running]);
  if (!running) return <div className="office-screen-off">uyku modu</div>;
  if (failed) return <div className="office-screen-off">görüntü yok</div>;
  return (
    <img
      src={agentSnapshotUrl(agent.id, tick)}
      alt=""
      onError={() => setFailed(true)}
      onLoad={() => setFailed(false)}
    />
  );
}

function bubbleText(agent, layoutName) {
  if (!agent) return '';
  if (isError(agent)) return `Sorun var: ${String(agent.lastError || 'hata').slice(0, 70)}`;
  if (!isRunning(agent)) return 'Mola veriyorum ☕ Görev verirsen başlarım.';
  if (agent.type === 'Occupancy') {
    const count = agent.occupiedCount != null && agent.slotCount ? ` ${agent.occupiedCount}/${agent.slotCount} dolu.` : '';
    return `${layoutName(agent.layout)} krokisindeki cepleri sayıyorum.${count}`;
  }
  return agent.lastPlate ? `Son okuduğum plaka: ${agent.lastPlate}` : 'Kapıyı izliyorum, araç bekliyorum…';
}

// ----------------------------------------------------------------------------- günlük
function loadLogs() {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function saveLogs(logs) {
  try {
    // Görüntüler (base64) yalnızca bellekte tutulur, tarayıcıya yazılmaz (KVKK)
    const slim = Object.fromEntries(
      Object.entries(logs).map(([k, v]) => [k, v.slice(-MAX_LOG).map(({ image, ...rest }) => rest)]),
    );
    localStorage.setItem(LOG_KEY, JSON.stringify(slim));
  } catch {
    // depolama kapalı olabilir
  }
}

// ----------------------------------------------------------------------------- sayfa
export default function AjanOfisi() {
  const toast = useToast();
  const { lots, lotName } = useLot();
  const [agents, setAgents] = useState([]);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);
  const [layouts, setLayouts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [logs, setLogs] = useState(loadLogs);
  const [feed, setFeed] = useState([]);
  const [busy, setBusy] = useState({});
  const [tick, setTick] = useState(Date.now());
  const [now, setNow] = useState(new Date());
  const prevRef = useRef({});
  const agentsRef = useRef([]);
  agentsRef.current = agents;

  const personas = useMemo(() => buildPersonas(agents), [agents]);
  const layoutById = useMemo(() => Object.fromEntries(layouts.map((l) => [l.id, l])), [layouts]);
  const layoutName = useCallback(
    (id) => {
      const l = layoutById[id];
      if (!l) return id || '—';
      const multi = layouts.filter((x) => x.lotCode === l.lotCode).length > 1;
      return `${lotName(l.lotCode)}${multi ? ` · ${floorLabel(l.floor)}` : ''}`;
    },
    [layoutById, layouts, lotName],
  );

  const addLog = useCallback((agentId, entry) => {
    const item = { time: new Date().toISOString(), ...entry };
    setLogs((cur) => {
      const next = { ...cur, [agentId]: [...(cur[agentId] || []), item].slice(-MAX_LOG) };
      saveLogs(next);
      return next;
    });
  }, []);

  const addFeed = useCallback((text, icon = 'bi-dot') => {
    setFeed((cur) => [{ time: new Date().toISOString(), text, icon }, ...cur].slice(0, 30));
  }, []);

  // --- veriler
  const refresh = useCallback(async () => {
    try {
      const a = await getVisionAgents();
      const list = Array.isArray(a) ? a : Array.isArray(a?.agents) ? a.agents : [];
      setAgents(list);
      setError(null);
      return list;
    } catch (err) {
      setError(err);
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
    getVisionHealth().then(setHealth).catch(() => setHealth(null));
    getOccupancyLayouts()
      .then((l) => setLayouts(Array.isArray(l) ? l : []))
      .catch(() => setLayouts([]));
    const t1 = setInterval(refresh, 3000);
    const t2 = setInterval(() => getVisionHealth().then(setHealth).catch(() => setHealth(null)), 15000);
    const t3 = setInterval(() => {
      setTick(Date.now());
      setNow(new Date());
    }, 2000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
      clearInterval(t3);
    };
  }, [refresh]);

  useEffect(() => {
    if (!selectedId && agents.length) setSelectedId(agents[0].id);
  }, [agents, selectedId]);

  // Ajanların kendi yaptıklarını (okunan plaka, doluluk değişimi, durum) ofis akışına yaz
  useEffect(() => {
    const prev = prevRef.current;
    agents.forEach((a) => {
      const p = prev[a.id];
      const who = personas[a.id] ? `${personas[a.id].name} (${a.id})` : a.id;
      if (p) {
        if (a.lastPlate && a.lastPlate !== p.lastPlate) addFeed(`${who} ${a.lastPlate} plakasını okudu`, 'bi-upc-scan');
        if (a.status !== p.status) {
          const text = isRunning(a) ? 'işe başladı' : isError(a) ? 'bir sorunla karşılaştı' : 'molaya çıktı';
          addFeed(`${who} ${text}`, isRunning(a) ? 'bi-play-circle' : 'bi-pause-circle');
        }
        if (a.type === 'Occupancy' && a.occupiedCount != null && p.occupiedCount != null && a.occupiedCount !== p.occupiedCount) {
          addFeed(`${who}: ${a.occupiedCount}/${a.slotCount ?? '?'} cep dolu`, 'bi-grid-3x3-gap');
        }
      }
      prev[a.id] = { lastPlate: a.lastPlate, status: a.status, occupiedCount: a.occupiedCount };
    });
  }, [agents, personas, addFeed]);

  // --- görevler
  const setAgentBusy = (id, v) => setBusy((cur) => ({ ...cur, [id]: v }));

  const reply = useCallback((agentId, text, extra = {}) => addLog(agentId, { who: 'agent', text, ...extra }), [addLog]);

  const statusReport = useCallback(
    (a) => {
      if (!a) return 'Beni bulamadım (servis yeniden başlamış olabilir).';
      const where = a.type === 'Occupancy' ? `${layoutName(a.layout)} krokisini izliyorum` : `${lotName(a.lotCode)} için ${a.gate === 'Exit' ? 'çıkış' : 'giriş'} kapısındayım`;
      const state = isError(a) ? `ama bir sorun var: ${a.lastError}` : isRunning(a) ? `ve çalışıyorum (${Number(a.fps || 0).toFixed(1)} kare/sn)` : 'ama şu an moladayım';
      const extra = a.type === 'Occupancy'
        ? a.occupiedCount != null ? ` Son sayım: ${a.occupiedCount}/${a.slotCount} dolu.` : ''
        : a.lastPlate ? ` Son plaka: ${a.lastPlate}${a.platesDecided ? `, bugün ${a.platesDecided} karar verdim` : ''}.` : '';
      return `${where} ${state}.${extra}`;
    },
    [layoutName, lotName],
  );

  const execute = useCallback(
    async (agentId, cmd, { file, forward = false, ratio = 50 } = {}) => {
      const a = agentsRef.current.find((x) => x.id === agentId);
      if (!a) return;
      setAgentBusy(agentId, true);
      try {
        switch (cmd.type) {
          case 'start': {
            if (isRunning(a)) {
              reply(agentId, 'Zaten çalışıyorum 👍');
              break;
            }
            const others = a.type === 'Gate'
              ? agentsRef.current.filter((o) => o.id !== a.id && o.type === 'Gate' && o.source === a.source && isRunning(o))
              : [];
            await startAgent(agentId);
            reply(agentId, others.length
              ? `İşe başladım. Aynı kamerayı kullandığı için ${others.map((o) => personas[o.id]?.name || o.id).join(', ')} molaya çıktı.`
              : 'İşe başladım!');
            break;
          }
          case 'stop':
            if (!isRunning(a)) {
              reply(agentId, 'Zaten moladayım.');
              break;
            }
            await stopAgent(agentId);
            reply(agentId, 'Tamam, molaya çıkıyorum ☕');
            break;
          case 'assign': {
            const info = await assignAgent(agentId, a.type === 'Occupancy' ? { layout: cmd.layout } : { lot: cmd.lot });
            reply(agentId, a.type === 'Occupancy'
              ? `Artık ${layoutName(info.layout)} krokisini izliyorum (${info.slotCount ?? '?'} cep).${isRunning(a) ? ' Kamerayı yeniden başlattım.' : ''}`
              : `Artık ${lotName(info.lotCode)} için çalışıyorum.${isRunning(a) ? ' Kamerayı yeniden başlattım.' : ''}`);
            break;
          }
          case 'sample': {
            if (a.type !== 'Occupancy') {
              reply(agentId, 'Ben plaka okuyorum, cep saymıyorum. Bunu doluluk gözcüsüne sor 🙂');
              break;
            }
            const r = cmd.ratio ?? ratio;
            const sample = await getOccupancySample(a.layout, { ratio: r / 100, seed: Math.floor(Math.random() * 1e5) });
            const res = await analyzeOccupancy(sample, { layout: a.layout, detector: 'color', forward });
            const occ = (res.slots || []).filter((s) => s.occupied).length;
            reply(agentId, `${layoutName(res.layout)} örnek görüntüsünde (%${r}) saydım: ${occ}/${res.slots?.length ?? 0} cep dolu.${
              forward ? (res.backendResponse?.sent ? ' Sisteme işledim, kroki güncellendi.' : ` Sisteme işleyemedim: ${res.backendResponse?.error || 'hata'}`) : ''}`,
            { image: res.annotatedImageBase64 });
            break;
          }
          case 'photo': {
            if (!file) break;
            if (a.type === 'Occupancy') {
              const res = await analyzeOccupancy(file, { layout: a.layout, detector: 'yolo', forward });
              const occ = (res.slots || []).filter((s) => s.occupied).length;
              reply(agentId, `Fotoğrafta ${res.vehicles} araç gördüm, ${occ}/${res.slots?.length ?? 0} cep dolu.${
                forward ? (res.backendResponse?.sent ? ' Sisteme işledim.' : ' Sisteme işleyemedim.') : ''}`,
              { image: res.annotatedImageBase64 });
            } else {
              const res = await recognizePlate(file, { gate: a.gate || 'Entry', lot: a.lotCode, forward });
              const plates = res.plates || [];
              const br = res.backendResponse;
              const text = plates.length
                ? `${plates.length} plaka buldum: ${plates.map((p) => `${p.plate} (%${Math.round((p.confidence || 0) * 100)})`).join(', ')}.`
                : 'Bu fotoğrafta plaka bulamadım.';
              reply(agentId, `${text}${forward && br ? ` Sistem yanıtı: ${br.message || br.decision || 'gönderildi'}` : ''}`, {
                image: res.annotatedImageBase64,
                plates: plates.map((p) => p.plate),
              });
            }
            break;
          }
          case 'askPhoto':
            reply(agentId, `Fotoğrafı seç, hemen ${a.type === 'Occupancy' ? 'cepleri sayayım' : 'plakaya bakayım'} 📷`);
            break;
          case 'status':
            reply(agentId, statusReport(a));
            break;
          case 'help':
            reply(agentId, `Bana şunları söyleyebilirsin: ${(HELP_TEXT[a.type === 'Occupancy' ? 'Occupancy' : 'Gate'] || []).join(' · ')}`);
            break;
          default:
            reply(agentId, cmd.reason || 'Bunu anlayamadım. "yardım" yazarsan neler yapabildiğimi anlatırım.');
        }
      } catch (err) {
        reply(agentId, `Görevi yapamadım: ${err?.message || 'bilinmeyen hata'}`, { failed: true });
        toast.error(err);
      } finally {
        setAgentBusy(agentId, false);
        refresh();
      }
    },
    [layoutName, lotName, personas, refresh, reply, statusReport, toast],
  );

  const give = useCallback(
    (agentId, label, cmd, opts) => {
      addLog(agentId, { who: 'me', text: label });
      const p = personas[agentId];
      addFeed(`${p?.name || agentId} (${agentId}) görevi aldı: “${label}”`, 'bi-chat-left-text');
      return execute(agentId, cmd, opts);
    },
    [addFeed, addLog, execute, personas],
  );

  // --- şef görevleri
  const chiefSay = (text) => addLog(CHIEF.id, { who: 'agent', text });
  const chiefTask = async (kind) => {
    addLog(CHIEF.id, { who: 'me', text: { all: 'Herkes işe başlasın', none: 'Herkes molaya çıksın', report: 'Durum raporu ver' }[kind] });
    setAgentBusy(CHIEF.id, true);
    try {
      const list = agentsRef.current;
      if (kind === 'all') {
        const usedWebcams = new Set(list.filter((a) => a.type === 'Gate' && isRunning(a)).map((a) => a.source));
        const started = [];
        const skipped = [];
        for (const a of list) {
          if (isRunning(a)) continue;
          if (a.type === 'Gate' && usedWebcams.has(a.source)) {
            skipped.push(personas[a.id]?.name || a.id);
            continue;
          }
          await startAgent(a.id);
          if (a.type === 'Gate') usedWebcams.add(a.source);
          started.push(personas[a.id]?.name || a.id);
        }
        chiefSay(`${started.length ? `${started.join(', ')} işe başladı.` : 'Herkes zaten çalışıyordu.'}${
          skipped.length ? ` ${skipped.join(', ')} aynı kamerayı paylaştığı için bekliyor.` : ''}`);
      } else if (kind === 'none') {
        const running = list.filter(isRunning);
        for (const a of running) await stopAgent(a.id);
        chiefSay(running.length ? `${running.map((a) => personas[a.id]?.name || a.id).join(', ')} molaya çıktı.` : 'Zaten kimse çalışmıyordu.');
      } else {
        const m = health?.models || {};
        const lines = list.map((a) => `${personas[a.id]?.name || a.id}: ${statusReport(a)}`);
        chiefSay(
          `Servis ${health?.status === 'ok' ? 'çalışıyor' : 'sorunlu'}; plaka modeli ${m.plateDetector ? 'hazır' : 'yok'}, araç modeli ${
            m.vehicleDetector ? 'hazır' : 'yok'}, OCR ${m.ocr || 'yok'}.\n${lines.join('\n')}`,
        );
      }
    } catch (err) {
      chiefSay(`Bir sorun çıktı: ${err?.message || 'hata'}`);
      toast.error(err);
    } finally {
      setAgentBusy(CHIEF.id, false);
      refresh();
    }
  };

  const selected = agents.find((a) => a.id === selectedId) || null;
  const chiefSelected = selectedId === CHIEF.id;
  const models = health?.models || {};
  const runningCount = agents.filter(isRunning).length;

  return (
    <div>
      <PageHeader
        icon="bi-people"
        title="Ajan Ofisi"
        subtitle="Kamera ajanlarını ekip arkadaşı gibi görün; bir masaya tıklayıp görevini doğrudan verin."
        badge={<span className="badge text-bg-success fs-6">{runningCount}/{agents.length} çalışıyor</span>}
      />

      <ErrorAlert error={error} onRetry={refresh} title="Ofise ulaşılamıyor (görüntü işleme servisi kapalı olabilir)" className="mb-4" />

      <div className="row g-4">
        <div className="col-xl-8">
          <div className="office-room">
            <div className="office-wall">
              <div className="office-window" title="Otopark manzarası">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <span key={i} className="office-window-car" style={{ left: `${8 + i * 15}%`, background: ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71', '#9b59b6', '#e67e22'][i] }} />
                ))}
              </div>
              <div className="office-board">
                <div className="fw-semibold small">Görev Panosu</div>
                <div className="small">
                  Bugün {Object.values(logs).flat().filter((l) => l.who === 'me' && new Date(l.time).toDateString() === now.toDateString()).length} görev
                </div>
              </div>
              <div className="office-clock">
                <i className="bi bi-clock me-1" />
                {formatTime(now, true)}
              </div>
              <div className="office-plant" aria-hidden="true">🪴</div>
            </div>

            <div className="office-floor">
              <button
                type="button"
                className={`office-desk office-desk-chief ${chiefSelected ? 'office-selected' : ''}`}
                onClick={() => setSelectedId(CHIEF.id)}
              >
                <div className="office-bubble">
                  {health ? (health.status === 'ok' ? 'Modeller hazır, ekip emrinizde.' : 'Modeller yükleniyor…') : 'Servise ulaşamıyorum!'}
                </div>
                <Worker
                  persona={CHIEF}
                  mood={health ? 'working' : 'error'}
                  lamp={health?.status === 'ok' ? 'var(--ap-success)' : 'var(--ap-warning-fill)'}
                  screen={
                    <div className="office-screen-chief">
                      <span className={models.plateDetector ? 'on' : ''}>Plaka</span>
                      <span className={models.vehicleDetector ? 'on' : ''}>Araç</span>
                      <span className={models.ocr && models.ocr !== 'none' ? 'on' : ''}>OCR</span>
                    </div>
                  }
                />
                <div className="office-nameplate">
                  <strong>{CHIEF.name}</strong>
                  <span>{CHIEF.role}</span>
                </div>
              </button>

              {agents.map((a) => {
                const p = personas[a.id];
                if (!p) return null;
                const mood = moodOf(a);
                return (
                  <button
                    type="button"
                    key={a.id}
                    className={`office-desk ${selectedId === a.id ? 'office-selected' : ''}`}
                    onClick={() => setSelectedId(a.id)}
                  >
                    <div className={`office-bubble ${mood === 'error' ? 'office-bubble-error' : ''}`}>
                      {busy[a.id] ? 'Görev üzerinde çalışıyorum…' : bubbleText(a, layoutName)}
                    </div>
                    <Worker
                      persona={p}
                      mood={busy[a.id] ? 'working' : mood}
                      lamp={mood === 'working' ? 'var(--ap-success)' : mood === 'error' ? 'var(--ap-danger)' : 'var(--ap-text-subtle)'}
                      screen={<AgentScreen agent={a} tick={tick} />}
                    />
                    <div className="office-nameplate">
                      <strong>
                        <i className={`bi ${p.icon} me-1`} />
                        {p.name}
                      </strong>
                      <span>
                        {p.role} · {a.type === 'Occupancy' ? layoutName(a.layout) : lotName(a.lotCode)}
                      </span>
                      <code className="small">{a.id}</code>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="card mt-4">
            <div className="card-header">
              <i className="bi bi-activity me-2 text-accent" />
              Ofis Akışı
            </div>
            <ul className="list-group list-group-flush office-feed">
              {feed.length === 0 ? (
                <li className="list-group-item text-secondary small">Henüz bir şey olmadı. Bir ajana görev verin ya da kameraları başlatın.</li>
              ) : (
                feed.map((f, i) => (
                  <li key={`${f.time}-${i}`} className="list-group-item small d-flex gap-2">
                    <span className="text-secondary">{formatTime(f.time, true)}</span>
                    <i className={`bi ${f.icon} text-accent`} />
                    <span>{f.text}</span>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>

        <div className="col-xl-4">
          {chiefSelected ? (
            <ChiefPanel logs={logs[CHIEF.id] || []} busy={!!busy[CHIEF.id]} onTask={chiefTask} />
          ) : selected && personas[selected.id] ? (
            <TaskPanel
              key={selected.id}
              agent={selected}
              persona={personas[selected.id]}
              logs={logs[selected.id] || []}
              busy={!!busy[selected.id]}
              lots={lots}
              layouts={layouts}
              lotName={lotName}
              layoutName={layoutName}
              onGive={give}
              onClear={() => {
                setLogs((cur) => {
                  const next = { ...cur, [selected.id]: [] };
                  saveLogs(next);
                  return next;
                });
              }}
            />
          ) : (
            <div className="card">
              <div className="card-body text-secondary">Görev vermek için ofisten bir ajan seçin.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- paneller
function ChatLog({ logs, persona }) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [logs.length]);
  return (
    <div className="office-chat">
      {logs.length === 0 && <div className="text-secondary small text-center py-3">Henüz görev verilmedi.</div>}
      {logs.map((l, i) => (
        <div key={`${l.time}-${i}`} className={`office-msg ${l.who === 'me' ? 'office-msg-me' : ''} ${l.failed ? 'office-msg-failed' : ''}`}>
          <div className="office-msg-meta">
            {l.who === 'me' ? 'Sen' : persona.name} · {formatTime(l.time)}
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{l.text}</div>
          {l.plates?.length > 0 && (
            <div className="d-flex flex-wrap gap-1 mt-1">
              {l.plates.map((p) => (
                <PlateBadge key={p} plate={p} size="sm" />
              ))}
            </div>
          )}
          {l.image && <img src={toImageSrc(l.image)} alt="Görev sonucu" className="office-msg-img" />}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

function TaskPanel({ agent, persona, logs, busy, lots, layouts, lotName, layoutName, onGive, onClear }) {
  const [text, setText] = useState('');
  const [forward, setForward] = useState(false);
  const [ratio, setRatio] = useState(50);
  const fileRef = useRef(null);
  const isOcc = agent.type === 'Occupancy';
  const running = isRunning(agent);

  const submit = (e) => {
    e.preventDefault();
    const label = text.trim();
    if (!label) return;
    const cmd = parseCommand(label, { agent, lots, layouts });
    setText('');
    if (cmd.type === 'photo') {
      fileRef.current?.click(); // dosya penceresi kullanıcı eylemiyle hemen açılmalı
      onGive(agent.id, label, { type: 'askPhoto' });
      return;
    }
    onGive(agent.id, label, cmd, { forward, ratio });
  };

  const pickFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onGive(agent.id, `${isOcc ? 'Bu fotoğraftaki cepleri say' : 'Bu fotoğraftaki plakayı oku'} (${file.name})`, { type: 'photo' }, { file, forward });
  };

  return (
    <div className="card office-panel">
      <div className="card-header d-flex align-items-center gap-2">
        <span className="office-avatar" style={{ background: persona.shirt }}>{persona.name[0]}</span>
        <div className="min-w-0">
          <div className="fw-semibold">{persona.name} <span className="text-secondary fw-normal small">· {persona.role}</span></div>
          <div className="small text-secondary text-truncate">
            {agent.name || agent.id} · {isOcc ? layoutName(agent.layout) : lotName(agent.lotCode)}
          </div>
        </div>
        <span className={`badge ms-auto text-bg-${isError(agent) ? 'danger' : running ? 'success' : 'secondary'}`}>
          {isError(agent) ? 'Sorun' : running ? 'Çalışıyor' : 'Molada'}
        </span>
      </div>
      <div className="card-body">
        <div className="d-flex flex-wrap gap-2 mb-3">
          {running ? (
            <button type="button" className="btn btn-outline-danger btn-sm" disabled={busy} onClick={() => onGive(agent.id, 'Molaya çık', { type: 'stop' })}>
              <i className="bi bi-pause-fill me-1" />
              Molaya gönder
            </button>
          ) : (
            <button type="button" className="btn btn-success btn-sm" disabled={busy} onClick={() => onGive(agent.id, 'İşe başla', { type: 'start' })}>
              <i className="bi bi-play-fill me-1" />
              İşe başlat
            </button>
          )}
          <button type="button" className="btn btn-outline-primary btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            <i className={`bi ${isOcc ? 'bi-image' : 'bi-upc-scan'} me-1`} />
            {isOcc ? 'Fotoğrafla say' : 'Plaka oku'}
          </button>
          <button type="button" className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => onGive(agent.id, 'Durum raporu ver', { type: 'status' })}>
            <i className="bi bi-clipboard-data me-1" />
            Rapor iste
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="d-none" onChange={pickFile} />
        </div>

        <div className="mb-3">
          <label className="form-label small fw-semibold mb-1" htmlFor="office-assign">
            {isOcc ? 'İzleyeceği kroki' : 'Çalışacağı otopark'}
          </label>
          {isOcc ? (
            <select
              id="office-assign"
              className="form-select form-select-sm"
              value={agent.layout || ''}
              disabled={busy || !layouts.length}
              onChange={(e) => onGive(agent.id, `${layoutName(e.target.value)} krokisine geç`, { type: 'assign', layout: e.target.value })}
            >
              {!layouts.some((l) => l.id === agent.layout) && <option value={agent.layout || ''}>{agent.layout || '—'}</option>}
              {layouts.map((l) => (
                <option key={l.id} value={l.id}>
                  {layoutName(l.id)} — {l.slotCount} cep
                </option>
              ))}
            </select>
          ) : (
            <select
              id="office-assign"
              className="form-select form-select-sm"
              value={agent.lotCode || 'GAZI'}
              disabled={busy || !lots.length}
              onChange={(e) => onGive(agent.id, `${lotName(e.target.value)} otoparkına geç`, { type: 'assign', lot: e.target.value })}
            >
              {lots.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {isOcc && (
          <div className="border rounded p-2 mb-3 bg-body-tertiary">
            <div className="d-flex align-items-center justify-content-between gap-2">
              <label className="small mb-0" htmlFor="office-ratio">
                Örnek doluluk: <strong>%{ratio}</strong>
              </label>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={busy}
                onClick={() => onGive(agent.id, `Örnek görüntüyle doluluğu say (%${ratio})`, { type: 'sample', ratio }, { forward, ratio })}
              >
                <i className="bi bi-magic me-1" />
                Örnekle say
              </button>
            </div>
            <input id="office-ratio" type="range" className="form-range" min="0" max="100" step="10" value={ratio} onChange={(e) => setRatio(Number(e.target.value))} />
          </div>
        )}

        <div className="form-check form-switch mb-3">
          <input id="office-fwd" type="checkbox" className="form-check-input" checked={forward} onChange={(e) => setForward(e.target.checked)} />
          <label className="form-check-label small" htmlFor="office-fwd">
            Sonuçları sisteme işle ({isOcc ? 'kroki güncellenir' : 'gerçek giriş/çıkış olayı oluşur'})
          </label>
        </div>

        <div className="d-flex justify-content-between align-items-center mb-1">
          <span className="small fw-semibold">Görev konuşması</span>
          {logs.length > 0 && (
            <button type="button" className="btn btn-link btn-sm p-0" onClick={onClear}>
              Temizle
            </button>
          )}
        </div>
        <ChatLog logs={logs} persona={persona} />

        <form onSubmit={submit} className="mt-2">
          <div className="input-group">
            <input
              className="form-control"
              placeholder={isOcc ? 'ör. "Merkez kat 1\'e geç", "doluluk say %40"' : 'ör. "işe başla", "AVM\'ye geç", "plaka oku"'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
              aria-label="Görev"
            />
            <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}>
              {busy ? <span className="spinner-border spinner-border-sm" /> : <i className="bi bi-send" />}
            </button>
          </div>
          <div className="d-flex flex-wrap gap-1 mt-2">
            {(isOcc ? ['durum', 'doluluk say %30', 'zemin kata geç', 'yardım'] : ['durum', 'işe başla', 'molaya çık', 'yardım']).map((s) => (
              <button key={s} type="button" className="btn btn-light btn-sm py-0" disabled={busy} onClick={() => setText(s)}>
                {s}
              </button>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}

function ChiefPanel({ logs, busy, onTask }) {
  return (
    <div className="card office-panel">
      <div className="card-header d-flex align-items-center gap-2">
        <span className="office-avatar" style={{ background: CHIEF.shirt }}>{CHIEF.name[0]}</span>
        <div>
          <div className="fw-semibold">{CHIEF.name} <span className="text-secondary fw-normal small">· {CHIEF.role}</span></div>
          <div className="small text-secondary">Tüm ekibe toplu görev verir</div>
        </div>
      </div>
      <div className="card-body">
        <div className="d-grid gap-2 mb-3">
          <button type="button" className="btn btn-success" disabled={busy} onClick={() => onTask('all')}>
            <i className="bi bi-play-fill me-1" />
            Herkes işe başlasın
          </button>
          <button type="button" className="btn btn-outline-danger" disabled={busy} onClick={() => onTask('none')}>
            <i className="bi bi-pause-fill me-1" />
            Herkes molaya çıksın
          </button>
          <button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={() => onTask('report')}>
            <i className="bi bi-clipboard-data me-1" />
            Ekip durum raporu
          </button>
        </div>
        <div className="small text-secondary mb-2">
          Aynı webcam&apos;i paylaşan giriş ve çıkış görevlilerinden yalnızca biri çalışabilir.
        </div>
        <ChatLog logs={logs} persona={CHIEF} />
      </div>
    </div>
  );
}
