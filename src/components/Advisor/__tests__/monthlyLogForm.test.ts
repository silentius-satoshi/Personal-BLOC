import { describe, it, expect } from 'vitest';
import { strikeColFragment } from '../monthlyLogForm';

// The monthly editors' "Strike collateral" field. A blank field must OMIT btcHeld — never write 0: 0 is a real
// position, and nothing recomputes the column any more to overwrite a placeholder.
describe('strikeColFragment', () => {
  it('blank, whitespace or unparseable → {} (btcHeld omitted)', () => {
    expect(strikeColFragment('')).toEqual({});
    expect(strikeColFragment('   ')).toEqual({});
    expect(strikeColFragment('abc')).toEqual({});
  });

  it('a typed value records it — including a stated 0', () => {
    expect(strikeColFragment('0')).toEqual({ btcHeld: 0 });
    expect(strikeColFragment('0.12345678')).toEqual({ btcHeld: 0.12345678 });
  });
});
