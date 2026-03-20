export function lsGet(k)       { try { return localStorage.getItem(k) || ''; } catch { return ''; } }
export function lsSet(k, v)    { try { localStorage.setItem(k, v || ''); } catch {} }
export function lsGetArr(k)    { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } }
export function lsSetArr(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
