import { GraphPluginRegistry, Profile } from '@terra-graph/core';
import { ProjectionPlugin } from './ProjectionPlugin.js';

describe('ProjectionPlugin', () => {
  it('should contribute projection-phase rules through profile plugin resolution', () => {
    const registry = new GraphPluginRegistry({
      [ProjectionPlugin.id]: new ProjectionPlugin(),
    });
    const profile = new Profile('projection', {
      plugins: [
        {
          plugin: ProjectionPlugin.id,
          options: {
            instanceStrategy: 'none',
            projections: [
              {
                name: 'aws.lambda',
                rootNode: {
                  attr: {
                    key: 'terraform.resource',
                    eq: 'aws_lambda_function',
                  },
                },
              },
            ],
            adjacencyRelationships: [
              {
                and: [
                  {
                    from: {
                      attr: {
                        key: 'projection.derivation.projectionName',
                        eq: 'aws.alb',
                      },
                    },
                  },
                  {
                    to: {
                      attr: {
                        key: 'projection.derivation.projectionName',
                        eq: 'aws.ecs',
                      },
                    },
                  },
                ],
                relation: 'routes',
              },
            ],
            semanticRelationships: [
              {
                fact: 'feeds',
                relation: 'triggers',
              },
            ],
            semanticDecorators: [],
          },
        },
      ],
    });

    const phases = profile.resolvePhases(undefined, undefined, registry);

    expect(phases).toHaveLength(5);
    expect(phases[0]).toHaveLength(1);
    expect(phases[0][0]?.serialize()).toEqual({
      id: 'DeriveProjectionGraph',
      config: {
        node: { any: true },
        options: {
          instanceStrategy: 'none',
          projections: [
            {
              name: 'aws.lambda',
              rootNode: {
                attr: {
                  key: 'terraform.resource',
                  eq: 'aws_lambda_function',
                },
              },
            },
          ],
          adjacencyRelationships: [
            {
              and: [
                {
                  from: {
                    attr: {
                      key: 'projection.derivation.projectionName',
                      eq: 'aws.alb',
                    },
                  },
                },
                {
                  to: {
                    attr: {
                      key: 'projection.derivation.projectionName',
                      eq: 'aws.ecs',
                    },
                  },
                },
              ],
              relation: 'routes',
            },
          ],
          semanticRelationships: [
            {
              fact: 'feeds',
              relation: 'triggers',
            },
          ],
          semanticDecorators: [],
        },
      },
    });
    expect(phases[1][0]?.serialize()).toEqual({
      id: 'MaterializeProjectionInstances',
      config: {
        node: { any: true },
        options: {
          instanceStrategy: 'none',
          projections: [
            {
              name: 'aws.lambda',
              rootNode: {
                attr: {
                  key: 'terraform.resource',
                  eq: 'aws_lambda_function',
                },
              },
            },
          ],
          adjacencyRelationships: [
            {
              and: [
                {
                  from: {
                    attr: {
                      key: 'projection.derivation.projectionName',
                      eq: 'aws.alb',
                    },
                  },
                },
                {
                  to: {
                    attr: {
                      key: 'projection.derivation.projectionName',
                      eq: 'aws.ecs',
                    },
                  },
                },
              ],
              relation: 'routes',
            },
          ],
          semanticRelationships: [
            {
              fact: 'feeds',
              relation: 'triggers',
            },
          ],
          semanticDecorators: [],
        },
      },
    });
    expect(phases[2][0]?.serialize()).toEqual({
      id: 'ProjectionSemanticFactRelationship',
      config: {
        edge: { any: true },
        options: {
          fact: 'feeds',
          relation: 'triggers',
          overwrite: true,
          enforceDirection: true,
        },
      },
    });
    expect(phases[3][0]?.serialize()).toEqual({
      id: 'ProjectionAdjacencyRelationship',
      config: {
        edge: {
          and: [
            {
              from: {
                attr: {
                  key: 'projection.derivation.projectionName',
                  eq: 'aws.alb',
                },
              },
            },
            {
              to: {
                attr: {
                  key: 'projection.derivation.projectionName',
                  eq: 'aws.ecs',
                },
              },
            },
          ],
        },
        options: {
          relation: 'routes',
          overwrite: true,
          enforceDirection: true,
        },
      },
    });
    expect(phases[4][0]?.serialize().id).toBe('ApplyProjectionEdgeSemantics');
  });

  it('should serialize an explicit instance strategy into the projection rule', () => {
    const registry = new GraphPluginRegistry({
      [ProjectionPlugin.id]: new ProjectionPlugin(),
    });
    const profile = new Profile('projection-explicit', {
      plugins: [
        {
          plugin: ProjectionPlugin.id,
          options: {
            instanceStrategy: 'match_by_key',
            projections: [
              {
                name: 'aws.lambda',
                rootNode: {
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

    expect(phases[0][0]?.serialize()).toEqual({
      id: 'DeriveProjectionGraph',
      config: {
        node: { any: true },
        options: {
          instanceStrategy: 'none',
          projections: [
            {
              name: 'aws.lambda',
              rootNode: {
                attr: {
                  key: 'terraform.resource',
                  eq: 'aws_lambda_function',
                },
              },
            },
          ],
          adjacencyRelationships: [],
          semanticRelationships: [],
          semanticDecorators: [],
        },
      },
    });
    expect(phases[1][0]?.serialize()).toEqual({
      id: 'MaterializeProjectionInstances',
      config: {
        node: { any: true },
        options: {
          instanceStrategy: 'match_by_key',
          projections: [
            {
              name: 'aws.lambda',
              rootNode: {
                attr: {
                  key: 'terraform.resource',
                  eq: 'aws_lambda_function',
                },
              },
            },
          ],
          adjacencyRelationships: [],
          semanticRelationships: [],
          semanticDecorators: [],
        },
      },
    });
  });
});
