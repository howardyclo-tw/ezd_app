import { getServerProfile } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { ImportClient } from '@/components/leader/import/import-client';

export default async function ImportPage() {
  const { user, profile } = await getServerProfile();
  
  if (!user || profile?.role !== 'admin') {
    redirect('/dashboard');
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 pb-24">
      <div className="flex flex-col space-y-2 mb-8 text-center sm:text-left">
        <h1 className="text-3xl font-black tracking-tight text-foreground">資料匯入工具</h1>
        <p className="text-muted-foreground font-medium">從 CSV 檔案批次匯入社員名單、堂卡紀錄及課程名冊</p>
      </div>

      <ImportClient />
    </div>
  );
}
