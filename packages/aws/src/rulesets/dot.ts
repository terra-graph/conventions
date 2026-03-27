import { EdgeLegend, NamedRuleSetRegistry, RuleSet } from '@terra-graph/core';
import { ruleName, ruleSetName } from '../namespaces.js';

export default new NamedRuleSetRegistry({
  [ruleSetName('dot.sqs.dlq')]: new RuleSet({
    rules: [
      { namedRule: ruleName('dot.sqs.dlq.align') },
      new EdgeLegend({
        options: {
          colour: '#c20202',
          title: 'SQS dead letters / failures',
        },
        edge: {
          from: {
            attr: { key: 'terraform.resource', eq: 'aws_sqs_queue' },
          },
          to: {
            attr: { key: 'terraform.resource', eq: 'aws_sqs_queue' },
          },
        },
      }),
    ],
  }),
});
