const THREAT_PATTERNS = [
  /\b(i|we|im|i'?ll|we'?ll)\s+(will\s+)?(kill|murder|stab|shoot|hurt|beat|find|hunt|destroy)\s+(you|him|her|them)\b/i,
  /\b(kill|murder)\s+(you|him|her|them|yourself|himself|herself|themselves)\b/i,
  /\bgoing\s+to\s+(kill|murder|hurt|find)\b/i,
];

const DOXING_PATTERNS = [
  /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/,
  /\b\d{1,5}\s+[A-Z][a-z]+\s+(Street|St|Avenue|Ave|Road|Rd|Terrace|Boulevard|Blvd|Lane|Ln|Drive|Dr)\b/,
  /\b(ssn|social\s+security)[:\s]+\d{3}-?\d{2}-?\d{4}\b/i,
];

const SLUR_LIST = [
  '<SLUR_PLACEHOLDER>',
  // Real list assembled at install-time by user from hatebase or equivalent;
  // intentionally not checked into the public spec. Add via lib/safety.local.js if needed.
];

export function checkDraft(text) {
  const t = String(text || '');
  for (const re of THREAT_PATTERNS) {
    if (re.test(t)) return { ok: false, reason: 'threat of violence detected' };
  }
  for (const re of DOXING_PATTERNS) {
    if (re.test(t)) return { ok: false, reason: 'doxing / personal info detected' };
  }
  const lower = t.toLowerCase();
  for (const s of SLUR_LIST) {
    if (lower.includes(s.toLowerCase())) return { ok: false, reason: 'slur detected' };
  }
  return { ok: true };
}
