import { describe, it, expect } from 'vitest';
import {
  ProcessRowSchema,
  ConsensusRowSchema,
  ComparisonRowSchema,
  GenerateRowSchema,
  DocumentExtractSchema,
  RunCreateSchema,
  ResultsBatchSchema,
} from '../validation';

describe('ProcessRowSchema', () => {
  const valid = {
    provider: 'openai',
    model: 'gpt-4',
    apiKey: 'sk-test',
    systemPrompt: 'You are helpful.',
    userContent: 'Hello',
  };

  it('accepts valid input', () => {
    expect(ProcessRowSchema.safeParse(valid).success).toBe(true);
  });

  it('defaults missing apiKey to empty string (local providers)', () => {
    const { apiKey: _k, ...rest } = valid;
    const result = ProcessRowSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.apiKey).toBe("");
  });

  it('accepts empty apiKey for local providers', () => {
    expect(ProcessRowSchema.safeParse({ ...valid, apiKey: "" }).success).toBe(true);
  });

  it('rejects temperature above 2', () => {
    expect(ProcessRowSchema.safeParse({ ...valid, temperature: 2.1 }).success).toBe(false);
  });

  it('rejects temperature below 0', () => {
    expect(ProcessRowSchema.safeParse({ ...valid, temperature: -0.1 }).success).toBe(false);
  });

  it('accepts optional fields when provided', () => {
    const result = ProcessRowSchema.safeParse({
      ...valid,
      temperature: 0.7,
      maxTokens: 512,
      rowIdx: 0,
      runId: 'run-abc',
      baseUrl: 'https://custom.api',
    });
    expect(result.success).toBe(true);
  });
});

describe('ConsensusRowSchema', () => {
  const worker = { provider: 'openai', model: 'gpt-4', apiKey: '' };
  const valid = {
    workers: [worker, worker],
    judge: worker,
    workerPrompt: 'Analyze this text.',
    judgePrompt: 'Arbitrate the responses.',
    userContent: 'Some text to analyze.',
  };

  it('accepts valid input with two workers', () => {
    expect(ConsensusRowSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts three workers', () => {
    expect(ConsensusRowSchema.safeParse({ ...valid, workers: [worker, worker, worker] }).success).toBe(true);
  });

  it('rejects fewer than 2 workers', () => {
    expect(ConsensusRowSchema.safeParse({ ...valid, workers: [worker] }).success).toBe(false);
  });
});

describe('ComparisonRowSchema', () => {
  const model = { id: 'm1', provider: 'openai', model: 'gpt-4', apiKey: 'sk-test' };
  const valid = {
    models: [model, { ...model, id: 'm2' }],
    systemPrompt: 'You are helpful.',
    userContent: 'Compare this text.',
  };

  it('accepts valid input with two models', () => {
    expect(ComparisonRowSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects fewer than 2 models', () => {
    expect(ComparisonRowSchema.safeParse({ ...valid, models: [model] }).success).toBe(false);
  });

  it('accepts optional temperature', () => {
    expect(ComparisonRowSchema.safeParse({ ...valid, temperature: 1.0 }).success).toBe(true);
  });
});

describe('GenerateRowSchema', () => {
  const valid = {
    provider: 'openai',
    model: 'gpt-4',
    apiKey: 'sk-test',
    rowCount: 20,
  };

  it('accepts valid input', () => {
    expect(GenerateRowSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts rowCount = 1 (minimum)', () => {
    expect(GenerateRowSchema.safeParse({ ...valid, rowCount: 1 }).success).toBe(true);
  });

  it('accepts rowCount = 500 (maximum)', () => {
    expect(GenerateRowSchema.safeParse({ ...valid, rowCount: 500 }).success).toBe(true);
  });

  it('rejects rowCount above 500', () => {
    expect(GenerateRowSchema.safeParse({ ...valid, rowCount: 501 }).success).toBe(false);
  });

  it('rejects rowCount = 0', () => {
    expect(GenerateRowSchema.safeParse({ ...valid, rowCount: 0 }).success).toBe(false);
  });

  it('accepts column definitions', () => {
    const result = GenerateRowSchema.safeParse({
      ...valid,
      columns: [{ name: 'sentiment', type: 'text', description: 'positive or negative' }],
    });
    expect(result.success).toBe(true);
  });
});

describe('DocumentExtractSchema', () => {
  const valid = {
    fileContent: 'base64encodedcontent==',
    fileType: 'pdf' as const,
    provider: 'openai',
    model: 'gpt-4',
    apiKey: 'sk-test',
  };

  it('accepts valid PDF input', () => {
    expect(DocumentExtractSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts all supported file types', () => {
    for (const fileType of ['pdf', 'docx', 'txt', 'md'] as const) {
      expect(DocumentExtractSchema.safeParse({ ...valid, fileType }).success).toBe(true);
    }
  });

  it('rejects unsupported file type', () => {
    expect(DocumentExtractSchema.safeParse({ ...valid, fileType: 'xlsx' }).success).toBe(false);
  });

  it('rejects empty fileContent', () => {
    expect(DocumentExtractSchema.safeParse({ ...valid, fileContent: '' }).success).toBe(false);
  });
});

describe('RunCreateSchema', () => {
  it('accepts empty object (all fields have defaults or are optional)', () => {
    expect(RunCreateSchema.safeParse({}).success).toBe(true);
  });

  it('rejects negative inputRows', () => {
    expect(RunCreateSchema.safeParse({ inputRows: -1 }).success).toBe(false);
  });

  it('rejects non-positive maxTokens', () => {
    expect(RunCreateSchema.safeParse({ maxTokens: 0 }).success).toBe(false);
  });
});

describe('ResultsBatchSchema', () => {
  const valid = {
    runId: 'run-123',
    results: [
      {
        rowIndex: 0,
        input: { text: 'hello' },
        output: 'world',
        status: 'success',
      },
    ],
  };

  it('accepts valid batch with one result', () => {
    expect(ResultsBatchSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts empty results array', () => {
    expect(ResultsBatchSchema.safeParse({ runId: 'run-abc', results: [] }).success).toBe(true);
  });

  it('rejects missing runId', () => {
    const { runId: _id, ...rest } = valid;
    expect(ResultsBatchSchema.safeParse(rest).success).toBe(false);
  });

  it('accepts object output (not just string)', () => {
    const result = ResultsBatchSchema.safeParse({
      runId: 'run-123',
      results: [{ rowIndex: 0, input: {}, output: { code: 'A', confidence: 0.9 }, status: 'success' }],
    });
    expect(result.success).toBe(true);
  });
});
