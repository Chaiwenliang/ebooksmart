import { describe, it, expect } from 'vitest';
import { esc, hlMark, normalizeUrl } from '../utils.js';

describe('utils.js', () => {
  describe('esc', () => {
    it('should escape HTML characters', () => {
      expect(esc('<div>"&"</div>')).toBe('&lt;div&gt;&quot;&amp;&quot;&lt;/div&gt;');
    });

    it('should handle empty or null input', () => {
      expect(esc('')).toBe('');
      expect(esc(null)).toBe('');
    });
  });

  describe('hlMark', () => {
    it('should highlight the matching text', () => {
      expect(hlMark('Hello World', 'world')).toBe('Hello <mark>World</mark>');
    });

    it('should escape HTML and then highlight', () => {
      expect(hlMark('<b>Hello</b>', 'hello')).toBe('&lt;b&gt;<mark>Hello</mark>&lt;/b&gt;');
    });

    it('should return escaped text if no match', () => {
      expect(hlMark('Hello World', 'foo')).toBe('Hello World');
    });
  });

  describe('normalizeUrl', () => {
    it('should append chat/completions if missing', () => {
      expect(normalizeUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/chat/completions');
      expect(normalizeUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('should not append if already present', () => {
      expect(normalizeUrl('https://api.openai.com/v1/chat/completions')).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('should handle empty input', () => {
      expect(normalizeUrl('')).toBe('');
      expect(normalizeUrl(null)).toBe('');
    });
  });
});
