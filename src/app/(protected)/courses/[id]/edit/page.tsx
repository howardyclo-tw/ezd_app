'use client';

import { use, useMemo, useEffect } from 'react';
import { CourseForm } from '@/components/admin/course-form';
import { useRouter } from 'next/navigation';

// Mock data (matching the course list/detail page)
const MOCK_COURSES: Record<string, any> = {
    '1': {
        id: '1',
        name: '基礎律動 Basic Groove',
        teacher: 'A-May',
        type: 'trial',
        room: 'A教室',
        startTime: '19:00',
        endTime: '20:30',
        capacity: 30,
        leader: '小明',
        status: 'published',
        description: '本課程適合所有初學者。透過基礎律動訓練，建立身體協調性與節奏感。',
        sessions: [
            { id: 's1', date: new Date(2026, 2, 2) },
            { id: 's2', date: new Date(2026, 2, 9) },
            { id: 's3', date: new Date(2026, 2, 16) },
            { id: 's4', date: new Date(2026, 2, 23) },
        ],
    },
    '2': {
        id: '2',
        name: '爵士舞進階 Jazz Advance',
        teacher: 'Nike',
        type: 'regular',
        room: 'B教室',
        startTime: '20:30',
        endTime: '22:00',
        capacity: 20,
        leader: '',
        status: 'published',
        description: '挑戰高難度的節奏組合與肢體開發。',
        sessions: [
            { id: 's1', date: new Date(2026, 2, 3) },
            { id: 's2', date: new Date(2026, 2, 10) },
        ],
    },
};

export default function EditCoursePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const course = MOCK_COURSES[id] || MOCK_COURSES['1'];

    useEffect(() => {
        if (!MOCK_COURSES[id]) {
            console.warn(`Course ID ${id} not found, falling back to ID 1`);
        }
    }, [id]);

    const initialData = useMemo(() => ({
        groupId: 'g1', // Default for mock
        name: course.name,
        description: course.description || '',
        leader: course.leader || '',
        type: (course.type === 'trial' ? 'trial' : 'normal') as any,
        teacher: course.teacher,
        room: course.room,
        start_time: course.startTime,
        end_time: course.endTime,
        sessions_count: course.sessions.length,
        capacity: course.capacity,
        status: 'published' as any,
        first_session_at: course.sessions[0]?.date,
        sessions: course.sessions.map((s: any) => ({ date: s.date })),
    }), [course]);

    return (
        <div className="mx-auto max-w-5xl px-4 py-8">
            <CourseForm initialData={initialData} mode="edit" />
        </div>
    );
}
