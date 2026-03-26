'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function updateUserRole(userId: string, newRole: string) {
    try {
        const supabase = await createClient();

        // We cannot use service_role here easily without exposing keys, 
        // so we rely on the authenticated user having permissions.
        // However, since this is a dev tool, if RLS blocks it, we are stuck.
        // Assumption: The logged-in user (admin) has RLS policy allowing update of their own role OR all roles.

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'User not authenticated' };
        }

        // Server-side email gating: only allowed emails can use dev tools
        const ALLOWED_DEV_EMAILS = ['yichen.lo@mediatek.com', 'admin@test.ezd.app'];
        if (!ALLOWED_DEV_EMAILS.includes(user.email ?? '')) {
            return { success: false, error: 'Unauthorized' };
        }

        if (user.id !== userId) {
            return { success: false, error: 'User ID mismatch' };
        }

        const { error } = await supabase
            .from('profiles')
            .update({ role: newRole })
            .eq('id', userId);

        if (error) {
            console.error('Supabase update error:', error);
            return { success: false, error: error.message };
        }

        // Force revalidation of the layout/page
        revalidatePath('/', 'layout');
        return { success: true };
    } catch (error: any) {
        console.error('Server action error:', error);
        return { success: false, error: error.message };
    }
}
