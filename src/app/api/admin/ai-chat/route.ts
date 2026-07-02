/**
 * 管理員「AI 資料助理」API（唯讀查資料庫、僅限幹部）。
 *
 * Unified free-tier model selector: Groq + OpenRouter models available simultaneously.
 * Key optimization: buildDataSnapshot() pre-fetches aggregate stats server-side and
 * injects them into the system prompt, eliminating 3-6 "schema exploration" tool calls.
 *
 * Security: admin role verified before any data access. Snapshot queries are hardcoded
 * SQL with no user-input interpolation. runQuery tool validates read-only SQL.
 */
import { streamText, convertToModelMessages, stepCountIs, type UIMessage, type LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGroq } from '@ai-sdk/groq';
import { getServerProfile } from '@/lib/supabase/server';
import { runQueryTool } from '@/lib/ai/query-tool';
import { SYSTEM_PROMPT } from '@/lib/ai/schema-context';
import { buildDataSnapshot } from '@/lib/ai/snapshot';
import { findModel, isAllowedModel, getDefaultModelId, type ProviderKey } from '@/lib/ai/models';

export const maxDuration = 60;

function resolveModel(key: ProviderKey, modelId: string): LanguageModel {
  switch (key) {
    case 'groq':
      return createGroq({ apiKey: process.env.GROQ_API_KEY ?? '' })(modelId);
    case 'openrouter':
      return createOpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY ?? '',
      }).chat(modelId);
  }
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(req: Request) {
  const { user, profile } = await getServerProfile();
  if (!user) return json({ error: '請先登入。' }, 401);
  if (profile?.role !== 'admin') return json({ error: '僅限幹部使用此功能。' }, 403);

  const { messages, model }: { messages: UIMessage[]; model?: string } = await req.json();
  const selectedId = isAllowedModel(model) ? model : getDefaultModelId();
  const modelDef = findModel(selectedId);
  if (!modelDef) {
    return json({ error: '無可用的 AI 模型，請設定 API 金鑰。' }, 500);
  }

  const snapshot = await buildDataSnapshot();
  console.info('[ai-chat] provider=%s model=%s snapshot=%d chars', modelDef.provider, modelDef.modelId, snapshot.length);

  const result = streamText({
    model: resolveModel(modelDef.provider, modelDef.modelId),
    system: SYSTEM_PROMPT + snapshot,
    messages: await convertToModelMessages(messages),
    tools: { runQuery: runQueryTool },
    stopWhen: stepCountIs(6),
    maxRetries: 2,
  });

  return result.toUIMessageStreamResponse({
    onError: (error) => {
      console.error('[ai-chat] stream error:', error);
      const message = error instanceof Error ? error.message : String(error);
      if (/quota|rate.?limit|resource_exhausted|too many (?:requests|tokens)|limit exceeded|\b429\b/i.test(message)) {
        return 'API 用量暫時超額，請稍候幾秒再試。';
      }
      if (/unavailable|high demand|overloaded|503|try again later|degraded/i.test(message)) {
        return 'AI 模型暫時忙線，請稍候幾秒再送出一次。';
      }
      if (/provider returned error|\b400\b.*bad request/i.test(message)) {
        return '此模型暫時無法使用，請切換其他模型重試。';
      }
      return process.env.NODE_ENV === 'development' ? message : '操作失敗，請稍後再試。';
    },
  });
}
