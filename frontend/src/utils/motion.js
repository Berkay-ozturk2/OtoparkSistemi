// Ortak hareket ayarları (aşama 4). Kısa, amaçlı; zıplama yok.
// prefers-reduced-motion açıkken animasyon süresi 0'dır (değer hemen son hâline geçer).
import gsap from 'gsap';

export const DUR = { micro: 0.15, ui: 0.25, count: 0.6, color: 0.45 };
export const EASE = { out: 'power2.out', inOut: 'power2.inOut' };

gsap.defaults({ duration: DUR.ui, ease: EASE.out });

const query = () => (typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : null);

export function prefersReducedMotion() {
  return !!query()?.matches;
}

/** Süreyi kullanıcı tercihine göre verir (azaltılmış harekette 0). */
export const dur = (seconds) => (prefersReducedMotion() ? 0 : seconds);

export { gsap };
