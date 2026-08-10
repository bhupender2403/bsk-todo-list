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
type TreeSize = { width: number; height: number }

const NODE_WIDTH = 270
const NODE_HEIGHT = 52
const CHILD_INDENT = 34
const CHILD_GAP = 18
const GROUP_PADDING = 14
const ROOT_GAP = 30

export default function TaskDag({ todos, selectedId, onSelect }: Props) {
  const graph = useMemo(() => layoutGraph(todos), [todos])

  if (todos.length === 0) {
    return <div className="dag-empty">Schedule or start a task to show its connected work here.</div>
  }

  return (
    <section className="dag-panel">
      <div className="dag-legend">
        <span><i className="dependency-line" /> Dependency</span>
        <span className="group-key"><i /> Parent with children</span>
      </div>
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
    </section>
  )
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

  const roots = todos.filter((todo) => todo.parent_id === null || !byTodoId.has(todo.parent_id))
  const sizes = new Map<number, TreeSize>()
  const measuring = new Set<number>()

  function measure(todo: Todo): TreeSize {
    if (measuring.has(todo.id)) return { width: NODE_WIDTH, height: NODE_HEIGHT }
    measuring.add(todo.id)
    const childTasks = children.get(todo.id) ?? []
    if (childTasks.length === 0) {
      const size = { width: NODE_WIDTH, height: NODE_HEIGHT }
      sizes.set(todo.id, size)
      measuring.delete(todo.id)
      return size
    }
    const childSizes = childTasks.map(measure)
    const size = {
      width: Math.max(NODE_WIDTH, CHILD_INDENT + Math.max(...childSizes.map((item) => item.width))) + GROUP_PADDING * 2,
      height: NODE_HEIGHT + CHILD_GAP + childSizes.reduce((sum, item) => sum + item.height, 0) + CHILD_GAP * (childSizes.length - 1) + GROUP_PADDING * 2,
    }
    sizes.set(todo.id, size)
    measuring.delete(todo.id)
    return size
  }

  roots.forEach(measure)
  const nodes: NodePosition[] = []
  const groups: ParentGroup[] = []
  const placed = new Set<number>()

  function place(todo: Todo, x: number, y: number) {
    if (placed.has(todo.id)) return
    placed.add(todo.id)
    const childTasks = children.get(todo.id) ?? []
    const size = sizes.get(todo.id) ?? { width: NODE_WIDTH, height: NODE_HEIGHT }
    if (childTasks.length > 0) {
      groups.push({ id: todo.id, x, y, width: size.width, height: size.height })
      nodes.push({ todo, x: x + GROUP_PADDING, y: y + GROUP_PADDING })
      let childY = y + GROUP_PADDING + NODE_HEIGHT + CHILD_GAP
      for (const child of childTasks) {
        place(child, x + GROUP_PADDING + CHILD_INDENT, childY)
        childY += (sizes.get(child.id)?.height ?? NODE_HEIGHT) + CHILD_GAP
      }
    } else {
      nodes.push({ todo, x, y })
    }
  }

  const rootX = 24
  let rootY = 28
  for (const root of roots) {
    place(root, rootX, rootY)
    rootY += (sizes.get(root.id)?.height ?? NODE_HEIGHT) + ROOT_GAP
  }
  for (const todo of todos) {
    if (!placed.has(todo.id)) {
      measure(todo)
      place(todo, rootX, rootY)
      rootY += (sizes.get(todo.id)?.height ?? NODE_HEIGHT) + ROOT_GAP
    }
  }

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

  const width = Math.max(760, ...nodes.map((node) => node.x + NODE_WIDTH + 28), ...groups.map((group) => group.x + group.width + 28))
  const height = Math.max(360, rootY, ...nodes.map((node) => node.y + NODE_HEIGHT + 28), ...groups.map((group) => group.y + group.height + 28))
  return { nodes, groups, edges, width, height, byId: new Map(nodes.map((node) => [node.todo.id, node])) }
}
