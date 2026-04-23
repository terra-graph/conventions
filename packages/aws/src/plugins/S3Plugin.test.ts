import {
  type BaseRule,
  type GraphPluginBuildInput,
  type NamedPhase,
  NamedRuleRegistry,
  NamedRuleSetRegistry,
  type SerializedRule,
} from '@terra-graph/core';
import { S3Plugin } from './S3Plugin.js';
import type { S3GraphPluginOptions } from './S3Plugin.js';

type SerializedPhaseStep = {
  phase: NamedPhase;
  rules: SerializedRule[];
};

const buildPhases = (options: S3GraphPluginOptions = {}): SerializedPhaseStep[] => {
  const plugin = new S3Plugin();
  const result = plugin.build({
    options,
    namedRules: new NamedRuleRegistry(),
    namedRuleSets: new NamedRuleSetRegistry(),
  } as GraphPluginBuildInput<S3GraphPluginOptions>);

  return (result.phases ?? []).map((phase) => ({
    phase: phase.phase,
    rules: phase.rules.map((rule) => (rule as BaseRule).serialize()),
  }));
};

describe('AwsS3.build', () => {
  it('shoud remove non-default s3 resources and keep aws_s3_bucket and notifications', () => {
    const phases = buildPhases();

    expect(phases).toHaveLength(3);
    expect(phases.map((phase) => phase.phase)).toStrictEqual(['pre', 'pre', 'main']);
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
    expect(phases[2]?.rules).toHaveLength(0);
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
    const plugin = new S3Plugin({ keepResources });
    expect(plugin.defaults).toStrictEqual({ keepResources });
  });
});
