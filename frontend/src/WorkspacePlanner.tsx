import { type DragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { api, type Todo, type TodoItem, type TodoItemInput } from './api'

type Props = { todos: Todo[]; onTaskUpdated: (todo: Todo) => void; onError: (reason: unknown) => void }
const DAY_MINUTES = 1440
const SNAP_MINUTES = 15

export default function WorkspacePlanner({ todos, onTaskUpdated, onError }: Props) {
  const picked = todos.filter((todo) => todo.is_picked)
  const today = localDateKey(new Date())
  const unscheduled = picked.flatMap((todo) => todo.todo_items.filter((item) => item.worked_on_start?.slice(0, 10) !== today).map((item) => ({ todo, item })))

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

  function place(event: DragEvent<HTMLDivElement>, task: Todo) {
    event.preventDefault()
    const itemId = Number(event.dataTransfer.getData('text/todo-item-id'))
    const sourceTask = todos.find((todo) => todo.todo_items.some((item) => item.id === itemId))
    const item = sourceTask?.todo_items.find((value) => value.id === itemId)
    if (!item || sourceTask?.id !== task.id) return
    const rect = event.currentTarget.getBoundingClientRect()
    const minutes = snap(((event.clientX - rect.left) / rect.width) * DAY_MINUTES)
    const duration = item.worked_on_duration_minutes ?? 60
    void saveItem(task, item.id, { worked_on_start: dateTime(today, Math.min(minutes, DAY_MINUTES - duration)), worked_on_duration_minutes: duration })
  }

  function resize(event: ReactPointerEvent<HTMLSpanElement>, task: Todo, item: TodoItem, edge: 'start' | 'end') {
    event.preventDefault(); event.stopPropagation()
    const track = event.currentTarget.closest('.workspace-time-track') as HTMLElement | null
    if (!track || !item.worked_on_start) return
    const originalStart = minutesOfDay(item.worked_on_start)
    const originalDuration = item.worked_on_duration_minutes ?? 60
    const startX = event.clientX
    const move = (pointer: PointerEvent) => {
      const delta = snap(((pointer.clientX - startX) / track.getBoundingClientRect().width) * DAY_MINUTES)
      const nextStart = edge === 'start' ? Math.max(0, Math.min(originalStart + delta, originalStart + originalDuration - SNAP_MINUTES)) : originalStart
      const nextDuration = edge === 'start' ? originalDuration + originalStart - nextStart : Math.max(SNAP_MINUTES, Math.min(DAY_MINUTES - originalStart, originalDuration + delta))
      track.style.setProperty('--preview-start', String(nextStart))
      track.style.setProperty('--preview-duration', String(nextDuration))
    }
    const stop = (pointer: PointerEvent) => {
      const delta = snap(((pointer.clientX - startX) / track.getBoundingClientRect().width) * DAY_MINUTES)
      const nextStart = edge === 'start' ? Math.max(0, Math.min(originalStart + delta, originalStart + originalDuration - SNAP_MINUTES)) : originalStart
      const nextDuration = edge === 'start' ? originalDuration + originalStart - nextStart : Math.max(SNAP_MINUTES, Math.min(DAY_MINUTES - originalStart, originalDuration + delta))
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop)
      void saveItem(task, item.id, { worked_on_start: dateTime(today, nextStart), worked_on_duration_minutes: nextDuration })
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop)
  }

  return <section className="workspace-planner">
    <header><div><p className="eyebrow">Today · worked-on time</p><h2>{new Intl.DateTimeFormat('en', { dateStyle: 'full' }).format(new Date())}</h2></div><small>Placement records work time only · estimates and task dates stay unchanged</small></header>
    <div className="workspace-planner-scroll">
      <div className="workspace-planner-grid">
        <div className="workspace-hours">{Array.from({ length: 25 }, (_, hour) => <span style={{ left: `${(hour / 24) * 100}%` }} key={hour}>{hour === 0 ? '12 AM' : hour === 12 ? '12 PM' : hour === 24 ? '12 AM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`}</span>)}</div>
        {picked.length === 0 ? <div className="workspace-planner-empty">Pick a task from the left sidebar to add it to today’s workspace.</div> : picked.map((task) => <div className="workspace-task-row" key={task.id}>
          <div className="workspace-task-label"><b>#{task.id}</b><strong>{task.title}</strong><small>{task.todo_items.length} todo items</small></div>
          <div className="workspace-time-track" onDragOver={(event) => event.preventDefault()} onDrop={(event) => place(event, task)}>
            {task.todo_items.filter((item) => item.worked_on_start?.slice(0, 10) === today).map((item) => {
              const start = minutesOfDay(item.worked_on_start!)
              const duration = item.worked_on_duration_minutes ?? 60
              return <div className="workspace-todo-block" draggable onDragStart={(event) => { event.dataTransfer.setData('text/todo-item-id', String(item.id)); event.dataTransfer.effectAllowed = 'move' }} style={{ left: `${start / DAY_MINUTES * 100}%`, width: `${duration / DAY_MINUTES * 100}%` }} title={`$${item.id} ${item.name} · worked on ${formatMinutes(duration)} · estimated ${formatMinutes(item.estimated_duration_minutes)}`} key={item.id}>
                <span className="resize-handle start" onPointerDown={(event) => resize(event, task, item, 'start')} /><b>${item.id}</b><span>{item.name}</span><small>{formatMinutes(duration)}</small><span className="resize-handle end" onPointerDown={(event) => resize(event, task, item, 'end')} />
              </div>
            })}
          </div>
        </div>)}
      </div>
    </div>
    {unscheduled.length > 0 && <section className="workspace-unscheduled"><h3>Todo items not worked on today</h3><div>{unscheduled.map(({ todo, item }) => <div draggable onDragStart={(event) => { event.dataTransfer.setData('text/todo-item-id', String(item.id)); event.dataTransfer.effectAllowed = 'move' }} key={item.id}><b>${item.id}</b><span>{item.name}</span><small>#{todo.id} · estimated {formatMinutes(item.estimated_duration_minutes)}</small></div>)}</div></section>}
  </section>
}

function snap(value: number) { return Math.round(value / SNAP_MINUTES) * SNAP_MINUTES }
function localDateKey(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` }
function dateTime(date: string, minutes: number) { return `${date}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00` }
function minutesOfDay(value: string) { const date = new Date(value); return date.getHours() * 60 + date.getMinutes() }
function formatMinutes(value: number) { const hours = Math.floor(value / 60); const minutes = value % 60; return [hours && `${hours}h`, minutes && `${minutes}m`].filter(Boolean).join(' ') || '15m' }
