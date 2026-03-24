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
import { CalendarIcon, Upload, Save, X, Clock, Plus, Trash2, Pencil, AlertTriangle, PlusCircle, PencilLine, ChevronLeft, Search, Check, ChevronsUpDown } from 'lucide-react';
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
    updateCourseGroup,
    deleteCourseGroup
} from '@/lib/supabase/actions';
import { getCourseGroups, getProfiles } from '@/lib/supabase/queries';
import { toast } from 'sonner';

interface CourseGroup {
    id: string;
    title: string;
    registration_phase1_start?: string | null;
    registration_phase1_end?: string | null;
}

interface Profile {
    id: string;
    name: string;
    role: string;
}


const sessionSchema = z.object({
    id: z.string().optional(),
    date: z.coerce.date({
        message: '請選擇日期',
    }),
    hasData: z.any().optional(),
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
    cards_per_session: z.coerce.number().min(0, { message: '堂卡扣除不能為負數' }),
    first_session_at: z.coerce.date({
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
    const [groupRegStart, setGroupRegStart] = useState<Date | null>(null);
    const [groupRegEnd, setGroupRegEnd] = useState<Date | null>(null);
    const [isGroupSubmitting, setIsGroupSubmitting] = useState(false);

    const [isDeleteWarningOpen, setIsDeleteWarningOpen] = useState(false);
    const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null);
    const [isGroupDeleteConfirmOpen, setIsGroupDeleteConfirmOpen] = useState(false);
    const [groupToDelete, setGroupToDelete] = useState<CourseGroup | null>(null);

    // Leader Search State
    const [isLeaderSearchOpen, setIsLeaderSearchOpen] = useState(false);
    const [leaderSearchQuery, setLeaderSearchQuery] = useState("");

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
                await updateCourseGroup(editingGroup.id, groupTitle, groupRegStart, groupRegEnd);
                setGroups(prev => prev.map(g => g.id === editingGroup.id ? { ...g, title: groupTitle, registration_phase1_start: groupRegStart?.toISOString(), registration_phase1_end: groupRegEnd?.toISOString() } : g));
                toast.success('已修正檔期資訊');
            } else {
                const res = await createCourseGroup(groupTitle, groupRegStart, groupRegEnd);
                if (res.id) {
                    const newGroup = { 
                        id: res.id, 
                        title: groupTitle,
                        registration_phase1_start: groupRegStart?.toISOString(),
                        registration_phase1_end: groupRegEnd?.toISOString()
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
        // The instruction specifically asked to change '管理員' to '幹部' within this context.
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
            cards_per_session: initialData?.cards_per_session ?? 1,
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
    }, [firstDate, sessionsCount, isEdit, replace, append, remove]); // fields.length is handled implicitly by looking at it inside

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
                                        sessions: '課程進度明細 (堂數)'
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
                                                                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
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
                                                                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    e.stopPropagation();
                                                                    setEditingGroup(g);
                                                                    setGroupTitle(g.title);
                                                                    setGroupRegStart(g.registration_phase1_start ? new Date(g.registration_phase1_start) : null);
                                                                    setGroupRegEnd(g.registration_phase1_end ? new Date(g.registration_phase1_end) : null);
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
                                                                    <Check className={cn("mr-2 h-4 w-4", field.value === p.id ? "opacity-100" : "opacity-0")} />
                                                                    {p.name} {p.role === 'leader' ? '(班長)' : p.role === 'admin' ? '(管理員)' : ''}
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
                                                                    // Sync local fieldArray value with form state if they drift
                                                                    const dateValue = sessionField.value ? new Date(sessionField.value) : undefined;

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
                                                                                        onSelect={sessionField.onChange}
                                                                                        disabled={(date) => date < new Date('2020-01-01')}
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
