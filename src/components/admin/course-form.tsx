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
import { CalendarIcon, Upload, Save, X, Clock, Plus, Trash2, Pencil, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
    updateCourseGroup
} from '@/lib/supabase/actions';
import { getCourseGroups, getProfiles } from '@/lib/supabase/queries';
import { toast } from 'sonner';

interface CourseGroup {
    id: string;
    title: string;
}

interface Profile {
    id: string;
    name: string;
    role: string;
}


const sessionSchema = z.object({
    id: z.string().optional(),
    date: z.date({
        message: '請選擇日期',
    }),
    hasData: z.boolean().optional(),
});

const courseSchema = z.object({
    groupId: z.string().min(1, { message: '請選擇所屬檔期' }),
    name: z.string().min(2, { message: '課程名稱至少 2 個字' }),
    description: z.string().optional(),
    leader: z.string().optional(),
    type: z.enum(['normal', 'trial', 'special', 'style', 'workshop', 'rehearsal', 'performance']),
    teacher: z.string().min(1, { message: '請輸入老師姓名' }),
    room: z.string().min(1, { message: '請輸入教室' }),
    start_time: z.string().regex(/^([01]\d|2[0-3]):?([0-5]\d)$/, { message: '請輸入有效的時間格式 (HH:mm)' }),
    end_time: z.string().regex(/^([01]\d|2[0-3]):?([0-5]\d)$/, { message: '請輸入有效的時間格式 (HH:mm)' }),
    sessions_count: z.coerce.number().min(1, { message: '至少 1 堂課' }),
    capacity: z.coerce.number().min(1, { message: '人數上限至少 1 人' }),
    status: z.enum(['draft', 'published', 'closed']),
    first_session_at: z.date({
        message: '請選擇日期',
    }),
    sessions: z.array(sessionSchema).min(1, { message: '至少需要一堂課' }),
});

type CourseFormValues = z.infer<typeof courseSchema>;

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
}

export function CourseForm({ initialData, mode = 'create' }: CourseFormProps = {}) {
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
    const [isGroupSubmitting, setIsGroupSubmitting] = useState(false);

    // Deletion Warning Modal
    const [isDeleteWarningOpen, setIsDeleteWarningOpen] = useState(false);
    const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null);

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
        setIsGroupSubmitting(true);
        try {
            if (editingGroup) {
                await updateCourseGroup(editingGroup.id, groupTitle);
                setGroups(prev => prev.map(g => g.id === editingGroup.id ? { ...g, title: groupTitle } : g));
                toast.success('已修正檔期標題');
            } else {
                const res = await createCourseGroup(groupTitle);
                if (res.id) {
                    const newGroup = { id: res.id, title: groupTitle };
                    setGroups(prev => [...prev, newGroup]);
                    form.setValue('groupId', res.id);
                    toast.success('已建立新檔期');
                }
            }
            setIsGroupModalOpen(false);
            setEditingGroup(null);
            setGroupTitle('');
        } catch (err: any) {
            toast.error(err.message || '操作失敗');
        } finally {
            setIsGroupSubmitting(false);
        }
    };

    const form = useForm<CourseFormValues>({
        resolver: zodResolver(courseSchema) as any,
        defaultValues: {
            groupId: initialData?.groupId || '',
            name: initialData?.name || '',
            description: initialData?.description || '',
            leader: initialData?.leader || 'none',
            type: initialData?.type || 'normal',
            teacher: initialData?.teacher || '',
            room: initialData?.room || '',
            start_time: initialData?.start_time || '19:00',
            end_time: initialData?.end_time || '20:30',
            sessions_count: initialData?.sessions_count || 8,
            capacity: initialData?.capacity || 30,
            status: initialData?.status || 'draft',
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

    // Auto-generate sessions when first date or count changes (only for new courses or if empty)
    useEffect(() => {
        if (isEdit || !firstDate || !sessionsCount) return;

        // Skip if it's the first run in edit mode to avoid overwriting existing sessions
        if (isEdit && isInitialLoad.current) {
            isInitialLoad.current = false;
            return;
        }

        // Only auto-generate if we don't have sessions or if it's clearly a fresh start
        const currentSessions = form.getValues('sessions');
        if (currentSessions.length === 0 || (!isEdit && currentSessions.length !== sessionsCount)) {
            const newSessions = Array.from({ length: sessionsCount }, (_, i) => ({
                date: addDays(firstDate, i * 7)
            }));
            replace(newSessions as any);
        }
    }, [firstDate, sessionsCount, isEdit, replace]);

    // Track sessions_count changes specifically to append/remove
    useEffect(() => {
        const currentCount = fields.length;
        if (currentCount === 0 || !firstDate) return;

        if (sessionsCount > currentCount) {
            // Append
            const lastDate = fields[fields.length - 1]?.date || firstDate;
            for (let i = 0; i < (sessionsCount - currentCount); i++) {
                append({
                    date: addDays(lastDate, (i + 1) * 7)
                });
            }
        } else if (sessionsCount < currentCount && sessionsCount > 0) {
            // Remove from end
            for (let i = 0; i < (currentCount - sessionsCount); i++) {
                remove(currentCount - 1 - i);
            }
        }
    }, [sessionsCount, fields.length, append, remove, firstDate]);

    const onSubmit: SubmitHandler<CourseFormValues> = async (data) => {
        setIsSubmitting(true);
        try {
            let res;
            if (isEdit && initialData?.id) {
                res = await updateCourse(initialData.id as string, data);
            } else {
                res = await createCourse(data);
            }

            if (res.success) {
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
                {/* Header - Desktop */}
                <div className="hidden sm:flex items-center justify-between sticky top-0 z-10 bg-background/80 backdrop-blur-md py-4 border-b">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">{isEdit ? '編輯課程' : '新增課程'}</h1>
                        <p className="text-muted-foreground text-sm">{isEdit ? '修改課程資訊後點擊儲存' : '填寫課程資訊以建立新課程'}</p>
                    </div>
                    <div className="flex gap-2">
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
                        <Button type="submit" size="sm" className="h-10 text-sm font-bold" disabled={isSubmitting}>
                            {isSubmitting ? (
                                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            ) : (
                                !isEdit && <Plus className="mr-2 h-4 w-4" />
                            )}
                            {isEdit ? '儲存變更' : '建立課程'}
                        </Button>
                    </div>
                </div>

                {/* Mobile Header */}
                <div className="sm:hidden space-y-1 mb-4">
                    <h1 className="text-2xl font-bold tracking-tight">{isEdit ? '編輯課程' : '新增課程'}</h1>
                    <p className="text-muted-foreground text-sm">{isEdit ? '修改課程資訊後點擊儲存' : '填寫課程資訊以建立新課程'}</p>
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
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                setEditingGroup(g);
                                                                setGroupTitle(g.title);
                                                                setIsGroupModalOpen(true);
                                                            }}
                                                        >
                                                            <Pencil className="h-3 w-3" />
                                                        </Button>
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
                                        <FormLabel>課程描述</FormLabel>
                                        <FormControl>
                                            <Input placeholder="請輸入課程簡介與目標" className="h-11" {...field} />
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
                                                <SelectItem value="special">特殊常態</SelectItem>
                                                <SelectItem value="style">風格體驗</SelectItem>
                                                <SelectItem value="workshop">專攻班</SelectItem>
                                                <SelectItem value="rehearsal">團練</SelectItem>
                                                <SelectItem value="performance">表演班</SelectItem>
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
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>班長</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger className="h-11">
                                                    <SelectValue placeholder={isLoadingData ? "載入中..." : "選擇班長"} />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="none">未指定</SelectItem>
                                                {profiles.map((p) => (
                                                    <SelectItem key={p.id} value={p.id}>
                                                        {p.name} {p.role === 'leader' ? '(班長)' : p.role === 'admin' ? '(管理員)' : ''}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
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
                                                    date: addDays(lastDate, 7)
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
                                                                render={({ field: sessionField }) => (
                                                                    <FormItem className="flex-1 space-y-0">
                                                                        <Popover>
                                                                            <PopoverTrigger asChild>
                                                                                <FormControl>
                                                                                    <Button
                                                                                        variant="outline"
                                                                                        className={cn(
                                                                                            "w-full h-11 px-3 text-left font-normal bg-background text-sm",
                                                                                            !sessionField.value && "text-muted-foreground"
                                                                                        )}
                                                                                    >
                                                                                        <span className="truncate">
                                                                                            {sessionField.value ? (
                                                                                                format(sessionField.value, "PPP", { locale: zhTW })
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
                                                                                    selected={sessionField.value}
                                                                                    defaultMonth={sessionField.value}
                                                                                    onSelect={sessionField.onChange}
                                                                                    initialFocus
                                                                                    locale={zhTW}
                                                                                />
                                                                            </PopoverContent>
                                                                        </Popover>
                                                                    </FormItem>
                                                                )}
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

                    {/* 課程設定 */}
                    <Card className="md:col-span-2 shadow-sm border-muted/60">
                        <CardHeader>
                            <CardTitle className="text-lg font-bold">課程設定</CardTitle>
                            <CardDescription>設定課程公開狀態</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <FormField
                                control={form.control as any}
                                name="status"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>發布狀態</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger className="h-11">
                                                    <SelectValue placeholder="選擇狀態" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="draft">草稿 (Draft)</SelectItem>
                                                <SelectItem value="published">發布 (Published)</SelectItem>
                                                <SelectItem value="closed">結束 (Closed)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <FormDescription>發布後學員才看得到</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </CardContent>
                    </Card>
                </div>

                {/* Mobile Bottom Actions (Static) */}
                <div className="flex sm:hidden gap-3 mt-8 pb-4">
                    <Button variant="outline" type="button" onClick={() => router.back()} className="flex-1 font-bold text-sm h-11 border-muted">
                        取消
                    </Button>
                    <Button type="submit" className="flex-1 font-bold text-sm h-11" disabled={isSubmitting}>
                        {isSubmitting ? (
                            <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        ) : (
                            <Save className="mr-2 h-4 w-4" />
                        )}
                        {isSubmitting ? '儲存中...' : '儲存課程'}
                    </Button>
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
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsGroupModalOpen(false)}>取消</Button>
                        <Button onClick={handleSaveGroup} disabled={isGroupSubmitting}>
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
                            此堂課已有學員點名、請假或轉讓紀錄，如需異動請洽系統管理員。
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDeleteWarningOpen(false)} className="w-full sm:w-auto">
                            我知道了
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Form>
    );
}
