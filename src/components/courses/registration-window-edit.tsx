'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Pencil } from 'lucide-react';
import { updateCourseGroup as _updateCourseGroup } from '@/lib/supabase/actions';
import { safe } from '@/lib/supabase/safe-action';
import { toast } from 'sonner';

const updateCourseGroup = safe(_updateCourseGroup);

function toLocalDatetimeString(iso: string): string {
    const d = new Date(iso);
    const taipei = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${taipei.getFullYear()}-${pad(taipei.getMonth() + 1)}-${pad(taipei.getDate())}T${pad(taipei.getHours())}:${pad(taipei.getMinutes())}`;
}

interface RegistrationWindowEditProps {
    groupId: string;
    groupTitle: string;
    currentStart: string | null;
    currentEnd: string | null;
}

export function RegistrationWindowEdit({
    groupId,
    groupTitle,
    currentStart,
    currentEnd,
}: RegistrationWindowEditProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [startVal, setStartVal] = useState(currentStart ? toLocalDatetimeString(currentStart) : '');
    const [endVal, setEndVal] = useState(currentEnd ? toLocalDatetimeString(currentEnd) : '');
    const [isPending, startTransition] = useTransition();
    const router = useRouter();

    const handleOpen = () => {
        setStartVal(currentStart ? toLocalDatetimeString(currentStart) : '');
        setEndVal(currentEnd ? toLocalDatetimeString(currentEnd) : '');
        setIsOpen(true);
    };

    const handleSave = () => {
        if (!startVal || !endVal) return;
        const start = new Date(startVal);
        const end = new Date(endVal);
        if (end <= start) {
            toast.error('截止時間必須晚於開始時間');
            return;
        }
        startTransition(async () => {
            const res = await updateCourseGroup(groupId, groupTitle, start, end);
            if (res.success) {
                toast.success('報名時段已更新');
                setIsOpen(false);
                router.refresh();
            } else {
                toast.error(res.message);
            }
        });
    };

    return (
        <>
            <button
                onClick={handleOpen}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
                aria-label="編輯報名時段"
            >
                <Pencil className="h-3.5 w-3.5" />
            </button>
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogContent className="sm:max-w-[420px]">
                    <DialogHeader>
                        <DialogTitle>編輯報名時段</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="reg-start">報名開始</Label>
                            <Input
                                id="reg-start"
                                type="datetime-local"
                                value={startVal}
                                onChange={e => setStartVal(e.target.value)}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="reg-end">報名截止</Label>
                            <Input
                                id="reg-end"
                                type="datetime-local"
                                value={endVal}
                                onChange={e => setEndVal(e.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsOpen(false)}>取消</Button>
                        <Button onClick={handleSave} disabled={isPending || !startVal || !endVal}>
                            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            儲存
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
