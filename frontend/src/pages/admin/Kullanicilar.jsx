import { useCallback, useEffect, useMemo, useState } from 'react';
import { createUser, deleteUser, getUsers, updateUser } from '../../api/admin';
import { useAuth } from '../../auth/AuthContext';
import PageHeader from '../../components/PageHeader';
import Loading from '../../components/Loading';
import ErrorAlert from '../../components/ErrorAlert';
import EmptyState from '../../components/EmptyState';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import { useToast } from '../../components/Toast';
import { ROLE_LABELS, formatDate, roleLabel } from '../../utils/format';

const ROLE_VARIANT = { Admin: 'danger', Operator: 'info', Driver: 'secondary' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function UserForm({ value, onChange, isNew }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return (
    <div className="row g-3">
      <div className="col-12">
        <label className="form-label" htmlFor="uf-name">
          Ad Soyad
        </label>
        <input id="uf-name" className="form-control" value={value.fullName} onChange={set('fullName')} />
      </div>
      <div className="col-md-6">
        <label className="form-label" htmlFor="uf-email">
          E-posta
        </label>
        <input id="uf-email" type="email" className="form-control" value={value.email} onChange={set('email')} disabled={!isNew} />
        {!isNew && <div className="form-text">E-posta değiştirilemez.</div>}
      </div>
      <div className="col-md-6">
        <label className="form-label" htmlFor="uf-phone">
          Telefon
        </label>
        <input id="uf-phone" type="tel" className="form-control" value={value.phone || ''} onChange={set('phone')} />
      </div>
      {isNew && (
        <div className="col-md-6">
          <label className="form-label" htmlFor="uf-pw">
            Geçici parola
          </label>
          <input id="uf-pw" type="text" className="form-control" value={value.password} onChange={set('password')} autoComplete="new-password" />
          <div className="form-text">En az 8 karakter. Kullanıcıya güvenli kanaldan iletin.</div>
        </div>
      )}
      <div className="col-md-6">
        <label className="form-label" htmlFor="uf-role">
          Rol
        </label>
        <select id="uf-role" className="form-select" value={value.role} onChange={set('role')}>
          {Object.entries(ROLE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {!isNew && (
        <div className="col-12">
          <div className="form-check form-switch">
            <input id="uf-active" type="checkbox" className="form-check-input" checked={!!value.isActive} onChange={set('isActive')} />
            <label className="form-check-label" htmlFor="uf-active">
              Hesap aktif
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

/** UC-13: Kullanıcı yetkilerini yönet */
export default function Kullanicilar() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [editing, setEditing] = useState(null);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const u = await getUsers();
      setUsers(Array.isArray(u) ? u : []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr-TR');
    return users
      .filter((u) => !roleFilter || u.role === roleFilter)
      .filter(
        (u) =>
          !q ||
          (u.fullName || '').toLocaleLowerCase('tr-TR').includes(q) ||
          (u.email || '').toLocaleLowerCase('tr-TR').includes(q) ||
          (u.phone || '').includes(q),
      );
  }, [users, query, roleFilter]);

  const counts = users.reduce((acc, u) => ({ ...acc, [u.role]: (acc[u.role] || 0) + 1 }), {});
  const isMe = (u) => me && (u.id === me.id || u.email === me.email);

  const save = async () => {
    const isNew = !editing.id;
    if (String(editing.fullName).trim().length < 3) return setFormError('Ad soyad giriniz.');
    if (isNew && !EMAIL_RE.test(String(editing.email).trim())) return setFormError('Geçerli bir e-posta giriniz.');
    if (isNew && String(editing.password).length < 8) return setFormError('Parola en az 8 karakter olmalıdır.');
    if (!isNew && isMe(editing) && (editing.role !== 'Admin' || !editing.isActive))
      return setFormError('Kendi yönetici yetkinizi kaldıramaz veya hesabınızı pasif yapamazsınız.');
    setFormError(null);
    setSaving(true);
    try {
      if (isNew) {
        await createUser({
          fullName: editing.fullName.trim(),
          email: editing.email.trim(),
          phone: (editing.phone || '').trim(),
          password: editing.password,
          role: editing.role,
        });
        toast.success('Kullanıcı oluşturuldu.');
      } else {
        await updateUser(editing.id, {
          fullName: editing.fullName.trim(),
          phone: (editing.phone || '').trim(),
          role: editing.role,
          isActive: !!editing.isActive,
        });
        toast.success('Kullanıcı güncellendi.');
      }
      setEditing(null);
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
    return undefined;
  };

  const toggleActive = async (u) => {
    if (isMe(u)) {
      toast.warning('Kendi hesabınızı pasif yapamazsınız.');
      return;
    }
    try {
      await updateUser(u.id, { fullName: u.fullName, phone: u.phone, role: u.role, isActive: !u.isActive });
      setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, isActive: !u.isActive } : x)));
      toast.success(`${u.fullName} ${u.isActive ? 'pasif' : 'aktif'} yapıldı.`);
    } catch (err) {
      toast.error(err);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await deleteUser(toDelete.id);
      setUsers((list) => list.filter((x) => x.id !== toDelete.id));
      toast.success('Kullanıcı silindi.');
      setToDelete(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <PageHeader
        icon="bi-people"
        title="Kullanıcılar"
        subtitle="Kullanıcı hesaplarını, rollerini ve erişim durumlarını yönetin."
        actions={
          <button
            type="button"
            className="btn btn-accent"
            onClick={() => {
              setFormError(null);
              setEditing({ fullName: '', email: '', phone: '', password: '', role: 'Operator', isActive: true });
            }}
          >
            <i className="bi bi-person-plus me-1" />
            Yeni Kullanıcı
          </button>
        }
      />

      <div className="card mb-3">
        <div className="card-body">
          <div className="row g-2 align-items-center">
            <div className="col-md-6">
              <div className="input-group">
                <span className="input-group-text">
                  <i className="bi bi-search" />
                </span>
                <input className="form-control" placeholder="Ad, e-posta veya telefon ara…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
            </div>
            <div className="col-md-6">
              <div className="btn-group flex-wrap" role="group" aria-label="Rol filtresi">
                <button type="button" className={`btn btn-sm ${roleFilter === '' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setRoleFilter('')}>
                  Tümü ({users.length})
                </button>
                {Object.entries(ROLE_LABELS).map(([k, v]) => (
                  <button key={k} type="button" className={`btn btn-sm ${roleFilter === k ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setRoleFilter(k)}>
                    {v} ({counts[k] || 0})
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <ErrorAlert error={error} onRetry={load} className="mb-3" />

      <div className="card">
        <div className="card-body p-0">
          {loading ? (
            <Loading />
          ) : rows.length === 0 ? (
            <EmptyState icon="bi-people" title="Kullanıcı bulunamadı" />
          ) : (
            <div className="table-responsive">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th>Ad Soyad</th>
                    <th>E-posta</th>
                    <th>Telefon</th>
                    <th>Rol</th>
                    <th>Durum</th>
                    <th>Kayıt</th>
                    <th className="text-end">İşlemler</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => (
                    <tr key={u.id} className={u.isActive ? '' : 'text-secondary'}>
                      <td className="fw-semibold">
                        {u.fullName}
                        {isMe(u) && <span className="badge text-bg-light border ms-2">Siz</span>}
                      </td>
                      <td className="small">{u.email}</td>
                      <td className="small">{u.phone || '—'}</td>
                      <td>
                        <span className={`badge text-bg-${ROLE_VARIANT[u.role] || 'secondary'}`}>{roleLabel(u.role)}</span>
                      </td>
                      <td>
                        <div className="form-check form-switch mb-0">
                          <input
                            type="checkbox"
                            className="form-check-input"
                            checked={!!u.isActive}
                            onChange={() => toggleActive(u)}
                            disabled={isMe(u)}
                            aria-label="Aktif"
                          />
                          <span className="small">{u.isActive ? 'Aktif' : 'Pasif'}</span>
                        </div>
                      </td>
                      <td className="small text-nowrap">{formatDate(u.createdAt)}</td>
                      <td className="text-end text-nowrap">
                        <button
                          type="button"
                          className="btn btn-sm btn-light me-1"
                          title="Düzenle"
                          onClick={() => {
                            setFormError(null);
                            setEditing({ ...u, phone: u.phone || '' });
                          }}
                        >
                          <i className="bi bi-pencil" />
                        </button>
                        <button type="button" className="btn btn-sm btn-outline-danger" title="Sil" disabled={isMe(u)} onClick={() => setToDelete(u)}>
                          <i className="bi bi-trash" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Modal
        show={!!editing}
        title={editing?.id ? 'Kullanıcıyı düzenle' : 'Yeni kullanıcı'}
        icon="bi-person-gear"
        onClose={saving ? undefined : () => setEditing(null)}
        footer={
          <>
            <button type="button" className="btn btn-light" onClick={() => setEditing(null)} disabled={saving}>
              Vazgeç
            </button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
              {saving && <span className="spinner-border spinner-border-sm me-2" />}
              Kaydet
            </button>
          </>
        }
      >
        {editing && (
          <>
            {formError && <div className="alert alert-danger py-2">{formError}</div>}
            <UserForm value={editing} onChange={setEditing} isNew={!editing.id} />
          </>
        )}
      </Modal>

      <ConfirmModal
        show={!!toDelete}
        title="Kullanıcıyı sil"
        icon="bi-person-x"
        variant="danger"
        confirmText="Sil"
        busy={deleting}
        onConfirm={doDelete}
        onCancel={() => setToDelete(null)}
        message={toDelete ? `${toDelete.fullName} (${toDelete.email}) kullanıcısını silmek istediğinize emin misiniz? Bu işlem geri alınamaz.` : ''}
      />
    </div>
  );
}
