import Foundation
import CoreData
import PersonalOSModels

public enum DashboardStoreError: Error, Sendable {
    case notFound(UUID)
    case fieldNotFound(UUID)
}

@MainActor
public struct DashboardStore: Sendable {
    private let controller: PersistenceController

    nonisolated public init(controller: PersistenceController) {
        self.controller = controller
    }

    // MARK: Reads

    public func fetchAll() throws -> [Dashboard] {
        let request = CDDashboard.fetchRequest()
        request.sortDescriptors = [NSSortDescriptor(key: "name", ascending: true)]
        return try controller.viewContext.fetch(request).map(Dashboard.init(managed:))
    }

    public func fetch(id: UUID) throws -> Dashboard? {
        try fetchManaged(id: id, in: controller.viewContext)
            .map(Dashboard.init(managed:))
    }

    // MARK: Dashboard CRUD

    @discardableResult
    public func create(_ dashboard: Dashboard) throws -> Dashboard {
        let context = controller.viewContext
        let cdDashboard = CDDashboard(context: context)
        cdDashboard.applyScalars(dashboard)
        // Initial fields, if any
        for field in dashboard.fields {
            let cdField = CDFieldValue(context: context)
            cdField.apply(field)
            cdField.dashboard = cdDashboard
        }
        try context.save()
        return Dashboard(managed: cdDashboard)
    }

    @discardableResult
    public func update(_ dashboard: Dashboard) throws -> Dashboard {
        let context = controller.viewContext
        guard let cdDashboard = try fetchManaged(id: dashboard.id, in: context) else {
            throw DashboardStoreError.notFound(dashboard.id)
        }

        var updated = dashboard
        updated.updatedAt = .now
        cdDashboard.applyScalars(updated)

        // Reconcile fields by id: update existing, insert missing, delete dropped.
        let existingByID = Dictionary(
            uniqueKeysWithValues: ((cdDashboard.fields as? Set<CDFieldValue>) ?? [])
                .compactMap { cd -> (UUID, CDFieldValue)? in
                    guard let id = cd.id else { return nil }
                    return (id, cd)
                }
        )
        var seenIDs = Set<UUID>()

        for field in updated.fields {
            seenIDs.insert(field.id)
            if let existing = existingByID[field.id] {
                existing.apply(field)
            } else {
                let cdField = CDFieldValue(context: context)
                cdField.apply(field)
                cdField.dashboard = cdDashboard
            }
        }

        for (id, cdField) in existingByID where !seenIDs.contains(id) {
            context.delete(cdField)
        }

        try context.save()
        return Dashboard(managed: cdDashboard)
    }

    public func delete(id: UUID) throws {
        let context = controller.viewContext
        guard let cdDashboard = try fetchManaged(id: id, in: context) else {
            throw DashboardStoreError.notFound(id)
        }
        context.delete(cdDashboard) // cascades to fields via deletion rule

        // Soft-FK cascade: attachments reference dashboardID directly, not
        // via a Core Data relationship. Clean them up here.
        let attachmentRequest = CDAttachment.fetchRequest()
        attachmentRequest.predicate = NSPredicate(format: "dashboardID == %@", id as CVarArg)
        for orphan in try context.fetch(attachmentRequest) {
            context.delete(orphan)
        }

        // Same for reminder rules.
        let reminderRequest = CDReminderRule.fetchRequest()
        reminderRequest.predicate = NSPredicate(format: "dashboardID == %@", id as CVarArg)
        for orphan in try context.fetch(reminderRequest) {
            context.delete(orphan)
        }

        try context.save()
    }

    // MARK: Field convenience

    @discardableResult
    public func addField(
        toDashboardID dashboardID: UUID,
        kind: FieldKind,
        label: String
    ) throws -> Dashboard {
        let context = controller.viewContext
        guard let cdDashboard = try fetchManaged(id: dashboardID, in: context) else {
            throw DashboardStoreError.notFound(dashboardID)
        }
        let nextPosition = Int16(((cdDashboard.fields as? Set<CDFieldValue>) ?? []).count)
        let field = FieldValue.empty(kind: kind, label: label, position: nextPosition)
        let cdField = CDFieldValue(context: context)
        cdField.apply(field)
        cdField.dashboard = cdDashboard
        cdDashboard.updatedAt = .now
        try context.save()
        return Dashboard(managed: cdDashboard)
    }

    public func removeField(_ fieldID: UUID, fromDashboardID dashboardID: UUID) throws {
        let context = controller.viewContext
        guard let cdDashboard = try fetchManaged(id: dashboardID, in: context) else {
            throw DashboardStoreError.notFound(dashboardID)
        }
        let cdFields = (cdDashboard.fields as? Set<CDFieldValue>) ?? []
        guard let target = cdFields.first(where: { $0.id == fieldID }) else {
            throw DashboardStoreError.fieldNotFound(fieldID)
        }
        context.delete(target)
        cdDashboard.updatedAt = .now
        try context.save()
    }

    // MARK: Private

    private func fetchManaged(id: UUID, in context: NSManagedObjectContext) throws -> CDDashboard? {
        let request = CDDashboard.fetchRequest()
        request.predicate = NSPredicate(format: "id == %@", id as CVarArg)
        request.fetchLimit = 1
        return try context.fetch(request).first
    }
}
