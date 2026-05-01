import Foundation
import CoreData
import os

public final class PersistenceController: @unchecked Sendable {
    public static let shared = PersistenceController()

    private static let logger = Logger(subsystem: "com.zelig.PersonalOS", category: "Persistence")

    /// Serializes container construction. The shared NSManagedObjectModel is
    /// mutated by NSPersistentContainer when adding stores; concurrent
    /// container init causes data corruption (e.g. lost relationships, ghost
    /// rows) under parallel tests. Construction is fast; the lock has no
    /// runtime impact once containers are loaded.
    nonisolated(unsafe) private static let setupLock = NSLock()

    public let container: NSPersistentContainer

    public var viewContext: NSManagedObjectContext { container.viewContext }

    public func newBackgroundContext() -> NSManagedObjectContext {
        let ctx = container.newBackgroundContext()
        ctx.automaticallyMergesChangesFromParent = true
        ctx.mergePolicy = NSMergePolicy(merge: .mergeByPropertyObjectTrumpMergePolicyType)
        return ctx
    }

    /// In-memory store for tests and previews. Uses plain NSPersistentContainer
    /// (no CloudKit) — the cloud machinery is irrelevant for unit tests and
    /// causes flakiness under parallel execution.
    public static func inMemory() -> PersistenceController {
        PersistenceController(inMemory: true)
    }

    public init(inMemory: Bool = false) {
        Self.setupLock.lock()
        defer { Self.setupLock.unlock() }

        let model = ManagedObjectModelBuilder.make()

        let container: NSPersistentContainer = inMemory
            ? NSPersistentContainer(name: "PersonalOSStore", managedObjectModel: model)
            : NSPersistentCloudKitContainer(name: "PersonalOSStore", managedObjectModel: model)

        guard let description = container.persistentStoreDescriptions.first else {
            preconditionFailure("No persistent store description")
        }

        if inMemory {
            description.type = NSInMemoryStoreType
            description.url = nil
            description.shouldAddStoreAsynchronously = false
        } else if let cloudContainer = container as? NSPersistentCloudKitContainer {
            _ = cloudContainer
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
