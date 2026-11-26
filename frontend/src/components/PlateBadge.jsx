import { formatPlate } from '../utils/plate';

/**
 * Türk plakası görünümlü rozet: solda mavi "TR" şeridi, sağda "34 ABC 123".
 * size: 'sm' | 'md' | 'lg' | 'xl'
 */
export default function PlateBadge({ plate, size = 'md', className = '', title }) {
  const text = formatPlate(plate) || '—';
  return (
    <span className={`plate-badge plate-${size} ${className}`} title={title || text} aria-label={`Plaka ${text}`}>
      <span className="plate-tr" aria-hidden="true">
        <span className="plate-stars">★</span>
        TR
      </span>
      <span className="plate-text">{text}</span>
    </span>
  );
}
