'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { KeyRound, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

export function ChangePasswordDialog() {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState<string | null>(null);

    const handleUpdatePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (password.length < 6) {
            setError('密碼長度至少需為 6 個字元');
            return;
        }

        if (password !== confirmPassword) {
            setError('兩次輸入的密碼不一致');
            return;
        }

        setLoading(true);
        const supabase = createClient();

        try {
            const { error: updateError } = await supabase.auth.updateUser({
                password: password,
            });

            if (updateError) throw updateError;

            toast.success('密碼已成功變更！');
            setOpen(false);
            setPassword('');
            setConfirmPassword('');
        } catch (err: any) {
            console.error('Password update error:', err);
            setError(err.message || '變更密碼時發生錯誤，請稍後再試');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 px-3 text-white/60 hover:text-white hover:bg-white/5 transition-all flex items-center gap-2 rounded-xl"
                >
                    <KeyRound className="h-4 w-4" />
                    <span className="text-sm font-bold tracking-tight">變更密碼</span>
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[400px] rounded-3xl border-muted/50 bg-card/95 backdrop-blur-xl">
                <DialogHeader className="space-y-3">
                    <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-2">
                        <KeyRound className="h-6 w-6" />
                    </div>
                    <DialogTitle className="text-xl font-bold tracking-tight">變更登入密碼</DialogTitle>
                    <DialogDescription className="text-sm text-muted-foreground font-medium">
                        為了您的帳號安全，建議定期更換密碼。
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleUpdatePassword} className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="new-password text-xs font-bold text-muted-foreground uppercase tracking-wider">新密碼</Label>
                        <Input
                            id="new-password"
                            type="password"
                            placeholder="至少 6 個字元"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="bg-muted/30 border-muted/50 rounded-xl focus:ring-primary/20 h-11"
                            disabled={loading}
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="confirm-password text-xs font-bold text-muted-foreground uppercase tracking-wider">確認新密碼</Label>
                        <Input
                            id="confirm-password"
                            type="password"
                            placeholder="請再次輸入新密碼"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="bg-muted/30 border-muted/50 rounded-xl focus:ring-primary/20 h-11"
                            disabled={loading}
                            required
                        />
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 text-destructive bg-destructive/10 p-3 rounded-xl text-xs font-bold border border-destructive/20 animate-in fade-in slide-in-from-top-1">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            <p>{error}</p>
                        </div>
                    )}

                    <DialogFooter className="pt-2 flex flex-col sm:flex-row gap-2">
                        <Button 
                            type="button" 
                            variant="ghost" 
                            onClick={() => setOpen(false)}
                            className="flex-1 rounded-xl h-11 font-bold text-muted-foreground"
                            disabled={loading}
                        >
                            取消
                        </Button>
                        <Button 
                            type="submit" 
                            className="flex-1 rounded-xl h-11 font-bold bg-primary text-background hover:bg-primary/90 shadow-lg shadow-primary/20 active:scale-[0.98] transition-all"
                            disabled={loading}
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    處理中...
                                </>
                            ) : (
                                '確認更新'
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
