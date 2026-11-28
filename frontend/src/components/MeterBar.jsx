import { useEffect, useRef } from 'react';
import { DUR, EASE, dur, gsap } from '../utils/motion';

/**
 * Yüzde çubuğu. Genişlik yerine scaleX animasyonu (yerleşim yeniden hesaplanmaz).
 *  value : 0..1
 *  label : ekran okuyucu için ad (ör. "A bölgesi doluluk")
 */
export default function MeterBar({ value, label, barClassName = '', className = '' }) {
  const bar = useRef(null);
  const v = Math.max(0, Math.min(1, Number(value) || 0));
  const pct = Math.round(v * 100);

  useEffect(() => {
    if (!bar.current) return undefined;
    const tween = gsap.to(bar.current, { scaleX: v, duration: dur(DUR.count), ease: EASE.out, overwrite: true });
    return () => tween.kill();
  }, [v]);

  return (
    <div
      className={`progress meter-bar ${className}`}
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`%${pct}`}
    >
      <div ref={bar} className={`progress-bar ${barClassName}`} style={{ width: '100%', transform: 'scaleX(0)' }} />
    </div>
  );
}
