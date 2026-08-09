export type Todo = {
  id: number
  title: string
  completed: boolean
  created_at: string
  updated_at: string
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
  create: (title: string) =>
    request<Todo>('/api/todos', { method: 'POST', body: JSON.stringify({ title }) }),
  update: (id: number, changes: Partial<Pick<Todo, 'title' | 'completed'>>) =>
    request<Todo>(`/api/todos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),
  remove: (id: number) => request<void>(`/api/todos/${id}`, { method: 'DELETE' }),
}
