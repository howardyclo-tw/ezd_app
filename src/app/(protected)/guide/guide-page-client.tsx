'use client';

import { useState, useTransition, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { ChevronLeft, Edit2, Save, X, BookOpen, List, ArrowUp } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { updateSystemConfig as _updateSystemConfig } from '@/lib/supabase/actions';
import { safe } from '@/lib/supabase/safe-action';
import { cn } from '@/lib/utils';

const updateSystemConfig = safe(_updateSystemConfig);

interface TocItem {
    level: number;
    text: string;
    id: string;
}

function generateSlug(text: string): string {
    return text.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, '-').replace(/(^-|-$)/g, '') || 'section';
}

function parseToc(markdown: string): TocItem[] {
    const items: TocItem[] = [];
    const lines = markdown.split('\n');
    for (const line of lines) {
        const match = line.match(/^(#{1,3})\s+(.+)$/);
        if (match) {
            const level = match[1].length;
            const text = match[2].trim();
            const id = generateSlug(text);
            items.push({ level, text, id });
        }
    }
    return items;
}

function MarkdownRenderer({ content }: { content: string }) {
    const components = useMemo(() => ({
        h1: ({ children, ...props }: any) => <h1 id={generateSlug(String(children))} className="scroll-mt-20" {...props}>{children}</h1>,
        h2: ({ children, ...props }: any) => <h2 id={generateSlug(String(children))} className="scroll-mt-20" {...props}>{children}</h2>,
        h3: ({ children, ...props }: any) => <h3 id={generateSlug(String(children))} className="scroll-mt-20" {...props}>{children}</h3>,
    }), [content]);
    return (
        <div className="prose prose-sm prose-invert max-w-none prose-p:my-2 prose-ul:my-2 prose-li:my-0.5 prose-headings:mt-6 prose-headings:mb-2 prose-h1:text-xl prose-h2:text-lg prose-h3:text-base prose-a:text-blue-400 prose-table:text-sm prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-hr:my-6">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content}</ReactMarkdown>
        </div>
    );
}

interface GuidePageClientProps {
    initialMarkdown: string;
    isAdmin: boolean;
}

export function GuidePageClient({ initialMarkdown, isAdmin }: GuidePageClientProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [markdown, setMarkdown] = useState(initialMarkdown);
    const [isPending, startTransition] = useTransition();
    const [showToc, setShowToc] = useState(false);
    const [showBackToTop, setShowBackToTop] = useState(false);
    const router = useRouter();

    useEffect(() => {
        const onScroll = () => setShowBackToTop(window.scrollY > 300);
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    const toc = useMemo(() => parseToc(isEditing ? markdown : initialMarkdown), [isEditing, markdown, initialMarkdown]);
    const displayMarkdown = isEditing ? markdown : initialMarkdown;

    const handleSave = () => {
        startTransition(async () => {
            try {
                const res = await updateSystemConfig([{ key: 'user_guide', value: markdown }]);
                if (res.success) {
                    toast.success('使用說明已儲存');
                    setIsEditing(false);
                    router.refresh();
                } else {
                    toast.error(res.message);
                }
            } catch (err: any) {
                toast.error(err.message);
            }
        });
    };

    const handleCancel = () => {
        setMarkdown(initialMarkdown);
        setIsEditing(false);
    };

    const scrollTo = (id: string) => {
        setShowToc(false);
        // Wait for TOC panel to collapse before calculating scroll position
        requestAnimationFrame(() => {
            setTimeout(() => {
                const el = document.getElementById(id);
                if (el) {
                    const headerOffset = 80;
                    const top = el.getBoundingClientRect().top + window.scrollY - headerOffset;
                    window.scrollTo({ top, behavior: 'smooth' });
                }
            }, 50);
        });
    };

    return (
        <div className="container max-w-5xl py-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-1 -ml-2">
                    <Button variant="ghost" size="icon" asChild className="rounded-full h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground">
                        <Link href="/dashboard"><ChevronLeft className="h-6 w-6" /></Link>
                    </Button>
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-white flex items-center justify-center text-black shrink-0 shadow-sm border border-muted/20">
                            <BookOpen className="h-5 w-5" />
                        </div>
                        <div className="space-y-0.5 select-none">
                            <h1 className="text-2xl font-bold tracking-tight leading-none text-foreground">使用說明</h1>
                            <p className="text-[13px] text-muted-foreground font-medium">系統功能與操作指南</p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* TOC toggle for mobile */}
                    {!isEditing && toc.length > 0 && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="lg:hidden font-bold"
                            onClick={() => setShowToc(!showToc)}
                        >
                            <List className="h-4 w-4 mr-1.5" />
                            目錄
                        </Button>
                    )}

                    {isAdmin && !isEditing && (
                        <Button variant="outline" size="sm" className="font-bold" onClick={() => setIsEditing(true)}>
                            <Edit2 className="h-4 w-4 mr-1.5" />
                            編輯
                        </Button>
                    )}
                    {isEditing && (
                        <>
                            <Button variant="ghost" size="sm" className="font-bold" onClick={handleCancel}>
                                <X className="h-4 w-4 mr-1.5" />
                                取消
                            </Button>
                            <Button size="sm" className="font-bold" onClick={handleSave} disabled={isPending}>
                                <Save className="h-4 w-4 mr-1.5" />
                                {isPending ? '儲存中...' : '儲存'}
                            </Button>
                        </>
                    )}
                </div>
            </div>

            {/* Mobile TOC dropdown */}
            {showToc && !isEditing && (
                <div className="lg:hidden rounded-xl border border-muted/50 bg-muted/10 p-4 space-y-1">
                    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-2">目錄</p>
                    {toc.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => scrollTo(item.id)}
                            className={cn(
                                "block w-full text-left text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-1",
                                item.level === 1 && "font-bold text-foreground",
                                item.level === 2 && "pl-4",
                                item.level === 3 && "pl-8 text-xs"
                            )}
                        >
                            {item.text}
                        </button>
                    ))}
                </div>
            )}

            {/* Content */}
            {isEditing ? (
                /* Edit mode: side by side */
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-[60vh]">
                    <div className="space-y-2">
                        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Markdown 編輯器</p>
                        <textarea
                            value={markdown}
                            onChange={(e) => setMarkdown(e.target.value)}
                            className="w-full h-[70vh] resize-none rounded-xl border border-muted/50 bg-muted/5 p-4 font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
                            placeholder="在此輸入 Markdown 內容..."
                        />
                    </div>
                    <div className="space-y-2">
                        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">即時預覽</p>
                        <div className="h-[70vh] overflow-y-auto rounded-xl border border-muted/50 bg-muted/5 p-6">
                            <MarkdownRenderer content={markdown} />
                        </div>
                    </div>
                </div>
            ) : (
                /* View mode: TOC sidebar + content */
                <div className="flex gap-8">
                    {/* Desktop TOC sidebar */}
                    {toc.length > 0 && (
                        <aside className="hidden lg:block w-56 shrink-0">
                            <div className="sticky top-20 space-y-1 max-h-[calc(100vh-6rem)] overflow-y-auto">
                                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3">目錄</p>
                                {toc.map((item) => (
                                    <button
                                        key={item.id}
                                        onClick={() => scrollTo(item.id)}
                                        className={cn(
                                            "block w-full text-left text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors py-1 leading-snug",
                                            item.level === 1 && "font-bold text-foreground/80",
                                            item.level === 2 && "pl-3",
                                            item.level === 3 && "pl-6 text-xs"
                                        )}
                                    >
                                        {item.text}
                                    </button>
                                ))}
                            </div>
                        </aside>
                    )}

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                        {displayMarkdown ? (
                            <MarkdownRenderer content={displayMarkdown} />
                        ) : (
                            <div className="text-center py-24 border-2 border-dashed border-muted rounded-2xl bg-muted/5">
                                <BookOpen className="h-10 w-10 mx-auto mb-4 opacity-10" />
                                <p className="text-muted-foreground font-bold">尚未建立使用說明</p>
                                {isAdmin && (
                                    <Button variant="outline" className="mt-4 font-bold" onClick={() => setIsEditing(true)}>
                                        <Edit2 className="h-4 w-4 mr-1.5" />
                                        開始編輯
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Back to top FAB */}
            {showBackToTop && (
                <button
                    onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                    className="fixed bottom-20 md:bottom-8 right-4 z-40 h-10 w-10 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-all active:scale-95"
                    title="回到頂部"
                >
                    <ArrowUp className="h-5 w-5" />
                </button>
            )}
        </div>
    );
}
