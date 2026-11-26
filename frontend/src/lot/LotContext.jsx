import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getLots } from '../api/parking';

// Çoklu otopark (sözleşme bölüm 11): seçili otopark kodu tarayıcıda saklanır.
export const LOT_STORAGE_KEY = 'akillipark_lot';
export const DEFAULT_LOT = 'GAZI';
const REFRESH_MS = 30000;

const LotContext = createContext(null);

function readStoredLot() {
  try {
    return localStorage.getItem(LOT_STORAGE_KEY) || DEFAULT_LOT;
  } catch {
    return DEFAULT_LOT;
  }
}

/**
 * Otopark listesi + seçili otopark.
 * /api/parking/lots ile liste alınır ve boş yer rozetleri için 30 sn'de bir sessizce tazelenir.
 */
export function LotProvider({ children }) {
  const [lots, setLots] = useState([]);
  const [lotCode, setLotCodeState] = useState(readStoredLot);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const timer = useRef(null);

  const reloadLots = useCallback(async () => {
    try {
      const list = await getLots();
      setLots(Array.isArray(list) ? list : []);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reloadLots();
    timer.current = setInterval(reloadLots, REFRESH_MS);
    return () => clearInterval(timer.current);
  }, [reloadLots]);

  // Saklanan kod artık listede yoksa (silinmiş/pasif) varsayılana dön
  useEffect(() => {
    if (lots.length && !lots.some((l) => l.code === lotCode)) {
      const fallback = lots.find((l) => l.code === DEFAULT_LOT)?.code || lots[0].code;
      setLotCodeState(fallback);
    }
  }, [lots, lotCode]);

  const setLotCode = useCallback((code) => {
    const next = code || DEFAULT_LOT;
    setLotCodeState(next);
    try {
      localStorage.setItem(LOT_STORAGE_KEY, next);
    } catch {
      // yok say
    }
  }, []);

  const value = useMemo(() => {
    const byCode = {};
    lots.forEach((l) => {
      byCode[l.code] = l;
    });
    return {
      lots,
      lotCode,
      setLotCode,
      currentLot: byCode[lotCode] || null,
      lotName: (code) => (code ? byCode[code]?.name || code : '—'),
      loading,
      error,
      reloadLots,
    };
  }, [lots, lotCode, setLotCode, loading, error, reloadLots]);

  return <LotContext.Provider value={value}>{children}</LotContext.Provider>;
}

export function useLot() {
  const ctx = useContext(LotContext);
  if (!ctx) throw new Error('useLot, LotProvider içinde kullanılmalıdır.');
  return ctx;
}
