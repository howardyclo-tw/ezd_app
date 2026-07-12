'use client';

import { useState, useRef, useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, SubmitHandler, useFieldArray } from 'react-hook-form';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Upload, Save, X, Clock, Plus, Trash2, Pencil, AlertTriangle, PlusCircle, PencilLine, ChevronLeft, Search, Check, ChevronsUpDown, Music, ArrowUp, ArrowDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { format, addDays } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription
} from '@/components/ui/dialog';
import {
    createCourse,
    updateCourse,
    createCourseGroup,
    updateCourseGroup,
    deleteCourseGroup,
    upsertCoursePoll,
    deleteCoursePoll
} from '@/lib/supabase/actions';
import { getCourseGroups, getProfiles } from '@/lib/supabase/queries';
import { toast } from 'sonner';

interface CourseGroup {
    id: string;
    title: string;
    registration_phase1_start?: string | null;
    registration_phase1_end?: string | null;
    payment_deadline_days?: number | null;
}

interface Profile {
    id: string;
    name: string;
    role: string;
    employee_id?: string | null;
}


const sessionSchema = z.object({
    id: z.string().optional(),
    date: z.coerce.date({
        message: '請選擇日期',
    }),
    hasData: z.any().optional(),
});

/** Preprocess: empty/undefined/null -> null, otherwise coerce to number. */
const optionalPrice = z.preprocess(
    (val) => (val === '' || val === undefined || val === null) ? null : Number(val),
    z.number().min(0, { message: '價格不能為負數' }).nullable(),
);

const courseSchema = z.object({
    groupId: z.string().min(1, { message: '請選擇所屬檔期' }),
    name: z.string().min(2, { message: '課程名稱至少 2 個字' }),
    description: z.string().optional(),
    leader: z.string().optional(),
    type: z.enum(['normal', 'trial', 'special', 'style', 'workshop']),
    teacher: z.string().min(1, { message: '請輸入老師姓名' }),
    room: z.string().min(1, { message: '請輸入教室' }),
    start_time: z.string().regex(/^([01]\d|2[0-3]):?([0-5]\d)$/, { message: '請輸入有效的時間格式 (HH:mm)' }),
    end_time: z.string().regex(/^([01]\d|2[0-3]):?([0-5]\d)$/, { message: '請輸入有效的時間格式 (HH:mm)' }),
    sessions_count: z.coerce.number().min(1, { message: '至少 1 堂課' }),
    capacity: z.coerce.number().min(1, { message: '人數上限至少 1 人' }),
    cards_per_session: z.coerce.number().min(0, { message: '堂卡扣除不能為負數' }),
    pricing_mode: z.enum(['card', 'ntd', 'free']),
    price_member_single: optionalPrice,
    price_guest_single: optionalPrice,
    price_member_full: optionalPrice,
    price_guest_full: optionalPrice,
    enroll_full: z.boolean(),
    enroll_single: z.boolean(),
    enroll_full_identity: z.enum(['all', 'member']),
    enroll_single_identity: z.enum(['all', 'member']),
    waitlist_enabled: z.boolean(),
    nonmember_delay_days: z.preprocess(
        (val) => (val === '' || val === undefined || val === null) ? null : Number(val),
        z.number().min(0, { message: '延後天數不能為負數' }).nullable(),
    ),
    enrollment_start_at: z.coerce.date().nullable().optional(),
    enrollment_end_at: z.coerce.date().nullable().optional(),
    first_session_at: z.coerce.date({
        message: '請選擇日期',
    }),
    sessions: z.array(sessionSchema).min(1, { message: '至少需要一堂課' }),
}).superRefine((data, ctx) => {
    if (data.pricing_mode === 'ntd') {
        if (data.enroll_single) {
            if (data.price_member_single == null) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: '請輸入社員單堂價格', path: ['price_member_single'] });
            }
            if (data.enroll_single_identity !== 'member' && data.price_guest_single == null) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: '請輸入非社員單堂價格', path: ['price_guest_single'] });
            }
        }
        if (data.enroll_full) {
            if (data.price_member_full == null) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: '請輸入社員整期價格', path: ['price_member_full'] });
            }
            if (data.enroll_full_identity !== 'member' && data.price_guest_full == null) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: '請輸入非社員整期價格', path: ['price_guest_full'] });
            }
        }
    }
});

type CourseFormValues = z.infer<typeof courseSchema>;

/** Type-based pricing/enrollment defaults for NEW courses. */
const PRICING_DEFAULTS: Record<string, {
    pricing_mode: 'card' | 'ntd' | 'free';
    enroll_full: boolean;
    enroll_single: boolean;
    enroll_full_identity: 'all' | 'member';
    enroll_single_identity: 'all' | 'member';
    price_member_single: number | null;
    price_guest_single: number | null;
    price_member_full: number | null;
    price_guest_full: number | null;
}> = {
    normal:   { pricing_mode: 'card', enroll_full: true,  enroll_single: true,  enroll_full_identity: 'all' as const, enroll_single_identity: 'all' as const, price_member_single: null, price_guest_single: null, price_member_full: null, price_guest_full: null },
    trial:    { pricing_mode: 'card', enroll_full: true,  enroll_single: true,  enroll_full_identity: 'all' as const, enroll_single_identity: 'all' as const, price_member_single: null, price_guest_single: null, price_member_full: null, price_guest_full: null },
    special:  { pricing_mode: 'card', enroll_full: true,  enroll_single: true,  enroll_full_identity: 'all' as const, enroll_single_identity: 'all' as const, price_member_single: null, price_guest_single: null, price_member_full: null, price_guest_full: null },
    workshop: { pricing_mode: 'ntd',  enroll_full: true,  enroll_single: true,  enroll_full_identity: 'all' as const, enroll_single_identity: 'all' as const, price_member_single: null, price_guest_single: null, price_member_full: null, price_guest_full: null },
    style:    { pricing_mode: 'ntd',  enroll_full: false, enroll_single: true,  enroll_full_identity: 'all' as const, enroll_single_identity: 'all' as const, price_member_single: 0,    price_guest_single: null, price_member_full: null, price_guest_full: null },
};

function TimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const [selectedHour, selectedMinute] = value.split(':');
    const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
    const minutes = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0'));

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    className={cn(
                        "w-full pl-3 text-left font-normal h-11",
                        !value && "text-muted-foreground"
                    )}
                >
                    {value || "選擇時間"}
                    <Clock className="ml-auto h-4 w-4 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0" align="start">
                <div className="flex h-72 divide-x">
                    <div className="flex-1 overflow-y-auto py-2 scrollbar-hide">
                        <div className="px-2 pb-2 text-[10px] uppercase text-muted-foreground font-semibold sticky top-0 bg-popover z-10">時</div>
                        {hours.map((h) => (
                            <Button
                                key={h}
                                variant={selectedHour === h ? "default" : "ghost"}
                                className="w-full h-8 px-2 text-sm justify-center mb-1"
                                onClick={() => onChange(`${h}:${selectedMinute}`)}
                            >
                                {h}
                            </Button>
                        ))}
                    </div>
                    <div className="flex-1 overflow-y-auto py-2 scrollbar-hide">
                        <div className="px-2 pb-2 text-[10px] uppercase text-muted-foreground font-semibold sticky top-0 bg-popover z-10">分</div>
                        {minutes.map((m) => (
                            <Button
                                key={m}
                                variant={selectedMinute === m ? "default" : "ghost"}
                                className="w-full h-8 px-2 text-sm justify-center mb-1"
                                onClick={() => onChange(`${selectedHour}:${m}`)}
                            >
                                {m}
                            </Button>
                        ))}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}

export interface CourseFormProps {
    initialData?: Partial<CourseFormValues> & { id?: string };
    mode?: 'create' | 'edit';
    initialPolls?: Array<{
        id: string;
        title: string;
        voteType: 'single' | 'multi';
        status: string;
        options: Array<{ id: string; label: string; youtubeUrl: string | null; sortOrder: number }>;
    }>;
}

export function CourseForm({ initialData, mode = 'create', initialPolls }: CourseFormProps = {}) {
    const router = useRouter();
    const isEdit = mode === 'edit';
    const isInitialLoad = useRef(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [groups, setGroups] = useState<CourseGroup[]>([]);
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [isLoadingData, setIsLoadingData] = useState(true);

    // Group Modal State
    const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
    const [editingGroup, setEditingGroup] = useState<CourseGroup | null>(null);
    const [groupTitle, setGroupTitle] = useState('');
    const [groupRegStart, setGroupRegStart] = useState<Date | null>(null);
    const [groupRegEnd, setGroupRegEnd] = useState<Date | null>(null);
    const [groupPaymentDeadlineDays, setGroupPaymentDeadlineDays] = useState<number | null>(null);
    const [isGroupSubmitting, setIsGroupSubmitting] = useState(false);

    const [isDeleteWarningOpen, setIsDeleteWarningOpen] = useState(false);
    const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null);
    const [isGroupDeleteConfirmOpen, setIsGroupDeleteConfirmOpen] = useState(false);
    const [groupToDelete, setGroupToDelete] = useState<CourseGroup | null>(null);

    // Leader Search State
    const [isLeaderSearchOpen, setIsLeaderSearchOpen] = useState(false);
    const [leaderSearchQuery, setLeaderSearchQuery] = useState("");

    // Poll State (managed outside react-hook-form; saved via separate server action)
    const initPoll = initialPolls?.[0];
    const [pollId, setPollId] = useState<string | null>(initPoll?.id ?? null);
    const [pollTitle, setPollTitle] = useState(initPoll?.title ?? '');
    const [pollVoteType, setPollVoteType] = useState<'single' | 'multi'>(initPoll?.voteType ?? 'multi');
    const [pollOptions, setPollOptions] = useState<Array<{ id?: string; label: string; youtubeUrl: string | null; sortOrder: number }>>(
        initPoll?.options?.map(o => ({ id: o.id, label: o.label, youtubeUrl: o.youtubeUrl, sortOrder: o.sortOrder })) ?? []
    );
    const [pollStatus, setPollStatus] = useState(initPoll?.status ?? '');
    const [isPollSaving, setIsPollSaving] = useState(false);
    const [isPollDeleting, setIsPollDeleting] = useState(false);
    const [showPollSection, setShowPollSection] = useState(!!initPoll);
    const isPollPublished = pollStatus === 'published';

    useEffect(() => {
        async function loadData() {
            try {
                const [groupsData, profilesData] = await Promise.all([
                    getCourseGroups(),
                    getProfiles()
                ]);
                setGroups(groupsData as CourseGroup[]);
                setProfiles(profilesData as Profile[]);
            } catch (err) {
                console.error('Failed to load form data:', err);
                toast.error('無法載入部分資料，請重新整理頁面');
            } finally {
                setIsLoadingData(false);
            }
        }
        loadData();
    }, []);

    const handleSaveGroup = async () => {
        if (!groupTitle.trim()) {
            toast.error('請輸入檔期名稱');
            return;
        }
        if (!groupRegStart || !groupRegEnd) {
            toast.error('請選擇報名開始與截止日期');
            return;
        }
        setIsGroupSubmitting(true);
        try {
            if (editingGroup) {
                await updateCourseGroup(editingGroup.id, groupTitle, groupRegStart, groupRegEnd, groupPaymentDeadlineDays);
                setGroups(prev => prev.map(g => g.id === editingGroup.id ? { ...g, title: groupTitle, registration_phase1_start: groupRegStart?.toISOString(), registration_phase1_end: groupRegEnd?.toISOString(), payment_deadline_days: groupPaymentDeadlineDays } : g));
                toast.success('已修正檔期資訊');
            } else {
                const res = await createCourseGroup(groupTitle, groupRegStart, groupRegEnd, groupPaymentDeadlineDays);
                if (res.id) {
                    const newGroup = {
                        id: res.id,
                        title: groupTitle,
                        registration_phase1_start: groupRegStart?.toISOString(),
                        registration_phase1_end: groupRegEnd?.toISOString(),
                        payment_deadline_days: groupPaymentDeadlineDays,
                    };
                    setGroups(prev => [...prev, newGroup]);
                    form.setValue('groupId', res.id);
                    toast.success('已建立新檔期');
                }
            }
            setIsGroupModalOpen(false);
            setEditingGroup(null);
            setGroupTitle('');
            setGroupRegStart(null);
            setGroupRegEnd(null);
            setGroupPaymentDeadlineDays(null);
        } catch (err: any) {
            toast.error(err.message || '操作失敗');
        } finally {
            setIsGroupSubmitting(false);
        }
    };

    const handleDeleteGroup = async () => {
        if (!groupToDelete) return;
        setIsGroupSubmitting(true);
        // The following lines were added based on the user's "Code Edit" snippet,
        // assuming they were intended to be inserted here as part of a larger change.
        // The instruction specifically asked to change '幹部' to '幹部' within this context.
        // Verify current user is admin
        // const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
        // if (profile?.role !== 'admin') throw new Error('只有幹部可以建立課程檔期');
        try {
            const res = await deleteCourseGroup(groupToDelete.id);
            if (res.success) {
                setGroups(prev => prev.filter(g => g.id !== groupToDelete.id));
                toast.success('已刪除課程檔期');
                setIsGroupDeleteConfirmOpen(false);
                setGroupToDelete(null);
                if (form.getValues('groupId') === groupToDelete.id) {
                    form.setValue('groupId', '');
                }
            }
        } catch (err: any) {
            toast.error(err.message || '刪除失敗');
        } finally {
            setIsGroupSubmitting(false);
        }
    };

    const initType = initialData?.type || 'normal';
    const typeDefaults = PRICING_DEFAULTS[initType] || PRICING_DEFAULTS.normal;

    const form = useForm<CourseFormValues>({
        resolver: zodResolver(courseSchema) as any,
        defaultValues: {
            groupId: initialData?.groupId || '',
            name: initialData?.name || '',
            description: initialData?.description || '',
            leader: initialData?.leader || 'none',
            type: initType,
            teacher: initialData?.teacher || '',
            room: initialData?.room || '',
            start_time: initialData?.start_time || '19:00',
            end_time: initialData?.end_time || '20:30',
            sessions_count: initialData?.sessions_count || 8,
            capacity: initialData?.capacity || 30,
            cards_per_session: initialData?.cards_per_session ?? 1,
            pricing_mode: initialData?.pricing_mode ?? typeDefaults.pricing_mode,
            price_member_single: initialData?.price_member_single ?? typeDefaults.price_member_single,
            price_guest_single: initialData?.price_guest_single ?? typeDefaults.price_guest_single,
            price_member_full: initialData?.price_member_full ?? typeDefaults.price_member_full,
            price_guest_full: initialData?.price_guest_full ?? typeDefaults.price_guest_full,
            enroll_full: initialData?.enroll_full ?? typeDefaults.enroll_full,
            enroll_single: initialData?.enroll_single ?? typeDefaults.enroll_single,
            enroll_full_identity: initialData?.enroll_full_identity ?? typeDefaults.enroll_full_identity,
            enroll_single_identity: initialData?.enroll_single_identity ?? typeDefaults.enroll_single_identity,
            waitlist_enabled: initialData?.waitlist_enabled ?? false,
            nonmember_delay_days: initialData?.nonmember_delay_days ?? null,
            enrollment_start_at: initialData?.enrollment_start_at ? new Date(initialData.enrollment_start_at) : null,
            enrollment_end_at: initialData?.enrollment_end_at ? new Date(initialData.enrollment_end_at) : null,
            first_session_at: initialData?.first_session_at,
            sessions: initialData?.sessions || [],
        },
    });

    const { watch, setValue, control } = form;
    const firstDate = watch('first_session_at');
    const sessionsCount = watch('sessions_count');

    const { fields, append, remove, replace } = useFieldArray({
        control: form.control,
        name: "sessions"
    });

    // Auto-generate sessions when first date or count changes
    useEffect(() => {
        if (!firstDate || !sessionsCount) return;

        // Skip if it's the first run in edit mode to avoid overwriting existing sessions from DB
        if (isEdit && isInitialLoad.current) {
            isInitialLoad.current = false;
            return;
        }

        const currentCount = fields.length;
        
        // Use a flag to avoid multiple updates in one cycle
        if (currentCount === 0) {
            // Initial generation
            const newSessions = Array.from({ length: sessionsCount }, (_, i) => ({
                date: addDays(firstDate, i * 7)
            }));
            replace(newSessions as any);
        } else if (sessionsCount > currentCount) {
            // Append missing sessions
            const lastSession = fields[fields.length - 1];
            let lastDate = firstDate;
            if (lastSession && (lastSession as any).date) {
                const dateVal = (lastSession as any).date;
                lastDate = dateVal instanceof Date ? dateVal : new Date(dateVal);
            } else {
                lastDate = addDays(firstDate, (currentCount - 1) * 7);
            }

            const sessionsToAdd = [];
            for (let i = 1; i <= (sessionsCount - currentCount); i++) {
                sessionsToAdd.push({
                    date: addDays(lastDate, i * 7)
                });
            }
            append(sessionsToAdd as any);
        } else if (sessionsCount < currentCount && sessionsCount > 0) {
            // Remove from end
            const diff = currentCount - sessionsCount;
            for (let i = 0; i < diff; i++) {
                remove(currentCount - 1 - i);
            }
        }
    }, [firstDate, sessionsCount, isEdit, replace, append, remove]);

    // Sync: when first_session_at changes, update the first session's date to match
    const prevFirstDate = useRef<Date | null>(null);
    useEffect(() => {
        if (!firstDate || fields.length === 0) return;
        const firstDateTs = firstDate.getTime();
        if (prevFirstDate.current && prevFirstDate.current.getTime() !== firstDateTs) {
            setValue('sessions.0.date', firstDate);
        }
        prevFirstDate.current = firstDate;
    }, [firstDate, fields.length, setValue]);

    // Watch pricing_mode + enroll switches + identity for conditional rendering
    const pricingMode = watch('pricing_mode');
    const enrollFull = watch('enroll_full');
    const enrollSingle = watch('enroll_single');
    const enrollFullIdentity = watch('enroll_full_identity');
    const enrollSingleIdentity = watch('enroll_single_identity');
    const courseType = watch('type');

    // Apply type-based defaults when course type changes (create mode only)
    const prevCourseType = useRef<string>(initType);
    useEffect(() => {
        if (isEdit) return; // never clobber stored values in edit mode
        if (prevCourseType.current === courseType) return; // no change
        prevCourseType.current = courseType;
        const defaults = PRICING_DEFAULTS[courseType] || PRICING_DEFAULTS.normal;
        setValue('pricing_mode', defaults.pricing_mode);
        setValue('enroll_full', defaults.enroll_full);
        setValue('enroll_single', defaults.enroll_single);
        setValue('enroll_full_identity', defaults.enroll_full_identity);
        setValue('enroll_single_identity', defaults.enroll_single_identity);
        setValue('price_member_single', defaults.price_member_single);
        setValue('price_guest_single', defaults.price_guest_single);
        setValue('price_member_full', defaults.price_member_full);
        setValue('price_guest_full', defaults.price_guest_full);
        // Reset cards_per_session for ntd/free modes
        if (defaults.pricing_mode !== 'card') {
            setValue('cards_per_session', 0);
        } else {
            setValue('cards_per_session', 1);
        }
    }, [courseType, isEdit, setValue]);

    // Normal courses: auto-prefill enrollment_start_at = first_session_at (create mode only, when not already set)
    useEffect(() => {
        if (isEdit) return;
        if (courseType !== 'normal' || !enrollSingle || !firstDate) return;
        const current = form.getValues('enrollment_start_at');
        if (!current) {
            setValue('enrollment_start_at', firstDate);
        }
    }, [firstDate, courseType, enrollSingle, isEdit, setValue, form]);

    const hasPendingPoll = showPollSection && pollTitle.trim() && pollOptions.length >= 2;

    const handleSavePoll = async (courseId: string) => {
        if (!pollTitle.trim()) {
            toast.error('請輸入投票標題');
            return;
        }
        if (pollOptions.length < 2) {
            toast.error('投票至少需要 2 個選項');
            return;
        }
        if (pollOptions.some(o => !o.label.trim())) {
            toast.error('所有選項名稱為必填');
            return;
        }
        setIsPollSaving(true);
        try {
            const res = await upsertCoursePoll(courseId, {
                id: pollId ?? undefined,
                title: pollTitle.trim(),
                voteType: pollVoteType,
                options: pollOptions.map((o, i) => ({
                    id: o.id,
                    label: o.label.trim(),
                    youtubeUrl: o.youtubeUrl || null,
                    sortOrder: i + 1,
                })),
            });
            if (res.success) {
                toast.success(res.message);
                if (res.id) setPollId(res.id);
            }
        } catch (error: any) {
            toast.error(error.message || '儲存投票失敗');
        } finally {
            setIsPollSaving(false);
        }
    };

    const handleDeletePoll = async () => {
        if (!pollId) return;
        setIsPollDeleting(true);
        try {
            const res = await deleteCoursePoll(pollId);
            if (res.success) {
                toast.success(res.message);
                setPollId(null);
                setPollTitle('');
                setPollVoteType('multi');
                setPollOptions([]);
                setPollStatus('');
                setShowPollSection(false);
            }
        } catch (error: any) {
            toast.error(error.message || '刪除投票失敗');
        } finally {
            setIsPollDeleting(false);
        }
    };

    const onSubmit: SubmitHandler<CourseFormValues> = async (data) => {
        setIsSubmitting(true);
        try {
            let res: { success: boolean; message: string; id?: string };
            if (isEdit && initialData?.id) {
                res = await updateCourse(initialData.id as string, data);
            } else {
                res = await createCourse(data);
            }

            if (res.success) {
                // Save pending poll for newly created course
                if (!isEdit && res.id && hasPendingPoll) {
                    try {
                        await upsertCoursePoll(res.id, {
                            title: pollTitle.trim(),
                            voteType: pollVoteType,
                            options: pollOptions.map((o, i) => ({
                                label: o.label.trim(),
                                youtubeUrl: o.youtubeUrl || null,
                                sortOrder: i + 1,
                            })),
                        });
                    } catch (pollError: any) {
                        toast.error(`課程已建立，但投票儲存失敗：${pollError.message}`);
                    }
                }
                toast.success(res.message);
                if (isEdit) {
                    router.back();
                } else {
                    router.push('/courses');
                }
            }
        } catch (error: any) {
            console.error('Failed to save course:', error);
            toast.error(error.message || '儲存失敗');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Form {...form}>
            <form
                onSubmit={form.handleSubmit(onSubmit as any, (errors) => {
                    console.log('Form validation failed:', errors);
                })}
                className="space-y-6"
            >
                {/* Header - Sticky below main nav */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sticky top-14 z-40 bg-background/95 backdrop-blur-md py-4 border-b">
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-white flex items-center justify-center text-black shrink-0 shadow-sm border border-muted/20">
                            {isEdit ? <PencilLine className="h-5 w-5" /> : <PlusCircle className="h-5 w-5" />}
                        </div>
                        <div className="space-y-0.5 select-none text-left">
                            <h1 className="text-2xl font-bold tracking-tight leading-none text-foreground">{isEdit ? '編輯課程' : '新增課程'}</h1>
                            <p className="text-muted-foreground text-[13px] font-medium leading-none mt-1">{isEdit ? '修改課程資訊後點擊儲存' : '填寫課程資訊以建立新課程'}</p>
                        </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                        <Button
                            variant="outline"
                            type="button"
                            size="sm"
                            className="h-10 text-sm font-bold border-muted"
                            onClick={() => router.back()}
                        >
                            <X className="mr-2 h-4 w-4 text-muted-foreground" />
                            取消
                        </Button>
                        <Button 
                            type="button" 
                            size="sm" 
                            className="h-10 text-sm font-bold" 
                            disabled={isSubmitting}
                            onClick={() => {
                                form.handleSubmit(onSubmit, (errors) => {
                                    console.error('Validation Errors:', errors);
                                    
                                    const fieldMap: Record<string, string> = {
                                        groupId: '所屬檔期',
                                        name: '課程名稱',
                                        teacher: '老師姓名',
                                        room: '教室',
                                        type: '課程類型',
                                        start_time: '開始時間',
                                        end_time: '結束時間',
                                        sessions_count: '總堂數',
                                        capacity: '人數上限',
                                        first_session_at: '第一堂課日期',
                                        sessions: '課程進度明細 (堂數)',
                                        pricing_mode: '計費模式',
                                        price_member_single: '社員單堂價格',
                                        price_guest_single: '非社員單堂價格',
                                        price_member_full: '社員整期價格',
                                        price_guest_full: '非社員整期價格',
                                    };

                                    const errorFields = Object.keys(errors).map(key => {
                                        return fieldMap[key] || key;
                                    });
                                    
                                    toast.error(`請檢查必填欄位：${errorFields.join(', ')}`);
                                })();
                            }}
                        >
                            {isSubmitting ? (
                                <>
                                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                    儲存中...
                                </>
                            ) : (
                                <>
                                    {!isEdit && <Plus className="mr-2 h-4 w-4" />}
                                    {isEdit ? '儲存' : '完成'}
                                </>
                            )}
                        </Button>
                    </div>
                </div>



                <div className="grid gap-6 md:grid-cols-2">
                    {/* 基本資訊 */}
                    <Card className="md:col-span-2 shadow-sm border-muted/60">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                            <div>
                                <CardTitle className="text-lg font-bold">基本資訊</CardTitle>
                                <CardDescription>設定課程的主要資訊與歸屬檔期</CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent className="grid gap-4 sm:grid-cols-2">
                            <FormField
                                control={form.control as any}
                                name="groupId"
                                render={({ field }) => (
                                    <FormItem className="sm:col-span-2">
                                        <FormLabel>所屬課程檔期</FormLabel>
                                        <Select
                                            onValueChange={(val) => {
                                                if (val === 'create-new') {
                                                    setEditingGroup(null);
                                                    setGroupTitle('');
                                                    setIsGroupModalOpen(true);
                                                } else {
                                                    field.onChange(val);
                                                }
                                            }}
                                            value={field.value}
                                        >
                                            <FormControl>
                                                <SelectTrigger className="h-11">
                                                    <SelectValue placeholder={isLoadingData ? "載入中..." : "請選擇這門課所屬的檔期"} />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="create-new" className="font-bold text-primary focus:bg-primary/5 cursor-pointer">
                                                    <Plus className="h-4 w-4 mr-2 inline-block -mt-0.5" /> 建立新檔期
                                                </SelectItem>
                                                <div className="h-px bg-muted my-1 font-bold" />
                                                {groups.map((g) => (
                                                    <div key={g.id} className="flex items-center justify-between group px-1">
                                                        <SelectItem value={g.id} className="flex-1">
                                                            {g.title}
                                                        </SelectItem>
                                                        <div className="flex items-center gap-0.5 group px-1">
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-6 w-6 text-muted-foreground hover:text-destructive transition-colors"
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    e.stopPropagation();
                                                                    setGroupToDelete(g);
                                                                    setIsGroupDeleteConfirmOpen(true);
                                                                }}
                                                            >
                                                                <Trash2 className="h-3 w-3" />
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-6 w-6 text-muted-foreground hover:text-primary transition-colors"
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    e.stopPropagation();
                                                                    setEditingGroup(g);
                                                                    setGroupTitle(g.title);
                                                                    setGroupRegStart(g.registration_phase1_start ? new Date(g.registration_phase1_start) : null);
                                                                    setGroupRegEnd(g.registration_phase1_end ? new Date(g.registration_phase1_end) : null);
                                                                    setGroupPaymentDeadlineDays(g.payment_deadline_days ?? null);
                                                                    setIsGroupModalOpen(true);
                                                                }}
                                                            >
                                                                <Pencil className="h-3 w-3" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control as any}
                                name="name"
                                render={({ field }) => (
                                    <FormItem className="sm:col-span-2">
                                        <FormLabel>課程名稱</FormLabel>
                                        <FormControl>
                                            <Input placeholder="例如：週三基礎律動" className="h-11" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control as any}
                                name="description"
                                render={({ field }) => (
                                    <FormItem className="sm:col-span-2">
                                        <FormLabel>課程描述 <span className="text-muted-foreground font-normal text-xs">(可使用 Markdown 語法)</span></FormLabel>
                                        <FormControl>
                                            <textarea
                                                placeholder="請輸入課程簡介與目標"
                                                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[80px] resize-y [field-sizing:content]"
                                                rows={3}
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control as any}
                                name="teacher"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>老師</FormLabel>
                                        <FormControl>
                                            <Input placeholder="老師姓名" className="h-11" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control as any}
                                name="type"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>課程類型</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger className="h-11">
                                                    <SelectValue placeholder="選擇類型" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="normal">一般常態</SelectItem>
                                                <SelectItem value="trial">試跳課程</SelectItem>
                                                <SelectItem value="style">風格體驗</SelectItem>
                                                <SelectItem value="workshop">專攻班</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control as any}
                                name="room"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>教室</FormLabel>
                                        <FormControl>
                                            <Input placeholder="教室名稱或地點" className="h-11" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control as any}
                                name="leader"
                                render={({ field }) => {
                                    const filteredProfiles = leaderSearchQuery === "" 
                                        ? profiles 
                                        : profiles.filter(p => p.name.toLowerCase().includes(leaderSearchQuery.toLowerCase()));

                                    const selectedProfile = profiles.find(p => p.id === field.value);

                                    return (
                                        <FormItem className="flex flex-col">
                                            <FormLabel>班長</FormLabel>
                                            <Popover open={isLeaderSearchOpen} onOpenChange={setIsLeaderSearchOpen}>
                                                <PopoverTrigger asChild>
                                                    <FormControl>
                                                        <Button
                                                            variant="outline"
                                                            role="combobox"
                                                            disabled={isLoadingData}
                                                            className={cn(
                                                                "w-full h-11 justify-between font-normal",
                                                                !field.value && "text-muted-foreground"
                                                            )}
                                                        >
                                                            {field.value === 'none' || !field.value
                                                                ? "未指定"
                                                                : selectedProfile?.name || "未知"}
                                                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                        </Button>
                                                    </FormControl>
                                                </PopoverTrigger>
                                                <PopoverContent className="w-full p-0" align="start">
                                                    <div className="flex items-center border-b px-3 h-10">
                                                        <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                                                        <input
                                                            className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                                            placeholder="搜尋學員名稱..."
                                                            value={leaderSearchQuery}
                                                            onChange={(e) => setLeaderSearchQuery(e.target.value)}
                                                        />
                                                    </div>
                                                    <div className="max-h-60 overflow-y-auto p-1 custom-scrollbar">
                                                        <div
                                                            className={cn(
                                                                "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                                                                field.value === 'none' && "bg-accent text-accent-foreground"
                                                            )}
                                                            onClick={() => {
                                                                field.onChange('none');
                                                                setIsLeaderSearchOpen(false);
                                                            }}
                                                        >
                                                            <Check className={cn("mr-2 h-4 w-4", field.value === 'none' ? "opacity-100" : "opacity-0")} />
                                                            未指定
                                                        </div>
                                                        {filteredProfiles.length === 0 ? (
                                                            <div className="py-6 text-center text-sm text-muted-foreground">查無此學員</div>
                                                        ) : (
                                                            filteredProfiles.map((p) => (
                                                                <div
                                                                    key={p.id}
                                                                    className={cn(
                                                                        "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                                                                        field.value === p.id && "bg-accent text-accent-foreground"
                                                                    )}
                                                                    onClick={() => {
                                                                        field.onChange(p.id);
                                                                        setIsLeaderSearchOpen(false);
                                                                    }}
                                                                >
                                                                    <div className="flex items-center justify-between w-full pr-1">
                                                                        <div className="flex items-center">
                                                                            <Check className={cn("mr-2 h-4 w-4 shrink-0", field.value === p.id ? "opacity-100" : "opacity-0")} />
                                                                            <span className="truncate">{p.name} {p.role === 'leader' ? '(班長)' : p.role === 'admin' ? '(幹部)' : ''}</span>
                                                                        </div>
                                                                        {p.employee_id && (
                                                                            <Badge variant="outline" className="ml-2 bg-muted/30 text-muted-foreground/80 font-mono text-[10px] px-1.5 py-0 border-none shrink-0 h-4 leading-4 flex items-center shadow-none">
                                                                                {p.employee_id}
                                                                            </Badge>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            ))
                                                        )}
                                                    </div>
                                                </PopoverContent>
                                            </Popover>
                                            <FormMessage />
                                        </FormItem>
                                    );
                                }}
                            />
                        </CardContent>
                    </Card>

                    {/* 課程安排 */}
                    <Card className="md:col-span-2 shadow-sm border-muted/60">
                        <CardHeader>
                            <CardTitle className="text-lg font-bold">課程安排</CardTitle>
                            <CardDescription>設定上課時間與人數</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <FormField
                                control={form.control as any}
                                name="first_session_at"
                                render={({ field }) => (
                                    <FormItem className="flex flex-col">
                                        <FormLabel>第一堂日期</FormLabel>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <FormControl>
                                                    <Button
                                                        variant={"outline"}
                                                        className={cn(
                                                            "w-full pl-3 text-left font-normal h-11 px-3",
                                                            !field.value && "text-muted-foreground"
                                                        )}
                                                    >
                                                        {field.value ? (
                                                            format(field.value, "PPP", { locale: zhTW })
                                                        ) : (
                                                            <span>選擇日期</span>
                                                        )}
                                                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                    </Button>
                                                </FormControl>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0" align="start">
                                                <Calendar
                                                    mode="single"
                                                    selected={field.value}
                                                    onSelect={field.onChange}
                                                    disabled={(date) =>
                                                        date < new Date(new Date().setHours(0, 0, 0, 0))
                                                    }
                                                    initialFocus
                                                />
                                            </PopoverContent>
                                        </Popover>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <div className="grid grid-cols-2 gap-4">
                                <FormField
                                    control={form.control as any}
                                    name="start_time"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>開始時間</FormLabel>
                                            <FormControl>
                                                <TimePicker value={field.value} onChange={field.onChange} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control as any}
                                    name="end_time"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>結束時間</FormLabel>
                                            <FormControl>
                                                <TimePicker value={field.value} onChange={field.onChange} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <FormField
                                    control={form.control as any}
                                    name="sessions_count"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>總堂數</FormLabel>
                                            <FormControl>
                                                <Input type="number" className="h-11" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control as any}
                                    name="capacity"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>人數上限</FormLabel>
                                            <FormControl>
                                                <Input type="number" className="h-11" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Pricing & Enrollment Section */}
                            <div className="mt-6 space-y-4 pt-6 border-t">
                                <div className="space-y-1">
                                    <h3 className="text-sm font-semibold text-primary">計費與報名設定</h3>
                                    <p className="text-xs text-muted-foreground leading-relaxed">設定課程計費模式、價格與允許的報名方式</p>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    {/* Pricing Mode */}
                                    <FormField
                                        control={form.control as any}
                                        name="pricing_mode"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>計費模式</FormLabel>
                                                <Select onValueChange={field.onChange} value={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger className="h-11" data-testid="pricing-mode-select">
                                                            <SelectValue placeholder="選擇計費模式" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="card">堂卡</SelectItem>
                                                        <SelectItem value="ntd">現金</SelectItem>
                                                        <SelectItem value="free">免費</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    {/* Cards per session — visible only in card mode */}
                                    {pricingMode === 'card' && (
                                        <FormField
                                            control={form.control as any}
                                            name="cards_per_session"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>每堂扣除堂卡數</FormLabel>
                                                    <FormControl>
                                                        <Input type="number" min={0} className="h-11" {...field} />
                                                    </FormControl>
                                                    <p className="text-xs text-muted-foreground">0 = 免費，預設 1</p>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    )}
                                </div>

                                {/* Enroll switches + identity selects — always visible */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <FormField
                                            control={form.control as any}
                                            name="enroll_full"
                                            render={({ field }) => (
                                                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                                                    <div className="space-y-0.5">
                                                        <FormLabel>允許整期報名</FormLabel>
                                                        <FormDescription className="text-xs">開啟後學員可報名整期課程</FormDescription>
                                                    </div>
                                                    <FormControl>
                                                        <Switch
                                                            checked={field.value}
                                                            onCheckedChange={field.onChange}
                                                            data-testid="enroll-full-switch"
                                                        />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control as any}
                                            name="enroll_full_identity"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-xs">開放對象</FormLabel>
                                                    <Select
                                                        value={field.value}
                                                        onValueChange={field.onChange}
                                                        disabled={!enrollFull}
                                                    >
                                                        <FormControl>
                                                            <SelectTrigger data-testid="enroll-full-identity-select" className="h-9">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent>
                                                            <SelectItem value="all">全部</SelectItem>
                                                            <SelectItem value="member">僅社員</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <FormField
                                            control={form.control as any}
                                            name="enroll_single"
                                            render={({ field }) => (
                                                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                                                    <div className="space-y-0.5">
                                                        <FormLabel>允許單堂報名</FormLabel>
                                                        <FormDescription className="text-xs">開啟後學員可報名單堂課程</FormDescription>
                                                    </div>
                                                    <FormControl>
                                                        <Switch
                                                            checked={field.value}
                                                            onCheckedChange={field.onChange}
                                                            data-testid="enroll-single-switch"
                                                        />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control as any}
                                            name="enroll_single_identity"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-xs">開放對象</FormLabel>
                                                    <Select
                                                        value={field.value}
                                                        onValueChange={field.onChange}
                                                        disabled={!enrollSingle}
                                                    >
                                                        <FormControl>
                                                            <SelectTrigger data-testid="enroll-single-identity-select" className="h-9">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent>
                                                            <SelectItem value="all">全部</SelectItem>
                                                            <SelectItem value="member">僅社員</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </div>

                                {/* Single enrollment window dates */}
                                {enrollSingle && (
                                    <div className="grid grid-cols-2 gap-4">
                                        <FormField
                                            control={form.control as any}
                                            name="enrollment_start_at"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>單堂報名開始</FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            type="date"
                                                            className="h-11"
                                                            value={field.value ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date(field.value)) : ''}
                                                            onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value + 'T00:00:00+08:00') : null)}
                                                        />
                                                    </FormControl>
                                                    <FormDescription className="text-[11px]">
                                                        {courseType === 'normal' ? '常態課單堂預設開課後加報' : '留空=立即可報'}
                                                    </FormDescription>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control as any}
                                            name="enrollment_end_at"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>單堂報名截止</FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            type="date"
                                                            className="h-11"
                                                            value={field.value ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date(field.value)) : ''}
                                                            onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value + 'T00:00:00+08:00') : null)}
                                                        />
                                                    </FormControl>
                                                    <FormDescription className="text-[11px]">留空=無截止</FormDescription>
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                )}

                                {/* Waitlist + Nonmember delay */}
                                <div className="grid grid-cols-2 gap-4">
                                    <FormField
                                        control={form.control as any}
                                        name="waitlist_enabled"
                                        render={({ field }) => (
                                            <FormItem className="flex items-center justify-between rounded-lg border p-3">
                                                <div className="space-y-0.5">
                                                    <FormLabel>候補功能</FormLabel>
                                                    <FormDescription className="text-xs">額滿時允許學員加入候補名單</FormDescription>
                                                </div>
                                                <FormControl>
                                                    <Switch
                                                        checked={field.value}
                                                        onCheckedChange={field.onChange}
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control as any}
                                        name="nonmember_delay_days"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>非社員延後天數</FormLabel>
                                                <FormControl>
                                                    <Input
                                                        type="number"
                                                        min={0}
                                                        className="h-11"
                                                        placeholder="留空=不延後"
                                                        value={field.value ?? ''}
                                                        onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
                                                    />
                                                </FormControl>
                                                <FormDescription className="text-[11px]">非社員報名延後開放的天數</FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                {/* NTD Price fields — visible only in ntd mode */}
                                {pricingMode === 'ntd' && (
                                    <div className="space-y-3">
                                        <p className="text-xs font-medium text-muted-foreground">現金價格設定 (0 = 免費)</p>
                                        {enrollSingle && (
                                            <div className="grid grid-cols-2 gap-4">
                                                <FormField
                                                    control={form.control as any}
                                                    name="price_member_single"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>社員單堂價格</FormLabel>
                                                            <FormControl>
                                                                <Input
                                                                    type="number"
                                                                    min={0}
                                                                    className="h-11"
                                                                    placeholder="必填"
                                                                    value={field.value ?? ''}
                                                                    onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                                {enrollSingleIdentity !== 'member' && (
                                                    <FormField
                                                        control={form.control as any}
                                                        name="price_guest_single"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>非社員單堂價格</FormLabel>
                                                                <FormControl>
                                                                    <Input
                                                                        type="number"
                                                                        min={0}
                                                                        className="h-11"
                                                                        placeholder="必填"
                                                                        value={field.value ?? ''}
                                                                        onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
                                                                    />
                                                                </FormControl>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}
                                                    />
                                                )}
                                            </div>
                                        )}
                                        {enrollFull && (
                                            <div className="grid grid-cols-2 gap-4">
                                                <FormField
                                                    control={form.control as any}
                                                    name="price_member_full"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>社員整期價格</FormLabel>
                                                            <FormControl>
                                                                <Input
                                                                    type="number"
                                                                    min={0}
                                                                    className="h-11"
                                                                    placeholder="必填"
                                                                    value={field.value ?? ''}
                                                                    onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                                {enrollFullIdentity !== 'member' && (
                                                    <FormField
                                                        control={form.control as any}
                                                        name="price_guest_full"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>非社員整期價格</FormLabel>
                                                                <FormControl>
                                                                    <Input
                                                                        type="number"
                                                                        min={0}
                                                                        className="h-11"
                                                                        placeholder="必填"
                                                                        value={field.value ?? ''}
                                                                        onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
                                                                    />
                                                                </FormControl>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}
                                                    />
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Sessions Schedule Section */}
                            {firstDate && (
                                <div className="mt-8 space-y-4 pt-6 border-t">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                        <div className="space-y-1">
                                            <h3 className="text-sm font-semibold text-primary">課程進度明細</h3>
                                            <p className="text-xs text-muted-foreground leading-relaxed">系統已依據第一堂日期推算，您可手動調整單堂日期。</p>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="text-sm h-9 w-full sm:w-auto mt-1 sm:mt-0 font-bold border-muted"
                                            onClick={() => {
                                                const current = form.getValues('sessions');
                                                const lastDate = current[current.length - 1]?.date || firstDate;
                                                append({
                                                    date: addDays(new Date(lastDate), 7)
                                                });
                                                setValue('sessions_count', current.length + 1);
                                            }}
                                        >
                                            <Plus className="h-4 w-4 mr-2" /> 加一堂
                                        </Button>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                                        {fields.map((field, index) => {
                                            const hasData = form.watch(`sessions.${index}.hasData`);

                                            return (
                                                <div key={field.id} className="flex flex-col p-3 sm:p-4 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors">
                                                    <div className="flex items-center gap-2">
                                                        <div className="flex-none flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold bg-primary/10 text-primary">
                                                            {index + 1}
                                                        </div>
                                                        <div className="flex-1 flex items-center gap-2">
                                                            {/* Hidden fields for ID and hasData to ensure they are preserved in onSubmit data */}
                                                            <input type="hidden" {...form.register(`sessions.${index}.id` as any)} />
                                                            <input type="hidden" {...form.register(`sessions.${index}.hasData` as any)} />

                                                            <FormField
                                                                control={form.control as any}
                                                                name={`sessions.${index}.date`}
                                                                render={({ field: sessionField }) => {
                                                                    const dateValue = sessionField.value ? new Date(sessionField.value) : undefined;

                                                                    // Collect all other sessions' dates for duplicate check
                                                                    const otherDates = new Set(
                                                                        form.getValues('sessions')
                                                                            .filter((_: any, i: number) => i !== index)
                                                                            .map((s: any) => s.date ? format(new Date(s.date), 'yyyy-MM-dd') : '')
                                                                            .filter(Boolean)
                                                                    );

                                                                    return (
                                                                        <FormItem className="flex-1 space-y-0 text-left">
                                                                            <Popover>
                                                                                <PopoverTrigger asChild>
                                                                                    <FormControl>
                                                                                        <Button
                                                                                            variant="outline"
                                                                                            className={cn(
                                                                                                "w-full h-11 px-3 text-left font-normal bg-background text-sm",
                                                                                                !dateValue && "text-muted-foreground"
                                                                                            )}
                                                                                        >
                                                                                            <span className="truncate">
                                                                                                {dateValue ? (
                                                                                                    format(dateValue, "PPP", { locale: zhTW })
                                                                                                ) : (
                                                                                                    "選擇日期"
                                                                                                )}
                                                                                            </span>
                                                                                            <CalendarIcon className="ml-auto h-3 w-3 opacity-50 shrink-0" />
                                                                                        </Button>
                                                                                    </FormControl>
                                                                                </PopoverTrigger>
                                                                                <PopoverContent className="w-auto p-0" align="start">
                                                                                    <Calendar
                                                                                        mode="single"
                                                                                        selected={dateValue}
                                                                                        onSelect={(date) => {
                                                                                            if (date && otherDates.has(format(date, 'yyyy-MM-dd'))) {
                                                                                                toast.error('此日期已被其他堂次使用');
                                                                                                return;
                                                                                            }
                                                                                            sessionField.onChange(date);
                                                                                            // If first session date changed, sync first_session_at
                                                                                            if (index === 0 && date) {
                                                                                                setValue('first_session_at', date);
                                                                                            }
                                                                                        }}
                                                                                        disabled={(date) =>
                                                                                            date < new Date('2020-01-01') ||
                                                                                            otherDates.has(format(date, 'yyyy-MM-dd'))
                                                                                        }
                                                                                        initialFocus
                                                                                        locale={zhTW}
                                                                                    />
                                                                                </PopoverContent>
                                                                            </Popover>
                                                                            <FormMessage />
                                                                        </FormItem>
                                                                    );
                                                                }}
                                                            />
                                                        </div>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            className="flex-none h-9 w-9 text-muted-foreground hover:text-destructive shrink-0"
                                                            onClick={() => {
                                                                if (hasData) {
                                                                    setPendingDeleteIndex(index);
                                                                    setIsDeleteWarningOpen(true);
                                                                } else {
                                                                    remove(index);
                                                                    setValue('sessions_count', fields.length - 1);
                                                                }
                                                            }}
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* MV 投票題 Section */}
                    <Card>
                        <CardHeader className="pb-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Music className="h-5 w-5 text-primary" />
                                    <CardTitle className="text-lg">MV 投票題</CardTitle>
                                </div>
                                {isPollPublished && (
                                    <Badge variant="secondary" className="text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950 dark:text-amber-400">
                                        已開票 — 不可修改
                                    </Badge>
                                )}
                            </div>
                            <CardDescription>為此課程建立 MV 投票，學員可在課程頁面投票選歌</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {!showPollSection ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="w-full h-11 border-dashed"
                                    onClick={() => {
                                        setShowPollSection(true);
                                        if (pollOptions.length === 0) {
                                            setPollOptions([
                                                { label: '', youtubeUrl: null, sortOrder: 1 },
                                                { label: '', youtubeUrl: null, sortOrder: 2 },
                                            ]);
                                        }
                                    }}
                                >
                                    <PlusCircle className="h-4 w-4 mr-2" />
                                    新增投票題
                                </Button>
                            ) : (
                                <div className="space-y-4">
                                    {/* Poll Title */}
                                    <div className="space-y-2">
                                        <FormLabel>投票標題</FormLabel>
                                        <Input
                                            className="h-11"
                                            placeholder="例：本期 MV 投票"
                                            value={pollTitle}
                                            onChange={(e) => setPollTitle(e.target.value)}
                                            disabled={isPollPublished}
                                            data-testid="poll-title-input"
                                        />
                                    </div>

                                    {/* Vote Type */}
                                    <div className="space-y-2">
                                        <FormLabel>投票方式</FormLabel>
                                        <Select
                                            value={pollVoteType}
                                            onValueChange={(v) => setPollVoteType(v as 'single' | 'multi')}
                                            disabled={isPollPublished}
                                        >
                                            <SelectTrigger className="h-11" data-testid="poll-vote-type-select">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="single">單選</SelectItem>
                                                <SelectItem value="multi">複選</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {/* Options List */}
                                    <div className="space-y-2">
                                        <FormLabel>投票選項</FormLabel>
                                        <div className="space-y-2">
                                            {pollOptions.map((option, index) => (
                                                <div key={index} className="flex items-start gap-2 p-3 rounded-lg border bg-muted/30">
                                                    <div className="flex-none flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold bg-primary/10 text-primary mt-1">
                                                        {index + 1}
                                                    </div>
                                                    <div className="flex-1 space-y-2">
                                                        <Input
                                                            className="h-9"
                                                            placeholder="選項名稱（必填）"
                                                            value={option.label}
                                                            onChange={(e) => {
                                                                const updated = [...pollOptions];
                                                                updated[index] = { ...updated[index], label: e.target.value };
                                                                setPollOptions(updated);
                                                            }}
                                                            disabled={isPollPublished}
                                                            data-testid={`poll-option-label-${index}`}
                                                        />
                                                        <Input
                                                            className="h-9"
                                                            placeholder="YouTube 連結（選填）"
                                                            value={option.youtubeUrl ?? ''}
                                                            onChange={(e) => {
                                                                const updated = [...pollOptions];
                                                                updated[index] = { ...updated[index], youtubeUrl: e.target.value || null };
                                                                setPollOptions(updated);
                                                            }}
                                                            disabled={isPollPublished}
                                                            data-testid={`poll-option-url-${index}`}
                                                        />
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-7 w-7 text-muted-foreground"
                                                            disabled={isPollPublished || index === 0}
                                                            onClick={() => {
                                                                const updated = [...pollOptions];
                                                                [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
                                                                setPollOptions(updated);
                                                            }}
                                                        >
                                                            <ArrowUp className="h-3.5 w-3.5" />
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-7 w-7 text-muted-foreground"
                                                            disabled={isPollPublished || index === pollOptions.length - 1}
                                                            onClick={() => {
                                                                const updated = [...pollOptions];
                                                                [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
                                                                setPollOptions(updated);
                                                            }}
                                                        >
                                                            <ArrowDown className="h-3.5 w-3.5" />
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                                            disabled={isPollPublished || pollOptions.length <= 2}
                                                            onClick={() => {
                                                                setPollOptions(pollOptions.filter((_, i) => i !== index));
                                                            }}
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        {!isPollPublished && (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="w-full mt-2 border-dashed"
                                                onClick={() => {
                                                    setPollOptions([...pollOptions, { label: '', youtubeUrl: null, sortOrder: pollOptions.length + 1 }]);
                                                }}
                                            >
                                                <PlusCircle className="h-4 w-4 mr-2" />
                                                新增選項
                                            </Button>
                                        )}
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex gap-2 pt-2">
                                        {isEdit && initialData?.id && (
                                            <Button
                                                type="button"
                                                size="sm"
                                                className="h-9 text-sm font-bold"
                                                disabled={isPollSaving || isPollPublished}
                                                onClick={() => handleSavePoll(initialData.id!)}
                                                data-testid="poll-save-btn"
                                            >
                                                {isPollSaving && <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                                                <Save className="h-4 w-4 mr-2" />
                                                儲存投票題
                                            </Button>
                                        )}
                                        {isEdit && pollId && (
                                            <Button
                                                type="button"
                                                variant="destructive"
                                                size="sm"
                                                className="h-9 text-sm font-bold"
                                                disabled={isPollDeleting || isPollPublished}
                                                onClick={handleDeletePoll}
                                                data-testid="poll-delete-btn"
                                            >
                                                {isPollDeleting && <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                                                <Trash2 className="h-4 w-4 mr-2" />
                                                刪除投票題
                                            </Button>
                                        )}
                                        {!isEdit && (
                                            <p className="text-xs text-muted-foreground">
                                                投票題將在課程建立後一併儲存
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* 課程設定 - REMOVED */}
                </div>


            </form>
            <Dialog open={isGroupModalOpen} onOpenChange={setIsGroupModalOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>{editingGroup ? '編輯課程檔期' : '建立新課程檔期'}</DialogTitle>
                        <DialogDescription>
                            輸入檔期名稱，例如「HQ 2026 H1 常態課程」
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <FormLabel>標題</FormLabel>
                            <Input
                                id="name"
                                value={groupTitle}
                                onChange={(e) => setGroupTitle(e.target.value)}
                                placeholder="請輸入標題"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <FormLabel>報名開始日期</FormLabel>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="outline"
                                            className={cn(
                                                "w-full pl-3 text-left font-normal h-10",
                                                !groupRegStart && "text-muted-foreground"
                                            )}
                                        >
                                            {groupRegStart ? format(groupRegStart as Date, "PP", { locale: zhTW }) : "未設定"}
                                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                        <Calendar
                                            mode="single"
                                            selected={groupRegStart || undefined}
                                            onSelect={(date) => setGroupRegStart(date || null)}
                                            initialFocus
                                        />
                                    </PopoverContent>
                                </Popover>
                            </div>
                            <div className="grid gap-2">
                                <FormLabel>報名截止日期</FormLabel>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="outline"
                                            className={cn(
                                                "w-full pl-3 text-left font-normal h-10",
                                                !groupRegEnd && "text-muted-foreground"
                                            )}
                                        >
                                            {groupRegEnd ? format(groupRegEnd as Date, "PP", { locale: zhTW }) : "未設定"}
                                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                        <Calendar
                                            mode="single"
                                            selected={groupRegEnd || undefined}
                                            onSelect={(date) => setGroupRegEnd(date || null)}
                                            initialFocus
                                        />
                                    </PopoverContent>
                                </Popover>
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <FormLabel>繳費期限（天）</FormLabel>
                            <Input
                                type="number"
                                min={1}
                                placeholder="留空=不設限"
                                value={groupPaymentDeadlineDays ?? ''}
                                onChange={(e) => setGroupPaymentDeadlineDays(e.target.value === '' ? null : parseInt(e.target.value, 10))}
                            />
                            <p className="text-xs text-muted-foreground">學員報名後須在此天數內完成繳費，否則自動取消。留空=不設限。</p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsGroupModalOpen(false)}>取消</Button>
                        <Button onClick={handleSaveGroup} disabled={isGroupSubmitting || !groupTitle.trim() || !groupRegStart || !groupRegEnd}>
                            {isGroupSubmitting && <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                            儲存
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isDeleteWarningOpen} onOpenChange={setIsDeleteWarningOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <div className="flex items-center gap-2 text-amber-600 mb-2">
                            <AlertTriangle className="h-5 w-5" />
                            <DialogTitle>無法刪除此課堂</DialogTitle>
                        </div>
                        <DialogDescription className="text-sm leading-relaxed">
                            無法刪除已有紀錄的課堂。
                            <br /><br />
                            此堂課已有學員點名、請假或轉讓紀錄，如需異動請洽系統幹部。
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDeleteWarningOpen(false)} className="w-full sm:w-auto">
                            我知道了
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog open={isGroupDeleteConfirmOpen} onOpenChange={setIsGroupDeleteConfirmOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <div className="flex items-center gap-2 text-rose-600 mb-2">
                            <Trash2 className="h-5 w-5" />
                            <DialogTitle>刪除課程檔期</DialogTitle>
                        </div>
                        <DialogDescription className="text-sm leading-relaxed">
                            確定要刪除檔期「{groupToDelete?.title}」嗎？
                            <br /><br />
                            注意：只能刪除無任何課程關連的檔期。
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setIsGroupDeleteConfirmOpen(false)} disabled={isGroupSubmitting} className="flex-1 sm:flex-none">
                            取消
                        </Button>
                        <Button variant="destructive" onClick={handleDeleteGroup} disabled={isGroupSubmitting} className="flex-1 sm:flex-none">
                            {isGroupSubmitting ? '處理中...' : '確認刪除'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Form>
    );
}
