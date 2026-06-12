import {
  type TgNodeAttributes,
  isArrayOfUnknown,
  isObjectRecord,
  isTerraformValues,
} from '@terra-graph/core';

export const unique = <T>(values: Iterable<T>): T[] => [...new Set(values)];

export const toArrayOfStrings = (value: unknown): string[] => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value];
  }

  if (!isArrayOfUnknown(value)) {
    return [];
  }

  return unique(
    value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0),
  );
};

export const parseJsonObject = (value: string): Record<string, unknown> | undefined => {
  try {
    const parsed = JSON.parse(value);
    return isObjectRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export const parseJsonArrayOfStrings = (value: unknown): string[] => {
  if (!isArrayOfUnknown(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
};

export const resourceTypeOf = (node: TgNodeAttributes | undefined): string | undefined =>
  node?.terraform?.resource;

export const collectTerraformStateValueCandidates = (
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
