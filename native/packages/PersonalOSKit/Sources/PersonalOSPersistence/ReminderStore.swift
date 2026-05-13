import Foundation
import CoreData
import PersonalOSModels

public enum ReminderStoreError: Error, Sendable {
    case notFound(UUID)
}

@MainActor
public struct ReminderStore: Sendable {
    private let controller: PersistenceController

    nonisolated public init(controller: PersistenceController) {
        self.controller = controller
    }

    public func fetchAll() throws -> [ReminderRule] {
        let request = CDReminderRule.fetchRequest()
        request.sortDescriptors = [NSSortDescriptor(key: "createdAt", ascending: true)]
        return try controller.viewContext.fetch(request).map(ReminderRule.init(managed:))
    }

    public func fetch(dashboardID: UUID) throws -> [ReminderRule] {
        let request = CDReminderRule.fetchRequest()
        request.predicate = NSPredicate(format: "dashboardID == %@", dashboardID as CVarArg)
        request.sortDescriptors = [NSSortDescriptor(key: "createdAt", ascending: true)]
        return try controller.viewContext.fetch(request).map(ReminderRule.init(managed:))
    }

    public func fetch(id: UUID) throws -> ReminderRule? {
        try fetchManaged(id: id, in: controller.viewContext).map(ReminderRule.init(managed:))
    }

    /// Fetch enabled rules whose nextFireAt is on or before `cutoff`.
    /// Used by `ReminderEngine.tick`.
    public func fetchDue(by cutoff: Date) throws -> [ReminderRule] {
        let request = CDReminderRule.fetchRequest()
        request.predicate = NSPredicate(
            format: "enabled == YES AND nextFireAt != nil AND nextFireAt <= %@",
            cutoff as NSDate
        )
        request.sortDescriptors = [NSSortDescriptor(key: "nextFireAt", ascending: true)]
        return try controller.viewContext.fetch(request).map(ReminderRule.init(managed:))
    }

    @discardableResult
    public func create(_ rule: ReminderRule) throws -> ReminderRule {
        let context = controller.viewContext
        let cd = CDReminderRule(context: context)
        cd.apply(rule)
        try context.save()
        return ReminderRule(managed: cd)
    }

    @discardableResult
    public func update(_ rule: ReminderRule) throws -> ReminderRule {
        let context = controller.viewContext
        guard let cd = try fetchManaged(id: rule.id, in: context) else {
            throw ReminderStoreError.notFound(rule.id)
        }
        var updated = rule
        updated.updatedAt = .now
        cd.apply(updated)
        try context.save()
        return ReminderRule(managed: cd)
    }

    public func delete(id: UUID) throws {
        let context = controller.viewContext
        guard let cd = try fetchManaged(id: id, in: context) else {
            throw ReminderStoreError.notFound(id)
        }
        context.delete(cd)
        try context.save()
    }

    public func deleteAll(dashboardID: UUID) throws {
        let request = CDReminderRule.fetchRequest()
        request.predicate = NSPredicate(format: "dashboardID == %@", dashboardID as CVarArg)
        let context = controller.viewContext
        for cd in try context.fetch(request) {
            context.delete(cd)
        }
        if context.hasChanges {
            try context.save()
        }
    }

    private func fetchManaged(id: UUID, in context: NSManagedObjectContext) throws -> CDReminderRule? {
        let request = CDReminderRule.fetchRequest()
        request.predicate = NSPredicate(format: "id == %@", id as CVarArg)
        request.fetchLimit = 1
        return try context.fetch(request).first
    }
}
