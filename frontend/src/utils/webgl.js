// 3D kroki için cihaz yeteneği kontrolleri (three.js yüklenmeden çalışır).

/** Tarayıcı WebGL bağlamı oluşturabiliyor mu (WebGL 2 ya da 1)? */
export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** Düşük donanımlı / veri tasarrufu modundaki cihaz: varsayılan 2D */
export function isLowEndDevice() {
  const n = typeof navigator !== 'undefined' ? navigator : {};
  return (n.hardwareConcurrency && n.hardwareConcurrency <= 2) || (n.deviceMemory && n.deviceMemory <= 2) || n.connection?.saveData === true;
}
