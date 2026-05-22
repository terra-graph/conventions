import {
  NamedRuleRegistry,
  RemoveNode,
  RemoveNodeAndReconnectEdges,
  RemoveSelfLoopEdges,
} from '@terra-graph/core';
import { CollapseIndexedResourceTemplates } from './Rules/Node/CollapseIndexedResourceTemplates.js';
import { MaterializeCardinalityResources } from './Rules/Node/MaterializeCardinalityResources.js';

export const coreNamedRules = new NamedRuleRegistry({
  'core.remove.outputs': new RemoveNodeAndReconnectEdges({
    node: {
      attr: {
        key: 'terraform.kind',
        in: ['output'],
      },
    },
  }),
  'core.remove.providers': new RemoveNode({
    node: {
      attr: {
        key: 'terraform.kind',
        in: ['provider'],
      },
    },
  }),
  'core.remove.root': new RemoveNode({
    node: {
      attr: {
        key: 'terraform.kind',
        in: ['root'],
      },
    },
  }),
  'core.remove.artifacts': new RemoveNode({
    node: {
      attr: {
        key: 'terraform.resource',
        in: ['archive_file', 'local_file'],
      },
    },
  }),
  'core.remove.tfconfig': new RemoveNodeAndReconnectEdges({
    node: {
      attr: {
        key: 'terraform.kind',
        in: [
          // 'data',
          'local',
          'var',
          'terraform_data',
        ],
      },
    },
  }),
  'core.remove.tfconfig_artifacts': new RemoveNode({
    node: {
      attr: {
        key: 'terraform.resource',
        in: ['null_resource'],
      },
    },
  }),
  'core.reconnect.time_sleep': new RemoveNodeAndReconnectEdges({
    node: {
      attr: {
        key: 'terraform.resource',
        eq: 'time_sleep',
      },
    },
  }),
  'core.materialize.cardinality_resources': new MaterializeCardinalityResources({
    node: {
      any: true,
    },
  }),
  'core.collapse.indexed_resource_templates': new CollapseIndexedResourceTemplates({
    node: {
      attr: {
        key: 'terraform.kind',
        eq: 'resource',
      },
    },
  }),
  'core.remove.childless_modules': new RemoveNode({
    node: {
      and: [{ attr: { key: 'terraform.kind', eq: 'module' } }, { children: { exists: false } }],
    },
  }),
  'core.remove.self_loops': new RemoveSelfLoopEdges({
    edge: {
      from: { any: true },
      to: { any: true },
    },
  }),
});
