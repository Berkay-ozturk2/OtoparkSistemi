import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import PlateBadge from '../../components/PlateBadge';
import { cssToken } from '../../theme/theme';

gsap.registerPlugin(useGSAP, ScrollTrigger);

const STEPS = [
  { icon: 'bi-camera-video', title: 'Kamera aracı görür', text: 'Giriş kamerası yaklaşan aracı algılar ve plakanın görüntüsünü alır.' },
  { icon: 'bi-upc-scan', title: 'Plaka okunur', text: 'Görüntü işleme servisi plakayı saniyeler içinde metne çevirir. Emin olmadığı okumaları görevliye sorar.' },
  { icon: 'bi-journal-check', title: 'Giriş kaydedilir', text: 'Plaka ve giriş saati kaydedilir; abonelik, rezervasyon ve engelli izni kontrol edilir.' },
  { icon: 'bi-door-open', title: 'Bariyer açılır', text: 'Kontroller geçerse bariyer açılır ve sürücüye uygun bölge önerilir.' },
];

/** Tanıtım: kaydırdıkça kamera → plaka okuma → kayıt → bariyer akışı */
export default function Tanitim() {
  const root = useRef(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      // Hareket azaltılmışsa sahne sabit, tüm adımlar görünür (CSS)
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const q = gsap.utils.selector(root);
        const tl = gsap.timeline({
          defaults: { ease: 'power2.inOut', duration: 1 },
          scrollTrigger: {
            trigger: q('.intro-stage-wrap')[0],
            start: 'top top',
            end: '+=2400',
            scrub: 0.6,
            pin: true,
            onUpdate: (self) => {
              const i = Math.min(STEPS.length - 1, Math.floor(self.progress * STEPS.length));
              q('.intro-step').forEach((el, n) => el.classList.toggle('is-active', n === i));
            },
          },
        });

        gsap.set(q('.intro-scan, .intro-ocr, .intro-record'), { autoAlpha: 0 });
        gsap.set(q('.intro-car'), { x: -260 });
        gsap.set(q('.intro-ocr'), { y: 8 });

        tl.addLabel('camera')
          .to(q('.intro-car'), { x: 0 })
          .to(q('.intro-cam-beam'), { autoAlpha: 1, duration: 0.4 }, '<0.5')
          .addLabel('read')
          .to(q('.intro-scan'), { autoAlpha: 1, duration: 0.2 })
          .fromTo(q('.intro-scan'), { y: -18 }, { y: 18, duration: 0.8, ease: 'none' }, '<')
          .to(q('.intro-scan'), { autoAlpha: 0, duration: 0.2 })
          .to(q('.intro-ocr'), { autoAlpha: 1, y: 0, duration: 0.5 }, '<')
          .addLabel('record')
          .fromTo(q('.intro-record'), { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.6 })
          .addLabel('gate')
          .to(q('.intro-arm'), { rotation: -78, svgOrigin: '60 150', duration: 0.8 })
          .to(q('.intro-light'), { fill: cssToken('--ap-success', '#198754'), duration: 0.2 }, '<')
          .to(q('.intro-car'), { x: 330, duration: 1 });
      });
      // Sayfanın yumuşak kaydırması sabitlemeyle çakışır; bu sayfada kapatılır
      const html = document.documentElement;
      const prevBehavior = html.style.scrollBehavior;
      html.style.scrollBehavior = 'auto';
      // Yazı tipleri yüklenince yükseklikler değişir: tetik noktalarını yeniden hesapla
      document.fonts?.ready.then(() => ScrollTrigger.refresh());
      return () => {
        html.style.scrollBehavior = prevBehavior;
        mm.revert();
      };
    },
    { scope: root },
  );

  return (
    <div ref={root} className="intro-page">
      <header className="intro-hero text-center">
        <p className="text-uppercase small fw-semibold text-secondary mb-2">Nasıl çalışır?</p>
        <h1 className="display-6 fw-bold mb-3">Plakanız okunur, bariyer açılır</h1>
        <p className="lead text-secondary mx-auto intro-lead">
          Akıllı otoparkta kart, bilet ya da bekleme yok. Aşağı kaydırın; aracın girişten bariyere kadar geçtiği dört adımı izleyin.
        </p>
        <i className="bi bi-chevron-double-down fs-3 text-secondary intro-cue" aria-hidden="true" />
      </header>

      <section className="intro-stage-wrap" aria-label="Giriş akışı">
        <div className="intro-stage">
          <ol className="intro-steps list-unstyled">
            {STEPS.map((s, i) => (
              <li key={s.title} className={`intro-step ${i === 0 ? 'is-active' : ''}`}>
                <span className="intro-step-icon" aria-hidden="true">
                  <i aria-hidden="true" className={`bi ${s.icon}`} />
                </span>
                <div>
                  <h2 className="h6 mb-1">
                    <span className="visually-hidden">Adım {i + 1}: </span>
                    {s.title}
                  </h2>
                  <p className="small text-secondary mb-0">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="intro-scene card" aria-hidden="true">
            <svg viewBox="0 0 480 220" className="intro-svg">
              <rect x="0" y="182" width="480" height="38" className="intro-road" />
              <line x1="0" y1="201" x2="480" y2="201" className="intro-road-line" />
              {/* Kamera direği */}
              <rect x="300" y="40" width="8" height="142" className="intro-pole" />
              <rect x="276" y="30" width="44" height="22" rx="5" className="intro-cam" />
              <circle cx="280" cy="41" r="5" className="intro-cam-lens" />
              <path d="M276 41 L190 150 L250 160 Z" className="intro-cam-beam" opacity="0" />
              {/* Bariyer */}
              <rect x="50" y="130" width="20" height="52" rx="4" className="intro-post" />
              <circle cx="60" cy="140" r="5" className="intro-light" />
              <g className="intro-arm">
                <rect x="60" y="144" width="150" height="10" rx="5" className="intro-pole-arm" />
              </g>
              {/* Araç */}
              <g className="intro-car">
                <rect x="190" y="138" width="120" height="36" rx="10" className="intro-car-body" />
                <rect x="212" y="116" width="72" height="28" rx="8" className="intro-car-top" />
                <circle cx="216" cy="176" r="11" className="intro-wheel" />
                <circle cx="286" cy="176" r="11" className="intro-wheel" />
                <rect x="190" y="150" width="34" height="12" rx="2" className="intro-plate" />
                <rect x="190" y="146" width="34" height="2" className="intro-scan" />
              </g>
            </svg>
            <div className="intro-ocr">
              <span className="small text-secondary me-2">Okunan plaka</span>
              <PlateBadge plate="06ABC123" size="sm" />
              <span className="badge text-bg-success ms-2">%97 güven</span>
            </div>
            <div className="intro-record card">
              <div className="card-body py-2 small">
                <div className="fw-semibold mb-1">
                  <i aria-hidden="true" className="bi bi-journal-check me-1" />
                  Giriş kaydı
                </div>
                <div>Giriş: 08:42 · Önerilen bölge: A</div>
                <div className="text-success fw-semibold">Bariyer açılıyor</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="intro-end text-center">
        <h2 className="h4 fw-bold">Hepsi birkaç saniyede</h2>
        <p className="text-secondary">Boş yerleri canlı görün, yerinizi ayırın ya da aracınızı bulun.</p>
        <div className="d-flex flex-wrap justify-content-center gap-2">
          <Link to="/" className="btn btn-accent">
            Boş yerleri gör
          </Link>
          <Link to="/aracim-nerede" className="btn btn-outline-secondary">
            Aracım nerede?
          </Link>
        </div>
      </section>
    </div>
  );
}
