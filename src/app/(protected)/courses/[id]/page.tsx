import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';

/**
 * Redirector Page
 * This page handles old-style URLs /courses/[id] and redirects them to the new
 * hierarchical path /courses/groups/[group-slug]/[course-slug]
 */
export default async function CourseRedirectPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const supabase = await createClient();

    // Fetch the course and its group info
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const query = supabase.from('courses').select(`
        id,
        slug,
        course_groups ( id, slug )
    `);

    if (isUuid) {
        query.or(`id.eq.${id},slug.eq.${id}`);
    } else {
        query.eq('slug', id);
    }

    const { data: course } = await query.maybeSingle();

    if (!course) notFound();

    const group = course.course_groups as any;
    const gShortId = group?.slug || group?.id;
    const cShortId = course.slug || course.id;

    // Redirect to the canonical hierarchical path
    redirect(`/courses/groups/${gShortId}/${cShortId}`);
}
