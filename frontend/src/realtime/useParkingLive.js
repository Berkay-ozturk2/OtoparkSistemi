import { useCallback, useEffect, useRef, useState } from 'react';
import { getLotLayout, getRecommendation, getSlots, getSummary, getZones } from '../api/parking';
import { useLot } from '../lot/LotContext';
import useParkingHub from './useParkingHub';

/** Olay verisi seçili otoparka mı ait? (lotCode yoksa eski sürüm backend → varsayılan otopark kabul edilir) */
export function belongsToLot(item, lotCode, defaultLot = 'GAZI') {
  if (!item) return false;
  return (item.lotCode || defaultLot) === lotCode;
}

/** Değişen cepleri mevcut listeye işler (cep kodu otopark içinde benzersizdir) */
export function mergeSlots(current, changed) {
  if (!Array.isArray(changed) || changed.length === 0) return current;
  const map = new Map(current.map((s) => [s.code, s]));
  let touched = false;
  changed.forEach((c) => {
    if (!c || !c.code) return;
    const prev = map.get(c.code);
    if (!prev) return; // bu otoparkta olmayan cep
    touched = true;
    map.set(c.code, { ...prev, ...c, _flash: Date.now() });
  });
  return touched ? Array.from(map.values()) : current;
}

/**
 * Seçili otoparkın canlı verisi: kroki düzeni (lot + cepler), özet, bölgeler, öneri.
 * REST ile ilk yükleme + SignalR SlotsUpdated/SummaryUpdated ile anlık güncelleme (seçili otoparka göre süzülür).
 *
 * @param {object} extraHandlers  useParkingHub'a geçirilecek ek işleyiciler (GateEvent, ViolationDetected vb.)
 * @param {object} options        { withAuth, lotCode } — lotCode verilmezse genel seçili otopark (LotContext)
 */
export default function useParkingLive(extraHandlers = {}, options = {}) {
  const { lotCode: ctxLot, reloadLots } = useLot();
  const lotCode = options.lotCode || ctxLot;
  const hubOptions = { withAuth: options.withAuth, enabled: options.enabled };

  const [lot, setLot] = useState(null);
  const [summary, setSummary] = useState(null);
  const [zones, setZones] = useState([]);
  const [slots, setSlots] = useState([]);
  const [recommendation, setRecommendation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const refreshTimer = useRef(null);
  const lotsTimer = useRef(null);
  const lotRef = useRef(lotCode);
  lotRef.current = lotCode;
  const reqId = useRef(0);

  const loadAll = useCallback(async () => {
    const my = ++reqId.current;
    const code = lotCode;
    setError(null);
    try {
      const [layout, sum, z, rec] = await Promise.all([
        getLotLayout(code).catch(async (err) => {
          // Eski backend (bölüm 11 öncesi): düzen uç noktası yoksa yalnızca cepleri al
          if (err?.status === 404) {
            const s = await getSlots(code);
            return { lot: null, zones: [], slots: s };
          }
          throw err;
        }),
        getSummary(code),
        getZones(code),
        getRecommendation(code).catch(() => null), // otopark doluysa 404 dönebilir
      ]);
      if (my !== reqId.current) return; // otopark bu arada değişti
      const zoneList = Array.isArray(z) ? z : [];
      // Bölge kat bilgisini düzendeki bölgelerle birleştir
      const layoutZones = Array.isArray(layout?.zones) ? layout.zones : [];
      const merged = zoneList.length
        ? zoneList.map((zz) => ({ ...(layoutZones.find((lz) => lz.code === zz.code) || {}), ...zz }))
        : layoutZones;
      setLot(layout?.lot || null);
      setSlots(Array.isArray(layout?.slots) ? layout.slots : []);
      setSummary(sum);
      setZones(merged);
      setRecommendation(rec);
      setLastUpdate(new Date());
    } catch (err) {
      if (my === reqId.current) setError(err);
    } finally {
      if (my === reqId.current) setLoading(false);
    }
  }, [lotCode]);

  // Bölge boş sayıları ve öneri, cep değişikliklerinden sonra kısa gecikmeyle tazelenir
  const refreshDerived = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(async () => {
      const code = lotRef.current;
      try {
        const [z, rec] = await Promise.all([getZones(code), getRecommendation(code).catch(() => null)]);
        if (code !== lotRef.current) return;
        const zoneList = Array.isArray(z) ? z : [];
        setZones((cur) => zoneList.map((zz) => ({ ...(cur.find((c) => c.code === zz.code) || {}), ...zz })));
        setRecommendation(rec);
      } catch {
        // sessizce yok say; bir sonraki olayda tekrar denenir
      }
    }, 800);
  }, []);

  useEffect(() => {
    setLoading(true);
    setSlots([]);
    setLot(null);
    setSummary(null);
    setZones([]);
    setRecommendation(null);
    loadAll();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [loadAll]);

  useEffect(() => () => lotsTimer.current && clearTimeout(lotsTimer.current), []);

  const { status: hubStatus } = useParkingHub(
    {
      ...extraHandlers,
      onSlotsUpdated: (changed) => {
        const mine = Array.isArray(changed) ? changed.filter((c) => belongsToLot(c, lotRef.current)) : [];
        if (mine.length) {
          setSlots((cur) => mergeSlots(cur, mine));
          setLastUpdate(new Date());
          refreshDerived();
        }
        extraHandlers.onSlotsUpdated?.(changed);
      },
      onSummaryUpdated: (sum) => {
        if (sum && belongsToLot(sum, lotRef.current)) {
          setSummary(sum);
          setLastUpdate(new Date());
        }
        // Otopark seçicideki boş yer rozetleri (art arda gelen olaylarda tek istek)
        if (lotsTimer.current) clearTimeout(lotsTimer.current);
        lotsTimer.current = setTimeout(() => reloadLots?.(), 2000);
        extraHandlers.onSummaryUpdated?.(sum);
      },
      onReconnected: () => {
        loadAll();
        extraHandlers.onReconnected?.();
      },
    },
    hubOptions,
  );

  return {
    lotCode,
    lot,
    summary,
    zones,
    slots,
    recommendation,
    loading,
    error,
    lastUpdate,
    hubStatus,
    reload: loadAll,
    setSlots,
  };
}
