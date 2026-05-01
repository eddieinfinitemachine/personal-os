import Foundation
import CoreData
import PersonalOSModels

public enum TagStoreError: Error, Sendable {
    case notFound(UUID)
}

@MainActor
public struct TagStore: Sendable {
    private let controller: PersistenceController

    nonisolated public init(controller: PersistenceController) {
        self.controller = controller
    }

    public func fetchAll() throws -> [Tag] {
        let request = CDTag.fetchRequest()
        request.sortDescriptors = [NSSortDescriptor(key: "name", ascending: true)]
        return try controller.viewContext.fetch(request).map(Tag.init(managed:))
    }

    @discardableResult
    public func create(_ tag: Tag) throws -> Tag {
        let context = controller.viewContext
        let cdTag = CDTag(context: context)
        cdTag.apply(tag)
        try context.save()
        return Tag(managed: cdTag)
    }

    @discardableResult
    public func update(_ tag: Tag) throws -> Tag {
        let context = controller.viewContext
        guard let cdTag = try fetchManaged(id: tag.id, in: context) else {
            throw TagStoreError.notFound(tag.id)
        }
        var updated = tag
        updated.updatedAt = .now
        cdTag.apply(updated)
        try context.save()
        return Tag(managed: cdTag)
    }

    public func delete(id: UUID) throws {
        let context = controller.viewContext
        guard let cdTag = try fetchManaged(id: id, in: context) else {
            throw TagStoreError.notFound(id)
        }
        context.delete(cdTag)
        try context.save()
    }

    private func fetchManaged(id: UUID, in context: NSManagedObjectContext) throws -> CDTag? {
        let request = CDTag.fetchRequest()
        request.predicate = NSPredicate(format: "id == %@", id as CVarArg)
        request.fetchLimit = 1
        return try context.fetch(request).first
    }
}
