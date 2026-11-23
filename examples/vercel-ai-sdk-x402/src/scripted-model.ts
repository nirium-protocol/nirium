import { MockLanguageModelV4 } from 'ai/test';

import type { PaidFetchResult } from './x402-tool.js';

export interface ScriptedModelOptions {
  cheapUrl: string;
  expensiveUrl: string;
  toolName?: string;
}

/**
 * A deterministic stand-in for a chat model. It makes the same two tool calls
 * a model would make, reads the real tool results, and writes a final answer
 * from them. Used by `npm test` and by `npm run demo` when no model API key is
 * set, so the tool loop can be shown without a network model call.
 */
export function createScriptedModel({
  cheapUrl,
  expensiveUrl,
  toolName = 'payForUrl',
}: ScriptedModelOptions) {
  return new MockLanguageModelV4({
    modelId: 'nirium-scripted-x402-demo',
    doGenerate: async ({ prompt }) => {
      const results = toolResults(prompt);
      if (results.length === 0) {
        return toolCall('call-cheap', toolName, { url: cheapUrl, method: 'GET' });
      }
      if (results.length === 1) {
        return toolCall('call-expensive', toolName, { url: expensiveUrl, method: 'GET' });
      }
      return text(finalAnswer(results));
    },
  });
}

function finalAnswer(results: PaidFetchResult[]): string {
  const paid = results.find((r) => r.ok);
  const refused = results.find((r) => r.refused);
  const lines: string[] = [];
  if (paid?.settlementTx) {
    lines.push(`I paid the market summary. Settlement transaction: ${paid.settlementTx}.`);
  } else if (paid) {
    lines.push('The market summary request returned a response, but no settlement transaction was reported.');
  } else {
    lines.push('The market summary request did not settle.');
  }
  if (refused) {
    lines.push(`The full report was not paid. ${refused.reason ?? 'The payment was refused.'}`);
  }
  return lines.join(' ');
}

function toolResults(prompt: unknown): PaidFetchResult[] {
  if (!Array.isArray(prompt)) return [];
  const results: PaidFetchResult[] = [];
  for (const message of prompt) {
    if (!message || typeof message !== 'object') continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const record = part as { type?: unknown; output?: { type?: unknown; value?: unknown } };
      if (record.type !== 'tool-result' || !record.output) continue;
      const value = record.output.value;
      if (value && typeof value === 'object') results.push(value as PaidFetchResult);
    }
  }
  return results;
}

function toolCall(toolCallId: string, toolName: string, input: Record<string, unknown>) {
  return {
    content: [{ type: 'tool-call' as const, toolCallId, toolName, input: JSON.stringify(input) }],
    finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
    usage: usage(),
    warnings: [],
  };
}

function text(value: string) {
  return {
    content: [{ type: 'text' as const, text: value }],
    finishReason: { unified: 'stop' as const, raw: 'stop' },
    usage: usage(),
    warnings: [],
  };
}

function usage() {
  return {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  };
}
