import {
  type AdapterOperations,
  asEdgeId,
  asNodeId,
  GraphologyAdapter,
  type BaseRule,
  type GraphPluginBuildInput,
  type NamedPhase,
  TG_SCHEMA_VERSION,
  TgGraph,
  NamedRuleRegistry,
  NamedRuleSetRegistry,
  type SerializedRule,
  tgNodeIdFrom,
} from '@terra-graph/core';
import { AwsTransferFamily } from './AwsTransferFamily.js';

type SerializedPhaseStep = {
  phase: NamedPhase;
  rules: SerializedRule[];
};

const buildPhases = (): SerializedPhaseStep[] => {
  const plugin = new AwsTransferFamily();
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

const buildMainRules = (): BaseRule[] => {
  const plugin = new AwsTransferFamily();
  const result = plugin.build({
    options: {},
    namedRules: new NamedRuleRegistry(),
    namedRuleSets: new NamedRuleSetRegistry(),
  } as GraphPluginBuildInput);

  return (result.phases?.[1]?.rules ?? []).map((rule) => rule as BaseRule);
};

const defaultBusId = tgNodeIdFrom('resource', 'aws_cloudwatch_event_bus.default');
const buildAdapter = (graph: TgGraph): AdapterOperations => {
  return new GraphologyAdapter().withTgGraph(graph);
};

describe('AwsTransferFamily.build', () => {
  it('shoud remove transfer tags and connect transfer eventing to a default bus', () => {
    const phases = buildPhases();

    expect(phases).toHaveLength(2);
    expect(phases.map((phase) => phase.phase)).toStrictEqual(['main', 'main']);
    expect(phases[0]?.rules[0]).toStrictEqual({
      id: 'RemoveNode',
      config: {
        node: {
          attr: {
            key: 'terraform.resource',
            eq: 'aws_transfer_tag',
          },
        },
      },
    });
    expect(phases[1]?.rules).toHaveLength(2);
    expect(phases[1]?.rules[0]?.id).toBe('ConnectTransferConnectorToDefaultEventBus');
    expect(phases[1]?.rules[1]?.id).toBe('RewireTransferEventRuleToDefaultEventBus');
  });

  it('shoud connect aws_transfer_connector nodes to the implicit default event bus', () => {
    const connectorId = asNodeId('resource.aws_transfer_connector.main');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [connectorId]: {
          id: connectorId,
          label: 'connector',
          terraform: {
            kind: 'resource',
            address: 'aws_transfer_connector.main',
            resource: 'aws_transfer_connector',
            name: 'main',
          },
        },
      },
      edges: [],
    });
    const connectorRule = buildMainRules()[0]!;
    const connectorNode = adapter.getNodeAttributes(connectorId);
    if (!connectorNode) {
      throw new Error('Missing aws_transfer_connector node');
    }

    connectorRule.match(connectorId, connectorNode, adapter);
    const updated = connectorRule.apply(connectorId, connectorNode, adapter);

    const busNode = updated.getNodeAttributes(defaultBusId);
    expect(busNode?.terraform?.resource).toBe('aws_cloudwatch_event_bus');
    expect(updated.edgesBetween(connectorId, defaultBusId)).toHaveLength(1);
  });

  it('shoud rewire event rule edges to the default bus when rule has no outbound edges', () => {
    const ruleId = asNodeId('resource.aws_cloudwatch_event_rule.primary');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [ruleId]: {
          id: ruleId,
          label: 'event_rule',
          terraform: {
            kind: 'resource',
            address: 'aws_cloudwatch_event_rule.primary',
            resource: 'aws_cloudwatch_event_rule',
            name: 'primary',
          },
        },
      },
      edges: [],
    });
    const rewireRule = buildMainRules()[1]!;
    const ruleNode = adapter.getNodeAttributes(ruleId);
    if (!ruleNode) {
      throw new Error('Missing aws_cloudwatch_event_rule node');
    }

    rewireRule.match(ruleId, ruleNode, adapter);
    const updated = rewireRule.apply(ruleId, ruleNode, adapter);

    const busNode = updated.getNodeAttributes(defaultBusId);
    expect(busNode?.terraform?.resource).toBe('aws_cloudwatch_event_bus');
    expect(updated.edgesBetween(defaultBusId, ruleId)).toHaveLength(1);
    const outboundToDefaultBus = updated
      .outEdges(ruleId)
      .filter((edgeId) => updated.edgeTarget(edgeId) === defaultBusId);
    expect(outboundToDefaultBus).toHaveLength(0);
  });

  it('shoud replace event rule to connector edges with default bus edges', () => {
    const ruleId = asNodeId('resource.aws_cloudwatch_event_rule.forward');
    const connectorId = asNodeId('resource.aws_transfer_connector.main');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [ruleId]: {
          id: ruleId,
          label: 'event_rule',
          terraform: {
            kind: 'resource',
            address: 'aws_cloudwatch_event_rule.forward',
            resource: 'aws_cloudwatch_event_rule',
            name: 'forward',
          },
        },
        [connectorId]: {
          id: connectorId,
          label: 'connector',
          terraform: {
            kind: 'resource',
            address: 'aws_transfer_connector.main',
            resource: 'aws_transfer_connector',
            name: 'main',
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-rule-connector'),
          from: ruleId,
          to: connectorId,
          attributes: {},
        },
      ],
    });
    const rewireRule = buildMainRules()[1]!;
    const ruleNode = adapter.getNodeAttributes(ruleId);
    if (!ruleNode) {
      throw new Error('Missing aws_cloudwatch_event_rule node');
    }

    rewireRule.match(ruleId, ruleNode, adapter);
    const updated = rewireRule.apply(ruleId, ruleNode, adapter);

    expect(updated.edgesBetween(ruleId, connectorId)).toHaveLength(0);
    expect(updated.edgesBetween(defaultBusId, ruleId)).toHaveLength(1);
  });

  it('shoud preserve non-connector event rule edges and still create the default bus', () => {
    const ruleId = asNodeId('resource.aws_cloudwatch_event_rule.unchanged');
    const targetId = asNodeId('resource.aws_lambda_function.handler');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [ruleId]: {
          id: ruleId,
          label: 'event_rule',
          terraform: {
            kind: 'resource',
            address: 'aws_cloudwatch_event_rule.unchanged',
            resource: 'aws_cloudwatch_event_rule',
            name: 'unchanged',
          },
        },
        [targetId]: {
          id: targetId,
          label: 'target',
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.handler',
            resource: 'aws_lambda_function',
            name: 'handler',
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-rule-target'),
          from: ruleId,
          to: targetId,
          attributes: {},
        },
      ],
    });
    const rewireRule = buildMainRules()[1]!;
    const ruleNode = adapter.getNodeAttributes(ruleId);
    if (!ruleNode) {
      throw new Error('Missing aws_cloudwatch_event_rule node');
    }

    rewireRule.match(ruleId, ruleNode, adapter);
    const updated = rewireRule.apply(ruleId, ruleNode, adapter);

    expect(updated.edgesBetween(ruleId, targetId)).toHaveLength(1);
    expect(updated.edgesBetween(defaultBusId, ruleId)).toHaveLength(0);
    expect(updated.getNodeAttributes(defaultBusId)).toBeDefined();
  });

  it('shoud do nothing when connector rule does not match', () => {
    const eventRuleId = asNodeId('resource.aws_cloudwatch_event_rule.primary');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [eventRuleId]: {
          id: eventRuleId,
          label: 'event_rule',
          terraform: {
            kind: 'resource',
            address: 'aws_cloudwatch_event_rule.primary',
            resource: 'aws_cloudwatch_event_rule',
            name: 'primary',
          },
        },
      },
      edges: [],
    });
    const connectorRule = buildMainRules()[0]!;
    const eventRuleNode = adapter.getNodeAttributes(eventRuleId);
    if (!eventRuleNode) {
      throw new Error('Missing aws_cloudwatch_event_rule node');
    }

    const updated = connectorRule.apply(eventRuleId, eventRuleNode, adapter);

    expect(updated).toBe(adapter);
    expect(updated.getNodeAttributes(defaultBusId)).toBeUndefined();
  });

  it('shoud do nothing when rewire rule does not match', () => {
    const eventRuleId = asNodeId('resource.aws_cloudwatch_event_rule.primary');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [eventRuleId]: {
          id: eventRuleId,
          label: 'event_rule',
          terraform: {
            kind: 'resource',
            address: 'aws_cloudwatch_event_rule.primary',
            resource: 'aws_cloudwatch_event_rule',
            name: 'primary',
          },
        },
      },
      edges: [],
    });
    const rewireRule = buildMainRules()[1]!;
    const eventRuleNode = adapter.getNodeAttributes(eventRuleId);
    if (!eventRuleNode) {
      throw new Error('Missing aws_cloudwatch_event_rule node');
    }

    const updated = rewireRule.apply(eventRuleId, eventRuleNode, adapter);

    expect(updated).toBe(adapter);
    expect(updated.getNodeAttributes(defaultBusId)).toBeUndefined();
  });
});
