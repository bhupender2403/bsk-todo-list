export type Todo = {
  id: number
  title: string
  description: string
  completed: boolean
  aim_id: number | null
  start_time: string | null
  end_time: string | null
  expected_duration_minutes: number | null
  dependency_ids: number[]
  is_running: boolean
  is_picked: boolean
  created_at: string
  updated_at: string
  todo_items: TodoItem[]
}

export type TodoItem = {
  id: number
  task_id: number
  name: string
  estimated_duration_minutes: number
  worked_on_start: string | null
  worked_on_duration_minutes: number | null
  created_at: string
}

export type TodoItemInput = {
  id?: number
  name: string
  estimated_duration_minutes: number
  worked_on_start?: string | null
  worked_on_duration_minutes?: number | null
}

export type TodoInput = {
  title: string
  description: string
  aim_id: number | null
  start_time: string | null
  end_time: string | null
  expected_duration_minutes: number | null
  dependency_ids: number[]
  is_running: boolean
  is_picked: boolean
  todo_items: TodoItemInput[]
}

export type TodoStatus = 'pending' | 'scheduled' | 'running' | 'completed'

export type TaskAnalysis = {
  suggestion: {
    title: string
    description: string
    start_date: string | null
    expected_duration_days: number
    expected_duration_hours: number
    dependency_names: string[]
  }
  clarification_questions: string[]
  ai_powered: boolean
  analysis_source: string
}

export type TaskAnalysisConfig = {
  openai_configured: boolean
  model: string | null
}

export type TaskCommandResult = {
  handled: boolean
  message: string | null
  todo: Todo | null
  source: string
}

export type Aim = {
  id: number
  name: string
  description: string
  created_at: string
}

export function getTodoStatus(todo: Todo): TodoStatus {
  if (todo.end_time) return 'completed'
  if (todo.is_running) return 'running'
  if (todo.start_time) return 'scheduled'
  return 'pending'
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.detail ?? 'Something went wrong')
  }
  return response.status === 204 ? (undefined as T) : response.json()
}

export const api = {
  list: () => request<Todo[]>('/api/todos'),
  listTodoItems: () => request<TodoItem[]>('/api/todo-items'),
  listAims: () => request<Aim[]>('/api/aims'),
  createAim: (name: string, description: string) =>
    request<Aim>('/api/aims', { method: 'POST', body: JSON.stringify({ name, description }) }),
  analyzeTask: (text: string, answers: Record<string, string> = {}, loadedTaskId: number | null = null, loadedAimId: number | null = null) =>
    request<TaskAnalysis>('/api/task-analysis', { method: 'POST', body: JSON.stringify({ text, answers, loaded_task_id: loadedTaskId, loaded_aim_id: loadedAimId }) }),
  taskAnalysisConfig: () => request<TaskAnalysisConfig>('/api/task-analysis/config'),
  runTaskCommand: (text: string, loadedTaskId: number | null = null, loadedAimId: number | null = null) =>
    request<TaskCommandResult>('/api/task-commands', { method: 'POST', body: JSON.stringify({ text, loaded_task_id: loadedTaskId, loaded_aim_id: loadedAimId }) }),
  create: (input: TodoInput) =>
    request<Todo>('/api/todos', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: number, changes: Partial<Pick<Todo, 'title' | 'description' | 'completed' | 'is_running' | 'is_picked' | 'aim_id' | 'start_time' | 'end_time' | 'expected_duration_minutes' | 'dependency_ids'>> & { todo_items?: TodoItemInput[] }) =>
    request<Todo>(`/api/todos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),
  remove: (id: number) => request<void>(`/api/todos/${id}`, { method: 'DELETE' }),
}
