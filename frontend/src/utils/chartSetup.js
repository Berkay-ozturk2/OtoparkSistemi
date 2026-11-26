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
ChartJS.defaults.color = '#475569';
ChartJS.defaults.plugins.legend.labels.usePointStyle = true;
ChartJS.defaults.maintainAspectRatio = false;

export const CHART_COLORS = {
  navy: '#13315c',
  teal: '#14b8a6',
  tealSoft: 'rgba(20, 184, 166, 0.18)',
  navySoft: 'rgba(19, 49, 92, 0.75)',
  orange: '#f59e0b',
  red: '#ef4444',
  green: '#22c55e',
  slate: '#94a3b8',
  palette: ['#13315c', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444', '#0ea5e9'],
};

export default ChartJS;
