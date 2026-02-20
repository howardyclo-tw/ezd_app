import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { CourseCard } from '@/components/courses/course-card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { ChevronLeft, ClipboardList } from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = 'force-dynamic';

export default async function MyCoursesPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    // Fetch my enrollments with course and group details
    const { data: myEnrollments, error } = await supabase
        .from('enrollments')
        .select(`
            id,
            status,
            waitlist_position,
            courses (
                id,
                name,
                teacher,
                start_time,
                end_time,
                room,
                type,
                status,
                capacity,
                slug,
                course_groups ( id, title, slug )
            )
        `)
        .eq('user_id', user.id)
        .in('status', ['enrolled', 'waitlist']);

    if (error) {
        console.error('Error fetching my courses:', error);
    }

    return (
        <div className="container max-w-5xl py-6 space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <div className="flex items-start gap-2">
                    <Button variant="ghost" size="icon" asChild className="rounded-full h-9 w-9 -ml-2 shrink-0">
                        <Link href="/dashboard">
                            <ChevronLeft className="h-5 w-5" />
                        </Link>
                    </Button>
                    <div className="space-y-1">
                        <h1 className="text-2xl font-bold tracking-tight leading-tight">我的課程</h1>
                        <p className="text-sm text-muted-foreground font-medium mt-0.5">
                            查看預約、報名與課表
                        </p>
                    </div>
                </div>
            </div>

            {/* List Content */}
            {(!myEnrollments || myEnrollments.length === 0) ? (
                <Card className="border-dashed border-muted/50 bg-muted/5">
                    <CardContent className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="h-16 w-16 rounded-full bg-muted/20 flex items-center justify-center mb-4">
                            <ClipboardList className="h-8 w-8 text-muted-foreground/40" />
                        </div>
                        <h3 className="text-lg font-bold text-foreground/80">尚未報名任何課程</h3>
                        <p className="text-sm text-muted-foreground mt-1 px-4 max-w-xs mx-auto">
                            您目前沒有進行中或候補中的課程。
                        </p>
                        <Button className="mt-8 font-bold bg-primary text-primary-foreground shadow-lg px-8 rounded-xl" asChild>
                            <Link href="/courses">前往探索課程</Link>
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
                    {myEnrollments.map((enrollment: any) => {
                        const course = enrollment.courses;
                        const group = course.course_groups;
                        const gShortId = group.slug || group.id;
                        const cShortId = course.slug || course.id;

                        // Calculate display status for CourseCard
                        return (
                            <div key={enrollment.id}>
                                <CourseCard course={{
                                    id: course.id,
                                    name: course.name,
                                    teacher: course.teacher,
                                    time: `${course.start_time?.slice(0, 5)}~${course.end_time?.slice(0, 5)}`,
                                    location: course.room,
                                    type: course.type,
                                    status: course.status,
                                    userStatus: enrollment.status,
                                    waitingNo: enrollment.waitlist_position,
                                    isManagement: true,
                                    href: `/courses/groups/${gShortId}/${cShortId}`
                                }} />
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
