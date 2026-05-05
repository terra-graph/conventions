import { EdgeSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeSemantics } from '../edgeSemantics.js';

export const networkSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_route_table_association'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_route_table'],
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
            in: ['aws_route_table'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_route', 'aws_vpn_gateway_route_propagation'],
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
            in: ['aws_route'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_internet_gateway'],
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
            in: ['aws_route'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_nat_gateway'],
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
            in: ['aws_route'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_vpc_endpoint'],
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
            in: ['aws_security_group'],
          },
        },
        to: {
          and: [
            {
              any: true,
            },
            {
              not: {
                attr: {
                  key: 'terraform.resource',
                  in: [
                    'aws_vpc',
                    'aws_subnet',
                    'aws_security_group',
                    'aws_vpc_security_group_ingress_rule',
                    'aws_vpc_security_group_egress_rule',
                    'aws_security_group_rule',
                  ],
                },
              },
            },
          ],
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Authorizes,
        enforceDirection: true,
      },
    }),
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_vpc_security_group_ingress_rule'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_security_group'],
          },
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Authorizes,
        enforceDirection: true,
      },
    }),
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_vpc_security_group_egress_rule'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_security_group'],
          },
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Authorizes,
        enforceDirection: true,
      },
    }),
  ],
});

export default networkSemanticsRuleSet;
