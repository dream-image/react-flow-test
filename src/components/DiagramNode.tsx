import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CSSProperties } from 'react'
import type { DiagramFlowNode } from '../demoData'

// HANDLES 把算法使用的 N/E/S/W 方向映射到 React Flow 的四个 Handle 位置。
const HANDLES = [
  { side: 'N', position: Position.Top },
  { side: 'E', position: Position.Right },
  { side: 'S', position: Position.Bottom },
  { side: 'W', position: Position.Left },
] as const

export function DiagramNode({ data, selected }: NodeProps<DiagramFlowNode>) {
  return (
    <div
      className={`diagram-node diagram-node--${data.role} ${selected ? 'is-selected' : ''}`}
      style={{ '--node-accent': data.accent } as CSSProperties}
    >
      <span className="diagram-node__eyebrow">
        {data.role === 'obstacle' ? 'BOUNDING BOX' : 'ENDPOINT'}
      </span>
      <strong>{data.label}</strong>
      <small>{data.caption}</small>

      {data.role === 'endpoint' &&
        // side 是算法端口方向；position 是 React Flow 对应的边位置。
        // 同一方向同时建立 source 和 target handle，让对象既能作为起点也能作为终点。
        HANDLES.flatMap(({ side, position }) => [
          <Handle
            key={`${side}-source`}
            id={`${side}-source`}
            type="source"
            position={position}
            className="diagram-handle"
          />,
          <Handle
            key={`${side}-target`}
            id={`${side}-target`}
            type="target"
            position={position}
            className="diagram-handle"
          />,
        ])}
    </div>
  )
}
