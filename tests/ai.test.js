import { describe, it, expect, vi } from 'vitest';
import { buildPrompt, parseResponse, testConnection } from '../ai.js';
import { FIELDS } from '../constants.js';

describe('ai.js', () => {
  describe('testConnection', () => {
    it('should return true for a successful connection', async () => {
      const mockConfig = { url: 'https://api.openai.com/v1', key: 'sk-123', model: 'gpt-4o' };
      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'hi' } }]
        })
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await testConnection(mockConfig);
      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('chat/completions'), expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer sk-123'
        })
      }));
    });

    it('should throw error for an unsuccessful connection', async () => {
      const mockConfig = { url: 'https://api.openai.com/v1', key: 'sk-123', model: 'gpt-4o' };
      const mockResponse = {
        ok: false,
        status: 404,
        json: async () => ({
          error: { message: 'Not Found' }
        })
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      await expect(testConnection(mockConfig)).rejects.toThrow('Not Found');
    });

    it('should throw error if config is missing', async () => {
      await expect(testConnection({ url: '', key: '', model: '' })).rejects.toThrow('MISSING_CONFIG');
    });
  });

  describe('buildPrompt', () => {
    it('should build a prompt with person name', () => {
      const prompt = buildPrompt('诡秘之主', '克莱恩', '愚者');
      expect(prompt).toContain('诡秘之主');
      expect(prompt).toContain('克莱恩');
      expect(prompt).toContain('愚者');
      expect(prompt).not.toContain('请先判断这描述的是哪个人物');
    });

    it('should build a prompt without person name', () => {
      const prompt = buildPrompt('诡秘之主', '', '那个自称愚者的人');
      expect(prompt).toContain('诡秘之主');
      expect(prompt).toContain('那个自称愚者的人');
      expect(prompt).toContain('精准判断');
      expect(prompt).toContain('人物：[确定的角色全名]');
    });
  });

  describe('parseResponse', () => {
    it('should parse a standard response', () => {
      const response = `
        首次出场：第一章
        与主角关系：主角
        阵营：塔罗会
        主要能力：占卜
        关键事件：建立塔罗会
      `;
      const result = parseResponse(response, '克莱恩');
      expect(result.appear).toBe('第一章');
      expect(result.relation).toBe('主角');
      expect(result.faction).toBe('塔罗会');
      expect(result.ability).toBe('占卜');
      expect(result.events).toBe('建立塔罗会');
    });

    it('should identify person name when knownPerson is empty', () => {
      const response = `
        角色：[克莱恩·莫雷蒂]
        首次出场：第一章
        与主角关系：主角
        阵营：塔罗会
        主要能力：占卜
        关键事件：建立塔罗会
      `;
      const result = parseResponse(response, '');
      expect(result._person).toBe('克莱恩·莫雷蒂');
      expect(result.appear).toBe('第一章');
    });

    it('should handle markdown code blocks', () => {
      const response = '```json\n人物：克莱恩\n首次出场：第一章\n```';
      const result = parseResponse(response, '');
      expect(result._person).toBe('克莱恩');
    });

    it('should handle <think> blocks and markdown bold', () => {
      const response = `
        <think>用户想查询克莱恩</think>
        **首次出场**：第一章
        **与主角关系**：主角
        **阵营**：塔罗会
        **主要能力**：占卜
        **关键事件**：建立塔罗会
      `;
      const result = parseResponse(response, '克莱恩');
      expect(result.appear).toBe('第一章');
      expect(result.relation).toBe('主角');
    });

    it('should throw error if parsing fails', () => {
      expect(() => parseResponse('invalid response', '克莱恩')).toThrow('PARSE_FAIL');
    });
  });
});
