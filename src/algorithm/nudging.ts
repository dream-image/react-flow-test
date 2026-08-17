import {
  samePoint,
  segmentKey,
  simplifyOrthogonalPoints,
} from './geometry'
import type {
  FinalConnector,
  Point,
  RoutedConnector,
  SharedEdgeOrder,
} from './types'

type Orientation = 'horizontal' | 'vertical'

/**
 * 路径中一条极大水平/垂直线段。
 * 同一直线上的多个连续可见图边会合并成一个变量，最终只移动这个变量的 x 或 y。
 */
type MaximalSegment = {
  /** 在线段变量表中的唯一 ID，格式为“连接线 ID + 在线路中的线段序号”。 */
  id: string
  /** 该线段所属的连接线 ID。 */
  routeId: string
  /** 水平线段只能上下移动，垂直线段只能左右移动。 */
  orientation: Orientation
  /** 原始路径坐标，也是没有共享边冲突时最希望保留的 desired position。 */
  desired: number
  /** 约束投影后的实际坐标；水平线段表示 y，垂直线段表示 x。 */
  value: number
  /** 该极大线段覆盖的第一条可见图原子边下标。 */
  firstEdgeIndex: number
  /** 该极大线段覆盖的最后一条可见图原子边下标。 */
  lastEdgeIndex: number
}

/** 一条连接线参与最终放置时需要的线段变量及原子边映射。 */
type RouteLayout = {
  /** A* 输出的原始连接线路由。 */
  route: RoutedConnector
  /** 从 route.graphPoints 合并得到的极大水平/垂直线段。 */
  segments: MaximalSegment[]
  /** 原子边下标 → 控制该边坐标的 MaximalSegment.id。 */
  edgeToSegment: string[]
}

/** 一条连接线对某条原子可见图边的使用记录。 */
type EdgeUse = {
  /** 使用该共享原子边的连接线 ID。 */
  routeId: string
  /** 该原子边在所属 route.graphPoints 中的起点下标。 */
  edgeIndex: number
  /** 最终移动该原子边的极大线段变量 ID。 */
  segmentId: string
}

/** 被至少两条不同连接线使用的可见图边。 */
type SharedEdge = {
  /** 与方向无关的原子边坐标键。 */
  key: string
  /** 统一伪方向下的起点。 */
  start: Point
  /** 统一伪方向下的终点。 */
  end: Point
  /** 所有连接线对这条原子边的使用记录。 */
  uses: EdgeUse[]
}

/**
 * 一维分离约束：upper.value - lower.value >= gap。
 * 水平 pass 中 value 是 y，垂直 pass 中 value 是 x。
 */
type SeparationConstraint = {
  /** 在一维坐标轴上必须位于较小一侧的线段变量 ID。 */
  lowerId: string
  /** 在一维坐标轴上必须位于较大一侧的线段变量 ID。 */
  upperId: string
  /** 两个线段坐标至少需要保持的像素距离。 */
  gap: number
}

/**
 * 为无向边选定统一伪方向：水平边从左到右，垂直边从上到下。
 * 所有连接线都按这个方向讨论“左侧、同向、右侧”，避免各说各话。
 */
function canonicalSegment(start: Point, end: Point): [Point, Point] {
  // 先比较 x，再比较 y：水平边会从左到右，垂直边会从上到下。
  if (start.x < end.x || (start.x === end.x && start.y < end.y)) {
    return [start, end]
  }

  return [end, start]
}

/**
 * 把 A* 的原子边序列合并成水平、垂直交替的极大线段。
 * edgeToSegment 记录每条原子边由哪个线段变量控制，供共享边约束反查。
 */
function buildRouteLayout(route: RoutedConnector): RouteLayout {
  // segments 按路径行进顺序保存已经合并完成的极大线段变量。
  const segments: MaximalSegment[] = []
  // edgeToSegment 的数组下标与 route.graphPoints 的原子边下标一一对应。
  const edgeToSegment: string[] = []

  // edgeIndex 表示原子边 graphPoints[edgeIndex] → graphPoints[edgeIndex + 1]。
  for (let edgeIndex = 0; edgeIndex < route.graphPoints.length - 1; edgeIndex += 1) {
    // start 和 end 是当前原子边的两个端点。
    const start = route.graphPoints[edgeIndex]
    const end = route.graphPoints[edgeIndex + 1]
    // 两点 y 相等就是水平边，否则合法正交路径中只能是垂直边。
    const orientation: Orientation = start.y === end.y ? 'horizontal' : 'vertical'
    // coordinate 是该线段可被最终放置算法调整的一维位置：水平取 y，垂直取 x。
    const coordinate = orientation === 'horizontal' ? start.y : start.x
    // previous 是刚刚建立的上一条极大线段，用来判断能否继续合并。
    const previous = segments[segments.length - 1]

    // 方向与固定坐标都相同，说明当前原子边只是上一条极大线段的延续。
    if (previous && previous.orientation === orientation && previous.desired === coordinate) {
      previous.lastEdgeIndex = edgeIndex
      edgeToSegment[edgeIndex] = previous.id
      continue
    }

    // segment 是不能再与前一条合并时新建的极大线段变量。
    const segment: MaximalSegment = {
      id: `${route.id}:segment:${segments.length}`,
      routeId: route.id,
      orientation,
      desired: coordinate,
      value: coordinate,
      firstEdgeIndex: edgeIndex,
      lastEdgeIndex: edgeIndex,
    }
    segments.push(segment)
    edgeToSegment[edgeIndex] = segment.id
  }

  return { route, segments, edgeToSegment }
}

/**
 * 统计所有连接线使用的无向原子边，只保留使用者数量 >= 2 的边。
 * 这一步得到论文中的 shared-edge graph（这里用边集合加使用记录表示）。
 */
function buildSharedEdges(layouts: RouteLayout[]): SharedEdge[] {
  // usesByEdge 按无向边键聚合同一几何原子边上的全部连接线使用记录。
  const usesByEdge = new Map<string, SharedEdge>()

  // layout 是当前连接线的线段布局及“原子边 → 极大线段”映射。
  for (const layout of layouts) {
    // index 表示当前检查的原子边起点下标。
    for (let index = 0; index < layout.route.graphPoints.length - 1; index += 1) {
      // routeStart、routeEnd 保留连接线自身的行进方向。
      const routeStart = layout.route.graphPoints[index]
      const routeEnd = layout.route.graphPoints[index + 1]
      // key 用于把正向和反向经过同一几何边的连接线归入同一组。
      const key = segmentKey(routeStart, routeEnd)
      // start、end 按统一伪方向排列，供后续判断进入边的左右关系。
      const [start, end] = canonicalSegment(routeStart, routeEnd)
      // sharedEdge 复用已有聚合项；首次遇见这条边时创建空 uses 数组。
      const sharedEdge = usesByEdge.get(key) ?? { key, start, end, uses: [] }

      sharedEdge.uses.push({
        routeId: layout.route.id,
        edgeIndex: index,
        segmentId: layout.edgeToSegment[index],
      })
      usesByEdge.set(key, sharedEdge)
    }
  }

  return [...usesByEdge.values()].filter(
    (edge) => new Set(edge.uses.map((use) => use.routeId)).size >= 2,
  )
}

/**
 * 返回连接线进入共享边时位于伪方向的左侧、同向或右侧。
 * 负数表示左侧，0 表示同向进入，正数表示右侧。
 *
 * 具体通过二维叉积判断 previousPoint 位于伪方向向量哪一侧：
 * cross(edgeVector, entryVector) < 0 / = 0 / > 0。
 */
function entrySide(
  edge: SharedEdge,
  use: EdgeUse,
  route: RoutedConnector,
): number {
  // points 是当前连接线按实际行进方向排列的可见图节点序列。
  const points = route.graphPoints
  // routeStart 是连接线经过该共享边时的实际起点。
  const routeStart = points[use.edgeIndex]
  // followsCanonicalDirection 表示实际行进方向是否与共享边伪方向一致。
  const followsCanonicalDirection = samePoint(routeStart, edge.start)

  // 若连接线实际行进方向与伪方向相反，就从它的下一点反向观察进入关系。
  // previousPoint 是连接线进入共享边前的一个点。
  // 反向经过共享边时，数组中的“进入前点”位于该边结束下标的后方，所以取 +2。
  const previousPoint = followsCanonicalDirection
    ? points[use.edgeIndex - 1]
    : points[use.edgeIndex + 2]

  if (!previousPoint) return 0

  // edgeVector 是共享边从伪起点指向伪终点的方向向量。
  const edgeVector = {
    x: edge.end.x - edge.start.x,
    y: edge.end.y - edge.start.y,
  }
  // entryVector 从伪起点指向 previousPoint，用于判断进入位置位于伪方向哪一侧。
  const entryVector = {
    x: previousPoint.x - edge.start.x,
    y: previousPoint.y - edge.start.y,
  }
  // crossProduct 是二维叉积：符号决定左右，绝对值接近 0 表示三点共线。
  const crossProduct =
    edgeVector.x * entryVector.y - edgeVector.y * entryVector.x

  if (Math.abs(crossProduct) < 0.001) return 0
  return crossProduct < 0 ? -1 : 1
}

/**
 * 按论文的增量方式为每条共享边建立连接线顺序。
 * 新连接线优先根据进入侧插入；同方向进入时，把前一条共享边上的顺序
 * 投影到当前共享边，从而让一对连接线在整段共享路径中保持相对顺序。
 *
 * 对应论文记号：O = L ++ S ++ R。
 * - L：从新连接线左侧进入的既有线路；
 * - S：与新连接线同向进入、需要继承上一条共享边顺序的线路；
 * - R：从新连接线右侧进入的既有线路。
 */
function orderSharedEdges(
  sharedEdges: SharedEdge[],
  layouts: RouteLayout[],
): SharedEdgeOrder[] {
  // routeById 让排序时可以由已有顺序中的连接线 ID 取回完整路径。
  const routeById = new Map(layouts.map((layout) => [layout.route.id, layout.route]))
  // sharedByKey 用于由当前原子路径边快速判断它是否是一条共享边。
  const sharedByKey = new Map(sharedEdges.map((edge) => [edge.key, edge]))
  // orders 保存每条共享边上已经增量插入完成的连接线 ID 顺序。
  const orders = new Map<string, string[]>()

  // 每条共享边先从空顺序开始。
  sharedEdges.forEach((edge) => orders.set(edge.key, []))

  // 按 connectors 输入顺序逐条插入；每条边的数组就是该边最终车道顺序。
  // layout 是当前要沿路径逐边插入共享边顺序的连接线。
  for (const layout of layouts) {
    // previousOrder 保存该连接线刚经过的上一条连续共享边顺序，
    // 相当于论文中的 O'，用于向下一条共享边投影相对次序。
    let previousOrder: string[] | undefined

    // edgeIndex 是当前连接线正在检查的原子边下标。
    for (let edgeIndex = 0; edgeIndex < layout.route.graphPoints.length - 1; edgeIndex += 1) {
      // key 是当前原子边的无向坐标键。
      const key = segmentKey(
        layout.route.graphPoints[edgeIndex],
        layout.route.graphPoints[edgeIndex + 1],
      )
      // edge 只有在该原子边被至少两条不同连接线使用时才存在。
      const edge = sharedByKey.get(key)
      if (!edge) {
        // 遇到非共享边说明连续共享区段结束，不能再继承上一边的顺序。
        previousOrder = undefined
        continue
      }

      // order 是当前共享边正在构建的可变连接线顺序数组。
      const order = orders.get(key) as string[]
      if (order.includes(layout.route.id)) {
        // 同一连接线理论上只需插入一次；重复遇到时只更新可供投影的上一顺序。
        previousOrder = order
        continue
      }

      // currentUse 提供当前连接线在这条共享边中的下标及其极大线段变量。
      const currentUse = edge.uses.find((use) => use.routeId === layout.route.id)
      if (!currentUse) continue

      // side 为 -1、0、1，分别表示从伪方向左侧、同向、右侧进入。
      const side = entrySide(edge, currentUse, layout.route)

      // 先把已有线路按进入侧分组，确定新线路应位于 L、S、R 的哪个边界。
      // sides 记录已经在 order 中的每条连接线相对共享边伪方向的进入侧。
      const sides = new Map(
        order.map((routeId) => {
          // route 是已有连接线的完整 A* 路径。
          const route = routeById.get(routeId) as RoutedConnector
          // use 是已有连接线对当前共享边的使用记录。
          const use = edge.uses.find((candidate) => candidate.routeId === routeId) as EdgeUse
          return [routeId, entrySide(edge, use, route)]
        }),
      )

      // insertionIndex 默认取第一个进入侧严格大于当前 side 的位置，
      // 从而保持 L（-1）、S（0）、R（1）的分组顺序。
      let insertionIndex = order.findIndex(
        (routeId) => (sides.get(routeId) ?? 0) > side,
      )
      if (insertionIndex < 0) insertionIndex = order.length

      // 对同向进入的线路，沿用上一条共享边已经确定的相对顺序。
      if (previousOrder) {
        // previousOrder 相当于论文中的 O'。
        // 仅保留当前边仍存在的线路，再查看新线路在投影序列中的前驱/后继。
        // projected 是上一条共享边顺序在“当前边既有线路 + 当前新线路”上的投影。
        const projected = previousOrder.filter(
          (routeId) => routeId === layout.route.id || order.includes(routeId),
        )
        // connectorIndex 是当前连接线在投影序列中的位置。
        const connectorIndex = projected.indexOf(layout.route.id)
        // predecessor 是投影顺序中距离当前连接线最近、且已存在于当前边的前驱。
        const predecessor = [...projected.slice(0, connectorIndex)]
          .reverse()
          .find((routeId) => order.includes(routeId))
        // successor 是投影顺序中距离当前连接线最近、且已存在于当前边的后继。
        const successor = projected
          .slice(connectorIndex + 1)
          .find((routeId) => order.includes(routeId))

        if (predecessor) insertionIndex = order.indexOf(predecessor) + 1
        else if (successor) insertionIndex = order.indexOf(successor)
      }

      // 在计算出的车道位置插入当前连接线，不改变其他线路的相对顺序。
      order.splice(insertionIndex, 0, layout.route.id)
      // 当前边顺序将成为处理下一条连续共享边时的 O'。
      previousOrder = order
    }
  }

  return sharedEdges.map((edge) => ({
    edgeKey: edge.key,
    start: edge.start,
    end: edge.end,
    connectorIds: orders.get(edge.key) as string[],
  }))
}

/**
 * 把共享边上的离散车道顺序转换为数值约束。
 * 例如水平边顺序 [A,B,C] 会生成：
 *   yB - yA >= laneGap
 *   yC - yB >= laneGap
 */
function buildSeparationConstraints(
  sharedEdges: SharedEdge[],
  orders: SharedEdgeOrder[],
  laneGap: number,
): SeparationConstraint[] {
  // edgeByKey 用于由公开的 SharedEdgeOrder 取回边方向及 uses 映射。
  const edgeByKey = new Map(sharedEdges.map((edge) => [edge.key, edge]))
  // constraints 按 lowerId|upperId 去重，防止连续共享原子边重复产生同一约束。
  const constraints = new Map<string, SeparationConstraint>()

  // order 表示一条共享边上已经确定的连接线车道顺序。
  for (const order of orders) {
    // edge 提供该共享边的统一方向及每条连接线对应的极大线段 ID。
    const edge = edgeByKey.get(order.edgeKey) as SharedEdge
    // isHorizontal 决定顺序最终约束 y 坐标还是 x 坐标，以及是否需要反转。
    const isHorizontal = edge.start.y === edge.end.y
    // segmentByRoute 把 connector ID 映射到控制其共享原子边的极大线段变量 ID。
    const segmentByRoute = new Map(
      edge.uses.map((use) => [use.routeId, use.segmentId]),
    )

    // 只需为顺序中相邻的两条线路建立约束，传递性会保证更远线路也不重叠。
    for (let index = 1; index < order.connectorIds.length; index += 1) {
      // previousId、currentId 是相邻两条线路对应的极大线段变量 ID。
      const previousId = segmentByRoute.get(order.connectorIds[index - 1])
      const currentId = segmentByRoute.get(order.connectorIds[index])
      if (!previousId || !currentId || previousId === currentId) continue

      // 水平伪方向向东时顺序对应 y 从小到大；垂直伪方向向南时
      // “左到右”对应 x 从大到小，所以垂直约束需要反转。
      // lowerId 和 upperId 按实际数值坐标从小到大排列。
      const lowerId = isHorizontal ? previousId : currentId
      const upperId = isHorizontal ? currentId : previousId
      // key 用于合并由多条相邻共享原子边产生的同一对线段约束。
      const key = `${lowerId}|${upperId}`
      constraints.set(key, { lowerId, upperId, gap: laneGap })
    }
  }

  return [...constraints.values()]
}

/**
 * satisfy VPSC approximate projection 的小型演示实现。
 * 从所有 desired position 出发，反复投影违反的 xj - xi >= gap 约束。
 *
 * 如果两个变量当前间距不足 violation：
 * - lower 向负方向移动 violation / 2；
 * - upper 向正方向移动 violation / 2。
 *
 * 反复扫描直到没有明显违反项。由于初值就是 desired position，最终结果会在
 * 满足全部顺序和间距的同时，尽量保持在原通道中线附近。
 */
function projectSeparationConstraints(
  segments: Map<string, MaximalSegment>,
  constraints: SeparationConstraint[],
): void {
  // iteration 是全量约束扫描轮次；120 是 Demo 防止异常数据无限迭代的上限。
  for (let iteration = 0; iteration < 120; iteration += 1) {
    // largestViolation 记录本轮遇到的最大间距缺口，用于判断是否已经收敛。
    let largestViolation = 0

    // constraint 表示一个 upper.value - lower.value >= gap 不等式。
    for (const constraint of constraints) {
      // lower 和 upper 是不等式两端引用的可移动极大线段变量。
      const lower = segments.get(constraint.lowerId)
      const upper = segments.get(constraint.upperId)
      if (!lower || !upper) continue

      // violation > 0 表示当前实际间距比要求的 gap 少了多少像素。
      const violation = constraint.gap - (upper.value - lower.value)
      if (violation <= 0.001) continue

      // 两个变量权重相同，各承担一半位移，保持在通道期望中线附近。
      lower.value -= violation / 2
      upper.value += violation / 2
      largestViolation = Math.max(largestViolation, violation)
    }

    if (largestViolation <= 0.001) break
  }
}

/**
 * 使用投影后的极大线段坐标重新计算折线拐点。
 * 相邻线段一横一竖，它们的新交点可直接由“垂直线的 x + 水平线的 y”组成。
 */
function placedGraphPoints(layout: RouteLayout): Point[] {
  // graphPoints 是 A* 给出的原始可见图折线坐标。
  const { graphPoints } = layout.route
  if (graphPoints.length < 2 || layout.segments.length === 0) return graphPoints

  // firstSegment 决定起始图节点需要调整 x 还是 y。
  const firstSegment = layout.segments[0]
  // firstPoint 保留原端点沿线方向的坐标，只替换该线段允许移动的一维坐标。
  const firstPoint =
    firstSegment.orientation === 'horizontal'
      ? { x: graphPoints[0].x, y: firstSegment.value }
      : { x: firstSegment.value, y: graphPoints[0].y }
  // result 按路径顺序收集移动后各极大线段的交点。
  const result: Point[] = [firstPoint]

  // index 指向当前极大线段；它与 previous 的交点形成一个新折点。
  for (let index = 1; index < layout.segments.length; index += 1) {
    // previous 和 current 必然一横一竖，因为同向连续边已在前面被合并。
    const previous = layout.segments[index - 1]
    const current = layout.segments[index]

    result.push(
      previous.orientation === 'horizontal'
        ? { x: current.value, y: previous.value }
        : { x: previous.value, y: current.value },
    )
  }

  // lastSegment 决定终止图节点需要调整 x 还是 y。
  const lastSegment = layout.segments[layout.segments.length - 1]
  // rawLastPoint 提供末端沿线方向上必须保留的原坐标。
  const rawLastPoint = graphPoints[graphPoints.length - 1]
  result.push(
    lastSegment.orientation === 'horizontal'
      ? { x: rawLastPoint.x, y: lastSegment.value }
      : { x: lastSegment.value, y: rawLastPoint.y },
  )

  return simplifyOrthogonalPoints(result)
}

export function nudgeSharedRoutes(
  routes: RoutedConnector[],
  laneGap: number,
): {
  finalRoutes: FinalConnector[]
  sharedEdges: SharedEdgeOrder[]
  constraintCount: number
} {
  // 1. 把每条 A* 路径整理成可移动的极大线段变量。
  const layouts = routes.map(buildRouteLayout)

  // 2. 找出共享原子边，并为每条共享边确定一致的连接线顺序。
  const shared = buildSharedEdges(layouts)
  const orders = orderSharedEdges(shared, layouts)

  // 3. 把相对顺序转成一维最小间距不等式。
  const constraints = buildSeparationConstraints(shared, orders, laneGap)
  // segments 汇总所有连接线的极大线段变量，供约束通过 ID 跨路线访问和移动。
  const segments = new Map(
    layouts.flatMap((layout) => layout.segments.map((segment) => [segment.id, segment] as const)),
  )

  // 4. 从原始期望坐标出发，投影到满足全部分离约束的最近可行位置。
  projectSeparationConstraints(segments, constraints)

  // 5. 根据求得的线段坐标重建每条最终可绘制折线。
  const finalRoutes = layouts.map((layout): FinalConnector => {
    // shifted 是只包含安全区 routing point 之间、完成错位后的图内折线。
    const shifted = placedGraphPoints(layout)

    // 端点固定；若首尾共享线段被错开，在 routing point 处增加很短的正交扇出。
    // finalPoints 补回固定的真实端口和安全区短引线，再清除多余共线点。
    const finalPoints = simplifyOrthogonalPoints([
      layout.route.sourcePoint,
      layout.route.sourceRoutingPoint,
      ...shifted,
      layout.route.targetRoutingPoint,
      layout.route.targetPoint,
    ])

    return { ...layout.route, finalPoints }
  })

  return {
    finalRoutes,
    sharedEdges: orders,
    constraintCount: constraints.length,
  }
}
