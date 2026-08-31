import {
  BaseRule,
  GraphPluginRegistry,
  GraphologyAdapter,
  Profile,
  TG_SCHEMA_VERSION,
  type TgGraph,
  asEdgeId,
  tgProjectionNodeIdFrom,
} from '@terra-graph/core';
import { DynamicProjectionRelationshipRules } from './DynamicProjectionRelationshipRules.js';
import { ProjectionPipelineBuilder } from './ProjectionPipelineBuilder.js';
import { ProjectionPlugin } from './ProjectionPlugin.js';
import type { ProjectionPluginOptions } from './ProjectionPluginOptions.js';

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

  it('should include semantic decorator and relationship phases with explicit query options', () => {
    const registry = new GraphPluginRegistry({
      [ProjectionPlugin.id]: new ProjectionPlugin(),
    });
    const decorator = {
      name: 'test.semantic.decorator',
      extract: ({ graph }: { graph: unknown }) => graph,
      project: ({ graph }: { graph: unknown }) => graph,
    };
    const profile = new Profile('projection-decorators', {
      plugins: [
        {
          plugin: ProjectionPlugin.id,
          options: {
            projections: [],
            semanticDecorators: [decorator],
            semanticRelationships: [
              {
                from: {
                  attr: {
                    key: 'projection.derivation.projectionName',
                    eq: 'aws.lambda',
                  },
                },
                fact: 'reads_from',
                relation: 'consumes',
                overwrite: false,
                enforceDirection: false,
              },
            ],
          },
        },
      ],
    });

    const phases = profile.resolvePhases(undefined, undefined, registry);

    expect(phases).toHaveLength(5);
    expect(phases[2][0]?.serialize()).toEqual({
      id: 'ApplySemanticDecorators',
      config: {
        node: { any: true },
        options: {
          mode: 'project',
          decorators: [decorator],
        },
      },
    });
    expect(phases[3][0]?.serialize()).toEqual({
      id: 'ProjectionSemanticFactRelationship',
      config: {
        edge: {
          from: {
            attr: {
              key: 'projection.derivation.projectionName',
              eq: 'aws.lambda',
            },
          },
        },
        options: {
          fact: 'reads_from',
          relation: 'consumes',
          overwrite: false,
          enforceDirection: false,
        },
      },
    });
  });

  it('should wrap dynamic derivation rule options with singleton projection derivation', () => {
    const baseOptions: ProjectionPluginOptions = {
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
    };
    let currentOptions = baseOptions;
    const provider = {
      getRuleOptions: () => currentOptions,
    };
    const builder = new ProjectionPipelineBuilder() as unknown as {
      toDeriveRuleOptions(ruleOptions: typeof provider): typeof provider;
    };

    const deriveOptions = builder.toDeriveRuleOptions(provider);
    currentOptions = {
      ...baseOptions,
      projections: [
        ...baseOptions.projections,
        {
          name: 'aws.sqs',
          rootNode: {
            attr: {
              key: 'terraform.resource',
              eq: 'aws_sqs_queue',
            },
          },
        },
      ],
    };

    expect(deriveOptions.getRuleOptions()).toEqual({
      ...currentOptions,
      instanceStrategy: 'none',
    });
  });

  it('should wrap async dynamic derivation rule options with singleton projection derivation', async () => {
    const baseOptions: ProjectionPluginOptions = {
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
    };
    const provider = {
      getRuleOptions: async () => baseOptions,
    };
    const builder = new ProjectionPipelineBuilder() as unknown as {
      toDeriveRuleOptions(ruleOptions: typeof provider): typeof provider;
    };

    const deriveOptions = builder.toDeriveRuleOptions(provider);

    await expect(deriveOptions.getRuleOptions()).resolves.toEqual({
      ...baseOptions,
      instanceStrategy: 'none',
    });
  });

  it('should apply dynamic adjacency relationship rules from resolved options', () => {
    const lambda = tgProjectionNodeIdFrom('core', 'aws.lambda:handler');
    const database = tgProjectionNodeIdFrom('core', 'aws.db:database');
    const graph = new GraphologyAdapter().withTgGraph({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [lambda]: {
          id: lambda,
          projection: {
            layer: 'core',
            address: 'aws.lambda:handler',
            label: 'handler',
            derivation: {
              source: 'profile',
              projectionName: 'aws.lambda',
              groupKey: 'handler',
              rootNodeId: lambda,
              anchors: [],
            },
          },
        },
        [database]: {
          id: database,
          projection: {
            layer: 'core',
            address: 'aws.db:database',
            label: 'database',
            derivation: {
              source: 'profile',
              projectionName: 'aws.db',
              groupKey: 'database',
              rootNodeId: database,
              anchors: [],
            },
          },
        },
      },
      edges: [
        {
          id: asEdgeId('lambda-db'),
          from: lambda,
          to: database,
          attributes: {
            projection: {
              layer: 'core',
              adjacency: {
                source: 'derived',
              },
            },
          },
        },
      ],
    } satisfies TgGraph);
    const rule = new DynamicProjectionRelationshipRules({
      getRuleOptions: () => ({
        projections: [],
        adjacencyRelationships: [
          {
            from: {
              attr: {
                key: 'projection.derivation.projectionName',
                eq: 'aws.lambda',
              },
            },
            to: {
              attr: {
                key: 'projection.derivation.projectionName',
                eq: 'aws.db',
              },
            },
            relation: 'reads',
          },
        ],
      }),
    });
    const node = graph.getNodeAttributes(lambda);
    if (!node) {
      throw new Error('Expected lambda projection node');
    }

    rule.match(lambda, node, graph);

    expect(
      rule.apply(lambda, node, graph).getEdgeAttributes(asEdgeId('lambda-db')).projection
        ?.relationship,
    ).toMatchObject({
      relation: 'reads',
      source: 'derived',
    });
  });

  it('should apply dynamic semantic relationship rules from resolved options', () => {
    const lambda = tgProjectionNodeIdFrom('core', 'aws.lambda:handler');
    const database = tgProjectionNodeIdFrom('core', 'aws.db:database');
    const graph = new GraphologyAdapter().withTgGraph({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [lambda]: {
          id: lambda,
          projection: {
            layer: 'core',
            address: 'aws.lambda:handler',
            label: 'handler',
          },
        },
        [database]: {
          id: database,
          projection: {
            layer: 'core',
            address: 'aws.db:database',
            label: 'database',
          },
        },
      },
      edges: [
        {
          id: asEdgeId('lambda-db'),
          from: lambda,
          to: database,
          attributes: {
            projection: {
              layer: 'core',
              semantics: {
                facts: [
                  {
                    kind: 'reads_from',
                    from: lambda,
                    to: database,
                    source: 'explicit_connection',
                    confidence: 'exact',
                  },
                ],
              },
            },
          },
        },
      ],
    } satisfies TgGraph);
    const rule = new DynamicProjectionRelationshipRules({
      projections: [],
      semanticRelationships: [
        {
          fact: 'reads_from',
          relation: 'reads',
        },
        {
          from: {
            attr: {
              key: 'projection.layer',
              eq: 'core',
            },
          },
          fact: 'reads_from',
          relation: 'reads',
          overwrite: false,
        },
      ],
    });
    const node = graph.getNodeAttributes(lambda);
    if (!node) {
      throw new Error('Expected lambda projection node');
    }

    expect(rule.apply(lambda, node, graph)).toBe(graph);
    rule.match(lambda, node, graph);

    expect(
      rule.apply(lambda, node, graph).getEdgeAttributes(asEdgeId('lambda-db')).projection
        ?.relationship,
    ).toMatchObject({
      relation: 'reads',
      source: 'derived',
    });
  });

  it('should apply dynamic relationship rules from async options', async () => {
    const lambda = tgProjectionNodeIdFrom('core', 'aws.lambda:handler');
    const database = tgProjectionNodeIdFrom('core', 'aws.db:database');
    const graph = new GraphologyAdapter().withTgGraph({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [lambda]: {
          id: lambda,
          projection: {
            layer: 'core',
            address: 'aws.lambda:handler',
            label: 'handler',
            derivation: {
              source: 'profile',
              projectionName: 'aws.lambda',
              groupKey: 'handler',
              rootNodeId: lambda,
              anchors: [],
            },
          },
        },
        [database]: {
          id: database,
          projection: {
            layer: 'core',
            address: 'aws.db:database',
            label: 'database',
            derivation: {
              source: 'profile',
              projectionName: 'aws.db',
              groupKey: 'database',
              rootNodeId: database,
              anchors: [],
            },
          },
        },
      },
      edges: [
        {
          id: asEdgeId('lambda-db'),
          from: lambda,
          to: database,
          attributes: {
            projection: {
              layer: 'core',
              adjacency: {
                source: 'derived',
              },
            },
          },
        },
      ],
    } satisfies TgGraph);
    const rule = new DynamicProjectionRelationshipRules({
      getRuleOptions: async () => ({
        projections: [],
        adjacencyRelationships: [
          {
            from: {
              attr: {
                key: 'projection.derivation.projectionName',
                eq: 'aws.lambda',
              },
            },
            to: {
              attr: {
                key: 'projection.derivation.projectionName',
                eq: 'aws.db',
              },
            },
            relation: 'reads',
          },
        ],
      }),
    });
    const node = graph.getNodeAttributes(lambda);
    if (!node) {
      throw new Error('Expected lambda projection node');
    }

    rule.match(lambda, node, graph);
    const updated = await (rule.apply(
      lambda,
      node,
      graph,
    ) as unknown as Promise<GraphologyAdapter>);

    expect(updated.getEdgeAttributes(asEdgeId('lambda-db')).projection?.relationship).toMatchObject(
      {
        relation: 'reads',
      },
    );
  });

  it('should preserve dynamic provider options through rule serialization', () => {
    const lambda = tgProjectionNodeIdFrom('core', 'aws.lambda:handler');
    const database = tgProjectionNodeIdFrom('core', 'aws.db:database');
    const graph = new GraphologyAdapter().withTgGraph({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [lambda]: {
          id: lambda,
          projection: {
            layer: 'core',
            address: 'aws.lambda:handler',
            label: 'handler',
          },
        },
        [database]: {
          id: database,
          projection: {
            layer: 'core',
            address: 'aws.db:database',
            label: 'database',
          },
        },
      },
      edges: [
        {
          id: asEdgeId('lambda-db'),
          from: lambda,
          to: database,
          attributes: {
            projection: {
              layer: 'core',
              semantics: {
                facts: [
                  {
                    kind: 'reads_from',
                    from: lambda,
                    to: database,
                    source: 'explicit_connection',
                    confidence: 'exact',
                  },
                ],
              },
            },
          },
        },
      ],
    } satisfies TgGraph);
    const rule = BaseRule.fromSerialized(
      new DynamicProjectionRelationshipRules({
        getRuleOptions: () => ({
          projections: [],
          semanticRelationships: [
            {
              fact: 'reads_from',
              relation: 'reads',
            },
          ],
        }),
      }).serialize(),
    );
    const node = graph.getNodeAttributes(lambda);
    if (!node) {
      throw new Error('Expected lambda projection node');
    }

    rule.match(lambda, node, graph);

    expect(
      rule.apply(lambda, node, graph).getEdgeAttributes(asEdgeId('lambda-db')).projection
        ?.relationship,
    ).toMatchObject({
      relation: 'reads',
      source: 'derived',
    });
  });

  it('should leave the graph unchanged when dynamic child rules do not match', () => {
    const lambda = tgProjectionNodeIdFrom('core', 'aws.lambda:handler');
    const database = tgProjectionNodeIdFrom('core', 'aws.db:database');
    const graph = new GraphologyAdapter().withTgGraph({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [lambda]: {
          id: lambda,
          projection: {
            layer: 'core',
            address: 'aws.lambda:handler',
            label: 'handler',
            derivation: {
              source: 'profile',
              projectionName: 'aws.lambda',
              groupKey: 'handler',
              rootNodeId: lambda,
              anchors: [],
            },
          },
        },
        [database]: {
          id: database,
          projection: {
            layer: 'core',
            address: 'aws.db:database',
            label: 'database',
            derivation: {
              source: 'profile',
              projectionName: 'aws.db',
              groupKey: 'database',
              rootNodeId: database,
              anchors: [],
            },
          },
        },
      },
      edges: [
        {
          id: asEdgeId('lambda-db'),
          from: lambda,
          to: database,
          attributes: {
            projection: {
              layer: 'core',
              adjacency: {
                source: 'derived',
              },
            },
          },
        },
      ],
    } satisfies TgGraph);
    const rule = new DynamicProjectionRelationshipRules({
      projections: [],
      adjacencyRelationships: [
        {
          from: {
            attr: {
              key: 'projection.derivation.projectionName',
              eq: 'aws.queue',
            },
          },
          to: {
            attr: {
              key: 'projection.derivation.projectionName',
              eq: 'aws.db',
            },
          },
          relation: 'reads',
        },
      ],
    });
    const node = graph.getNodeAttributes(lambda);
    if (!node) {
      throw new Error('Expected lambda projection node');
    }

    rule.match(lambda, node, graph);

    expect(rule.apply(lambda, node, graph)).toBe(graph);
    expect(graph.getEdgeAttributes(asEdgeId('lambda-db')).projection?.relationship).toBeUndefined();
  });

  it('should register dynamic relationship rules for serialized runtime profiles', () => {
    expect(
      BaseRule.fromSerialized({
        id: 'DynamicProjectionRelationshipRules',
        config: {
          node: { any: true },
          options: {
            projections: [],
          },
        },
      }),
    ).toBeInstanceOf(DynamicProjectionRelationshipRules);
    expect(
      BaseRule.fromSerialized({
        id: 'DynamicProjectionRelationshipRules',
        config: {
          node: { any: true },
        },
      }),
    ).toBeInstanceOf(DynamicProjectionRelationshipRules);
  });
});
