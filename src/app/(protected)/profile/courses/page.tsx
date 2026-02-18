import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CourseCard } from '@/components/courses/course-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Calendar, History, ListFilter } from 'lucide-react';

// Mock Data
const MOCK_MY_COURSES = [
    {
        id: 'c1',
        name: '基礎律動 (Basic Groove)',
        teacher: 'A-May',
        time: '2026-03-01 (五) 19:00 - 20:30',
        location: 'A 教室',
        type: 'regular',
        status: 'open',
        price: 300,
        userStatus: 'registered', // registered, waitlist, finished
    },
    {
        id: 'c2',
        name: 'Hiphop 初級',
        teacher: '小 P',
        time: '2026-03-02 (六) 14:00 - 15:30',
        location: 'B 教室',
        type: 'regular',
        status: 'full',
        price: 300,
        userStatus: 'waitlist',
    },
    {
        id: 'c3-history',
        name: 'Locking 基礎',
        teacher: '阿偉',
        time: '2026-02-15 (三) 20:00 - 21:30',
        location: 'A 教室',
        type: 'regular',
        status: 'ended',
        price: 300,
        userStatus: 'finished',
    }
];

export default async function MyCoursesPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) redirect('/login');

    const upcomingCourses = MOCK_MY_COURSES.filter(c => ['registered', 'waitlist'].includes(c.userStatus));
    const historyCourses = MOCK_MY_COURSES.filter(c => c.userStatus === 'finished');

    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-10 pb-24">
            <div className="space-y-1.5 mb-10 text-center border-b border-muted pb-10">
                <h1 className="text-2xl font-bold tracking-tight">我的課程</h1>
                <p className="text-muted-foreground font-medium text-sm text-balance">在此查看您的報名狀況、即將進行的課堂與過往歷史紀錄。</p>
            </div>

            <Tabs defaultValue="upcoming" className="w-full">
                <div className="flex justify-center mb-10">
                    <TabsList className="grid w-80 grid-cols-2 h-10 bg-muted/50 p-1 border border-muted-foreground/10">
                        <TabsTrigger value="upcoming" className="font-bold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all text-sm">
                            即將到來
                        </TabsTrigger>
                        <TabsTrigger value="history" className="font-bold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all text-sm">
                            歷史紀錄
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="upcoming" className="space-y-6">
                    {upcomingCourses.length === 0 ? (
                        <div className="text-center py-20 bg-muted/10 rounded-3xl border border-dashed border-muted">
                            <Calendar className="h-10 w-10 mx-auto mb-4 opacity-10" />
                            <p className="text-muted-foreground font-bold">目前沒有預定課程</p>
                            <Button variant="link" asChild className="mt-2 text-primary">
                                <Link href="/courses">前往探索課程</Link>
                            </Button>
                        </div>
                    ) : (
                        upcomingCourses.map((course) => (
                            <div key={course.id} className="relative group">
                                <div className="absolute top-4 right-4 z-10">
                                    {course.userStatus === 'registered' && (
                                        <Badge className="bg-green-500 hover:bg-green-600 text-white shadow-sm font-bold border-none">
                                            已報名
                                        </Badge>
                                    )}
                                    {course.userStatus === 'waitlist' && (
                                        <Badge variant="secondary" className="bg-yellow-100/80 text-yellow-700 shadow-sm font-bold border-yellow-200">
                                            候補中 (No. 3)
                                        </Badge>
                                    )}
                                </div>
                                <CourseCard course={course} />
                            </div>
                        ))
                    )}
                </TabsContent>

                <TabsContent value="history" className="space-y-6">
                    {historyCourses.length === 0 ? (
                        <div className="text-center py-20 bg-muted/10 rounded-3xl border border-dashed border-muted">
                            <History className="h-10 w-10 mx-auto mb-4 opacity-10" />
                            <p className="text-muted-foreground font-bold">尚無歷史學習紀錄</p>
                        </div>
                    ) : (
                        historyCourses.map((course) => (
                            <div key={course.id} className="opacity-60 grayscale hover:grayscale-0 transition-all">
                                <CourseCard course={course} />
                            </div>
                        ))
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}
