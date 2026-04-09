import { NamedRuleRegistry, RemoveNode, RemoveNodeAndReconnectEdges } from '@terra-graph/core';

export const coreNamedRules = new NamedRuleRegistry({
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
            in: ['null_resource', 'local_file'],
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
  'core.remove.childless_modules': new RemoveNode({
    node: {
      and: [{ attr: { key: 'terraform.kind', eq: 'module' } }, { children: { exists: false } }],
    },
  }),
  // if used should be in a dot NamedRuleRegistry
  // 'dot.normalise_modules': new NodeDotProperties({
  //   options: {
  //     peripheries: 0,
  //     label: '',
  //     height: 0,
  //     width: 0,
  //   },
  //   node: {
  //     attr: {
  //       key: 'terraform.kind',
  //       eq: 'module',
  //     },
  //   },
  // }),
});
