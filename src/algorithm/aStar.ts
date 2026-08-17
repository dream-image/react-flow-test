import {
  directionBetween,
  directionsTo,
  leftDirection,
  manhattanDistance,
  pointKey,
  reverseDirection,
  rightDirection,
} from './geometry'
import { MinHeap } from './priorityQueue'
import type {
  AStarResult,
  Direction,
  Point,
  VisibilityGraph,
} from './types'

type SearchState = {
  /** `${nodeId}|${direction}`，同一节点从不同方向进入是不同状态。 */
  key: string
  /** 当前状态所在的 VisibilityNode.id。 */
  nodeId: string
  /** 从父节点移动到当前节点时的行进方向。 */
  direction: Direction
  /** G 的长度部分：起点到当前节点已经真实走过的距离。 */
  length: number
  /** G 的折弯部分：起点到当前节点已经发生的方向变化次数。 */
  bends: number
  /** 已发生的真实代价 G = length + bendPenalty * bends。 */
  cost: number
  /** 优先队列排序值 F = G + 剩余长度下界 + 剩余折弯下界。 */
  priority: number
  /** 指向上一个 (v,D) 状态，终点确定后沿它反向重建路径。 */
  parentKey?: string
  /** 惩罚值相同时用于稳定地打破平局。 */
  timestamp: number
}

/**
 * 生成方向感知状态的唯一键。
 *
 * @param nodeId 可见性图节点 ID，例如 "204,308"。
 * @param direction 连接线进入该节点时的方向，例如 E。
 * @returns 例如 "204,308|E"；这样同一坐标的 N/S/E/W 会成为四个独立状态。
 */
function stateKey(nodeId: string, direction: Direction): string {
  return `${nodeId}|${direction}`
}

/**
 * 论文图 2(a) 中的剩余折弯数下界。
 * 它忽略障碍物，只根据当前方向、终点方向和相对位置给出乐观估计，
 * 因此不会高估真实代价，A* 仍能保证最优性。
 *
 * 返回值 0~4 的含义不是“实际还会转几次”，而是“无论怎样走至少要转几次”：
 * - 0：终点就在当前方向的直线上；
 * - 1：转一次即可同时满足位置与终点进入方向；
 * - 2~4：当前方向与目标方位越来越不利，需要更多方向调整。
 *
 * @param current 当前候选节点坐标 v'。
 * @param currentDirection 到达 v' 时的进入方向 D'。
 * @param destination 目标 routing point 的坐标 d。
 * @param destinationDirection 连接线进入目标端口时必须保持的方向 Dd。
 */
function minimumRemainingBends(
  current: Point,
  currentDirection: Direction,
  destination: Point,
  destinationDirection: Direction,
): number {
  // directions 对应论文 dirns(v', d)，描述目标位于当前点哪些象限方向。
  // 例如目标位于右上方时为 {N,E}，正右方时只有 {E}。
  const directions = directionsTo(current, destination)

  // 只有目标位于当前行进方向的同一直线上且在前方，才能不转弯直接到达。
  const destinationIsStraightAhead =
    directions.size === 1 && directions.has(currentDirection)

  // 判断当前位置是否恰好落在“按目标要求方向进入”的反向延长线上。
  // 例如目标要求向东进入，目标位于当前位置正东方时为 true。
  const destinationIsOnEntryRay =
    directions.size === 1 && directions.has(destinationDirection)

  // 当前方向与目标要求的进入方向相差 90 度，而不是同向或反向。
  const isPerpendicular =
    leftDirection(destinationDirection) === currentDirection ||
    rightDirection(destinationDirection) === currentDirection

  // current 与 destination 已经是同一个坐标，不再估计位置移动产生的折弯。
  if (directions.size === 0) return 0

  // 当前方向就是终点要求的进入方向，并且终点正好位于前方射线上。
  if (currentDirection === destinationDirection && destinationIsStraightAhead) {
    return 0
  }

  // 当前方向与目标进入方向垂直，而且先直行再转一次就能对准目标。
  if (isPerpendicular && directions.has(currentDirection)) return 1

  if (
    (currentDirection === destinationDirection &&
      directions.has(currentDirection) &&
      !destinationIsStraightAhead) ||
    (currentDirection === reverseDirection(destinationDirection) &&
      !destinationIsOnEntryRay)
  ) {
    // 典型情况是需要组成一个 L/Z 形调整，乐观估计至少再转两次。
    return 2
  }

  // 当前方向与目标方向垂直，但目标不在当前方向的前方，需要额外绕回。
  if (isPerpendicular && !directions.has(currentDirection)) return 3

  if (
    (currentDirection === reverseDirection(destinationDirection) &&
      destinationIsOnEntryRay) ||
    (currentDirection === destinationDirection &&
      !directions.has(currentDirection))
  ) {
    // 当前方向与目标进入条件最不利，必须先绕开、反向，再重新对准目标。
    return 4
  }

  // 未落入论文五类图形时返回更保守的下界，宁可低估也不能高估。
  return 0
}

function reconstructPath(
  destinationState: SearchState,
  records: Map<string, SearchState>,
  graph: VisibilityGraph,
): Point[] {
  // points 按“终点 -> 起点”的顺序暂存回溯得到的坐标。
  const points: Point[] = []

  // current 是当前正在回溯的状态，初始值为已经确定最优的终点状态。
  let current: SearchState | undefined = destinationState

  // 搜索阶段只保存 parentKey，不在每个队列条目中复制整条路径，避免大量内存开销。
  while (current) {
    // SearchState 只保存 nodeId，实际坐标需要回到可见性图中读取。
    const node = graph.nodeById.get(current.nodeId)
    if (node) points.push(node.point)

    // 沿 parentKey 回到产生当前状态的上一个状态；起点没有 parentKey，循环结束。
    current = current.parentKey ? records.get(current.parentKey) : undefined
  }

  // 回溯顺序是终点到起点，绘制和后续处理需要起点到终点，因此反转。
  return points.reverse()
}

/**
 * 在正交可见性图上执行论文的方向感知 A*。
 * 搜索状态是 (v, D)，因为到达同一节点时的进入方向会影响下一步折弯数。
 *
 * 代价函数：
 *   G = 已走长度 + bendPenalty × 已有折弯
 *   H = 曼哈顿距离 + bendPenalty × 最少剩余折弯
 *   F = G + H
 *
 * H 从不高估，因此目标状态从 open list 堆顶弹出时，得到的路径是最优路径。
 *
 * @param graph 已完成避障过滤的正交可见性图。
 * @param source A* 起点，即 sourceRoutingPoint。
 * @param sourceDirection 从源对象离开时的方向。
 * @param destination A* 终点，即 targetRoutingPoint。
 * @param destinationDirection 到达目标时要求的行进方向。
 * @param bendPenalty 每发生一次折弯增加的惩罚值。
 * @returns 找到时返回路径及统计数据；不可达时返回 null。
 */
export function findOrthogonalRoute(
  graph: VisibilityGraph,
  source: Point,
  sourceDirection: Direction,
  destination: Point,
  destinationDirection: Direction,
  bendPenalty: number,
): AStarResult | null {
  // sourceId 把起点坐标转换成 visibilityGraph.nodeById 使用的字符串键。
  const sourceId = pointKey(source)

  // destinationId 用于在弹出状态时快速判断是否已经到达目标坐标。
  const destinationId = pointKey(destination)

  if (!graph.nodeById.has(sourceId) || !graph.nodeById.has(destinationId)) {
    // 起点或终点没有进入可见性图，说明构图输入不完整，不能开始搜索。
    return null
  }

  // 每生成一个状态就递增，用来稳定处理 F 完全相同的候选状态。
  let timestamp = 0

  // open 是 A* 的开放列表；MinHeap 保证 F 最小的 SearchState 位于堆顶。
  const open = new MinHeap<SearchState>((left, right) => {
    // left/right 是最小堆正在比较的两个候选状态。
    // priority 越小，说明该状态预计形成的完整路径越优。
    const costDifference = left.priority - right.priority
    if (Math.abs(costDifference) > 0.001) return costDifference

    // 论文使用时间戳打破平局：后加入的同代价状态优先。
    return right.timestamp - left.timestamp
  })

  // closed：已经以最小代价从堆顶弹出并完成扩展的状态 key。
  // 一个 key 进入 closed 后不会再次扩展。
  const closed = new Set<string>()

  // records：每个状态 key 当前最优的完整 SearchState。
  // 主要保存 parentKey，供终点确定后 reconstructPath() 回溯。
  const records = new Map<string, SearchState>()

  // bestOpenCost：状态 key -> 当前已知最低 G。
  // 新路径到达同一 (nodeId,direction) 时，只有 G 更低才允许替换旧版本。
  const bestOpenCost = new Map<string, number>()

  // visitedNodeIds 只用于 Demo 高亮；算法判重实际使用的是带方向的 closed。
  const visitedNodeIds = new Set<string>()

  // 起点状态不仅包含 sourceId，还包含从源对象向外离开的 sourceDirection。
  const startKey = stateKey(sourceId, sourceDirection)

  // 起点尚未走过任何边，所以 G=0；初始优先级完全由 H 构成。
  const startHeuristic =
    // 起点到终点不考虑障碍物时的最短正交距离下界。
    manhattanDistance(source, destination) +
    // 至少还需的折弯数乘以单次折弯惩罚，构成 H 的折弯部分。
    bendPenalty *
      minimumRemainingBends(
        source,
        sourceDirection,
        destination,
        destinationDirection,
      )

  // 起点条目：length/bends/cost 都是 0，priority 只有启发式 H。
  const startState: SearchState = {
    key: startKey,
    nodeId: sourceId,
    direction: sourceDirection,
    length: 0,
    bends: 0,
    cost: 0,
    priority: startHeuristic,
    timestamp: timestamp++,
  }

  // 把起点同时登记到 open、records 和 bestOpenCost，正式开始搜索。
  open.push(startState)
  records.set(startKey, startState)
  bestOpenCost.set(startKey, 0)

  while (open.size > 0) {
    // 最小堆让每次 pop 都得到当前 F 最小的候选状态。
    const current = open.pop() as SearchState

    // 更新同一状态时采用“懒删除”：新版本入堆，旧版本仍暂留堆中。
    // 旧版本以后被弹出时会在这里被识别并跳过，避免在堆中间执行昂贵删除。
    if (current.cost !== bestOpenCost.get(current.key) || closed.has(current.key)) {
      continue
    }

    closed.add(current.key)

    // visitedNodeIds 不区分进入方向，同一节点最多显示一次高亮。
    visitedNodeIds.add(current.nodeId)

    // 必须等终点成为 open list 的最小值并被弹出，才能确认路径最优。
    // “终点第一次入队”不能结束，因为队列里可能还有 F 更低的候选路径。
    if (
      current.nodeId === destinationId &&
      current.direction === destinationDirection
    ) {
      return {
        points: reconstructPath(current, records, graph),
        length: current.length,
        bends: current.bends,
        expandedStates: closed.size,
        visitedNodeIds,
      }
    }

    // currentNode 是当前状态对应的可见图节点，包含实际二维坐标。
    const currentNode = graph.nodeById.get(current.nodeId)
    if (!currentNode) continue

    // adjacency 中保存当前节点所有无遮挡的最近 N/S/E/W 邻边。
    for (const edge of graph.adjacency.get(current.nodeId) ?? []) {
      // 可见图边是无向边，需要根据当前所在端点找出另一端的 ID。
      const neighbourId =
        edge.source === current.nodeId ? edge.target : edge.source

      // neighbour 是沿 edge 可以到达的相邻可见图节点。
      const neighbour = graph.nodeById.get(neighbourId)
      if (!neighbour) continue

      // moveDirection 是从 currentNode 沿当前边前往 neighbour 的实际方向。
      const moveDirection = directionBetween(currentNode.point, neighbour.point)

      // 从当前进入方向出发，只生成论文中的三类后继：直行、左转、右转。
      // 原地掉头会重复刚走过的边，不可能改善长度或折弯代价。
      if (moveDirection === reverseDirection(current.direction)) continue

      // nextKey 表示“从 moveDirection 进入 neighbour”这一新搜索状态。
      const nextKey = stateKey(neighbourId, moveDirection)

      // 完成扩展的同状态已经拥有确定的最低代价，不再重复加入 open list。
      if (closed.has(nextKey)) continue

      // 继续沿 current.direction 行走不增加折弯；方向改变 90 度增加一次。
      const extraBend = moveDirection === current.direction ? 0 : 1

      // nextLength 是起点到 neighbour 已经走过的真实累计长度。
      const nextLength = current.length + edge.length

      // nextBends 是起点到 neighbour 已经产生的真实累计折弯数。
      const nextBends = current.bends + extraBend

      // 这是候选状态已经真实发生的 G，不包含任何启发式估计。
      const nextCost = nextLength + bendPenalty * nextBends

      // open list 中同一个 (v,D) 只保留 G 更低的版本。
      if (nextCost >= (bestOpenCost.get(nextKey) ?? Number.POSITIVE_INFINITY)) {
        continue
      }

      // remainingLength 是 H 的长度部分，只看坐标差，不考虑障碍物，因此不会高估。
      const remainingLength = manhattanDistance(neighbour.point, destination)

      // remainingBends 是 H 的折弯部分，根据论文图 2(a) 估计至少还需几次转弯。
      const remainingBends = minimumRemainingBends(
        neighbour.point,
        moveDirection,
        destination,
        destinationDirection,
      )
      // nextState 是准备放入 open list 的完整候选条目。
      const nextState: SearchState = {
        key: nextKey,
        nodeId: neighbourId,
        direction: moveDirection,
        length: nextLength,
        bends: nextBends,
        cost: nextCost,
        // F = G + H。曼哈顿距离和剩余折弯估计共同把明显绕远的状态排到后面。
        priority:
          nextCost + remainingLength + bendPenalty * remainingBends,
        parentKey: current.key,
        timestamp: timestamp++,
      }

      // 三个结构必须同步更新：父指针、当前最低 G、优先队列候选条目。
      records.set(nextKey, nextState)
      bestOpenCost.set(nextKey, nextCost)
      open.push(nextState)
    }
  }

  // open list 已空仍未弹出满足目标方向的终点，说明当前可见图中不存在合法路径。
  return null
}
