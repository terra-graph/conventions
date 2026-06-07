import {
  type AdapterOperations,
  type NodeId,
  NodeRule,
  type NodeRuleConfig,
  type TgNodeAttributes,
  isObjectRecord,
} from '@terra-graph/core';

type LayoutFlowOrderOptions = {
  flowOrder?: number;
  order?: string[][];
  orderPriority?: Record<string, number>;
  step?: number;
};

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isFinite(value);
};

export class LayoutFlowOrder extends NodeRule {
  private readonly options: LayoutFlowOrderOptions;

  constructor(config: NodeRuleConfig) {
    if (config.options === undefined) {
      throw new Error(`Rule '${LayoutFlowOrder.name}' requires options in config`);
    }
    super(config);
    this.options = this.parseOptions(config.options);
  }

  public override apply(
    nodeId: NodeId,
    node: TgNodeAttributes,
    graph: AdapterOperations,
  ): AdapterOperations {
    if (!this.wasMatched(nodeId)) {
      return graph;
    }

    const resolvedFlowOrder = this.resolveFlowOrder(node);
    if (resolvedFlowOrder === undefined) {
      return graph;
    }

    return graph.setNodeAttributes(nodeId, {
      ...node,
      hints: {
        ...(node.hints ?? {}),
        layout: {
          ...(node.hints?.layout ?? {}),
          flowOrder: resolvedFlowOrder,
        },
      },
    });
  }

  private resolveFlowOrder(node: TgNodeAttributes): number | undefined {
    if (this.options.flowOrder !== undefined) {
      return this.options.flowOrder;
    }

    const resource = node.terraform?.resource;
    if (!resource) {
      return undefined;
    }

    const chainOrder = this.resolveFlowOrderFromChain(resource);
    if (chainOrder !== undefined) {
      return chainOrder;
    }

    return this.options.orderPriority?.[resource];
  }

  private resolveFlowOrderFromChain(resource: string): number | undefined {
    const step = this.options.step ?? 10;

    for (const chain of this.options.order ?? []) {
      const resourceIndex = chain.indexOf(resource);
      if (resourceIndex !== -1) {
        return (resourceIndex + 1) * step;
      }
    }

    return undefined;
  }

  private parseOptions(input: unknown): LayoutFlowOrderOptions {
    if (!isObjectRecord(input)) {
      throw new Error(`Rule '${LayoutFlowOrder.name}' requires options to be an object`);
    }

    const { flowOrder, order, orderPriority, step } = input;

    if (flowOrder !== undefined && !isFiniteNumber(flowOrder)) {
      throw new Error(
        `Rule '${LayoutFlowOrder.name}' requires options.flowOrder to be a finite number`,
      );
    }

    if (step !== undefined && (!isFiniteNumber(step) || step <= 0)) {
      throw new Error(
        `Rule '${LayoutFlowOrder.name}' requires options.step to be a positive finite number`,
      );
    }

    if (order !== undefined) {
      const isValidOrder =
        Array.isArray(order) &&
        order.every(
          (chain) => Array.isArray(chain) && chain.every((entry) => typeof entry === 'string'),
        );
      if (!isValidOrder) {
        throw new Error(
          `Rule '${LayoutFlowOrder.name}' requires options.order to be an array of string arrays`,
        );
      }
    }

    if (orderPriority !== undefined) {
      const isValidPriority =
        isObjectRecord(orderPriority) &&
        Object.values(orderPriority).every((value) => isFiniteNumber(value));
      if (!isValidPriority) {
        throw new Error(
          `Rule '${LayoutFlowOrder.name}' requires options.orderPriority to be a record of finite numbers`,
        );
      }
    }

    return {
      flowOrder: flowOrder as number | undefined,
      order: order as string[][] | undefined,
      orderPriority: orderPriority as Record<string, number> | undefined,
      step: step as number | undefined,
    };
  }
}

NodeRule.register(LayoutFlowOrder);
