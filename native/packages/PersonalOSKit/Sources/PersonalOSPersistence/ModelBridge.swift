import Foundation
import CoreData
import PersonalOSModels

extension Todo {
    init(managed: CDTodo) {
        self.init(
            id: managed.id ?? UUID(),
            title: managed.title ?? "",
            notes: managed.notes,
            list: TodoList(rawValue: managed.list) ?? .todo,
            dueDate: managed.dueDate,
            snoozedUntil: managed.snoozedUntil,
            completedAt: managed.completedAt,
            deletedAt: managed.deletedAt,
            source: TodoSource(rawValue: managed.source) ?? .manual,
            externalID: managed.externalID,
            tagIDs: Self.tagIDs(from: managed.tags),
            personIDs: Self.personIDs(from: managed.people),
            createdAt: managed.createdAt ?? .distantPast,
            updatedAt: managed.updatedAt ?? .distantPast
        )
    }

    private static func tagIDs(from set: NSSet?) -> Set<UUID> {
        guard let cdTags = set as? Set<CDTag> else { return [] }
        return Set(cdTags.compactMap { $0.id })
    }

    private static func personIDs(from set: NSSet?) -> Set<UUID> {
        guard let cdPeople = set as? Set<CDPerson> else { return [] }
        return Set(cdPeople.compactMap { $0.id })
    }
}

extension CDTodo {
    func apply(
        _ todo: Todo,
        tagLookup: (UUID) -> CDTag?,
        personLookup: (UUID) -> CDPerson? = { _ in nil }
    ) {
        self.id = todo.id
        self.title = todo.title
        self.notes = todo.notes
        self.list = todo.list.rawValue
        self.dueDate = todo.dueDate
        self.snoozedUntil = todo.snoozedUntil
        self.completedAt = todo.completedAt
        self.deletedAt = todo.deletedAt
        self.source = todo.source.rawValue
        self.externalID = todo.externalID
        self.createdAt = todo.createdAt
        self.updatedAt = todo.updatedAt

        let resolvedTags = todo.tagIDs.compactMap(tagLookup)
        self.tags = NSSet(array: resolvedTags)

        let resolvedPeople = todo.personIDs.compactMap(personLookup)
        self.people = NSSet(array: resolvedPeople)
    }
}

extension Person {
    init(managed: CDPerson) {
        self.init(
            id: managed.id ?? UUID(),
            name: managed.name ?? "",
            role: PersonRole(rawValue: managed.role) ?? .other,
            team: managed.team,
            contactRef: managed.contactRef,
            notes: managed.notes,
            birthday: managed.birthday,
            createdAt: managed.createdAt ?? .distantPast,
            updatedAt: managed.updatedAt ?? .distantPast
        )
    }
}

extension CDPerson {
    func apply(_ person: Person) {
        self.id = person.id
        self.name = person.name
        self.role = person.role.rawValue
        self.team = person.team
        self.contactRef = person.contactRef
        self.notes = person.notes
        self.birthday = person.birthday
        self.createdAt = person.createdAt
        self.updatedAt = person.updatedAt
    }
}

extension Dashboard {
    init(managed: CDDashboard) {
        let cdFields = (managed.fields as? Set<CDFieldValue>) ?? []
        let fields = cdFields.map(FieldValue.init(managed:))
        self.init(
            id: managed.id ?? UUID(),
            name: managed.name ?? "",
            type: managed.type ?? "general",
            icon: managed.icon ?? "square.grid.2x2",
            fields: fields,
            createdAt: managed.createdAt ?? .distantPast,
            updatedAt: managed.updatedAt ?? .distantPast
        )
    }
}

extension CDDashboard {
    /// Apply scalar fields. Caller is responsible for syncing the `fields`
    /// relationship — see `DashboardStore.update`.
    func applyScalars(_ dashboard: Dashboard) {
        self.id = dashboard.id
        self.name = dashboard.name
        self.type = dashboard.type
        self.icon = dashboard.icon
        self.createdAt = dashboard.createdAt
        self.updatedAt = dashboard.updatedAt
    }
}

extension FieldValue {
    init(managed: CDFieldValue) {
        self.init(
            id: managed.id ?? UUID(),
            label: managed.label ?? "",
            kind: FieldKind(rawValue: managed.kind) ?? .text,
            position: managed.position,
            textValue: managed.textValue,
            numberValue: managed.numberValue?.doubleValue,
            dateValue: managed.dateValue,
            decimalValue: managed.decimalValue?.decimalValue
        )
    }
}

extension CDFieldValue {
    func apply(_ field: FieldValue) {
        self.id = field.id
        self.label = field.label
        self.kind = field.kind.rawValue
        self.position = field.position

        // Clear all value columns first, then set the active one.
        self.textValue = nil
        self.numberValue = nil
        self.dateValue = nil
        self.decimalValue = nil

        switch field.kind {
        case .text, .url:
            self.textValue = field.textValue
        case .number:
            self.numberValue = field.numberValue.map(NSNumber.init(value:))
        case .date:
            self.dateValue = field.dateValue
        case .currency:
            self.decimalValue = field.decimalValue.map { NSDecimalNumber(decimal: $0) }
        case .select, .multiselect, .attachment, .person:
            // Reserved kinds: no editor yet, no value to write.
            break
        }
    }
}

extension Attachment {
    init(managed: CDAttachment) {
        self.init(
            id: managed.id ?? UUID(),
            dashboardID: managed.dashboardID ?? UUID(),
            name: managed.name ?? "",
            mimeType: managed.mimeType,
            sizeBytes: managed.sizeBytes,
            source: AttachmentSource(rawValue: managed.source) ?? .local,
            dropboxPath: managed.dropboxPath,
            addedAt: managed.addedAt ?? .distantPast
        )
    }
}

extension CDAttachment {
    /// Apply value-type fields. The blob (`data`) is set separately via the
    /// store's create method.
    func applyMetadata(_ attachment: Attachment) {
        self.id = attachment.id
        self.dashboardID = attachment.dashboardID
        self.name = attachment.name
        self.mimeType = attachment.mimeType
        self.sizeBytes = attachment.sizeBytes
        self.source = attachment.source.rawValue
        self.dropboxPath = attachment.dropboxPath
        self.addedAt = attachment.addedAt
    }
}

extension ReminderRule {
    init(managed: CDReminderRule) {
        self.init(
            id: managed.id ?? UUID(),
            dashboardID: managed.dashboardID ?? UUID(),
            fieldID: managed.fieldID,
            name: managed.name ?? "",
            kind: ReminderKind(rawValue: managed.kind) ?? .beforeDate,
            config: ReminderConfig.decoded(managed.configJSON),
            action: ReminderAction(rawValue: managed.action) ?? .createTodo,
            nextFireAt: managed.nextFireAt,
            lastFiredAt: managed.lastFiredAt,
            enabled: managed.enabled,
            createdAt: managed.createdAt ?? .distantPast,
            updatedAt: managed.updatedAt ?? .distantPast
        )
    }
}

extension CDReminderRule {
    func apply(_ rule: ReminderRule) {
        self.id = rule.id
        self.dashboardID = rule.dashboardID
        self.fieldID = rule.fieldID
        self.name = rule.name
        self.kind = rule.kind.rawValue
        self.configJSON = rule.config.encoded()
        self.action = rule.action.rawValue
        self.nextFireAt = rule.nextFireAt
        self.lastFiredAt = rule.lastFiredAt
        self.enabled = rule.enabled
        self.createdAt = rule.createdAt
        self.updatedAt = rule.updatedAt
    }
}

extension Tag {
    init(managed: CDTag) {
        self.init(
            id: managed.id ?? UUID(),
            name: managed.name ?? "",
            color: managed.color ?? "#9CA3AF",
            createdAt: managed.createdAt ?? .distantPast,
            updatedAt: managed.updatedAt ?? .distantPast
        )
    }
}

extension CDTag {
    func apply(_ tag: Tag) {
        self.id = tag.id
        self.name = tag.name
        self.color = tag.color
        self.createdAt = tag.createdAt
        self.updatedAt = tag.updatedAt
    }
}
