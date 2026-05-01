import Foundation
import CoreData

enum ManagedObjectModelBuilder {
    /// Cached singleton — Core Data raises warnings if multiple NSManagedObjectModel
    /// instances claim the same Swift subclass, so all containers share one model.
    nonisolated(unsafe) static let shared: NSManagedObjectModel = build()

    static func make() -> NSManagedObjectModel { shared }

    private static func build() -> NSManagedObjectModel {
        let model = NSManagedObjectModel()

        let todoEntity = NSEntityDescription()
        todoEntity.name = "CDTodo"
        todoEntity.managedObjectClassName = NSStringFromClass(CDTodo.self)

        let tagEntity = NSEntityDescription()
        tagEntity.name = "CDTag"
        tagEntity.managedObjectClassName = NSStringFromClass(CDTag.self)

        // CDTodo attributes
        todoEntity.properties = [
            attribute("id", type: .UUIDAttributeType),
            attribute("title", type: .stringAttributeType),
            attribute("notes", type: .stringAttributeType),
            attribute("list", type: .integer16AttributeType, defaultValue: 0),
            attribute("dueDate", type: .dateAttributeType),
            attribute("snoozedUntil", type: .dateAttributeType),
            attribute("completedAt", type: .dateAttributeType),
            attribute("deletedAt", type: .dateAttributeType),
            attribute("source", type: .integer16AttributeType, defaultValue: 0),
            attribute("externalID", type: .stringAttributeType),
            attribute("createdAt", type: .dateAttributeType),
            attribute("updatedAt", type: .dateAttributeType)
        ]

        // CDTag attributes
        tagEntity.properties = [
            attribute("id", type: .UUIDAttributeType),
            attribute("name", type: .stringAttributeType),
            attribute("color", type: .stringAttributeType, defaultValue: "#9CA3AF"),
            attribute("createdAt", type: .dateAttributeType),
            attribute("updatedAt", type: .dateAttributeType)
        ]

        // Many-to-many relationship: Todo.tags <-> Tag.todos
        let todosToTags = NSRelationshipDescription()
        todosToTags.name = "tags"
        todosToTags.destinationEntity = tagEntity
        todosToTags.minCount = 0
        todosToTags.maxCount = 0 // 0 means unbounded for to-many
        todosToTags.deleteRule = .nullifyDeleteRule
        todosToTags.isOptional = true

        let tagsToTodos = NSRelationshipDescription()
        tagsToTodos.name = "todos"
        tagsToTodos.destinationEntity = todoEntity
        tagsToTodos.minCount = 0
        tagsToTodos.maxCount = 0
        tagsToTodos.deleteRule = .nullifyDeleteRule
        tagsToTodos.isOptional = true

        todosToTags.inverseRelationship = tagsToTodos
        tagsToTodos.inverseRelationship = todosToTags

        todoEntity.properties.append(todosToTags)
        tagEntity.properties.append(tagsToTodos)

        model.entities = [todoEntity, tagEntity]
        return model
    }

    private static func attribute(
        _ name: String,
        type: NSAttributeType,
        defaultValue: Any? = nil
    ) -> NSAttributeDescription {
        let attr = NSAttributeDescription()
        attr.name = name
        attr.attributeType = type
        attr.isOptional = true // CloudKit requires all attributes optional
        if let defaultValue {
            attr.defaultValue = defaultValue
        }
        return attr
    }
}
