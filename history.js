import { STORE } from './constants.js';
import { lsGetArr, lsSetArr } from './storage.js';

export function saveHistory(item) {
  const list = lsGetArr(STORE.HISTORY);
  const key  = (item.novel || '').toLowerCase() + '__' + (item.person || '').toLowerCase();
  const idx  = list.findIndex(function (x) {
    return (x.novel || '').toLowerCase() + '__' + (x.person || '').toLowerCase() === key;
  });
  const now = new Date().toISOString();
  if (idx >= 0) {
    list[idx] = Object.assign({}, list[idx], item, { updatedAt: now });
  } else {
    list.unshift(Object.assign({ id: Date.now() + '_' + Math.random().toString(36).slice(2, 6), createdAt: now }, item, { updatedAt: now }));
  }
  list.sort(function (a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
  lsSetArr(STORE.HISTORY, list);
}

export function delHistory(id) {
  lsSetArr(STORE.HISTORY, lsGetArr(STORE.HISTORY).filter(function (x) { return x.id !== id; }));
}
