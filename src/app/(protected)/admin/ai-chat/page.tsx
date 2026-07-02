import { getServerProfile } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { AiChatClient } from '@/components/admin/ai-chat-client';
import { EnrollmentStatsClient } from '@/components/admin/enrollment-stats-client';
import { getAvailableGroups, getDefaultModelId } from '@/lib/ai/models';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function AdminAiChatPage() {
  const { user, profile } = await getServerProfile();
  if (!user) redirect('/login');
  if (profile?.role !== 'admin') redirect('/dashboard');

  const admin = createAdminClient();
  const [groupsRes, coursesRes] = await Promise.all([
    admin
      .from('course_groups')
      .select('id, title, period_end')
      .order('period_end', { ascending: false }),
    admin
      .from('courses')
      .select('id, group_id, name, teacher')
      .order('name'),
  ]);

  const groups = (groupsRes.data ?? []).map((g) => ({
    id: g.id,
    title: g.title,
    periodEnd: g.period_end,
  }));

  const courses = (coursesRes.data ?? []).map((c) => ({
    id: c.id,
    groupId: c.group_id,
    name: c.name,
    teacher: c.teacher,
  }));

  return (
    <div className="mx-auto max-w-4xl px-4 pt-4">
      <Tabs defaultValue="stats">
        <div className="mb-3 flex items-center gap-1 -ml-2">
          <Button variant="ghost" size="icon" asChild className="rounded-full h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground">
            <Link href="/dashboard"><ChevronLeft className="h-6 w-6" /></Link>
          </Button>
          <TabsList>
            <TabsTrigger value="stats">報名統計</TabsTrigger>
            <TabsTrigger value="chat">AI 對話</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="stats" forceMount className="data-[state=inactive]:hidden">
          <EnrollmentStatsClient groups={groups} courses={courses} />
        </TabsContent>
        <TabsContent value="chat" forceMount className="data-[state=inactive]:hidden">
          <AiChatClient
            groups={getAvailableGroups()}
            defaultModel={getDefaultModelId()}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
