'use server';

import { createAdminClient } from './admin';
import { getServerProfile } from './server';

export interface CourseStatsRow {
  courseId: string;
  courseName: string;
  teacher: string;
  capacity: number;
  fullCount: number;
  memberSingleUniq: number;
  memberSingleCount: number;
  guestSingleUniq: number;
  guestSingleCount: number;
  makeupUniq: number;
  makeupCount: number;
}

export async function getEnrollmentStats(courseIds: string[]): Promise<CourseStatsRow[]> {
  const { profile } = await getServerProfile();
  if (profile?.role !== 'admin') throw new Error('Unauthorized');
  if (courseIds.length === 0) return [];

  const admin = createAdminClient();

  const [enrollRes, makeupRes, courseRes] = await Promise.all([
    admin
      .from('enrollments')
      .select('course_id, type, user_id, profiles ( role )')
      .in('course_id', courseIds)
      .eq('status', 'enrolled'),
    admin
      .from('makeup_requests')
      .select('target_course_id, user_id')
      .in('target_course_id', courseIds)
      .eq('status', 'approved'),
    admin
      .from('courses')
      .select('id, name, teacher, capacity')
      .in('id', courseIds),
  ]);

  if (enrollRes.error) throw new Error(enrollRes.error.message);
  if (makeupRes.error) throw new Error(makeupRes.error.message);
  if (courseRes.error) throw new Error(courseRes.error.message);

  const statsMap = new Map<string, CourseStatsRow>();
  for (const c of courseRes.data) {
    statsMap.set(c.id, {
      courseId: c.id,
      courseName: c.name,
      teacher: c.teacher,
      capacity: c.capacity,
      fullCount: 0,
      memberSingleUniq: 0,
      memberSingleCount: 0,
      guestSingleUniq: 0,
      guestSingleCount: 0,
      makeupUniq: 0,
      makeupCount: 0,
    });
  }

  // Aggregate enrollments
  const memberSingleUsers = new Map<string, Set<string>>();
  const guestSingleUsers = new Map<string, Set<string>>();

  for (const e of enrollRes.data) {
    const s = statsMap.get(e.course_id);
    if (!s) continue;
    const role = (e.profiles as any)?.role ?? 'guest';

    if (e.type === 'full') {
      s.fullCount++;
    } else if (e.type === 'single') {
      if (role === 'member' || role === 'admin') {
        s.memberSingleCount++;
        if (!memberSingleUsers.has(e.course_id)) memberSingleUsers.set(e.course_id, new Set());
        memberSingleUsers.get(e.course_id)!.add(e.user_id);
      } else {
        s.guestSingleCount++;
        if (!guestSingleUsers.has(e.course_id)) guestSingleUsers.set(e.course_id, new Set());
        guestSingleUsers.get(e.course_id)!.add(e.user_id);
      }
    }
  }

  for (const [cid, users] of memberSingleUsers) {
    const s = statsMap.get(cid);
    if (s) s.memberSingleUniq = users.size;
  }
  for (const [cid, users] of guestSingleUsers) {
    const s = statsMap.get(cid);
    if (s) s.guestSingleUniq = users.size;
  }

  // Aggregate makeup
  const makeupUsers = new Map<string, Set<string>>();
  for (const m of makeupRes.data) {
    const s = statsMap.get(m.target_course_id);
    if (!s) continue;
    s.makeupCount++;
    if (!makeupUsers.has(m.target_course_id)) makeupUsers.set(m.target_course_id, new Set());
    makeupUsers.get(m.target_course_id)!.add(m.user_id);
  }
  for (const [cid, users] of makeupUsers) {
    const s = statsMap.get(cid);
    if (s) s.makeupUniq = users.size;
  }

  return courseIds
    .map((id) => statsMap.get(id))
    .filter((s): s is CourseStatsRow => !!s);
}
