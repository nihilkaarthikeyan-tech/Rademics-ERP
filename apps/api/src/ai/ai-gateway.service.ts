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

const DEFAULT_FEATURE: AiFeatureConfig = { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' };
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
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content ?? '';
  }
}
