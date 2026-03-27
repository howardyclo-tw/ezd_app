'use client';

import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
    Download, 
    Upload, 
    FileText, 
    CheckCircle2, 
    AlertCircle, 
    Loader2, 
    ArrowRight,
    Users,
    CreditCard,
    ClipboardList,
    Trash2,
    Copy,
    Check
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

import { importDataAction } from '@/lib/supabase/import-actions';

// Types for different import categories
type ImportType = 'members' | 'card_orders' | 'rosters' | 'course_groups';

interface PreviewData {
    headers: string[];
    rows: any[];
    isValid: boolean;
    errors: string[];
}

// CSV Template Definitions
const templates = {
    members: {
        title: '社員名單',
        filename: 'ezd_members_template.csv',
        content: '電子郵件 (email),姓名 (name),工號 (employee_id),是否為社員 (is_member)\nexample_member@mediatek.com,王小明,12345,1\nexample_guest@mediatek.com,李小華,67890,0',
        headers: ['電子郵件 (email)', '姓名 (name)', '工號 (employee_id)', '是否為社員 (is_member)']
    },
    card_orders: {
        title: '堂卡紀錄',
        filename: 'ezd_card_orders_template.csv',
        content: '工號 (employee_id),堂數 (cards)\n12345,10\n67890,5',
        headers: ['工號 (employee_id)', '堂數 (cards)']
    },
    rosters: {
        title: '學員名單',
        filename: 'ezd_course_roster_template.csv',
        content: '檔期名稱 (group_title),課程名稱 (course_name),工號 (employee_id)\nHQ 2026 1~2月 風格體驗,HQ 2026 1~2月 風格體驗,12345\nHQ 2026 1~2月 風格體驗,HQ 2026 1~2月 風格體驗,67890',
        headers: ['檔期名稱 (group_title)', '課程名稱 (course_name)', '工號 (employee_id)']
    },
    course_groups: {
        title: '課程資訊',
        filename: 'ezd_course_info_template.csv',
        content: '檔期名稱 (group_title),課程名稱 (name),類型 (type),老師 (teacher),教室 (room),日期 (session_date),開始時間 (start_time),結束時間 (end_time),人數上限 (capacity),堂卡扣除 (cards_per_session),備註 (description)\n2026 HQ 3月 常態試跳,Krump 體驗,trial,小Joy,E棟有氧教室,2026-03-16,19:00,20:30,18,0,\n2026 HQ 3月 常態試跳,韓風MV,trial,小可,AB棟韻律教室,2026-03-17,19:15,20:45,25,0,',
        headers: ['檔期名稱 (group_title)', '課程名稱 (name)', '類型 (type)', '老師 (teacher)', '教室 (room)', '日期 (session_date)', '開始時間 (start_time)', '結束時間 (end_time)', '人數上限 (capacity)', '堂卡扣除 (cards_per_session)', '備註 (description)']
    }
};

export function ImportClient() {
    const [importType, setImportType] = useState<ImportType>('members');
    const [rawText, setRawText] = useState(templates.members.content);
    const [preview, setPreview] = useState<PreviewData | null>(null);
    const [isParsing, setIsParsing] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Initial parse on mount
    useEffect(() => {
        const initialParsed = parseCSV(templates.members.content, 'members');
        if (initialParsed) setPreview(initialParsed);
    }, []);

    const copyTemplateToClipboard = () => {
        const template = templates[importType];
        navigator.clipboard.writeText(template.content);
        toast.success(`已複製 ${importType === 'members' ? '社員名單' : importType === 'card_orders' ? '堂卡紀錄' : '課程名冊'} 範本內容`);
    };

    const handleTabChange = (value: string) => {
        const type = value as ImportType;
        setImportType(type);
        const templateContent = templates[type].content;
        setRawText(templateContent);
        setPreview(parseCSV(templateContent, type));
    };

    // RFC 4180 compliant CSV parser: handles quoted fields with commas and newlines
    const parseCSVRows = (text: string): string[][] => {
        const rows: string[][] = [];
        let current: string[] = [];
        let field = '';
        let inQuotes = false;

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            const next = text[i + 1];

            if (inQuotes) {
                if (ch === '"' && next === '"') {
                    field += '"'; // escaped quote
                    i++;
                } else if (ch === '"') {
                    inQuotes = false;
                } else {
                    field += ch;
                }
            } else {
                if (ch === '"') {
                    inQuotes = true;
                } else if (ch === ',') {
                    current.push(field.trim());
                    field = '';
                } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
                    current.push(field.trim());
                    field = '';
                    if (current.some(c => c !== '')) rows.push(current);
                    current = [];
                    if (ch === '\r') i++; // skip \n after \r
                } else {
                    field += ch;
                }
            }
        }
        // Last field/row
        current.push(field.trim());
        if (current.some(c => c !== '')) rows.push(current);
        return rows;
    };

    const parseCSV = (text: string, typeOverride?: ImportType) => {
        const allRows = parseCSVRows(text);
        if (allRows.length < 1) return null;

        const currentType = typeOverride || importType;
        const requiredHeaders = templates[currentType].headers;
        const headers = allRows[0];
        const errors: string[] = [];

        // 1. Header Validation
        const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
        if (missingHeaders.length > 0) {
            errors.push(`缺少必要欄位: ${missingHeaders.join(', ')}`);
        }

        // 2. Data Row Validation
        const rows = allRows.slice(1).map((values, index) => {
            const obj: any = {};

            const mandatoryFields: Record<ImportType, string[]> = {
                members: ['電子郵件 (email)', '姓名 (name)', '是否為社員 (is_member)'],
                card_orders: ['工號 (employee_id)', '堂數 (cards)'],
                rosters: ['檔期名稱 (group_title)', '課程名稱 (course_name)', '工號 (employee_id)'],
                course_groups: ['檔期名稱 (group_title)', '課程名稱 (name)', '老師 (teacher)', '教室 (room)', '日期 (session_date)', '開始時間 (start_time)', '結束時間 (end_time)']
            };

            if (values.length !== headers.length) {
                errors.push(`第 ${index + 2} 行欄位數量不正確 (預期 ${headers.length} 欄，實際讀到 ${values.length} 欄)`);
            }

            const VALID_COURSE_TYPES = ['normal', 'trial', 'special', 'style', 'workshop'];

            headers.forEach((header, i) => {
                const val = values[i];
                obj[header] = val;

                if (mandatoryFields[currentType].includes(header) && (!val || val.trim() === '')) {
                    errors.push(`第 ${index + 2} 行資料錯誤: [${header}] 為必填欄位於此匯人類型`);
                }

                if (currentType === 'course_groups' && header === '類型 (type)' && val && !VALID_COURSE_TYPES.includes(val.trim())) {
                    errors.push(`第 ${index + 2} 行 [類型] 值 "${val}" 無效，可用值: ${VALID_COURSE_TYPES.join(', ')}`);
                }
            });
            return obj;
        });

        return {
            headers,
            rows,
            isValid: errors.length === 0 && rows.length > 0 && missingHeaders.length === 0,
            errors: Array.from(new Set(errors)) // Deduplicate errors
        };
    };

    const handleTextChange = (text: string) => {
        setRawText(text);
        if (!text.trim()) {
            setPreview(null);
            return;
        }
        
        setIsParsing(true);
        const parsed = parseCSV(text, importType);
        setPreview(parsed);
        
        // Brief timeout to simulate the 'thinking' pulse
        setTimeout(() => setIsParsing(false), 200);
    };

    const handleReset = () => {
        const templateContent = templates[importType].content;
        setRawText(templateContent);
        setPreview(parseCSV(templateContent));
    };

    const handleImportSubmit = async () => {
        if (!preview || !preview.isValid) return;

        setIsSubmitting(true);
        try {
            const result = await importDataAction(importType, preview.rows);
            
            if (result.success > 0) {
                toast.success(`匯入完成！成功：${result.success} 筆${result.failed > 0 ? `，失敗：${result.failed} 筆` : ''}`);
            }

            if (result.failed > 0) {
                toast.error(`部分匯入失敗 (${result.failed} 筆)，請檢查資料。`);
            }

            // Keep the pasted data in the editor after successful import
            // so users can re-submit or modify the data
        } catch (err: any) {
            toast.error(`匯入發生錯誤: ${err.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    // Ref for syncing scroll between line numbers and textarea
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const lineNumbersRef = useRef<HTMLDivElement>(null);

    const handleScroll = () => {
        if (textareaRef.current && lineNumbersRef.current) {
            lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
        }
    };

    const lineCount = rawText.split(/\r?\n/).length || 1;

    return (
        <div className="space-y-6">
            {/* Info Hint */}
            <div className="bg-blue-500/10 border border-blue-500/20 backdrop-blur-md rounded-2xl p-4 flex items-start gap-4 shadow-xl animate-in fade-in slide-in-from-top-4 duration-700 group">
                <div className="h-10 w-10 rounded-xl bg-blue-500/20 flex items-center justify-center shrink-0 border border-blue-500/30">
                    <AlertCircle className="h-5 w-5 text-blue-400" />
                </div>
                <div className="flex-1">
                    <p className="text-sm font-black text-blue-100 uppercase tracking-widest mb-1.5 opacity-80">小提示</p>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <p className="text-sm font-bold text-white/70 leading-relaxed max-w-2xl">
                            如果是要修改單一成員的 
                            <span className="text-blue-400 mx-1 border-b border-blue-400/30">身份等級、到期日</span> 或 
                            <span className="text-blue-400 mx-1 border-b border-blue-400/30">堂卡點數</span>，
                            無需重新上傳！
                        </p>
                        <a 
                            href="/admin/members" 
                            className="bg-blue-500 text-white px-4 py-2 rounded-xl text-xs font-black inline-flex items-center gap-2 hover:bg-blue-600 transition-all shadow-[0_0_20px_rgba(59,130,246,0.3)] active:scale-95 shrink-0"
                        >
                            前往社員管理 <ArrowRight className="h-3.5 w-3.5" />
                        </a>
                    </div>
                </div>
            </div>

            <Tabs value={importType} onValueChange={handleTabChange}>
                <div className="mb-4 sm:mb-8 -mx-4 sm:mx-0">
                    <div className="overflow-x-auto pb-4 px-4 scrollbar-hide">
                        <TabsList className="bg-white/5 p-1 rounded-xl border border-white/5 backdrop-blur-md flex flex-nowrap w-max min-w-full gap-1">
                            <TabsTrigger value="members" className="rounded-lg font-bold flex items-center gap-2 px-3 sm:px-6 py-2 data-[state=active]:bg-white/10 data-[state=active]:text-white transition-all text-white/40 whitespace-nowrap text-[13px] sm:text-sm">
                                <Users className="h-3.5 w-3.5" /> 社員名單
                            </TabsTrigger>
                            <TabsTrigger value="card_orders" className="rounded-lg font-bold flex items-center gap-2 px-3 sm:px-6 py-2 data-[state=active]:bg-white/10 data-[state=active]:text-white transition-all text-white/40 whitespace-nowrap text-[13px] sm:text-sm">
                                <CreditCard className="h-3.5 w-3.5" /> 堂卡紀錄
                            </TabsTrigger>
                            <TabsTrigger value="course_groups" className="rounded-lg font-bold flex items-center gap-2 px-3 sm:px-6 py-2 data-[state=active]:bg-white/10 data-[state=active]:text-white transition-all text-white/40 whitespace-nowrap text-[13px] sm:text-sm">
                                <FileText className="h-3.5 w-3.5" /> 課程資訊
                            </TabsTrigger>
                            <TabsTrigger value="rosters" className="rounded-lg font-bold flex items-center gap-2 px-3 sm:px-6 py-2 data-[state=active]:bg-white/10 data-[state=active]:text-white transition-all text-white/40 whitespace-nowrap text-[13px] sm:text-sm">
                                <ClipboardList className="h-3.5 w-3.5" /> 學員名單
                            </TabsTrigger>
                        </TabsList>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
                    {/* Editor Section */}
                    <Card className="border-white/10 bg-[#1A1A1C]/90 backdrop-blur-xl overflow-hidden flex flex-col shadow-2xl group/editor relative h-[700px]">
                        {/* Status bar top glow - SYNCED */}
                        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                        
                        <CardHeader className="py-5 px-6 flex flex-row items-center justify-between bg-transparent relative z-10">
                            <div className="flex items-center gap-3">
                                <div className="h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.6)]" />
                                <span className="text-[13px] font-bold uppercase tracking-widest text-white/50">資料編輯窗口</span>
                            </div>
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={handleReset} 
                                className="h-8 w-8 rounded-lg text-white/20 hover:text-rose-400 hover:bg-rose-400/10 transition-all"
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </CardHeader>
                        <div className="flex-1 p-0 relative flex overflow-hidden">
                            <div 
                                ref={lineNumbersRef}
                                className="w-12 bg-black/5 flex flex-col items-center py-7 overflow-hidden select-none"
                            >
                                {Array.from({ length: Math.max(lineCount, 15) }).map((_, i) => {
                                    const n = i + 1;
                                    return (
                                        <span 
                                            key={i} 
                                            className={`text-[11px] font-mono font-bold leading-8 h-8 transition-colors ${n <= lineCount ? 'text-white/20' : 'text-white/5'}`}
                                        >
                                            {n < 10 ? `0${n}` : n}
                                        </span>
                                    );
                                })}
                            </div>
                            <textarea 
                                ref={textareaRef}
                                onScroll={handleScroll}
                                value={rawText}
                                onChange={(e) => handleTextChange(e.target.value)}
                                placeholder="在此貼入 CSV 格式資料..."
                                className="flex-1 p-7 pt-2 font-mono text-[14px] bg-transparent border-none focus:ring-0 resize-none leading-8 placeholder:text-white/10 selection:bg-primary/30 text-white/90 transition-all font-medium caret-primary overflow-y-auto"
                                disabled={isSubmitting}
                                spellCheck={false}
                            />
                        </div>
                    </Card>

                    {/* Preview Section */}
                    <Card className="border-white/10 bg-[#1A1A1C]/90 backdrop-blur-xl overflow-hidden flex flex-col shadow-2xl relative h-[700px]">
                        {/* Status bar top glow - SYNCED */}
                        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                        
                        <CardHeader className="py-5 px-6 bg-transparent relative z-10">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-primary/5 border border-primary/10">
                                        <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                                        <span className="text-[11px] font-bold uppercase tracking-wider text-primary">解析預覽結果</span>
                                    </div>
                                    <CardDescription className="text-[12px] font-semibold text-white/30 italic">
                                        共有 {preview?.rows.length || 0} 筆資料待處理
                                    </CardDescription>
                                </div>
                                {preview && (
                                    <Badge 
                                        variant="outline" 
                                        className={`font-black text-[11px] tracking-tight px-3 py-1 border-none shadow-sm transition-all duration-300 ${
                                            isParsing 
                                                ? 'text-white/40 bg-white/5 animate-pulse' 
                                                : preview.isValid 
                                                    ? 'text-emerald-400 bg-emerald-400/10 scale-100' 
                                                    : 'text-rose-400 bg-rose-400/10 scale-100'
                                        }`}
                                    >
                                        {isParsing ? '正在驗證...' : preview.isValid ? '驗證通過' : '格式錯誤'}
                                    </Badge>
                                )}
                            </div>
                        </CardHeader>

                        <CardContent className="p-0 flex-1 overflow-auto">
                            {!preview ? (
                                <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-white/20 p-12 space-y-5">
                                    <div className="relative">
                                        <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full" />
                                        <FileText className="h-14 w-14 text-white/10 relative z-10" />
                                    </div>
                                    <div className="text-center space-y-2">
                                        <p className="text-[12px] font-black uppercase tracking-[0.2em] text-white/30">等待輸入資料</p>
                                        <p className="text-[11px] font-bold text-white/20 italic">即時解析結果</p>
                                    </div>
                                </div>
                            ) : preview.errors.length > 0 ? (
                                <div className="p-8 pt-0 space-y-6">
                                    <div className="bg-rose-500/5 border border-rose-500/10 rounded-2xl p-6 flex gap-5 items-start">
                                        <AlertCircle className="h-6 w-6 text-rose-500 shrink-0" />
                                        <div className="space-y-2">
                                            <p className="text-sm font-black text-rose-400 uppercase tracking-widest">資料解析限制未通過</p>
                                            <ul className="text-[12px] text-rose-300/70 font-medium list-none space-y-2">
                                                {preview.errors.map((err, i) => <li key={i} className="flex items-start gap-2">
                                                    <span className="text-rose-500/50">→</span>
                                                    {err}
                                                </li>)}
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="relative">
                                    <table className="w-full text-left border-collapse">
                                        <thead className="sticky top-0 bg-[#212124]/95 backdrop-blur-xl z-20">
                                            <tr className="border-b border-white/5">
                                                <th className="px-6 py-5 text-[11px] font-bold uppercase tracking-widest text-white/30 whitespace-nowrap w-16">#</th>
                                                {preview.headers.map(h => (
                                                    <th key={h} className="px-6 py-5 text-[11px] font-bold uppercase tracking-widest text-white/30 whitespace-nowrap">{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/[0.04]">
                                            {preview.rows.map((row, i) => (
                                                <tr key={i} className="group/row hover:bg-white/[0.03] transition-colors relative">
                                                    <td className="px-6 py-5 text-[11px] font-mono font-bold text-white/20 whitespace-nowrap tracking-tight border-r border-white/5 bg-black/5">
                                                        {(i + 1).toString().padStart(2, '0')}
                                                    </td>
                                                    {preview.headers.map(h => {
                                                        const val = row[h] || '---';
                                                        const isLong = val.length > 30;
                                                        return (
                                                            <td key={h} className={`px-6 py-5 text-[14px] font-semibold text-white/70 tracking-tight group-hover/row:text-white transition-colors border-l border-white/[0.01] ${isLong ? 'max-w-[200px] truncate' : 'whitespace-nowrap'}`} title={isLong ? val : undefined}>
                                                                {val}
                                                            </td>
                                                        );
                                                    })}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </CardContent>

                        {preview && preview.isValid && (
                            <div className="p-8 pt-4 flex justify-end items-center gap-6 bg-transparent">
                                <span className="text-[12px] font-bold text-white/50 uppercase tracking-[0.1em] hidden sm:block">
                                    {importType === 'members' ? '' : '資料已備妥，請確認預覽結果'}
                                </span>
                                <Button 
                                    className="rounded-2xl px-12 h-12 font-black bg-white text-black hover:bg-white/90 shadow-[0_10px_40px_-10px_rgba(255,255,255,0.3)] transition-all active:scale-95 group text-sm"
                                    onClick={handleImportSubmit}
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            執行中...
                                        </>
                                    ) : (
                                        <>
                                            確認匯入 {templates[importType].title}
                                            <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1.5 transition-transform" />
                                        </>
                                    )}
                                </Button>
                            </div>
                        )}
                    </Card>
                </div>
            </Tabs>
        </div>
    );
}
