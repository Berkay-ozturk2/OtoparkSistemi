import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { prefersReducedMotion } from '../utils/motion';

/**
 * 3D dönen menü halkası.
 *
 * Paneller bir halka üzerine dizilir: i. panel rotateY(i × adım) translateZ(r).
 * Boşluksuz halka yarıçapı: r = (panel eni / 2) / tan(adım / 2).
 * Sürükleyerek, yatay kaydırarak, ok tuşları/düğmeleriyle döner ve en yakın panele oturur.
 * Öndeki panele tıklamak onu açar; yandaki panele tıklamak onu öne getirir.
 * Arkadaki paneller soluk: opaklık = 0.35 + 0.65 × (cos(açı) + 1) / 2.
 *
 * items: [{ key, title, text, icon, to?, onSelect?, badge?, tone }]
 */
export default function RingMenu({ items, label = 'Menü', initialKey }) {
  const navigate = useNavigate();
  const n = items.length;
  const step = 360 / n;
  const ringRef = useRef(null);
  const panelRefs = useRef([]);
  const state = useRef({ rot: 0, target: 0, dragging: false, lastX: 0, vel: 0, moved: 0 });
  const [front, setFront] = useState(0);
  const [panelW, setPanelW] = useState(210);
  const reduced = useMemo(() => prefersReducedMotion(), []);

  // Ekran daralınca paneller küçülür; yarıçap boşluk kalmayacak şekilde hesaplanır
  useEffect(() => {
    const fit = () => setPanelW(window.innerWidth < 576 ? 150 : window.innerWidth < 992 ? 180 : 210);
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  const radius = Math.round(panelW / 2 / Math.tan(((step / 2) * Math.PI) / 180)) + 18;

  const indexOf = (rot) => (((Math.round(-rot / step) % n) + n) % n);

  // Başlangıçta istenen panel önde
  useEffect(() => {
    const i = Math.max(0, items.findIndex((it) => it.key === initialKey));
    state.current.rot = state.current.target = -i * step;
    setFront(i);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Çizim döngüsü: dönüşü hedefe yumuşakça yaklaştır, panelleri soldur/parlat
  useEffect(() => {
    if (reduced) return undefined;
    let raf = 0;
    let last = performance.now();
    const tick = (now) => {
      const s = state.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!s.dragging) {
        if (Math.abs(s.vel) > 0.02) {
          // Bırakınca savrulma, sonra en yakın panele otur
          s.target += s.vel * dt * 60;
          s.vel *= Math.exp(-dt * 6);
          if (Math.abs(s.vel) <= 0.02) s.target = Math.round(s.target / step) * step;
        }
        s.rot += (s.target - s.rot) * (1 - Math.exp(-dt * 9));
      }
      // Halka biraz geride ve hafif yukarıdan görünür: arkadaki paneller de seçilsin
      if (ringRef.current) ringRef.current.style.transform = `translateZ(${-radius * 1.25}px) rotateX(-9deg) rotateY(${s.rot}deg)`;
      panelRefs.current.forEach((el, i) => {
        if (!el) return;
        const a = ((i * step + s.rot) * Math.PI) / 180;
        const k = (Math.cos(a) + 1) / 2;
        el.style.opacity = String(0.35 + 0.65 * k);
        el.style.filter = `saturate(${0.5 + 0.5 * k}) brightness(${0.75 + 0.25 * k})`;
        el.style.zIndex = String(Math.round(k * 100));
      });
      const f = indexOf(s.rot);
      setFront((old) => (old === f ? old : f));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced, radius, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const rotateTo = useCallback(
    (i) => {
      const s = state.current;
      s.vel = 0;
      // En kısa yoldan dön
      const cur = indexOf(s.target);
      let d = (i - cur) % n;
      if (d > n / 2) d -= n;
      if (d < -n / 2) d += n;
      s.target = Math.round(s.target / step) * step - d * step;
    },
    [n, step], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const open = (it) => {
    if (it.onSelect) it.onSelect();
    else if (it.to) navigate(it.to);
  };

  const onPanelClick = (i) => {
    if (state.current.moved > 6) return; // sürüklemenin sonu tıklama sayılmasın
    if (i === indexOf(state.current.target)) open(items[i]);
    else rotateTo(i);
  };

  // Sürükleme (fare + dokunmatik)
  const onPointerDown = (e) => {
    const s = state.current;
    s.dragging = true;
    s.lastX = e.clientX;
    s.vel = 0;
    s.moved = 0;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const s = state.current;
    if (!s.dragging) return;
    const dx = e.clientX - s.lastX;
    s.lastX = e.clientX;
    s.moved += Math.abs(dx);
    const d = dx * (360 / (2 * Math.PI * radius)) * 1.1; // parmağın altındaki panel parmakla gitsin
    s.rot += d;
    s.target = s.rot;
    s.vel = d;
  };
  const onPointerUp = () => {
    const s = state.current;
    if (!s.dragging) return;
    s.dragging = false;
    if (Math.abs(s.vel) < 0.3) {
      s.vel = 0;
      s.target = Math.round(s.rot / step) * step;
    }
  };
  // Dokunmatik yüzeyde yatay kaydırma halkayı döndürür (dikey kaydırma sayfaya kalır)
  const wheelAcc = useRef(0);
  const onWheel = (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    wheelAcc.current += e.deltaX;
    if (Math.abs(wheelAcc.current) > 60) {
      rotateTo((indexOf(state.current.target) + (wheelAcc.current > 0 ? 1 : -1) + n) % n);
      wheelAcc.current = 0;
    }
  };
  const onKeyDown = (e) => {
    const cur = indexOf(state.current.target);
    if (e.key === 'ArrowRight') rotateTo((cur + 1) % n);
    else if (e.key === 'ArrowLeft') rotateTo((cur - 1 + n) % n);
    else if (e.key === 'Enter' || e.key === ' ') open(items[cur]);
    else return;
    e.preventDefault();
  };

  const cur = items[front];

  // Hareket azaltılmışsa: düz kart ızgarası
  if (reduced) {
    return (
      <nav className="ring-grid" aria-label={label}>
        {items.map((it) => (
          <button key={it.key} type="button" className={`ring-panel ring-tone-${it.tone || 'accent'}`} onClick={() => open(it)}>
            <PanelBody it={it} />
          </button>
        ))}
      </nav>
    );
  }

  return (
    <section className="ring-menu" aria-label={label}>
      <div
        className="ring-stage"
        role="group"
        aria-roledescription="döner menü"
        aria-label={`${label}: ${cur?.title}. Sağ ve sol ok tuşlarıyla dönün, Enter ile açın.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        style={{ '--ring-w': `${panelW}px` }}
      >
        <div className="ring" ref={ringRef}>
          {items.map((it, i) => (
            <button
              key={it.key}
              ref={(el) => (panelRefs.current[i] = el)}
              type="button"
              tabIndex={-1}
              aria-hidden={i !== front}
              className={`ring-panel ring-tone-${it.tone || 'accent'} ${i === front ? 'is-front' : ''}`}
              style={{ transform: `rotateY(${i * step}deg) translateZ(${radius}px)` }}
              onClick={() => onPanelClick(i)}
            >
              <PanelBody it={it} />
            </button>
          ))}
        </div>
      </div>

      <div className="ring-footer">
        <button type="button" className="btn btn-outline-secondary btn-sm ring-arrow" onClick={() => rotateTo((front - 1 + n) % n)} aria-label="Önceki">
          <i aria-hidden="true" className="bi bi-chevron-left" />
        </button>
        <div className="ring-now" aria-live="polite">
          <span className="ring-now-kicker">Şu an seçili</span>
          <span className="ring-now-title">{cur?.title}</span>
        </div>
        <button type="button" className="btn btn-accent btn-sm" onClick={() => open(cur)}>
          Aç <i aria-hidden="true" className="bi bi-arrow-right ms-1" />
        </button>
        <button type="button" className="btn btn-outline-secondary btn-sm ring-arrow" onClick={() => rotateTo((front + 1) % n)} aria-label="Sonraki">
          <i aria-hidden="true" className="bi bi-chevron-right" />
        </button>
      </div>

      {/* Ekran okuyucular ve klavye için düz liste */}
      <ul className="visually-hidden">
        {items.map((it) => (
          <li key={it.key}>
            <button type="button" onClick={() => open(it)}>
              {it.title}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PanelBody({ it }) {
  return (
    <>
      <span className="ring-panel-glow" aria-hidden="true" />
      <span className="ring-panel-icon" aria-hidden="true">
        <i className={`bi ${it.icon}`} />
      </span>
      {it.badge != null && it.badge !== '' && <span className="ring-panel-badge">{it.badge}</span>}
      <span className="ring-panel-title">{it.title}</span>
      <span className="ring-panel-text">{it.text}</span>
    </>
  );
}
