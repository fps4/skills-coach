/**
 * The model call: one request per word, answered in `cardSchema` (ADR-0034).
 *
 * This is the only model client in the repository, and it lives outside `api/` on purpose
 * (ADR-0001): the runtime holds the question, this answers it through `/coach/v1` like any coach.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { SYSTEM_PROMPT, cardSchema, userMessage, type Card, type QueuedTermRequest } from './card.js';

export class CardRefusedError extends Error {}

export interface CardWriter {
  write(request: QueuedTermRequest): Promise<Card>;
}

export class ClaudeCardWriter implements CardWriter {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
  }

  async write(request: QueuedTermRequest): Promise<Card> {
    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 16_000,
      // A card is a short, well-specified answer; `medium` is Opus 5.5's default, stated so a change
      // of default does not change the cost of every word silently.
      output_config: { effort: 'medium', format: betaZodOutputFormat(cardSchema) },
      // A decline is retried on the model the API picks for that kind of decline, inside this call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage(request) }],
    });

    if (response.stop_reason === 'refusal') throw new CardRefusedError('the model declined this word');
    if (!response.parsed_output) throw new Error(`no card in the response (stop_reason ${response.stop_reason})`);
    return response.parsed_output;
  }
}
