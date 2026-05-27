// Shared Prisma `where` predicate for "lists the current user can access".
// Used everywhere a List or its Todos need to be scoped to the current user:
// owner branch (`{ userId }`) plus shared-member branch
// (`{ members: { some: { userId } } }`).
//
// Mutation handlers compose this on the parent List, so a Todo PATCH/DELETE
// becomes `where: { id, list: listAccessWhere(userId) }` and a List read
// becomes `where: listAccessWhere(userId)`.

import type { Prisma } from "@prisma/client";

export function listAccessWhere(userId: string): Prisma.ListWhereInput {
  return {
    OR: [
      { userId },
      { members: { some: { userId } } },
    ],
  };
}
