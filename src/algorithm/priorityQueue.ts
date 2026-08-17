/**
 * A* 的 open list 使用最小堆实现。
 * 堆顶始终是预计总代价最低的状态，插入和弹出都是 O(log n)。
 *
 * 数组下标关系：
 * - parent(i) = floor((i - 1) / 2)
 * - left(i) = 2i + 1
 * - right(i) = 2i + 2
 *
 * 最小堆只保证父节点不大于子节点，并不会把整个数组完全排序。
 */
export class MinHeap<T> {
  /**
   * 堆的底层连续存储。
   * values[0] 永远是 compare() 意义下优先级最高、也就是“最小”的元素。
   */
  private readonly values: T[] = []
  /**
   * 调用方提供的比较函数。
   * 返回负数表示 left 应排在 right 前面，0 表示同级，正数表示后面。
   */
  private readonly compare: (left: T, right: T) => number

  /** @param compare 定义泛型元素 T 之间优先级顺序的函数。 */
  constructor(compare: (left: T, right: T) => number) {
    this.compare = compare
  }

  /** 当前 open list 中尚未弹出的元素数量。 */
  get size(): number {
    return this.values.length
  }

  /**
   * 插入一个新元素。
   * @param value 要加入堆的 A* 候选状态或其他泛型值。
   */
  push(value: T): void {
    // 新元素先放在数组末尾，再向上交换到满足堆序的位置。
    this.values.push(value)
    this.bubbleUp(this.values.length - 1)
  }

  /**
   * 取出并删除当前最小元素。
   * @returns 堆顶元素；堆为空时返回 undefined。
   */
  pop(): T | undefined {
    if (this.values.length === 0) return undefined
    if (this.values.length === 1) return this.values.pop()

    // minimum 暂存即将返回的旧堆顶，防止底层数组重排后丢失它。
    const minimum = this.values[0]
    // 用最后一个元素填补堆顶空位，再向下交换恢复堆序。
    this.values[0] = this.values.pop() as T
    this.bubbleDown(0)
    return minimum
  }

  /** 从 startIndex 开始不断与父节点比较，让新元素向堆顶上浮。 */
  private bubbleUp(startIndex: number): void {
    // index 始终指向当前正在尝试上浮的元素位置。
    let index = startIndex

    while (index > 0) {
      // parentIndex 是完全二叉树数组表示中 index 的父节点下标。
      const parentIndex = Math.floor((index - 1) / 2)
      // 当前元素不小于父节点时，这条祖先链已经满足最小堆性质。
      if (this.compare(this.values[index], this.values[parentIndex]) >= 0) break

      // 子元素优先级更高时，交换父子位置并继续检查更上一层。
      ;[this.values[index], this.values[parentIndex]] = [
        this.values[parentIndex],
        this.values[index],
      ]
      index = parentIndex
    }
  }

  /** 从 startIndex 开始选择更小的子节点交换，让替补堆顶向下沉。 */
  private bubbleDown(startIndex: number): void {
    // index 始终指向当前正在尝试下沉的元素位置。
    let index = startIndex

    while (true) {
      // leftIndex 和 rightIndex 是完全二叉树数组表示中的两个子节点下标。
      const leftIndex = index * 2 + 1
      const rightIndex = leftIndex + 1
      // smallestIndex 记录当前节点和有效子节点中优先级最高者的下标。
      let smallestIndex = index

      // 在当前节点和两个子节点中选择最小者；若最小者不是当前节点就交换。
      if (
        leftIndex < this.values.length &&
        this.compare(this.values[leftIndex], this.values[smallestIndex]) < 0
      ) {
        smallestIndex = leftIndex
      }

      if (
        rightIndex < this.values.length &&
        this.compare(this.values[rightIndex], this.values[smallestIndex]) < 0
      ) {
        smallestIndex = rightIndex
      }

      // 当前节点已经不大于两个子节点，局部和整棵子树都恢复了最小堆性质。
      if (smallestIndex === index) break

      // 与更小的子节点交换，再从交换后的新位置继续向下检查。
      ;[this.values[index], this.values[smallestIndex]] = [
        this.values[smallestIndex],
        this.values[index],
      ]
      index = smallestIndex
    }
  }
}
