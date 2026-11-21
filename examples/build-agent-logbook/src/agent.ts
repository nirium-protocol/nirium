import type { ToolCall } from './entry.js';

/**
 * Any agent framework fits here: it only has to report the tool calls it made
 * and its final answer. The demo below is a small rule-based tool-calling
 * agent so the example runs offline and deterministically; swap in LangChain,
 * the OpenAI Agents SDK, a local model, etc. by implementing `AgentRunner`.
 */
export interface AgentRunner {
  run(prompt: string): Promise<{ toolCalls: ToolCall[]; output: string }>;
}

type Tool = (input: string) => unknown;

const TOOLS: Record<string, Tool> = {
  calculator: (expr) => {
    if (!/^[\d\s+\-*/().]+$/.test(expr)) throw new Error('calculator accepts arithmetic only');
    // eslint-disable-next-line no-new-func
    return Function(`"use strict"; return (${expr});`)() as number;
  },
  word_count: (text) => text.trim().split(/\s+/).filter(Boolean).length,
  days_between: (text) => {
    const [a, b] = text.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    if (!a || !b) throw new Error('need two YYYY-MM-DD dates');
    return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
  },
  celsius_to_fahrenheit: (text) => {
    const c = Number(text.match(/-?\d+(\.\d+)?/)?.[0]);
    if (Number.isNaN(c)) throw new Error('no temperature found');
    return Math.round((c * 9 / 5 + 32) * 10) / 10;
  },
  redact_contact: (text) =>
    text.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]').replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone]'),
};

function route(prompt: string): { tool: string; input: string } {
  const p = prompt.toLowerCase();
  const quoted = prompt.match(/"([^"]+)"/)?.[1];
  if (p.includes('redact')) return { tool: 'redact_contact', input: quoted ?? prompt };
  if (p.includes('how many words')) return { tool: 'word_count', input: quoted ?? prompt };
  if (p.includes('days between')) return { tool: 'days_between', input: prompt };
  if (p.includes('fahrenheit')) return { tool: 'celsius_to_fahrenheit', input: prompt };
  const expr = prompt.match(/[\d\s+\-*/().]{3,}/)?.[0]?.trim();
  if (expr) return { tool: 'calculator', input: expr };
  throw new Error(`no tool can handle: ${prompt}`);
}

export class RuleBasedAgent implements AgentRunner {
  async run(prompt: string) {
    const { tool, input } = route(prompt);
    const output = TOOLS[tool](input);
    const toolCalls: ToolCall[] = [{ tool, input, output }];
    return { toolCalls, output: `${tool} -> ${typeof output === 'string' ? output : JSON.stringify(output)}` };
  }
}

/** Five demo tasks. Task 5 deliberately contains personal data (an email and a phone number). */
export const DEMO_TASKS: string[] = [
  'What is (1250 * 4) / 8 + 17?',
  'How many words are in "agents should leave receipts for the work they do"?',
  'How many days between 2026-11-18 and 2026-11-25?',
  'Convert 21.5 celsius to fahrenheit.',
  'Redact the contact details in "Call Maria Lopez at +1 415 555 0134 or maria.lopez@example.com about the invoice".',
];
