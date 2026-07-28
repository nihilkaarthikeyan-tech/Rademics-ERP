import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';

export type AiFeature = 'daily_summary' | 'completion_forecast' | 'assignment_suggestion' | 'chat';
export type AiProvider = 'anthropic' | 'openai';

export interface AiFeatureConfig {
  provider: AiProvider;
  model: string;
}
export interface AiConfig {
  dailyLimitPerUser: number;
  features: Record<AiFeature, AiFeatureConfig>;
}

/** Raised when the configured provider has no server-side key — callers degrade gracefully (§25). */
export class AiUnavailableError extends Error {
  constructor(message = 'AI provider not configured') {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

const DEFAULT_FEATURE: AiFeatureConfig = { provider: 'openai', model: 'gpt-5-mini' };
const AI_CONFIG_KEY = 'ai_config';

/**
 * Provider-agnostic AI gateway (Spec §7): one internal interface, adapters per
 * provider (Claude/OpenAI), provider+model chosen per feature in Admin
 * Settings, keys read server-side only. No key → AiUnavailableError so features fall
 * back to their rule-based path (§25). This class does NOT enforce the rate limit —
 * that is the AiService's per-user daily counter (§7, §10).
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  async getConfig(): Promise<AiConfig> {
    const rules = (await this.settings.getBusinessRules()) as Record<string, unknown>;
    const stored = (rules[AI_CONFIG_KEY] as Partial<AiConfig> | undefined) ?? {};
    const features = (stored.features ?? {}) as Partial<Record<AiFeature, AiFeatureConfig>>;
    const feat = (f: AiFeature): AiFeatureConfig => features[f] ?? DEFAULT_FEATURE;
    return {
      dailyLimitPerUser: (rules.aiDailyCallLimitPerUser as number) ?? stored.dailyLimitPerUser ?? 50,
      features: {
        daily_summary: feat('daily_summary'),
        completion_forecast: feat('completion_forecast'),
        assignment_suggestion: feat('assignment_suggestion'),
        chat: feat('chat'),
      },
    };
  }

  private keyFor(provider: AiProvider): string {
    switch (provider) {
      case 'anthropic': return this.config.get<string>('ANTHROPIC_API_KEY', '');
      case 'openai': return this.config.get<string>('OPENAI_API_KEY', '');
    }
  }

  /** Whether the configured provider for a feature has a usable key. */
  async isAvailable(feature: AiFeature): Promise<boolean> {
    const cfg = (await this.getConfig()).features[feature];
    return Boolean(this.keyFor(cfg.provider));
  }

  /** Run a completion for a feature. Throws AiUnavailableError when no key is set. */
  async complete(feature: AiFeature, system: string, prompt: string, maxTokens = 700): Promise<string> {
    const { provider, model } = (await this.getConfig()).features[feature];
    const key = this.keyFor(provider);
    if (!key) throw new AiUnavailableError();
    try {
      switch (provider) {
        case 'anthropic': return await this.anthropic(key, model, system, prompt, maxTokens);
        case 'openai': return await this.openaiCompatible('https://api.openai.com/v1/chat/completions', key, model, system, prompt, maxTokens);
      }
    } catch (err) {
      this.logger.warn(`AI ${provider} call failed: ${(err as Error).message}`);
      throw new AiUnavailableError((err as Error).message);
    }
  }

  /**
   * A conversation in which the model may CALL BACK for data.
   *
   * The alternative — guessing from the question which single query to run, then
   * asking the model to phrase the result — is what the assistant used to do,
   * and it could only ever answer the handful of questions someone had thought
   * to hardcode. "Who came late today?" fell through to the caller's own record.
   *
   * Here the model is handed a menu of read-only tools and picks. We execute
   * each pick through `runTool`, which applies the SAME permission checks as the
   * REST API, so what comes back is already filtered to what this person may
   * see. The model never touches the database and cannot widen its own access.
   *
   * Rounds are capped: a model that keeps calling tools is looping, not working.
   */
  async converse(
    feature: AiFeature,
    system: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    tools: { name: string; description: string; parameters: Record<string, unknown> }[],
    runTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
    maxRounds = 4,
  ): Promise<{ text: string; toolsUsed: string[] }> {
    const { provider, model } = (await this.getConfig()).features[feature];
    const key = this.keyFor(provider);
    // Tool calling is wired for the OpenAI-shaped API only. Anything else falls
    // back to the deterministic path rather than pretending to support it.
    if (!key || provider !== 'openai') throw new AiUnavailableError();

    const isReasoningModel = /^(gpt-5|o\d)/.test(model);
    const convo: Record<string, unknown>[] = [
      { role: 'system', content: system },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const toolDefs = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    const toolsUsed: string[] = [];

    try {
      for (let round = 0; round < maxRounds; round++) {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            ...(isReasoningModel
              ? { max_completion_tokens: 1200, reasoning_effort: 'minimal' }
              : { max_tokens: 1200 }),
            messages: convo,
            tools: toolDefs,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const json = (await res.json()) as {
          choices?: { message?: { content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
        };
        const msg = json.choices?.[0]?.message;
        if (!msg) throw new Error('empty response');

        const calls = msg.tool_calls ?? [];
        if (calls.length === 0) {
          return { text: msg.content ?? '', toolsUsed };
        }

        convo.push(msg as unknown as Record<string, unknown>);
        for (const call of calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
          } catch {
            /* a malformed argument blob is the model's error to recover from */
          }
          let result: unknown;
          try {
            result = await runTool(call.function.name, args);
            toolsUsed.push(call.function.name);
          } catch (err) {
            // Hand refusals back as data. A tool the caller may not use is a
            // fact the model should relay, not a crash.
            result = { error: (err as Error).message };
          }
          convo.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result ?? null).slice(0, 12_000),
          });
        }
      }
      // Out of rounds: answer from whatever was gathered rather than silently
      // returning nothing.
      return { text: '', toolsUsed };
    } catch (err) {
      this.logger.warn(`AI converse failed: ${(err as Error).message}`);
      throw new AiUnavailableError((err as Error).message);
    }
  }

  private async anthropic(key: string, model: string, system: string, prompt: string, maxTokens: number): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { content?: { text?: string }[] };
    return json.content?.map((c) => c.text ?? '').join('') ?? '';
  }

  private async openaiCompatible(url: string, key: string, model: string, system: string, prompt: string, maxTokens: number): Promise<string> {
    // GPT-5-era models reject `max_tokens` (want `max_completion_tokens`) and spend
    // budget on reasoning unless told not to — these are short factual rewrites.
    const isReasoningModel = /^(gpt-5|o\d)/.test(model);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        ...(isReasoningModel
          ? { max_completion_tokens: maxTokens, reasoning_effort: 'minimal' }
          : { max_tokens: maxTokens }),
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content ?? '';
  }
}
