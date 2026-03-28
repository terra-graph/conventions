import type { SerializedRule } from '@terra-graph/core';
import { ruleName } from '../namespaces.js';
import dotRules from './dot.js';

const serialize = (name: string): SerializedRule => {
  return dotRules.resolve(name).serialize();
};

describe('dot rules', () => {
  it('shoud expose all dot named rules', () => {
    expect(dotRules.names().sort()).toStrictEqual(
      [
        ruleName('dot.sqs.dlq.align'),
        ruleName('dot.schedule.align'),
        ruleName('dot.iam_role.align'),
      ].sort(),
    );
  });

  it('shoud align SQS DLQ edges and AWS scheduling/identity edges', () => {
    expect(serialize(ruleName('dot.sqs.dlq.align'))).toStrictEqual({
      id: 'AlignNodes',
      config: {
        edge: {
          from: {
            attr: {
              key: 'terraform.resource',
              eq: 'aws_sqs_queue',
            },
          },
          to: {
            attr: {
              key: 'terraform.resource',
              eq: 'aws_sqs_queue',
            },
          },
        },
      },
    });
    expect(serialize(ruleName('dot.schedule.align')).id).toBe('AlignNodes');
    expect(serialize(ruleName('dot.iam_role.align')).id).toBe('AlignNodes');
  });
});
