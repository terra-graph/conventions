import {
  type BaseRule,
  type GraphPluginBuildInput,
  type NamedPhase,
  NamedRuleRegistry,
  NamedRuleSetRegistry,
  type SerializedRule,
} from '@terra-graph/core';
import { IamPlugin } from './IamPlugin.js';
import type { AwsIamGraphPluginOptions } from './IamPlugin.js';

type SerializedPhaseStep = {
  phase: NamedPhase;
  rules: SerializedRule[];
};

const buildPhases = (options: AwsIamGraphPluginOptions = {}): SerializedPhaseStep[] => {
  const plugin = new IamPlugin();
  const result = plugin.build({
    options,
    namedRules: new NamedRuleRegistry(),
    namedRuleSets: new NamedRuleSetRegistry(),
  });

  return (result.phases ?? []).map((phase) => ({
    phase: phase.phase,
    rules: phase.rules.map((rule) => (rule as BaseRule).serialize()),
  }));
};

describe('AwsIamGraphPlugin.build', () => {
  it('shoud default to a roles_only projection without semantics', () => {
    const phases = buildPhases();

    expect(phases).toHaveLength(5);
    expect(phases.map((phase) => phase.phase)).toStrictEqual([
      'main',
      'main',
      'main',
      'main',
      'main',
    ]);
    expect(phases[0]?.rules).toHaveLength(9);
    expect(phases[0]?.rules.every((rule) => rule.id === 'EdgeReverse')).toBe(true);
    expect(phases[1]?.rules[0]).toStrictEqual({
      id: 'NodeProperties',
      config: {
        node: {
          and: [
            {
              attr: {
                key: 'terraform.kind',
                in: ['resource', 'data'],
              },
            },
            {
              attr: {
                key: 'terraform.resource',
                startsWith: 'aws_iam_',
              },
            },
            {
              attr: {
                key: 'terraform.moduleAddress',
                exists: true,
              },
            },
          ],
        },
        options: {
          hints: {
            label: {
              end: {
                from: 'terraform.name',
              },
            },
          },
        },
      },
    });
    expect(phases[2]?.rules[0]).toStrictEqual({
      id: 'RemoveNodeAndReconnectEdges',
      config: {
        node: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_iam_role_policy_attachment', 'aws_iam_policy_attachment'],
          },
        },
      },
    });
    expect(phases[3]?.rules[0]).toStrictEqual({
      id: 'RemoveNodeAndReconnectEdges',
      config: {
        node: {
          and: [
            {
              attr: {
                key: 'terraform.resource',
                startsWith: 'aws_iam_',
              },
            },
            {
              not: {
                attr: {
                  key: 'terraform.resource',
                  in: ['aws_iam_role'],
                },
              },
            },
          ],
        },
      },
    });
    expect(phases[4]?.rules).toHaveLength(9);
    expect(phases[4]?.rules.every((rule) => rule.id === 'EdgeReverse')).toBe(true);
  });

  it('shoud keep attachments and policies when configured for roles_policies', () => {
    const phases = buildPhases({
      mode: 'roles_policies',
      attachments: 'keep',
    });

    expect(phases).toHaveLength(4);
    expect(phases[0]?.phase).toBe('main');
    expect(phases[0]?.rules).toHaveLength(9);
    expect(phases[1]?.phase).toBe('main');
    expect(phases[1]?.rules[0]?.id).toBe('NodeProperties');
    expect(phases[2]?.phase).toBe('main');
    expect(phases[2]?.rules[0]).toStrictEqual({
      id: 'RemoveNodeAndReconnectEdges',
      config: {
        node: {
          and: [
            {
              attr: {
                key: 'terraform.resource',
                startsWith: 'aws_iam_',
              },
            },
            {
              not: {
                attr: {
                  key: 'terraform.resource',
                  in: [
                    'aws_iam_role',
                    'aws_iam_policy',
                    'aws_iam_role_policy',
                    'aws_iam_role_policy_attachment',
                    'aws_iam_policy_attachment',
                  ],
                },
              },
            },
          ],
        },
      },
    });
    expect(phases[3]?.phase).toBe('main');
    expect(phases[3]?.rules.every((rule) => rule.id === 'EdgeReverse')).toBe(true);
  });

  it('shoud build no phases for full mode defaults', () => {
    const phases = buildPhases({
      mode: 'full',
    });

    expect(phases).toHaveLength(3);
    expect(phases[0]?.phase).toBe('main');
    expect(phases[0]?.rules).toHaveLength(9);
    expect(phases[1]?.phase).toBe('main');
    expect(phases[1]?.rules[0]?.id).toBe('NodeProperties');
    expect(phases[2]?.phase).toBe('main');
    expect(phases[2]?.rules.every((rule) => rule.id === 'EdgeReverse')).toBe(true);
  });

  it('shoud support convert_to_edge attachments with policy document removal in full mode', () => {
    const phases = buildPhases({
      mode: 'full',
      attachments: 'convert_to_edge',
      policyDocuments: 'none',
    });

    expect(phases.map((phase) => phase.phase)).toStrictEqual([
      'main',
      'main',
      'main',
      'main',
      'main',
      'main',
    ]);
    expect(phases.map((phase) => phase.rules[0]?.id)).toStrictEqual([
      'EdgeReverse',
      'NodeProperties',
      'ConvertNodeToEdge',
      'RemoveNodeAndReconnectEdges',
      'RemoveNodeAndReconnectEdges',
      'EdgeReverse',
    ]);
    expect(phases[4]?.rules[0]).toStrictEqual({
      id: 'RemoveNodeAndReconnectEdges',
      config: {
        node: {
          attr: {
            key: 'terraform.resource',
            eq: 'aws_iam_policy_document',
          },
        },
      },
    });
  });

  it('shoud keep only trust policy documents when trust_only is configured', () => {
    const phases = buildPhases({
      mode: 'full',
      policyDocuments: 'trust_only',
    });

    expect(phases).toHaveLength(4);
    expect(phases[0]?.phase).toBe('main');
    expect(phases[0]?.rules).toHaveLength(9);
    expect(phases[1]?.phase).toBe('main');
    expect(phases[1]?.rules[0]?.id).toBe('NodeProperties');
    expect(phases[2]?.phase).toBe('main');
    expect(phases[2]?.rules[0]).toStrictEqual({
      id: 'RemoveNodeAndReconnectEdges',
      config: {
        node: {
          and: [
            {
              attr: {
                key: 'terraform.resource',
                eq: 'aws_iam_policy_document',
              },
            },
            {
              not: {
                or: [
                  {
                    edge: {
                      in: {
                        attr: {
                          key: 'terraform.resource',
                          eq: 'aws_iam_role',
                        },
                      },
                    },
                  },
                  {
                    edge: {
                      out: {
                        attr: {
                          key: 'terraform.resource',
                          eq: 'aws_iam_role',
                        },
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    });
    expect(phases[3]?.phase).toBe('main');
    expect(phases[3]?.rules.every((rule) => rule.id === 'EdgeReverse')).toBe(true);
  });

  it('shoud keep policy documents in non-full trust_only mode', () => {
    const phases = buildPhases({
      mode: 'roles_only',
      policyDocuments: 'trust_only',
    });

    expect(phases.map((phase) => phase.phase)).toStrictEqual([
      'main',
      'main',
      'main',
      'main',
      'main',
      'main',
    ]);
    expect(phases[3]?.rules[0]).toStrictEqual({
      id: 'RemoveNodeAndReconnectEdges',
      config: {
        node: {
          and: [
            {
              attr: {
                key: 'terraform.resource',
                startsWith: 'aws_iam_',
              },
            },
            {
              not: {
                attr: {
                  key: 'terraform.resource',
                  in: ['aws_iam_role', 'aws_iam_policy_document'],
                },
              },
            },
          ],
        },
      },
    });
    expect(phases[4]?.rules[0]).toStrictEqual({
      id: 'RemoveNodeAndReconnectEdges',
      config: {
        node: {
          and: [
            {
              attr: {
                key: 'terraform.resource',
                eq: 'aws_iam_policy_document',
              },
            },
            {
              not: {
                or: [
                  {
                    edge: {
                      in: {
                        attr: {
                          key: 'terraform.resource',
                          eq: 'aws_iam_role',
                        },
                      },
                    },
                  },
                  {
                    edge: {
                      out: {
                        attr: {
                          key: 'terraform.resource',
                          eq: 'aws_iam_role',
                        },
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    });
  });

  it('shoud throw for invalid option values', () => {
    const plugin = new IamPlugin();

    expect(() =>
      plugin.build({
        options: { mode: 'invalid' } as unknown as AwsIamGraphPluginOptions,
        namedRules: new NamedRuleRegistry(),
        namedRuleSets: new NamedRuleSetRegistry(),
      } as GraphPluginBuildInput<AwsIamGraphPluginOptions>),
    ).toThrow(`${IamPlugin.id} options.mode must be one of: roles_only, roles_policies, full`);

    expect(() =>
      plugin.build({
        options: {
          removeOrphans: 'yes',
        } as unknown as AwsIamGraphPluginOptions,
        namedRules: new NamedRuleRegistry(),
        namedRuleSets: new NamedRuleSetRegistry(),
      } as GraphPluginBuildInput<AwsIamGraphPluginOptions>),
    ).toThrow(`${IamPlugin.id} options.removeOrphans must be a boolean`);
  });

  it('shoud throw for invalid attachment mode values', () => {
    const plugin = new IamPlugin();

    expect(() =>
      plugin.build({
        options: {
          attachments: 'invalid',
        } as unknown as AwsIamGraphPluginOptions,
        namedRules: new NamedRuleRegistry(),
        namedRuleSets: new NamedRuleSetRegistry(),
      } as GraphPluginBuildInput<AwsIamGraphPluginOptions>),
    ).toThrow(`${IamPlugin.id} options.attachments must be one of: remove, convert_to_edge, keep`);
  });

  it('shoud throw for invalid policy document mode values', () => {
    const plugin = new IamPlugin();

    expect(() =>
      plugin.build({
        options: {
          policyDocuments: 'invalid',
        } as unknown as AwsIamGraphPluginOptions,
        namedRules: new NamedRuleRegistry(),
        namedRuleSets: new NamedRuleSetRegistry(),
      } as GraphPluginBuildInput<AwsIamGraphPluginOptions>),
    ).toThrow(`${IamPlugin.id} options.policyDocuments must be one of: none, trust_only, all`);
  });

  it('shoud keep attachment resources when full mode is configured as keep', () => {
    const phases = buildPhases({
      mode: 'full',
      attachments: 'keep',
    });

    expect(phases).toHaveLength(3);
    expect(phases.map((phase) => phase.phase)).toStrictEqual(['main', 'main', 'main']);
    expect(phases[1]?.rules).toHaveLength(1);
    expect(phases[1]?.rules[0]?.id).toBe('NodeProperties');
    expect(phases[2]?.rules).toHaveLength(9);
    expect(phases[2]?.rules.every((rule) => rule.id === 'EdgeReverse')).toBe(true);
  });

  it('shoud remove attachment nodes explicitly when full mode uses remove', () => {
    const phases = buildPhases({
      mode: 'full',
      attachments: 'remove',
    });

    expect(phases).toHaveLength(4);
    expect(phases.map((phase) => phase.phase)).toStrictEqual(['main', 'main', 'main', 'main']);
    expect(phases[2]?.rules[0]).toStrictEqual({
      id: 'RemoveNodeAndReconnectEdges',
      config: {
        node: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_iam_role_policy_attachment', 'aws_iam_policy_attachment'],
          },
        },
      },
    });
  });

  it('shoud add a final orphan cleanup phase when removeOrphans is enabled', () => {
    const phases = buildPhases({
      mode: 'roles_only',
      removeOrphans: true,
    });

    expect(phases).toHaveLength(6);
    expect(phases.map((phase) => phase.phase)).toStrictEqual([
      'main',
      'main',
      'main',
      'main',
      'main',
      'main',
    ]);
    expect(phases[5]?.rules[0]).toStrictEqual({
      id: 'RemoveLeafChain',
      config: {
        node: {
          or: [
            {
              and: [
                {
                  attr: {
                    key: 'terraform.kind',
                    eq: 'resource',
                  },
                },
                {
                  attr: {
                    key: 'terraform.resource',
                    in: [
                      'aws_iam_role',
                      'aws_iam_policy',
                      'aws_iam_role_policy',
                      'aws_iam_role_policy_attachment',
                      'aws_iam_policy_attachment',
                    ],
                  },
                },
              ],
            },
            {
              and: [
                {
                  attr: {
                    key: 'terraform.kind',
                    eq: 'data',
                  },
                },
                {
                  attr: {
                    key: 'terraform.resource',
                    in: ['aws_iam_policy_document', 'aws_iam_policy'],
                  },
                },
              ],
            },
          ],
        },
      },
    });
  });

  it('shoud not add orphan cleanup when removeOrphans is false', () => {
    const phases = buildPhases({
      mode: 'roles_only',
      removeOrphans: false,
    });

    expect(phases).toHaveLength(5);
    expect(phases.map((phase) => phase.phase)).toContain('main');
    expect(phases.map((phase) => phase.rules[0]?.id)).not.toContain('RemoveLeafChain');
    expect(phases[4]?.rules[0]?.id).toBe('EdgeReverse');
  });
});
