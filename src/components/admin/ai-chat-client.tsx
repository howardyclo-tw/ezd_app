'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState, useRef, useEffect, useCallback, Fragment } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ProviderGroup } from '@/lib/ai/models';
import { Database, Send, Loader2, AlertTriangle, ChevronDown, Square } from 'lucide-react';

const EXAMPLES = [
  '這一期可明老師課程的：社員補課、社員堂卡報名、非社員堂卡報名 各多少？（人次與人頭都列）',
  '各課程目前的堂卡報名人次排行',
  '這個月每堂課的出席率',
];

function stripRawToolXml(text: string): string {
  return text
    .replace(/<\/?(?:function|tool)_?(?:call|response|result)?[^>]*>[\s\S]*?(?:<\/(?:function|tool)_?(?:call|response|result)?[^>]*>)/gi, '')
    .replace(/<\/?(?:function|tool|arguments|parameters|invoke|results?)[^>]*>/gi, '')
    .trim();
}

function ToolPart({ part }: { part: any }) {
  const input = part.input ?? {};
  const output = part.output ?? {};
  const sql: string | undefined = input.sql ?? output.sql;
  const purpose: string | undefined = input.purpose ?? output.purpose;
  const done = part.state === 'output-available';
  const failed = done && output && output.ok === false;

  return (
    <details className="my-2 rounded-lg border border-white/10 bg-black/20 text-xs">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-muted-foreground select-none">
        <Database className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium">查詢資料庫{purpose ? `：${purpose}` : ''}</span>
        {!done && <Loader2 className="h-3 w-3 animate-spin" />}
        {done && !failed && <span className="text-emerald-400">✓ {output.rowCount ?? 0} 筆</span>}
        {failed && <span className="text-red-400">✗ 被拒絕</span>}
        <ChevronDown className="ml-auto h-3.5 w-3.5" />
      </summary>
      <div className="space-y-2 px-3 pb-3">
        {sql && (
          <pre className="overflow-x-auto rounded bg-black/40 p-2 text-[11px] leading-relaxed text-sky-200">
            {sql}
          </pre>
        )}
        {failed && <p className="text-red-400">{output.error}</p>}
        {part.errorText && <p className="text-red-400">{part.errorText}</p>}
      </div>
    </details>
  );
}

interface Props {
  groups: ProviderGroup[];
  defaultModel: string;
}

export function AiChatClient({ groups, defaultModel }: Props) {
  const [model, setModel] = useState<string>(defaultModel);
  const [input, setInput] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [emptyResponse, setEmptyResponse] = useState(false);
  const sendTimeRef = useRef<number>(0);
  const prevBusyRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const allModels = groups.flatMap((g) => g.models);
  const selected = allModels.find((m) => m.id === model);

  const { messages, sendMessage, stop, status, error } = useChat({
    transport: new DefaultChatTransport({ api: '/api/admin/ai-chat' }),
  });

  const busy = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    if (prevBusyRef.current && !busy && !error) {
      const last = messages[messages.length - 1];
      if (last?.role === 'user') {
        setEmptyResponse(true);
      }
    }
    if (busy) {
      setEmptyResponse(false);
    }
    prevBusyRef.current = busy;
  }, [busy, messages, error]);

  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    sendTimeRef.current = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - sendTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, status, error, emptyResponse]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const submit = useCallback((text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    sendMessage({ text: q }, { body: { model } });
    setInput('');
  }, [busy, model, sendMessage]);

  return (
    <div className="flex h-[calc(100dvh-9.5rem)] flex-col gap-3 md:h-[calc(100dvh-5.5rem)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">AI 資料助理</h1>
          <p className="text-xs text-muted-foreground">用自然語言查資料庫（唯讀 · 僅幹部）</p>
          {selected && (
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/70">
              {selected.label} · {selected.rateLimit}
            </p>
          )}
        </div>
        {allModels.length > 1 && (
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="w-[160px] shrink-0 sm:w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g, gi) => (
                <Fragment key={g.key}>
                  {gi > 0 && <SelectSeparator />}
                  <SelectGroup>
                    <SelectLabel>{g.label} · {g.rateLimit}</SelectLabel>
                    {g.models.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </Fragment>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto rounded-xl border border-white/5 bg-[#1A1A1C]/40 p-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <Database className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">問我關於課程、報名、補課、堂卡的問題</p>
            <div className="flex max-w-xl flex-col gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => submit(ex)}
                  className="rounded-lg border border-white/10 px-3 py-2 text-left text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
          >
            <div
              className={
                message.role === 'user'
                  ? 'max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-background'
                  : 'max-w-[90%] rounded-2xl rounded-bl-sm bg-white/5 px-4 py-3'
              }
            >
              {message.parts.map((part: any, i: number) => {
                if (part.type === 'text') {
                  const text = message.role === 'user' ? part.text : stripRawToolXml(part.text);
                  if (!text) return null;
                  return message.role === 'user' ? (
                    <span key={i} className="whitespace-pre-wrap">{text}</span>
                  ) : (
                    <div
                      key={i}
                      className="prose prose-sm prose-invert max-w-none prose-p:my-2 prose-ul:my-1 prose-li:my-0.5 prose-table:text-xs prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1"
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                    </div>
                  );
                }
                if (typeof part.type === 'string' && (part.type.startsWith('tool-') || part.type === 'dynamic-tool')) {
                  return <ToolPart key={i} part={part} />;
                }
                return null;
              })}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>
              處理中…{elapsed > 0 && `（${elapsed}秒）`}
              {elapsed < 5 && '思考與查詢資料庫可能需要數秒'}
              {elapsed >= 5 && elapsed < 30 && '大型模型回應較慢，請耐心等候'}
              {elapsed >= 30 && '仍在等待回應，可按停止重試'}
            </span>
            <button
              type="button"
              onClick={stop}
              className="ml-auto flex items-center gap-1 rounded-md border border-white/10 px-2 py-0.5 text-[11px] hover:bg-white/10 transition-colors"
            >
              <Square className="h-2.5 w-2.5" />
              停止
            </button>
          </div>
        )}

        {error && (
          <div className="sticky bottom-0 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>發生錯誤：{typeof error.message === 'string' ? error.message : (error instanceof Error ? error.message : String(error))}</span>
          </div>
        )}

        {emptyResponse && !error && (
          <div className="sticky bottom-0 flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>模型未回應任何內容。可能模型暫時無法處理此請求，建議換一個模型重試。</span>
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="shrink-0"
      >
        <div className="flex items-end gap-2 rounded-3xl border border-white/10 bg-[#1A1A1C]/80 p-2 pl-4 transition-colors focus-within:border-primary/40">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit(input);
              }
            }}
            rows={1}
            placeholder="輸入問題…"
            className="max-h-[200px] flex-1 resize-none overflow-y-auto bg-transparent py-1.5 text-base leading-6 outline-none placeholder:text-muted-foreground sm:text-sm"
            disabled={busy}
          />
          <Button
            type="submit"
            size="icon"
            className="size-9 shrink-0 rounded-full"
            disabled={busy || !input.trim()}
            aria-label="送出"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground/50">Enter 送出 · Shift+Enter 換行</p>
      </form>
    </div>
  );
}
