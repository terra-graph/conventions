import { EdgeDirectionSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeDirectionSemantics } from '../edgeSemantics.js';

export const networkSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeDirectionSemantic({
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
        semantic: AwsEdgeDirectionSemantics.Routes,
        enforceDirection: true,
      },
    }),
    new EdgeDirectionSemantic({
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
        semantic: AwsEdgeDirectionSemantics.Routes,
        enforceDirection: true,
      },
    }),
    new EdgeDirectionSemantic({
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
        semantic: AwsEdgeDirectionSemantics.Routes,
        enforceDirection: true,
      },
    }),
    new EdgeDirectionSemantic({
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
        semantic: AwsEdgeDirectionSemantics.Routes,
        enforceDirection: true,
      },
    }),
    new EdgeDirectionSemantic({
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
        semantic: AwsEdgeDirectionSemantics.Routes,
        enforceDirection: true,
      },
    }),
    new EdgeDirectionSemantic({
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
        semantic: AwsEdgeDirectionSemantics.Authorizes,
        enforceDirection: true,
      },
    }),
    new EdgeDirectionSemantic({
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
        semantic: AwsEdgeDirectionSemantics.Authorizes,
        enforceDirection: true,
      },
    }),
    new EdgeDirectionSemantic({
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
        semantic: AwsEdgeDirectionSemantics.Authorizes,
        enforceDirection: true,
      },
    }),
  ],
});

export default networkSemanticsRuleSet;
