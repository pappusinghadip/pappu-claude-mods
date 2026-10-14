export type TaskStatus = 'pending' | 'in_progress' | 'completed'
export type Task = { id: string; title: string; status: TaskStatus; startedAt: number; doneAt: number }
export type Agent = { id: string; title: string; model: string; state: 'running' | 'done' | 'failed'; tool: string; startedAt: number; endedAt: number }
export type Goal = { text: string; startedAt: number; endedAt: number }

export function progress(tasks: Task[]) {
  const done = tasks.filter(t => t.status === 'completed').length
  return { done, total: tasks.length, pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0 }
}

// remaining time at the pace of the tasks finished so far; null until two are done
export function eta(tasks: Task[], goal: Goal): number | null {
  const finished = tasks.filter(t => t.status === 'completed' && t.doneAt > 0)
  if (finished.length < 2) return null
  const lastDone = Math.max(...finished.map(t => t.doneAt))
  const perTask = (lastDone - goal.startedAt) / finished.length
  return Math.max(0, Math.round(perTask * (tasks.length - finished.length)))
}

// TodoWrite sends the whole list each time; keep start and finish times across rewrites by title
export function fromTodos(todos: { content: string; status: TaskStatus }[], before: Task[], now: number): Task[] {
  return todos.map((t, i) => {
    const was = before.find(b => b.title === t.content)
    return {
      id: `todo-${i}`,
      title: t.content,
      status: t.status,
      startedAt: was?.startedAt || (t.status !== 'pending' ? now : 0),
      doneAt: t.status === 'completed' ? was?.doneAt || now : 0,
    }
  })
}

// claude-haiku-4-5-20251001 -> Haiku 4.5
export function modelLabel(model: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(model)
  return m && m[1] ? `${m[1][0]?.toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : model
}
