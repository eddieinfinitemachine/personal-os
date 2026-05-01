import Foundation
import CoreData
import PersonalOSModels

public enum TodoStoreError: Error, Sendable {
    case notFound(UUID)
}

public struct TodoStore: Sendable {
    private let controller: PersistenceController

    public init(controller: PersistenceController) {
        self.controller = controller
    }

    // MARK: Reads

    public func fetch(list: TodoList, includeCompleted: Bool = false) throws -> [Todo] {
        let request = CDTodo.fetchRequest()
        request.predicate = Self.predicate(list: list, includeCompleted: includeCompleted)
        request.sortDescriptors = Self.defaultSortDescriptors

        let context = controller.viewContext
        let results = try context.fetch(request)
        return results.map(Todo.init(managed:))
    }

    public func fetchToday() throws -> [Todo] {
        let request = CDTodo.fetchRequest()
        let endOfToday = Calendar.current.startOfDay(for: .now).addingTimeInterval(86_400)

        request.predicate = NSPredicate(format: """
            deletedAt == nil AND completedAt == nil AND list == %d \
            AND dueDate != nil AND dueDate < %@
            """, TodoList.todo.rawValue, endOfToday as NSDate)
        request.sortDescriptors = Self.defaultSortDescriptors

        let context = controller.viewContext
        let results = try context.fetch(request)
        return results.map(Todo.init(managed:))
    }

    public func fetch(id: UUID) throws -> Todo? {
        let request = CDTodo.fetchRequest()
        request.predicate = NSPredicate(format: "id == %@", id as CVarArg)
        request.fetchLimit = 1

        let context = controller.viewContext
        return try context.fetch(request).first.map(Todo.init(managed:))
    }

    public func fetch(externalID: String) throws -> Todo? {
        let request = CDTodo.fetchRequest()
        request.predicate = NSPredicate(format: "externalID == %@", externalID)
        request.fetchLimit = 1

        let context = controller.viewContext
        return try context.fetch(request).first.map(Todo.init(managed:))
    }

    /// Bulk insert/update todos by external ID. Existing todos with matching
    /// externalID are updated; missing ones are created. Returns
    /// (created, updated) counts.
    @discardableResult
    public func upsertByExternalID(_ todos: [Todo]) throws -> (created: Int, updated: Int) {
        let context = controller.viewContext
        var created = 0
        var updated = 0

        for todo in todos {
            guard let externalID = todo.externalID else {
                _ = try create(todo)
                created += 1
                continue
            }
            let request = CDTodo.fetchRequest()
            request.predicate = NSPredicate(format: "externalID == %@", externalID)
            request.fetchLimit = 1

            if let existing = try context.fetch(request).first {
                let merged = Todo(
                    id: existing.id ?? todo.id,
                    title: todo.title,
                    notes: todo.notes,
                    list: todo.list,
                    dueDate: todo.dueDate,
                    snoozedUntil: todo.snoozedUntil,
                    completedAt: todo.completedAt,
                    deletedAt: todo.deletedAt,
                    source: todo.source,
                    externalID: todo.externalID,
                    tagIDs: todo.tagIDs,
                    createdAt: existing.createdAt ?? todo.createdAt,
                    updatedAt: .now
                )
                existing.apply(merged, tagLookup: { _ in nil })
                updated += 1
            } else {
                let cdTodo = CDTodo(context: context)
                cdTodo.apply(todo, tagLookup: { _ in nil })
                created += 1
            }
        }

        if context.hasChanges {
            try context.save()
        }
        return (created, updated)
    }

    // MARK: Writes

    @discardableResult
    public func create(_ todo: Todo) throws -> Todo {
        let context = controller.viewContext
        let cdTodo = CDTodo(context: context)
        cdTodo.apply(todo, tagLookup: { _ in nil })
        try context.save()
        return Todo(managed: cdTodo)
    }

    @discardableResult
    public func update(_ todo: Todo) throws -> Todo {
        let context = controller.viewContext
        guard let cdTodo = try fetchManaged(id: todo.id, in: context) else {
            throw TodoStoreError.notFound(todo.id)
        }
        var updated = todo
        updated.updatedAt = .now
        cdTodo.apply(updated, tagLookup: { id in
            try? Self.fetchManagedTag(id: id, in: context)
        })
        try context.save()
        return Todo(managed: cdTodo)
    }

    public func softDelete(id: UUID) throws {
        let context = controller.viewContext
        guard let cdTodo = try fetchManaged(id: id, in: context) else {
            throw TodoStoreError.notFound(id)
        }
        let now = Date.now
        cdTodo.deletedAt = now
        cdTodo.updatedAt = now
        try context.save()
    }

    public func complete(id: UUID) throws {
        let context = controller.viewContext
        guard let cdTodo = try fetchManaged(id: id, in: context) else {
            throw TodoStoreError.notFound(id)
        }
        let now = Date.now
        cdTodo.completedAt = now
        cdTodo.updatedAt = now
        try context.save()
    }

    public func uncomplete(id: UUID) throws {
        let context = controller.viewContext
        guard let cdTodo = try fetchManaged(id: id, in: context) else {
            throw TodoStoreError.notFound(id)
        }
        cdTodo.completedAt = nil
        cdTodo.updatedAt = .now
        try context.save()
    }

    // MARK: Private

    private func fetchManaged(id: UUID, in context: NSManagedObjectContext) throws -> CDTodo? {
        let request = CDTodo.fetchRequest()
        request.predicate = NSPredicate(format: "id == %@", id as CVarArg)
        request.fetchLimit = 1
        return try context.fetch(request).first
    }

    static func fetchManagedTag(id: UUID, in context: NSManagedObjectContext) throws -> CDTag? {
        let request = CDTag.fetchRequest()
        request.predicate = NSPredicate(format: "id == %@", id as CVarArg)
        request.fetchLimit = 1
        return try context.fetch(request).first
    }

    private static func predicate(list: TodoList, includeCompleted: Bool) -> NSPredicate {
        var clauses: [NSPredicate] = [
            NSPredicate(format: "deletedAt == nil"),
            NSPredicate(format: "list == %d", list.rawValue)
        ]
        if !includeCompleted {
            clauses.append(NSPredicate(format: "completedAt == nil"))
        }
        return NSCompoundPredicate(andPredicateWithSubpredicates: clauses)
    }

    private static var defaultSortDescriptors: [NSSortDescriptor] {
        [
            NSSortDescriptor(key: "dueDate", ascending: true),
            NSSortDescriptor(key: "createdAt", ascending: false)
        ]
    }
}
