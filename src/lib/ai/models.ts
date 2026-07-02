export type ProviderKey = 'groq' | 'openrouter';

export interface ChatModel {
  id: string;
  modelId: string;
  provider: ProviderKey;
  label: string;
  rateLimit: string;
}

export interface ProviderGroup {
  key: ProviderKey;
  label: string;
  rateLimit: string;
  models: ChatModel[];
}

const PROVIDERS: Record<ProviderKey, { label: string; rateLimit: string; envKey: string }> = {
  groq: { label: 'Groq', rateLimit: '30 req/min', envKey: 'GROQ_API_KEY' },
  openrouter: { label: 'OpenRouter', rateLimit: '~20 req/min', envKey: 'OPENROUTER_API_KEY' },
};

const PROVIDER_ORDER: ProviderKey[] = ['groq', 'openrouter'];

const ALL_MODELS: ChatModel[] = [
  // Groq Free — weak → strong
  { id: 'groq::llama-3.1-8b-instant', modelId: 'llama-3.1-8b-instant', provider: 'groq', label: 'Llama 3.1 8B', rateLimit: '30 req/min · 14400/day' },
  { id: 'groq::llama-3.3-70b-versatile', modelId: 'llama-3.3-70b-versatile', provider: 'groq', label: 'Llama 3.3 70B', rateLimit: '30 req/min · 1000/day' },
  // OpenRouter Free — weak → strong
  { id: 'openrouter::google/gemma-4-31b-it:free', modelId: 'google/gemma-4-31b-it:free', provider: 'openrouter', label: 'Gemma 4 31B', rateLimit: '~20 req/min · 200/day' },
];

export function getAvailableGroups(): ProviderGroup[] {
  return PROVIDER_ORDER
    .filter((key) => !!process.env[PROVIDERS[key].envKey])
    .map((key) => ({
      key,
      label: PROVIDERS[key].label,
      rateLimit: PROVIDERS[key].rateLimit,
      models: ALL_MODELS.filter((m) => m.provider === key),
    }))
    .filter((g) => g.models.length > 0);
}

export function getDefaultModelId(): string {
  const groups = getAvailableGroups();
  for (const g of groups) {
    const preferred = g.models.find((m) => m.modelId === 'llama-3.3-70b-versatile');
    if (preferred) return preferred.id;
  }
  return groups[0]?.models[0]?.id ?? '';
}

export function findModel(id: string): ChatModel | undefined {
  return ALL_MODELS.find((m) => m.id === id);
}

export function isAllowedModel(id: string | undefined | null): id is string {
  if (!id) return false;
  const model = findModel(id);
  if (!model) return false;
  const envKey = PROVIDERS[model.provider]?.envKey;
  return !!envKey && !!process.env[envKey];
}
