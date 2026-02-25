import { describe, it, expect } from 'vitest';
import { PROMPTS, getPrompt, getPromptsByCategory } from '../prompts';

describe('PROMPTS registry', () => {
  it('contains all 16 expected prompt IDs', () => {
    const expectedIds = [
      'transform.default',
      'qualitative.default',
      'qualitative.rigorous',
      'consensus.worker_default',
      'consensus.worker_rigorous',
      'consensus.judge_default',
      'consensus.judge_enhanced',
      'codebook.discovery',
      'codebook.consolidation',
      'codebook.definition',
      'generate.column_suggestions',
      'generate.csv_with_cols',
      'generate.csv_freeform',
      'automator.rules',
      'ai_coder.suggestions',
      'screener.default',
    ];
    for (const id of expectedIds) {
      expect(PROMPTS[id], `Missing prompt: ${id}`).toBeDefined();
    }
    expect(Object.keys(PROMPTS)).toHaveLength(16);
  });

  it('each entry has id matching its key', () => {
    for (const [key, prompt] of Object.entries(PROMPTS)) {
      expect(prompt.id).toBe(key);
    }
  });

  it('each entry has non-empty name, category, and defaultValue', () => {
    for (const prompt of Object.values(PROMPTS)) {
      expect(prompt.name.length).toBeGreaterThan(0);
      expect(prompt.category.length).toBeGreaterThan(0);
      expect(prompt.defaultValue.length).toBeGreaterThan(0);
    }
  });
});

describe('getPromptsByCategory', () => {
  it('returns 1 transform prompt', () => {
    const prompts = getPromptsByCategory('transform');
    expect(prompts).toHaveLength(1);
    expect(prompts[0].id).toBe('transform.default');
  });

  it('returns 2 qualitative prompts', () => {
    const prompts = getPromptsByCategory('qualitative');
    expect(prompts).toHaveLength(2);
  });

  it('returns 4 consensus prompts', () => {
    const prompts = getPromptsByCategory('consensus');
    expect(prompts).toHaveLength(4);
  });

  it('returns 3 codebook prompts', () => {
    const prompts = getPromptsByCategory('codebook');
    expect(prompts).toHaveLength(3);
  });

  it('returns 3 generate prompts', () => {
    const prompts = getPromptsByCategory('generate');
    expect(prompts).toHaveLength(3);
  });

  it('returns 1 automator prompt', () => {
    const prompts = getPromptsByCategory('automator');
    expect(prompts).toHaveLength(1);
  });

  it('returns 1 ai_coder prompt', () => {
    const prompts = getPromptsByCategory('ai_coder');
    expect(prompts).toHaveLength(1);
  });

  it('returns 1 screener prompt', () => {
    const prompts = getPromptsByCategory('screener');
    expect(prompts).toHaveLength(1);
    expect(prompts[0].id).toBe('screener.default');
  });

  it('returns empty array for unknown category', () => {
    expect(getPromptsByCategory('nonexistent')).toEqual([]);
  });
});

describe('getPrompt', () => {
  it('returns defaultValue for known id (server-side: no window)', () => {
    // Tests run in Node.js — typeof window === "undefined" — so always returns defaultValue
    const id = 'transform.default';
    expect(getPrompt(id)).toBe(PROMPTS[id].defaultValue);
  });

  it('returns empty string for unknown id', () => {
    expect(getPrompt('does.not.exist')).toBe('');
  });

  it('returns non-empty strings for all 16 registered prompts', () => {
    for (const id of Object.keys(PROMPTS)) {
      expect(getPrompt(id).length, `Empty prompt for: ${id}`).toBeGreaterThan(0);
    }
  });
});
