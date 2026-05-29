export function buildQuery({ text = '', author = '' }) {
  const head = String(text).slice(0, 200).replace(/\s+/g, ' ').trim();
  const a = String(author).trim();
  return a ? `${head} ${a}`.trim() : head;
}

export function parseResults(html) {
  if (!html || typeof html !== 'string') return [];
  let doc;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return [];
  }
  const anchors = doc.querySelectorAll('a.result__a');
  const out = [];
  for (const a of anchors) {
    if (out.length >= 3) break;
    const title = (a.textContent || '').trim();
    let url = a.getAttribute('href') || '';
    const m = url.match(/[?&]uddg=([^&]+)/);
    if (m) { try { url = decodeURIComponent(m[1]); } catch {} }
    if (!url || !title) continue;
    const result = a.closest('.result');
    const snippetEl = result && result.querySelector('.result__snippet');
    const snippet = (snippetEl?.textContent || '').replace(/\s+/g, ' ').trim();
    out.push({ title, url, snippet });
  }
  return out;
}

export async function searchDDG(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!resp.ok) return [];
    return parseResults(await resp.text());
  } catch {
    return [];
  }
}
