import { routeDiagram, type RoutingBounds } from './router'
import type {
  Connector,
  Rectangle,
  RoutingOptions,
  RoutingResult,
} from './types'

export type OrthogonalRouterInput = {
  /** 当前画布中所有需要避让的节点外接矩形。 */
  rectangles: Rectangle[]
  /** 需要计算路径的连接线及其起止端口。 */
  connectors: Connector[]
  /** 算法可以使用的画布范围，为最外层绕行提供候选坐标。 */
  bounds: RoutingBounds
  /** 障碍间距、折弯惩罚和共享线路间距。 */
  options: RoutingOptions
}

/**
 * 正交路由算法的唯一公共入口。
 * UI 只提交矩形、连接器和参数，不需要了解可见性图、A* 或 VPSC 的内部结构。
 */
export class OrthogonalRouter {
  /**
   * 对调用者隐藏内部阶段，只暴露一个同步、无副作用的 route 方法。
   * 相同输入一定得到相同输出，因此 React 可以安全地用 useMemo 缓存结果。
   */
  route(input: OrthogonalRouterInput): RoutingResult {
    // 这里只负责把具名对象参数按内部函数需要的顺序转交；
    // 真正的构图、A* 和最终放置均在 routeDiagram() 中完成。
    return routeDiagram(
      input.rectangles,
      input.connectors,
      input.options,
      input.bounds,
    )
  }
}
