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

        // Check if user is logged in
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'User not authenticated' };
        }

        if (user.id !== userId) {
            // Just a safety check, though we passed userId from prop which came from user.id
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
