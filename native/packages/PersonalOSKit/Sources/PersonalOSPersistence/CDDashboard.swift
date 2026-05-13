import Foundation
import CoreData

@objc(CDDashboard)
public final class CDDashboard: NSManagedObject {
    @nonobjc public class func fetchRequest() -> NSFetchRequest<CDDashboard> {
        NSFetchRequest<CDDashboard>(entityName: "CDDashboard")
    }

    @NSManaged public var id: UUID?
    @NSManaged public var name: String?
    @NSManaged public var type: String?
    @NSManaged public var icon: String?
    @NSManaged public var createdAt: Date?
    @NSManaged public var updatedAt: Date?
    @NSManaged public var fields: NSSet?
}

extension CDDashboard {
    @objc(addFieldsObject:)
    @NSManaged public func addToFields(_ value: CDFieldValue)

    @objc(removeFieldsObject:)
    @NSManaged public func removeFromFields(_ value: CDFieldValue)
}
