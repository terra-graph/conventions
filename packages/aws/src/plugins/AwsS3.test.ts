import {
  type BaseRule,
  type GraphPluginBuildInput,
  type NamedPhase,
  NamedRuleRegistry,
  NamedRuleSetRegistry,
  type SerializedRule,
} from 'terra-graph';
import { AwsS3 } from './AwsS3.js';
import type { AwsS3GraphPluginOptions } from './AwsS3.js';

type SerializedPhaseStep = {
  phase: NamedPhase;
  rules: SerializedRule[];
};

const buildPhases = (options: AwsS3GraphPluginOptions = {}): SerializedPhaseStep[] => {
  const plugin = new AwsS3();
  const result = plugin.build({
    options,
    namedRules: new NamedRuleRegistry(),
    namedRuleSets: new NamedRuleSetRegistry(),
  } as GraphPluginBuildInput<AwsS3GraphPluginOptions>);

  return (result.phases ?? []).map((phase) => ({
    phase: phase.phase,
    rules: phase.rules.map((rule) => (rule as BaseRule).serialize()),
  }));
};

describe('AwsS3.build', () => {
  it('shoud remove non-default s3 resources and keep aws_s3_bucket and notifications', () => {
    const phases = buildPhases();

    expect(phases).toHaveLength(3);
    expect(phases.every((phase) => phase.phase === 'main')).toBe(true);
    expect(phases[0]?.rules[0]).toStrictEqual({
      id: 'RemoveNodeAndReconnectEdges',
      config: {
        node: {
          and: [
            {
              attr: {
                key: 'terraform.resource',
                startsWith: 'aws_s3_',
              },
            },
            {
              not: {
                attr: {
                  key: 'terraform.resource',
                  in: ['aws_s3_bucket', 'aws_s3_bucket_notification'],
                },
              },
            },
          ],
        },
      },
    });
    expect(phases[1]?.rules[0]).toStrictEqual({
      id: 'RemoveNode',
      config: {
        node: {
          and: [
            {
              attr: {
                key: 'terraform.resource',
                eq: 'aws_s3_bucket_object',
              },
            },
            {
              not: {
                attr: {
                  key: 'terraform.resource',
                  in: ['aws_s3_bucket', 'aws_s3_bucket_notification'],
                },
              },
            },
          ],
        },
      },
    });
    expect(phases[2]?.rules[0]).toStrictEqual({
      id: 'ConvertNodeToEdge',
      config: {
        node: {
          attr: {
            key: 'terraform.resource',
            eq: 'aws_s3_bucket_notification',
          },
        },
      },
    });
  });

  it('shoud keep custom resources when keepResources is configured', () => {
    const keepResources = ['aws_s3_bucket', 'aws_s3_access_point'];
    const phases = buildPhases({ keepResources });

    expect(phases[0]?.rules[0]).toStrictEqual({
      id: 'RemoveNodeAndReconnectEdges',
      config: {
        node: {
          and: [
            {
              attr: {
                key: 'terraform.resource',
                startsWith: 'aws_s3_',
              },
            },
            {
              not: {
                attr: {
                  key: 'terraform.resource',
                  in: keepResources,
                },
              },
            },
          ],
        },
      },
    });
  });

  it('shoud use custom constructor keepResources when provided', () => {
    const keepResources = ['aws_s3_bucket', 'aws_s3_bucket_notification', 'aws_s3_access_point'];
    const plugin = new AwsS3({ keepResources });
    expect(plugin.defaults).toStrictEqual({ keepResources });
  });
});
