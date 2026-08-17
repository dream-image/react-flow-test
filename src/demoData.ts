import type { Node } from '@xyflow/react'
import type { Connector } from './algorithm'

export type DiagramNodeData = {
  /** 节点中央显示的主要名称。 */
  label: string
  /** 节点名称下方的补充说明。 */
  caption: string
  /** endpoint 可以连接线路；obstacle 只作为需要绕开的对象。 */
  role: 'endpoint' | 'obstacle'
  /** 节点渲染宽度，同时传给算法作为外接矩形宽度。 */
  width: number
  /** 节点渲染高度，同时传给算法作为外接矩形高度。 */
  height: number
  /** 节点边框、端口和识别标签使用的主题色。 */
  accent: string
}

/** 本 Demo 使用的 React Flow 节点类型：data 为 DiagramNodeData，type 固定为 diagram。 */
export type DiagramFlowNode = Node<DiagramNodeData, 'diagram'>

/**
 * Demo 初始对象布局。
 * 每个 position 都是矩形左上角坐标；style 尺寸与 data 尺寸必须保持一致，
 * 前者控制 React Flow 渲染，后者提供给正交路由算法。
 */
export const INITIAL_NODES: DiagramFlowNode[] = [
  {
    // event-source 是三条连接线共同的源对象。
    id: 'event-source',
    type: 'diagram',
    position: { x: 54, y: 270 },
    data: {
      label: '事件源',
      caption: '三个连接器共用出口',
      role: 'endpoint',
      width: 150,
      height: 76,
      accent: '#2563eb',
    },
    style: { width: 150, height: 76 },
  },
  {
    // inventory 位于上方中央，只作为需要绕开的矩形障碍物 A。
    id: 'inventory',
    type: 'diagram',
    position: { x: 365, y: 126 },
    data: {
      label: '库存服务',
      caption: '障碍物 A',
      role: 'obstacle',
      width: 220,
      height: 138,
      accent: '#d97706',
    },
    style: { width: 220, height: 138 },
  },
  {
    // payment 位于下方中央，只作为需要绕开的矩形障碍物 B。
    id: 'payment',
    type: 'diagram',
    position: { x: 365, y: 370 },
    data: {
      label: '支付服务',
      caption: '障碍物 B',
      role: 'obstacle',
      width: 220,
      height: 138,
      accent: '#d97706',
    },
    style: { width: 220, height: 138 },
  },
  {
    // notification 是连接线 A 的目标对象。
    id: 'notification',
    type: 'diagram',
    position: { x: 850, y: 62 },
    data: {
      label: '通知服务',
      caption: 'Connector A',
      role: 'endpoint',
      width: 148,
      height: 70,
      accent: '#7c3aed',
    },
    style: { width: 148, height: 70 },
  },
  {
    // order-db 是连接线 B 的目标对象。
    id: 'order-db',
    type: 'diagram',
    position: { x: 850, y: 276 },
    data: {
      label: '订单数据库',
      caption: 'Connector B',
      role: 'endpoint',
      width: 148,
      height: 70,
      accent: '#059669',
    },
    style: { width: 148, height: 70 },
  },
  {
    // audit-log 是连接线 C 的目标对象。
    id: 'audit-log',
    type: 'diagram',
    position: { x: 850, y: 492 },
    data: {
      label: '审计日志',
      caption: 'Connector C',
      role: 'endpoint',
      width: 148,
      height: 70,
      accent: '#dc2626',
    },
    style: { width: 148, height: 70 },
  },
]

/**
 * 需要由 OrthogonalRouter 求解的三条连接线。
 * source/target 只描述业务连接关系及端口方向，路径坐标由算法运行后产生。
 */
export const CONNECTORS: Connector[] = [
  {
    // A 从事件源东侧出发，进入通知服务西侧。
    id: 'A',
    label: '通知事件',
    source: { nodeId: 'event-source', side: 'E' },
    target: { nodeId: 'notification', side: 'W' },
    color: '#7c3aed',
  },
  {
    // B 从同一源端口区域出发，进入订单数据库西侧。
    id: 'B',
    label: '持久化事件',
    source: { nodeId: 'event-source', side: 'E' },
    target: { nodeId: 'order-db', side: 'W' },
    color: '#059669',
  },
  {
    // C 从同一源端口区域出发，进入审计日志西侧。
    id: 'C',
    label: '审计事件',
    source: { nodeId: 'event-source', side: 'E' },
    target: { nodeId: 'audit-log', side: 'W' },
    color: '#dc2626',
  },
]
