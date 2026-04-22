import { NamedRuleRegistry, RemoveNode, RemoveNodeAndReconnectEdges } from '@terra-graph/core';
import { CollapseIndexedResourceTemplates } from './Rules/Node/CollapseIndexedResourceTemplates.js';

export const coreNamedRules = new NamedRuleRegistry({
  'core.remove.outputs': new RemoveNode({
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
  'core.remove.tfconfig': new RemoveNode({
    node: {
      or: [
        {
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
        {
          attr: {
            key: 'terraform.resource',
            in: ['null_resource'],
          },
        },
      ],
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
});
