'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { getServerProfile } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function importDataAction(type: 'members' | 'card_orders' | 'rosters' | 'course_groups', data: any[]) {
    const { profile } = await getServerProfile();
    if (profile?.role !== 'admin') {
        throw new Error('只有幹部可以執行此操作');
    }

    const adminClient = createAdminClient();
    let successCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    // Helper: Normalize headers like "姓名 (name)" to "name"
    const normalizeHeaders = (rows: any[]) => {
        return rows.map(row => {
            const newRow: any = {};
            Object.keys(row).forEach(key => {
                // Extract key from "Description (key)" or use the key itself
                const match = key.match(/\(([^)]+)\)/);
                const actualKey = match ? match[1] : key.toLowerCase().trim();
                newRow[actualKey] = row[key];
            });
            return newRow;
        });
    };

    const normalizedData = normalizeHeaders(data);

    // Helper: Lookup user_id by employee_id or email
    const resolveUserId = async (identifier: string) => {
        if (!identifier) return null;
        
        // 1. Precise employee_id match
        const { data: byEmpId } = await adminClient
            .from('profiles')
            .select('id')
            .eq('employee_id', identifier)
            .maybeSingle();
        
        if (byEmpId) return byEmpId.id;

        // 2. Email fallback (if identifier looks like an email)
        if (identifier.includes('@')) {
            const { data: byEmail } = await adminClient
                .from('profiles')
                .select('id')
                .eq('email', identifier)
                .maybeSingle();
            return byEmail?.id;
        }

        return null;
    };

    // Helper: Lookup course_id by group_title AND course_name
    const resolveCourseId = async (groupTitle: string, courseName: string) => {
        // 1. Find the group first
        const { data: groupData } = await adminClient
            .from('course_groups')
            .select('id')
            .eq('title', groupTitle)
            .maybeSingle();
        
        if (!groupData) return null;

        // 2. Find the course within that group
        const { data: courseData } = await adminClient
            .from('courses')
            .select('id')
            .eq('group_id', groupData.id)
            .eq('name', courseName)
            .maybeSingle();
            
        return courseData?.id;
    };

    if (type === 'members') {
        // Pre-fetch all existing auth users once (avoid repeated listUsers per row)
        const { data: existingAuthUsers } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const authUsersByEmail = new Map(
            existingAuthUsers?.users?.map(u => [u.email, u.id]) || []
        );

        const BATCH_SIZE = 10;
        const processOne = async (item: any) => {
            const { email, name, employee_id, is_member } = item;
            if (!email) return;

            // 1. Create or get auth user
            // Note: a DB trigger (handle_new_user) auto-creates a profiles row on auth.users INSERT.
            // We pass user_metadata.name so the trigger uses it instead of falling back to email.
            const defaultPassword = 'mediatek';
            let userId: string | undefined;

            const existingId = authUsersByEmail.get(email);
            if (existingId) {
                userId = existingId;
            } else {
                const { data: userData, error: userError } = await adminClient.auth.admin.createUser({
                    email,
                    password: defaultPassword,
                    email_confirm: true,
                    user_metadata: { name: name || email.split('@')[0] },
                });

                if (userError) {
                    if (userError.message.includes('already registered')) {
                        const { data: refreshed } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
                        userId = refreshed.users.find(u => u.email === email)?.id;
                    } else {
                        throw userError;
                    }
                } else {
                    userId = userData?.user?.id;
                    if (userId) authUsersByEmail.set(email, userId);
                }
            }

            if (!userId) throw new Error('無法獲取 User ID');

            // 2. Upsert profile (updates the row the trigger already created, or inserts for existing users)
            const isActualMember = is_member === '1' || is_member === 1;
            const validUntil = isActualMember
                ? `${new Date().getFullYear()}-12-31`
                : null;

            const { error: profileError } = await adminClient
                .from('profiles')
                .upsert({
                    id: userId,
                    name: name || email.split('@')[0],
                    employee_id: employee_id || null,
                    role: isActualMember ? 'member' : 'guest',
                    member_valid_until: validUntil,
                    updated_at: new Date().toISOString()
                });

            if (profileError) throw profileError;
        };

        for (let i = 0; i < normalizedData.length; i += BATCH_SIZE) {
            const batch = normalizedData.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(batch.map(item => processOne(item)));
            for (let j = 0; j < results.length; j++) {
                if (results[j].status === 'fulfilled') {
                    successCount++;
                } else {
                    failCount++;
                    const item = batch[j];
                    errors.push(`${item.email || item.employee_id || '未知'}: ${(results[j] as PromiseRejectedResult).reason?.message}`);
                }
            }
        }
    } else if (type === 'card_orders') {
        for (const item of normalizedData) {
            try {
                const { employee_id, cards, amount, purchase_date } = item;
                
                const userId = await resolveUserId(employee_id);
                if (!userId) throw new Error(`找不到學員: ${employee_id}`);

                const { data: profileData } = await adminClient
                    .from('profiles')
                    .select('card_balance')
                    .eq('id', userId)
                    .single();

                const cardCount = parseInt(cards);
                const amountValue = parseInt(amount);

                const { data: order, error: orderError } = await adminClient
                    .from('card_orders')
                    .insert({
                        user_id: userId,
                        card_count: cardCount,
                        amount: amountValue,
                        status: 'confirmed',
                        created_at: purchase_date ? new Date(purchase_date).toISOString() : new Date().toISOString()
                    })
                    .select()
                    .single();

                if (orderError) throw orderError;

                await adminClient.from('card_transactions').insert({
                    user_id: userId,
                    order_id: order.id,
                    type: 'purchase',
                    amount: cardCount,
                    balance_after: (profileData?.card_balance || 0) + cardCount,
                    description: `系統匯入：${purchase_date || '補登'}`
                });

                await adminClient
                    .from('profiles')
                    .update({ card_balance: (profileData?.card_balance || 0) + cardCount })
                    .eq('id', userId);

                successCount++;
            } catch (err: any) {
                failCount++;
                errors.push(`${item.employee_id || '未知'}: ${err.message}`);
            }
        }
    } else if (type === 'rosters') {
        for (const item of normalizedData) {
            try {
                const { group_title, course_name, employee_id } = item;
                
                const userId = await resolveUserId(employee_id);
                if (!userId) throw new Error(`找不到學員: ${employee_id}`);

                const courseId = await resolveCourseId(group_title, course_name);
                if (!courseId) throw new Error(`在檔期「${group_title}」下找不到課程: ${course_name}`);

                const { data: sessions } = await adminClient
                    .from('course_sessions')
                    .select('id')
                    .eq('course_id', courseId);
                
                if (!sessions || sessions.length === 0) throw new Error(`課程「${course_name}」尚無任何場次`);

                const enrollments = sessions.map(s => ({
                    user_id: userId,
                    session_id: s.id,
                    course_id: courseId,
                    status: 'enrolled',
                    type: 'full'
                }));

                const { error: enrollError } = await adminClient
                    .from('enrollments')
                    .upsert(enrollments, { onConflict: 'user_id,session_id' });

                if (enrollError) throw enrollError;
                successCount++;
            } catch (err: any) {
                failCount++;
                errors.push(`${item.employee_id || '未知'}: ${err.message}`);
            }
        }
    } else if (type === 'course_groups') {
        for (const item of normalizedData) {
            try {
                const { title, description, instructor } = item;
                if (!title) continue;

                // 1. Resolve Instructor ID
                const instructorId = instructor ? await resolveUserId(instructor) : null;

                // 2. Generate slug automatically
                const autoSlug = title.toLowerCase()
                    .replace(/[^\w\s-]/g, '')
                    .replace(/[\s_]+/g, '-')
                    .replace(/^-+|-+$/g, '') + '-' + Math.random().toString(36).substring(2, 5);

                const { data: newGroup, error: insertError } = await adminClient
                    .from('course_groups')
                    .insert({
                        title,
                        description,
                        instructor_id: instructorId,
                        slug: autoSlug,
                        created_by: profile.id
                    })
                    .select()
                    .single();

                if (insertError) throw insertError;

                // 3. Automatically create a default course entry for this group
                const { error: courseError } = await adminClient
                    .from('courses')
                    .insert({
                        group_id: newGroup.id,
                        name: title, // Use group title as default course name
                        description: description || '系統自動建立',
                        max_students: 20
                    });
                
                if (courseError) throw courseError;
                successCount++;
            } catch (err: any) {
                failCount++;
                errors.push(`${item.title || '未知'}: ${err.message}`);
            }
        }
    }

    revalidatePath('/leader/approvals');
    revalidatePath('/admin/members');
    revalidatePath('/courses');

    return { 
        success: successCount, 
        failed: failCount, 
        errors: errors.slice(0, 10)
    };
}
