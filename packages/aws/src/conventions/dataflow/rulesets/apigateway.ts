import { EdgeSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeSemantics } from '../edgeSemantics.js';

const API_RESOURCES = ['aws_apigatewayv2_api', 'aws_api_gateway_rest_api'];
const ROUTE_RESOURCES = [
  'aws_apigatewayv2_route',
  'aws_api_gateway_resource',
  'aws_api_gateway_method',
];
const ROUTE_TO_INTEGRATION_RESOURCES = ['aws_apigatewayv2_route', 'aws_api_gateway_method'];
const INTEGRATION_RESOURCES = ['aws_apigatewayv2_integration', 'aws_api_gateway_integration'];
const NON_TARGET_RESOURCE_PREFIXES = [
  'aws_apigatewayv2_',
  'aws_api_gateway_',
  'aws_iam_',
  'aws_lambda_permission',
];

export const apiGatewaySemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: API_RESOURCES,
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ROUTE_RESOURCES,
          },
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Routes,
        enforceDirection: true,
      },
    }),
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ROUTE_TO_INTEGRATION_RESOURCES,
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: INTEGRATION_RESOURCES,
          },
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Invokes,
        enforceDirection: true,
      },
    }),
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: INTEGRATION_RESOURCES,
          },
        },
        to: {
          not: {
            attr: {
              key: 'terraform.resource',
              startsWith: NON_TARGET_RESOURCE_PREFIXES,
            },
          },
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Invokes,
        enforceDirection: true,
      },
    }),
  ],
});

export default apiGatewaySemanticsRuleSet;
