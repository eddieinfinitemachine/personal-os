import Foundation
import CoreData

@objc(CDFieldValue)
public final class CDFieldValue: NSManagedObject {
    @nonobjc public class func fetchRequest() -> NSFetchRequest<CDFieldValue> {
        NSFetchRequest<CDFieldValue>(entityName: "CDFieldValue")
    }

    @NSManaged public var id: UUID?
    @NSManaged public var label: String?
    @NSManaged public var kind: Int16
    @NSManaged public var position: Int16

    @NSManaged public var textValue: String?
    @NSManaged public var numberValue: NSNumber?
    @NSManaged public var dateValue: Date?
    @NSManaged public var decimalValue: NSDecimalNumber?

    @NSManaged public var dashboard: CDDashboard?
}
