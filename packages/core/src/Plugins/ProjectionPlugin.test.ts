import { GraphPluginRegistry, Profile } from '@terra-graph/core';
import { ProjectionPlugin } from './ProjectionPlugin.js';

describe('ProjectionPlugin', () => {
  it('should contribute a main phase rule through profile plugin resolution', () => {
    const registry = new GraphPluginRegistry({
      [ProjectionPlugin.id]: new ProjectionPlugin(),
    });
    const profile = new Profile('projection', {
      plugins: [
        {
          plugin: ProjectionPlugin.id,
          options: {
            strategies: [
              {
                id: 'aws.lambda',
                trigger: {
                  attr: {
                    key: 'terraform.resource',
                    eq: 'aws_lambda_function',
                  },
                },
              },
            ],
          },
        },
      ],
    });

    const phases = profile.resolvePhases(undefined, undefined, registry);

    expect(phases).toHaveLength(1);
    expect(phases[0]).toHaveLength(1);
    expect(phases[0][0]?.serialize()).toEqual({
      id: 'DeriveProjectionGraph',
      config: {
        node: { any: true },
        options: {
          strategies: [
            {
              id: 'aws.lambda',
              trigger: {
                attr: {
                  key: 'terraform.resource',
                  eq: 'aws_lambda_function',
                },
              },
            },
          ],
        },
      },
    });
  });
});
