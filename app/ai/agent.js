// Agent loop: messages + tools, parse tool_calls, execute, feed back, write into trip, max iterations.

import { chat } from './transport.js';
import { toolSchemas, dispatchTool } from './tools.js';
import { systemPrompt, userPlanMessage } from './prompt.js';
import { aiConfig } from '../settings.js';
import { saveConversation } from '../store.js';
import { uid } from '../utils/id.js';

/**
 * Run the planning agent.
 * @param {object} trip  - the trip document
 * @param {string} instruction - user instruction text
 * @param {object} handlers
 *   - onMessage({role, content})        assistant/chat text to render
 *   - onTool({name, label, detail})     tool activity status line
 *   - onCitations([urls])
 *   - onDone({iterations, stoppedReason})
 *   - onError(error)  typed error from ollama
 */
export async function runAgent(trip, instruction, handlers = {}) {
  if (!trip) { handlers.onError?.({ kind: 'http', message: 'No trip selected.' }); return; }
  const cfg = aiConfig();
  const { onMessage, onTool, onCitations, onDone, onError } = handlers;

  const messages = [...systemPrompt(trip), userPlanMessage(instruction)];
  const conversationId = uid();
  const allCitations = [];

  let iterations = 0;
  let stoppedReason = 'limit'; // assume we ran until the cap; overridden when the model stops on its own

  while (iterations < cfg.maxIterations) {
    iterations++;
    const res = await chat({ messages, tools: toolSchemas(trip), model: cfg.model, numCtx: cfg.numCtx });
    if (!res.ok) { onError?.(res.error); stoppedReason = 'error'; break; }

    const choice = res.data?.choices?.[0];
    const msg = choice?.message || {};
    // Preserve the assistant message (with tool_calls) in the transcript.
    const assistantMsg = { role: 'assistant', content: msg.content || null, tool_calls: msg.tool_calls || undefined };
    messages.push(assistantMsg);

    if (msg.content) onMessage?.({ role: 'assistant', content: msg.content });

    const toolCalls = msg.tool_calls || [];
    if (!toolCalls.length) {
      stoppedReason = 'done';
      break;
    }

    for (const call of toolCalls) {
      const toolCallId = call.id || call.function?.name;
      const out = await dispatchTool(call, trip.id, { onTool });
      if (out.citations) allCitations.push(...out.citations);
      messages.push({ role: 'tool', tool_call_id: toolCallId, name: out.name, content: out.content });
    }
    if (allCitations.length) onCitations?.(allCitations);
    // loop continues: model sees tool results and decides next.
  }

  if (stoppedReason === 'limit') {
    onMessage?.({ role: 'system', content: 'Reached the agent iteration limit. Stopping — review the itinerary and ask for more if needed.' });
  }

  await saveConversation({ id: conversationId, tripId: trip.id, messages });
  onDone?.({ iterations, stoppedReason, conversationId });
}