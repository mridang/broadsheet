import { describe, expect, it } from '@jest/globals';

import { ArgumentChecker, InvalidToolArgumentsError } from '@/lib/mcp';
import { CountTool, RenameTool } from './tool-fixtures';

const checker = new ArgumentChecker();

describe('ArgumentChecker', () => {
  it('passes arguments that fit the schema through unchanged', () => {
    expect(checker.check(new CountTool(), { limit: 2 })).toEqual({
      args: { limit: 2 },
    });
  });

  it('treats absent arguments as none, filling in what the tool defaults', () => {
    expect(checker.check(new CountTool(), undefined)).toEqual({
      args: { limit: 0 },
    });
  });

  it('renames a looser argument the tool forgives', () => {
    expect(checker.check(new RenameTool(), { name: 'x' })).toEqual({
      args: { thing: 'x' },
    });
  });

  it('leaves both alone when a call sends an alias and its canonical name', () => {
    const checked = checker.check(new RenameTool(), {
      name: 'x',
      thing: 'y',
    });
    expect(checked.refusal?.isError).toBe(true);
  });

  it('refuses what does not fit, naming the problem and the arguments the tool takes', () => {
    const checked = checker.check(new CountTool(), { limit: 0, extra: true });
    expect(checked.args).toBeUndefined();
    expect(checked.refusal?.content[0]?.text).toContain(
      'Invalid arguments for count',
    );
    expect(checked.refusal?.content[0]?.text).toContain(
      'The arguments are: limit.',
    );
  });

  it('throws a malformed request when the arguments are not an object', () => {
    for (const given of [[1], 'text', 7, null]) {
      expect(() => checker.check(new CountTool(), given)).toThrow(
        InvalidToolArgumentsError,
      );
    }
  });
});
