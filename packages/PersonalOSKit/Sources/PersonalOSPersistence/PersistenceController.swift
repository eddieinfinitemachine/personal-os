import Foundation
import CoreData
import os

public final class PersistenceController: @unchecked Sendable {
    public static let shared = PersistenceController()

    private static let logger = Logger(subsystem: "com.zelig.PersonalOS", category: "Persistence")

    public let container: NSPersistentCloudKitContainer

    public var viewContext: NSManagedObjectContext { container.viewContext }

    public func newBackgroundContext() -> NSManagedObjectContext {
        let ctx = container.newBackgroundContext()
        ctx.automaticallyMergesChangesFromParent = true
        ctx.mergePolicy = NSMergePolicy(merge: .mergeByPropertyObjectTrumpMergePolicyType)
        return ctx
    }

    /// In-memory store for tests and previews. CloudKit is disabled.
    public static func inMemory() -> PersistenceController {
        PersistenceController(inMemory: true)
    }

    public init(inMemory: Bool = false) {
        let model = ManagedObjectModelBuilder.make()
        let container = NSPersistentCloudKitContainer(name: "PersonalOSStore", managedObjectModel: model)
        guard let description = container.persistentStoreDescriptions.first else {
            preconditionFailure("No persistent store description")
        }

        if inMemory {
            description.url = URL(fileURLWithPath: "/dev/null")
            description.cloudKitContainerOptions = nil
        } else {
            description.cloudKitContainerOptions = NSPersistentCloudKitContainerOptions(
                containerIdentifier: PersonalOSPersistence.cloudKitContainerIdentifier
            )
            description.setOption(true as NSNumber, forKey: NSPersistentHistoryTrackingKey)
            description.setOption(
                true as NSNumber,
                forKey: NSPersistentStoreRemoteChangeNotificationPostOptionKey
            )
        }

        container.loadPersistentStores { _, error in
            if let error {
                Self.logger.error("Failed to load persistent store: \(error.localizedDescription, privacy: .public)")
                preconditionFailure("Failed to load persistent store: \(error)")
            }
        }

        container.viewContext.automaticallyMergesChangesFromParent = true
        container.viewContext.mergePolicy = NSMergePolicy(merge: .mergeByPropertyObjectTrumpMergePolicyType)

        self.container = container
    }
}
