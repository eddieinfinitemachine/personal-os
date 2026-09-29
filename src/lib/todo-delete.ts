import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteTodoEvent } from "@/lib/gcal";

// Hard-delete a todo (subtasks, attachments and comments cascade) and drop
// its Google Calendar event after the response. Callers do the access check
// first (`where: { id, list: listAccessWhere(userId) }`).
export async function deleteTodo(id: string) {
  await prisma.todo.delete({ where: { id } });
  after(() => deleteTodoEvent(id));
}
