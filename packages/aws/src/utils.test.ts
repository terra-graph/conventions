import type { TgNodeAttributes } from '@terra-graph/core';
import {
  collectTerraformStateValueCandidates,
  parseJsonArrayOfStrings,
  parseJsonObject,
  resourceTypeOf,
  toArrayOfStrings,
  unique,
} from './utils.js';

describe('utils', () => {
  it('deduplicates iterables', () => {
    expect(unique(['one', 'two', 'one'])).toStrictEqual(['one', 'two']);
  });

  it('converts unknown values to arrays of strings', () => {
    expect(toArrayOfStrings('value')).toStrictEqual(['value']);
    expect(toArrayOfStrings(['one', '', 'two', 'one', 2, null])).toStrictEqual(['one', 'two']);
    expect(toArrayOfStrings({})).toStrictEqual([]);
  });

  it('parses json objects defensively', () => {
    expect(parseJsonObject('{')).toBeUndefined();
    expect(parseJsonObject('[]')).toBeUndefined();
    expect(parseJsonObject('{"ok":true}')).toStrictEqual({ ok: true });
  });

  it('parses arrays of strings defensively', () => {
    expect(parseJsonArrayOfStrings({})).toStrictEqual([]);
    expect(parseJsonArrayOfStrings(['one', 2, 'two'])).toStrictEqual(['one', 'two']);
  });

  it('reads the terraform resource type from a node', () => {
    expect(
      resourceTypeOf({
        terraform: { resource: 'aws_lambda_function' },
      } as TgNodeAttributes),
    ).toBe('aws_lambda_function');
    expect(resourceTypeOf(undefined)).toBeUndefined();
  });

  it('collects effective and instance terraform state values', () => {
    expect(
      collectTerraformStateValueCandidates({
        terraform: {
          state: {
            effective: { values: { one: 1 } },
            instances: [{ values: { two: 2 } }, { values: 'invalid' }],
          },
        },
      } as unknown as TgNodeAttributes),
    ).toStrictEqual([{ one: 1 }, { two: 2 }]);
    expect(
      collectTerraformStateValueCandidates({
        terraform: {
          state: {
            effective: { values: 'invalid' },
            instances: [],
          },
        },
      } as unknown as TgNodeAttributes),
    ).toStrictEqual([]);
  });
});
