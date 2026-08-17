import type { Direction, Point, Rectangle } from './types'

/** 全部浮点坐标比较共用的容差，避免直接使用 ===。 */
export const EPSILON = 0.001

/** 浮点坐标不能直接使用 ===，统一通过一个很小的误差比较。 */
export function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON
}

/**
 * 把坐标转换为稳定字符串，用作 Map/Set 中的节点 ID。
 * 先保留三位小数，避免 0.1 + 0.2 一类浮点误差生成两个逻辑相同的节点。
 */
export function pointKey(point: Point): string {
  return `${round(point.x)},${round(point.y)}`
}

/** 把坐标统一舍入到三位小数，保证字符串 ID 稳定。 */
export function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** 正交路径的距离下界：水平方向差值加垂直方向差值。 */
export function manhattanDistance(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

/**
 * 将对象外接矩形向四周扩张 padding。
 * 路由器把扩张后的矩形当作障碍物，从而自然实现 connector clearance。
 */
export function inflateRectangle(rectangle: Rectangle, padding: number): Rectangle {
  return {
    ...rectangle,
    x: rectangle.x - padding,
    y: rectangle.y - padding,
    width: rectangle.width + padding * 2,
    height: rectangle.height + padding * 2,
  }
}

/** 按左上、右上、右下、左下返回外接矩形的四个 interesting point。 */
export function rectangleCorners(rectangle: Rectangle): Point[] {
  // right 是矩形右边界的 x 坐标。
  const right = rectangle.x + rectangle.width

  // bottom 是矩形下边界的 y 坐标。
  const bottom = rectangle.y + rectangle.height

  return [
    { x: rectangle.x, y: rectangle.y },
    { x: right, y: rectangle.y },
    { x: right, y: bottom },
    { x: rectangle.x, y: bottom },
  ]
}

/**
 * 计算矩形某一侧的端口坐标。
 *
 * offset 沿矩形边移动端口；distance 沿法线向矩形外移动端口。
 * distance=0 得到真实连接点，distance=clearance 得到寻路使用的 routing point。
 */
export function portPoint(
  rectangle: Rectangle,
  side: Direction,
  offset = 0,
  distance = 0,
): Point {
  // centerX 是矩形水平中心线，用于计算 N/S 两侧端口的默认位置。
  const centerX = rectangle.x + rectangle.width / 2

  // centerY 是矩形垂直中心线，用于计算 E/W 两侧端口的默认位置。
  const centerY = rectangle.y + rectangle.height / 2

  // offset 沿当前边移动，distance 则沿当前边的外法线移动。
  switch (side) {
    case 'N':
      return { x: centerX + offset, y: rectangle.y - distance }
    case 'S':
      return {
        x: centerX + offset,
        y: rectangle.y + rectangle.height + distance,
      }
    case 'E':
      return {
        x: rectangle.x + rectangle.width + distance,
        y: centerY + offset,
      }
    case 'W':
      return { x: rectangle.x - distance, y: centerY + offset }
  }
}

/** 返回与给定方向相反的方向，例如 E -> W。 */
export function reverseDirection(direction: Direction): Direction {
  return { N: 'S', S: 'N', E: 'W', W: 'E' }[direction] as Direction
}

/** 返回从当前行进方向左转 90 度后的方向。 */
export function leftDirection(direction: Direction): Direction {
  return { N: 'W', W: 'S', S: 'E', E: 'N' }[direction] as Direction
}

/** 返回从当前行进方向右转 90 度后的方向。 */
export function rightDirection(direction: Direction): Direction {
  return { N: 'E', E: 'S', S: 'W', W: 'N' }[direction] as Direction
}

/**
 * 根据两个正交对齐点计算移动方向。
 * 可见性图边必须水平或垂直；出现斜线说明上游构图已经违反约束，直接抛错。
 */
export function directionBetween(a: Point, b: Point): Direction {
  if (Math.abs(a.x - b.x) < EPSILON) {
    return b.y < a.y ? 'N' : 'S'
  }

  if (Math.abs(a.y - b.y) < EPSILON) {
    return b.x < a.x ? 'W' : 'E'
  }

  throw new Error(`Points are not orthogonally aligned: ${pointKey(a)} -> ${pointKey(b)}`)
}

/**
 * 对应论文的 dirns(v1, v2)。
 * 目标在东北方向时会返回 {N, E}，在同一条东向射线上时只返回 {E}。
 */
export function directionsTo(from: Point, to: Point): Set<Direction> {
  // directions 最多包含一个垂直方向和一个水平方向。
  const directions = new Set<Direction>()

  if (to.y < from.y) directions.add('N')
  if (to.y > from.y) directions.add('S')
  if (to.x > from.x) directions.add('E')
  if (to.x < from.x) directions.add('W')

  return directions
}

/** 边界允许通行，只有严格位于矩形内部的点才算落入障碍物。 */
export function pointInsideRectangle(point: Point, rectangle: Rectangle): boolean {
  return (
    point.x > rectangle.x + EPSILON &&
    point.x < rectangle.x + rectangle.width - EPSILON &&
    point.y > rectangle.y + EPSILON &&
    point.y < rectangle.y + rectangle.height - EPSILON
  )
}

/**
 * 判断一条水平或垂直线段是否穿过障碍物内部。
 * 线段可以贴着外接矩形边界行走，但不能进入矩形内部。
 *
 * 水平线只需检查：y 是否落在矩形内部，并且两段 x 区间是否重叠。
 * 垂直线则交换 x/y 做完全对称的检查。
 */
export function segmentIsClear(
  start: Point,
  end: Point,
  obstacles: Rectangle[],
): boolean {
  // 两个端点 y 相同，说明当前检查的是水平线段。
  if (Math.abs(start.y - end.y) < EPSILON) {
    // minX/maxX 是水平线段覆盖的闭区间边界。
    const minX = Math.min(start.x, end.x)
    const maxX = Math.max(start.x, end.x)

    return obstacles.every((rectangle) => {
      // crossesInteriorY 表示线段所在的 y 穿过矩形内部，而不是只贴着上下边界。
      const crossesInteriorY =
        start.y > rectangle.y + EPSILON &&
        start.y < rectangle.y + rectangle.height - EPSILON
      // overlapsInteriorX 表示线段的 x 区间与矩形内部宽度存在重叠。
      const overlapsInteriorX =
        maxX > rectangle.x + EPSILON &&
        minX < rectangle.x + rectangle.width - EPSILON

      // 只有同时穿过矩形内部高度且水平区间重叠，才构成真正阻挡。
      return !(crossesInteriorY && overlapsInteriorX)
    })
  }

  // 两个端点 x 相同，说明当前检查的是垂直线段；逻辑与水平分支完全对称。
  if (Math.abs(start.x - end.x) < EPSILON) {
    // minY/maxY 是垂直线段覆盖的闭区间边界。
    const minY = Math.min(start.y, end.y)
    const maxY = Math.max(start.y, end.y)

    return obstacles.every((rectangle) => {
      // crossesInteriorX 表示线段所在的 x 穿过矩形内部。
      const crossesInteriorX =
        start.x > rectangle.x + EPSILON &&
        start.x < rectangle.x + rectangle.width - EPSILON
      // overlapsInteriorY 表示线段的 y 区间与矩形内部高度存在重叠。
      const overlapsInteriorY =
        maxY > rectangle.y + EPSILON &&
        minY < rectangle.y + rectangle.height - EPSILON

      return !(crossesInteriorX && overlapsInteriorY)
    })
  }

  // 起止点既不同 x 也不同 y，说明它是斜线；正交可见图不允许斜线边。
  return false
}

/**
 * 为无向可见图边生成稳定 ID。
 * A->B 和 B->A 会得到相同 key，便于检测重复边和多条线路共享的边。
 */
export function segmentKey(start: Point, end: Point): string {
  // first/second 是两个端点各自的稳定坐标 ID。
  const first = pointKey(start)
  const second = pointKey(end)

  // 按字典序排列端点，使 start->end 与 end->start 得到相同结果。
  return first < second ? `${first}|${second}` : `${second}|${first}`
}

/**
 * 删除重复点以及连续共线的中间点。
 * 例如 A -> B -> C 三点位于同一水平线时，只保留 A -> C。
 */
export function simplifyOrthogonalPoints(points: Point[]): Point[] {
  // deduplicated 先删除相邻重复点，避免生成长度为 0 的线段。
  const deduplicated = points.filter(
    (point, index) => index === 0 || !samePoint(point, points[index - 1]),
  )

  // 少于三个点不可能存在需要删除的共线中间点。
  if (deduplicated.length < 3) return deduplicated

  // result 始终保留第一个端点，后续只追加真正发生方向变化的点。
  const result: Point[] = [deduplicated[0]]

  for (let index = 1; index < deduplicated.length - 1; index += 1) {
    // previous 是当前结果中最后一个已经确认需要保留的点。
    const previous = result[result.length - 1]

    // current 是正在判断能否删除的中间点。
    const current = deduplicated[index]

    // next 是 current 后面的原始点，用于判断三个点是否共线。
    const next = deduplicated[index + 1]

    // 三个点 x 相同，current 位于同一条垂直线段中间，可以删除。
    const isVertical =
      Math.abs(previous.x - current.x) < EPSILON &&
      Math.abs(current.x - next.x) < EPSILON
    // 三个点 y 相同，current 位于同一条水平线段中间，可以删除。
    const isHorizontal =
      Math.abs(previous.y - current.y) < EPSILON &&
      Math.abs(current.y - next.y) < EPSILON

    // 既不水平共线也不垂直共线，说明 current 是真正的折弯点，必须保留。
    if (!isVertical && !isHorizontal) result.push(current)
  }

  // 最后一个端点永远需要保留。
  result.push(deduplicated[deduplicated.length - 1])
  return result
}

/** 对折线中每个相邻点计算曼哈顿距离并求和，即论文中的 ||R||。 */
export function polylineLength(points: Point[]): number {
  // length 累加每一条相邻点线段的长度。
  let length = 0

  // 从第二个点开始，让 points[index - 1] 与 points[index] 组成一条线段。
  for (let index = 1; index < points.length; index += 1) {
    length += manhattanDistance(points[index - 1], points[index])
  }

  return length
}

/** 合并共线段后，n 个点形成 n-1 条线段和 n-2 个折弯。 */
export function bendCount(points: Point[]): number {
  // simplified 中除首尾外的每一个点都是一次方向变化。
  const simplified = simplifyOrthogonalPoints(points)
  return Math.max(0, simplified.length - 2)
}

/** 将点序列转换成只含 M/L 命令的 SVG path；输入本身保证全部线段正交。 */
export function pointsToSvgPath(points: Point[]): string {
  // 空点集无法形成 SVG path。
  if (points.length === 0) return ''

  // 第一个点使用 M（移动画笔），后续点使用 L（直线连接）。
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${round(point.x)} ${round(point.y)}`)
    .join(' ')
}
