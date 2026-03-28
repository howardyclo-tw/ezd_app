'use client';

export default function AdminMembersError({ error, reset }: { error: Error; reset: () => void }) {
    return (
        <div className="container max-w-5xl py-20 text-center space-y-4">
            <h2 className="text-xl font-bold text-destructive">頁面載入失敗</h2>
            <p className="text-sm text-muted-foreground">
                {process.env.NODE_ENV === 'development' ? error.message : '系統可能有問題，請立即聯繫幹部！'}
            </p>
            <button
                onClick={reset}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-bold text-sm"
            >
                重試
            </button>
        </div>
    );
}
