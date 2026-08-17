import { useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  useNodesState,
  type Edge,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react'
import {
  OrthogonalRouter,
  type Rectangle,
  type RoutingOptions,
} from './algorithm'
import {
  OrthogonalRouteEdge,
  SharedEdgesOverlay,
  VisibilityGraphEdge,
  type RouteFlowEdge,
  type SharedFlowEdge,
  type VisibilityFlowEdge,
} from './components/AlgorithmEdges'
import { DiagramNode } from './components/DiagramNode'
import {
  CONNECTORS,
  INITIAL_NODES,
  type DiagramFlowNode,
} from './demoData'
import './App.css'

/** 界面当前展示的论文算法阶段。 */
type Stage = 'graph' | 'search' | 'ordering' | 'placement'

/** 阶段切换栏中每个按钮的展示配置。 */
const STAGES: Array<{
  /** 程序内部使用的阶段标识。 */
  id: Stage
  /** 界面显示的两位阶段序号。 */
  index: string
  /** 阶段名称。 */
  title: string
  /** 对该阶段输入、处理方式和输出的简短说明。 */
  description: string
}> = [
  {
    id: 'graph',
    index: '01',
    title: '正交可见性图',
    description: '从外接矩形角点与连接点生成 XI × YI，只连接无遮挡的最近正交邻居。',
  },
  {
    id: 'search',
    index: '02',
    title: '方向感知 A*',
    description: '以 (节点, 进入方向) 为状态，用曼哈顿距离与最少折弯数估计剩余代价。',
  },
  {
    id: 'ordering',
    index: '03',
    title: '共享边排序',
    description: '沿伪方向传播相对顺序，使线路只在最后一条共享边的出口发生必要交叉。',
  },
  {
    id: 'placement',
    index: '04',
    title: 'VPSC 最终放置',
    description: '把期望通道中线投影到分离约束上，得到互不重叠的精确线段坐标。',
  },
]

// nodeTypes 告诉 React Flow：type === 'diagram' 的节点由 DiagramNode 组件渲染。
const nodeTypes = { diagram: DiagramNode } satisfies NodeTypes
// edgeTypes 把算法可视化使用的三种自定义 edge.type 映射到对应 SVG 渲染组件。
const edgeTypes = {
  'orthogonal-route': OrthogonalRouteEdge,
  'visibility-graph': VisibilityGraphEdge,
  'shared-edges': SharedEdgesOverlay,
} satisfies EdgeTypes

// DEFAULT_OPTIONS 是首次加载及点击“重置画布”时使用的路由参数。
const DEFAULT_OPTIONS: RoutingOptions = {
  // 连接线与对象真实外接矩形之间预留 20px 安全距离。
  clearance: 20,
  // 每增加一次折弯，就在 A* 代价中增加 28。
  bendPenalty: 28,
  // 多条连接线错开共享边后，相邻线路中心至少相距 10px。
  laneGap: 10,
}

// CANVAS_BOUNDS 限定可见图的外围搜索范围；四个角也会作为 interesting point。
const CANVAS_BOUNDS = { left: 20, top: 20, right: 1040, bottom: 620 }

// React Flow 之外只暴露这一个路由器实例，内部算法由它统一编排。
const orthogonalRouter = new OrthogonalRouter()

/**
 * 为 React state 建立一份初始节点浅层深拷贝。
 * position、data 和 style 都是对象，分别复制可避免拖动或状态更新污染常量。
 */
function cloneInitialNodes(): DiagramFlowNode[] {
  // node 是 INITIAL_NODES 中当前被复制的 React Flow 节点配置。
  return INITIAL_NODES.map((node) => ({
    ...node,
    position: { ...node.position },
    data: { ...node.data },
    style: { ...node.style },
  }))
}

function App() {
  // nodes 是画布上节点的实时位置和数据；拖动节点时会发生变化。
  // setNodes 用于重置整组节点；onNodesChange 交给 React Flow 处理拖动变化集。
  const [nodes, setNodes, onNodesChange] = useNodesState<DiagramFlowNode>(
    cloneInitialNodes(),
  )
  // stage 决定画布展示可见图、A* 结果、共享边顺序还是最终放置结果。
  const [stage, setStage] = useState<Stage>('placement')
  // options 保存三个可由右侧滑块实时调整的算法参数。
  const [options, setOptions] = useState(DEFAULT_OPTIONS)

  // rectangles 是把 React Flow 节点转换成纯算法 Rectangle 后的障碍物数组。
  // 算法层不依赖 React Flow，只认识左上角坐标及宽高。
  const rectangles = useMemo<Rectangle[]>(
    () =>
      nodes.map((node) => ({
        // id 用于把 Connector 中的 nodeId 与对应矩形关联起来。
        id: node.id,
        // React Flow 的 node.position 默认就是节点左上角，并非矩形中心。
        x: node.position.x,
        y: node.position.y,
        // 实际宽高来自节点业务数据，与 style 中的渲染尺寸保持一致。
        width: node.data.width,
        height: node.data.height,
      })),
    [nodes],
  )

  // 每次节点拖动或参数改变，都完整执行论文的三个路由阶段。
  // routing 是一次完整算法调用的结果，包含可见图、原始路径、共享顺序和最终路径。
  const routing = useMemo(
    () =>
      orthogonalRouter.route({
        rectangles,
        connectors: CONNECTORS,
        options,
        bounds: CANVAS_BOUNDS,
      }),
    [rectangles, options],
  )

  // flowEdges 把纯算法结果转换为 React Flow 可渲染的自定义 Edge 对象。
  // 阶段改变时只切换展示数据，不修改算法模块输出。
  const flowEdges = useMemo<Edge[]>(() => {
    // 自定义 overlay edge 仍需满足 React Flow 的 source/target 字段；
    // 它们只用于把覆盖层注册进画布，本身的 SVG 坐标来自 data。
    const firstNodeId = nodes[0]?.id ?? 'event-source'
    const lastNodeId = nodes[nodes.length - 1]?.id ?? 'audit-log'
    // edges 是本次 render 需要交给 React Flow 的边列表。
    const edges: Edge[] = []

    if (stage === 'graph' || stage === 'search') {
      // graphEdge 把整张可见图包装成一个覆盖层组件，而不是为每条可见边创建 React Flow Edge。
      const graphEdge: VisibilityFlowEdge = {
        id: 'visibility-graph',
        source: firstNodeId,
        target: lastNodeId,
        type: 'visibility-graph',
        selectable: false,
        focusable: false,
        data: {
          // graph 提供所有节点、边以及 ID 到坐标的映射。
          graph: routing.graph,
          // visitedNodeIds 是所有 A* 实际扩展过的节点集合。
          visitedNodeIds: routing.visitedNodeIds,
          // 只有搜索阶段才把访问节点用橙色高亮。
          showVisited: stage === 'search',
          // 搜索阶段降低可见图透明度，避免遮挡主要 A* 路径。
          opacity: stage === 'graph' ? 0.9 : 0.42,
        },
      }
      edges.push(graphEdge)
    }

    // visibleRoutes 决定使用 A* 原始折线还是经过共享边错开的最终折线。
    const visibleRoutes = stage === 'placement' ? routing.finalRoutes : routing.routes

    if (stage !== 'graph') {
      // route 是当前要转换成 React Flow 自定义边的一条算法连接线路径。
      visibleRoutes.forEach((route) => {
        // routeEdge 的 source/target/handle 负责 React Flow 关系，
        // 真正的完整正交折线路径由 data.points 交给 OrthogonalRouteEdge 绘制。
        const routeEdge: RouteFlowEdge = {
          id: `route-${route.id}`,
          source: route.source.nodeId,
          sourceHandle: `${route.source.side}-source`,
          target: route.target.nodeId,
          targetHandle: `${route.target.side}-target`,
          type: 'orthogonal-route',
          selectable: false,
          focusable: false,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 15,
            height: 15,
            color: route.color,
          },
          data: {
            // 最终阶段读取 finalPoints；其他阶段展示 A* 得到的 rawPoints。
            // find() 用 route.id 将 visibleRoutes 项与 finalRoutes 中的最终项对应起来。
            points: stage === 'placement'
              ? routing.finalRoutes.find((finalRoute) => finalRoute.id === route.id)
                  ?.finalPoints ?? route.rawPoints
              : route.rawPoints,
            color: route.color,
            opacity: stage === 'ordering' ? 0.32 : 1,
            dashed: stage === 'ordering',
          },
        }
        edges.push(routeEdge)
      })
    }

    if (stage === 'ordering') {
      // sharedEdge 是专门显示共享原子边和其 connectorIds 顺序标签的覆盖层。
      const sharedEdge: SharedFlowEdge = {
        id: 'shared-edges',
        source: firstNodeId,
        target: lastNodeId,
        type: 'shared-edges',
        selectable: false,
        focusable: false,
        data: {
          orders: routing.sharedEdges,
          connectorColors: Object.fromEntries(
            // connector 是一条输入连接线；这里建立 ID → 颜色映射供顺序标签着色。
            CONNECTORS.map((connector) => [connector.id, connector.color]),
          ),
        },
      }
      edges.push(sharedEdge)
    }

    return edges
  }, [nodes, routing, stage])

  // totals 汇总右侧统计面板需要的所有连接线路径指标。
  const totals = useMemo(
    () => ({
      // expanded 是每条 A* 搜索弹出并展开的状态数量总和。
      expanded: routing.routes.reduce(
        (sum, route) => sum + route.expandedStates,
        0,
      ),
      // length 是错开前所有正交路径长度总和，四舍五入成整数像素展示。
      length: Math.round(
        routing.routes.reduce((sum, route) => sum + route.length, 0),
      ),
      // bends 是所有路径中方向发生变化的次数总和。
      bends: routing.routes.reduce((sum, route) => sum + route.bends, 0),
    }),
    [routing.routes],
  )

  // activeStage 是当前阶段对应的标题和说明，供右侧说明面板读取。
  const activeStage = STAGES.find((item) => item.id === stage) as (typeof STAGES)[number]

  /**
   * 更新一个指定算法参数，同时保留 options 中另外两个参数。
   * @param key 要更新的 RoutingOptions 字段名。
   * @param value 滑块转换得到的新数值。
   */
  const updateOption = (key: keyof RoutingOptions, value: number) => {
    // current 是 React 保证的最新 options，计算式更新可避免闭包读取旧状态。
    setOptions((current) => ({ ...current, [key]: value }))
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <span className="app-kicker">PAPER IMPLEMENTATION · 2009</span>
          <h1>Orthogonal Router Lab</h1>
          <p>正交连接线路由完整算法演示</p>
        </div>
        <button
          type="button"
          className="reset-button"
          onClick={() => {
            setNodes(cloneInitialNodes())
            setOptions(DEFAULT_OPTIONS)
          }}
        >
          重置画布
        </button>
      </header>

      <nav className="stage-tabs" aria-label="算法阶段">
        {STAGES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={stage === item.id ? 'stage-tab is-active' : 'stage-tab'}
            onClick={() => setStage(item.id)}
          >
            <span>{item.index}</span>
            {item.title}
          </button>
        ))}
      </nav>

      <section className="workspace">
        <div className="flow-card">
          <ReactFlow
            nodes={nodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            fitView
            fitViewOptions={{ padding: 0.08 }}
            minZoom={0.55}
            maxZoom={1.8}
            nodesConnectable={false}
            edgesReconnectable={false}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1.25}
              color="#cbd5e1"
            />
            <Controls showInteractive={false} />
            <Panel position="top-left" className="canvas-tip">
              拖动任意对象，观察实时重新路由
            </Panel>
            {routing.failedConnectorIds.length > 0 && (
              <Panel position="bottom-center" className="routing-error">
                无法路由：{routing.failedConnectorIds.join('、')}
              </Panel>
            )}
          </ReactFlow>
        </div>

        <aside className="inspector">
          <section className="stage-explanation">
            <span>当前阶段 · {activeStage.index}</span>
            <h2>{activeStage.title}</h2>
            <p>{activeStage.description}</p>
          </section>

          <section className="metric-grid" aria-label="算法统计">
            <div><strong>{routing.graph.nodes.length}</strong><span>可见节点</span></div>
            <div><strong>{routing.graph.edges.length}</strong><span>可见边</span></div>
            <div><strong>{totals.expanded}</strong><span>A* 扩展状态</span></div>
            <div><strong>{routing.sharedEdges.length}</strong><span>共享边</span></div>
            <div><strong>{totals.length}</strong><span>路径总长度</span></div>
            <div><strong>{totals.bends}</strong><span>折弯总数</span></div>
          </section>

          <section className="parameter-panel">
            <h3>算法参数</h3>
            <label>
              <span><b>障碍间距</b><output>{options.clearance}px</output></span>
              <input
                type="range"
                min="12"
                max="34"
                step="2"
                value={options.clearance}
                onChange={(event) =>
                  updateOption('clearance', Number(event.target.value))
                }
              />
            </label>
            <label>
              <span><b>折弯惩罚</b><output>{options.bendPenalty}</output></span>
              <input
                type="range"
                min="0"
                max="80"
                step="4"
                value={options.bendPenalty}
                onChange={(event) =>
                  updateOption('bendPenalty', Number(event.target.value))
                }
              />
            </label>
            <label>
              <span><b>线路间距</b><output>{options.laneGap}px</output></span>
              <input
                type="range"
                min="6"
                max="18"
                step="2"
                value={options.laneGap}
                onChange={(event) =>
                  updateOption('laneGap', Number(event.target.value))
                }
              />
            </label>
          </section>

          <section className="route-list">
            <h3>连接线路径</h3>
            {routing.routes.map((route) => (
              <div key={route.id} className="route-row">
                <i style={{ background: route.color }}>{route.id}</i>
                <span>
                  <b>{route.label}</b>
                  <small>{Math.round(route.length)}px · {route.bends} 折</small>
                </span>
              </div>
            ))}
          </section>

          <section className="implementation-note">
            <h3>代码对应关系</h3>
            <code>visibilityGraph.ts</code><span>构造 XI × YI</span>
            <code>aStar.ts</code><span>open / closed list</span>
            <code>nudging.ts</code><span>排序与约束投影</span>
          </section>
        </aside>
      </section>
    </main>
  )
}

export default App
