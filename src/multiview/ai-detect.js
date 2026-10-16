// Optional: ask Claude to find each view on a turnaround sheet and name it.
// The request goes straight from the browser to Anthropic with the visitor's
// own API key. A hosted version of Draft3D should send it through its server.

const VIEWS = ['front', 'back', 'left', 'right', 'top', 'bottom', 'three_quarter', 'other'];

const box = { type: 'integer', minimum: 0, maximum: 1000 };
const SCHEMA = {
  type: 'object',
  properties: {
    figures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          view: { type: 'string', enum: VIEWS },
          x0: box,
          y0: box,
          x1: box,
          y1: box,
          note: { type: 'string' },
        },
        required: ['view', 'x0', 'y0', 'x1', 'y1', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['figures'],
  additionalProperties: false,
};

const PROMPT = `This image is a character turnaround or model sheet. Find every full-body drawing of the character and say which orthographic view each one shows.

Views:
- front: we see the character's face and chest.
- back: we see the back of the head and body.
- left: side view seen from the viewer's left. The character faces toward the RIGHT edge of the image.
- right: side view seen from the viewer's right. The character faces toward the LEFT edge of the image.
- top: seen from directly above.
- bottom: seen from directly below.
- three_quarter: turned partway between front and side.
- other: anything else that is a separate drawing of the character, such as a different pose.

Skip text, colour swatches, close-ups of faces or hands, and props drawn on their own.

For each drawing give a bounding box around the whole figure, including hair, hands, feet and anything it holds, as integers from 0 to 1000 relative to the image: x0 and x1 from the left edge, y0 and y1 from the top edge. Boxes should be tight but must not cut off any part of the figure.

Use each of front, back, left, right, top and bottom at most once; if two drawings could be the same view, give the clearer one that view and mark the other "other". List figures left to right, top row first. Keep each note under 15 words.`;

function toBase64Jpeg(canvas) {
  return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
}

// Returns [{ view, box: {x0, y0, x1, y1} in 0..1 of the image, note }].
export async function detectWithClaude(apiKey, sheetCanvas) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let response;
  try {
    response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: toBase64Jpeg(sheetCanvas) } },
          { type: 'text', text: PROMPT },
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
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to read this image.');
  if (response.stop_reason === 'max_tokens') throw new Error('Claude ran out of room before finishing. Try again.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const parsed = JSON.parse(text);
  // Map Claude's views onto the app's choices.
  return parsed.figures
    .filter((f) => f.x1 > f.x0 && f.y1 > f.y0)
    .map((f) => ({
      view: ['front', 'back', 'left', 'right', 'top', 'bottom'].includes(f.view) ? f.view : 'skip',
      box: { x0: f.x0 / 1000, y0: f.y0 / 1000, x1: f.x1 / 1000, y1: f.y1 / 1000 },
      note: f.view === 'three_quarter' ? `3/4 view. ${f.note}` : f.view === 'other' ? `Not a straight view. ${f.note}` : f.note,
    }));
}
