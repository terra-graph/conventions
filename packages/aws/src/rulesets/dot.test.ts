import { ruleName, ruleSetName } from '../namespaces.js';
import dotRules from '../rules/dot.js';
import dotRuleSet from './dot.js';

describe('dot rule sets', () => {
  it('shoud expose the SQS dead-letter rule set', () => {
    const name = ruleSetName('dot.sqs.dlq');
    expect(dotRuleSet.names()).toEqual([name]);

    const resolved = dotRuleSet.resolve(name);
    const phases = resolved.resolvePhases(dotRules);

    expect(phases).toHaveLength(1);
    expect(phases[0]).toHaveLength(2);
    expect(phases[0][0].serialize()).toStrictEqual({
      id: 'AlignNodes',
      config: {
        edge: {
          from: {
            attr: { key: 'terraform.resource', eq: 'aws_sqs_queue' },
          },
          to: {
            attr: { key: 'terraform.resource', eq: 'aws_sqs_queue' },
          },
        },
      },
    });
    expect(phases[0][1]).toMatchObject({
      serialize: expect.any(Function),
    });
    expect(phases[0][1].serialize().id).toBe('EdgeLegend');
    expect(phases[0][1].serialize().config.options).toMatchObject({
      colour: '#c20202',
      title: 'SQS dead letters / failures',
    });
    const edgeLegend = phases[0][1].serialize();
    if (!('edge' in edgeLegend.config)) {
      throw new Error('Expected EdgeLegend to provide an edge config');
    }
    expect(edgeLegend.config.edge).toMatchObject({
      from: {
        attr: { key: 'terraform.resource', eq: 'aws_sqs_queue' },
      },
    });
  });
});
