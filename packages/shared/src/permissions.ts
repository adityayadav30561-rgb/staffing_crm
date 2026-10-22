import type { Role } from './enums';

export const isManager = (role: Role) => role === 'manager' || role === 'admin';
export const isAdmin = (role: Role) => role === 'admin';

/** Fee terms, placement fees and invoices are visible to managers and admins only. */
export const canSeeFees = isManager;
export const canDelete = isManager;
export const canAssign = (role: Role, isOwner: boolean) => isManager(role) || isOwner;

/** Who may edit a requirement or work its pipeline. */
export const canWorkRequirement = (role: Role, isOwner: boolean, isAssignee: boolean) =>
  isManager(role) || isOwner || isAssignee;
