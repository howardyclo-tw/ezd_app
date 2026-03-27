/**
 * Wraps a server action so that thrown errors are returned as { success: false, message }
 * instead of being redacted by Next.js production builds.
 * In development: shows full error message for debugging.
 * In production: shows generic message to avoid leaking internals.
 */
export function safe<T extends (...args: any[]) => Promise<any>>(fn: T): T {
    return (async (...args: any[]) => {
        try {
            return await fn(...args);
        } catch (err: any) {
            const isDev = process.env.NODE_ENV === 'development';
            const message = isDev
                ? (err.message || '操作失敗')
                : '操作失敗！系統可能有 bug，請立即聯繫幹部！';
            if (!isDev) console.error('[safe] server action error:', err);
            return { success: false, message };
        }
    }) as T;
}
