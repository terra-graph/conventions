export const PACKAGE_NAMESPACE = '@terra-graph/conventions-core';

export const pluginId = (pluginName: string): string => `${PACKAGE_NAMESPACE}:plugin:${pluginName}`;
export const ruleName = (ruleName: string): string => `${PACKAGE_NAMESPACE}:rule:${ruleName}`;
export const ruleSetName = (ruleSetName: string) => `${PACKAGE_NAMESPACE}:ruleset:${ruleSetName}`;
export const profileName = (profileName: string): string =>
  `${PACKAGE_NAMESPACE}:profile:${profileName}`;
