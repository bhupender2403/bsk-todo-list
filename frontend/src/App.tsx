import { FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { api, getTodoStatus, type TaskAnalysis, type TaskAnalysisConfig, type Todo } from './api'
import TaskDag from './TaskDag'

type Filter = 'all' | 'active' | 'completed'
type ChatMessage = { id: number; role: 'user' | 'assistant'; text: string; taskNumber?: number; source?: string }
type DetectedTask = { number: number; sourceText: string; answers: Record<string, string>; analysis: TaskAnalysis }

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [types, setTypes] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [selectedType, setSelectedType] = useState('General')
  const [newType, setNewType] = useState('')
  const [creatingType, setCreatingType] = useState(false)
  const [parentName, setParentName] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [durationDays, setDurationDays] = useState('')
  const [durationHours, setDurationHours] = useState('')
  const [dependencyQuery, setDependencyQuery] = useState('')
  const [dependencyIds, setDependencyIds] = useState<number[]>([])
  const [chatOpen, setChatOpen] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [detectedTasks, setDetectedTasks] = useState<DetectedTask[]>([])
  const [activeTaskNumber, setActiveTaskNumber] = useState<number | null>(null)
  const [taskAnalysisConfig, setTaskAnalysisConfig] = useState<TaskAnalysisConfig | null>(null)
  const [sourceTaskNumber, setSourceTaskNumber] = useState<number | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [detailPosition, setDetailPosition] = useState({ x: 360, y: 120 })
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const dragOffset = useRef({ x: 0, y: 0 })
  const startTimeInput = useRef<HTMLInputElement>(null)
  const detailStartTimeInput = useRef<HTMLInputElement>(null)
  const chatInputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    Promise.all([api.list(), api.listTypes(), api.taskAnalysisConfig()])
      .then(([items, todoTypes, analysisConfig]) => {
        setTodos(items)
        setTypes(todoTypes.map((item) => item.name))
        setTaskAnalysisConfig(analysisConfig)
        setSelectedId(items[0]?.id ?? null)
      })
      .catch(showError)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setAddModalOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [])

  const visibleTodos = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    return todos.filter((todo) => {
      const status = getTodoStatus(todo)
      const matchesStatus = filter === 'all' || (filter === 'completed' ? status === 'completed' : status !== 'completed')
      return matchesStatus && `${todo.title} ${todo.description}`.toLocaleLowerCase().includes(search)
    })
  }, [todos, filter, query])

  const dashboardTodos = useMemo(() => {
    const byId = new Map(todos.map((todo) => [todo.id, todo]))
    const related = new Map(todos.map((todo) => [todo.id, new Set<number>()]))
    for (const todo of todos) {
      const linked = [todo.parent_id, ...todo.dependency_ids].filter((id): id is number => id !== null && byId.has(id))
      for (const id of linked) {
        related.get(todo.id)?.add(id)
        related.get(id)?.add(todo.id)
      }
    }
    const included = new Set(todos.filter((todo) => ['scheduled', 'running'].includes(getTodoStatus(todo))).map((todo) => todo.id))
    const queue = [...included]
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const id of related.get(queue[cursor]) ?? []) {
        if (!included.has(id)) {
          included.add(id)
          queue.push(id)
        }
      }
    }
    return todos.filter((todo) => included.has(todo.id))
  }, [todos])

  const readyDetectedTasks = useMemo(
    () => detectedTasks.filter((task) => task.analysis.clarification_questions.length === 0),
    [detectedTasks],
  )

  const taskReferenceQuery = chatInput.match(/(?:^|\s)#(\d*)$/)?.[1] ?? null
  const taskReferenceMatches = useMemo(() => {
    if (taskReferenceQuery === null) return []
    return todos.filter((todo) => String(todo.id).includes(taskReferenceQuery)).slice(0, 8)
  }, [todos, taskReferenceQuery])

  const selectedTodo = todos.find((todo) => todo.id === selectedId) ?? null
  const statusCounts = useMemo(() => todos.reduce(
    (counts, todo) => ({ ...counts, [getTodoStatus(todo)]: counts[getTodoStatus(todo)] + 1 }),
    { pending: 0, scheduled: 0, running: 0, completed: 0 },
  ), [todos])

  function showError(reason: unknown) {
    setError(reason instanceof Error ? reason.message : 'Something went wrong')
  }

  async function sendChatMessage(event: FormEvent) {
    event.preventDefault()
    const text = chatInput.trim()
    if (!text) return
    if (/^(?:hi|hello|hey|hi there|hello there)[!. ]*$/i.test(text)) {
      const messageId = Date.now()
      setChatInput('')
      setChatMessages((current) => [
        ...current,
        { id: messageId, role: 'user', text },
        { id: messageId + 1, role: 'assistant', text: 'Hello! Describe a task you want to create, and I’ll help fill in its details.' },
      ])
      return
    }
    if (activeTaskNumber === null) {
      const messageId = Date.now()
      setAnalyzing(true)
      setError('')
      try {
        const result = await api.runTaskCommand(text)
        if (result.handled && result.todo && result.message) {
          setChatInput('')
          setChatMessages((current) => [
            ...current,
            { id: messageId, role: 'user', text },
            { id: messageId + 1, role: 'assistant', text: result.message!, source: result.source },
          ])
          setTodos((current) => current.map((todo) => todo.id === result.todo!.id ? result.todo! : todo))
          return
        }
      } catch (reason) {
        showError(reason)
        return
      } finally {
        setAnalyzing(false)
      }
    }
    setAnalyzing(true)
    setError('')
    setChatInput('')
    try {
      const active = detectedTasks.find((task) => task.number === activeTaskNumber)
      const unanswered = active?.analysis.clarification_questions.find((question) => !active.answers[question])
      const taskNumber = active && unanswered ? active.number : Math.max(0, ...detectedTasks.map((task) => task.number)) + 1
      const sourceText = active && unanswered ? active.sourceText : text
      const answers = active && unanswered ? { ...active.answers, [unanswered]: text } : {}
      setChatMessages((current) => [...current, { id: Date.now(), role: 'user', text, taskNumber }])
      const result = await api.analyzeTask(sourceText, answers)
      const updated = { number: taskNumber, sourceText, answers, analysis: result }
      setDetectedTasks((current) => [...current.filter((task) => task.number !== taskNumber), updated].sort((a, b) => a.number - b.number))
      setActiveTaskNumber(result.clarification_questions.length ? taskNumber : null)
      const question = result.clarification_questions.find((item) => !answers[item])
      setChatMessages((current) => [...current, {
        id: Date.now() + 1,
        role: 'assistant',
        taskNumber,
        text: question ?? `Task ${taskNumber} is ready. Select its highlighted icon to review and create it.`,
      }])
    } catch (reason) {
      showError(reason)
    } finally {
      setAnalyzing(false)
    }
  }

  function openDetectedTask(task: DetectedTask) {
    const suggestion = task.analysis.suggestion
    setError('')
    setEditingId(null)
    setSourceTaskNumber(task.number)
    setTitle(suggestion.title)
    setDescription(suggestion.description)
    setSelectedType(suggestion.todo_type)
    setCreatingType(false)
    setNewType('')
    setParentName(suggestion.parent_name ?? '')
    setStartTime(suggestion.start_date ?? '')
    setEndTime('')
    setDurationDays(suggestion.expected_duration_days ? String(suggestion.expected_duration_days) : '')
    setDurationHours(suggestion.expected_duration_hours ? String(suggestion.expected_duration_hours) : '')
    setDependencyQuery('')
    setDependencyIds(suggestion.dependency_names.flatMap((name) => {
      const match = todos.find((todo) => todo.title.toLocaleLowerCase() === name.toLocaleLowerCase())
      return match ? [match.id] : []
    }))
    setAddModalOpen(true)
  }

  function insertTaskReference(todo: Todo) {
    setChatInput((current) => current.replace(/#\d*$/, `#${todo.id} ${todo.title}`))
    requestAnimationFrame(() => chatInputRef.current?.focus())
  }

  function clearChat() {
    setChatMessages([])
    setDetectedTasks([])
    setActiveTaskNumber(null)
    setChatInput('')
    setError('')
  }

  async function addTodo(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    setError('')
    try {
      let typeName = selectedType
      if (creatingType) {
        typeName = newType
      }
      const parent = parentName.trim()
        ? todos.find((item) => item.title.toLocaleLowerCase() === parentName.trim().toLocaleLowerCase())
        : null
      if (parentName.trim() && !parent) throw new Error('Select a valid parent task by name')
      const minutes = (Number(durationDays) || 0) * 1440 + (Number(durationHours) || 0) * 60
      const input = {
        title,
        description,
        todo_type: typeName,
        parent_id: parent?.id ?? null,
        start_time: startTime ? `${startTime}T00:00:00` : null,
        end_time: endTime || null,
        expected_duration_minutes: minutes || null,
        dependency_ids: dependencyIds,
        is_running: editingId === null ? false : (todos.find((item) => item.id === editingId)?.is_running ?? false),
      }
      const todo = editingId === null
        ? await api.create(input)
        : await api.update(editingId, input)
      if (creatingType) {
        typeName = todo.todo_type
        setTypes((current) => current.includes(typeName) ? current : [...current, typeName].sort((a, b) => a.localeCompare(b)))
        setSelectedType(typeName)
      }
      setTodos((current) => editingId === null
        ? [todo, ...current]
        : current.map((item) => item.id === todo.id ? todo : item))
      setSelectedId(todo.id)
      setTitle('')
      setDescription('')
      setQuery('')
      setFilter('all')
      setAddModalOpen(false)
      setCreatingType(false)
      setNewType('')
      setParentName('')
      setStartTime('')
      setEndTime('')
      setDurationDays('')
      setDurationHours('')
      setDependencyQuery('')
      setDependencyIds([])
      setEditingId(null)
      if (sourceTaskNumber !== null) {
        setDetectedTasks((current) => current.filter((task) => task.number !== sourceTaskNumber))
        setSourceTaskNumber(null)
      }
    } catch (reason) {
      showError(reason)
    }
  }

  function openAddModal() {
    setError('')
    setEditingId(null)
    setTitle('')
    setDescription('')
    setSelectedType(types[0] ?? 'General')
    setCreatingType(false)
    setNewType('')
    setParentName('')
    setStartTime('')
    setEndTime('')
    setDurationDays('')
    setDurationHours('')
    setDependencyQuery('')
    setDependencyIds([])
    setSourceTaskNumber(null)
    setAddModalOpen(true)
  }

  function openEditModal(todo: Todo) {
    const duration = todo.expected_duration_minutes ?? 0
    setError('')
    setSourceTaskNumber(null)
    setEditingId(todo.id)
    setTitle(todo.title)
    setDescription(todo.description)
    setSelectedType(todo.todo_type)
    setCreatingType(false)
    setNewType('')
    setParentName(todo.parent_id ? taskName(todo.parent_id) : '')
    setStartTime(todo.start_time?.slice(0, 10) ?? '')
    setEndTime(todo.end_time?.slice(0, 16) ?? '')
    setDurationDays(duration ? String(Math.floor(duration / 1440)) : '')
    setDurationHours(duration ? String(Math.floor((duration % 1440) / 60)) : '')
    setDependencyQuery('')
    setDependencyIds(todo.dependency_ids)
    setDetailModalOpen(false)
    setAddModalOpen(true)
  }

  function openTaskDetail(id: number) {
    setSelectedId(id)
    setDetailPosition({
      x: Math.max(20, (window.innerWidth - 620) / 2),
      y: Math.max(20, (window.innerHeight - 570) / 2),
    })
    setDetailModalOpen(true)
  }

  function startDragging(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button')) return
    dragOffset.current = { x: event.clientX - detailPosition.x, y: event.clientY - detailPosition.y }
    function move(pointerEvent: PointerEvent) {
      setDetailPosition({
        x: Math.max(8, Math.min(window.innerWidth - 160, pointerEvent.clientX - dragOffset.current.x)),
        y: Math.max(8, Math.min(window.innerHeight - 70, pointerEvent.clientY - dragOffset.current.y)),
      })
    }
    function stop() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  async function updateTodo(todo: Todo, changes: Partial<Pick<Todo, 'title' | 'description' | 'todo_type' | 'completed' | 'is_running' | 'parent_id' | 'start_time' | 'end_time' | 'expected_duration_minutes' | 'dependency_ids'>>) {
    try {
      const updated = await api.update(todo.id, changes)
      setTodos((current) => current.map((item) => (item.id === todo.id ? updated : item)))
    } catch (reason) {
      showError(reason)
    }
  }

  function addDependencyByName() {
    const dependency = todos.find((item) => item.title.toLocaleLowerCase() === dependencyQuery.trim().toLocaleLowerCase())
    if (!dependency) {
      setError('Select a valid dependency by name')
      return
    }
    setDependencyIds((current) => current.includes(dependency.id) ? current : [...current, dependency.id])
    setDependencyQuery('')
    setError('')
  }

  function taskName(id: number | null) {
    if (id === null) return 'None'
    return todos.find((item) => item.id === id)?.title ?? `Task #${id}`
  }

  function formatDateTime(value: string | null) {
    return value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not set'
  }

  function formatDate(value: string | null) {
    return value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) : 'Not set'
  }

  function formatDuration(minutes: number | null) {
    if (!minutes) return 'Not set'
    const days = Math.floor(minutes / 1440)
    const hours = Math.floor((minutes % 1440) / 60)
    return [days && `${days}d`, hours && `${hours}h`].filter(Boolean).join(' ') || `${minutes}m`
  }

  function advanceTask(todo: Todo) {
    const status = getTodoStatus(todo)
    if (status === 'completed') {
      updateTodo(todo, { end_time: null, completed: false, is_running: false })
    } else if (status === 'running') {
      updateTodo(todo, { end_time: new Date().toISOString(), completed: true, is_running: false })
    } else {
      updateTodo(todo, { is_running: true })
    }
  }

  async function deleteTodo(todo: Todo) {
    try {
      await api.remove(todo.id)
      const remainingTodos = todos.filter((item) => item.id !== todo.id)
      setTodos(remainingTodos)
      setSelectedId(remainingTodos[0]?.id ?? null)
      setDetailModalOpen(false)
    } catch (reason) {
      showError(reason)
    }
  }

  return (
    <main>
      <section className={`app-shell ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
        <aside className="sidebar">
          <div className="sidebar-heading">
            <div>
              <p className="eyebrow">My workspace</p>
              <h2>Tasks</h2>
            </div>
            <span>{todos.length}</span>
          </div>

          <label className="search">
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks…" aria-label="Search tasks" />
            {query && <button onClick={() => setQuery('')} aria-label="Clear search">×</button>}
          </label>

          <nav aria-label="Task filters">
            {(['all', 'active', 'completed'] as Filter[]).map((name) => (
              <button className={filter === name ? 'active' : ''} onClick={() => setFilter(name)} key={name}>{name}</button>
            ))}
          </nav>

          <div className="task-cards" aria-live="polite">
            {loading ? <p className="sidebar-empty">Loading…</p> : visibleTodos.length === 0 ? (
              <p className="sidebar-empty">No matching tasks.</p>
            ) : visibleTodos.map((todo) => (
              <button className={`task-card ${selectedId === todo.id ? 'selected' : ''} ${getTodoStatus(todo) === 'completed' ? 'completed' : ''}`} onClick={() => setSelectedId(todo.id)} onDoubleClick={() => openTaskDetail(todo.id)} key={todo.id}>
                <span className="card-copy">
                  <strong>{todo.title}</strong>
                  <small>#{todo.id} · {todo.todo_type} · {getTodoStatus(todo)}</small>
                </span>
                {todo.completed && <span className="card-check">✓</span>}
              </button>
            ))}
          </div>
        </aside>

        <section className="workspace">
          <header>
            <div>
              <p className="eyebrow">My life workspace</p>
              <h1>Task dependencies</h1>
              <p className="subtitle">See how your work connects.</p>
            </div>
            <div className="header-actions">
              <button className="sidebar-toggle" onClick={() => setSidebarOpen((current) => !current)} aria-expanded={sidebarOpen}>
                <span aria-hidden="true">☰</span> {sidebarOpen ? 'Hide tasks' : 'Show tasks'}
              </button>
              <button className="header-add-task" onClick={openAddModal}><span aria-hidden="true">＋</span> Add task</button>
              <button className="chat-toggle" onClick={() => setChatOpen((current) => !current)} aria-expanded={chatOpen}>
                <span aria-hidden="true">◌</span> Chat
              </button>
              <div className="status-counters" aria-label="Task status counts">
                {(['pending', 'scheduled', 'running', 'completed'] as const).map((status) => (
                  <div className={`status-count status-${status}`} key={status}>
                    <strong>{statusCounts[status]}</strong><span>{status}</span>
                  </div>
                ))}
              </div>
            </div>
          </header>

          {error && <p className="error" role="alert">{error}</p>}

          <TaskDag todos={dashboardTodos} selectedId={selectedId} onSelect={setSelectedId} onOpen={openTaskDetail} />
        </section>
      </section>

      {detailModalOpen && selectedTodo && (
        <section className="task-floating-modal" style={{ left: detailPosition.x, top: detailPosition.y }} role="dialog" aria-modal="false" aria-labelledby="floating-task-title">
          <div className="task-modal-handle" onPointerDown={startDragging}>
            <span>Task #{selectedTodo.id} · {getTodoStatus(selectedTodo)}</span>
            <button onClick={() => setDetailModalOpen(false)} aria-label="Close task details">×</button>
          </div>
          <article className={`task-detail ${getTodoStatus(selectedTodo) === 'completed' ? 'completed' : ''}`}>
            <h2 id="floating-task-title">{selectedTodo.title}</h2>
            <p className="created-date">Created {new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(selectedTodo.created_at))}</p>
            <p className={selectedTodo.description ? 'task-description' : 'task-description empty'}>{selectedTodo.description || 'No description added.'}</p>
            <div className="detail-fields">
              <label>Type<select value={selectedTodo.todo_type} onChange={(event) => updateTodo(selectedTodo, { todo_type: event.target.value })}>{types.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
              <div><span>Parent</span><strong>{taskName(selectedTodo.parent_id)}</strong></div>
              <label>Start date
                <div className="date-time-control detail-date-time">
                  <input ref={detailStartTimeInput} type="date" value={selectedTodo.start_time?.slice(0, 10) ?? ''} title={formatDate(selectedTodo.start_time)} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => updateTodo(selectedTodo, { start_time: event.target.value ? `${event.target.value}T00:00:00` : null })} />
                  <button type="button" onClick={() => detailStartTimeInput.current?.showPicker?.()} aria-label="Open task start date picker">▣</button>
                </div>
              </label>
              <div><span>Ends</span><strong>{formatDateTime(selectedTodo.end_time)}</strong></div>
              <div><span>Expected duration</span><strong>{formatDuration(selectedTodo.expected_duration_minutes)}</strong></div>
              <div className="dependency-summary"><span>Dependencies</span><strong>{selectedTodo.dependency_ids.length ? selectedTodo.dependency_ids.map(taskName).join(', ') : 'None'}</strong></div>
            </div>
            <div className="detail-actions">
              <button className="primary" onClick={() => advanceTask(selectedTodo)}>{getTodoStatus(selectedTodo) === 'completed' ? 'Reopen task' : getTodoStatus(selectedTodo) === 'running' ? 'Finish work' : 'Start work'}</button>
              <button onClick={() => openEditModal(selectedTodo)}>Edit details</button>
              <button className="danger" onClick={() => deleteTodo(selectedTodo)}>Delete</button>
            </div>
          </article>
        </section>
      )}

      {addModalOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setAddModalOpen(false)
        }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="add-task-title">
            <div className="modal-heading">
              <div><p className="eyebrow">{editingId === null ? 'New task' : `Task #${editingId}`}</p><h2 id="add-task-title">{editingId === null ? 'Add a task' : 'Edit task'}</h2></div>
              <button onClick={() => setAddModalOpen(false)} aria-label="Close add task modal">×</button>
            </div>
            <form onSubmit={addTodo}>
              {error && <p className="error" role="alert">{error}</p>}
              <label>What do you want to accomplish?
                <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add something meaningful…" maxLength={200} />
              </label>
              <label>Description <small>Optional — add context, notes, or acceptance criteria</small>
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe this task…" maxLength={5000} rows={4} />
              </label>
              <label>Type
                <div className="type-control">
                  {creatingType ? (
                    <input value={newType} onChange={(event) => setNewType(event.target.value)} placeholder="Enter a new type…" maxLength={60} />
                  ) : (
                    <select value={selectedType} onChange={(event) => setSelectedType(event.target.value)}>
                      {types.map((item) => <option value={item} key={item}>{item}</option>)}
                    </select>
                  )}
                  <button type="button" onClick={() => { setCreatingType((current) => !current); setNewType('') }}>
                    {creatingType ? 'Use existing' : '+ New type'}
                  </button>
                </div>
              </label>
              <label>Parent task <small>Optional — search by exact name</small>
                <input list="parent-tasks" value={parentName} onChange={(event) => setParentName(event.target.value)} placeholder="None" />
                <datalist id="parent-tasks">{todos.filter((item) => item.id !== editingId).map((item) => <option value={item.title} key={item.id}>#{item.id}</option>)}</datalist>
              </label>
              <div className="form-row">
                <label>Start date
                  <div className="date-time-control">
                    <input ref={startTimeInput} type="date" value={startTime} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => setStartTime(event.target.value)} />
                    <button type="button" onClick={() => startTimeInput.current?.showPicker?.()} aria-label="Open start date picker">▣</button>
                  </div>
                </label>
                <label>End time<input type="datetime-local" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>
              </div>
              <label>Expected duration
                <div className="duration-control">
                  <span><input type="number" min="0" value={durationDays} onChange={(event) => setDurationDays(event.target.value)} placeholder="0" /> days</span>
                  <span><input type="number" min="0" value={durationHours} onChange={(event) => setDurationHours(event.target.value)} placeholder="0" /> hours</span>
                </div>
              </label>
              <label>Dependencies <small>Search and add any tasks that must come first</small>
                <div className="dependency-control">
                  <input list="dependency-tasks" value={dependencyQuery} onChange={(event) => setDependencyQuery(event.target.value)} placeholder="Search task name…" />
                  <datalist id="dependency-tasks">{todos.filter((item) => item.id !== editingId && !dependencyIds.includes(item.id)).map((item) => <option value={item.title} key={item.id}>#{item.id}</option>)}</datalist>
                  <button type="button" onClick={addDependencyByName} disabled={!dependencyQuery.trim()}>Add</button>
                </div>
                {dependencyIds.length > 0 && <div className="dependency-chips">{dependencyIds.map((id) => <button type="button" onClick={() => setDependencyIds((current) => current.filter((item) => item !== id))} key={id}>{taskName(id)} ×</button>)}</div>}
              </label>
              <div className="modal-actions">
                <button type="button" onClick={() => setAddModalOpen(false)}>Cancel</button>
                <button className="primary" type="submit" disabled={!title.trim() || (creatingType && !newType.trim())}>{editingId === null ? 'Add task' : 'Save changes'}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {chatOpen && <aside className="chat-drawer" aria-label="Task detection chat">
        <div className="chat-heading">
          <div><p className="eyebrow">Task assistant</p><h2>Chat</h2>
            <span className={`assistant-config ${taskAnalysisConfig?.openai_configured ? 'configured' : 'local'}`}>
              {taskAnalysisConfig?.openai_configured ? `OpenAI · ${taskAnalysisConfig.model}` : 'Local detector'}
            </span>
          </div>
          <div className="chat-heading-actions">
            <button className="close-chat" onClick={() => setChatOpen(false)} aria-label="Close chat">×</button>
          </div>
        </div>
        <div className="chat-messages" aria-live="polite">
          {chatMessages.length === 0 && <div className="chat-empty"><span>✦</span><p>Describe something you need to do. I’ll detect the task and ask for any missing details.</p></div>}
          {chatMessages.map((message) => {
            const detectedTask = message.taskNumber ? detectedTasks.find((item) => item.number === message.taskNumber) : undefined
            const latestReply = message.taskNumber
              ? [...chatMessages].reverse().find((item) => item.role === 'assistant' && item.taskNumber === message.taskNumber)
              : undefined
            const task = message.role === 'assistant' && message.id === latestReply?.id && message.taskNumber
              ? readyDetectedTasks.find((item) => item.number === message.taskNumber)
              : undefined
            return <div className={`chat-message ${message.role}`} key={message.id}>
              <div className="chat-message-content">
                <p>{message.text}</p>
                {message.role === 'assistant' && detectedTask && <small className="analysis-source">
                  {detectedTask.analysis.analysis_source === 'local' ? 'Local detector' : `OpenAI · ${detectedTask.analysis.analysis_source}`}
                </small>}
                {message.role === 'assistant' && message.source && <small className="analysis-source">
                  Tool call · {message.source === 'local' ? 'Local fallback' : `OpenAI · ${message.source}`}
                </small>}
              </div>
              {task && <button className="inline-task-marker" onClick={() => openDetectedTask(task)} title={`Review task ${task.number}`}>
                <span>＋</span><b>{task.number}</b>
              </button>}
            </div>
          })}
          {analyzing && <div className="chat-message assistant"><p>Detecting task details…</p></div>}
        </div>
        <form className="chat-composer" onSubmit={sendChatMessage}>
          {taskReferenceQuery !== null && <div className="task-reference-tooltip" role="listbox" aria-label="Task references">
            {taskReferenceMatches.length > 0 ? taskReferenceMatches.map((todo) => <button type="button" role="option" onClick={() => insertTaskReference(todo)} key={todo.id}>
              <b>#{todo.id}</b><span>{todo.title}</span>
            </button>) : <p>No task number matches #{taskReferenceQuery}</p>}
          </div>}
          {activeTaskNumber && <small>Answering about task <b>{activeTaskNumber}</b></small>}
          <div className="chat-composer-toolbar">
            <button className="clear-chat" type="button" onClick={clearChat} disabled={chatMessages.length === 0 && !chatInput} aria-label="Clear chat">Clear chat</button>
          </div>
          <div className="chat-composer-row">
            <textarea
              ref={chatInputRef}
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
              placeholder={activeTaskNumber ? `Add information for task ${activeTaskNumber}…` : 'Describe a task…'}
              rows={2}
            />
            <button className="send-chat" type="submit" disabled={analyzing || !chatInput.trim()} aria-label="Send message">↑</button>
          </div>
        </form>
      </aside>}
    </main>
  )
}
