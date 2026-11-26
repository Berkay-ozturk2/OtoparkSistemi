export const ROLES = {
  Admin: 'Admin',
  Operator: 'Operator',
  Driver: 'Driver',
};

/** Giriş sonrası varsayılan sayfa */
export function homePathForRole(role) {
  switch (role) {
    case ROLES.Admin:
      return '/yonetim';
    case ROLES.Operator:
      return '/operator';
    case ROLES.Driver:
      return '/surucu';
    default:
      return '/';
  }
}

/** Belirli bir yola hangi roller girebilir? (giriş sonrası "from" yönlendirmesi için) */
export function canAccessPath(role, path) {
  if (!path) return false;
  if (path.startsWith('/yonetim')) return role === ROLES.Admin;
  if (path.startsWith('/operator')) return role === ROLES.Operator || role === ROLES.Admin;
  if (path.startsWith('/surucu')) return role === ROLES.Driver;
  return true;
}
