// Chart.js bileşen kaydı (bir kez içe aktarılması yeterlidir)
import {
  Chart as ChartJS,
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js';
import { THEME_EVENT, cssToken } from '../theme/theme';

ChartJS.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
);

ChartJS.defaults.font.family = "'Inter Variable', 'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif";
ChartJS.defaults.plugins.legend.labels.usePointStyle = true;
ChartJS.defaults.maintainAspectRatio = false;

// Renkler theme/tokens.css'ten okunur; tema değişince yerinde güncellenir.
// (Eski anahtar adları korunur: navy = marka mavisi, teal = camgöbeği vurgu.)
export const CHART_COLORS = {};

function withAlpha(rgbList, a) {
  return `rgba(${rgbList}, ${a})`;
}

export function refreshChartColors() {
  const brand = cssToken('--ap-brand', '#1f56d6');
  const accent = cssToken('--ap-accent', '#0b7c96');
  Object.assign(CHART_COLORS, {
    navy: brand,
    teal: accent,
    tealSoft: withAlpha(cssToken('--ap-accent-rgb', '11, 124, 150'), 0.16),
    navySoft: withAlpha(cssToken('--ap-brand-rgb', '31, 86, 214'), 0.75),
    navyFaint: withAlpha(cssToken('--ap-brand-rgb', '31, 86, 214'), 0.12),
    orange: cssToken('--ap-warning-fill', '#e8a317'),
    red: cssToken('--ap-danger', '#c42b3a'),
    green: cssToken('--ap-success', '#13795b'),
    slate: cssToken('--ap-text-subtle', '#8b95a7'),
    palette: [brand, accent, cssToken('--ap-warning-fill'), cssToken('--ap-slot-subscriber'), cssToken('--ap-slot-occupied'), cssToken('--ap-text-subtle')],
  });
  ChartJS.defaults.color = cssToken('--ap-text-muted', '#5a6478');
  ChartJS.defaults.borderColor = cssToken('--ap-border', '#e1e6ee');
  ChartJS.defaults.scale.grid.color = ChartJS.defaults.borderColor;
  ChartJS.defaults.scale.ticks.color = ChartJS.defaults.color;
}

refreshChartColors();
if (typeof window !== 'undefined') {
  window.addEventListener(THEME_EVENT, () => {
    refreshChartColors();
    Object.values(ChartJS.instances || {}).forEach((chart) => {
      chart.options.color = ChartJS.defaults.color;
      chart.options.borderColor = ChartJS.defaults.borderColor;
      // Eksen renkleri grafik oluşturulurken sabitlenir: elle tazele
      Object.values(chart.options.scales || {}).forEach((scale) => {
        if (scale.grid) scale.grid.color = ChartJS.defaults.borderColor;
        if (scale.ticks) scale.ticks.color = ChartJS.defaults.color;
        if (scale.border) scale.border.color = ChartJS.defaults.borderColor;
      });
      if (chart.options.plugins?.legend?.labels) chart.options.plugins.legend.labels.color = ChartJS.defaults.color;
      chart.update('none');
    });
  });
}

export default ChartJS;
