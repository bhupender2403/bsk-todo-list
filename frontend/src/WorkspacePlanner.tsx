import { useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { api, type Todo, type TodoItem, type TodoItemInput } from './api'

type Props = { todos: Todo[]; onTaskUpdated: (todo: Todo) => void; onError: (reason: unknown) => void }
const DAY_MINUTES = 1440
const SNAP_MINUTES = 15

export default function WorkspacePlanner({ todos, onTaskUpdated, onError }: Props) {
  const [resizePreview, setResizePreview] = useState<{ itemId: number; start: number; duration: number } | null>(null)
  const [movePreview, setMovePreview] = useState<{ itemId: number; offset: number; duration: number; start: number | null } | null>(null)
  const picked = todos.filter((todo) => todo.is_picked)
  const today = localDateKey(new Date())
  const scheduled = assignLanes(picked.flatMap((todo) => todo.todo_items
    .filter((item) => item.worked_on_start?.slice(0, 10) === today)
    .map((item) => ({ todo, item, start: minutesOfDay(item.worked_on_start!), duration: item.worked_on_duration_minutes ?? 60 }))))
  const pending = picked.map((todo) => ({ todo, items: todo.todo_items.filter((item) => item.worked_on_start?.slice(0, 10) !== today) })).filter(({ items }) => items.length > 0)
  const intervals = (exceptId?: number) => scheduled.filter(({ item }) => item.id !== exceptId).map(({ start, duration }) => ({ start, end: start + duration }))

  async function saveItem(task: Todo, itemId: number, changes: Partial<TodoItemInput>) {
    try {
      const todo_items = task.todo_items.map((item) => ({
        id: item.id, name: item.name, estimated_duration_minutes: item.estimated_duration_minutes,
        worked_on_start: item.worked_on_start, worked_on_duration_minutes: item.worked_on_duration_minutes,
        ...(item.id === itemId ? changes : {}),
      }))
      onTaskUpdated(await api.update(task.id, { todo_items }))
    } catch (reason) { onError(reason) }
  }

  function beginDrag(event: DragEvent<HTMLDivElement>, itemId: number, duration: number, preserveOffset = false) {
    const source = event.currentTarget
    event.dataTransfer.setData('text/todo-item-id', String(itemId))
    let offset = 0
    if (preserveOffset) {
      const rect = event.currentTarget.getBoundingClientRect()
      const pointerRatio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
      offset = pointerRatio * duration
      event.dataTransfer.setData('text/todo-drag-offset', String(offset))
    }
    event.dataTransfer.effectAllowed = 'move'
    requestAnimationFrame(() => { source.classList.add('dragging-source'); setMovePreview({ itemId, offset, duration, start: null }) })
  }

  function endDrag(event: DragEvent<HTMLDivElement>) { event.currentTarget.classList.remove('dragging-source'); setMovePreview(null) }

  function previewMove(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (!movePreview) return
    const rect = event.currentTarget.getBoundingClientRect()
    const pointerMinutes = ((event.clientX - rect.left) / rect.width) * DAY_MINUTES
    const desired = Math.max(0, Math.min(snap(pointerMinutes - movePreview.offset), DAY_MINUTES - movePreview.duration))
    const start = nearestAvailable(desired, movePreview.duration, intervals(movePreview.itemId))
    if (start !== movePreview.start) setMovePreview({ ...movePreview, start })
  }

  function place(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setMovePreview(null)
    const itemId = Number(event.dataTransfer.getData('text/todo-item-id'))
    const sourceTask = todos.find((todo) => todo.todo_items.some((item) => item.id === itemId))
    const item = sourceTask?.todo_items.find((value) => value.id === itemId)
    if (!item || !sourceTask) return
    const rect = event.currentTarget.getBoundingClientRect()
    const duration = Math.min(item.worked_on_duration_minutes ?? 60, DAY_MINUTES)
    const dragOffset = Number(event.dataTransfer.getData('text/todo-drag-offset')) || 0
    const pointerMinutes = ((event.clientX - rect.left) / rect.width) * DAY_MINUTES
    const desired = Math.max(0, Math.min(snap(pointerMinutes - dragOffset), DAY_MINUTES - duration))
    const minutes = nearestAvailable(desired, duration, intervals(item.id))
    if (minutes === null) { onError(new Error('There is no free space on today’s timeline for this todo.')); return }
    void saveItem(sourceTask, item.id, { worked_on_start: dateTime(today, minutes), worked_on_duration_minutes: duration })
  }

  function resize(event: ReactPointerEvent<HTMLSpanElement>, task: Todo, item: TodoItem, edge: 'start' | 'end') {
    event.preventDefault(); event.stopPropagation()
    const track = event.currentTarget.closest('.workspace-time-track') as HTMLElement | null
    if (!track || !item.worked_on_start) return
    const originalStart = minutesOfDay(item.worked_on_start)
    const originalDuration = item.worked_on_duration_minutes ?? 60
    const occupied = intervals(item.id)
    const startX = event.clientX
    const move = (pointer: PointerEvent) => {
      const delta = snap(((pointer.clientX - startX) / track.getBoundingClientRect().width) * DAY_MINUTES)
      const [nextStart, nextDuration] = resizeValues(edge, originalStart, originalDuration, delta, occupied)
      setResizePreview({ itemId: item.id, start: nextStart, duration: nextDuration })
    }
    const stop = (pointer: PointerEvent) => {
      const delta = snap(((pointer.clientX - startX) / track.getBoundingClientRect().width) * DAY_MINUTES)
      const [nextStart, nextDuration] = resizeValues(edge, originalStart, originalDuration, delta, occupied)
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop)
      setResizePreview(null)
      void saveItem(task, item.id, { worked_on_start: dateTime(today, nextStart), worked_on_duration_minutes: nextDuration })
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop)
  }

  return <section className="workspace-planner">
    <header><div><p className="eyebrow">Today · worked-on time</p><h2>{new Intl.DateTimeFormat('en', { dateStyle: 'full' }).format(new Date())}</h2></div><small>Placement records work time only · estimates and task dates stay unchanged</small></header>
    <div className="workspace-planner-scroll">
      <div className="workspace-planner-grid">
        <div className="workspace-hours">{Array.from({ length: 25 }, (_, hour) => <span style={{ left: `${(hour / 24) * 100}%` }} key={hour}>{hour === 0 ? '12 AM' : hour === 12 ? '12 PM' : hour === 24 ? '12 AM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`}</span>)}</div>
        {picked.length === 0 ? <div className="workspace-planner-empty">Pick a task from the left sidebar to add it to today’s workspace.</div> : <div className="workspace-time-track workspace-shared-track" style={{ height: `${Math.max(72, scheduled.reduce((max, entry) => Math.max(max, entry.lane + 1), 1) * 51 + 18)}px` }} onDragOver={previewMove} onDrop={place}>
          {scheduled.map(({ todo, item, start, duration, lane }) => {
            const displayed = resizePreview?.itemId === item.id ? resizePreview : { start, duration }
            return <div className={`workspace-todo-block${resizePreview?.itemId === item.id ? ' resizing' : ''}`} draggable={!resizePreview} onDragStart={(event) => beginDrag(event, item.id, displayed.duration, true)} onDragEnd={endDrag} style={{ left: `${displayed.start / DAY_MINUTES * 100}%`, top: `${12 + lane * 51}px`, width: `${displayed.duration / DAY_MINUTES * 100}%` }} title={`#${todo.id} ${todo.title} · $${item.id} ${item.name} · worked on ${formatMinutes(displayed.duration)} · estimated ${formatMinutes(item.estimated_duration_minutes)}`} key={item.id}>
              <span className="resize-handle start" onPointerDown={(event) => resize(event, todo, item, 'start')} /><b>#{todo.id} · ${item.id}</b><span>{item.name}</span><small>{formatMinutes(displayed.duration)}</small><span className="resize-handle end" onPointerDown={(event) => resize(event, todo, item, 'end')} />
            </div>
          })}
          {resizePreview && <div className="workspace-live-tooltip" style={{ left: `${Math.min(100, (resizePreview.start + resizePreview.duration) / DAY_MINUTES * 100)}%`, top: `${Math.max(2, 12 + (scheduled.find(({ item }) => item.id === resizePreview.itemId)?.lane ?? 0) * 51 - 8)}px` }}>Worked: {formatMinutes(resizePreview.duration)}</div>}
          {movePreview?.start !== null && movePreview && <div className="workspace-live-tooltip moving" style={{ left: `${movePreview.start / DAY_MINUTES * 100}%` }}>Starts {formatTime(movePreview.start)}</div>}
        </div>}
      </div>
    </div>
    {pending.length > 0 && <section className="workspace-unscheduled"><h3>Todo items not worked on today</h3><div className="workspace-pending-rows">{pending.map(({ todo, items }) => <div className="workspace-pending-row" key={todo.id}><div className="workspace-pending-task"><b>#{todo.id}</b><strong>{todo.title}</strong><small>{items.length} pending</small></div><div className="workspace-pending-items">{items.map((item) => <div draggable onDragStart={(event) => beginDrag(event, item.id, item.worked_on_duration_minutes ?? 60)} onDragEnd={endDrag} key={item.id}><b>${item.id}</b><span>{item.name}</span><small>estimated {formatMinutes(item.estimated_duration_minutes)}</small></div>)}</div></div>)}</div></section>}
  </section>
}

function snap(value: number) { return Math.round(value / SNAP_MINUTES) * SNAP_MINUTES }
function localDateKey(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` }
function dateTime(date: string, minutes: number) { return `${date}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00` }
function minutesOfDay(value: string) { const date = new Date(value); return date.getHours() * 60 + date.getMinutes() }
function formatMinutes(value: number) { const hours = Math.floor(value / 60); const minutes = value % 60; return [hours && `${hours}h`, minutes && `${minutes}m`].filter(Boolean).join(' ') || '15m' }
function formatTime(minutes: number) { return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60)) }

type Interval = { start: number; end: number }
function overlaps(start: number, duration: number, occupied: Interval[]) { return occupied.some((interval) => start < interval.end && start + duration > interval.start) }
function nearestAvailable(desired: number, duration: number, occupied: Interval[]) {
  for (let distance = 0; distance <= DAY_MINUTES; distance += SNAP_MINUTES) {
    const candidates = distance === 0 ? [desired] : [desired + distance, desired - distance]
    for (const start of candidates) if (start >= 0 && start + duration <= DAY_MINUTES && !overlaps(start, duration, occupied)) return start
  }
  return null
}
function resizeValues(edge: 'start' | 'end', start: number, duration: number, delta: number, occupied: Interval[]): [number, number] {
  const end = start + duration
  if (edge === 'start') {
    const previousEnd = occupied.filter((interval) => interval.end <= end).reduce((latest, interval) => Math.max(latest, interval.end), 0)
    const nextStart = Math.max(previousEnd, Math.min(start + delta, end - SNAP_MINUTES))
    return [nextStart, end - nextStart]
  }
  const nextStart = occupied.filter((interval) => interval.start >= start).reduce((earliest, interval) => Math.min(earliest, interval.start), DAY_MINUTES)
  const nextEnd = Math.min(nextStart, Math.max(start + SNAP_MINUTES, end + delta))
  return [start, nextEnd - start]
}
function assignLanes<T extends { start: number; duration: number }>(entries: T[]) {
  const laneEnds: number[] = []
  return [...entries].sort((a, b) => a.start - b.start).map((entry) => {
    let lane = laneEnds.findIndex((end) => end <= entry.start)
    if (lane < 0) lane = laneEnds.length
    laneEnds[lane] = entry.start + entry.duration
    return { ...entry, lane }
  })
}
