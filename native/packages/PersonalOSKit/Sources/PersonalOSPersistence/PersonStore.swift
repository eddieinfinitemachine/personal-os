import Foundation
import CoreData
import PersonalOSModels

public enum PersonStoreError: Error, Sendable {
    case notFound(UUID)
}

@MainActor
public struct PersonStore: Sendable {
    private let controller: PersistenceController

    nonisolated public init(controller: PersistenceController) {
        self.controller = controller
    }

    public func fetchAll() throws -> [Person] {
        let request = CDPerson.fetchRequest()
        request.sortDescriptors = [NSSortDescriptor(key: "name", ascending: true)]
        return try controller.viewContext.fetch(request).map(Person.init(managed:))
    }

    public func fetch(role: PersonRole) throws -> [Person] {
        let request = CDPerson.fetchRequest()
        request.predicate = NSPredicate(format: "role == %d", role.rawValue)
        request.sortDescriptors = [NSSortDescriptor(key: "name", ascending: true)]
        return try controller.viewContext.fetch(request).map(Person.init(managed:))
    }

    public func fetch(id: UUID) throws -> Person? {
        try fetchManaged(id: id, in: controller.viewContext)
            .map(Person.init(managed:))
    }

    @discardableResult
    public func create(_ person: Person) throws -> Person {
        let context = controller.viewContext
        let cdPerson = CDPerson(context: context)
        cdPerson.apply(person)
        try context.save()
        return Person(managed: cdPerson)
    }

    @discardableResult
    public func update(_ person: Person) throws -> Person {
        let context = controller.viewContext
        guard let cdPerson = try fetchManaged(id: person.id, in: context) else {
            throw PersonStoreError.notFound(person.id)
        }
        var updated = person
        updated.updatedAt = .now
        cdPerson.apply(updated)
        try context.save()
        return Person(managed: cdPerson)
    }

    public func delete(id: UUID) throws {
        let context = controller.viewContext
        guard let cdPerson = try fetchManaged(id: id, in: context) else {
            throw PersonStoreError.notFound(id)
        }
        context.delete(cdPerson)
        try context.save()
    }

    static func fetchManaged(id: UUID, in context: NSManagedObjectContext) throws -> CDPerson? {
        let request = CDPerson.fetchRequest()
        request.predicate = NSPredicate(format: "id == %@", id as CVarArg)
        request.fetchLimit = 1
        return try context.fetch(request).first
    }

    private func fetchManaged(id: UUID, in context: NSManagedObjectContext) throws -> CDPerson? {
        try Self.fetchManaged(id: id, in: context)
    }
}
