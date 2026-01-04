/**
 * User role types
 * 
 * - guest: 非社員 (non-member)
 * - member: 社員 (member)
 * - leader: 班長 (class leader)
 * - staff: 幹部 (staff/officer)
 */
export type UserRole = 'guest' | 'member' | 'leader' | 'staff';

/**
 * Profile data structure matching the database schema
 */
export interface Profile {
  id: string;
  name: string;
  employee_id?: string | null;
  phone?: string | null;
  role: UserRole;
  member_valid_until?: string | null; // ISO date string
  created_at: string;
  updated_at: string;
}

/**
 * Helper function to check if a user has a specific role
 */
export function hasRole(userRole: UserRole, requiredRole: UserRole): boolean {
  const roleHierarchy: Record<UserRole, number> = {
    guest: 0,
    member: 1,
    leader: 2,
    staff: 3,
  };
  
  return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

/**
 * Check if user is a staff member
 */
export function isStaff(role: UserRole): boolean {
  return role === 'staff';
}

/**
 * Check if user is a leader
 */
export function isLeader(role: UserRole): boolean {
  return role === 'leader' || role === 'staff';
}

/**
 * Check if user is a member (has member privileges)
 */
export function isMember(role: UserRole): boolean {
  return role === 'member' || role === 'leader' || role === 'staff';
}

