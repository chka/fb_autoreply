export const TONES = ['Polite', 'Nice', 'Information', 'Bad', 'Ugly', 'Curse'];
export const LENGTHS = ['Short', 'Medium', 'Long'];
export const MAX_TOKENS = { Short: 120, Medium: 400, Long: 800 };

const BASE = `You are drafting a reply on behalf of the user. Output only the reply text. No preamble, no quotes, no markdown headings, no signature. Match the language of the target post. Do not use em-dashes; use periods or commas instead.`;

const TONE_TEXT = {
  Polite:      `Tone: courteous and formal. No contractions, no slang, no jabs. Address the target's point directly and respectfully.`,
  Nice:        `Tone: warm, supportive, casual, light positivity. Avoid sycophancy. Sound like a friendly human, not a corporate account.`,
  Information: `Tone: factual and neutral. You will be given a RESEARCH block with up to three search snippets numbered [1], [2], [3]. Cite them inline as [1] / [2] / [3] when you use their facts. No opinions, no hedging. If the snippets disagree or the question is unanswerable from them, say so.`,
  Bad:         `Tone: disagreeable, dismissive, sharp. Push back on the target's claim. No slurs, no threats, no profanity.`,
  Ugly:        `Tone: harsh, condescending, sarcastic. Jab at the argument, not the person's identity. No slurs, no threats, no profanity.`,
  Curse:       `Tone: vulgar, hostile, mocking. Profanity is encouraged. Hard rules: no slurs, no threats of violence, no doxing, no targeting of protected characteristics. Be rude, not abusive.`,
};

const LENGTH_TEXT = {
  Short:  `Length: STRICT 255-character ceiling. One sentence preferred. Count characters before finalising.`,
  Medium: `Length: 50–80 words, 2–3 sentences.`,
  Long:   `Length: 150+ words, intentionally repetitive and over-explained. Design goal: annoying to read. Restate the same point three or four different ways.`,
};

const PLATFORM_TEXT = {
  x:  `Platform: X (Twitter). No hashtags unless the target uses them. No @-mentions except the OP handle if naturally needed.`,
  fb: `Platform: Facebook. Slightly more conversational than X. Line breaks are fine.`,
};

export function buildSystemPrompt({ tone, length, platform, research }) {
  if (!TONE_TEXT[tone]) throw new Error(`unknown tone: ${tone}`);
  if (!LENGTH_TEXT[length]) throw new Error(`unknown length: ${length}`);
  if (!PLATFORM_TEXT[platform]) throw new Error(`unknown platform: ${platform}`);

  const parts = [BASE, TONE_TEXT[tone], LENGTH_TEXT[length], PLATFORM_TEXT[platform]];

  if (tone === 'Information') {
    if (Array.isArray(research) && research.length > 0) {
      const lines = research.slice(0, 3).map((r, i) =>
        `[${i + 1}] ${r.title} :: ${r.url}\n    ${r.snippet}`);
      parts.push(`RESEARCH:\n${lines.join('\n')}`);
    } else {
      parts.push(`(no search results. answer from general knowledge or say you cannot)`);
    }
  }

  return parts.join('\n\n');
}

export function buildUserMessage(ctx) {
  const noun = ctx.kind === 'comment' ? 'comment' : 'post';
  const ctxJson = JSON.stringify({
    platform: ctx.platform,
    kind: ctx.kind,
    target: ctx.target,
    thread: ctx.thread || [],
    url: ctx.url,
  }, null, 2);
  return `Context:\n\`\`\`json\n${ctxJson}\n\`\`\`\n\nReply to the 'target' ${noun}.`;
}
