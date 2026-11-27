import { useState } from 'react';
import { updateSubscription } from '../../api/subscriptions';
import { useToast } from '../Toast';
import RejectSubscriptionModal from './RejectSubscriptionModal';
import { formatPlate } from '../../utils/plate';

// Navbar'daki bekleyen başvuru rozetini hemen tazeler
const notifyChanged = () => window.dispatchEvent(new Event('akillipark:subscriptions-changed'));

/**
 * Onay / ret akışı (panel ve abonelikler sayfası aynı davranışı kullanır).
 * onChanged(updated): sunucudan dönen güncel kayıt.
 */
export default function useSubscriptionReview(onChanged) {
  const toast = useToast();
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);

  const approve = async (sub) => {
    setBusyId(sub.id);
    try {
      const updated = await updateSubscription(sub.id, { status: 'Active' });
      toast.success(`${formatPlate(sub.plate)} için abonelik onaylandı.`);
      onChanged?.(updated);
      notifyChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (reason) => {
    const sub = rejecting;
    if (!sub) return;
    setBusyId(sub.id);
    try {
      const updated = await updateSubscription(sub.id, { status: 'Rejected', note: reason });
      toast.success(`${formatPlate(sub.plate)} başvurusu reddedildi.`);
      setRejecting(null);
      onChanged?.(updated);
      notifyChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusyId(null);
    }
  };

  const modal = (
    <RejectSubscriptionModal
      subscription={rejecting}
      busy={!!rejecting && busyId === rejecting.id}
      onConfirm={reject}
      onCancel={() => setRejecting(null)}
    />
  );

  return { busyId, approve, startReject: setRejecting, modal };
}
