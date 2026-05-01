import Foundation
import CoreData

@objc(CDAttachment)
public final class CDAttachment: NSManagedObject {
    @nonobjc public class func fetchRequest() -> NSFetchRequest<CDAttachment> {
        NSFetchRequest<CDAttachment>(entityName: "CDAttachment")
    }

    @NSManaged public var id: UUID?
    @NSManaged public var dashboardID: UUID?
    @NSManaged public var name: String?
    @NSManaged public var mimeType: String?
    @NSManaged public var sizeBytes: Int64
    @NSManaged public var source: Int16
    @NSManaged public var dropboxPath: String?
    @NSManaged public var addedAt: Date?
    /// Allows External Storage is set on the model — large blobs go to disk
    /// outside the SQLite store, and CloudKit treats them as `CKAsset`s.
    @NSManaged public var data: Data?
}
