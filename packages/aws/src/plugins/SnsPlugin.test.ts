import {
  type BaseRule,
  type GraphPluginBuildInput,
  type NamedPhase,
  NamedRuleRegistry,
  NamedRuleSetRegistry,
  type SerializedRule,
} from '@terra-graph/core';
import { SnsPlugin } from './SnsPlugin.js';

type SerializedPhaseStep = {
  phase: NamedPhase;
  rules: SerializedRule[];
};

const buildPhases = (): SerializedPhaseStep[] => {
  const plugin = new SnsPlugin();
  const result = plugin.build({
    options: {},
    namedRules: new NamedRuleRegistry(),
    namedRuleSets: new NamedRuleSetRegistry(),
  } as GraphPluginBuildInput);

  return (result.phases ?? []).map((phase) => ({
    phase: phase.phase,
    rules: phase.rules.map((rule) => (rule as BaseRule).serialize()),
  }));
};

describe('AwsSns.build', () => {
  it('shoud reverse subscription edges and convert subscriptions into edges', () => {
    const phases = buildPhases();

    expect(phases).toHaveLength(2);
    expect(phases.map((phase) => phase.phase)).toStrictEqual(['main', 'main']);
    expect(phases[0]?.rules).toHaveLength(1);
    expect(phases[0]?.rules[0]).toStrictEqual({
      id: 'EdgeReverse',
      config: {
        edge: {
          from: {
            attr: {
              key: 'terraform.resource',
              eq: 'aws_sns_topic',
            },
          },
          to: {
            attr: {
              key: 'terraform.resource',
              eq: 'aws_sns_topic_subscription',
            },
          },
        },
      },
    });
    expect(phases[1]?.rules).toHaveLength(1);
    expect(phases[1]?.rules[0]).toStrictEqual({
      id: 'ConvertNodeToEdge',
      config: {
        node: {
          attr: {
            key: 'terraform.resource',
            eq: 'aws_sns_topic_subscription',
          },
        },
      },
    });
  });
});
