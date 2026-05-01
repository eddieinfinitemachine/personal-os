import Foundation
import CoreData

@objc(CDReminderRule)
public final class CDReminderRule: NSManagedObject {
    @nonobjc public class func fetchRequest() -> NSFetchRequest<CDReminderRule> {
        NSFetchRequest<CDReminderRule>(entityName: "CDReminderRule")
    }

    @NSManaged public var id: UUID?
    @NSManaged public var dashboardID: UUID?
    @NSManaged public var fieldID: UUID?
    @NSManaged public var name: String?
    @NSManaged public var kind: Int16
    /// JSON-encoded ReminderConfig.
    @NSManaged public var configJSON: String?
    @NSManaged public var action: Int16
    @NSManaged public var nextFireAt: Date?
    @NSManaged public var lastFiredAt: Date?
    @NSManaged public var enabled: Bool
    @NSManaged public var createdAt: Date?
    @NSManaged public var updatedAt: Date?
}
