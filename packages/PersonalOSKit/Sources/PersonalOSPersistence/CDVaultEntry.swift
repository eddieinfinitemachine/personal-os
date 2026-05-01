import Foundation
import CoreData

@objc(CDVaultEntry)
public final class CDVaultEntry: NSManagedObject {
    @nonobjc public class func fetchRequest() -> NSFetchRequest<CDVaultEntry> {
        NSFetchRequest<CDVaultEntry>(entityName: "CDVaultEntry")
    }

    @NSManaged public var id: UUID?
    @NSManaged public var label: String?
    @NSManaged public var category: String?
    @NSManaged public var notes: String?
    @NSManaged public var valueCiphertext: Data?
    @NSManaged public var createdAt: Date?
    @NSManaged public var updatedAt: Date?
}
