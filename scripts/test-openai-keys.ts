/**
 * Throwaway: verify OPENAI_API_KEY / LLM_API_KEY works.
 * Run: npx tsx scripts/test-openai-keys.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { llmText } from '../src/lib/llm';

async function main() {
  console.log('OPENAI_API_KEY present:', Boolean(process.env.OPENAI_API_KEY));
  console.log('LLM_API_KEY present:', Boolean(process.env.LLM_API_KEY));
  console.log('LLM_MODEL:', process.env.LLM_MODEL || '(default gpt-4o-mini)');

  const reply = await llmText({
    system: 'Reply with exactly the word ok and nothing else.',
    user: 'ping',
    maxTokens: 10,
    temperature: 0,
  });

  console.log('LLM reply:', reply.trim());
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
