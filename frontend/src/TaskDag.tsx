import { useMemo } from 'react'
import { getTodoStatus, type Todo } from './api'

type Props = {
  todos: Todo[]
  selectedId: number | null
  onSelect: (id: number) => void
  onOpen: (id: number) => void
}

type Edge = { from: number; to: number }
type NodePosition = { todo: Todo; x: number; y: number; width: number }
type ParentGroup = { id: number; x: number; y: number; width: number; height: number }
const NODE_HEIGHT = 52
const GROUP_PADDING = 14
const DATE_STEP = 110
const DAY_BAR_GAP = 12
const MIN_NODE_WIDTH = 52
const ROW_GAP = 22

export default function TaskDag({ todos, selectedId, onSelect, onOpen }: Props) {
  const graph = useMemo(() => layoutGraph(todos), [todos])
  const timeline = useMemo(() => buildTimeline(todos), [todos])
  const activeEdges = useMemo(
    () => selectedId === null ? [] : graph.edges.filter((edge) => edge.from === selectedId || edge.to === selectedId),
    [graph.edges, selectedId],
  )
  const participatingIds = useMemo(
    () => new Set([...(selectedId === null ? [] : [selectedId]), ...activeEdges.flatMap((edge) => [edge.from, edge.to])]),
    [activeEdges, selectedId],
  )

  if (todos.length === 0) {
    return (
      <section className="dag-panel">
        <DateTimeline items={timeline} width={760} />
        <div className="dag-empty">Schedule or start a task to show its connected work here.</div>
      </section>
    )
  }

  return (
    <section className="dag-panel">
      <div className="dag-legend">
        <span><i className="dependency-line" /> Dependency</span>
        <span className="group-key"><i /> Parent with children</span>
      </div>
      <div className="dag-scroll">
        <div className="dag-aligned-content" style={{ width: graph.width }}>
          <DateTimeline items={graph.timeline} width={graph.width} />
          <div className="dag-canvas">
            <svg viewBox={`0 0 ${graph.width} ${graph.height}`} width={graph.width} height={graph.height} role="img" aria-label="Task dependency graph">
          {graph.groups.map((group) => (
            <g className="dag-parent-group" key={group.id}>
              <rect x={group.x} y={group.y} width={group.width} height={group.height} rx="18" />
            </g>
          ))}

          {graph.nodes.map(({ todo, x, y, width }) => (
            <g className={`dag-node status-${getTodoStatus(todo)} ${selectedId === todo.id ? 'selected' : ''} ${selectedId !== null && !participatingIds.has(todo.id) ? 'non-participating' : ''}`} onClick={() => onSelect(todo.id)} onDoubleClick={() => onOpen(todo.id)} key={todo.id}>
              <rect x={x} y={y} width={width} height={NODE_HEIGHT} rx="12" />
              <text className="dag-title" x={x + 12} y={y + 31}>{nodeLabel(todo, width)}</text>
              {getTodoStatus(todo) === 'completed' && width >= 80 && <text className="dag-check" x={x + width - 18} y={y + 31}>✓</text>}
              <title>Task #{todo.id}: {todo.title}</title>
            </g>
          ))}

          {activeEdges.map((edge, index) => {
            const from = graph.byId.get(edge.from)
            const to = graph.byId.get(edge.to)
            if (!from || !to) return null
            const route = dependencyRoute(from, to, index)
            return (
              <g className="dag-edge-layer" key={`${edge.from}-${edge.to}`}>
                <path className="dag-edge dependency" d={route.path} />
                <path className="dependency-arrow" d="M -6 -4 L 6 0 L -6 4 Z" transform={`translate(${route.arrowX} ${route.arrowY}) rotate(${route.angle})`} />
              </g>
            )
          })}

          {graph.nodes.map(({ todo, x, y, width }) => (
            <g className="dependency-markers" key={`markers-${todo.id}`}>
              {activeEdges.some((edge) => edge.to === todo.id) && <circle className="dependency-endpoint depends" cx={x - 6} cy={y + NODE_HEIGHT / 2} r="5" />}
              {activeEdges.some((edge) => edge.from === todo.id) && <rect className="dependency-endpoint prerequisite" x={x + width + 1} y={y + NODE_HEIGHT / 2 - 5} width="10" height="10" rx="1" />}
            </g>
          ))}
            </svg>
          </div>
        </div>
      </div>
    </section>
  )
}

function DateTimeline({ items, width }: { items: ReturnType<typeof buildTimeline>; width: number }) {
  const ticks = items.flatMap((item, index) => {
    const next = items[index + 1]
    if (!next) return [{ x: item.x, major: true }]
    return Array.from({ length: 4 }, (_, step) => ({
      x: item.x + ((next.x - item.x) * step) / 4,
      major: step === 0,
    }))
  })
  return (
    <div className="date-timeline" style={{ width: '100%', minWidth: width }} aria-label="Task schedule timeline">
      <span className="timeline-title">Timeline</span>
      <div className="timeline-track">
        {ticks.map((tick, index) => <i className={`timeline-tick ${tick.major ? 'major' : ''}`} style={{ left: tick.x }} key={`${tick.x}-${index}`} />)}
        {items.map((item) => (
          <div className={`timeline-date ${item.today ? 'today' : ''}`} style={{ left: item.x }} key={item.date}>
            <i />
            <strong>{item.today ? 'Today' : formatTimelineDate(item.date)}</strong>
            <small>{item.count ? `${item.count} task${item.count === 1 ? '' : 's'}` : 'No tasks'}</small>
          </div>
        ))}
      </div>
    </div>
  )
}

function buildTimeline(todos: Todo[], positions?: Map<string, number>) {
  const today = localDateKey(new Date())
  const counts = new Map<string, number>()
  for (const todo of todos) {
    if (!todo.start_time) continue
    const date = todo.start_time.slice(0, 10)
    counts.set(date, (counts.get(date) ?? 0) + 1)
  }
  const dates = positions ? Array.from(positions.keys()) : buildDateRange(Array.from(counts.keys()))
  return dates
    .map((date, index) => ({ date, count: counts.get(date) ?? 0, today: date === today, x: positions?.get(date) ?? 50 + index * DATE_STEP }))
}

function buildDateRange(taskDates: string[]) {
  const today = localDateKey(new Date())
  const defaultStart = shiftDate(today, -7)
  const defaultEnd = shiftDate(today, 14)
  const start = [defaultStart, ...taskDates].sort()[0]
  const end = [defaultEnd, ...taskDates].sort().at(-1) ?? defaultEnd
  const dates: string[] = []
  for (let date = start; date <= end; date = shiftDate(date, 1)) dates.push(date)
  return dates
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function localDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatTimelineDate(date: string) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value
}

function nodeLabel(todo: Todo, width: number) {
  if (width < 80) return `#${todo.id}`
  return truncate(`#${todo.id} · ${todo.title} · ${todo.todo_type}`, Math.max(8, Math.floor(width / 7.2) - 2))
}

function layoutGraph(todos: Todo[]) {
  const byTodoId = new Map(todos.map((todo) => [todo.id, todo]))
  const children = new Map<number, Todo[]>()
  for (const todo of todos) {
    if (todo.parent_id !== null && byTodoId.has(todo.parent_id)) {
      children.set(todo.parent_id, [...(children.get(todo.parent_id) ?? []), todo])
    }
  }

  const today = localDateKey(new Date())
  const rangeDates = todos.flatMap((todo) => {
    const start = todo.start_time?.slice(0, 10) ?? today
    const values = [start]
    if (todo.end_time) values.push(todo.end_time.slice(0, 10))
    else if (todo.expected_duration_minutes) values.push(shiftDate(start, Math.max(0, Math.ceil(todo.expected_duration_minutes / 1440) - 1)))
    return values
  })
  const dates = buildDateRange(rangeDates)
  const dateX = new Map(dates.map((date, index) => [date, 50 + index * DATE_STEP]))
  const related = new Map(todos.map((todo) => [todo.id, new Set<number>()]))
  for (const todo of todos) {
    for (const id of [todo.parent_id, ...todo.dependency_ids]) {
      if (id === null || !byTodoId.has(id)) continue
      related.get(todo.id)?.add(id)
      related.get(id)?.add(todo.id)
    }
  }
  const assignedDate = new Map<number, string>()
  todos.forEach((todo) => { if (todo.start_time) assignedDate.set(todo.id, todo.start_time.slice(0, 10)) })
  for (const todo of todos) {
    if (assignedDate.has(todo.id)) continue
    const queue = [todo.id]
    const visited = new Set(queue)
    let inherited = today
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const found = assignedDate.get(queue[cursor])
      if (found) { inherited = found; break }
      for (const id of related.get(queue[cursor]) ?? []) if (!visited.has(id)) { visited.add(id); queue.push(id) }
    }
    assignedDate.set(todo.id, inherited)
  }

  const roots = todos.filter((todo) => todo.parent_id === null || !byTodoId.has(todo.parent_id))
  const nodes: NodePosition[] = []
  const groups: ParentGroup[] = []
  const placed = new Set<number>()
  let row = 0

  function place(todo: Todo): NodePosition[] {
    if (placed.has(todo.id)) return []
    placed.add(todo.id)
    const assignedStart = assignedDate.get(todo.id) ?? today
    const spanDays = taskSpanDays(todo, assignedStart)
    const node = { todo, x: dateX.get(assignedStart) ?? 50, y: 28 + row * (NODE_HEIGHT + ROW_GAP), width: Math.max(MIN_NODE_WIDTH, spanDays * DATE_STEP - DAY_BAR_GAP) }
    row += 1
    nodes.push(node)
    const subtree = [node]
    for (const child of children.get(todo.id) ?? []) subtree.push(...place(child))
    if (subtree.length > 1) {
      const descendantMinX = Math.min(...subtree.slice(1).map((item) => item.x))
      const descendantMaxX = Math.max(...subtree.slice(1).map((item) => item.x + item.width))
      const parentRight = node.x + node.width
      node.x = Math.min(node.x, descendantMinX)
      node.width = Math.max(parentRight, descendantMaxX) - node.x
      const minX = Math.min(...subtree.map((item) => item.x)) - GROUP_PADDING
      const maxX = Math.max(...subtree.map((item) => item.x + item.width)) + GROUP_PADDING
      const minY = node.y - GROUP_PADDING
      const maxY = Math.max(...subtree.map((item) => item.y + NODE_HEIGHT)) + GROUP_PADDING
      groups.push({ id: todo.id, x: minX, y: minY, width: maxX - minX, height: maxY - minY })
    }
    return subtree
  }

  roots.forEach(place)
  todos.forEach(place)

  const edges: Edge[] = []
  const seen = new Set<string>()
  for (const todo of todos) {
    for (const dependencyId of todo.dependency_ids) {
      if (!byTodoId.has(dependencyId)) continue
      const key = `${dependencyId}-${todo.id}`
      if (!seen.has(key)) {
        edges.push({ from: dependencyId, to: todo.id })
        seen.add(key)
      }
    }
  }

  const width = Math.max(760, ...nodes.map((node) => node.x + node.width + 120), (dates.length - 1) * DATE_STEP + 160)
  const height = Math.max(360, ...nodes.map((node) => node.y + NODE_HEIGHT + 28), ...groups.map((group) => group.y + group.height + 28))
  const timelinePositions = new Map(dates.map((date) => [date, dateX.get(date) ?? 50]))
  return { nodes, groups, edges, width, height, timeline: buildTimeline(todos, timelinePositions), byId: new Map(nodes.map((node) => [node.todo.id, node])) }
}

function taskSpanDays(todo: Todo, startDate: string) {
  if (todo.end_time) return Math.max(1, differenceInDays(startDate, todo.end_time.slice(0, 10)) + 1)
  if (todo.expected_duration_minutes) return Math.max(1, todo.expected_duration_minutes / 1440)
  return 1
}

function dependencyRoute(from: NodePosition, to: NodePosition, index: number) {
  // A dependency edge starts at the dependent task's start and points to the
  // dependency task's end.
  const startX = to.x - 6
  const startY = to.y + NODE_HEIGHT / 2
  const endX = from.x + from.width + 6
  const endY = from.y + NODE_HEIGHT / 2
  const laneOffset = 28 + (index % 5) * 10

  if (Math.abs(startY - endY) < 1) {
    return straightRoute(startX, startY, endX, endY)
  }

  if (startX >= endX + 8) {
    return orthogonalRoute(startX, startY, (startX + endX) / 2, endX, endY)
  }

  const leftLaneX = Math.max(4, Math.min(startX, from.x) - laneOffset)
  const rightLaneX = Math.max(to.x + to.width, endX) + laneOffset
  const routeY = Math.max(4, Math.min(from.y, to.y) - laneOffset)
  return {
    path: `M ${startX} ${startY} H ${leftLaneX} V ${routeY} H ${rightLaneX} V ${endY} H ${endX}`,
    arrowX: (leftLaneX + rightLaneX) / 2,
    arrowY: routeY,
    angle: 0,
  }
}

function orthogonalRoute(startX: number, startY: number, laneX: number, endX: number, endY: number) {
  return {
    path: `M ${startX} ${startY} H ${laneX} V ${endY} H ${endX}`,
    arrowX: laneX,
    arrowY: (startY + endY) / 2,
    angle: endY >= startY ? 90 : -90,
  }
}

function straightRoute(startX: number, startY: number, endX: number, endY: number) {
  return {
    path: `M ${startX} ${startY} H ${endX}`,
    arrowX: (startX + endX) / 2,
    arrowY: (startY + endY) / 2,
    angle: endX >= startX ? 0 : 180,
  }
}

function differenceInDays(start: string, end: string) {
  return Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86400000)
}
