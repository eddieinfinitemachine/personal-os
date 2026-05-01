import Foundation
import CoreData

enum ManagedObjectModelBuilder {
    /// Cached singleton — Core Data raises "Multiple NSEntityDescriptions
    /// claim the NSManagedObject subclass" warnings (and crashes when setting
    /// values) if multiple model instances claim the same Swift class. All
    /// containers share one model.
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

        let personEntity = NSEntityDescription()
        personEntity.name = "CDPerson"
        personEntity.managedObjectClassName = NSStringFromClass(CDPerson.self)

        let dashboardEntity = NSEntityDescription()
        dashboardEntity.name = "CDDashboard"
        dashboardEntity.managedObjectClassName = NSStringFromClass(CDDashboard.self)

        let fieldValueEntity = NSEntityDescription()
        fieldValueEntity.name = "CDFieldValue"
        fieldValueEntity.managedObjectClassName = NSStringFromClass(CDFieldValue.self)

        let attachmentEntity = NSEntityDescription()
        attachmentEntity.name = "CDAttachment"
        attachmentEntity.managedObjectClassName = NSStringFromClass(CDAttachment.self)

        let reminderEntity = NSEntityDescription()
        reminderEntity.name = "CDReminderRule"
        reminderEntity.managedObjectClassName = NSStringFromClass(CDReminderRule.self)

        let vaultEntity = NSEntityDescription()
        vaultEntity.name = "CDVaultEntry"
        vaultEntity.managedObjectClassName = NSStringFromClass(CDVaultEntry.self)

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

        // CDDashboard attributes
        dashboardEntity.properties = [
            attribute("id", type: .UUIDAttributeType),
            attribute("name", type: .stringAttributeType),
            attribute("type", type: .stringAttributeType, defaultValue: "general"),
            attribute("icon", type: .stringAttributeType, defaultValue: "square.grid.2x2"),
            attribute("createdAt", type: .dateAttributeType),
            attribute("updatedAt", type: .dateAttributeType)
        ]

        // CDAttachment attributes — `data` uses external storage for blobs
        let dataAttribute = NSAttributeDescription()
        dataAttribute.name = "data"
        dataAttribute.attributeType = .binaryDataAttributeType
        dataAttribute.isOptional = true
        dataAttribute.allowsExternalBinaryDataStorage = true

        attachmentEntity.properties = [
            attribute("id", type: .UUIDAttributeType),
            attribute("dashboardID", type: .UUIDAttributeType),
            attribute("name", type: .stringAttributeType),
            attribute("mimeType", type: .stringAttributeType),
            attribute("sizeBytes", type: .integer64AttributeType, defaultValue: 0),
            attribute("source", type: .integer16AttributeType, defaultValue: 0),
            attribute("dropboxPath", type: .stringAttributeType),
            attribute("addedAt", type: .dateAttributeType),
            dataAttribute
        ]

        // CDVaultEntry attributes — `valueCiphertext` is opaque ECIES blob
        vaultEntity.properties = [
            attribute("id", type: .UUIDAttributeType),
            attribute("label", type: .stringAttributeType),
            attribute("category", type: .stringAttributeType),
            attribute("notes", type: .stringAttributeType),
            attribute("valueCiphertext", type: .binaryDataAttributeType),
            attribute("createdAt", type: .dateAttributeType),
            attribute("updatedAt", type: .dateAttributeType)
        ]

        // CDReminderRule attributes — soft FK to dashboard / field
        reminderEntity.properties = [
            attribute("id", type: .UUIDAttributeType),
            attribute("dashboardID", type: .UUIDAttributeType),
            attribute("fieldID", type: .UUIDAttributeType),
            attribute("name", type: .stringAttributeType),
            attribute("kind", type: .integer16AttributeType, defaultValue: 0),
            attribute("configJSON", type: .stringAttributeType),
            attribute("action", type: .integer16AttributeType, defaultValue: 0),
            attribute("nextFireAt", type: .dateAttributeType),
            attribute("lastFiredAt", type: .dateAttributeType),
            attribute("enabled", type: .booleanAttributeType, defaultValue: true),
            attribute("createdAt", type: .dateAttributeType),
            attribute("updatedAt", type: .dateAttributeType)
        ]

        // CDFieldValue attributes
        fieldValueEntity.properties = [
            attribute("id", type: .UUIDAttributeType),
            attribute("label", type: .stringAttributeType),
            attribute("kind", type: .integer16AttributeType, defaultValue: 0),
            attribute("position", type: .integer16AttributeType, defaultValue: 0),
            attribute("textValue", type: .stringAttributeType),
            attribute("numberValue", type: .doubleAttributeType),
            attribute("dateValue", type: .dateAttributeType),
            attribute("decimalValue", type: .decimalAttributeType)
        ]

        // CDPerson attributes
        personEntity.properties = [
            attribute("id", type: .UUIDAttributeType),
            attribute("name", type: .stringAttributeType),
            attribute("role", type: .integer16AttributeType, defaultValue: 3),
            attribute("team", type: .stringAttributeType),
            attribute("contactRef", type: .stringAttributeType),
            attribute("notes", type: .stringAttributeType),
            attribute("birthday", type: .dateAttributeType),
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

        // Many-to-many: Todo.people <-> Person.todos
        let todosToPeople = NSRelationshipDescription()
        todosToPeople.name = "people"
        todosToPeople.destinationEntity = personEntity
        todosToPeople.minCount = 0
        todosToPeople.maxCount = 0
        todosToPeople.deleteRule = .nullifyDeleteRule
        todosToPeople.isOptional = true

        let peopleToTodos = NSRelationshipDescription()
        peopleToTodos.name = "todos"
        peopleToTodos.destinationEntity = todoEntity
        peopleToTodos.minCount = 0
        peopleToTodos.maxCount = 0
        peopleToTodos.deleteRule = .nullifyDeleteRule
        peopleToTodos.isOptional = true

        todosToPeople.inverseRelationship = peopleToTodos
        peopleToTodos.inverseRelationship = todosToPeople

        todoEntity.properties.append(todosToPeople)
        personEntity.properties.append(peopleToTodos)

        // One-to-many: Dashboard.fields <-> FieldValue.dashboard (cascade delete)
        let dashboardToFields = NSRelationshipDescription()
        dashboardToFields.name = "fields"
        dashboardToFields.destinationEntity = fieldValueEntity
        dashboardToFields.minCount = 0
        dashboardToFields.maxCount = 0
        dashboardToFields.deleteRule = .cascadeDeleteRule
        dashboardToFields.isOptional = true

        let fieldToDashboard = NSRelationshipDescription()
        fieldToDashboard.name = "dashboard"
        fieldToDashboard.destinationEntity = dashboardEntity
        fieldToDashboard.minCount = 0
        fieldToDashboard.maxCount = 1
        fieldToDashboard.deleteRule = .nullifyDeleteRule
        fieldToDashboard.isOptional = true

        dashboardToFields.inverseRelationship = fieldToDashboard
        fieldToDashboard.inverseRelationship = dashboardToFields

        dashboardEntity.properties.append(dashboardToFields)
        fieldValueEntity.properties.append(fieldToDashboard)

        model.entities = [
            todoEntity, tagEntity, personEntity,
            dashboardEntity, fieldValueEntity, attachmentEntity,
            reminderEntity, vaultEntity
        ]
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
