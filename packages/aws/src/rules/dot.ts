import { AlignNodes, NamedRuleRegistry } from 'terra-graph';
import { ruleName } from '../namespaces.js';

export default new NamedRuleRegistry({
  [ruleName('dot.sqs.dlq.align')]: new AlignNodes({
    edge: {
      from: {
        attr: { key: 'terraform.resource', eq: 'aws_sqs_queue' },
      },
      to: {
        attr: { key: 'terraform.resource', eq: 'aws_sqs_queue' },
      },
    },
  }),
  [ruleName('dot.schedule.align')]: new AlignNodes({
    edge: {
      from: {
        attr: { key: 'terraform.resource', eq: 'aws_scheduler_schedule' },
      },
      to: {
        any: true,
      },
    },
  }),
  [ruleName('dot.iam_role.align')]: new AlignNodes({
    edge: {
      from: {
        attr: { key: 'terraform.resource', eq: 'aws_iam_role' },
      },
      to: {
        any: true,
      },
    },
  }),
});
