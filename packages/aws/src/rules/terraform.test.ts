import type { SerializedRule } from '@terra-graph/core';
import { ruleName } from '../namespaces.js';
import generalRules from './terraform.js';

type RuleByName = (name: string) => SerializedRule;

const serialize = (name: string): SerializedRule => {
  return generalRules.resolve(name).serialize();
};

describe('general rules', () => {
  it('shoud expose all general named rules', () => {
    expect(generalRules.names().sort()).toStrictEqual([ruleName('data.remove')]);
  });

  it('shoud remove data nodes except policy artifacts by default', () => {
    expect(serialize(ruleName('data.remove'))).toStrictEqual({
      id: 'RemoveNode',
      config: {
        node: {
          or: [
            {
              and: [
                { attr: { key: 'terraform.kind', eq: 'data' } },
                {
                  not: {
                    attr: {
                      key: 'terraform.resource',
                      in: ['aws_iam_policy_document', 'aws_iam_policy'],
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    });
  });

  it('shoud not expose removed legacy terraform cleanup rules', () => {
    expect(() => generalRules.resolve(ruleName('log_groups.only_event_bridge'))).toThrow(
      "Named rule '@terra-graph/conventions-aws:rule:log_groups.only_event_bridge' is not registered",
    );
    expect(() => generalRules.resolve(ruleName('lambda.only_event_source_mapping'))).toThrow(
      "Named rule '@terra-graph/conventions-aws:rule:lambda.only_event_source_mapping' is not registered",
    );
  });
});
