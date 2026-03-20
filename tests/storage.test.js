import { describe, it, expect, beforeEach, vi } from 'vitest';
import { lsGet, lsSet, lsGetArr, lsSetArr } from '../storage.js';

describe('storage.js', () => {
  beforeEach(() => {
    // Mock localStorage
    const localStorageMock = (() => {
      let store = {};
      return {
        getItem: vi.fn((key) => store[key] || null),
        setItem: vi.fn((key, value) => { store[key] = value.toString(); }),
        clear: vi.fn(() => { store = {}; }),
      };
    })();
    vi.stubGlobal('localStorage', localStorageMock);
  });

  it('should get and set values', () => {
    lsSet('test', 'value');
    expect(localStorage.setItem).toHaveBeenCalledWith('test', 'value');
    expect(lsGet('test')).toBe('value');
  });

  it('should get and set arrays', () => {
    const arr = [{ id: 1 }, { id: 2 }];
    lsSetArr('list', arr);
    expect(localStorage.setItem).toHaveBeenCalledWith('list', JSON.stringify(arr));
    expect(lsGetArr('list')).toEqual(arr);
  });

  it('should return empty string if key does not exist', () => {
    expect(lsGet('none')).toBe('');
  });

  it('should return empty array if key does not exist or invalid JSON', () => {
    expect(lsGetArr('none')).toEqual([]);
    localStorage.setItem('invalid', 'not-json');
    expect(lsGetArr('invalid')).toEqual([]);
  });
});
