import {
  isArrayOfUnknown,
  isObjectRecord,
  isTerraformValues,
  resolveNodeArn,
  type NodeId,
  type SemanticDecorator,
  type TgNodeAttributes,
} from '@terra-graph/core';

const IAM_TRAVERSABLE_RESOURCE_TYPES = new Set([
  'aws_iam_role',
  'aws_iam_instance_profile',
  'aws_iam_role_policy',
  'aws_iam_policy',
  'aws_iam_role_policy_attachment',
  'aws_iam_policy_attachment',
  'aws_iam_policy_document',
]);

const SUPPORTED_POLICY_RESOURCE_TYPES = new Set([
  'aws_iam_role_policy',
  'aws_iam_policy',
  'aws_iam_policy_document',
]);

export const AWS_IAM_PERMISSION_CAPABILITIES = [
  's3_write',
  'sqs_send',
  'eventbridge_put',
] as const;

export type AwsIamPermissionCapability =
  (typeof AWS_IAM_PERMISSION_CAPABILITIES)[number];

export type AwsIamPermissionSubjectConfig = {
  resourceTypes: string[];
  projectionNames?: string[];
};

export type AwsIamPermissionSemanticDecoratorConfig = {
  subjects?: AwsIamPermissionSubjectConfig[];
  capabilities?: AwsIamPermissionCapability[];
};

export type AwsIamPermissionFactKind = 'writes_to' | 'publishes_to';

type CapabilityDefinition = {
  capability: AwsIamPermissionCapability;
  factKind: AwsIamPermissionFactKind;
  supportedTargetResourceTypes: string[];
  actionSamples: string[];
};

type SupportedTarget = {
  nodeId: NodeId;
  resourceType: string;
  arns: string[];
};

type PolicyDocument = {
  nodeId: NodeId;
  document: Record<string, unknown>;
  allowGraphTargetFallback?: boolean;
};

type PolicyStatement = {
  policyNodeId: NodeId;
  actions: string[];
  resources: string[];
  allowGraphTargetFallback?: boolean;
};

export type AwsIamPermissionMatchedCapability = {
  capability: AwsIamPermissionCapability;
  factKind: AwsIamPermissionFactKind;
  roleNodeIds: NodeId[];
  policyNodeIds: NodeId[];
  targetNodeIds: NodeId[];
  matchedActionPatterns: string[];
  matchedResourcePatterns: string[];
  unresolvedResourcePatterns: string[];
};

export type AwsIamPermissionEvaluationResult = {
  roleNodeIds: NodeId[];
  policyNodeIds: NodeId[];
  capabilities: AwsIamPermissionMatchedCapability[];
  skippedPolicies: string[];
};

const CAPABILITY_DEFINITIONS: Record<
  AwsIamPermissionCapability,
  CapabilityDefinition
> = {
  s3_write: {
    capability: 's3_write',
    factKind: 'writes_to',
    supportedTargetResourceTypes: ['aws_s3_bucket'],
    actionSamples: ['s3:PutObject', 's3:PutObjectAcl', 's3:PutObjectTagging'],
  },
  sqs_send: {
    capability: 'sqs_send',
    factKind: 'publishes_to',
    supportedTargetResourceTypes: ['aws_sqs_queue'],
    actionSamples: ['sqs:SendMessage'],
  },
  eventbridge_put: {
    capability: 'eventbridge_put',
    factKind: 'publishes_to',
    supportedTargetResourceTypes: ['aws_cloudwatch_event_bus'],
    actionSamples: ['events:PutEvents'],
  },
};

const unique = <T>(values: Iterable<T>): T[] => [...new Set(values)];

const toArrayOfStrings = (value: unknown): string[] => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value];
  }

  if (!isArrayOfUnknown(value)) {
    return [];
  }

  return unique(
    value.filter(
      (entry): entry is string =>
        typeof entry === 'string' && entry.trim().length > 0,
    ),
  );
};

const resourceTypeOf = (node: TgNodeAttributes | undefined): string | undefined =>
  node?.terraform?.resource;

const isTraversableIamResource = (
  node: TgNodeAttributes | undefined,
): boolean => {
  const resourceType = resourceTypeOf(node);
  return (
    node?.terraform?.kind !== undefined &&
    typeof resourceType === 'string' &&
    IAM_TRAVERSABLE_RESOURCE_TYPES.has(resourceType)
  );
};

const adjacentNodeIds = (
  graph: Parameters<SemanticDecorator['extract']>[0]['graph'],
  nodeId: NodeId,
): NodeId[] =>
  unique([
    ...graph.outEdges(nodeId).map((edgeId) => graph.edgeTarget(edgeId)),
    ...graph.inEdges(nodeId).map((edgeId) => graph.edgeSource(edgeId)),
  ]);

const wildcardPatternToRegex = (pattern: string, flags?: string): RegExp =>
  new RegExp(
    `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
    flags,
  );

const matchesWildcardPattern = (
  pattern: string,
  candidate: string,
  flags?: string,
): boolean => wildcardPatternToRegex(pattern, flags).test(candidate);

const parseJsonObject = (value: string): Record<string, unknown> | undefined => {
  try {
    const parsed = JSON.parse(value);
    return isObjectRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const collectTerraformStateValueCandidates = (
  node: TgNodeAttributes,
): Array<Record<string, unknown>> => {
  const candidates: Array<Record<string, unknown>> = [];
  const effectiveValues = node.terraform?.state?.effective?.values;
  if (isTerraformValues(effectiveValues)) {
    candidates.push(effectiveValues);
  }

  for (const instance of node.terraform?.state?.instances ?? []) {
    if (isTerraformValues(instance.values)) {
      candidates.push(instance.values);
    }
  }

  return candidates;
};

const resolveBucketArn = (node: TgNodeAttributes): string | undefined => {
  const directArn = resolveNodeArn(node);
  if (directArn) {
    return directArn;
  }

  const values = node.terraform?.state?.effective?.values;
  if (!isTerraformValues(values)) {
    return undefined;
  }

  return typeof values.bucket === 'string'
    ? `arn:aws:s3:::${values.bucket}`
    : undefined;
};

const resolveSupportedTargetArns = (
  node: TgNodeAttributes,
): string[] => {
  switch (node.terraform?.resource) {
    case 'aws_s3_bucket': {
      const bucketArn = resolveBucketArn(node);
      return bucketArn ? unique([bucketArn, `${bucketArn}/*`]) : [];
    }
    case 'aws_sqs_queue': {
      const arn = resolveNodeArn(node);
      return arn ? [arn] : [];
    }
    case 'aws_cloudwatch_event_bus': {
      const arn = resolveNodeArn(node);
      return arn ? [arn] : [];
    }
    default:
      return [];
  }
};

const collectSupportedTargets = (
  graph: Parameters<SemanticDecorator['extract']>[0]['graph'],
): SupportedTarget[] => {
  const targets: SupportedTarget[] = [];

  for (const nodeId of graph.nodeIds()) {
    const node = graph.getNodeAttributes(nodeId);
    const resourceType = resourceTypeOf(node);
    if (!node || !resourceType) {
      continue;
    }

    if (
      resourceType !== 'aws_s3_bucket' &&
      resourceType !== 'aws_sqs_queue' &&
      resourceType !== 'aws_cloudwatch_event_bus'
    ) {
      continue;
    }

    const arns = resolveSupportedTargetArns(node);
    if (arns.length === 0) {
      continue;
    }

    targets.push({
      nodeId,
      resourceType,
      arns,
    });
  }

  return targets;
};

const resolvePolicyDocument = (
  nodeId: NodeId,
  node: TgNodeAttributes,
): PolicyDocument | undefined => {
  const resourceType = resourceTypeOf(node);
  if (!resourceType || !SUPPORTED_POLICY_RESOURCE_TYPES.has(resourceType)) {
    return undefined;
  }

  const valueCandidates = collectTerraformStateValueCandidates(node);
  if (valueCandidates.length === 0) {
    return undefined;
  }

  if (resourceType === 'aws_iam_policy_document') {
    const mergedStatements: unknown[] = [];

    for (const values of valueCandidates) {
      if (!isArrayOfUnknown(values.statement)) {
        continue;
      }

      mergedStatements.push(
        ...values.statement.map((entry) => {
          if (!isObjectRecord(entry)) {
            return entry;
          }

          const condition =
            isArrayOfUnknown(entry.condition) && entry.condition.length > 0
              ? entry.condition
              : undefined;

          return {
            Effect: entry.effect,
            Action: entry.actions,
            Resource: entry.resources,
            ...(condition !== undefined ? { Condition: condition } : {}),
            ...(entry.not_actions != null
              ? { NotAction: entry.not_actions }
              : {}),
            ...(entry.not_resources != null
              ? { NotResource: entry.not_resources }
              : {}),
          };
        }),
      );
    }

    if (mergedStatements.length > 0) {
      return {
        nodeId,
        document: {
          Version: valueCandidates.find(
            (values) => typeof values.version === 'string',
          )?.version,
          Statement: mergedStatements,
        },
        allowGraphTargetFallback: true,
      };
    }
  }

  const rawPolicy = valueCandidates
    .map((values) =>
      resourceType === 'aws_iam_policy_document'
        ? typeof values.json === 'string'
          ? values.json
          : typeof values.minified_json === 'string'
            ? values.minified_json
            : undefined
        : typeof values.policy === 'string'
          ? values.policy
          : undefined,
    )
    .find((value): value is string => typeof value === 'string');

  if (!rawPolicy) {
    return undefined;
  }

  const document = parseJsonObject(rawPolicy);
  if (!document) {
    return undefined;
  }

  return {
    nodeId,
    document,
  };
};

const collectRoleReachablePolicyDocuments = (
  graph: Parameters<SemanticDecorator['extract']>[0]['graph'],
  roleNodeId: NodeId,
): {
  policyDocuments: PolicyDocument[];
  skippedPolicies: string[];
} => {
  const queue: NodeId[] = [roleNodeId];
  const visited = new Set<NodeId>([roleNodeId]);
  const policyDocuments = new Map<NodeId, PolicyDocument>();
  const skippedPolicies = new Set<string>();

  while (queue.length > 0) {
    const currentNodeId = queue.shift();
    if (!currentNodeId) {
      continue;
    }

    const currentNode = graph.getNodeAttributes(currentNodeId);
    if (!currentNode) {
      continue;
    }

    const currentResourceType = resourceTypeOf(currentNode);
    if (
      currentNodeId !== roleNodeId &&
      currentResourceType === 'aws_iam_role'
    ) {
      continue;
    }

    const policyDocument = resolvePolicyDocument(currentNodeId, currentNode);
    if (policyDocument) {
      policyDocuments.set(currentNodeId, policyDocument);
    } else if (SUPPORTED_POLICY_RESOURCE_TYPES.has(currentResourceType ?? '')) {
      skippedPolicies.add(
        `${String(currentNodeId)}:policy document not visible in terraform state`,
      );
    }

    for (const neighborNodeId of adjacentNodeIds(graph, currentNodeId)) {
      if (visited.has(neighborNodeId)) {
        continue;
      }

      const neighborNode = graph.getNodeAttributes(neighborNodeId);
      if (!isTraversableIamResource(neighborNode)) {
        continue;
      }

      visited.add(neighborNodeId);
      queue.push(neighborNodeId);
    }
  }

  return {
    policyDocuments: [...policyDocuments.values()],
    skippedPolicies: [...skippedPolicies],
  };
};

const resolveStatements = (
  policyDocument: PolicyDocument,
): {
  statements: PolicyStatement[];
  skippedPolicies: string[];
} => {
  const skippedPolicies: string[] = [];
  const statementsValue = policyDocument.document.Statement;
  const statements = isArrayOfUnknown(statementsValue)
    ? statementsValue
    : statementsValue
      ? [statementsValue]
      : [];

  const resolvedStatements: PolicyStatement[] = [];

  for (const statement of statements) {
    if (!isObjectRecord(statement)) {
      skippedPolicies.push(
        `${String(policyDocument.nodeId)}:statement is not an object`,
      );
      continue;
    }

    if (statement.Effect !== 'Allow') {
      continue;
    }

    if (
      'Condition' in statement ||
      'NotAction' in statement ||
      'NotResource' in statement
    ) {
      skippedPolicies.push(
        `${String(policyDocument.nodeId)}:statement uses unsupported IAM constructs`,
      );
      continue;
    }

    const actions = toArrayOfStrings(statement.Action);
    const resources = toArrayOfStrings(statement.Resource);
    if (actions.length === 0) {
      skippedPolicies.push(
        `${String(policyDocument.nodeId)}:statement missing Action or Resource`,
      );
      continue;
    }

    if (resources.length === 0 && !policyDocument.allowGraphTargetFallback) {
      skippedPolicies.push(
        `${String(policyDocument.nodeId)}:statement missing Action or Resource`,
      );
      continue;
    }

    resolvedStatements.push({
      policyNodeId: policyDocument.nodeId,
      actions,
      resources,
      allowGraphTargetFallback:
        resources.length === 0 && policyDocument.allowGraphTargetFallback,
    });
  }

  return {
    statements: resolvedStatements,
    skippedPolicies,
  };
};

const collectConnectedRoleNodeIds = (
  graph: Parameters<SemanticDecorator['extract']>[0]['graph'],
  subjectNodeId: NodeId,
): NodeId[] => {
  const queue = adjacentNodeIds(graph, subjectNodeId);
  const visited = new Set<NodeId>();
  const roleNodeIds = new Set<NodeId>();

  for (const nodeId of queue) {
    visited.add(nodeId);
  }

  while (queue.length > 0) {
    const currentNodeId = queue.shift();
    if (!currentNodeId) {
      continue;
    }

    const currentNode = graph.getNodeAttributes(currentNodeId);
    if (!isTraversableIamResource(currentNode)) {
      continue;
    }

    if (resourceTypeOf(currentNode) === 'aws_iam_role') {
      roleNodeIds.add(currentNodeId);
    }

    for (const neighborNodeId of adjacentNodeIds(graph, currentNodeId)) {
      if (neighborNodeId === subjectNodeId || visited.has(neighborNodeId)) {
        continue;
      }

      const neighborNode = graph.getNodeAttributes(neighborNodeId);
      if (!isTraversableIamResource(neighborNode)) {
        continue;
      }

      visited.add(neighborNodeId);
      queue.push(neighborNodeId);
    }
  }

  return [...roleNodeIds];
};

const statementMatchesCapability = (
  statement: PolicyStatement,
  capability: CapabilityDefinition,
): boolean =>
  statement.actions.some((actionPattern) =>
    capability.actionSamples.some((sample) =>
      matchesWildcardPattern(actionPattern, sample, 'i'),
    ),
  );

const resolveMatchedTargets = (
  graph: Parameters<SemanticDecorator['extract']>[0]['graph'],
  statement: PolicyStatement,
  capability: CapabilityDefinition,
  supportedTargets: SupportedTarget[],
): {
  targetNodeIds: NodeId[];
  matchedActionPatterns: string[];
  matchedResourcePatterns: string[];
  unresolvedResourcePatterns: string[];
} => {
  const matchingActionPatterns = statement.actions.filter((actionPattern) =>
    capability.actionSamples.some((sample) =>
      matchesWildcardPattern(actionPattern, sample, 'i'),
    ),
  );

  if (matchingActionPatterns.length === 0) {
    return {
      targetNodeIds: [],
      matchedActionPatterns: [],
      matchedResourcePatterns: [],
      unresolvedResourcePatterns: [],
    };
  }

  const relevantTargets = supportedTargets.filter((target) =>
    capability.supportedTargetResourceTypes.includes(target.resourceType),
  );

  const matchedTargetIds = new Set<NodeId>();
  const matchedResourcePatterns = new Set<string>();
  const unresolvedResourcePatterns = new Set<string>();

  for (const resourcePattern of statement.resources) {
    let matched = false;

    for (const target of relevantTargets) {
      if (
        target.arns.some((candidateArn) =>
          matchesWildcardPattern(resourcePattern, candidateArn),
        )
      ) {
        matched = true;
        matchedTargetIds.add(target.nodeId);
      }
    }

    if (matched) {
      matchedResourcePatterns.add(resourcePattern);
    } else {
      unresolvedResourcePatterns.add(resourcePattern);
    }
  }

  if (
    matchedTargetIds.size === 0 &&
    statement.allowGraphTargetFallback === true
  ) {
    for (const adjacentNodeId of adjacentNodeIds(graph, statement.policyNodeId)) {
      const adjacentNode = graph.getNodeAttributes(adjacentNodeId);
      const adjacentResourceType = resourceTypeOf(adjacentNode);
      if (
        !adjacentResourceType ||
        !capability.supportedTargetResourceTypes.includes(adjacentResourceType)
      ) {
        continue;
      }

      matchedTargetIds.add(adjacentNodeId);
    }
  }

  return {
    targetNodeIds: [...matchedTargetIds],
    matchedActionPatterns: matchingActionPatterns,
    matchedResourcePatterns: [...matchedResourcePatterns],
    unresolvedResourcePatterns: [...unresolvedResourcePatterns],
  };
};

export const normalizeAwsIamPermissionDecoratorConfig = (
  config: unknown,
): AwsIamPermissionSemanticDecoratorConfig => {
  if (!isObjectRecord(config)) {
    return {};
  }

  const capabilities = isArrayOfUnknown(config.capabilities)
    ? config.capabilities.filter(
        (capability): capability is AwsIamPermissionCapability =>
          typeof capability === 'string' &&
          AWS_IAM_PERMISSION_CAPABILITIES.includes(
            capability as AwsIamPermissionCapability,
          ),
      )
    : undefined;

  const subjects = isArrayOfUnknown(config.subjects)
    ? config.subjects
        .filter(isObjectRecord)
        .map((subject) => ({
          resourceTypes: isArrayOfUnknown(subject.resourceTypes)
            ? unique(
                subject.resourceTypes.filter(
                  (resourceType): resourceType is string =>
                    typeof resourceType === 'string' &&
                    resourceType.trim().length > 0,
                ),
              )
            : [],
          projectionNames: isArrayOfUnknown(subject.projectionNames)
            ? unique(
                subject.projectionNames.filter(
                  (projectionName): projectionName is string =>
                    typeof projectionName === 'string' &&
                    projectionName.trim().length > 0,
                ),
              )
            : undefined,
        }))
        .filter((subject) => subject.resourceTypes.length > 0)
    : undefined;

  return {
    capabilities,
    subjects,
  };
};

export const subjectProjectionNamesFor = (
  config: AwsIamPermissionSemanticDecoratorConfig,
  resourceType: string | undefined,
): string[] | undefined => {
  if (!resourceType) {
    return undefined;
  }

  const matchingSubject = config.subjects?.find((subject) =>
    subject.resourceTypes.includes(resourceType),
  );
  return matchingSubject?.projectionNames;
};

export const shouldEvaluateSubject = (
  config: AwsIamPermissionSemanticDecoratorConfig,
  node: TgNodeAttributes | undefined,
): boolean => {
  const resourceType = resourceTypeOf(node);
  if (!resourceType) {
    return false;
  }

  if (!config.subjects || config.subjects.length === 0) {
    return false;
  }

  return config.subjects.some((subject) =>
    subject.resourceTypes.includes(resourceType),
  );
};

export const evaluateAwsIamPermissions = ({
  graph,
  subjectNodeId,
  capabilities,
}: {
  graph: Parameters<SemanticDecorator['extract']>[0]['graph'];
  subjectNodeId: NodeId;
  capabilities: AwsIamPermissionCapability[];
}): AwsIamPermissionEvaluationResult => {
  const roleNodeIds = unique(collectConnectedRoleNodeIds(graph, subjectNodeId));
  const supportedTargets = collectSupportedTargets(graph);
  const skippedPolicies = new Set<string>();
  const policyNodeIds = new Set<NodeId>();
  const matchedCapabilities = new Map<
    AwsIamPermissionCapability,
    AwsIamPermissionMatchedCapability
  >();

  for (const roleNodeId of roleNodeIds) {
    const { policyDocuments, skippedPolicies: roleSkippedPolicies } =
      collectRoleReachablePolicyDocuments(graph, roleNodeId);
    for (const skippedPolicy of roleSkippedPolicies) {
      skippedPolicies.add(skippedPolicy);
    }

    for (const policyDocument of policyDocuments) {
      policyNodeIds.add(policyDocument.nodeId);
      const { statements, skippedPolicies: statementSkippedPolicies } =
        resolveStatements(policyDocument);
      for (const skippedPolicy of statementSkippedPolicies) {
        skippedPolicies.add(skippedPolicy);
      }

      for (const capabilityName of capabilities) {
        const capability = CAPABILITY_DEFINITIONS[capabilityName];
        for (const statement of statements) {
          if (!statementMatchesCapability(statement, capability)) {
            continue;
          }

          const matchedTargets = resolveMatchedTargets(
            graph,
            statement,
            capability,
            supportedTargets,
          );
          const current =
            matchedCapabilities.get(capabilityName) ??
            ({
              capability: capability.capability,
              factKind: capability.factKind,
              roleNodeIds: [],
              policyNodeIds: [],
              targetNodeIds: [],
              matchedActionPatterns: [],
              matchedResourcePatterns: [],
              unresolvedResourcePatterns: [],
            } satisfies AwsIamPermissionMatchedCapability);

          current.roleNodeIds = unique([...current.roleNodeIds, roleNodeId]);
          current.policyNodeIds = unique([
            ...current.policyNodeIds,
            statement.policyNodeId,
          ]);
          current.targetNodeIds = unique([
            ...current.targetNodeIds,
            ...matchedTargets.targetNodeIds,
          ]);
          current.matchedActionPatterns = unique([
            ...current.matchedActionPatterns,
            ...matchedTargets.matchedActionPatterns,
          ]);
          current.matchedResourcePatterns = unique([
            ...current.matchedResourcePatterns,
            ...matchedTargets.matchedResourcePatterns,
          ]);
          current.unresolvedResourcePatterns = unique([
            ...current.unresolvedResourcePatterns,
            ...matchedTargets.unresolvedResourcePatterns,
          ]);

          matchedCapabilities.set(capabilityName, current);
        }
      }
    }
  }

  return {
    roleNodeIds,
    policyNodeIds: [...policyNodeIds],
    capabilities: [...matchedCapabilities.values()],
    skippedPolicies: [...skippedPolicies],
  };
};
