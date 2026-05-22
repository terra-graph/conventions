import {
  GraphResolver,
  GraphologyAdapter,
  type TgGraph,
  edgeIdFrom,
  tgNodeIdFrom,
} from '@terra-graph/core';
import { profileName } from './namespaces.js';
import { coreBase, coreDot } from './profiles.js';
import { coreNamedRules } from './rules.js';

const asGraph = (nodes: TgGraph['nodes'], edges: TgGraph['edges']): TgGraph => ({
  schemaVersion: '1.0.0',
  description: {},
  nodes,
  edges,
});

describe('core profiles', () => {
  it('should expose the expected base profile phases', () => {
    const serialized = coreBase.serialize();

    expect(serialized.name).toBe(profileName('base'));
    expect(serialized.phases?.map((phase) => phase.phase)).toStrictEqual(['pre', 'main']);
    expect(serialized.phases?.[0]?.rules).toEqual([
      { namedRule: 'core.remove.tfconfig' },
      { namedRule: 'core.remove.tfconfig_artifacts' },
      { namedRule: 'core.reconnect.time_sleep' },
      { namedRule: 'core.materialize.cardinality_resources' },
    ]);
    expect(serialized.phases?.[1]?.rules).toEqual([{ namedRule: 'core.remove.self_loops' }]);
  });

  it('should expose the expected dot profile phases', () => {
    const serialized = coreDot.serialize();

    expect(serialized.name).toBe(profileName('dot'));
    expect(serialized.usesProfiles?.map((profile) => profile.name)).toEqual([profileName('base')]);
    expect(serialized.phases?.map((phase) => phase.phase)).toStrictEqual(['pre', 'final']);
    expect(serialized.phases?.[0]?.rules).toEqual([
      { namedRule: 'core.remove.outputs' },
      { namedRule: 'core.remove.providers' },
      { namedRule: 'core.remove.root' },
      { namedRule: 'core.remove.artifacts' },
    ]);
  });

  it('should reconnect through tf config bridge nodes in the base profile', () => {
    const sourceId = tgNodeIdFrom(
      'resource',
      'module.api.aws_apigatewayv2_integration.this["GET /"]',
    );
    const varId = tgNodeIdFrom('var', 'module.api.var.routes');
    const outputId = tgNodeIdFrom('output', 'module.lambda.output.lambda_function_arn');
    const targetId = tgNodeIdFrom('resource', 'module.lambda.aws_lambda_function.this[0]');

    const graph = asGraph(
      {
        [sourceId]: {
          id: sourceId,
          terraform: {
            kind: 'resource',
            address: 'module.api.aws_apigatewayv2_integration.this["GET /"]',
            resource: 'aws_apigatewayv2_integration',
            name: 'this["GET /"]',
          },
        },
        [varId]: {
          id: varId,
          terraform: {
            kind: 'var',
            address: 'module.api.var.routes',
            resource: 'var',
            name: 'routes',
          },
        },
        [outputId]: {
          id: outputId,
          terraform: {
            kind: 'output',
            address: 'module.lambda.output.lambda_function_arn',
            resource: 'output',
            name: 'lambda_function_arn',
          },
        },
        [targetId]: {
          id: targetId,
          terraform: {
            kind: 'resource',
            address: 'module.lambda.aws_lambda_function.this[0]',
            resource: 'aws_lambda_function',
            name: 'this[0]',
          },
        },
      },
      [
        {
          id: edgeIdFrom(sourceId, varId),
          from: sourceId,
          to: varId,
          attributes: {},
        },
        {
          id: edgeIdFrom(varId, outputId),
          from: varId,
          to: outputId,
          attributes: {},
        },
        {
          id: edgeIdFrom(outputId, targetId),
          from: outputId,
          to: targetId,
          attributes: {},
        },
      ],
    );

    const resolver = new GraphResolver(new GraphologyAdapter());
    const result = resolver
      .resolve({
        graph,
        phases: coreBase.resolvePhases(coreNamedRules),
      })
      .toTgGraph();

    expect(result.nodes[varId]).toBeUndefined();
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: sourceId,
          to: outputId,
        }),
      ]),
    );
  });

  it('should reconnect through output bridge nodes in the dot profile', () => {
    const sourceId = tgNodeIdFrom('resource', 'aws_wafv2_web_acl_association.api');
    const outputId = tgNodeIdFrom('output', 'module.api.output.stage_arn');
    const targetId = tgNodeIdFrom('resource', 'module.api.aws_apigatewayv2_stage.this[0]');

    const graph = asGraph(
      {
        [sourceId]: {
          id: sourceId,
          terraform: {
            kind: 'resource',
            address: 'aws_wafv2_web_acl_association.api',
            resource: 'aws_wafv2_web_acl_association',
            name: 'api',
          },
        },
        [outputId]: {
          id: outputId,
          terraform: {
            kind: 'output',
            address: 'module.api.output.stage_arn',
            resource: 'output',
            name: 'stage_arn',
          },
        },
        [targetId]: {
          id: targetId,
          terraform: {
            kind: 'resource',
            address: 'module.api.aws_apigatewayv2_stage.this[0]',
            resource: 'aws_apigatewayv2_stage',
            name: 'this[0]',
          },
        },
      },
      [
        {
          id: edgeIdFrom(sourceId, outputId),
          from: sourceId,
          to: outputId,
          attributes: {},
        },
        {
          id: edgeIdFrom(outputId, targetId),
          from: outputId,
          to: targetId,
          attributes: {},
        },
      ],
    );

    const resolver = new GraphResolver(new GraphologyAdapter());
    const result = resolver
      .resolve({
        graph,
        phases: coreDot.resolvePhases(coreNamedRules),
      })
      .toTgGraph();

    expect(result.nodes[outputId]).toBeUndefined();
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: sourceId,
          to: targetId,
        }),
      ]),
    );
  });
});
