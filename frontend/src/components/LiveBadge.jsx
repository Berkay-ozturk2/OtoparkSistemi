const MAP = {
  connected: { cls: 'live-on', text: 'Canlı' },
  connecting: { cls: 'live-wait', text: 'Bağlanıyor…' },
  reconnecting: { cls: 'live-wait', text: 'Yeniden bağlanıyor…' },
  disconnected: { cls: 'live-off', text: 'Canlı bağlantı yok' },
};

/** SignalR bağlantı durumu rozeti */
export default function LiveBadge({ status, className = '' }) {
  const info = MAP[status] || MAP.disconnected;
  return (
    <span className={`live-badge ${info.cls} ${className}`} title="Anlık güncelleme (SignalR) durumu">
      <span className="live-dot" />
      {info.text}
    </span>
  );
}
