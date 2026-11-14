import { describe, expect, it } from '@jest/globals';

import { NoExplanations } from '@/lib/mcp';

describe('NoExplanations', () => {
  it('recognises nothing, so every failure is handled further up', () => {
    const explainer = new NoExplanations();
    for (const error of [new Error('x'), undefined, 'a string', { a: 1 }]) {
      expect(explainer.explain(error)).toBeUndefined();
    }
  });
});
