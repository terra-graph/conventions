import { type SerializedRule } from '@terra-graph/core';
import generalRules from './general.js';
import { ruleName } from '../namespaces.js';

type RuleByName = (name: string) => SerializedRule;

const serialize = (name: string): SerializedRule => {
  return generalRules.resolve(name).serialize();
};

describe('general rules', () => {
  it('shoud expose all general named rules', () => {
    expect(generalRules.names().sort()).toStrictEqual(
      [
        ruleName('data.remove'),
        ruleName('lambda.only_event_source_mapping'),
        ruleName('log_groups.only_event_bridge'),
      ].sort(),
    );
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

  it('shoud remove non-event-bridge log groups and non-core lambda resources by query', () => {
    expect(serialize(ruleName('log_groups.only_event_bridge')).id).toBe('RemoveNode');
    expect(serialize(ruleName('lambda.only_event_source_mapping')).id).toBe('RemoveNode');
  });
});
