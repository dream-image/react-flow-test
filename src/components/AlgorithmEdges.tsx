import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react'
import type {
  Point,
  SharedEdgeOrder,
  VisibilityGraph,
} from '../algorithm'

/** 把二维坐标转成稳定字符串，供 SVG 子元素 key 使用。 */
function pointKey(point: Point): string {
  return `${point.x},${point.y}`
}

/**
 * 把按顺序排列的正交折线点转换成 SVG path 的 d 属性。
 * 第一个点使用 M 移动画笔，其余点使用 L 依次连线。
 */
function pointsToSvgPath(points: Point[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ')
}

export type RouteEdgeData = {
  /** 最终传给 SVG 的有序折线点。 */
  points: Point[]
  /** 路线本身的描边颜色。 */
  color: string
  /** 当前算法阶段下的整体路径透明度。 */
  opacity: number
  /** true 时用虚线表示这仍是共享边排序阶段的逻辑路径。 */
  dashed?: boolean
}

/** React Flow 中承载一条正交连接线绘制数据的自定义边类型。 */
export type RouteFlowEdge = Edge<RouteEdgeData, 'orthogonal-route'>

/** 使用算法给出的完整 points 绘制正交 SVG 路径，不采用 React Flow 默认贝塞尔线。 */
export function OrthogonalRouteEdge({
  id,
  data,
  markerEnd,
}: EdgeProps<RouteFlowEdge>) {
  if (!data) return null

  return (
    <BaseEdge
      id={id}
      path={pointsToSvgPath(data.points)}
      markerEnd={markerEnd}
      interactionWidth={18}
      style={{
        stroke: data.color,
        strokeWidth: 3,
        strokeOpacity: data.opacity,
        strokeDasharray: data.dashed ? '7 6' : undefined,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      }}
    />
  )
}

export type VisibilityEdgeData = {
  /** 正交可见性图的全部节点、边和索引。 */
  graph: VisibilityGraph
  /** A* 搜索中实际从 open list 弹出并扩展过的图节点 ID。 */
  visitedNodeIds: Set<string>
  /** 是否用不同样式高亮 visitedNodeIds。 */
  showVisited: boolean
  /** 整个可见图覆盖层的透明度。 */
  opacity: number
}

/** React Flow 中承载整张可见图覆盖层的自定义边类型。 */
export type VisibilityFlowEdge = Edge<VisibilityEdgeData, 'visibility-graph'>

export function VisibilityGraphEdge({ data }: EdgeProps<VisibilityFlowEdge>) {
  if (!data) return null

  // edgePath 把所有可见边拼到一个 SVG path 中，减少大量独立 path DOM 节点。
  const edgePath = data.graph.edges
    .map((edge) => {
      // source 和 target 是由边端点 ID 反查得到的实际坐标。
      const source = data.graph.nodeById.get(edge.source)?.point
      const target = data.graph.nodeById.get(edge.target)?.point
      return source && target ? pointsToSvgPath([source, target]) : ''
    })
    .join(' ')

  return (
    <g className="visibility-overlay" opacity={data.opacity}>
      <path d={edgePath} className="visibility-overlay__edge" />
      {data.graph.nodes.map((node) => {
        // visited 只在搜索阶段且节点确实被 A* 扩展过时为 true。
        const visited = data.showVisited && data.visitedNodeIds.has(node.id)
        return (
          <circle
            key={node.id}
            cx={node.point.x}
            cy={node.point.y}
            r={visited ? 3.2 : 2.1}
            className={
              visited
                ? 'visibility-overlay__node is-visited'
                : 'visibility-overlay__node'
            }
          />
        )
      })}
    </g>
  )
}

export type SharedEdgeData = {
  /** 每条共享边的坐标及其连接线相对顺序。 */
  orders: SharedEdgeOrder[]
  /** connector ID → 路线颜色，用于给顺序标签中的字母分别着色。 */
  connectorColors: Record<string, string>
}

/** React Flow 中承载所有共享边顺序标记的覆盖层类型。 */
export type SharedFlowEdge = Edge<SharedEdgeData, 'shared-edges'>

export function SharedEdgesOverlay({ data }: EdgeProps<SharedFlowEdge>) {
  if (!data) return null

  return (
    <g className="shared-overlay">
      {data.orders.map((order) => {
        // center 是共享边几何中点，用作顺序标签背景和文字的定位坐标。
        const center = {
          x: (order.start.x + order.end.x) / 2,
          y: (order.start.y + order.end.y) / 2,
        }

        return (
          <g key={order.edgeKey}>
            <path
              d={pointsToSvgPath([order.start, order.end])}
              className="shared-overlay__edge"
            />
            <g transform={`translate(${center.x} ${center.y})`}>
              <rect
                x={-10 - order.connectorIds.length * 9}
                y={-12}
                width={20 + order.connectorIds.length * 18}
                height={24}
                rx={8}
                className="shared-overlay__label-bg"
              />
              <text textAnchor="middle" dy="0.35em" className="shared-overlay__label">
                {order.connectorIds.map((connectorId, index) => (
                  // connectorId 是当前车道中的线路 ID；index 决定是否添加分隔点。
                  <tspan
                    key={`${pointKey(center)}-${connectorId}`}
                    fill={data.connectorColors[connectorId]}
                  >
                    {index > 0 ? ' · ' : ''}
                    {connectorId}
                  </tspan>
                ))}
              </text>
            </g>
          </g>
        )
      })}
    </g>
  )
}
