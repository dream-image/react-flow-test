// 公共运行入口：UI 只需实例化 OrthogonalRouter。
export { OrthogonalRouter } from './OrthogonalRouter'
// 公共入口参数类型：供调用者获得完整的 TypeScript 字段约束。
export type { OrthogonalRouterInput } from './OrthogonalRouter'
// 画布搜索边界类型由内部 router 定义，在这里统一向外导出。
export type { RoutingBounds } from './router'
// UI、测试或其他调用层可能需要使用的纯算法数据类型。
export type {
  Connector,
  Direction,
  FinalConnector,
  Point,
  Rectangle,
  RoutingOptions,
  RoutingResult,
  SharedEdgeOrder,
  VisibilityGraph,
} from './types'
