import { NextRequest } from 'next/server';
import { getServerProfile } from '@/lib/supabase/server';
import { getEnrollmentStats } from '@/lib/supabase/stats-actions';

export async function GET(req: NextRequest) {
  const { profile } = await getServerProfile();
  if (profile?.role !== 'admin') {
    return new Response('Unauthorized', { status: 403 });
  }

  const ids = req.nextUrl.searchParams.get('ids')?.split(',').filter(Boolean) ?? [];
  const filename = req.nextUrl.searchParams.get('filename') || '報名統計';
  if (ids.length === 0) {
    return new Response('Missing ids', { status: 400 });
  }

  const results = await getEnrollmentStats(ids);

  const header = '課程,老師,容量,社員整期,堂卡(社員)不重複人數,堂卡(社員)報名次數,堂卡(非社員)不重複人數,堂卡(非社員)報名次數,社員補課不重複人數,社員補課次數';
  const rows = results.map((r) =>
    [r.courseName, r.teacher, r.capacity, r.fullCount, r.memberSingleUniq, r.memberSingleCount, r.guestSingleUniq, r.guestSingleCount, r.makeupUniq, r.makeupCount].join(',')
  );
  const bom = '﻿';
  const csv = bom + header + '\n' + rows.join('\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="enrollment_stats.csv"; filename*=UTF-8''${encodeURIComponent(filename + '.csv')}`,
    },
  });
}
