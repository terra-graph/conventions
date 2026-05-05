import {
  GraphologyAdapter,
  TG_SCHEMA_VERSION,
  type TgGraph,
  asEdgeId,
  asNodeId,
} from '@terra-graph/core';
import { CollapseIndexedResourceTemplates } from './CollapseIndexedResourceTemplates.js';

describe('CollapseIndexedResourceTemplates.apply', () => {
  it('should keep graph unchanged when node was not matched', () => {
    const template = asNodeId('resource.module.fn.aws_lambda_function.this');

    const tg: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [template]: {
          id: template,
          label: 'template',
          terraform: { kind: 'resource', address: 'module.fn.aws_lambda_function.this' },
        },
      },
      edges: [],
    };

    const adapter = new GraphologyAdapter().withTgGraph(tg);
    const node = adapter.getNodeAttributes(template);
    if (!node) {
      throw new Error('Missing node attributes for template node');
    }

    const rule = new CollapseIndexedResourceTemplates({
      node: { nodeId: { eq: 'resource.other' } },
    });

    const result = rule.apply(template, node, adapter);

    expect(result.getNodeAttributes(template)).toEqual(node);
  });

  it('should ignore non-resource nodes', () => {
    const moduleNode = asNodeId('module.fn');

    const tg: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [moduleNode]: {
          id: moduleNode,
          label: 'module.fn',
          terraform: { kind: 'module', address: 'module.fn' },
        },
      },
      edges: [],
    };

    const adapter = new GraphologyAdapter().withTgGraph(tg);
    const node = adapter.getNodeAttributes(moduleNode);
    if (!node) {
      throw new Error('Missing node attributes for module node');
    }

    const rule = new CollapseIndexedResourceTemplates({
      node: { nodeId: { eq: moduleNode.toString() } },
    });

    rule.match(moduleNode, node, adapter);
    const result = rule.apply(moduleNode, node, adapter);

    expect(result.getNodeAttributes(moduleNode)).toEqual(node);
  });

  it('should ignore resource nodes without terraform address', () => {
    const resourceNode = asNodeId('resource.aws_lambda_function.missing_address');

    const tg: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [resourceNode]: {
          id: resourceNode,
          label: 'missing address',
          terraform: { kind: 'resource' },
        },
      },
      edges: [],
    };

    const adapter = new GraphologyAdapter().withTgGraph(tg);
    const node = adapter.getNodeAttributes(resourceNode);
    if (!node) {
      throw new Error('Missing node attributes for resource node');
    }

    const rule = new CollapseIndexedResourceTemplates({
      node: { nodeId: { eq: resourceNode.toString() } },
    });

    rule.match(resourceNode, node, adapter);
    const result = rule.apply(resourceNode, node, adapter);

    expect(result.getNodeAttributes(resourceNode)).toEqual(node);
  });

  it('should keep graph unchanged when no indexed resource instances exist', () => {
    const source = asNodeId('resource.aws_iam_role.source');
    const template = asNodeId('resource.module.fn.aws_lambda_function.this');
    const target = asNodeId('resource.aws_lambda_permission.invoke');

    const tg: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [source]: {
          id: source,
          label: 'source',
          terraform: { kind: 'resource', address: 'aws_iam_role.source' },
        },
        [template]: {
          id: template,
          label: 'template',
          terraform: {
            kind: 'resource',
            address: 'module.fn.aws_lambda_function.this',
            resource: 'aws_lambda_function',
            name: 'this',
          },
        },
        [target]: {
          id: target,
          label: 'target',
          terraform: { kind: 'resource', address: 'aws_lambda_permission.invoke' },
        },
      },
      edges: [
        { id: asEdgeId('edge-in'), from: source, to: template, attributes: {} },
        { id: asEdgeId('edge-out'), from: template, to: target, attributes: {} },
      ],
    };

    const adapter = new GraphologyAdapter().withTgGraph(tg);
    const node = adapter.getNodeAttributes(template);
    if (!node) {
      throw new Error('Missing node attributes for template node');
    }

    const rule = new CollapseIndexedResourceTemplates({
      node: { nodeId: { eq: template.toString() } },
    });

    rule.match(template, node, adapter);
    const result = rule.apply(template, node, adapter);

    expect(result.getNodeAttributes(template)).toEqual(node);
    expect(result.edgesBetween(source, template)).toHaveLength(1);
    expect(result.edgesBetween(template, target)).toHaveLength(1);
  });

  it('should ignore non-resource sibling candidates while checking indexed instances', () => {
    const template = asNodeId('resource.module.fn.aws_lambda_function.this');
    const siblingModule = asNodeId('module.fn');

    const tg: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [template]: {
          id: template,
          label: 'template',
          terraform: {
            kind: 'resource',
            address: 'module.fn.aws_lambda_function.this',
            resource: 'aws_lambda_function',
            name: 'this',
          },
        },
        [siblingModule]: {
          id: siblingModule,
          label: 'module.fn',
          terraform: { kind: 'module', address: 'module.fn' },
        },
      },
      edges: [],
    };

    const adapter = new GraphologyAdapter().withTgGraph(tg);
    const node = adapter.getNodeAttributes(template);
    if (!node) {
      throw new Error('Missing node attributes for template node');
    }

    const rule = new CollapseIndexedResourceTemplates({
      node: { nodeId: { eq: template.toString() } },
    });

    rule.match(template, node, adapter);
    const result = rule.apply(template, node, adapter);

    expect(result.getNodeAttributes(template)).toEqual(node);
  });

  it('should remove template node and reconnect edges when indexed instances exist', () => {
    const source = asNodeId('resource.aws_iam_role.source');
    const template = asNodeId('resource.module.fn.aws_lambda_function.this');
    const indexedOther = asNodeId('resource.module.other.aws_lambda_function.this[0]');
    const indexed = asNodeId('resource.module.fn.aws_lambda_function.this[0]');
    const moduleNode = asNodeId('module.fn');
    const target = asNodeId('resource.aws_lambda_permission.invoke');

    const tg: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [source]: {
          id: source,
          label: 'source',
          terraform: { kind: 'resource', address: 'aws_iam_role.source' },
        },
        [template]: {
          id: template,
          label: 'template',
          terraform: {
            kind: 'resource',
            address: 'module.fn.aws_lambda_function.this',
            resource: 'aws_lambda_function',
            name: 'this',
          },
        },
        [indexed]: {
          id: indexed,
          label: 'indexed',
          terraform: {
            kind: 'resource',
            address: 'module.fn.aws_lambda_function.this[0]',
            resource: 'aws_lambda_function',
            name: 'this',
          },
        },
        [indexedOther]: {
          id: indexedOther,
          label: 'indexed-other',
          terraform: {
            kind: 'resource',
            address: 'module.other.aws_lambda_function.this[0]',
            resource: 'aws_lambda_function',
            name: 'this',
          },
        },
        [moduleNode]: {
          id: moduleNode,
          label: 'module.fn',
          terraform: { kind: 'module', address: 'module.fn' },
        },
        [target]: {
          id: target,
          label: 'target',
          terraform: { kind: 'resource', address: 'aws_lambda_permission.invoke' },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-in'),
          from: source,
          to: template,
          attributes: { inAttr: 'in', shared: 'from-in' },
        },
        {
          id: asEdgeId('edge-out'),
          from: template,
          to: target,
          attributes: { outAttr: 'out', shared: 'from-out' },
        },
      ],
    };

    const adapter = new GraphologyAdapter().withTgGraph(tg);
    const node = adapter.getNodeAttributes(template);
    if (!node) {
      throw new Error('Missing node attributes for template node');
    }

    const rule = new CollapseIndexedResourceTemplates({
      node: { nodeId: { eq: template.toString() } },
    });

    rule.match(template, node, adapter);
    const result = rule.apply(template, node, adapter);

    expect(result.getNodeAttributes(template)).toBeUndefined();
    expect(result.getNodeAttributes(indexed)).toBeDefined();
    expect(result.edgesBetween(source, target)).toHaveLength(1);

    const redirectedEdge = result.edgesBetween(source, target)[0];
    expect(result.getEdgeAttributes(redirectedEdge)).toEqual({
      inAttr: 'in',
      outAttr: 'out',
      shared: 'from-out',
    });
  });

  it('should ignore indexed resource nodes', () => {
    const indexed = asNodeId('resource.module.fn.aws_lambda_function.this[0]');

    const tg: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [indexed]: {
          id: indexed,
          label: 'indexed',
          terraform: {
            kind: 'resource',
            address: 'module.fn.aws_lambda_function.this[0]',
            resource: 'aws_lambda_function',
            name: 'this',
          },
        },
      },
      edges: [],
    };

    const adapter = new GraphologyAdapter().withTgGraph(tg);
    const node = adapter.getNodeAttributes(indexed);
    if (!node) {
      throw new Error('Missing node attributes for indexed node');
    }

    const rule = new CollapseIndexedResourceTemplates({
      node: { nodeId: { eq: indexed.toString() } },
    });

    rule.match(indexed, node, adapter);
    const result = rule.apply(indexed, node, adapter);

    expect(result.getNodeAttributes(indexed)).toEqual(node);
  });

  it('should not create self-loop edges when collapsing a template', () => {
    const external = asNodeId('resource.aws_sns_topic.external');
    const template = asNodeId('resource.module.fn.aws_lambda_function.this');
    const indexed = asNodeId('resource.module.fn.aws_lambda_function.this[0]');

    const tg: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [external]: {
          id: external,
          label: 'external',
          terraform: { kind: 'resource', address: 'aws_sns_topic.external' },
        },
        [template]: {
          id: template,
          label: 'template',
          terraform: {
            kind: 'resource',
            address: 'module.fn.aws_lambda_function.this',
            resource: 'aws_lambda_function',
            name: 'this',
          },
        },
        [indexed]: {
          id: indexed,
          label: 'indexed',
          terraform: {
            kind: 'resource',
            address: 'module.fn.aws_lambda_function.this[0]',
            resource: 'aws_lambda_function',
            name: 'this',
          },
        },
      },
      edges: [
        { id: asEdgeId('edge-ext-template'), from: external, to: template, attributes: {} },
        { id: asEdgeId('edge-template-ext'), from: template, to: external, attributes: {} },
      ],
    };

    const adapter = new GraphologyAdapter().withTgGraph(tg);
    const node = adapter.getNodeAttributes(template);
    if (!node) {
      throw new Error('Missing node attributes for template node');
    }

    const rule = new CollapseIndexedResourceTemplates({
      node: { nodeId: { eq: template.toString() } },
    });

    rule.match(template, node, adapter);
    const result = rule.apply(template, node, adapter);

    expect(result.getNodeAttributes(template)).toBeUndefined();
    expect(result.edgesBetween(external, external)).toHaveLength(0);
  });
});
