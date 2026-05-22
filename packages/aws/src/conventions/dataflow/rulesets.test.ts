import { conventionName, ruleSetName } from '../../namespaces.js';
import { Convention } from '../index.js';
import { AwsEdgeSemantics } from './edgeSemantics.js';
import dataFlowConventionRules from './rules.js';
import dataFlowConventionRuleSet from './rulesets.js';

describe('dataflow convention rule sets', () => {
  it('shoud register the dataflow phase rule sets', () => {
    const names = dataFlowConventionRuleSet.names();
    expect(names).toHaveLength(3);
    expect(names).toEqual(
      expect.arrayContaining([
        conventionName(Convention.DataFlow, ruleSetName('pre')),
        conventionName(Convention.DataFlow, ruleSetName('main')),
        conventionName(Convention.DataFlow, ruleSetName('final')),
      ]),
    );
  });

  it('shoud expand all semantic rules from the main rule set', () => {
    const ruleSet = dataFlowConventionRuleSet.resolve(
      conventionName(Convention.DataFlow, ruleSetName('main')),
    );
    const phases = ruleSet.resolvePhases(dataFlowConventionRules);
    const semanticValues = new Set<string>(
      Object.values(AwsEdgeSemantics).map(({ semantic }) => semantic),
    );

    expect(phases).toHaveLength(1);
    const phaseRuleIds = phases[0].map((rule) => rule.serialize().id);
    expect(phaseRuleIds).not.toContain('EdgeSemanticLegend');
    expect(phaseRuleIds.filter((id) => id === 'EdgeSemantic').length).toBeGreaterThan(13);

    const semanticNames = phases[0]
      .filter((rule) => rule.serialize().id === 'EdgeSemantic')
      .map(
        (rule) =>
          (
            rule.serialize().config as {
              options?: { semantic?: { semantic?: string } };
            }
          ).options?.semantic?.semantic,
      );
    expect(semanticNames.length).toBeGreaterThan(13);
    for (const semantic of semanticNames) {
      expect(semantic).toBeDefined();
      expect(semanticValues.has(semantic as string)).toBe(true);
    }
  });

  it('shoud expose the semantic legend from the final rule set', () => {
    const ruleSet = dataFlowConventionRuleSet.resolve(
      conventionName(Convention.DataFlow, ruleSetName('final')),
    );
    const phases = ruleSet.resolvePhases(dataFlowConventionRules);
    const semanticValues = new Set<string>(
      Object.values(AwsEdgeSemantics).map(({ semantic }) => semantic),
    );
    const semanticLegendRule = phases[0]?.find(
      (rule) => rule.serialize().id === 'EdgeSemanticLegend',
    );
    expect(semanticLegendRule).toBeDefined();
    const legendBySemantic =
      (
        semanticLegendRule?.serialize().config as {
          options?: { legendBySemantic?: Record<string, unknown> };
        }
      ).options?.legendBySemantic ?? {};
    for (const semantic of Object.keys(legendBySemantic)) {
      expect(semanticValues.has(semantic)).toBe(true);
    }
  });

  it('shoud include the network semantics rules and remove canonical alb route semantics', () => {
    const ruleSet = dataFlowConventionRuleSet.resolve(
      conventionName(Convention.DataFlow, ruleSetName('main')),
    );
    const phases = ruleSet.resolvePhases(dataFlowConventionRules);
    const serializedRules = phases[0].map((rule) => rule.serialize());

    expect(serializedRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'EdgeSemantic',
          config: expect.objectContaining({
            options: expect.objectContaining({
              semantic: AwsEdgeSemantics.Invokes,
              enforceDirection: true,
            }),
            edge: expect.objectContaining({
              from: expect.objectContaining({
                attr: expect.objectContaining({
                  key: 'terraform.resource',
                  in: ['aws_apigatewayv2_route', 'aws_api_gateway_method'],
                }),
              }),
              to: expect.objectContaining({
                attr: expect.objectContaining({
                  key: 'terraform.resource',
                  in: ['aws_apigatewayv2_integration', 'aws_api_gateway_integration'],
                }),
              }),
            }),
          }),
        }),
      ]),
    );

    expect(serializedRules).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'EdgeSemantic',
          config: expect.objectContaining({
            edge: expect.objectContaining({
              from: expect.objectContaining({
                attr: expect.objectContaining({
                  key: 'terraform.resource',
                  in: ['aws_lb'],
                }),
              }),
            }),
          }),
        }),
      ]),
    );
  });

  it('shoud include alb cleanup rules for listeners and target groups', () => {
    const ruleSet = dataFlowConventionRuleSet.resolve(
      conventionName(Convention.DataFlow, ruleSetName('main')),
    );
    const phases = ruleSet.resolvePhases(dataFlowConventionRules);
    const serializedRules = phases[0].map((rule) => rule.serialize());

    expect(serializedRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MaterializeDirectAlbRoutes',
          config: expect.objectContaining({
            node: expect.objectContaining({
              attr: expect.objectContaining({
                key: 'terraform.resource',
                eq: 'aws_lb',
              }),
            }),
          }),
        }),
        expect.objectContaining({
          id: 'RemoveNode',
          config: expect.objectContaining({
            node: expect.objectContaining({
              attr: expect.objectContaining({
                key: 'terraform.resource',
                eq: 'aws_lb_listener',
              }),
            }),
          }),
        }),
        expect.objectContaining({
          id: 'RemoveNode',
          config: expect.objectContaining({
            node: expect.objectContaining({
              attr: expect.objectContaining({
                key: 'terraform.resource',
                eq: 'aws_lb_target_group',
              }),
            }),
          }),
        }),
      ]),
    );
    expect(serializedRules).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'EdgeSemantic',
          config: expect.objectContaining({
            edge: expect.objectContaining({
              from: expect.objectContaining({
                attr: expect.objectContaining({
                  key: 'terraform.resource',
                  in: ['aws_lb', 'aws_lb_listener', 'aws_lb_target_group'],
                }),
              }),
            }),
          }),
        }),
      ]),
    );
  });

  it('shoud include ec2 cleanup rules for launch templates', () => {
    const ruleSet = dataFlowConventionRuleSet.resolve(
      conventionName(Convention.DataFlow, ruleSetName('main')),
    );
    const phases = ruleSet.resolvePhases(dataFlowConventionRules);
    const serializedRules = phases[0].map((rule) => rule.serialize());

    expect(serializedRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'RemoveNode',
          config: expect.objectContaining({
            node: expect.objectContaining({
              attr: expect.objectContaining({
                key: 'terraform.resource',
                eq: 'aws_launch_template',
              }),
            }),
          }),
        }),
      ]),
    );
  });

  it('shoud include ecs cleanup rules for cluster control plane nodes', () => {
    const ruleSet = dataFlowConventionRuleSet.resolve(
      conventionName(Convention.DataFlow, ruleSetName('main')),
    );
    const phases = ruleSet.resolvePhases(dataFlowConventionRules);
    const serializedRules = phases[0].map((rule) => rule.serialize());

    expect(serializedRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'RemoveNode',
          config: expect.objectContaining({
            node: expect.objectContaining({
              attr: expect.objectContaining({
                key: 'terraform.resource',
                eq: 'aws_ecs_cluster',
              }),
            }),
          }),
        }),
      ]),
    );
  });

  it('shoud enforce direction for IAM authorizes semantics', () => {
    const ruleSet = dataFlowConventionRuleSet.resolve(
      conventionName(Convention.DataFlow, ruleSetName('main')),
    );
    const phases = ruleSet.resolvePhases(dataFlowConventionRules);
    const serializedRules = phases[0].map((rule) => rule.serialize());

    expect(serializedRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'EdgeSemantic',
          config: expect.objectContaining({
            options: expect.objectContaining({
              semantic: AwsEdgeSemantics.Authorizes,
              enforceDirection: true,
            }),
            edge: expect.objectContaining({
              from: expect.objectContaining({
                attr: expect.objectContaining({
                  key: 'terraform.resource',
                  startsWith: 'aws_iam_',
                }),
              }),
              to: expect.objectContaining({
                any: true,
              }),
            }),
          }),
        }),
      ]),
    );
  });

  it('shoud carry the expected semantic roles for supporting and primary edges', () => {
    expect(AwsEdgeSemantics.Authorizes.role).toBe('supporting');
    expect(AwsEdgeSemantics.Accesses.role).toBe('primary');
    expect(AwsEdgeSemantics.ObservedBy.role).toBe('supporting');
    expect(AwsEdgeSemantics.Invokes.role).toBe('primary');
    expect(AwsEdgeSemantics.Routes.role).toBe('primary');
  });

  it('shoud tolerate empty resolved phases from imported rule sets', () => {
    jest.resetModules();
    jest.doMock('./rulesets/lambda.js', () => ({
      __esModule: true,
      default: { resolvePhases: () => [] },
      lambdaPreRuleSet: { resolvePhases: () => [] },
    }));
    jest.doMock('./rulesets/alb.js', () => ({
      __esModule: true,
      default: { resolvePhases: () => [] },
      albCleanupRuleSet: { resolvePhases: () => [] },
    }));
    jest.doMock('./rulesets/ec2.js', () => ({
      __esModule: true,
      default: { resolvePhases: () => [] },
    }));
    jest.doMock('./rulesets/ecs.js', () => ({
      __esModule: true,
      default: { resolvePhases: () => [] },
      ecsCleanupRuleSet: { resolvePhases: () => [] },
    }));
    jest.doMock('./rulesets/iam.js', () => ({
      __esModule: true,
      default: { resolvePhases: () => [] },
    }));

    try {
      const reloadedRuleSets = (
        require('./rulesets.js') as {
          default: typeof dataFlowConventionRuleSet;
        }
      ).default;

      const pre = reloadedRuleSets
        .resolve(conventionName(Convention.DataFlow, ruleSetName('pre')))
        .resolvePhases(dataFlowConventionRules);
      const main = reloadedRuleSets
        .resolve(conventionName(Convention.DataFlow, ruleSetName('main')))
        .resolvePhases(dataFlowConventionRules);
      const final = reloadedRuleSets
        .resolve(conventionName(Convention.DataFlow, ruleSetName('final')))
        .resolvePhases(dataFlowConventionRules);

      expect(pre).toHaveLength(1);
      expect(main).toHaveLength(1);
      expect(final).toHaveLength(1);
    } finally {
      jest.dontMock('./rulesets/lambda.js');
      jest.dontMock('./rulesets/alb.js');
      jest.dontMock('./rulesets/ec2.js');
      jest.dontMock('./rulesets/ecs.js');
      jest.dontMock('./rulesets/iam.js');
      jest.resetModules();
    }
  });
});
