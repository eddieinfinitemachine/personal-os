import Foundation
import CoreData
import UniformTypeIdentifiers
import PersonalOSModels

public enum AttachmentStoreError: Error, Sendable {
    case notFound(UUID)
    case fileNotReadable(URL)
}

@MainActor
public struct AttachmentStore: Sendable {
    private let controller: PersistenceController

    nonisolated public init(controller: PersistenceController) {
        self.controller = controller
    }

    public func fetch(dashboardID: UUID) throws -> [Attachment] {
        let request = CDAttachment.fetchRequest()
        request.predicate = NSPredicate(format: "dashboardID == %@", dashboardID as CVarArg)
        request.sortDescriptors = [NSSortDescriptor(key: "addedAt", ascending: false)]
        return try controller.viewContext.fetch(request).map(Attachment.init(managed:))
    }

    public func data(for attachmentID: UUID) throws -> Data? {
        let context = controller.viewContext
        guard let cdAttachment = try fetchManaged(id: attachmentID, in: context) else {
            return nil
        }
        return cdAttachment.data
    }

    /// Import a local file. Reads the file, infers MIME type from path
    /// extension, stores the blob in Core Data (external storage handles disk
    /// offload). Caller is responsible for security-scoped resource access.
    @discardableResult
    public func importLocal(file url: URL, dashboardID: UUID) throws -> Attachment {
        guard FileManager.default.isReadableFile(atPath: url.path) else {
            throw AttachmentStoreError.fileNotReadable(url)
        }

        let data = try Data(contentsOf: url)
        let attributes = (try? FileManager.default.attributesOfItem(atPath: url.path)) ?? [:]
        let size = (attributes[.size] as? NSNumber)?.int64Value ?? Int64(data.count)

        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
            ?? "application/octet-stream"

        let attachment = Attachment(
            dashboardID: dashboardID,
            name: url.lastPathComponent,
            mimeType: mime,
            sizeBytes: size,
            source: .local
        )

        let context = controller.viewContext
        let cd = CDAttachment(context: context)
        cd.applyMetadata(attachment)
        cd.data = data

        try context.save()
        return attachment
    }

    public func delete(id: UUID) throws {
        let context = controller.viewContext
        guard let cd = try fetchManaged(id: id, in: context) else {
            throw AttachmentStoreError.notFound(id)
        }
        context.delete(cd)
        try context.save()
    }

    /// Delete all attachments for a dashboard. Used when the dashboard is
    /// deleted (no Core Data cascade because the FK is soft).
    public func deleteAll(dashboardID: UUID) throws {
        let request = CDAttachment.fetchRequest()
        request.predicate = NSPredicate(format: "dashboardID == %@", dashboardID as CVarArg)
        let context = controller.viewContext
        for cd in try context.fetch(request) {
            context.delete(cd)
        }
        if context.hasChanges {
            try context.save()
        }
    }

    private func fetchManaged(id: UUID, in context: NSManagedObjectContext) throws -> CDAttachment? {
        let request = CDAttachment.fetchRequest()
        request.predicate = NSPredicate(format: "id == %@", id as CVarArg)
        request.fetchLimit = 1
        return try context.fetch(request).first
    }
}
