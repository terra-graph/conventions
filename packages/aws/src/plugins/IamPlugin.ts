import {
  ConvertNodeToEdge,
  EdgeReverse,
  GraphPlugin,
  type GraphPluginBuildInput,
  type GraphPluginBuildResult,
  type NamedPhase,
  NodeProperties,
  RemoveLeafChain,
  RemoveNodeAndReconnectEdges,
} from '@terra-graph/core';
import { pluginId } from '../namespaces.js';

export const AWS_IAM_PLUGIN_MODES = ['roles_only', 'roles_policies', 'full'] as const;

export type AwsIamGraphPluginMode = (typeof AWS_IAM_PLUGIN_MODES)[number];

export const AWS_IAM_ATTACHMENT_MODES = ['remove', 'convert_to_edge', 'keep'] as const;

export type AwsIamAttachmentMode = (typeof AWS_IAM_ATTACHMENT_MODES)[number];

export const AWS_IAM_POLICY_DOCUMENT_MODES = ['none', 'trust_only', 'all'] as const;

export type AwsIamPolicyDocumentMode = (typeof AWS_IAM_POLICY_DOCUMENT_MODES)[number];

export type AwsIamGraphPluginOptions = {
  mode?: AwsIamGraphPluginMode;
  attachments?: AwsIamAttachmentMode;
  policyDocuments?: AwsIamPolicyDocumentMode;
  removeOrphans?: boolean;
};

const IAM_ROLE_RESOURCES = ['aws_iam_role'];
const IAM_POLICY_RESOURCES = ['aws_iam_policy', 'aws_iam_role_policy'];
const IAM_ATTACHMENT_RESOURCES = ['aws_iam_role_policy_attachment', 'aws_iam_policy_attachment'];
const IAM_POLICY_DOCUMENT_RESOURCE = 'aws_iam_policy_document';
const IAM_DATA_POLICY_RESOURCE = 'aws_iam_policy';
const IAM_ORPHAN_PRUNABLE_RESOURCES = [
  ...IAM_ROLE_RESOURCES,
  ...IAM_POLICY_RESOURCES,
  ...IAM_ATTACHMENT_RESOURCES,
];
const IAM_ORPHAN_PRUNABLE_DATA_RESOURCES = [IAM_POLICY_DOCUMENT_RESOURCE, IAM_DATA_POLICY_RESOURCE];

type ResolvedAwsIamGraphPluginOptions = {
  mode: AwsIamGraphPluginMode;
  attachments: AwsIamAttachmentMode;
  policyDocuments: AwsIamPolicyDocumentMode;
  removeOrphans: boolean;
};
type PluginPhases = NonNullable<GraphPluginBuildResult['phases']>;
type PluginRules = PluginPhases[number]['rules'];
type PluginRulePhases = PluginRules[];

export class IamPlugin extends GraphPlugin<AwsIamGraphPluginOptions> {
  static id = pluginId(`aws.${IamPlugin.name}`);

  constructor() {
    super(IamPlugin.id, {
      mode: 'roles_only',
    });
  }

  public override build({
    options,
  }: GraphPluginBuildInput<AwsIamGraphPluginOptions>): GraphPluginBuildResult {
    const resolved = this.resolveOptions(options);
    const phases: PluginPhases = [
      ...this.toPhases('normalize', this.buildIamDirectionPhases()),
      ...this.toPhases('main', this.buildIamLabelHintPhases()),
      ...this.toPhases('main', this.buildAttachmentPhases(resolved)),
    ];

    if (resolved.mode !== 'full') {
      phases.push(
        ...this.toPhases('main', [
          [
            new RemoveNodeAndReconnectEdges({
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
                        in: this.buildKeepResourcesForMode(resolved),
                      },
                    },
                  },
                ],
              },
            }),
          ],
        ]),
      );

      if (resolved.policyDocuments === 'trust_only') {
        phases.push(...this.toPhases('main', this.buildPolicyDocumentPhases(resolved)));
      }

      phases.push(...this.buildCleanupPhases(resolved));

      return { phases };
    }

    phases.push(...this.toPhases('main', this.buildPolicyDocumentPhases(resolved)));
    phases.push(...this.buildCleanupPhases(resolved));

    return { phases };
  }

  private toPhases(phase: NamedPhase, phases: PluginRulePhases): PluginPhases {
    return phases.map((rules) => ({ phase, rules }));
  }

  private isEnumValue<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
    return typeof value === 'string' && values.includes(value);
  }

  private resolveOptions(options: AwsIamGraphPluginOptions): ResolvedAwsIamGraphPluginOptions {
    const mode = options.mode ?? 'roles_only';
    if (!this.isEnumValue(mode, AWS_IAM_PLUGIN_MODES)) {
      throw new Error(
        `${this.name} options.mode must be one of: ${AWS_IAM_PLUGIN_MODES.join(', ')}`,
      );
    }

    const attachments = options.attachments ?? (mode === 'full' ? 'keep' : 'remove');
    if (!this.isEnumValue(attachments, AWS_IAM_ATTACHMENT_MODES)) {
      throw new Error(
        `${this.name} options.attachments must be one of: ${AWS_IAM_ATTACHMENT_MODES.join(', ')}`,
      );
    }

    const policyDocuments = options.policyDocuments ?? (mode === 'full' ? 'all' : 'none');
    if (!this.isEnumValue(policyDocuments, AWS_IAM_POLICY_DOCUMENT_MODES)) {
      throw new Error(
        `${this.name} options.policyDocuments must be one of: ${AWS_IAM_POLICY_DOCUMENT_MODES.join(
          ', ',
        )}`,
      );
    }

    const removeOrphans = options.removeOrphans ?? false;
    if (typeof removeOrphans !== 'boolean') {
      throw new Error(`${this.name} options.removeOrphans must be a boolean`);
    }

    return {
      mode,
      attachments,
      policyDocuments,
      removeOrphans,
    };
  }

  private buildKeepResourcesForMode(options: ResolvedAwsIamGraphPluginOptions): string[] {
    const keep = new Set<string>(IAM_ROLE_RESOURCES);

    if (options.mode === 'roles_policies') {
      for (const resource of IAM_POLICY_RESOURCES) {
        keep.add(resource);
      }
    }

    if (options.attachments === 'keep') {
      for (const resource of IAM_ATTACHMENT_RESOURCES) {
        keep.add(resource);
      }
    }

    if (options.policyDocuments !== 'none') {
      keep.add(IAM_POLICY_DOCUMENT_RESOURCE);
    }

    return [...keep];
  }

  private buildAttachmentPhases(options: ResolvedAwsIamGraphPluginOptions): PluginRulePhases {
    if (options.attachments === 'keep') {
      return [];
    }

    const phases: PluginRulePhases = [];

    if (options.attachments === 'convert_to_edge') {
      phases.push([
        new ConvertNodeToEdge({
          node: {
            attr: {
              key: 'terraform.resource',
              in: IAM_ATTACHMENT_RESOURCES,
            },
          },
        }),
      ]);
    }

    phases.push([
      new RemoveNodeAndReconnectEdges({
        node: {
          attr: {
            key: 'terraform.resource',
            in: IAM_ATTACHMENT_RESOURCES,
          },
        },
      }),
    ]);

    return phases;
  }

  private buildIamDirectionPhases(): PluginRulePhases {
    return [
      [
        new EdgeReverse({
          edge: {
            from: this.iamDataQuery(),
            to: this.iamResourceQuery('aws_iam_role_policy'),
          },
        }),
        new EdgeReverse({
          edge: {
            from: this.iamResourceQuery('aws_iam_role_policy'),
            to: this.iamResourceQuery('aws_iam_role_policy_attachment'),
          },
        }),
        new EdgeReverse({
          edge: {
            from: this.iamDataQuery(),
            to: this.iamResourceQuery('aws_iam_policy'),
          },
        }),
        new EdgeReverse({
          edge: {
            from: this.iamResourceQuery('aws_iam_policy'),
            to: this.iamResourceQuery('aws_iam_role_policy_attachment'),
          },
        }),
        new EdgeReverse({
          edge: {
            from: this.iamResourceQuery('aws_iam_policy'),
            to: this.iamResourceQuery('aws_iam_policy_attachment'),
          },
        }),
        new EdgeReverse({
          edge: {
            from: this.iamResourceQuery('aws_iam_role'),
            to: this.iamAttachmentQuery(),
          },
        }),
        new EdgeReverse({
          edge: {
            from: this.iamAttachmentQuery(),
            to: this.anyNonIamResourceQuery(),
          },
        }),
        new EdgeReverse({
          edge: {
            from: this.iamDataQuery(),
            to: this.iamResourceQuery('aws_iam_role'),
          },
        }),
        new EdgeReverse({
          edge: {
            from: this.iamResourceQuery('aws_iam_role'),
            to: this.anyNonIamResourceQuery(),
          },
        }),
      ],
    ];
  }

  private buildIamLabelHintPhases(): PluginRulePhases {
    return [
      [
        new NodeProperties({
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
        }),
      ],
    ];
  }

  private iamDataQuery() {
    return {
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
            startsWith: 'aws_iam_',
          },
        },
      ],
    };
  }

  private iamResourceQuery(resource: string) {
    return {
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
            eq: resource,
          },
        },
      ],
    };
  }

  private iamAttachmentQuery() {
    return {
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
            in: IAM_ATTACHMENT_RESOURCES,
          },
        },
      ],
    };
  }

  private anyNonIamResourceQuery() {
    return {
      and: [
        {
          attr: {
            key: 'terraform.kind',
            eq: 'resource',
          },
        },
        {
          not: {
            attr: {
              key: 'terraform.resource',
              startsWith: 'aws_iam_',
            },
          },
        },
      ],
    };
  }

  private orphanPrunableIamQuery() {
    return {
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
                in: IAM_ORPHAN_PRUNABLE_RESOURCES,
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
                in: IAM_ORPHAN_PRUNABLE_DATA_RESOURCES,
              },
            },
          ],
        },
      ],
    };
  }

  private buildCleanupPhases(options: ResolvedAwsIamGraphPluginOptions): PluginPhases {
    const phases: PluginPhases = [...this.toPhases('cleanup', this.buildIamDirectionPhases())];

    if (!options.removeOrphans) {
      return phases;
    }

    phases.push(
      ...this.toPhases('cleanup', [
        [
          new RemoveLeafChain({
            node: this.orphanPrunableIamQuery(),
          }),
        ],
      ]),
    );

    return phases;
  }

  private buildPolicyDocumentPhases(options: ResolvedAwsIamGraphPluginOptions): PluginRulePhases {
    if (options.policyDocuments === 'all') {
      return [];
    }

    if (options.policyDocuments === 'none') {
      return [
        [
          new RemoveNodeAndReconnectEdges({
            node: {
              attr: {
                key: 'terraform.resource',
                eq: IAM_POLICY_DOCUMENT_RESOURCE,
              },
            },
          }),
        ],
      ];
    }

    return [
      [
        new RemoveNodeAndReconnectEdges({
          node: {
            and: [
              {
                attr: {
                  key: 'terraform.resource',
                  eq: IAM_POLICY_DOCUMENT_RESOURCE,
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
        }),
      ],
    ];
  }
}
