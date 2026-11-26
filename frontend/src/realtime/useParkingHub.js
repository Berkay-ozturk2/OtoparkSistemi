import { useEffect, useRef, useState } from 'react';
import { HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { API_URL, getToken } from '../api/client';

export const HUB_URL = `${API_URL}/hubs/parking`;

// Sözleşme bölüm 8 ve 11.5'teki olay adları
export const HUB_EVENTS = {
  SlotsUpdated: 'SlotsUpdated',
  SummaryUpdated: 'SummaryUpdated',
  GateEvent: 'GateEvent',
  ReviewQueueChanged: 'ReviewQueueChanged',
  AgentsUpdated: 'AgentsUpdated',
  ViolationDetected: 'ViolationDetected',
  ViolationResolved: 'ViolationResolved',
  PermitsChanged: 'PermitsChanged',
};

const HANDLER_KEYS = {
  SlotsUpdated: 'onSlotsUpdated',
  SummaryUpdated: 'onSummaryUpdated',
  GateEvent: 'onGateEvent',
  ReviewQueueChanged: 'onReviewQueueChanged',
  AgentsUpdated: 'onAgentsUpdated',
  ViolationDetected: 'onViolationDetected',
  ViolationResolved: 'onViolationResolved',
  PermitsChanged: 'onPermitsChanged',
};

const RETRY_DELAYS = [0, 2000, 5000, 10000, 15000, 30000];

/**
 * /hubs/parking SignalR bağlantısı.
 *
 * @param {object} handlers  { onSlotsUpdated, onSummaryUpdated, onGateEvent, onReviewQueueChanged, onAgentsUpdated,
 *                            onViolationDetected, onViolationResolved, onPermitsChanged, onReconnected }
 * @param {object} options   { withAuth: bool } — true ise JWT ile bağlanır (operators grubu: plaka içeren olaylar)
 * @returns {{ status: 'connecting'|'connected'|'reconnecting'|'disconnected' }}
 */
export default function useParkingHub(handlers = {}, { withAuth = false, enabled = true } = {}) {
  const [status, setStatus] = useState('connecting');
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const token = withAuth ? getToken() : null;

  useEffect(() => {
    if (!enabled) {
      setStatus('disconnected');
      return undefined;
    }

    let disposed = false;
    let retryTimer = null;
    let attempt = 0;

    const options = {};
    if (token) {
      // WebSocket bağlantısında ?access_token=<JWT> olarak eklenir
      options.accessTokenFactory = () => getToken() || '';
    }

    const connection = new HubConnectionBuilder()
      .withUrl(HUB_URL, options)
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: (ctx) =>
          RETRY_DELAYS[Math.min(ctx.previousRetryCount, RETRY_DELAYS.length - 1)],
      })
      .configureLogging(import.meta.env.DEV ? LogLevel.Warning : LogLevel.Error)
      .build();

    Object.entries(HANDLER_KEYS).forEach(([eventName, key]) => {
      connection.on(eventName, (payload) => {
        const fn = handlersRef.current?.[key];
        if (typeof fn === 'function') {
          try {
            fn(payload);
          } catch (err) {
            console.error(`[SignalR] ${eventName} işleyicisinde hata`, err);
          }
        }
      });
    });

    connection.onreconnecting(() => {
      if (!disposed) setStatus('reconnecting');
    });

    connection.onreconnected(() => {
      if (disposed) return;
      setStatus('connected');
      handlersRef.current?.onReconnected?.();
    });

    const scheduleStart = () => {
      if (disposed) return;
      const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)] || 2000;
      attempt += 1;
      retryTimer = setTimeout(start, delay);
    };

    // Otomatik yeniden bağlanma vazgeçerse kendimiz yeniden başlatırız
    connection.onclose(() => {
      if (disposed) return;
      setStatus('disconnected');
      scheduleStart();
    });

    async function start() {
      if (disposed) return;
      if (connection.state !== HubConnectionState.Disconnected) return;
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
      try {
        await connection.start();
        if (disposed) {
          connection.stop().catch(() => {});
          return;
        }
        const wasRetry = attempt > 0;
        attempt = 0;
        setStatus('connected');
        if (wasRetry) handlersRef.current?.onReconnected?.();
      } catch {
        if (disposed) return;
        setStatus('disconnected');
        scheduleStart();
      }
    }

    start();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      connection.stop().catch(() => {});
    };
  }, [token, enabled]);

  return { status };
}
