/**
 * LLM API client for text generation
 */

export interface LLMTextOptions {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Call LLM API to generate text
 * Supports OpenAI-compatible APIs via environment variable
 */
export async function llmText(options: LLMTextOptions): Promise<string> {
  const {
    system,
    user,
    model = process.env.LLM_MODEL || 'gpt-4o-mini',
    temperature = 0.3,
    maxTokens = 4000,
  } = options;

  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  const apiUrl = process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions';

  if (!apiKey) {
    throw new Error(
      'LLM API key not found. Please set OPENAI_API_KEY or LLM_API_KEY environment variable.'
    );
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `LLM API error: ${response.status} ${response.statusText}. ${JSON.stringify(errorData)}`
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No content in LLM response');
    }

    return content;
  } catch (error: any) {
    if (error.message.includes('API key')) {
      throw error;
    }
    throw new Error(`Failed to call LLM API: ${error.message}`);
  }
}

