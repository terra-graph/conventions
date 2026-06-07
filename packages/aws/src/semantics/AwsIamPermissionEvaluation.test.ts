import {
  GraphologyAdapter,
  TG_SCHEMA_VERSION,
  type TgGraph,
  asEdgeId,
  asNodeId,
} from '@terra-graph/core';
import { DirectedGraph } from 'graphology';
import {
  __testing,
  evaluateAwsIamPermissions,
  normalizeAwsIamPermissionDecoratorConfig,
  shouldEvaluateSubject,
  subjectProjectionNamesFor,
} from './AwsIamPermissionEvaluation.js';

const buildAdapter = (graph: TgGraph) =>
  new GraphologyAdapter(
    new DirectedGraph() as unknown as ConstructorParameters<typeof GraphologyAdapter>[0],
  ).withTgGraph(graph);

const createMockGraph = (
  nodes: Record<string, unknown>,
  edges: Array<{ id: string; from: string; to: string; attributes?: Record<string, unknown> }>,
) =>
  ({
    nodeIds: () => Object.keys(nodes),
    getNodeAttributes: (nodeId: string) => nodes[nodeId],
    outEdges: (nodeId: string) =>
      edges.filter((edge) => edge.from === nodeId).map((edge) => edge.id),
    inEdges: (nodeId: string) => edges.filter((edge) => edge.to === nodeId).map((edge) => edge.id),
    edgeTarget: (edgeId: string) => edges.find((edge) => edge.id === edgeId)?.to,
    edgeSource: (edgeId: string) => edges.find((edge) => edge.id === edgeId)?.from,
    getEdgeAttributes: (edgeId: string) =>
      edges.find((edge) => edge.id === edgeId)?.attributes ?? {},
  }) as never;

describe('AwsIamPermissionEvaluation helpers', () => {
  it('should normalize config and subject filters', () => {
    expect(normalizeAwsIamPermissionDecoratorConfig(undefined)).toStrictEqual({});
    expect(
      normalizeAwsIamPermissionDecoratorConfig({
        capabilities: ['s3_write', 'invalid', 'sqs_send'],
        subjects: [
          {
            resourceTypes: ['aws_lambda_function', 'aws_lambda_function', ''],
            projectionNames: ['aws.lambda', 'aws.lambda', ''],
          },
          {
            resourceTypes: [],
          },
          'invalid',
        ],
      }),
    ).toStrictEqual({
      capabilities: ['s3_write', 'sqs_send'],
      subjects: [
        {
          resourceTypes: ['aws_lambda_function'],
          projectionNames: ['aws.lambda'],
        },
      ],
    });

    expect(subjectProjectionNamesFor({}, undefined)).toBeUndefined();
    expect(
      subjectProjectionNamesFor(
        {
          subjects: [{ resourceTypes: ['aws_lambda_function'], projectionNames: ['aws.lambda'] }],
        },
        'aws_lambda_function',
      ),
    ).toStrictEqual(['aws.lambda']);

    expect(
      shouldEvaluateSubject({}, { terraform: { resource: 'aws_lambda_function' } } as never),
    ).toBe(false);
    expect(shouldEvaluateSubject({}, undefined)).toBe(false);
    expect(
      shouldEvaluateSubject({ subjects: [{ resourceTypes: ['aws_lambda_function'] }] }, {
        terraform: { kind: 'resource', resource: 'aws_lambda_function' },
      } as never),
    ).toBe(true);
    expect(
      normalizeAwsIamPermissionDecoratorConfig({
        subjects: [{ resourceTypes: ['aws_lambda_function'] }],
      }),
    ).toStrictEqual({
      capabilities: undefined,
      subjects: [{ resourceTypes: ['aws_lambda_function'], projectionNames: undefined }],
    });
  });

  it('should cover basic parsing and target helper functions', () => {
    expect(
      __testing.uniqueTargetMatches([
        {
          targetNodeId: asNodeId('queue'),
          matchMode: 'wildcard_arn',
          matchCertainty: 60,
        },
        {
          targetNodeId: asNodeId('queue'),
          matchMode: 'exact_arn',
          matchCertainty: 60,
        },
      ]),
    ).toStrictEqual([
      {
        targetNodeId: asNodeId('queue'),
        matchMode: 'exact_arn',
        matchCertainty: 60,
      },
    ]);
    expect(
      __testing.strongerTargetMatch(undefined, {
        targetNodeId: asNodeId('queue'),
        matchMode: 'graph_fallback',
        matchCertainty: 0,
      }),
    ).toStrictEqual({
      targetNodeId: asNodeId('queue'),
      matchMode: 'graph_fallback',
      matchCertainty: 0,
    });
    expect(__testing.toArrayOfStrings('value')).toStrictEqual(['value']);
    expect(__testing.toArrayOfStrings({})).toStrictEqual([]);
    expect(__testing.matchCertaintyForPattern('abc', '')).toBe(0);
    expect(
      __testing.matchCertaintyForPattern('arn:aws:sqs:*', 'arn:aws:sqs:eu-west-2:1:q'),
    ).toBeGreaterThan(0);
    expect(__testing.parseJsonObject('{')).toBeUndefined();
    expect(__testing.parseJsonObject('[]')).toBeUndefined();
    expect(__testing.parseJsonObject('{"ok":true}')).toStrictEqual({ ok: true });
    expect(__testing.parseJsonArrayOfStrings({})).toStrictEqual([]);
    expect(__testing.parseJsonArrayOfStrings(['one', 2, 'two'])).toStrictEqual(['one', 'two']);

    const bucketNode = {
      terraform: {
        resource: 'aws_s3_bucket',
        state: {
          effective: {
            values: {
              bucket: 'example-bucket',
            },
          },
        },
      },
    } as never;
    expect(__testing.resolveBucketArn(bucketNode)).toBe('arn:aws:s3:::example-bucket');
    expect(
      __testing.resolveBucketArn({ terraform: { resource: 'aws_s3_bucket' } } as never),
    ).toBeUndefined();
    expect(
      __testing.resolveBucketArn({
        terraform: {
          resource: 'aws_s3_bucket',
          state: {
            effective: {
              values: {},
            },
          },
        },
      } as never),
    ).toBeUndefined();

    expect(__testing.resolveTargetNames(bucketNode)).toStrictEqual(['example-bucket']);
    expect(
      __testing.resolveTargetNames({
        terraform: {
          resource: 'aws_sqs_queue',
          state: {
            effective: { values: { name: 'queue' } },
            instances: [{ values: { name: 'queue-2' } }],
          },
        },
      } as never),
    ).toStrictEqual(['queue', 'queue-2']);
    expect(
      __testing.resolveTargetNames({
        terraform: {
          resource: 'aws_cloudwatch_event_bus',
          state: { effective: { values: { name: 'bus' } } },
        },
      } as never),
    ).toStrictEqual(['bus']);
    expect(
      __testing.resolveTargetNames({ terraform: { resource: 'aws_lambda_function' } } as never),
    ).toStrictEqual([]);

    expect(
      __testing.resourceNamePatternFromArnPattern(
        'aws_sqs_queue',
        'arn:aws:sqs:eu-west-2:123456789012:queue-*',
      ),
    ).toBe('queue-*');
    expect(
      __testing.resourceNamePatternFromArnPattern(
        'aws_cloudwatch_event_bus',
        'arn:aws:events:eu-west-2:123456789012:event-bus/custom',
      ),
    ).toBe('custom');
    expect(
      __testing.resourceNamePatternFromArnPattern('aws_s3_bucket', 'arn:aws:s3:::bucket-name/path'),
    ).toBe('bucket-name');
    expect(
      __testing.resourceNamePatternFromArnPattern('aws_lambda_function', 'arn:aws:lambda'),
    ).toBeUndefined();

    expect(
      __testing.resolveSupportedTargetArns({
        terraform: {
          resource: 'aws_s3_bucket',
          state: { effective: { values: { bucket: 'bucket-name' } } },
        },
      } as never),
    ).toStrictEqual(['arn:aws:s3:::bucket-name', 'arn:aws:s3:::bucket-name/*']);
    expect(
      __testing.resolveSupportedTargetArns({
        terraform: {
          resource: 'aws_sqs_queue',
          state: {
            effective: { values: { arn: 'arn:aws:sqs:eu-west-2:123456789012:q1' } },
            instances: [{ values: { arn: 'arn:aws:sqs:eu-west-2:123456789012:q2' } }],
          },
        },
      } as never),
    ).toStrictEqual([
      'arn:aws:sqs:eu-west-2:123456789012:q1',
      'arn:aws:sqs:eu-west-2:123456789012:q2',
    ]);
    expect(
      __testing.resolveSupportedTargetArns({
        terraform: {
          resource: 'aws_s3_bucket',
          state: {
            effective: {
              values: {},
            },
          },
        },
      } as never),
    ).toStrictEqual([]);
    expect(
      __testing.resolveSupportedTargetArns({
        terraform: { resource: 'aws_lambda_function' },
      } as never),
    ).toStrictEqual([]);
  });

  it('should classify supported targets and dead-letter queues', () => {
    const sourceQueueId = asNodeId('source');
    const deadLetterQueueId = asNodeId('dead-letter');
    const redriveAllowQueueId = asNodeId('allow-policy-target');
    const graph = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [sourceQueueId]: {
          id: sourceQueueId,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.source',
            resource: 'aws_sqs_queue',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_sqs_queue.source',
                values: {
                  name: 'source',
                  arn: 'arn:aws:sqs:eu-west-2:123456789012:source',
                  redrive_policy: JSON.stringify({
                    deadLetterTargetArn: 'arn:aws:sqs:eu-west-2:123456789012:source-dlq',
                  }),
                },
              },
              instances: [],
            },
          },
        },
        [deadLetterQueueId]: {
          id: deadLetterQueueId,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.dead_letter',
            resource: 'aws_sqs_queue',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_sqs_queue.dead_letter',
                values: {
                  name: 'source-dlq',
                },
              },
              instances: [],
            },
            configuration: {
              source: 'plan_show',
              expressions: {
                redrive_policy: {
                  references: ['aws_sqs_queue.dead_letter'],
                },
              },
            },
          },
        },
        [redriveAllowQueueId]: {
          id: redriveAllowQueueId,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.allow_policy_target',
            resource: 'aws_sqs_queue',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_sqs_queue.allow_policy_target',
                values: {
                  name: 'allow-policy-target',
                  redrive_allow_policy: JSON.stringify({
                    sourceQueueArns: ['arn:aws:sqs:eu-west-2:123456789012:source'],
                  }),
                },
              },
              instances: [],
            },
          },
        },
      },
      edges: [],
    });

    const targets = __testing.collectSupportedTargets(graph);
    const sourceTarget = targets.find((target) => target.nodeId === sourceQueueId);
    const deadLetterTarget = targets.find((target) => target.nodeId === deadLetterQueueId);
    const allowPolicyTarget = targets.find((target) => target.nodeId === redriveAllowQueueId);

    expect(sourceTarget?.isDeadLetterQueue).toBe(false);
    expect(deadLetterTarget?.isDeadLetterQueue).toBe(true);
    expect(allowPolicyTarget?.isDeadLetterQueue).toBe(true);

    expect(
      __testing.collectSupportedTargets(
        buildAdapter({
          schemaVersion: TG_SCHEMA_VERSION,
          description: {},
          nodes: {
            queue: {
              id: asNodeId('queue'),
              terraform: {
                kind: 'resource',
                address: 'aws_sqs_queue.queue',
                resource: 'aws_sqs_queue',
                state: {
                  source: 'plan_show',
                  effective: {
                    address: 'aws_sqs_queue.queue',
                    values: {
                      name: 'queue',
                      redrive_policy: { deadLetterTargetArn: 'not-an-arn' },
                      redrive_allow_policy: {
                        sourceQueueArns: ['arn:aws:sqs:eu-west-2:123456789012:queue'],
                      },
                    },
                  },
                  instances: [],
                },
                configuration: {
                  source: 'plan_show',
                  expressions: {
                    redrive_policy: {
                      references: 'invalid',
                    },
                  },
                },
              },
            },
          },
          edges: [],
        }),
      )[0]?.isDeadLetterQueue,
    ).toBe(true);
  });

  it('should resolve policy documents, statements, reachable policies, and matched targets', () => {
    expect(
      __testing.resolvePolicyDocument(asNodeId('unsupported'), {
        terraform: { resource: 'aws_lambda_function' },
      } as never),
    ).toBeUndefined();
    expect(
      __testing.resolvePolicyDocument(asNodeId('missing-state'), {
        terraform: {
          resource: 'aws_iam_policy',
        },
      } as never),
    ).toBeUndefined();
    expect(
      __testing.resolvePolicyDocument(asNodeId('invalid-json'), {
        terraform: {
          resource: 'aws_iam_policy',
          state: {
            effective: {
              values: {
                policy: '{',
              },
            },
            instances: [],
          },
        },
      } as never),
    ).toBeUndefined();

    const mergedPolicyDocument = __testing.resolvePolicyDocument(asNodeId('policy-document'), {
      terraform: {
        resource: 'aws_iam_policy_document',
        state: {
          effective: {
            values: {
              version: '2012-10-17',
              statement: [
                'raw-entry',
                {
                  effect: 'Allow',
                  actions: ['sqs:SendMessage'],
                  resources: ['arn:aws:sqs:eu-west-2:123456789012:queue'],
                  condition: [{ test: 'StringEquals' }],
                  not_actions: ['sqs:DeleteMessage'],
                  not_resources: ['arn:aws:sqs:eu-west-2:123456789012:other'],
                },
              ],
            },
          },
          instances: [],
        },
      },
    } as never);
    expect(mergedPolicyDocument).toMatchObject({
      allowGraphTargetFallback: true,
      document: {
        Version: '2012-10-17',
      },
    });
    expect(
      __testing.resolvePolicyDocument(asNodeId('policy-document-json'), {
        terraform: {
          resource: 'aws_iam_policy_document',
          state: {
            effective: {
              values: {
                json: '{"Statement":{"Effect":"Allow","Action":"sqs:SendMessage","Resource":"*"}}',
              },
            },
            instances: [],
          },
        },
      } as never),
    ).toBeDefined();
    expect(
      __testing.resolvePolicyDocument(asNodeId('policy-document-minified'), {
        terraform: {
          resource: 'aws_iam_policy_document',
          state: {
            effective: {
              values: {
                minified_json:
                  '{"Statement":{"Effect":"Allow","Action":"sqs:SendMessage","Resource":"*"}}',
              },
            },
            instances: [],
          },
        },
      } as never),
    ).toBeDefined();

    const { statements, skippedPolicies } = __testing.resolveStatements({
      nodeId: asNodeId('policy'),
      document: {
        Statement: [
          'invalid',
          { Effect: 'Deny', Action: 'sqs:SendMessage', Resource: '*' },
          { Effect: 'Allow', Condition: [{}], Action: 'sqs:SendMessage', Resource: '*' },
          { Effect: 'Allow', Action: [], Resource: '*' },
          { Effect: 'Allow', Action: 'sqs:SendMessage', Resource: [] },
          { Effect: 'Allow', Action: 'sqs:SendMessage', Resource: '*' },
        ],
      },
    });
    expect(statements).toHaveLength(1);
    expect(skippedPolicies).toContain(`${String(asNodeId('policy'))}:statement is not an object`);
    expect(skippedPolicies).toContain(
      `${String(asNodeId('policy'))}:statement uses unsupported IAM constructs`,
    );
    expect(skippedPolicies).toContain(
      `${String(asNodeId('policy'))}:statement missing Action or Resource`,
    );
    expect(
      __testing.resolveStatements({
        nodeId: asNodeId('singleton-policy'),
        document: {
          Statement: {
            Effect: 'Allow',
            Action: 'sqs:SendMessage',
            Resource: '*',
          },
        },
      }).statements,
    ).toHaveLength(1);
    expect(
      __testing.resolveStatements({
        nodeId: asNodeId('empty-policy'),
        document: {},
      }).statements,
    ).toHaveLength(0);

    const reachable = __testing.collectRoleReachablePolicyDocuments(
      createMockGraph(
        {
          role: {
            terraform: { kind: 'resource', resource: 'aws_iam_role' },
          },
          attachment: {
            terraform: { kind: 'resource', resource: 'aws_iam_role_policy_attachment' },
          },
          nestedRole: {
            terraform: { kind: 'resource', resource: 'aws_iam_role' },
          },
          policy: {
            terraform: {
              kind: 'resource',
              resource: 'aws_iam_policy',
              state: {
                effective: {
                  values: {
                    policy: JSON.stringify({
                      Statement: [{ Effect: 'Allow', Action: 'sqs:SendMessage', Resource: '*' }],
                    }),
                  },
                },
              },
            },
          },
          invisiblePolicy: {
            terraform: {
              kind: 'resource',
              resource: 'aws_iam_policy',
              state: {
                effective: {
                  values: {},
                },
                instances: [],
              },
            },
          },
        },
        [
          { id: 'role-attachment', from: 'role', to: 'attachment' },
          { id: 'attachment-policy', from: 'attachment', to: 'policy' },
          { id: 'attachment-invisible', from: 'attachment', to: 'invisiblePolicy' },
          { id: 'attachment-nested', from: 'attachment', to: 'nestedRole' },
        ],
      ),
      asNodeId('role'),
    );
    expect(reachable.policyDocuments).toHaveLength(1);
    expect(reachable.skippedPolicies).toContain(
      `${String(asNodeId('invisiblePolicy'))}:policy document not visible in terraform state`,
    );
    expect(
      __testing.collectConnectedRoleNodeIds(
        createMockGraph(
          {
            subject: {},
            role: { terraform: { kind: 'resource', resource: 'aws_iam_role' } },
            other: { terraform: { kind: 'resource', resource: 'aws_lambda_function' } },
          },
          [
            { id: 'subject-role', from: 'subject', to: 'role' },
            { id: 'subject-other', from: 'subject', to: 'other' },
          ],
        ),
        asNodeId('subject'),
      ),
    ).toStrictEqual([asNodeId('role')]);

    const matchedTargets = __testing.resolveMatchedTargets(
      createMockGraph(
        {
          policy: { terraform: { resource: 'aws_iam_policy' } },
          queue: { terraform: { resource: 'aws_sqs_queue' } },
          bus: { terraform: { resource: 'aws_cloudwatch_event_bus' } },
        },
        [
          { id: 'policy-queue', from: 'policy', to: 'queue' },
          { id: 'policy-bus', from: 'policy', to: 'bus' },
        ],
      ),
      {
        policyNodeId: asNodeId('policy'),
        actions: ['events:PutEvents'],
        resources: [],
        allowGraphTargetFallback: true,
      },
      {
        capability: 'eventbridge_put',
        factKind: 'publishes_to',
        supportedTargetResourceTypes: ['aws_cloudwatch_event_bus'],
        actionSamples: ['events:PutEvents'],
      },
      [
        {
          nodeId: asNodeId('queue'),
          resourceType: 'aws_sqs_queue',
          arns: ['arn:aws:sqs:eu-west-2:123456789012:queue'],
          names: ['queue'],
          isDeadLetterQueue: true,
        },
        {
          nodeId: asNodeId('bus'),
          resourceType: 'aws_cloudwatch_event_bus',
          arns: [],
          names: ['custom-bus'],
        },
      ],
    );
    expect(matchedTargets.targetNodeIds).toStrictEqual([asNodeId('bus')]);
    expect(matchedTargets.targetMatches[0]).toMatchObject({
      matchMode: 'graph_fallback',
      matchCertainty: 0,
    });
    expect(
      __testing.resolveMatchedTargets(
        createMockGraph({ policy: {} }, []),
        {
          policyNodeId: asNodeId('policy'),
          actions: ['sqs:SendMessage'],
          resources: ['arn:aws:sqs:eu-west-2:123456789012:queue-*'],
        },
        {
          capability: 'sqs_send',
          factKind: 'publishes_to',
          supportedTargetResourceTypes: ['aws_sqs_queue'],
          actionSamples: ['sqs:SendMessage'],
        },
        [
          {
            nodeId: asNodeId('queue'),
            resourceType: 'aws_sqs_queue',
            arns: [],
            names: ['queue-live'],
          },
        ],
      ).targetMatches[0],
    ).toMatchObject({
      targetNodeId: asNodeId('queue'),
      matchMode: 'wildcard_arn',
    });

    expect(
      __testing.resolveMatchedTargets(
        createMockGraph({ policy: {} }, []),
        {
          policyNodeId: asNodeId('policy'),
          actions: ['lambda:InvokeFunction'],
          resources: ['arn:aws:sqs:eu-west-2:123456789012:queue'],
        },
        {
          capability: 'sqs_send',
          factKind: 'publishes_to',
          supportedTargetResourceTypes: ['aws_sqs_queue'],
          actionSamples: ['sqs:SendMessage'],
        },
        [],
      ),
    ).toStrictEqual({
      targetNodeIds: [],
      targetMatches: [],
      matchedActionPatterns: [],
      matchedResourcePatterns: [],
      unresolvedResourcePatterns: [],
    });
  });

  it('should evaluate permissions and ignore unmatched capabilities', () => {
    const lambdaId = asNodeId('lambda');
    const roleId = asNodeId('role');
    const policyId = asNodeId('policy');
    const busId = asNodeId('bus');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [lambdaId]: {
          id: lambdaId,
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.fn',
            resource: 'aws_lambda_function',
            state: {
              source: 'plan_show',
              effective: { address: 'aws_lambda_function.fn', values: {} },
              instances: [],
            },
          },
        },
        [roleId]: {
          id: roleId,
          terraform: {
            kind: 'resource',
            address: 'aws_iam_role.fn',
            resource: 'aws_iam_role',
            state: {
              source: 'plan_show',
              effective: { address: 'aws_iam_role.fn', values: {} },
              instances: [],
            },
          },
        },
        [policyId]: {
          id: policyId,
          terraform: {
            kind: 'resource',
            address: 'aws_iam_policy.fn',
            resource: 'aws_iam_policy',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_iam_policy.fn',
                values: {
                  policy: JSON.stringify({
                    Statement: [
                      {
                        Effect: 'Allow',
                        Action: ['sqs:SendMessage'],
                        Resource: ['arn:aws:events:eu-west-2:123456789012:event-bus/custom'],
                      },
                    ],
                  }),
                },
              },
              instances: [],
            },
          },
        },
        [busId]: {
          id: busId,
          terraform: {
            kind: 'resource',
            address: 'aws_cloudwatch_event_bus.custom',
            resource: 'aws_cloudwatch_event_bus',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_cloudwatch_event_bus.custom',
                values: {
                  arn: 'arn:aws:events:eu-west-2:123456789012:event-bus/custom',
                  name: 'custom',
                },
              },
              instances: [],
            },
          },
        },
      },
      edges: [
        { id: asEdgeId('lambda-role'), from: lambdaId, to: roleId, attributes: {} },
        { id: asEdgeId('role-policy'), from: roleId, to: policyId, attributes: {} },
      ],
    });

    const evaluation = evaluateAwsIamPermissions({
      graph: adapter,
      subjectNodeId: lambdaId,
      capabilities: ['eventbridge_put'],
    });

    expect(evaluation.roleNodeIds).toStrictEqual([roleId]);
    expect(evaluation.policyNodeIds).toStrictEqual([policyId]);
    expect(evaluation.capabilities).toStrictEqual([]);
    expect(evaluation.skippedPolicies).toStrictEqual([]);
  });
});
