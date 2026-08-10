import { useMemo } from 'react'
import { getTodoStatus, type Todo } from './api'

type Props = {
  todos: Todo[]
  selectedId: number | null
  onSelect: (id: number) => void
}

type Edge = { from: number; to: number }
type NodePosition = { todo: Todo; x: number; y: number }
type ParentGroup = { id: number; x: number; y: number; width: number; height: number }
const NODE_WIDTH = 270
const NODE_HEIGHT = 52
const GROUP_PADDING = 14
const DATE_GAP = 74
const ROW_GAP = 22

export default function TaskDag({ todos, selectedId, onSelect }: Props) {
  const graph = useMemo(() => layoutGraph(todos), [todos])
  const timeline = useMemo(() => buildTimeline(todos), [todos])

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
          <defs>
            <marker id="dag-arrow-dependency" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
          </defs>

          {graph.groups.map((group) => (
            <g className="dag-parent-group" key={group.id}>
              <rect x={group.x} y={group.y} width={group.width} height={group.height} rx="18" />
            </g>
          ))}

          {graph.edges.map((edge) => {
            const from = graph.byId.get(edge.from)
            const to = graph.byId.get(edge.to)
            if (!from || !to) return null
            const startX = from.x + NODE_WIDTH / 2
            const startY = from.y + NODE_HEIGHT
            const endX = to.x + NODE_WIDTH / 2
            const endY = to.y
            const vertical = Math.max(24, Math.abs(endY - startY) / 2)
            return <path className="dag-edge dependency" d={`M ${startX} ${startY} C ${startX} ${startY + vertical}, ${endX} ${endY - vertical}, ${endX} ${endY}`} markerEnd="url(#dag-arrow-dependency)" key={`${edge.from}-${edge.to}`} />
          })}

          {graph.nodes.map(({ todo, x, y }) => (
            <g className={`dag-node status-${getTodoStatus(todo)} ${selectedId === todo.id ? 'selected' : ''}`} onClick={() => onSelect(todo.id)} key={todo.id}>
              <rect x={x} y={y} width={NODE_WIDTH} height={NODE_HEIGHT} rx="12" />
              <text className="dag-title" x={x + 14} y={y + 31}>{truncate(`#${todo.id} · ${todo.title} · ${todo.todo_type}`, 39)}</text>
              {getTodoStatus(todo) === 'completed' && <text className="dag-check" x={x + NODE_WIDTH - 22} y={y + 31}>✓</text>}
              <title>Task #{todo.id}: {todo.title}</title>
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
    <div className="date-timeline" style={{ width }} aria-label="Task schedule timeline">
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
  return Array.from(new Set([today, ...counts.keys()]))
    .sort()
    .map((date, index) => ({ date, count: counts.get(date) ?? 0, today: date === today, x: positions?.get(date) ?? 30 + index * (NODE_WIDTH + DATE_GAP) + NODE_WIDTH / 2 }))
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

function layoutGraph(todos: Todo[]) {
  const byTodoId = new Map(todos.map((todo) => [todo.id, todo]))
  const children = new Map<number, Todo[]>()
  for (const todo of todos) {
    if (todo.parent_id !== null && byTodoId.has(todo.parent_id)) {
      children.set(todo.parent_id, [...(children.get(todo.parent_id) ?? []), todo])
    }
  }

  const today = localDateKey(new Date())
  const dates = Array.from(new Set([today, ...todos.flatMap((todo) => todo.start_time ? [todo.start_time.slice(0, 10)] : [])])).sort()
  const dateX = new Map(dates.map((date, index) => [date, 30 + index * (NODE_WIDTH + DATE_GAP)]))
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
    const node = { todo, x: dateX.get(assignedDate.get(todo.id) ?? today) ?? 30, y: 28 + row * (NODE_HEIGHT + ROW_GAP) }
    row += 1
    nodes.push(node)
    const subtree = [node]
    for (const child of children.get(todo.id) ?? []) subtree.push(...place(child))
    if (subtree.length > 1) {
      const minX = Math.min(...subtree.map((item) => item.x)) - GROUP_PADDING
      const maxX = Math.max(...subtree.map((item) => item.x + NODE_WIDTH)) + GROUP_PADDING
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

  const width = Math.max(760, dates.length * (NODE_WIDTH + DATE_GAP) + 30)
  const height = Math.max(360, ...nodes.map((node) => node.y + NODE_HEIGHT + 28), ...groups.map((group) => group.y + group.height + 28))
  const timelinePositions = new Map(dates.map((date) => [date, (dateX.get(date) ?? 30) + NODE_WIDTH / 2]))
  return { nodes, groups, edges, width, height, timeline: buildTimeline(todos, timelinePositions), byId: new Map(nodes.map((node) => [node.todo.id, node])) }
}
