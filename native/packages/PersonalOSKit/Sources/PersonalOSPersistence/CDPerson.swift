import Foundation
import CoreData

@objc(CDPerson)
public final class CDPerson: NSManagedObject {
    @nonobjc public class func fetchRequest() -> NSFetchRequest<CDPerson> {
        NSFetchRequest<CDPerson>(entityName: "CDPerson")
    }

    @NSManaged public var id: UUID?
    @NSManaged public var name: String?
    @NSManaged public var role: Int16
    @NSManaged public var team: String?
    @NSManaged public var contactRef: String?
    @NSManaged public var notes: String?
    @NSManaged public var birthday: Date?
    @NSManaged public var createdAt: Date?
    @NSManaged public var updatedAt: Date?
    @NSManaged public var todos: NSSet?
}

extension CDPerson {
    @objc(addTodosObject:)
    @NSManaged public func addToTodos(_ value: CDTodo)

    @objc(removeTodosObject:)
    @NSManaged public func removeFromTodos(_ value: CDTodo)
}
