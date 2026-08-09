import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api, type Todo } from './api'

type Filter = 'all' | 'active' | 'completed'

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [title, setTitle] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.list().then(setTodos).catch(showError).finally(() => setLoading(false))
  }, [])

  const visibleTodos = useMemo(
    () => todos.filter((todo) => filter === 'all' || (filter === 'completed') === todo.completed),
    [todos, filter],
  )
  const remaining = todos.filter((todo) => !todo.completed).length

  function showError(reason: unknown) {
    setError(reason instanceof Error ? reason.message : 'Something went wrong')
  }

  async function addTodo(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    setError('')
    try {
      const todo = await api.create(title)
      setTodos((current) => [todo, ...current])
      setTitle('')
    } catch (reason) {
      showError(reason)
    }
  }

  async function toggleTodo(todo: Todo) {
    try {
      const updated = await api.update(todo.id, { completed: !todo.completed })
      setTodos((current) => current.map((item) => (item.id === todo.id ? updated : item)))
    } catch (reason) {
      showError(reason)
    }
  }

  async function editTodo(todo: Todo) {
    const nextTitle = window.prompt('Edit todo', todo.title)?.trim()
    if (!nextTitle || nextTitle === todo.title) return
    try {
      const updated = await api.update(todo.id, { title: nextTitle })
      setTodos((current) => current.map((item) => (item.id === todo.id ? updated : item)))
    } catch (reason) {
      showError(reason)
    }
  }

  async function deleteTodo(id: number) {
    try {
      await api.remove(id)
      setTodos((current) => current.filter((todo) => todo.id !== id))
    } catch (reason) {
      showError(reason)
    }
  }

  return (
    <main>
      <section className="todo-card">
        <header>
          <div>
            <p className="eyebrow">My workspace</p>
            <h1>Today</h1>
            <p className="date">{new Intl.DateTimeFormat('en', { dateStyle: 'full' }).format(new Date())}</p>
          </div>
          <div className="count" aria-label={`${remaining} tasks remaining`}>
            <strong>{remaining}</strong>
            <span>left</span>
          </div>
        </header>

        <form className="add-form" onSubmit={addTodo}>
          <span aria-hidden="true">＋</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What needs to be done?"
            aria-label="New todo title"
            maxLength={200}
          />
          <button type="submit" disabled={!title.trim()}>Add task</button>
        </form>

        <nav aria-label="Todo filters">
          {(['all', 'active', 'completed'] as Filter[]).map((name) => (
            <button className={filter === name ? 'active' : ''} onClick={() => setFilter(name)} key={name}>
              {name}
            </button>
          ))}
        </nav>

        {error && <p className="error" role="alert">{error}</p>}

        <div className="list" aria-live="polite">
          {loading ? (
            <p className="empty">Loading your tasks…</p>
          ) : visibleTodos.length === 0 ? (
            <div className="empty">
              <span>✓</span>
              <p>{filter === 'completed' ? 'No completed tasks yet.' : 'Nothing here. Enjoy the quiet.'}</p>
            </div>
          ) : (
            visibleTodos.map((todo) => (
              <article className={todo.completed ? 'todo completed' : 'todo'} key={todo.id}>
                <button className="check" onClick={() => toggleTodo(todo)} aria-label={`Mark ${todo.title} ${todo.completed ? 'active' : 'complete'}`}>
                  {todo.completed && '✓'}
                </button>
                <button className="todo-title" onDoubleClick={() => editTodo(todo)} onClick={() => toggleTodo(todo)}>
                  {todo.title}
                </button>
                <div className="actions">
                  <button onClick={() => editTodo(todo)} aria-label={`Edit ${todo.title}`}>Edit</button>
                  <button onClick={() => deleteTodo(todo.id)} aria-label={`Delete ${todo.title}`}>Delete</button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  )
}
