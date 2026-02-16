import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { CourseForm } from '@/components/admin/course-form';
import { isAdmin } from '@/types/database';

export default async function NewCoursePage() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        redirect('/login');
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (!profile || !isAdmin(profile.role)) {
        // If not admin, redirect to dashboard or show unauthorized
        // For now, let's redirect to dashboard
        redirect('/dashboard');
    }

    return (
        <div className="mx-auto max-w-5xl px-4 py-8">
            <CourseForm />
        </div>
    );
}
