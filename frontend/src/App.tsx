import { FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { api, getTodoStatus, type Aim, type Sprint, type TaskAnalysis, type TaskAnalysisConfig, type Todo, type TodoItemInput } from './api'
import TaskDag from './TaskDag'

type Filter = 'all' | 'active' | 'completed'
type ChatMessage = { id: number; role: 'user' | 'assistant'; text: string; taskNumber?: number; source?: string; aimDraft?: { name: string; description: string } }
type DetectedTask = { number: number; sourceText: string; answers: Record<string, string>; analysis: TaskAnalysis }
type ContextTaskDraft = {
  title: string; description: string; sprint_id: number | null; aim_id: number | null
  start_time: string | null; end_time: string | null; expected_duration_minutes: number | null
  dependency_ids: number[]; is_running: boolean; todo_items: TodoItemInput[]
}

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [taskSprintId, setTaskSprintId] = useState('')
  const [taskAimId, setTaskAimId] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [durationDays, setDurationDays] = useState('')
  const [durationHours, setDurationHours] = useState('')
  const [dependencyQuery, setDependencyQuery] = useState('')
  const [dependencyIds, setDependencyIds] = useState<number[]>([])
  const [taskItems, setTaskItems] = useState<TodoItemInput[]>([])
  const [todoItemName, setTodoItemName] = useState('')
  const [todoItemHours, setTodoItemHours] = useState('')
  const [chatOpen, setChatOpen] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [detectedTasks, setDetectedTasks] = useState<DetectedTask[]>([])
  const [activeTaskNumber, setActiveTaskNumber] = useState<number | null>(null)
  const [taskAnalysisConfig, setTaskAnalysisConfig] = useState<TaskAnalysisConfig | null>(null)
  const [sprints, setSprints] = useState<Sprint[]>([])
  const [aims, setAims] = useState<Aim[]>([])
  const [sprintName, setSprintName] = useState('')
  const [sprintEndDate, setSprintEndDate] = useState('')
  const [sprintModalOpen, setSprintModalOpen] = useState(false)
  const [aimModalOpen, setAimModalOpen] = useState(false)
  const [aimName, setAimName] = useState('')
  const [aimDescription, setAimDescription] = useState('')
  const [pendingAimName, setPendingAimName] = useState(false)
  const [dashboardMode, setDashboardMode] = useState<'tasks' | 'aims'>('tasks')
  const [loadedAimId, setLoadedAimId] = useState<number | null>(null)
  const [loadedTaskId, setLoadedTaskId] = useState<number | null>(null)
  const [contextAimDraft, setContextAimDraft] = useState<{ name: string; description: string } | null>(null)
  const [contextTaskDraft, setContextTaskDraft] = useState<ContextTaskDraft | null>(null)
  const [selectedSprintId, setSelectedSprintId] = useState<number | null>(null)
  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null)
  const [sprintDropActive, setSprintDropActive] = useState(false)
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
    Promise.all([api.list(), api.taskAnalysisConfig(), api.listSprints(), api.listAims()])
      .then(([items, analysisConfig, sprintItems, aimItems]) => {
        setTodos(items)
        setTaskAnalysisConfig(analysisConfig)
        setSprints(sprintItems)
        setAims(aimItems)
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
    if (selectedSprintId !== null) return todos.filter((todo) => todo.sprint_id === selectedSprintId)
    const byId = new Map(todos.map((todo) => [todo.id, todo]))
    const related = new Map(todos.map((todo) => [todo.id, new Set<number>()]))
    for (const todo of todos) {
      const linked = todo.dependency_ids.filter((id) => byId.has(id))
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
  }, [todos, selectedSprintId])

  const selectedSprint = sprints.find((sprint) => sprint.id === selectedSprintId) ?? null

  const readyDetectedTasks = useMemo(
    () => detectedTasks.filter((task) => task.analysis.clarification_questions.length === 0),
    [detectedTasks],
  )

  const taskReferenceQuery = chatInput.match(/(?:^|\s)#(\d*)$/)?.[1] ?? null
  const taskReferenceMatches = useMemo(() => {
    if (taskReferenceQuery === null) return []
    return todos.filter((todo) => String(todo.id).includes(taskReferenceQuery)).slice(0, 8)
  }, [todos, taskReferenceQuery])
  const aimReferenceQuery = chatInput.match(/(?:^|\s)@(\d*)$/)?.[1] ?? null
  const aimReferenceMatches = useMemo(() => {
    if (aimReferenceQuery === null) return []
    return aims.filter((aim) => String(aim.id).includes(aimReferenceQuery)).slice(0, 8)
  }, [aims, aimReferenceQuery])
  const todoItemReferenceQuery = chatInput.match(/(?:^|\s)\$(\d*)$/)?.[1] ?? null
  const todoItemReferenceMatches = useMemo(() => {
    if (todoItemReferenceQuery === null) return []
    return todos.flatMap((todo) => todo.todo_items.map((item) => ({ item, todo })))
      .filter(({ item }) => String(item.id).includes(todoItemReferenceQuery)).slice(0, 8)
  }, [todos, todoItemReferenceQuery])
  const selectedTodo = todos.find((todo) => todo.id === selectedId) ?? null
  const loadedAim = aims.find((aim) => aim.id === loadedAimId) ?? null
  const loadedTask = todos.find((todo) => todo.id === loadedTaskId) ?? null
  const aimContextTasks = loadedAimId === null ? [] : todos.filter((todo) => todo.aim_id === loadedAimId)
  const statusCounts = useMemo(() => todos.reduce(
    (counts, todo) => ({ ...counts, [getTodoStatus(todo)]: counts[getTodoStatus(todo)] + 1 }),
    { pending: 0, scheduled: 0, running: 0, completed: 0 },
  ), [todos])
  const atRiskTasks = useMemo(() => {
    const now = Date.now()
    const dueSoonWindow = 3 * 24 * 60 * 60 * 1000
    return todos
      .filter((todo) => getTodoStatus(todo) !== 'completed')
      .map((todo) => {
        const start = todo.start_time ? new Date(todo.start_time).getTime() : null
        const dueAt = todo.end_time
          ? new Date(todo.end_time).getTime()
          : start === null ? null : start + (todo.expected_duration_minutes ?? 1440) * 60 * 1000
        return dueAt === null ? null : { todo, dueAt, remainingMs: dueAt - now }
      })
      .filter((item): item is { todo: Todo; dueAt: number; remainingMs: number } => item !== null && item.remainingMs <= dueSoonWindow)
      .sort((first, second) => first.remainingMs - second.remainingMs)
  }, [todos])

  function showError(reason: unknown) {
    setError(reason instanceof Error ? reason.message : 'Something went wrong')
  }

  async function sendChatMessage(event: FormEvent) {
    event.preventDefault()
    const text = chatInput.trim()
    if (!text) return
    const loadRequest = text.match(/^load(?:\s+@(\d+))?(?:\s+#(\d+))?$/i)
    if (loadRequest && (loadRequest[1] || loadRequest[2])) {
      const aimId = loadRequest[1] ? Number(loadRequest[1]) : null
      const taskId = loadRequest[2] ? Number(loadRequest[2]) : null
      if ((aimId !== null && !aims.some((aim) => aim.id === aimId)) || (taskId !== null && !todos.some((todo) => todo.id === taskId))) {
        setError('The requested aim or task was not found')
        return
      }
      setLoadedAimId(aimId)
      setLoadedTaskId(taskId)
      setContextAimDraft(null)
      setContextTaskDraft(null)
      setChatInput('')
      const messageId = Date.now()
      setChatMessages((current) => [...current, { id: messageId, role: 'user', text }, { id: messageId + 1, role: 'assistant', text: `Loaded ${[aimId && `@${aimId}`, taskId && `#${taskId}`].filter(Boolean).join(' and ')}.` }])
      return
    }
    if (pendingAimName) {
      const messageId = Date.now()
      setPendingAimName(false)
      setChatInput('')
      setChatMessages((current) => [...current,
        { id: messageId, role: 'user', text },
        { id: messageId + 1, role: 'assistant', text: 'This aim is ready to review and create.', aimDraft: { name: text, description: text } },
      ])
      return
    }
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
    const aimRequest = text.match(/^(?:create|add)(?: a| an)? aim(?:\s+(?:to|for|named|called))?\s*(.*)$/i)
    if (aimRequest) {
      const messageId = Date.now()
      const name = aimRequest[1].trim()
      setChatInput('')
      if (!name) {
        setPendingAimName(true)
        setChatMessages((current) => [...current, { id: messageId, role: 'user', text }, { id: messageId + 1, role: 'assistant', text: 'What should this aim be called?' }])
      } else {
        setChatMessages((current) => [...current, { id: messageId, role: 'user', text }, { id: messageId + 1, role: 'assistant', text: 'This aim is ready to review and create.', aimDraft: { name, description: text } }])
      }
      return
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
    setTaskSprintId(selectedSprintId === null ? '' : String(selectedSprintId))
    setTaskAimId('')
    setStartTime(suggestion.start_date ?? '')
    setEndTime('')
    setDurationDays(suggestion.expected_duration_days ? String(suggestion.expected_duration_days) : '')
    setDurationHours(suggestion.expected_duration_hours ? String(suggestion.expected_duration_hours) : '')
    setDependencyQuery('')
    setDependencyIds(suggestion.dependency_names.flatMap((name) => {
      const match = todos.find((todo) => todo.title.toLocaleLowerCase() === name.toLocaleLowerCase())
      return match ? [match.id] : []
    }))
    setTaskItems([])
    setTodoItemName('')
    setTodoItemHours('')
    setAddModalOpen(true)
  }

  function loadDetectedTaskInContext(task: DetectedTask) {
    const suggestion = task.analysis.suggestion
    setLoadedTaskId(null)
    setContextTaskDraft({
      title: suggestion.title,
      description: suggestion.description,
      sprint_id: selectedSprintId,
      aim_id: loadedAimId,
      start_time: suggestion.start_date ? `${suggestion.start_date}T00:00:00` : null,
      end_time: null,
      expected_duration_minutes: (suggestion.expected_duration_days * 1440 + suggestion.expected_duration_hours * 60) || null,
      dependency_ids: suggestion.dependency_names.flatMap((name) => {
        const match = todos.find((todo) => todo.title.toLocaleLowerCase() === name.toLocaleLowerCase())
        return match ? [match.id] : []
      }),
      is_running: false,
      todo_items: [],
    })
  }

  function contextDraftFor(todo: Todo | null): ContextTaskDraft {
    return todo ? {
      title: todo.title, description: todo.description, sprint_id: todo.sprint_id, aim_id: todo.aim_id,
      start_time: todo.start_time, end_time: todo.end_time, expected_duration_minutes: todo.expected_duration_minutes,
      dependency_ids: todo.dependency_ids, is_running: todo.is_running,
      todo_items: todo.todo_items.map((item) => ({ id: item.id, name: item.name, estimated_duration_minutes: item.estimated_duration_minutes })),
    } : { title: '', description: '', sprint_id: null, aim_id: loadedAimId, start_time: null, end_time: null, expected_duration_minutes: null, dependency_ids: [], is_running: false, todo_items: [] }
  }

  function changeContextTask(changes: Partial<ContextTaskDraft>) {
    setContextTaskDraft((current) => ({ ...(current ?? contextDraftFor(loadedTask)), ...changes }))
  }

  async function saveContextAim() {
    if (!contextAimDraft?.name.trim() && loadedAimId === null) return
    try {
      const current = loadedAimId === null ? null : aims.find((aim) => aim.id === loadedAimId)
      const values = contextAimDraft ?? { name: current?.name ?? '', description: current?.description ?? '' }
      const saved = loadedAimId === null
        ? await api.createAim(values.name, values.description)
        : await api.updateAim(loadedAimId, values.name, values.description)
      setAims((items) => loadedAimId === null ? [...items, saved] : items.map((item) => item.id === saved.id ? saved : item))
      setLoadedAimId(saved.id)
      setContextAimDraft(null)
    } catch (reason) { showError(reason) }
  }

  async function saveContextTask() {
    if (!contextTaskDraft?.title.trim()) return
    try {
      const existing = loadedTaskId === null ? null : todos.find((todo) => todo.id === loadedTaskId)
      const saved = existing
        ? await api.update(existing.id, contextTaskDraft)
        : await api.create(contextTaskDraft)
      setTodos((items) => existing ? items.map((item) => item.id === saved.id ? saved : item) : [saved, ...items])
      setLoadedTaskId(saved.id)
      setContextTaskDraft(null)
    } catch (reason) { showError(reason) }
  }

  function insertTaskReference(todo: Todo) {
    setChatInput((current) => current.replace(/#\d*$/, `#${todo.id} ${todo.title}`))
    requestAnimationFrame(() => chatInputRef.current?.focus())
  }

  function insertAimReference(aim: Aim) {
    setChatInput((current) => current.replace(/@\d*$/, `@${aim.id} ${aim.name}`))
    requestAnimationFrame(() => chatInputRef.current?.focus())
  }

  function insertTodoItemReference(item: { id: number; name: string }) {
    setChatInput((current) => current.replace(/\$\d*$/, `$${item.id} ${item.name}`))
    requestAnimationFrame(() => chatInputRef.current?.focus())
  }

  function addTodoItem() {
    const name = todoItemName.trim()
    if (!name) return
    setTaskItems((current) => [...current, {
      name,
      estimated_duration_minutes: Math.max(0, Number(todoItemHours) || 0) * 60,
    }])
    setTodoItemName('')
    setTodoItemHours('')
  }

  function clearChat() {
    setChatMessages([])
    setDetectedTasks([])
    setActiveTaskNumber(null)
    setChatInput('')
    setError('')
    setPendingAimName(false)
  }

  async function saveSprint(event: FormEvent) {
    event.preventDefault()
    try {
      const sprint = await api.createSprint(sprintName, sprintEndDate)
      setSprints((current) => [...current, sprint].sort((a, b) => a.end_date.localeCompare(b.end_date)))
      setSprintModalOpen(false)
      setSprintName('')
      setSprintEndDate('')
    } catch (reason) {
      showError(reason)
    }
  }

  function openSprintModal() {
    setSprintName('')
    setSprintEndDate('')
    setSprintModalOpen(true)
  }

  function tomorrowDate() {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    return localInputDate(tomorrow)
  }

  function localInputDate(value: Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  function openAimModal(draft?: { name: string; description: string }) {
    setAimName(draft?.name ?? '')
    setAimDescription(draft?.description ?? '')
    setAimModalOpen(true)
  }

  async function saveAim(event: FormEvent) {
    event.preventDefault()
    try {
      const aim = await api.createAim(aimName, aimDescription)
      setAims((current) => [...current, aim])
      setAimModalOpen(false)
      setDashboardMode('aims')
    } catch (reason) {
      showError(reason)
    }
  }

  async function addTodo(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    setError('')
    try {
      const minutes = (Number(durationDays) || 0) * 1440 + (Number(durationHours) || 0) * 60
      const input = {
        title,
        description,
        sprint_id: taskSprintId ? Number(taskSprintId) : null,
        aim_id: taskAimId ? Number(taskAimId) : null,
        start_time: startTime ? `${startTime}T00:00:00` : null,
        end_time: endTime || null,
        expected_duration_minutes: minutes || null,
        dependency_ids: dependencyIds,
        is_running: editingId === null ? false : (todos.find((item) => item.id === editingId)?.is_running ?? false),
        todo_items: taskItems,
      }
      const todo = editingId === null
        ? await api.create(input)
        : await api.update(editingId, input)
      setTodos((current) => editingId === null
        ? [todo, ...current]
        : current.map((item) => item.id === todo.id ? todo : item))
      setSelectedId(todo.id)
      setTitle('')
      setDescription('')
      setQuery('')
      setFilter('all')
      setAddModalOpen(false)
      setTaskSprintId('')
      setTaskAimId('')
      setStartTime('')
      setEndTime('')
      setDurationDays('')
      setDurationHours('')
      setDependencyQuery('')
      setDependencyIds([])
      setTaskItems([])
      setTodoItemName('')
      setTodoItemHours('')
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
    setTaskSprintId(selectedSprintId === null ? '' : String(selectedSprintId))
    setTaskAimId('')
    setStartTime('')
    setEndTime('')
    setDurationDays('')
    setDurationHours('')
    setDependencyQuery('')
    setDependencyIds([])
    setTaskItems([])
    setTodoItemName('')
    setTodoItemHours('')
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
    setTaskSprintId(todo.sprint_id === null ? '' : String(todo.sprint_id))
    setTaskAimId(todo.aim_id === null ? '' : String(todo.aim_id))
    setStartTime(todo.start_time?.slice(0, 10) ?? '')
    setEndTime(todo.end_time?.slice(0, 16) ?? '')
    setDurationDays(duration ? String(Math.floor(duration / 1440)) : '')
    setDurationHours(duration ? String(Math.floor((duration % 1440) / 60)) : '')
    setDependencyQuery('')
    setDependencyIds(todo.dependency_ids)
    setTaskItems(todo.todo_items.map((item) => ({ id: item.id, name: item.name, estimated_duration_minutes: item.estimated_duration_minutes })))
    setTodoItemName('')
    setTodoItemHours('')
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

  async function updateTodo(todo: Todo, changes: Partial<Pick<Todo, 'title' | 'description' | 'completed' | 'is_running' | 'sprint_id' | 'aim_id' | 'start_time' | 'end_time' | 'expected_duration_minutes' | 'dependency_ids'>> & { todo_items?: TodoItemInput[] }) {
    try {
      const updated = await api.update(todo.id, changes)
      setTodos((current) => current.map((item) => (item.id === todo.id ? updated : item)))
    } catch (reason) {
      showError(reason)
    }
  }

  async function assignDroppedTaskToSprint() {
    if (draggingTaskId === null || selectedSprintId === null) return
    const todo = todos.find((item) => item.id === draggingTaskId)
    setSprintDropActive(false)
    setDraggingTaskId(null)
    if (!todo || todo.sprint_id === selectedSprintId) return
    await updateTodo(todo, { sprint_id: selectedSprintId })
  }

  async function assignTaskToAim(todoId: number, aimId: number) {
    const todo = todos.find((item) => item.id === todoId)
    if (todo && todo.aim_id !== aimId) await updateTodo(todo, { aim_id: aimId })
    setDraggingTaskId(null)
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

  function formatDeadlineRisk(remainingMs: number) {
    const absoluteHours = Math.max(1, Math.ceil(Math.abs(remainingMs) / (60 * 60 * 1000)))
    const amount = absoluteHours >= 24 ? `${Math.ceil(absoluteHours / 24)}d` : `${absoluteHours}h`
    return remainingMs < 0 ? `${amount} late` : `Due in ${amount}`
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
        <header className="app-header">
          <div>
            <h1>{chatOpen ? 'Task assistant' : dashboardMode === 'tasks' ? 'Task dependencies' : 'Aims'}</h1>
          </div>
          <div className="header-actions">
            <button className="view-toggle" onClick={() => { setChatOpen(false); setDashboardMode((current) => current === 'tasks' ? 'aims' : 'tasks') }}>{dashboardMode === 'tasks' ? 'Aims' : 'Tasks'}</button>
            {dashboardMode === 'aims' && <button className="header-add-task" onClick={() => openAimModal()}><span aria-hidden="true">＋</span> Add aim</button>}
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

        <aside className="sidebar">
          <button className="sidebar-edge-toggle" onClick={() => setSidebarOpen((current) => !current)} aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'} aria-expanded={sidebarOpen} title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}>{sidebarOpen ? '‹' : '›'}</button>
          <section className="sprint-sidebar-section">
            <div className="sidebar-heading sprint-heading">
              <div><p className="eyebrow">Planning</p><h2>Sprints</h2></div>
              <div className="sprint-heading-actions">
                <button className="add-sprint-icon" onClick={openSprintModal} aria-label="Create sprint">＋</button>
              </div>
            </div>
            <div className="sprint-list">
              <button className={`sprint-card ${selectedSprintId === null ? 'selected' : ''}`} onClick={() => { setSelectedSprintId(null); setDashboardMode('tasks'); setChatOpen(false) }}>
                <strong>All tasks</strong><small>Full timeline</small>
              </button>
              {sprints.map((sprint) => <button className={`sprint-card ${selectedSprintId === sprint.id ? 'selected' : ''}`} onClick={() => { setSelectedSprintId(sprint.id); setSelectedId(null); setDashboardMode('tasks'); setChatOpen(false) }} key={sprint.id}>
                <strong>{sprint.name}</strong><small>{formatDate(sprint.created_at)} – {formatDate(sprint.end_date)}</small>
              </button>)}
            </div>
          </section>

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
              <button draggable={selectedSprintId !== null || dashboardMode === 'aims'} className={`task-card ${selectedId === todo.id ? 'selected' : ''} ${getTodoStatus(todo) === 'completed' ? 'completed' : ''} ${draggingTaskId === todo.id ? 'dragging' : ''}`} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/task-id', String(todo.id)); setDraggingTaskId(todo.id) }} onDragEnd={() => { setDraggingTaskId(null); setSprintDropActive(false) }} onClick={() => setSelectedId(todo.id)} onDoubleClick={() => openTaskDetail(todo.id)} key={todo.id}>
                <span className="card-copy">
                  <strong>{todo.title}</strong>
                  <small>#{todo.id} · {getTodoStatus(todo)}</small>
                </span>
                {todo.completed && <span className="card-check">✓</span>}
              </button>
            ))}
          </div>
        </aside>

        <section className={`workspace ${dashboardMode === 'tasks' && sprintDropActive ? 'sprint-drop-ready' : ''}`} onDragOver={(event) => { if (dashboardMode === 'tasks' && selectedSprintId !== null && draggingTaskId !== null) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setSprintDropActive(true) } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSprintDropActive(false) }} onDrop={(event) => { if (dashboardMode !== 'tasks') return; event.preventDefault(); void assignDroppedTaskToSprint() }}>
          {error && <p className="error" role="alert">{error}</p>}

          {dashboardMode === 'tasks' ? <>
            {selectedSprint && <div className="sprint-view-heading"><div><span>Sprint</span><strong>{selectedSprint.name}</strong></div><small>{sprintDropActive ? 'Drop to assign task' : `${formatDate(selectedSprint.created_at)} – ${formatDate(selectedSprint.end_date)} · ${dashboardTodos.length} task${dashboardTodos.length === 1 ? '' : 's'}`}</small></div>}
            <TaskDag todos={dashboardTodos} selectedId={selectedId} onSelect={setSelectedId} onOpen={openTaskDetail} rangeStart={selectedSprint?.created_at.slice(0, 10)} rangeEnd={selectedSprint?.end_date} />
          </> : <section className="aim-dashboard">
            {aims.length === 0 ? <div className="aim-empty"><h2>No aims yet</h2><p>Create an aim, then drag tasks onto it.</p></div> : aims.map((aim) => {
              const aimTasks = todos.filter((todo) => todo.aim_id === aim.id)
              const completed = aimTasks.filter((todo) => getTodoStatus(todo) === 'completed').length
              const status = aimTasks.length === 0 ? 'EMPTY' : completed === aimTasks.length ? 'COMPLETED' : `${completed} out of ${aimTasks.length} tasks completed`
              return <article className="aim-card" onDragOver={(event) => { event.stopPropagation(); if (draggingTaskId !== null) { event.preventDefault(); event.currentTarget.classList.add('drop-ready') } }} onDragLeave={(event) => event.currentTarget.classList.remove('drop-ready')} onDrop={(event) => { event.stopPropagation(); event.preventDefault(); event.currentTarget.classList.remove('drop-ready'); if (draggingTaskId !== null) void assignTaskToAim(draggingTaskId, aim.id) }} key={aim.id}>
                <div className="aim-card-heading"><span>@{aim.id}</span><strong>{aim.name}</strong><b className="aim-status">{status}</b></div>
                {aim.description && <p>{aim.description}</p>}
                <div className="aim-task-list">{aimTasks.map((todo) => {
                  const status = getTodoStatus(todo)
                  return <button className={`aim-task-icon ${status}`} onClick={() => openTaskDetail(todo.id)} aria-label={`Task #${todo.id}: ${todo.title}`} key={todo.id}>
                    <span>#{todo.id}</span>
                    <div className="aim-task-tooltip" role="tooltip">
                      <strong>{todo.title}</strong>
                      <small>#{todo.id} · {status}</small>
                      {todo.description && <p>{todo.description}</p>}
                      <dl>
                        <div><dt>Start</dt><dd>{formatDateTime(todo.start_time)}</dd></div>
                        <div><dt>End</dt><dd>{formatDateTime(todo.end_time)}</dd></div>
                        <div><dt>Duration</dt><dd>{formatDuration(todo.expected_duration_minutes)}</dd></div>
                      </dl>
                    </div>
                  </button>
                })}</div>
              </article>
            })}
          </section>}
        </section>

        {!chatOpen && <aside className="risk-sidebar" aria-label="Tasks at risk">
          <div className="risk-sidebar-heading">
            <p className="eyebrow">Attention</p>
            <h2>At risk</h2>
            <span>{atRiskTasks.length}</span>
          </div>
          <p className="risk-summary">Late and due within 3 days</p>
          <div className="risk-task-list">
            {atRiskTasks.length === 0 ? <p className="risk-empty">Nothing is late or due soon.</p> : atRiskTasks.map(({ todo, dueAt, remainingMs }) => (
              <button className={`risk-task ${remainingMs < 0 ? 'late' : 'due-soon'}`} onClick={() => { setSelectedId(todo.id); openTaskDetail(todo.id) }} key={todo.id}>
                <span className="risk-rank">#{todo.id}</span>
                <strong>{todo.title}</strong>
                <small>{new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(dueAt))}</small>
                <b>{formatDeadlineRisk(remainingMs)}</b>
              </button>
            ))}
          </div>
        </aside>}
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
              <div><span>Sprint</span><strong>{sprints.find((sprint) => sprint.id === selectedTodo.sprint_id)?.name ?? 'None'}</strong></div>
              <div><span>Aim</span><strong>{aims.find((aim) => aim.id === selectedTodo.aim_id)?.name ?? 'None'}</strong></div>
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
            <section className="todo-item-detail">
              <div><span>Todo items</span><strong>{selectedTodo.todo_items.length}</strong></div>
              {selectedTodo.todo_items.length === 0 ? <p>No todo items assigned.</p> : <ul>{selectedTodo.todo_items.map((item) => (
                <li key={item.id}><b>${item.id}</b><span>{item.name}</span><small>{formatDuration(item.estimated_duration_minutes)}</small></li>
              ))}</ul>}
            </section>
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
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe this task…" maxLength={5000} rows={2} />
              </label>
              <div className="form-row identity-row">
                <label>Sprint <small>Optional</small>
                  <select value={taskSprintId} onChange={(event) => setTaskSprintId(event.target.value)}>
                    <option value="">None</option>
                    {sprints.map((sprint) => <option value={sprint.id} key={sprint.id}>{sprint.name}</option>)}
                  </select>
                </label>
                <label>Aim <small>Optional</small>
                  <select value={taskAimId} onChange={(event) => setTaskAimId(event.target.value)}>
                    <option value="">None</option>
                    {aims.map((aim) => <option value={aim.id} key={aim.id}>@{aim.id} {aim.name}</option>)}
                  </select>
                </label>
              </div>
              <div className="form-row schedule-form-row">
                <label>Start date
                  <div className="date-time-control">
                    <input ref={startTimeInput} type="date" value={startTime} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => setStartTime(event.target.value)} />
                    <button type="button" onClick={() => startTimeInput.current?.showPicker?.()} aria-label="Open start date picker">▣</button>
                  </div>
                </label>
                <label>End time<input type="datetime-local" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>
                <label>Expected duration
                  <div className="duration-control">
                    <span><input type="number" min="0" value={durationDays} onChange={(event) => setDurationDays(event.target.value)} placeholder="0" /> days</span>
                    <span><input type="number" min="0" value={durationHours} onChange={(event) => setDurationHours(event.target.value)} placeholder="0" /> hours</span>
                  </div>
                </label>
              </div>
              <label>Dependencies <small>Search and add any tasks that must come first</small>
                <div className="dependency-control">
                  <input list="dependency-tasks" value={dependencyQuery} onChange={(event) => setDependencyQuery(event.target.value)} placeholder="Search task name…" />
                  <datalist id="dependency-tasks">{todos.filter((item) => item.id !== editingId && !dependencyIds.includes(item.id)).map((item) => <option value={item.title} key={item.id}>#{item.id}</option>)}</datalist>
                  <button type="button" onClick={addDependencyByName} disabled={!dependencyQuery.trim()}>Add</button>
                </div>
                {dependencyIds.length > 0 && <div className="dependency-chips">{dependencyIds.map((id) => <button type="button" onClick={() => setDependencyIds((current) => current.filter((item) => item !== id))} key={id}>{taskName(id)} ×</button>)}</div>}
              </label>
              <fieldset className="todo-items-editor">
                <legend>Todo items <small>Optional steps within this task</small></legend>
                <div className="todo-item-control">
                  <input value={todoItemName} onChange={(event) => setTodoItemName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTodoItem() } }} placeholder="Todo item name…" maxLength={200} />
                  <label><input type="number" min="0" step="0.25" value={todoItemHours} onChange={(event) => setTodoItemHours(event.target.value)} placeholder="0" /> hours</label>
                  <button type="button" onClick={addTodoItem} disabled={!todoItemName.trim()}>Add</button>
                </div>
                {taskItems.length > 0 && <div className="todo-item-drafts">{taskItems.map((item, index) => <div key={item.id ?? `new-${index}`}>
                  <b>{item.id ? `$${item.id}` : 'NEW'}</b><span>{item.name}</span><small>{formatDuration(item.estimated_duration_minutes)}</small>
                  <button type="button" onClick={() => setTaskItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${item.name}`}>×</button>
                </div>)}</div>}
              </fieldset>
              <div className="modal-actions">
                <button type="button" onClick={() => setAddModalOpen(false)}>Cancel</button>
                <button className="primary" type="submit" disabled={!title.trim()}>{editingId === null ? 'Add task' : 'Save changes'}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {chatOpen && <section className={`chat-workspace-overlay ${sidebarOpen ? '' : 'sidebar-closed'}`}>
      <aside className="chat-drawer" aria-label="Task detection chat">
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
              {message.aimDraft && <button className="inline-task-marker aim-marker" onClick={() => { setLoadedAimId(null); setContextAimDraft(message.aimDraft!); setLoadedTaskId(null) }} title="Review aim"><span>＋</span><b>@</b></button>}
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
          {aimReferenceQuery !== null && <div className="task-reference-tooltip" role="listbox" aria-label="Aim references">
            {aimReferenceMatches.length > 0 ? aimReferenceMatches.map((aim) => <button type="button" role="option" onClick={() => insertAimReference(aim)} key={aim.id}>
              <b>@{aim.id}</b><span>{aim.name}</span>
            </button>) : <p>No aim number matches @{aimReferenceQuery}</p>}
          </div>}
          {todoItemReferenceQuery !== null && <div className="task-reference-tooltip" role="listbox" aria-label="Todo item references">
            {todoItemReferenceMatches.length > 0 ? todoItemReferenceMatches.map(({ item, todo }) => <button type="button" role="option" onClick={() => insertTodoItemReference(item)} key={item.id}>
              <b>${item.id}</b><span>{item.name} · #{todo.id} {todo.title}</span>
            </button>) : <p>No todo item matches ${todoItemReferenceQuery}</p>}
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
      </aside>
      <section className="chat-related" aria-label="Content related to chat">
        <div className="chat-related-heading"><p className="eyebrow">Loaded context</p><h2>Aim & task</h2><small>Try “load @2 #2”</small></div>
        <div className="context-editor">
          <section className="context-section aim-context">
            <div className="context-title"><h3>Aim</h3><select value={loadedAimId ?? ''} onChange={(event) => { const id = event.target.value ? Number(event.target.value) : null; setLoadedAimId(id); setContextAimDraft(null); if (loadedTaskId && todos.find((todo) => todo.id === loadedTaskId)?.aim_id !== id) { setLoadedTaskId(null); setContextTaskDraft(contextDraftFor(null)) } }}><option value="">New aim</option>{aims.map((aim) => <option value={aim.id} key={aim.id}>@{aim.id} {aim.name}</option>)}</select></div>
            <div className="compact-aim-fields"><input value={contextAimDraft?.name ?? loadedAim?.name ?? ''} onChange={(event) => setContextAimDraft({ name: event.target.value, description: contextAimDraft?.description ?? loadedAim?.description ?? '' })} placeholder="Aim name" /><input value={contextAimDraft?.description ?? loadedAim?.description ?? ''} onChange={(event) => setContextAimDraft({ name: contextAimDraft?.name ?? loadedAim?.name ?? '', description: event.target.value })} placeholder="Short description" /></div>
            <button className="context-save" onClick={saveContextAim} disabled={!(contextAimDraft?.name ?? loadedAim?.name ?? '').trim()}>{loadedAimId === null ? 'Create aim' : 'Update aim'}</button>
            {loadedAimId !== null && loadedTaskId === null && <div className="aim-context-tasks"><h4>Tasks under this aim</h4>{aimContextTasks.length ? aimContextTasks.map((todo) => <button onClick={() => { setLoadedTaskId(todo.id); setContextTaskDraft(null) }} key={todo.id}><b>#{todo.id}</b><span>{todo.title}</span><small>{getTodoStatus(todo)}</small></button>) : <p>No tasks assigned.</p>}</div>}
          </section>
          <section className="context-section task-context">
            <div className="context-title"><h3>Task</h3><select value={loadedTaskId ?? ''} onChange={(event) => { const id = event.target.value ? Number(event.target.value) : null; const task = todos.find((todo) => todo.id === id) ?? null; setLoadedTaskId(id); setContextTaskDraft(contextDraftFor(task)); if (task?.aim_id) setLoadedAimId(task.aim_id) }}><option value="">New task</option>{todos.map((todo) => <option value={todo.id} key={todo.id}>#{todo.id} {todo.title}</option>)}</select></div>
            {readyDetectedTasks.length > 0 && <div className="detected-context-list">{readyDetectedTasks.map((task) => <button onClick={() => loadDetectedTaskInContext(task)} key={task.number}>＋ Load detected task {task.number}: {task.analysis.suggestion.title}</button>)}</div>}
            <input value={contextTaskDraft?.title ?? loadedTask?.title ?? ''} onChange={(event) => changeContextTask({ title: event.target.value })} placeholder="Task name" />
            <textarea value={contextTaskDraft?.description ?? loadedTask?.description ?? ''} onChange={(event) => changeContextTask({ description: event.target.value })} placeholder="Task description" rows={2} />
            <div className="context-form-row"><label>Sprint<select value={contextTaskDraft?.sprint_id ?? loadedTask?.sprint_id ?? ''} onChange={(event) => changeContextTask({ sprint_id: event.target.value ? Number(event.target.value) : null })}><option value="">None</option>{sprints.map((sprint) => <option value={sprint.id} key={sprint.id}>{sprint.name}</option>)}</select></label><label>Aim<select value={contextTaskDraft?.aim_id ?? loadedTask?.aim_id ?? ''} onChange={(event) => { const aimId = event.target.value ? Number(event.target.value) : null; changeContextTask({ aim_id: aimId }); setLoadedAimId(aimId) }}><option value="">None</option>{aims.map((aim) => <option value={aim.id} key={aim.id}>@{aim.id} {aim.name}</option>)}</select></label></div>
            <div className="context-form-row three"><label>Start date<input type="date" value={(contextTaskDraft?.start_time ?? loadedTask?.start_time ?? '').slice(0, 10)} onChange={(event) => changeContextTask({ start_time: event.target.value ? `${event.target.value}T00:00:00` : null })} /></label><label>End date<input type="date" value={(contextTaskDraft?.end_time ?? loadedTask?.end_time ?? '').slice(0, 10)} onChange={(event) => changeContextTask({ end_time: event.target.value ? `${event.target.value}T00:00:00` : null })} /></label><label>Estimated hours<input type="number" min="0" step="0.25" value={(contextTaskDraft?.expected_duration_minutes ?? loadedTask?.expected_duration_minutes ?? 0) / 60 || ''} onChange={(event) => changeContextTask({ expected_duration_minutes: Number(event.target.value) * 60 || null })} /></label></div>
            <label className="context-dependencies">Dependencies<select multiple value={(contextTaskDraft?.dependency_ids ?? loadedTask?.dependency_ids ?? []).map(String)} onChange={(event) => changeContextTask({ dependency_ids: Array.from(event.target.selectedOptions, (option) => Number(option.value)) })}>{todos.filter((todo) => todo.id !== loadedTaskId).map((todo) => <option value={todo.id} key={todo.id}>#{todo.id} {todo.title}</option>)}</select></label>
            <div className="context-items"><span>Todo items</span>{(contextTaskDraft?.todo_items ?? loadedTask?.todo_items ?? []).map((item, index) => <div key={item.id ?? index}><b>{item.id ? `$${item.id}` : 'New'}</b><input value={item.name} onChange={(event) => changeContextTask({ todo_items: (contextTaskDraft?.todo_items ?? contextDraftFor(loadedTask).todo_items).map((value, itemIndex) => itemIndex === index ? { ...value, name: event.target.value } : value) })} /><input type="number" min="0" step="0.25" value={item.estimated_duration_minutes / 60 || ''} onChange={(event) => changeContextTask({ todo_items: (contextTaskDraft?.todo_items ?? contextDraftFor(loadedTask).todo_items).map((value, itemIndex) => itemIndex === index ? { ...value, estimated_duration_minutes: Number(event.target.value) * 60 } : value) })} /><button onClick={() => changeContextTask({ todo_items: (contextTaskDraft?.todo_items ?? contextDraftFor(loadedTask).todo_items).filter((_, itemIndex) => itemIndex !== index) })}>×</button></div>)}<button className="add-context-item" onClick={() => changeContextTask({ todo_items: [...(contextTaskDraft?.todo_items ?? contextDraftFor(loadedTask).todo_items), { name: 'New todo item', estimated_duration_minutes: 0 }] })}>＋ Add todo item</button></div>
            <button className="context-save" onClick={saveContextTask} disabled={!(contextTaskDraft?.title ?? loadedTask?.title ?? '').trim()}>{loadedTaskId === null ? 'Create task' : 'Update task'}</button>
          </section>
        </div>
      </section>
      </section>}

      {sprintModalOpen && <div className="modal-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setSprintModalOpen(false)
      }}>
        <section className="sprint-modal" role="dialog" aria-modal="true" aria-labelledby="sprint-modal-title">
          <div className="modal-heading">
            <div><p className="eyebrow">Planning</p><h2 id="sprint-modal-title">Create a sprint</h2></div>
            <button onClick={() => setSprintModalOpen(false)} aria-label="Close sprint modal">×</button>
          </div>
          <form onSubmit={saveSprint}>
            <label>Sprint name
              <input autoFocus value={sprintName} onChange={(event) => setSprintName(event.target.value)} placeholder="e.g. August launch" maxLength={120} />
            </label>
            <label>Sprint end date
              <input type="date" min={tomorrowDate()} value={sprintEndDate} onChange={(event) => setSprintEndDate(event.target.value)} />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setSprintModalOpen(false)}>Cancel</button>
              <button className="primary" type="submit" disabled={!sprintName.trim() || !sprintEndDate}>Create sprint</button>
            </div>
          </form>
        </section>
      </div>}

      {aimModalOpen && <div className="modal-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setAimModalOpen(false)
      }}>
        <section className="sprint-modal" role="dialog" aria-modal="true" aria-labelledby="aim-modal-title">
          <div className="modal-heading">
            <div><p className="eyebrow">Direction</p><h2 id="aim-modal-title">Create an aim</h2></div>
            <button onClick={() => setAimModalOpen(false)} aria-label="Close aim modal">×</button>
          </div>
          <form onSubmit={saveAim}>
            <label>Aim name
              <input autoFocus value={aimName} onChange={(event) => setAimName(event.target.value)} placeholder="What outcome are you aiming for?" maxLength={200} />
            </label>
            <label>Description <small>Optional</small>
              <textarea value={aimDescription} onChange={(event) => setAimDescription(event.target.value)} placeholder="Describe the intended outcome…" rows={3} maxLength={5000} />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setAimModalOpen(false)}>Cancel</button>
              <button className="primary" type="submit" disabled={!aimName.trim()}>Create aim</button>
            </div>
          </form>
        </section>
      </div>}
    </main>
  )
}
