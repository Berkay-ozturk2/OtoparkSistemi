// CSV dışa aktarma (Excel'in Türkçe sürümüyle uyumlu: UTF-8 BOM + ";" ayırıcı)

function escapeCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Sayıları Excel-TR için virgüllü ondalıkla yazar */
export function csvNumber(value, digits = 2) {
  const n = Number(value);
  if (value === null || value === undefined || Number.isNaN(n)) return '';
  return n.toFixed(digits).replace('.', ',');
}

/**
 * @param {string} filename  ör. "doluluk-raporu.csv"
 * @param {string[]} headers
 * @param {Array<Array<any>>} rows
 */
export function downloadCsv(filename, headers, rows) {
  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(';'));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
