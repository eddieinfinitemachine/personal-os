import Foundation
import CoreData
import PersonalOSModels

extension Todo {
    init(managed: CDTodo) {
        self.init(
            id: managed.id ?? UUID(),
            title: managed.title ?? "",
            notes: managed.notes,
            list: TodoList(rawValue: managed.list) ?? .todo,
            dueDate: managed.dueDate,
            snoozedUntil: managed.snoozedUntil,
            completedAt: managed.completedAt,
            deletedAt: managed.deletedAt,
            source: TodoSource(rawValue: managed.source) ?? .manual,
            externalID: managed.externalID,
            tagIDs: Self.tagIDs(from: managed.tags),
            createdAt: managed.createdAt ?? .distantPast,
            updatedAt: managed.updatedAt ?? .distantPast
        )
    }

    private static func tagIDs(from set: NSSet?) -> Set<UUID> {
        guard let cdTags = set as? Set<CDTag> else { return [] }
        return Set(cdTags.compactMap { $0.id })
    }
}

extension CDTodo {
    func apply(_ todo: Todo, tagLookup: (UUID) -> CDTag?) {
        self.id = todo.id
        self.title = todo.title
        self.notes = todo.notes
        self.list = todo.list.rawValue
        self.dueDate = todo.dueDate
        self.snoozedUntil = todo.snoozedUntil
        self.completedAt = todo.completedAt
        self.deletedAt = todo.deletedAt
        self.source = todo.source.rawValue
        self.externalID = todo.externalID
        self.createdAt = todo.createdAt
        self.updatedAt = todo.updatedAt

        let resolvedTags = todo.tagIDs.compactMap(tagLookup)
        self.tags = NSSet(array: resolvedTags)
    }
}

extension Tag {
    init(managed: CDTag) {
        self.init(
            id: managed.id ?? UUID(),
            name: managed.name ?? "",
            color: managed.color ?? "#9CA3AF",
            createdAt: managed.createdAt ?? .distantPast,
            updatedAt: managed.updatedAt ?? .distantPast
        )
    }
}

extension CDTag {
    func apply(_ tag: Tag) {
        self.id = tag.id
        self.name = tag.name
        self.color = tag.color
        self.createdAt = tag.createdAt
        self.updatedAt = tag.updatedAt
    }
}
