// Operatör ekranlarındaki sesli uyarılar (Canlı İzleme'deki "Ses açık/kapalı" ayarına bağlıdır)
export const SOUND_KEY = 'akillipark_sound';

export function isSoundOn() {
  try {
    return localStorage.getItem(SOUND_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSoundOn(on) {
  try {
    localStorage.setItem(SOUND_KEY, on ? '1' : '0');
  } catch {
    // yok say
  }
}

let ctx = null;

const TONES = {
  Allowed: [880, 1175],
  Denied: [330, 247],
  PendingReview: [660, 660],
  // İhlal: dikkat çekici üçlü uyarı
  Violation: [988, 740, 988, 740],
};

/**
 * Kısa uyarı sesi çalar. force=true değilse ses ayarı kapalıyken sessiz kalır.
 * @param {'Allowed'|'Denied'|'PendingReview'|'Violation'} kind
 */
export function playAlert(kind, { force = false } = {}) {
  if (!force && !isSoundOn()) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!ctx) ctx = new Ctx();
    const tones = TONES[kind] || TONES.PendingReview;
    const step = kind === 'Violation' ? 0.14 : 0.18;
    tones.forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = kind === 'Violation' ? 'square' : 'sine';
      o.frequency.value = freq;
      o.connect(g);
      g.connect(ctx.destination);
      const t0 = ctx.currentTime + i * step;
      g.gain.setValueAtTime(kind === 'Violation' ? 0.09 : 0.18, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + step - 0.02);
      o.start(t0);
      o.stop(t0 + step - 0.01);
    });
  } catch {
    // ses desteklenmiyor
  }
}
