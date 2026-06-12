import { type AdapterOperations, type TgNodeAttributes, resolveNodeArn } from '@terra-graph/core';
import { unique } from '../../../utils.js';
import type { SupportedTarget } from '../AwsIamPermissionEvaluation.js';
import type { ResourceResolver } from '../Resources.js';

export class DefaultResolver implements ResourceResolver {
  public resolveSupportedTargetArns(
    node: TgNodeAttributes,
    valueCandidates: Record<string, unknown>[],
  ) {
    return unique(
      [resolveNodeArn(node), ...valueCandidates.map((values) => values.arn)].filter(
        (value): value is string => typeof value === 'string',
      ),
    );
  }

  public resolveTargetNames(valueCandidates: Record<string, unknown>[]): string[] {
    return unique(
      valueCandidates
        .map((values) => values.name)
        .filter((value): value is string => typeof value === 'string'),
    );
  }

  public resourceNamePatternFromArnPattern(resourcePattern: string): string | undefined {
    return undefined;
  }

  public afterCollectSupportedTargets(targets: SupportedTarget[], graph: AdapterOperations) {
    return;
  }
}
