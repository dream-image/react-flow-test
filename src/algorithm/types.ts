/** 连接线允许行进的四个基本方向。 */
export type Direction = 'N' | 'S' | 'E' | 'W'

/** React Flow 画布坐标系中的二维点，x 向右、y 向下。 */
export type Point = {
  /** 点到画布左边缘的水平距离。 */
  x: number
  /** 点到画布上边缘的垂直距离。 */
  y: number
}

/**
 * 路由器眼中的障碍物。
 * 算法不关心节点的 React 组件外形，只使用它的轴对齐外接矩形。
 */
export type Rectangle = {
  /** 与 React Flow node.id 对应的障碍物唯一标识。 */
  id: string
  /** 外接矩形左上角的 x 坐标，不是矩形中心坐标。 */
  x: number
  /** 外接矩形左上角的 y 坐标，不是矩形中心坐标。 */
  y: number
  /** 外接矩形从左边到右边的水平尺寸。 */
  width: number
  /** 外接矩形从上边到下边的垂直尺寸。 */
  height: number
}

/**
 * 一个连接端口。
 * side 同时限定端口位于矩形哪一侧，以及连接线离开该端口时的初始方向。
 * offset 表示端口相对该侧中点的偏移量。
 */
export type Port = {
  /** 连接点所属 Rectangle.id。当前 Demo 只支持依附于矩形的端口。 */
  nodeId: string
  /** 端口位于矩形哪一侧：N/S/E/W。 */
  side: Direction
  /** 相对该侧中点的偏移；水平边沿 x 偏移，垂直边沿 y 偏移。 */
  offset?: number
}

/** 一条待路由连接线的业务输入，不包含任何算法计算结果。 */
export type Connector = {
  /** 连接线唯一标识，同时用于共享边排序。 */
  id: string
  /** Demo 中显示的业务名称，不参与路径代价计算。 */
  label: string
  /** 连接线从哪个对象的哪个端口离开。 */
  source: Port
  /** 连接线最终进入哪个对象的哪个端口。 */
  target: Port
  /** SVG 绘制颜色，不参与算法计算。 */
  color: string
}

/** 正交可见性图中的节点，对应一个可以安全转弯或继续直行的坐标。 */
export type VisibilityNode = {
  /** 由 pointKey(point) 生成的坐标字符串，例如 "204,308"。 */
  id: string
  /** 可见图节点在画布上的实际坐标。 */
  point: Point
}

/** 正交可见性图中的边，只可能是水平线段或垂直线段。 */
export type VisibilityEdge = {
  /** 由两个端点坐标生成的无向 segmentKey。 */
  id: string
  /** 第一个端点的 VisibilityNode.id。 */
  source: string
  /** 第二个端点的 VisibilityNode.id。 */
  target: string
  /** 两个正交对齐端点之间的曼哈顿距离。 */
  length: number
}

/**
 * A* 实际搜索的图。
 * nodeById 用于按坐标快速取节点，adjacency 用于 O(1) 获取一个节点的邻边。
 */
export type VisibilityGraph = {
  /** 图中全部可见节点，便于遍历和 Demo 绘制。 */
  nodes: VisibilityNode[]
  /** VisibilityNode.id -> 节点对象，用于 A* 按 ID 取坐标。 */
  nodeById: Map<string, VisibilityNode>
  /** 图中全部无向可见边。 */
  edges: VisibilityEdge[]
  /** 节点 ID -> 与该节点相连的所有边。 */
  adjacency: Map<string, VisibilityEdge[]>
}

/** 单条连接线完成 A* 搜索后的结果。 */
export type AStarResult = {
  /** 从 source routing point 到 target routing point 的可见图节点序列。 */
  points: Point[]
  /** 只统计可见图路径的长度，不包含端口到 routing point 的短引线。 */
  length: number
  /** graphPoints 合并共线段后的方向变化次数。 */
  bends: number
  /** 从 open list 中真正弹出并扩展的 (节点, 进入方向) 状态数。 */
  expandedStates: number
  /** 供 Demo 在第二阶段高亮 A* 实际访问过的可见图节点。 */
  visitedNodeIds: Set<string>
}

/**
 * 一条已经完成 A* 的逻辑路径。
 * graphPoints 保留可见图原始节点，rawPoints 则加入真实端口并合并共线点。
 */
export type RoutedConnector = Connector & {
  /** 源矩形真实边界上的连接点。 */
  sourcePoint: Point
  /** sourcePoint 向外移动 clearance 后的 A* 起点。 */
  sourceRoutingPoint: Point
  /** targetPoint 向外移动 clearance 后的 A* 终点。 */
  targetRoutingPoint: Point
  /** 目标矩形真实边界上的连接点。 */
  targetPoint: Point
  /** A* 返回的完整可见图节点序列，保留原子边以检测共享边。 */
  graphPoints: Point[]
  /** 加入真实端点并合并共线节点后的逻辑路径。 */
  rawPoints: Point[]
  /** rawPoints 的几何总长度。 */
  length: number
  /** rawPoints 的折弯数量。 */
  bends: number
  /** A* 为这条连接线实际扩展的方向状态数量。 */
  expandedStates: number
}

/** 某条共享可见图边上的连接线排列顺序。 */
export type SharedEdgeOrder = {
  /** 共享原子边的无向 segmentKey。 */
  edgeKey: string
  /** 按统一伪方向规范化后的边起点。 */
  start: Point
  /** 按统一伪方向规范化后的边终点。 */
  end: Point
  /** 该共享边横截面上从左到右的 Connector.id 顺序。 */
  connectorIds: string[]
}

/** 完成共享边错开和坐标投影后，可直接交给 SVG 绘制的连接线。 */
export type FinalConnector = RoutedConnector & {
  /** 经过共享边错开和约束投影后，可以直接绘制的最终点序列。 */
  finalPoints: Point[]
}

/** 三个会影响路由结果的公开参数。 */
export type RoutingOptions = {
  /** 路径与对象外接矩形之间预留的安全距离。 */
  clearance: number
  /** 一次折弯折算成多少长度代价，p(R)=length+bendPenalty*bends。 */
  bendPenalty: number
  /** 多条连接线共用一条边时，最终车道之间的最小距离。 */
  laneGap: number
}

/** OrthogonalRouter.route() 的完整输出。 */
export type RoutingResult = {
  /** 第一阶段的正交可见性图。 */
  graph: VisibilityGraph
  /** 第二阶段的 A* 逻辑路径。 */
  routes: RoutedConnector[]
  /** 第三阶段完成错开后的精确路径。 */
  finalRoutes: FinalConnector[]
  /** 每条共享可见图边及其连接线车道顺序。 */
  sharedEdges: SharedEdgeOrder[]
  /** 最终放置阶段实际生成的去重分离约束数量。 */
  separationConstraintCount: number
  /** 在当前可见性图中没有找到合法路径的 Connector.id。 */
  failedConnectorIds: string[]
  /** 所有连接线 A* 访问节点的并集，只供 Demo 高亮。 */
  visitedNodeIds: Set<string>
}
