import { findOrthogonalRoute } from './aStar'
import {
  bendCount,
  inflateRectangle,
  polylineLength,
  portPoint,
  reverseDirection,
  simplifyOrthogonalPoints,
} from './geometry'
import { nudgeSharedRoutes } from './nudging'
import type {
  Connector,
  Point,
  Rectangle,
  RoutedConnector,
  RoutingOptions,
  RoutingResult,
} from './types'
import { buildOrthogonalVisibilityGraph } from './visibilityGraph'

export type RoutingBounds = {
  /** 路由搜索区域最左侧的 x 坐标。 */
  left: number
  /** 路由搜索区域最上侧的 y 坐标。 */
  top: number
  /** 路由搜索区域最右侧的 x 坐标。 */
  right: number
  /** 路由搜索区域最下侧的 y 坐标。 */
  bottom: number
}

/**
 * 算法内部总调度器，严格串联论文的三个阶段：
 *
 * 1. 根据对象外接矩形和端口构造正交可见性图；
 * 2. 为每条 connector 单独运行方向感知 A*；
 * 3. 统一处理所有已找到路径的共享边顺序和最终坐标。
 *
 * 该函数不读取 React Flow 状态，也不生成 SVG，因此可以独立复用。
 *
 * @param rectangles 图中所有对象的外接矩形；它们同时也是需要绕开的障碍物。
 * @param connectors 待求解的连接线定义；每项给出源端口、目标端口和展示信息。
 * @param options clearance、折弯惩罚和共享车道间距等路由参数。
 * @param bounds 允许建立外围绕行通道的搜索区域边界。
 * @returns 可见图、A* 原始路径、最终错开路径以及调试统计。
 */
export function routeDiagram(
  rectangles: Rectangle[],
  connectors: Connector[],
  options: RoutingOptions,
  bounds: RoutingBounds,
): RoutingResult {
  // 后续需要由 nodeId 找到端口所属矩形，Map 避免为每条连接线反复线性查找。
  const rectangleById = new Map(rectangles.map((rectangle) => [rectangle.id, rectangle]))

  // 先把障碍物向外扩张 clearance，再让路径贴着扩张后的边界走。
  // 这等价于在不改变线宽的情况下给真实对象预留安全距离。
  const expandedObstacles = rectangles.map((rectangle) =>
    inflateRectangle(rectangle, options.clearance),
  )

  // 一个端口有两个相关坐标：
  // point 是真实节点边界上的绘制端点；routingPoint 是安全区边界上的寻路端点。
  const terminalPairs = connectors.map((connector) => {
    // sourceRectangle 是 connector.source.nodeId 指向的源对象外接矩形。
    const sourceRectangle = rectangleById.get(connector.source.nodeId)
    // targetRectangle 是 connector.target.nodeId 指向的目标对象外接矩形。
    const targetRectangle = rectangleById.get(connector.target.nodeId)

    if (!sourceRectangle || !targetRectangle) {
      throw new Error(`Connector ${connector.id} references a missing node`)
    }

    return {
      // 保留原始连接线配置，后面执行 A* 时还要读取起止方向、ID、颜色等信息。
      connector,

      // 源节点边界上的真实连接点，也是最终 SVG 路径的第一个点。
      // distance 没有传值，portPoint() 默认使用 0，所以该点仍位于原始矩形边缘。
      sourcePoint: portPoint(
        sourceRectangle,
        connector.source.side,
        connector.source.offset,
      ),

      // A* 实际使用的寻路起点。
      // 它从真实源连接点沿 source.side 向矩形外移动 clearance，
      // 使后续可见图路径从对象安全区边界开始，不会紧贴或穿过源对象。
      sourceRoutingPoint: portPoint(
        sourceRectangle,
        connector.source.side,
        connector.source.offset,
        options.clearance,
      ),

      // A* 实际使用的寻路终点。
      // 它位于目标对象安全区边界，距离真实目标连接点 clearance。
      // A* 只负责 sourceRoutingPoint 到 targetRoutingPoint 之间的避障路径。
      targetRoutingPoint: portPoint(
        targetRectangle,
        connector.target.side,
        connector.target.offset,
        options.clearance,
      ),

      // 目标节点边界上的真实连接点，也是最终 SVG 路径的最后一个点。
      // 最终组装路径时，会用一条短的正交线段连接 targetRoutingPoint 和该点。
      targetPoint: portPoint(
        targetRectangle,
        connector.target.side,
        connector.target.offset,
      ),
    }
  })

  // terminals 是所有连接线的安全区起止点；它们必须进入可见图节点集合，
  // 否则 A* 无法从具体端口开始或在具体端口结束。
  const terminals = terminalPairs.flatMap((pair) => [
    pair.sourceRoutingPoint,
    pair.targetRoutingPoint,
  ])

  // 把画布四角作为额外关键点，使最外层障碍物之外也存在可供绕行的通道。
  const canvasCorners: Point[] = [
    { x: bounds.left, y: bounds.top },
    { x: bounds.right, y: bounds.top },
    { x: bounds.right, y: bounds.bottom },
    { x: bounds.left, y: bounds.bottom },
  ]
  // graph 是所有 connector 共用的正交可见性图，避免重复为每条线构图。
  const graph = buildOrthogonalVisibilityGraph(
    expandedObstacles,
    terminals,
    canvasCorners,
  )
  // routes 保存成功找到的第二阶段逻辑路径，尚未进行共享边错开。
  const routes: RoutedConnector[] = []
  // failedConnectorIds 收集无合法路径的 connector ID，供界面展示失败信息。
  const failedConnectorIds: string[] = []
  // visitedNodeIds 合并所有 A* 曾扩展过的图节点，用于搜索阶段的可视化高亮。
  const visitedNodeIds = new Set<string>()

  // 每条连接线共享同一张可见性图，但拥有独立的起点、终点和 A* 状态空间。
  // pair 同时包含原 connector、真实端点和安全区 routing point。
  for (const pair of terminalPairs) {
    // result 是该连接线的最优 A* 路径；不存在合法路径时为 null。
    const result = findOrthogonalRoute(
      graph,
      pair.sourceRoutingPoint,
      // source.side 是连接线从源对象向外离开时的初始进入方向。
      pair.connector.source.side,
      pair.targetRoutingPoint,
      // 目标端口在对象西侧时，线路必须向东进入目标，因此要取 side 的反方向。
      reverseDirection(pair.connector.target.side),
      options.bendPenalty,
    )

    if (!result) {
      failedConnectorIds.push(pair.connector.id)
      continue
    }

    // nodeId 是本次 A* 扩展过的一个可见图节点 ID；合并进全局集合用于展示。
    result.visitedNodeIds.forEach((nodeId) => visitedNodeIds.add(nodeId))

    // A* 只负责两个 routing point 之间的路径；这里补回真实端口短引线，
    // 再删除连续共线的中间点，得到第二阶段可以展示的逻辑折线。
    const rawPoints = simplifyOrthogonalPoints([
      pair.sourcePoint,
      ...result.points,
      pair.targetPoint,
    ])

    routes.push({
      ...pair.connector,
      ...pair,
      graphPoints: result.points,
      rawPoints,
      length: polylineLength(rawPoints),
      bends: bendCount(rawPoints),
      expandedStates: result.expandedStates,
    })
  }

  // A* 是逐条连接线执行的；共享边排序必须看到所有路径，所以统一放在循环之后。
  // nudged 包含共享边排序、分离约束数量和错开后的最终路径坐标。
  const nudged = nudgeSharedRoutes(routes, options.laneGap)

  // 同时返回三个阶段的数据，既供最终绘制，也供 Demo 分阶段观察中间结果。
  return {
    graph,
    routes,
    finalRoutes: nudged.finalRoutes,
    sharedEdges: nudged.sharedEdges,
    separationConstraintCount: nudged.constraintCount,
    failedConnectorIds,
    visitedNodeIds,
  }
}
