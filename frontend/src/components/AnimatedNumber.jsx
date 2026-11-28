import { useEffect, useRef } from 'react';
import { DUR, EASE, dur, gsap } from '../utils/motion';

const defaultFormat = (v) => Math.round(v).toLocaleString('tr-TR');

/**
 * Değişince eski değerden yenisine sayan sayı. React yeniden çizimi olmadan metni günceller.
 * Ekran okuyucu yalnızca son değeri okur (ara değerler aria-hidden kopyada).
 */
export default function AnimatedNumber({ value, format = defaultFormat, duration = DUR.count, className = '' }) {
  const ref = useRef(null);
  const state = useRef({ v: Number(value) || 0 });
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const el = ref.current;
    const target = Number(value) || 0;
    if (!el) return undefined;
    const tween = gsap.to(state.current, {
      v: target,
      duration: dur(duration),
      ease: EASE.out,
      overwrite: true,
      onUpdate: () => {
        el.textContent = formatRef.current(state.current.v);
      },
    });
    return () => tween.kill();
  }, [value, duration]);

  const finalText = format(Number(value) || 0);
  return (
    <span className={`animated-number ${className}`}>
      <span ref={ref} aria-hidden="true">
        {format(state.current.v)}
      </span>
      <span className="visually-hidden">{finalText}</span>
    </span>
  );
}
