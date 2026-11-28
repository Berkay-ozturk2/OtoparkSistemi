import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { cssToken } from '../../theme/theme';
import { createIntroScene, HERO_PLATE, PHASES, TARGET_SLOT } from '../../components/intro3d/introScene';

gsap.registerPlugin(ScrollTrigger);

// Her bölüm sayfada kendi yüksekliği kadar kaydırılır (vh); sahnedeki zaman aralığı PHASES'te
const STEPS = [
  {
    key: 'hero',
    vh: 110,
    kicker: 'Nasıl çalışır?',
    title: 'Kart yok, bilet yok, bekleme yok.',
    text: 'Aşağı kaydırın: bir aracın yoldan gelip otoparkta yerine yerleşmesini birlikte izleyelim.',
  },
  {
    key: 'drive',
    vh: 170,
    kicker: 'Adım 1',
    title: 'Kamera aracı görür',
    text: 'Giriş köprüsündeki kamera yaklaşan aracı algılar. Durmanıza, cam açmanıza ya da kart aramanıza gerek yok.',
  },
  {
    key: 'read',
    vh: 160,
    kicker: 'Adım 2',
    title: 'Plaka saniyeler içinde okunur',
    text: 'Görüntü işleme servisi plakayı bulur ve metne çevirir. Emin olmadığı okumaları görevlinin onayına sunar.',
  },
  {
    key: 'gate',
    vh: 130,
    kicker: 'Adım 3',
    title: 'Giriş kaydedilir, bariyer kalkar',
    text: 'Plaka ve giriş saati kaydedilir; abonelik, rezervasyon ve engelli izni kontrol edilir. Her şey uygunsa kol kalkar.',
  },
  {
    key: 'park',
    vh: 170,
    kicker: 'Adım 4',
    title: 'Size en uygun boş yer',
    text: `Sistem en yakın boş yeri önerir (${TARGET_SLOT}). Krokide canlı görür, doğrudan yerinize gidersiniz.`,
  },
  {
    key: 'live',
    vh: 190,
    kicker: 'Gün boyu',
    title: 'Otopark her an güncel',
    text: 'Saat ilerledikçe araçlar gelir ve gider; boş yer sayısı kameralardan anında güncellenir. Siz de gelmeden önce bakın.',
    cta: true,
  },
];

const pad = (n) => String(n).padStart(2, '0');
const fmtHour = (h) => `${pad(Math.floor(h))}:${pad(Math.floor((h % 1) * 60))}`;

/** 3D, kaydırmayla ilerleyen "Nasıl çalışır?" sayfası. Sahne kurulamazsa onFail çağrılır. */
export default function Tanitim3D({ onFail }) {
  const root = useRef(null);
  const canvasHost = useRef(null);
  const stageRef = useRef(null);
  const sceneRef = useRef(null);
  const hud = useRef({});
  const stepRefs = useRef([]);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState(0);

  // Sayfayı kapsayıcının dışına taşır (tam genişlik) ve navbar yüksekliğini CSS'e verir
  useLayoutEffect(() => {
    const el = root.current;
    const fit = () => {
      const nav = document.querySelector('.app-navbar');
      el.style.setProperty('--i3d-nav', `${nav ? nav.offsetHeight : 0}px`);
      el.style.marginLeft = '0px';
      const left = el.getBoundingClientRect().left;
      el.style.marginLeft = `${-left}px`;
      el.style.width = `${document.documentElement.clientWidth}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // Sahne
  useEffect(() => {
    let scene;
    // Her kurulumda yeni tuval: StrictMode'daki ikinci kurulum, kaybedilmiş WebGL bağlamını yeniden kullanmasın
    const canvas = document.createElement('canvas');
    canvas.className = 'i3d-canvas';
    canvasHost.current.appendChild(canvas);
    try {
      scene = createIntroScene(canvas, {
        accent: cssToken('--ap-accent', '#0a7590'),
        onHud: (s) => applyHud(hud.current, s),
      });
    } catch (err) {
      canvas.remove();
      onFail?.(err);
      return undefined;
    }
    sceneRef.current = scene;
    const stage = stageRef.current;
    const ro = new ResizeObserver(() => scene.resize(stage.clientWidth, stage.clientHeight));
    ro.observe(stage);
    scene.resize(stage.clientWidth, stage.clientHeight);
    let alive = true;
    scene.ready.then(() => alive && setReady(true)).catch((err) => alive && onFail?.(err));
    return () => {
      alive = false;
      ro.disconnect();
      scene.dispose();
      canvas.remove();
      sceneRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Kaydırma: her bölüm sahnede kendi zaman aralığını oynatır
  useEffect(() => {
    const html = document.documentElement;
    const prevBehavior = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    const keys = STEPS.map((s) => PHASES[s.key]);
    const triggers = stepRefs.current.map((el, i) => {
      const [a, b] = keys[i];
      const first = i === 0;
      const lastOne = i === STEPS.length - 1;
      return ScrollTrigger.create({
        trigger: el,
        start: first ? 'top top' : 'top center',
        end: lastOne ? 'bottom bottom' : 'bottom center',
        onUpdate: (self) => {
          sceneRef.current?.setProgress(a + (b - a) * self.progress);
          fadeCard(el.firstElementChild, self.progress, first, lastOne);
        },
        onToggle: (self) => self.isActive && setPhase(i),
      });
    });
    stepRefs.current.forEach((el, i) => fadeCard(el.firstElementChild, 0, i === 0, false));
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
    return () => {
      triggers.forEach((t) => t.kill());
      html.style.scrollBehavior = prevBehavior;
    };
  }, []);

  const goTo = (i) => {
    const el = stepRefs.current[i];
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - (i === 0 ? 0 : window.innerHeight * 0.3);
    window.scrollTo({ top, behavior: 'smooth' });
  };

  return (
    <div ref={root} className="i3d">
      <div ref={stageRef} className="i3d-stage" aria-hidden="true">
        <div ref={canvasHost} className="i3d-canvas-host" />
        {!ready && (
          <div className="i3d-loading">
            <span className="spinner-border spinner-border-sm me-2" />
            3D sahne hazırlanıyor…
          </div>
        )}

        {/* Plaka okuma katmanı: tarayıcı çerçeve + okunan metin */}
        <div className="i3d-scan" ref={(el) => (hud.current.scan = el)}>
          <span className="i3d-scan-line" />
        </div>
        <div className="i3d-ocr" ref={(el) => (hud.current.ocr = el)}>
          <div className="i3d-ocr-label" ref={(el) => (hud.current.ocrLabel = el)}>
            Okunuyor…
          </div>
          <div className="i3d-plate">
            <span className="i3d-plate-tr">TR</span>
            <span ref={(el) => (hud.current.ocrText = el)} />
          </div>
          <div className="i3d-conf">
            <span ref={(el) => (hud.current.confBar = el)} />
          </div>
        </div>

        {/* Giriş kaydı */}
        <div className="i3d-record" ref={(el) => (hud.current.record = el)}>
          <div className="fw-semibold mb-1">
            <i className="bi bi-journal-check me-1" />
            Giriş kaydı
          </div>
          <div className="i3d-row"><span>Plaka</span><strong>{HERO_PLATE}</strong></div>
          <div className="i3d-row"><span>Giriş</span><strong>08:42</strong></div>
          <div className="i3d-row"><span>Önerilen yer</span><strong>{TARGET_SLOT}</strong></div>
          <div className="i3d-gate" ref={(el) => (hud.current.gate = el)}>Kontrol ediliyor…</div>
        </div>

        {/* Canlı doluluk */}
        <div className="i3d-stats" ref={(el) => (hud.current.stats = el)}>
          <div>
            <i className="bi bi-clock me-1" />
            <strong ref={(el) => (hud.current.clock = el)}>08:42</strong>
          </div>
          <div>
            <span className="i3d-free" ref={(el) => (hud.current.free = el)}>0</span>
            <span className="small"> boş yer</span>
          </div>
        </div>

        <nav className="i3d-dots" aria-hidden="true">
          {STEPS.map((s, i) => (
            <button key={s.key} type="button" tabIndex={-1} className={i === phase ? 'is-active' : ''} onClick={() => goTo(i)} title={s.title} />
          ))}
        </nav>
      </div>

      <div className="i3d-steps">
        {STEPS.map((s, i) => (
          <section key={s.key} ref={(el) => (stepRefs.current[i] = el)} className={`i3d-step i3d-step-${s.key}`} style={{ height: `${s.vh}vh` }}>
            <div className="i3d-card">
              <p className="i3d-kicker">{s.kicker}</p>
              {i === 0 ? <h1 className="i3d-title">{s.title}</h1> : <h2 className="i3d-title">{s.title}</h2>}
              <p className="i3d-text">{s.text}</p>
              {i === 0 && <i className="bi bi-chevron-double-down i3d-cue" aria-hidden="true" />}
              {s.cta && (
                <div className="d-flex flex-wrap gap-2 mt-3">
                  <Link to="/" className="btn btn-accent">
                    Boş yerleri gör
                  </Link>
                  <Link to="/aracim-nerede" className="btn btn-outline-secondary">
                    Aracım nerede?
                  </Link>
                  <Link to="/kayit" className="btn btn-outline-secondary">
                    Abone ol
                  </Link>
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Bölüm kartı: bölüm başında belirir, sonunda kaybolur (iki kart üst üste binmesin) */
function fadeCard(card, k, first, last) {
  if (!card) return;
  const inK = first ? 1 : Math.min(1, k / 0.12);
  const outK = last ? 1 : Math.min(1, (1 - k) / 0.14);
  const a = Math.max(0, Math.min(inK, outK));
  card.style.opacity = String(a);
  card.style.transform = `translateY(${(1 - inK) * 24 - (1 - outK) * 24}px)`;
  card.style.visibility = a < 0.01 ? 'hidden' : 'visible';
}

/** Sahneden gelen bilgiyle HUD öğelerini doğrudan günceller (React yeniden çizimi yok) */
function applyHud(h, s) {
  if (!h.scan) return;
  const show = (el, k) => {
    el.style.opacity = String(k);
    el.style.visibility = k > 0.01 ? 'visible' : 'hidden';
  };
  const readOn = s.readK > 0 && s.readK < 1 ? Math.min(1, s.readK * 8, (1 - s.readK) * 10) : 0;
  const w = Math.max(60, s.plate.w * 1.5);
  h.scan.style.transform = `translate(${s.plate.x - w / 2}px, ${s.plate.y - w * 0.2}px)`;
  h.scan.style.width = `${w}px`;
  h.scan.style.height = `${w * 0.4}px`;
  show(h.scan, s.plate.visible ? readOn : 0);

  const typed = Math.round(Math.min(1, s.readK * 1.6) * HERO_PLATE.length);
  h.ocrText.textContent = HERO_PLATE.slice(0, typed) || ' ';
  const conf = Math.round(55 + 42 * Math.min(1, s.readK * 1.4));
  h.confBar.style.width = `${conf}%`;
  h.ocrLabel.textContent = typed >= HERO_PLATE.length ? `Okundu · %${conf} güven` : 'Okunuyor…';
  const ocrW = h.ocr.offsetWidth || 220;
  const ox = Math.min(Math.max(12, s.plate.x - ocrW / 2), (h.ocr.parentElement?.clientWidth || 800) - ocrW - 12);
  h.ocr.style.transform = `translate(${ox}px, ${s.plate.y + w * 0.35}px)`;
  show(h.ocr, s.plate.visible ? Math.min(1, s.readK * 6) * (1 - Math.max(0, (s.readK - 0.95) * 20)) : 0);

  show(h.record, s.recordK);
  h.gate.textContent = s.open > 0.6 ? 'Bariyer açıldı · iyi parklar' : 'Abonelik ve izinler kontrol ediliyor…';
  h.gate.classList.toggle('is-open', s.open > 0.6);

  show(h.stats, s.statsK);
  h.clock.textContent = fmtHour(s.hour);
  h.free.textContent = `${s.free}/${s.total}`;
}
