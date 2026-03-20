export function esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function hlMark(text, q) {
  const t = text || '';
  if (!q) return esc(t);
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(t);
  return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length));
}

export function normalizeUrl(url) {
  if (!url) return '';
  let u = url.trim();
  if (u.indexOf('chat/completions') < 0) {
    if (!u.endsWith('/')) u += '/';
    u += 'chat/completions';
  }
  return u;
}
