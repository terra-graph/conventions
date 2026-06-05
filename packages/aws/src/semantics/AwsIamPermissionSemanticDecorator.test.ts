import {
  type AdapterOperations,
  GraphologyAdapter,
  TG_SCHEMA_VERSION,
  type NodeId,
  type TgGraph,
  asEdgeId,
  asNodeId,
} from '@terra-graph/core';
import { DirectedGraph } from 'graphology';
import { AwsIamPermissionSemanticDecorator } from './AwsIamPermissionSemanticDecorator.js';

const buildAdapter = (graph: TgGraph) =>
  new GraphologyAdapter(
    new DirectedGraph() as unknown as ConstructorParameters<
      typeof GraphologyAdapter
    >[0],
  ).withTgGraph(graph);

const findFactEdge = (
  graph: AdapterOperations,
  nodeId: NodeId,
  kind: string,
) =>
  graph.outEdges(nodeId).find((edgeId) =>
    graph
      .getEdgeAttributes(edgeId)
      ?.semantic?.facts?.some((fact) => fact.kind === kind),
  );

describe('AwsIamPermissionSemanticDecorator', () => {
  it('should derive writes_to facts from lambda role policies and annotate existing projection edges', () => {
    const lambdaId = asNodeId('lambda');
    const roleId = asNodeId('role');
    const inlinePolicyId = asNodeId('inline-policy');
    const bucketId = asNodeId('bucket');
    const lambdaProjectionId = asNodeId('projection-lambda');
    const otherProjectionId = asNodeId('projection-other');
    const bucketProjectionId = asNodeId('projection-bucket');
    const existingProjectionEdgeId = asEdgeId('projection-existing');

    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [lambdaId]: {
          id: lambdaId,
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.copy',
            resource: 'aws_lambda_function',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_lambda_function.copy',
                values: {},
              },
              instances: [],
            },
          },
        },
        [roleId]: {
          id: roleId,
          terraform: {
            kind: 'resource',
            address: 'aws_iam_role.copy',
            resource: 'aws_iam_role',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_iam_role.copy',
                values: {},
              },
              instances: [],
            },
          },
        },
        [inlinePolicyId]: {
          id: inlinePolicyId,
          terraform: {
            kind: 'resource',
            address: 'aws_iam_role_policy.copy',
            resource: 'aws_iam_role_policy',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_iam_role_policy.copy',
                values: {
                  policy: JSON.stringify({
                    Version: '2012-10-17',
                    Statement: [
                      {
                        Effect: 'Allow',
                        Action: 's3:*',
                        Resource: 'arn:aws:s3:::artifacts/*',
                      },
                    ],
                  }),
                },
              },
              instances: [],
            },
          },
        },
        [bucketId]: {
          id: bucketId,
          terraform: {
            kind: 'resource',
            address: 'aws_s3_bucket.artifacts',
            resource: 'aws_s3_bucket',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_s3_bucket.artifacts',
                values: {
                  arn: 'arn:aws:s3:::artifacts',
                },
              },
              instances: [],
            },
          },
        },
        [lambdaProjectionId]: {
          id: lambdaProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.lambda:copy',
            label: 'copy',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.lambda',
              rootNodeId: lambdaId,
            },
          },
        },
        [otherProjectionId]: {
          id: otherProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.other:copy',
            label: 'copy',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.other',
              rootNodeId: lambdaId,
            },
          },
        },
        [bucketProjectionId]: {
          id: bucketProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.s3:artifacts',
            label: 'artifacts',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.s3',
              rootNodeId: bucketId,
            },
          },
        },
      },
      edges: [
        {
          id: asEdgeId('lambda-role'),
          from: lambdaId,
          to: roleId,
          attributes: {},
        },
        {
          id: asEdgeId('role-policy'),
          from: roleId,
          to: inlinePolicyId,
          attributes: {},
        },
        {
          id: existingProjectionEdgeId,
          from: lambdaProjectionId,
          to: bucketProjectionId,
          attributes: {
            projection: {
              layer: 'core',
              relationship: {
                relation: 'accesses',
                source: 'derived',
              },
            },
          },
        },
      ],
    };

    const decorator = new AwsIamPermissionSemanticDecorator({
      subjects: [
        {
          resourceTypes: ['aws_lambda_function'],
          projectionNames: ['aws.lambda'],
        },
      ],
      capabilities: ['s3_write'],
    });

    const extracted = decorator.extract({ graph: buildAdapter(graph) });
    const rawFactEdgeId = findFactEdge(extracted, lambdaId, 'writes_to');
    expect(rawFactEdgeId).toBeDefined();
    expect(
      extracted.getEdgeAttributes(rawFactEdgeId!)?.semantic?.facts?.[0],
    ).toMatchObject({
      kind: 'writes_to',
      from: lambdaId,
      to: bucketId,
      source: 'permission',
      confidence: 'capability',
      attributes: {
        capability: 's3_write',
        principalRoleNodeIds: [roleId],
        policyNodeIds: [inlinePolicyId],
      },
    });
    expect(
      extracted.getNodeAttributes(lambdaId)?.semantic?.contexts?.[
        AwsIamPermissionSemanticDecorator.id
      ],
    ).toMatchObject({
      roleNodeIds: [roleId],
      policyNodeIds: [inlinePolicyId],
    });

    const projected = decorator.project({ graph: extracted });
    expect(
      projected.getEdgeAttributes(existingProjectionEdgeId)?.projection?.semantics
        ?.facts?.[0],
    ).toMatchObject({
      kind: 'writes_to',
      from: lambdaProjectionId,
      to: bucketProjectionId,
      attributes: {
        rawFrom: lambdaId,
        rawTo: bucketId,
      },
    });
    expect(
      projected
        .outEdges(otherProjectionId)
        .some((edgeId) =>
          projected
            .getEdgeAttributes(edgeId)
            ?.projection?.semantics?.facts?.some(
              (fact) => fact.decorator === AwsIamPermissionSemanticDecorator.id,
            ),
        ),
    ).toBe(false);
  });

  it('should derive publishes_to facts through instance profiles and create projection edges when absent', () => {
    const instanceId = asNodeId('instance');
    const instanceProfileId = asNodeId('instance-profile');
    const roleId = asNodeId('role');
    const attachmentId = asNodeId('attachment');
    const policyId = asNodeId('policy');
    const policyDocumentId = asNodeId('policy-document');
    const queueId = asNodeId('queue');
    const instanceProjectionId = asNodeId('projection-instance');
    const queueProjectionId = asNodeId('projection-queue');

    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [instanceId]: {
          id: instanceId,
          terraform: {
            kind: 'resource',
            address: 'aws_instance.worker',
            resource: 'aws_instance',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_instance.worker',
                values: {},
              },
              instances: [],
            },
          },
        },
        [instanceProfileId]: {
          id: instanceProfileId,
          terraform: {
            kind: 'resource',
            address: 'aws_iam_instance_profile.worker',
            resource: 'aws_iam_instance_profile',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_iam_instance_profile.worker',
                values: {},
              },
              instances: [],
            },
          },
        },
        [roleId]: {
          id: roleId,
          terraform: {
            kind: 'resource',
            address: 'aws_iam_role.worker',
            resource: 'aws_iam_role',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_iam_role.worker',
                values: {},
              },
              instances: [],
            },
          },
        },
        [attachmentId]: {
          id: attachmentId,
          terraform: {
            kind: 'resource',
            address: 'aws_iam_role_policy_attachment.worker',
            resource: 'aws_iam_role_policy_attachment',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_iam_role_policy_attachment.worker',
                values: {},
              },
              instances: [],
            },
          },
        },
        [policyId]: {
          id: policyId,
          terraform: {
            kind: 'resource',
            address: 'aws_iam_policy.worker',
            resource: 'aws_iam_policy',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_iam_policy.worker',
                values: {},
              },
              instances: [],
            },
          },
        },
        [policyDocumentId]: {
          id: policyDocumentId,
          terraform: {
            kind: 'data',
            address: 'data.aws_iam_policy_document.worker',
            resource: 'aws_iam_policy_document',
            state: {
              source: 'plan_show',
              effective: {
                address: 'data.aws_iam_policy_document.worker',
                values: {
                  json: JSON.stringify({
                    Version: '2012-10-17',
                    Statement: [
                      {
                        Effect: 'Allow',
                        Action: 'sqs:*',
                        Resource:
                          'arn:aws:sqs:eu-west-2:123456789012:event-queue',
                      },
                    ],
                  }),
                },
              },
              instances: [],
            },
          },
        },
        [queueId]: {
          id: queueId,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.event_queue',
            resource: 'aws_sqs_queue',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_sqs_queue.event_queue',
                values: {
                  arn: 'arn:aws:sqs:eu-west-2:123456789012:event-queue',
                },
              },
              instances: [],
            },
          },
        },
        [instanceProjectionId]: {
          id: instanceProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.ec2:worker',
            label: 'worker',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.ec2',
              rootNodeId: instanceId,
            },
          },
        },
        [queueProjectionId]: {
          id: queueProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.sqs:event_queue',
            label: 'event_queue',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.sqs',
              rootNodeId: queueId,
            },
          },
        },
      },
      edges: [
        {
          id: asEdgeId('instance-profile'),
          from: instanceId,
          to: instanceProfileId,
          attributes: {},
        },
        {
          id: asEdgeId('profile-role'),
          from: instanceProfileId,
          to: roleId,
          attributes: {},
        },
        {
          id: asEdgeId('role-attachment'),
          from: roleId,
          to: attachmentId,
          attributes: {},
        },
        {
          id: asEdgeId('attachment-policy'),
          from: attachmentId,
          to: policyId,
          attributes: {},
        },
        {
          id: asEdgeId('policy-document'),
          from: policyId,
          to: policyDocumentId,
          attributes: {},
        },
      ],
    };

    const decorator = new AwsIamPermissionSemanticDecorator({
      subjects: [
        {
          resourceTypes: ['aws_instance'],
          projectionNames: ['aws.ec2'],
        },
      ],
      capabilities: ['sqs_send'],
    });

    const extracted = decorator.extract({ graph: buildAdapter(graph) });
    const rawFactEdgeId = findFactEdge(extracted, instanceId, 'publishes_to');
    expect(rawFactEdgeId).toBeDefined();
    expect(
      extracted.getEdgeAttributes(rawFactEdgeId!)?.semantic?.facts?.[0],
    ).toMatchObject({
      kind: 'publishes_to',
      from: instanceId,
      to: queueId,
      source: 'permission',
      confidence: 'capability',
    });

    const projected = decorator.project({ graph: extracted });
    const projectionEdgeId = projected.outEdges(instanceProjectionId).find(
      (edgeId) =>
        projected
          .getEdgeAttributes(edgeId)
          ?.projection?.semantics?.facts?.some(
            (fact) => fact.kind === 'publishes_to',
          ),
    );
    expect(projectionEdgeId).toBeDefined();
    expect(projected.edgeSource(projectionEdgeId!)).toBe(instanceProjectionId);
    expect(projected.edgeTarget(projectionEdgeId!)).toBe(queueProjectionId);
  });

  it('should skip unsupported policy statements while still recording semantic context', () => {
    const lambdaId = asNodeId('lambda-unsupported');
    const roleId = asNodeId('role-unsupported');
    const inlinePolicyId = asNodeId('inline-policy-unsupported');
    const bucketId = asNodeId('bucket-unsupported');

    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [lambdaId]: {
          id: lambdaId,
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.unsupported',
            resource: 'aws_lambda_function',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_lambda_function.unsupported',
                values: {},
              },
              instances: [],
            },
          },
        },
        [roleId]: {
          id: roleId,
          terraform: {
            kind: 'resource',
            address: 'aws_iam_role.unsupported',
            resource: 'aws_iam_role',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_iam_role.unsupported',
                values: {},
              },
              instances: [],
            },
          },
        },
        [inlinePolicyId]: {
          id: inlinePolicyId,
          terraform: {
            kind: 'resource',
            address: 'aws_iam_role_policy.unsupported',
            resource: 'aws_iam_role_policy',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_iam_role_policy.unsupported',
                values: {
                  policy: JSON.stringify({
                    Version: '2012-10-17',
                    Statement: [
                      {
                        Effect: 'Allow',
                        Action: 's3:PutObject',
                        Resource: 'arn:aws:s3:::artifacts/*',
                        Condition: {
                          StringEquals: {
                            'aws:PrincipalTag/team': 'platform',
                          },
                        },
                      },
                    ],
                  }),
                },
              },
              instances: [],
            },
          },
        },
        [bucketId]: {
          id: bucketId,
          terraform: {
            kind: 'resource',
            address: 'aws_s3_bucket.unsupported',
            resource: 'aws_s3_bucket',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_s3_bucket.unsupported',
                values: {
                  arn: 'arn:aws:s3:::artifacts',
                },
              },
              instances: [],
            },
          },
        },
      },
      edges: [
        {
          id: asEdgeId('lambda-role-unsupported'),
          from: lambdaId,
          to: roleId,
          attributes: {},
        },
        {
          id: asEdgeId('role-policy-unsupported'),
          from: roleId,
          to: inlinePolicyId,
          attributes: {},
        },
      ],
    };

    const decorator = new AwsIamPermissionSemanticDecorator({
      subjects: [
        {
          resourceTypes: ['aws_lambda_function'],
          projectionNames: ['aws.lambda'],
        },
      ],
      capabilities: ['s3_write'],
    });

    const extracted = decorator.extract({ graph: buildAdapter(graph) });
    expect(findFactEdge(extracted, lambdaId, 'writes_to')).toBeUndefined();
    expect(
      extracted.getNodeAttributes(lambdaId)?.semantic?.contexts?.[
        AwsIamPermissionSemanticDecorator.id
      ],
    ).toMatchObject({
      roleNodeIds: [roleId],
      skippedPolicies: [
        `${String(inlinePolicyId)}:statement uses unsupported IAM constructs`,
      ],
    });
  });

  it('should derive publishes_to facts for events PutEvents permissions targeting eventbridge buses', () => {
    const lambdaId = asNodeId('lambda-eventbridge');
    const roleId = asNodeId('role-eventbridge');
    const inlinePolicyId = asNodeId('inline-policy-eventbridge');
    const busId = asNodeId('bus');
    const lambdaProjectionId = asNodeId('projection-lambda-eventbridge');
    const busProjectionId = asNodeId('projection-bus');

    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [lambdaId]: {
          id: lambdaId,
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.publisher',
            resource: 'aws_lambda_function',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_lambda_function.publisher',
                values: {},
              },
              instances: [],
            },
          },
        },
        [roleId]: {
          id: roleId,
          terraform: {
            kind: 'resource',
            address: 'aws_iam_role.publisher',
            resource: 'aws_iam_role',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_iam_role.publisher',
                values: {},
              },
              instances: [],
            },
          },
        },
        [inlinePolicyId]: {
          id: inlinePolicyId,
          terraform: {
            kind: 'resource',
            address: 'aws_iam_role_policy.publisher',
            resource: 'aws_iam_role_policy',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_iam_role_policy.publisher',
                values: {
                  policy: JSON.stringify({
                    Version: '2012-10-17',
                    Statement: [
                      {
                        Effect: 'Allow',
                        Action: 'events:PutEvents',
                        Resource:
                          'arn:aws:events:eu-west-2:123456789012:event-bus/custom-bus',
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
                  arn: 'arn:aws:events:eu-west-2:123456789012:event-bus/custom-bus',
                },
              },
              instances: [],
            },
          },
        },
        [lambdaProjectionId]: {
          id: lambdaProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.lambda:publisher',
            label: 'publisher',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.lambda',
              rootNodeId: lambdaId,
            },
          },
        },
        [busProjectionId]: {
          id: busProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.eventbridge_bus:custom',
            label: 'custom',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.eventbridge_bus',
              rootNodeId: busId,
            },
          },
        },
      },
      edges: [
        {
          id: asEdgeId('lambda-role-eventbridge'),
          from: lambdaId,
          to: roleId,
          attributes: {},
        },
        {
          id: asEdgeId('role-policy-eventbridge'),
          from: roleId,
          to: inlinePolicyId,
          attributes: {},
        },
      ],
    };

    const decorator = new AwsIamPermissionSemanticDecorator({
      subjects: [
        {
          resourceTypes: ['aws_lambda_function'],
          projectionNames: ['aws.lambda'],
        },
      ],
      capabilities: ['eventbridge_put'],
    });

    const extracted = decorator.extract({ graph: buildAdapter(graph) });
    const rawFactEdgeId = findFactEdge(extracted, lambdaId, 'publishes_to');
    expect(rawFactEdgeId).toBeDefined();
    expect(
      extracted.getEdgeAttributes(rawFactEdgeId!)?.semantic?.facts?.[0],
    ).toMatchObject({
      kind: 'publishes_to',
      from: lambdaId,
      to: busId,
      source: 'permission',
      confidence: 'capability',
      attributes: {
        capability: 'eventbridge_put',
        principalRoleNodeIds: [roleId],
        policyNodeIds: [inlinePolicyId],
      },
    });

    const projected = decorator.project({ graph: extracted });
    const projectionEdgeId = projected.outEdges(lambdaProjectionId).find(
      (edgeId) =>
        projected
          .getEdgeAttributes(edgeId)
          ?.projection?.semantics?.facts?.some(
            (fact) => fact.kind === 'publishes_to',
          ),
    );
    expect(projectionEdgeId).toBeDefined();
    expect(projected.edgeSource(projectionEdgeId!)).toBe(lambdaProjectionId);
    expect(projected.edgeTarget(projectionEdgeId!)).toBe(busProjectionId);
  });

  it('should derive publishes_to facts from planned policy documents with graph-resolved eventbridge targets when target arns are unavailable', () => {
    const lambdaId = asNodeId('lambda-eventbridge-plan');
    const roleId = asNodeId('role-eventbridge-plan');
    const attachmentId = asNodeId('attachment-eventbridge-plan');
    const policyId = asNodeId('policy-eventbridge-plan');
    const policyDocumentId = asNodeId('policy-document-eventbridge-plan');
    const busId = asNodeId('bus-eventbridge-plan');

    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [lambdaId]: {
          id: lambdaId,
          terraform: {
            kind: 'resource',
            address: 'module.batch_messages.aws_lambda_function.this',
            resource: 'aws_lambda_function',
            state: {
              source: 'plan_show',
              effective: {
                address: 'module.batch_messages.aws_lambda_function.this',
                values: {},
              },
              instances: [
                {
                  address: 'module.batch_messages.aws_lambda_function.this[0]',
                  values: {},
                },
              ],
            },
          },
        },
        [roleId]: {
          id: roleId,
          terraform: {
            kind: 'resource',
            address: 'module.batch_messages.aws_iam_role.lambda',
            resource: 'aws_iam_role',
            state: {
              source: 'plan_show',
              effective: {
                address: 'module.batch_messages.aws_iam_role.lambda',
                values: {},
              },
              instances: [
                {
                  address: 'module.batch_messages.aws_iam_role.lambda[0]',
                  values: {},
                },
              ],
            },
          },
        },
        [attachmentId]: {
          id: attachmentId,
          terraform: {
            kind: 'resource',
            address:
              'module.batch_messages.aws_iam_role_policy_attachment.additional_inline',
            resource: 'aws_iam_role_policy_attachment',
            state: {
              source: 'plan_show',
              effective: {
                address:
                  'module.batch_messages.aws_iam_role_policy_attachment.additional_inline',
                values: {},
              },
              instances: [
                {
                  address:
                    'module.batch_messages.aws_iam_role_policy_attachment.additional_inline[0]',
                  values: {},
                },
              ],
            },
          },
        },
        [policyId]: {
          id: policyId,
          terraform: {
            kind: 'resource',
            address: 'module.batch_messages.aws_iam_policy.additional_inline',
            resource: 'aws_iam_policy',
            state: {
              source: 'plan_show',
              effective: {
                address: 'module.batch_messages.aws_iam_policy.additional_inline',
                values: {},
              },
              instances: [
                {
                  address:
                    'module.batch_messages.aws_iam_policy.additional_inline[0]',
                  values: {},
                },
              ],
            },
          },
        },
        [policyDocumentId]: {
          id: policyDocumentId,
          terraform: {
            kind: 'data',
            address:
              'module.batch_messages.data.aws_iam_policy_document.additional_inline',
            resource: 'aws_iam_policy_document',
            state: {
              source: 'plan_show',
              effective: {
                address:
                  'module.batch_messages.data.aws_iam_policy_document.additional_inline',
                values: {},
              },
              instances: [
                {
                  address:
                    'module.batch_messages.data.aws_iam_policy_document.additional_inline[0]',
                  values: {
                    statement: [
                      {
                        actions: ['events:PutEvents'],
                        effect: 'Allow',
                        resources: [null],
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
        [busId]: {
          id: busId,
          terraform: {
            kind: 'resource',
            address: 'aws_cloudwatch_event_bus.gas_shipper_sequencer_file_router',
            resource: 'aws_cloudwatch_event_bus',
            state: {
              source: 'plan_show',
              effective: {
                address:
                  'aws_cloudwatch_event_bus.gas_shipper_sequencer_file_router',
                values: {},
              },
              instances: [],
            },
          },
        },
      },
      edges: [
        {
          id: asEdgeId('lambda-role-eventbridge-plan'),
          from: lambdaId,
          to: roleId,
          attributes: {},
        },
        {
          id: asEdgeId('role-attachment-eventbridge-plan'),
          from: roleId,
          to: attachmentId,
          attributes: {},
        },
        {
          id: asEdgeId('attachment-policy-eventbridge-plan'),
          from: attachmentId,
          to: policyId,
          attributes: {},
        },
        {
          id: asEdgeId('policy-document-eventbridge-plan'),
          from: policyId,
          to: policyDocumentId,
          attributes: {},
        },
        {
          id: asEdgeId('policy-document-bus-eventbridge-plan'),
          from: policyDocumentId,
          to: busId,
          attributes: {},
        },
      ],
    };

    const decorator = new AwsIamPermissionSemanticDecorator({
      subjects: [
        {
          resourceTypes: ['aws_lambda_function'],
          projectionNames: ['aws.lambda'],
        },
      ],
      capabilities: ['eventbridge_put'],
    });

    const extracted = decorator.extract({ graph: buildAdapter(graph) });
    const rawFactEdgeId = findFactEdge(extracted, lambdaId, 'publishes_to');
    expect(rawFactEdgeId).toBeDefined();
    expect(
      extracted.getEdgeAttributes(rawFactEdgeId!)?.semantic?.facts?.[0],
    ).toMatchObject({
      kind: 'publishes_to',
      from: lambdaId,
      to: busId,
      source: 'permission',
      confidence: 'capability',
      decorator: AwsIamPermissionSemanticDecorator.id,
      attributes: {
        capability: 'eventbridge_put',
        principalRoleNodeIds: [roleId],
        policyNodeIds: [policyDocumentId],
        matchedActionPatterns: ['events:PutEvents'],
      },
    });
  });
});
