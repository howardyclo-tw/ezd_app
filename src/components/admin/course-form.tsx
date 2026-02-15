'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, SubmitHandler } from 'react-hook-form';
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
import { CalendarIcon, Upload, Save, X, Clock, Plus, Trash2 } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const sessionSchema = z.object({
    date: z.date({
        message: '請選擇日期',
    }),
});

const courseSchema = z.object({
    name: z.string().min(2, { message: '課程名稱至少 2 個字' }),
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
                        "w-full pl-3 text-left font-normal h-10",
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

export function CourseForm() {
    const router = useRouter();
    const form = useForm<CourseFormValues>({
        resolver: zodResolver(courseSchema) as any,
        defaultValues: {
            name: '',
            type: 'normal',
            teacher: '',
            room: '',
            start_time: '19:00',
            end_time: '20:30',
            sessions_count: 8,
            capacity: 30,
            status: 'draft',
            sessions: [],
        },
    });

    const { watch, setValue, control } = form;
    const firstDate = watch('first_session_at');
    const sessionsCount = watch('sessions_count');

    // Auto-generate sessions when start date or count changes
    useEffect(() => {
        if (!firstDate || !sessionsCount) return;

        const currentSessions = form.getValues('sessions');

        // Only generate if the list is empty or the count changed significantly
        // Or if we specifically want to reset it when firstDate changes
        const newSessions = Array.from({ length: sessionsCount }, (_, i) => {
            // Keep existing manual changes if possible, otherwise generate weekly
            if (currentSessions[i] && i > 0) {
                // If it's not the first one, we might want to keep it
                // But if firstDate changed, everything usually shifts.
                // For MVP simplicity: if firstDate changes, we reset all.
                return { date: addDays(firstDate, i * 7) };
            }
            return { date: addDays(firstDate, i * 7) };
        });

        setValue('sessions', newSessions, { shouldValidate: true });
    }, [firstDate, sessionsCount, setValue]);

    const [isSubmitting, setIsSubmitting] = useState(false);

    const onSubmit: SubmitHandler<CourseFormValues> = async (data) => {
        setIsSubmitting(true);
        try {
            console.log('Form submitted:', data);
            // Simulate an API call
            await new Promise((resolve) => setTimeout(resolve, 800));
            router.push('/admin/courses');
        } catch (error) {
            console.error('Failed to save course:', error);
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
                        <h1 className="text-2xl font-bold tracking-tight">新增課程</h1>
                        <p className="text-muted-foreground text-sm">填寫課程資訊以建立新課程</p>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            type="button"
                            onClick={() => router.push('/admin/courses')}
                        >
                            <X className="mr-2 h-4 w-4" />
                            取消
                        </Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? (
                                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                            ) : (
                                <Save className="mr-2 h-4 w-4" />
                            )}
                            {isSubmitting ? '儲存中...' : '儲存'}
                        </Button>
                    </div>
                </div>

                {/* Mobile Header */}
                <div className="sm:hidden space-y-1 mb-4">
                    <h1 className="text-2xl font-bold tracking-tight">新增課程</h1>
                    <p className="text-muted-foreground text-sm">填寫課程資訊以建立新課程</p>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                    {/* 基本資訊 */}
                    <Card className="md:col-span-2 shadow-sm border-muted/60">
                        <CardHeader>
                            <CardTitle>基本資訊</CardTitle>
                            <CardDescription>設定課程的主要資訊</CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 sm:grid-cols-2">
                            <FormField
                                control={form.control as any}
                                name="name"
                                render={({ field }) => (
                                    <FormItem className="sm:col-span-2">
                                        <FormLabel>課程名稱</FormLabel>
                                        <FormControl>
                                            <Input placeholder="例如：週三基礎律動" {...field} />
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
                                                <SelectTrigger>
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
                                name="teacher"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>老師</FormLabel>
                                        <FormControl>
                                            <Input placeholder="老師姓名" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control as any}
                                name="room"
                                render={({ field }) => (
                                    <FormItem className="sm:col-span-2">
                                        <FormLabel>教室</FormLabel>
                                        <FormControl>
                                            <Input placeholder="教室名稱或地點" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </CardContent>
                    </Card>

                    {/* 課程安排 */}
                    <Card className="md:col-span-2 shadow-sm border-muted/60">
                        <CardHeader>
                            <CardTitle>課程安排</CardTitle>
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
                                                            "w-full pl-3 text-left font-normal h-10 px-3",
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
                                                <Input type="number" {...field} />
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
                                                <Input type="number" {...field} />
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
                                            className="text-xs h-8 w-full sm:w-auto mt-1 sm:mt-0"
                                            onClick={() => {
                                                const current = form.getValues('sessions');
                                                setValue('sessions', [...current, { date: addDays(current[current.length - 1]?.date || firstDate, 7) }]);
                                                setValue('sessions_count', current.length + 1);
                                            }}
                                        >
                                            <Plus className="h-3 w-3 mr-1" /> 加一堂
                                        </Button>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                                        {form.watch('sessions')?.map((session, index) => (
                                            <div key={index} className="flex items-center gap-2 p-2 sm:p-3 rounded-lg border bg-muted/30 transition-colors hover:bg-muted/50">
                                                <div className="flex-none flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                                                    {index + 1}
                                                </div>
                                                <FormField
                                                    control={form.control as any}
                                                    name={`sessions.${index}.date`}
                                                    render={({ field }) => (
                                                        <FormItem className="flex-1 space-y-0">
                                                            <Popover>
                                                                <PopoverTrigger asChild>
                                                                    <FormControl>
                                                                        <Button
                                                                            variant="outline"
                                                                            className={cn(
                                                                                "w-full h-9 px-3 text-left font-normal bg-background text-sm",
                                                                                !field.value && "text-muted-foreground"
                                                                            )}
                                                                        >
                                                                            <span className="truncate">
                                                                                {field.value ? (
                                                                                    format(field.value, "PPP", { locale: zhTW })
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
                                                                        selected={field.value}
                                                                        defaultMonth={field.value}
                                                                        onSelect={field.onChange}
                                                                        initialFocus
                                                                        locale={zhTW}
                                                                    />
                                                                </PopoverContent>
                                                            </Popover>
                                                        </FormItem>
                                                    )}
                                                />
                                                {form.watch('sessions').length > 1 && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className="flex-none h-9 w-9 text-muted-foreground hover:text-destructive shrink-0"
                                                        onClick={() => {
                                                            const current = form.getValues('sessions');
                                                            const filtered = current.filter((_, i) => i !== index);
                                                            setValue('sessions', filtered);
                                                            setValue('sessions_count', filtered.length);
                                                        }}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* 課程設定 */}
                    <Card className="md:col-span-2 shadow-sm border-muted/60">
                        <CardHeader>
                            <CardTitle>課程設定</CardTitle>
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
                                                <SelectTrigger>
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
                    <Button variant="outline" type="button" onClick={() => router.push('/admin/courses')} className="flex-1 font-semibold h-11">
                        取消
                    </Button>
                    <Button type="submit" className="flex-1 font-semibold h-11" disabled={isSubmitting}>
                        {isSubmitting ? (
                            <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        ) : (
                            <Save className="mr-2 h-4 w-4" />
                        )}
                        {isSubmitting ? '儲存中...' : '儲存'}
                    </Button>
                </div>
            </form>
        </Form>
    );
}
