import { useTheme } from '../theme/theme';

/** Navbar'daki açık/koyu mod düğmesi. */
export default function ThemeToggle({ className = '' }) {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  const label = dark ? 'Açık moda geç' : 'Koyu moda geç';
  return (
    <button type="button" className={`theme-toggle ${className}`} onClick={toggle} aria-label={label} title={label}>
      <i className={`bi ${dark ? 'bi-sun' : 'bi-moon-stars'}`} aria-hidden="true" />
    </button>
  );
}
