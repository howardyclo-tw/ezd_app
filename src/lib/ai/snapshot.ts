import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Pre-fetch a data snapshot to inject into the AI system prompt.
 *
 * This eliminates "schema exploration" tool calls — the model can answer most
 * questions directly from the snapshot, only calling runQuery for details not
 * covered here.
 *
 * Security: all SQL is hardcoded (zero user-input interpolation). Runs with
 * service-role client, same as runQueryTool. Only called after admin role check.
 */
export async function buildDataSnapshot(): Promise<string> {
  const admin = createAdminClient();

  try {
    const [groupsRes, courseStatsRes, profileRes] = await Promise.all([
      // All course groups
      admin.rpc('exec_readonly_sql', {
        query: `SELECT id, title, period_start, period_end FROM course_groups ORDER BY created_at DESC`,
      }),
      // All courses with enrollment/leave/makeup stats, grouped by course_group
      admin.rpc('exec_readonly_sql', {
        query: `
          SELECT
            cg.title AS group_title,
            c.name, c.teacher, c.type, c.capacity,
            COUNT(e.id) FILTER (WHERE e.type='full' AND e.status='enrolled' AND p.role<>'guest') AS member_full,
            COUNT(e.id) FILTER (WHERE e.type='full' AND e.status='enrolled' AND p.role='guest') AS guest_full,
            COUNT(e.id) FILTER (WHERE e.type='single' AND e.status='enrolled' AND p.role<>'guest') AS member_single_cnt,
            COUNT(DISTINCT e.user_id) FILTER (WHERE e.type='single' AND e.status='enrolled' AND p.role<>'guest') AS member_single_uniq,
            COUNT(e.id) FILTER (WHERE e.type='single' AND e.status='enrolled' AND p.role='guest') AS guest_single_cnt,
            COUNT(DISTINCT e.user_id) FILTER (WHERE e.type='single' AND e.status='enrolled' AND p.role='guest') AS guest_single_uniq
          FROM courses c
          JOIN course_groups cg ON c.group_id = cg.id
          LEFT JOIN enrollments e ON e.course_id = c.id
          LEFT JOIN profiles p ON p.id = e.user_id
          GROUP BY cg.title, cg.created_at, c.id, c.name, c.teacher, c.type, c.capacity
          ORDER BY cg.created_at DESC, c.type, c.teacher, c.name`,
      }),
      // Profile summary
      admin.rpc('exec_readonly_sql', {
        query: `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE role='member') AS members, COUNT(*) FILTER (WHERE role='admin') AS admins, COUNT(*) FILTER (WHERE role='guest') AS guests FROM profiles`,
      }),
    ]);

    // Leave and makeup stats (separate for reliability — LATERAL joins can be flaky)
    const [leaveRes, makeupRes] = await Promise.all([
      admin.rpc('exec_readonly_sql', {
        query: `
          SELECT c.name AS course_name, cg.title AS group_title,
            COUNT(*) FILTER (WHERE p.role<>'guest') AS member_cnt,
            COUNT(DISTINCT lr.user_id) FILTER (WHERE p.role<>'guest') AS member_uniq,
            COUNT(*) FILTER (WHERE p.role='guest') AS guest_cnt,
            COUNT(DISTINCT lr.user_id) FILTER (WHERE p.role='guest') AS guest_uniq
          FROM leave_requests lr
          JOIN courses c ON lr.course_id = c.id
          JOIN course_groups cg ON c.group_id = cg.id
          JOIN profiles p ON p.id = lr.user_id
          WHERE lr.status = 'approved'
          GROUP BY cg.title, c.name`,
      }),
      admin.rpc('exec_readonly_sql', {
        query: `
          SELECT c.name AS course_name, cg.title AS group_title,
            COUNT(*) FILTER (WHERE p.role<>'guest') AS member_cnt,
            COUNT(DISTINCT mr.user_id) FILTER (WHERE p.role<>'guest') AS member_uniq,
            COUNT(*) FILTER (WHERE p.role='guest') AS guest_cnt,
            COUNT(DISTINCT mr.user_id) FILTER (WHERE p.role='guest') AS guest_uniq
          FROM makeup_requests mr
          JOIN courses c ON mr.target_course_id = c.id
          JOIN course_groups cg ON c.group_id = cg.id
          JOIN profiles p ON p.id = mr.user_id
          WHERE mr.status = 'approved'
          GROUP BY cg.title, c.name`,
      }),
    ]);

    const groups = Array.isArray(groupsRes.data) ? groupsRes.data : [];
    const courseStats = Array.isArray(courseStatsRes.data) ? courseStatsRes.data : [];
    const prof = Array.isArray(profileRes.data) ? profileRes.data[0] : null;
    const leaves = Array.isArray(leaveRes.data) ? leaveRes.data : [];
    const makeups = Array.isArray(makeupRes.data) ? makeupRes.data : [];

    if (!groups.length) return '';

    // Index leave/makeup by "group_title|course_name" for quick lookup
    const leaveMap = new Map<string, any>();
    for (const l of leaves) leaveMap.set(`${l.group_title}|${l.course_name}`, l);
    const makeupMap = new Map<string, any>();
    for (const m of makeups) makeupMap.set(`${m.group_title}|${m.course_name}`, m);

    let out = `\n--- LIVE DATA SNAPSHOT (queried just now; answer directly from this when possible, only call runQuery for details NOT answerable here) ---\n`;

    if (prof) {
      out += `\nProfile summary: ${prof.total} users (${prof.members} members, ${prof.admins} admins, ${prof.guests} guests)\n`;
    }

    out += `\nCourse groups (newest first):\n`;
    for (const g of groups) {
      out += `  - "${g.title}" (period: ${g.period_start || 'N/A'} ~ ${g.period_end || 'N/A'})\n`;
    }

    // Group courses by their course_group
    const byGroup = new Map<string, any[]>();
    for (const c of courseStats) {
      const arr = byGroup.get(c.group_title) || [];
      arr.push(c);
      byGroup.set(c.group_title, arr);
    }

    for (const [groupTitle, courses] of byGroup) {
      const normalCourses = courses.filter((c: any) => c.type === 'normal');
      const otherCourses = courses.filter((c: any) => c.type !== 'normal');

      if (normalCourses.length) {
        out += `\n"${groupTitle}" — ${normalCourses.length} normal courses:\n`;
        out += `Course | Teacher | Cap | 社員整期 | 非社員整期 | 社員堂卡(人/次) | 非社員堂卡(人/次) | 社員請假(人/次) | 非社員請假(人/次) | 社員補課(人/次) | 非社員補課(人/次)\n`;
        for (const c of normalCourses) {
          const key = `${groupTitle}|${c.name}`;
          const lv = leaveMap.get(key);
          const mk = makeupMap.get(key);
          out += `${c.name} | ${c.teacher} | ${c.capacity}`;
          out += ` | ${c.member_full} | ${c.guest_full}`;
          out += ` | ${c.member_single_uniq}/${c.member_single_cnt} | ${c.guest_single_uniq}/${c.guest_single_cnt}`;
          out += ` | ${lv?.member_uniq ?? 0}/${lv?.member_cnt ?? 0} | ${lv?.guest_uniq ?? 0}/${lv?.guest_cnt ?? 0}`;
          out += ` | ${mk?.member_uniq ?? 0}/${mk?.member_cnt ?? 0} | ${mk?.guest_uniq ?? 0}/${mk?.guest_cnt ?? 0}\n`;
        }
      }

      if (otherCourses.length) {
        out += `\n"${groupTitle}" — ${otherCourses.length} other courses (${[...new Set(otherCourses.map((c: any) => c.type))].join(', ')}):\n`;
        for (const c of otherCourses) {
          out += `  ${c.name} (${c.teacher}, type: ${c.type}, enrolled: ${c.member_full + c.guest_full} full + ${c.member_single_cnt + c.guest_single_cnt} single)\n`;
        }
      }
    }

    out += `--- END SNAPSHOT ---`;
    return out;
  } catch (e) {
    console.error('[snapshot] Failed to build data snapshot:', e);
    return '';
  }
}
