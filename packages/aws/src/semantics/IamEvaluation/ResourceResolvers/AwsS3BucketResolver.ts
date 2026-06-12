import { type TgNodeAttributes, isTerraformValues, resolveNodeArn } from '@terra-graph/core';
import { unique } from '../../../utils.js';
import { DefaultResolver } from './DefaultResolver.js';

export class AwsS3BucketResolver extends DefaultResolver {
  public override resolveSupportedTargetArns(
    node: TgNodeAttributes,
    valueCandidates: Record<string, unknown>[],
  ) {
    const bucketArn = (() => {
      const directArn = resolveNodeArn(node);
      if (directArn) {
        return directArn;
      }

      const values = node.terraform?.state?.effective?.values;
      if (!isTerraformValues(values)) {
        return undefined;
      }

      return typeof values.bucket === 'string' ? `arn:aws:s3:::${values.bucket}` : undefined;
    })();
    return bucketArn ? unique([bucketArn, `${bucketArn}/*`]) : [];
  }

  public override resolveTargetNames(valueCandidates: Record<string, unknown>[]): string[] {
    return unique(
      valueCandidates
        .map((values) => values.bucket)
        .filter((value): value is string => typeof value === 'string'),
    );
  }

  public override resourceNamePatternFromArnPattern(resourcePattern: string): string | undefined {
    const match = resourcePattern.match(/^arn:[^:]*:s3:::(.+?)(?:\/.*)?$/);
    return match?.[1];
  }
}
