import {
  manhattanDistance,
  pointInsideRectangle,
  pointKey,
  rectangleCorners,
  segmentIsClear,
  segmentKey,
} from './geometry'
import type {
  Point,
  Rectangle,
  VisibilityEdge,
  VisibilityGraph,
  VisibilityNode,
} from './types'

/**
 * 删除重复坐标并按从小到大排序。
 * 排序后的坐标可直接用于逐行、逐列建立最近邻边。
 *
 * @param values 可能含有重复项的 x 坐标或 y 坐标数组。
 * @returns 去重并升序排列后的新数组，不修改原数组。
 */
function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right)
}

/**
 * 按 pointKey() 生成的“x,y”坐标键删除重复点。
 *
 * @param points 可能有多个对象角点落在同一坐标上的点数组。
 * @returns 每个坐标只保留一个 Point 的新数组。
 */
function uniquePoints(points: Point[]): Point[] {
  return [...new Map(points.map((point) => [pointKey(point), point])).values()]
}

/**
 * 构造论文中的 orthogonal visibility graph（正交可见性图）。
 *
 * 论文可用扫描线在 O(n²) 时间内完成构图。Demo 为了让定义更直观，
 * 直接枚举 XI × YI，再按水平/垂直可见性筛选节点；得到的图与搜索语义一致，
 * 只是没有实现论文中用于大规模图的扫描线加速。
 *
 * 输入：
 * - obstacles：已经加入 clearance 的外接矩形；
 * - terminals：所有连接线的起止 routing point；
 * - canvasCorners：允许路径从图的最外侧绕行的画布角点。
 *
 * 输出：
 * - V：水平关键线与垂直关键线的有效交点；
 * - E：每个节点到 N/S/E/W 最近可见邻居的边。
 */
export function buildOrthogonalVisibilityGraph(
  obstacles: Rectangle[],
  terminals: Point[],
  canvasCorners: Point[],
): VisibilityGraph {
  // I = 所有对象角点、连接端点和画布角点组成的 interesting point 集合。
  const interestingPoints = uniquePoints([
    ...obstacles.flatMap(rectangleCorners),
    ...terminals,
    ...canvasCorners,
  ])

  // XI 和 YI 是 I 中出现过的所有横、纵坐标。
  // 正交路由只需考虑这些关键坐标的笛卡尔积，不必在连续平面上搜索。
  const xCoordinates = uniqueNumbers(interestingPoints.map((point) => point.x))
  const yCoordinates = uniqueNumbers(interestingPoints.map((point) => point.y))
  // interestingKeys 用于 O(1) 判断候选坐标本身是否就是关键点。
  // 关键点可以把自己作为水平/垂直可见性的 witness（见证点）。
  const interestingKeys = new Set(interestingPoints.map(pointKey))

  // candidates 保存通过“水平可见 + 垂直可见 + 不在障碍物内”筛选的合法节点坐标。
  const candidates: Point[] = []

  // 枚举 XI × YI。理论上最多产生 O(n²) 个候选节点。
  // x 表示当前候选点采用的关键横坐标。
  for (const x of xCoordinates) {
    // y 表示当前候选点采用的关键纵坐标。
    for (const y of yCoordinates) {
      // candidate 是笛卡尔积中的当前候选点 (x, y)。
      const candidate = { x, y }
      if (obstacles.some((rectangle) => pointInsideRectangle(candidate, rectangle))) {
        // 候选点一旦位于障碍物内部，就不可能成为合法路由节点。
        continue
      }

      // 对应论文定义：候选点必须能沿水平方向看到一个 interesting point，
      // 同时能沿垂直方向看到一个 interesting point，中间均不能有对象阻挡。
      // hasHorizontalWitness 表示至少存在一个关键点与 candidate 同一水平线，
      // 且从 candidate 到该关键点之间没有障碍物。
      const hasHorizontalWitness = interestingPoints.some(
        (point) =>
          // point 是当前检查的关键点；先要求它与 candidate 的 y 坐标相同。
          Math.abs(point.y - y) < 0.001 &&
          // 如果 candidate 本身就是关键点，距离为 0，可直接满足；
          // 否则必须验证两点之间的水平线段没有穿过障碍物。
          (interestingKeys.has(pointKey(candidate)) ||
            segmentIsClear(candidate, point, obstacles)),
      )
      // hasVerticalWitness 与上面完全对偶：要求同一垂直线且中间无遮挡。
      const hasVerticalWitness = interestingPoints.some(
        (point) =>
          // point 是当前检查的关键点；先要求它与 candidate 的 x 坐标相同。
          Math.abs(point.x - x) < 0.001 &&
          // candidate 自身是关键点时直接成立，否则检查垂直线段可见性。
          (interestingKeys.has(pointKey(candidate)) ||
            segmentIsClear(candidate, point, obstacles)),
      )

      // 同时有水平见证和垂直见证，candidate 才是两类关键线的有效交点。
      if (hasHorizontalWitness && hasVerticalWitness) candidates.push(candidate)
    }
  }

  // nodes 把几何坐标转换为可由 A* 引用的图节点；坐标键同时作为稳定节点 ID。
  const nodes: VisibilityNode[] = candidates.map((point) => ({
    id: pointKey(point),
    point,
  }))
  // nodeById 让 A* 能由 VisibilityEdge 中保存的端点 ID 快速取回节点坐标。
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  // edges 收集构图过程中发现的全部无向正交可见边。
  const edges: VisibilityEdge[] = []
  // edgeKeys 记录已加入的无向边键，防止水平/垂直扫描或重合坐标重复加边。
  const edgeKeys = new Set<string>()

  // lineNodes 已经位于同一行或同一列并按坐标排序。
  // 只检查数组中的相邻节点，就能得到每个点四个方向的最近邻。
  const addVisibleNeighbours = (lineNodes: VisibilityNode[]) => {
    // index 指向当前节点；index - 1 就是排序后与它相邻的前一个节点。
    for (let index = 1; index < lineNodes.length; index += 1) {
      // source 和 target 是同一行或同一列中相邻的两个候选图节点。
      const source = lineNodes[index - 1]
      const target = lineNodes[index]

      // 两个候选点之间仍可能被矩形截断；被阻挡时不能建立可见边。
      if (!segmentIsClear(source.point, target.point, obstacles)) continue

      // 水平扫描和垂直扫描可能遇到相同边，统一通过无向 segmentKey 去重。
      // key 不区分 source → target 与 target → source，因此适合表示无向边。
      const key = segmentKey(source.point, target.point)
      if (edgeKeys.has(key)) continue
      edgeKeys.add(key)

      edges.push({
        id: key,
        source: source.id,
        target: target.id,
        length: manhattanDistance(source.point, target.point),
      })
    }
  }

  // 同一行只连接最近的东西邻居。
  // y 是当前处理的关键水平线坐标。
  for (const y of yCoordinates) {
    addVisibleNeighbours(
      nodes
        // 只留下位于该水平线上的图节点。
        .filter((node) => Math.abs(node.point.y - y) < 0.001)
        // 从左到右排序后，相邻数组项就是东西方向最近邻候选。
        .sort((left, right) => left.point.x - right.point.x),
    )
  }

  // 同一列只连接最近的南北邻居。
  // x 是当前处理的关键垂直线坐标。
  for (const x of xCoordinates) {
    addVisibleNeighbours(
      nodes
        // 只留下位于该垂直线上的图节点。
        .filter((node) => Math.abs(node.point.x - x) < 0.001)
        // 从上到下排序后，相邻数组项就是南北方向最近邻候选。
        .sort((left, right) => left.point.y - right.point.y),
    )
  }

  // adjacency 是 A* 实际遍历的邻接表：节点 ID → 与该节点相连的边。
  const adjacency = new Map<string, VisibilityEdge[]>()
  // 先为每个节点建立空数组，孤立节点也会在邻接表中拥有条目。
  nodes.forEach((node) => adjacency.set(node.id, []))

  edges.forEach((edge) => {
    // 可见图是无向图，同一条边要同时放入两个端点的邻接表。
    adjacency.get(edge.source)?.push(edge)
    adjacency.get(edge.target)?.push(edge)
  })

  return { nodes, nodeById, edges, adjacency }
}
