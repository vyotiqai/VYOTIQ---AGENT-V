import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { atomicWriteJson } from '@main/storage/atomicWrite'

export const TodoStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'cancelled'])
export type TodoStatus = z.infer<typeof TodoStatusSchema>

export const TodoItemSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  status: TodoStatusSchema
})
export type TodoItem = z.infer<typeof TodoItemSchema>

const TodoFileSchema = z.object({
  updatedAt: z.string(),
  todos: z.array(TodoItemSchema)
})

const STATUS_MARK: Record<TodoStatus, string> = {
  pending: '[ ]',
  in_progress: '[~]',
  completed: '[x]',
  cancelled: '[-]'
}

function todoPath(runDir: string): string {
  return join(runDir, 'todos.json')
}

export function readTodos(runDir: string): TodoItem[] {
  const path = todoPath(runDir)
  if (!existsSync(path)) return []
  try {
    const parsed = TodoFileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
    return parsed.success ? parsed.data.todos : []
  } catch {
    return []
  }
}

export function toolTodoWrite(
  runDir: string,
  todos: TodoItem[],
  merge = false
): { content: string; todos: TodoItem[] } {
  if (!runDir) throw new Error('todo_write is only available inside a run')

  let next: TodoItem[]
  if (merge) {
    const byId = new Map(readTodos(runDir).map((todo) => [todo.id, todo]))
    for (const todo of todos) byId.set(todo.id, { ...byId.get(todo.id), ...todo })
    next = [...byId.values()]
  } else {
    next = todos
  }

  const inProgress = next.filter((todo) => todo.status === 'in_progress')
  if (inProgress.length > 1) {
    throw new Error(
      `Only one task may be in_progress at a time; got ${inProgress.length}. Finish or re-queue the others.`
    )
  }

  atomicWriteJson(todoPath(runDir), { updatedAt: new Date().toISOString(), todos: next })

  const done = next.filter((todo) => todo.status === 'completed').length
  const lines = next.map((todo) => `${STATUS_MARK[todo.status]} ${todo.content}`)
  return {
    content: [`${done}/${next.length} complete`, ...lines].join('\n'),
    todos: next
  }
}
