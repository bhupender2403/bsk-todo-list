export type Todo = {
  id: number
  title: string
  description: string
  todo_type: string
  completed: boolean
  parent_id: number | null
  start_time: string | null
  end_time: string | null
  expected_duration_minutes: number | null
  dependency_ids: number[]
  is_running: boolean
  created_at: string
  updated_at: string
}

export type TodoInput = {
  title: string
  description: string
  todo_type: string
  parent_id: number | null
  start_time: string | null
  end_time: string | null
  expected_duration_minutes: number | null
  dependency_ids: number[]
  is_running: boolean
}

export type TodoType = {
  id: number
  name: string
  created_at: string
}

export type TodoStatus = 'pending' | 'scheduled' | 'running' | 'completed'

export type TaskAnalysis = {
  suggestion: {
    title: string
    description: string
    todo_type: string
    start_date: string | null
    expected_duration_days: number
    expected_duration_hours: number
    parent_name: string | null
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
  listTypes: () => request<TodoType[]>('/api/todo-types'),
  analyzeTask: (text: string, answers: Record<string, string> = {}) =>
    request<TaskAnalysis>('/api/task-analysis', { method: 'POST', body: JSON.stringify({ text, answers }) }),
  taskAnalysisConfig: () => request<TaskAnalysisConfig>('/api/task-analysis/config'),
  runTaskCommand: (text: string) =>
    request<TaskCommandResult>('/api/task-commands', { method: 'POST', body: JSON.stringify({ text }) }),
  createType: (name: string) =>
    request<TodoType>('/api/todo-types', { method: 'POST', body: JSON.stringify({ name }) }),
  create: (input: TodoInput) =>
    request<Todo>('/api/todos', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: number, changes: Partial<Pick<Todo, 'title' | 'description' | 'todo_type' | 'completed' | 'is_running' | 'parent_id' | 'start_time' | 'end_time' | 'expected_duration_minutes' | 'dependency_ids'>>) =>
    request<Todo>(`/api/todos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),
  remove: (id: number) => request<void>(`/api/todos/${id}`, { method: 'DELETE' }),
}
