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

ChartJS.defaults.font.family =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
ChartJS.defaults.color = '#52525b';
ChartJS.defaults.plugins.legend.labels.usePointStyle = true;
ChartJS.defaults.maintainAspectRatio = false;

export const CHART_COLORS = {
  // Tema: grafit (eski adıyla navy) + kırmızı vurgu (eski adıyla teal)
  navy: '#3f3f46',
  teal: '#d61f2c',
  tealSoft: 'rgba(214, 31, 44, 0.16)',
  navySoft: 'rgba(63, 63, 70, 0.75)',
  orange: '#f59e0b',
  red: '#ef4444',
  green: '#22c55e',
  slate: '#a1a1aa',
  palette: ['#3f3f46', '#d61f2c', '#f59e0b', '#a1a1aa', '#7f1d1d', '#0ea5e9'],
};

export default ChartJS;
