import Foundation
import CoreData

@objc(CDTodo)
public final class CDTodo: NSManagedObject {
    @nonobjc public class func fetchRequest() -> NSFetchRequest<CDTodo> {
        NSFetchRequest<CDTodo>(entityName: "CDTodo")
    }

    @NSManaged public var id: UUID?
    @NSManaged public var title: String?
    @NSManaged public var notes: String?
    @NSManaged public var list: Int16
    @NSManaged public var dueDate: Date?
    @NSManaged public var snoozedUntil: Date?
    @NSManaged public var completedAt: Date?
    @NSManaged public var deletedAt: Date?
    @NSManaged public var source: Int16
    @NSManaged public var externalID: String?
    @NSManaged public var createdAt: Date?
    @NSManaged public var updatedAt: Date?
    @NSManaged public var tags: NSSet?
}

extension CDTodo {
    @objc(addTagsObject:)
    @NSManaged public func addToTags(_ value: CDTag)

    @objc(removeTagsObject:)
    @NSManaged public func removeFromTags(_ value: CDTag)

    @objc(addTags:)
    @NSManaged public func addToTags(_ values: NSSet)

    @objc(removeTags:)
    @NSManaged public func removeFromTags(_ values: NSSet)
}
