// Optional: ask Claude which view each numbered figure on a sheet shows.
// The request goes straight from the browser to Anthropic with the visitor's
// own API key. A hosted version of Draft3D should send it through its server.

const VIEWS = ['front', 'back', 'left', 'right', 'top', 'bottom', 'three_quarter', 'other'];

const SCHEMA = {
  type: 'object',
  properties: {
    figures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          view: { type: 'string', enum: VIEWS },
          note: { type: 'string' },
        },
        required: ['index', 'view', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['figures'],
  additionalProperties: false,
};

const PROMPT = (count) => `This is a character turnaround sheet. Each of the ${count} figures has a red number above it.

For every numbered figure, say which orthographic view it shows:
- front: we see the character's face and chest.
- back: we see the back of the head and body.
- left: side view seen from the viewer's left. The character faces toward the RIGHT edge of the image.
- right: side view seen from the viewer's right. The character faces toward the LEFT edge of the image.
- top: seen from directly above.
- bottom: seen from directly below.
- three_quarter: turned partway between front and side.
- other: not a full-body view (close-ups, props, colour swatches).

Use each of front, back, left, right, top and bottom at most once; if two figures could be the same view, give the clearer one that view and mark the other "other". Keep each note under 15 words.`;

function toBase64Jpeg(canvas) {
  return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
}

export async function labelWithClaude(apiKey, sheetCanvas, count) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let response;
  try {
    response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: toBase64Jpeg(sheetCanvas) } },
          { type: 'text', text: PROMPT(count) },
        ],
      }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('Claude rejected the API key. Check it and try again.');
    if (err instanceof Anthropic.RateLimitError) throw new Error('Claude is rate limiting this key. Wait a minute and try again.');
    if (err instanceof Anthropic.APIConnectionError) throw new Error('Could not reach Claude. Check your connection.');
    if (err instanceof Anthropic.APIError) throw new Error(`Claude returned an error (${err.status}). ${err.message}`);
    throw err;
  }
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to label this image.');
  if (response.stop_reason === 'max_tokens') throw new Error('Claude ran out of room before finishing. Try again.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const parsed = JSON.parse(text);
  // Map Claude's labels onto the app's choices.
  return parsed.figures.map((f) => ({
    index: f.index,
    view: ['front', 'back', 'left', 'right', 'top', 'bottom'].includes(f.view) ? f.view : 'skip',
    note: f.view === 'three_quarter' ? `3/4 view. ${f.note}` : f.note,
  }));
}
