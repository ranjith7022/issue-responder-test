/**
 * Thin client for GitHub Models (https://models.github.ai).
 *
 * Authenticates with the workflow's built-in GITHUB_TOKEN — no third-party
 * API keys needed. Requires the `models: read` permission in the workflow.
 * Free tier applies (rate limits vary per model).
 */

const MODELS_URL = "https://models.github.ai/inference/chat/completions";

/**
 * Send a chat-completion request and return the assistant's reply text.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {{model?: string, temperature?: number, maxTokens?: number}} [opts]
 * @returns {Promise<string>}
 */
async function chat(messages, opts = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required to call GitHub Models.");

  const model = opts.model || process.env.GITHUB_MODEL || "openai/gpt-4o-mini";

  const res = await fetch(MODELS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 1200,
    }),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 600);
    throw new Error(
      `GitHub Models request failed (${res.status} ${res.statusText}): ${detail}`
    );
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("GitHub Models returned an empty response.");
  return content;
}

module.exports = { chat };
