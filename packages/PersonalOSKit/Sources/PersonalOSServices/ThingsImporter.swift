import Foundation
import os
import PersonalOSModels
import PersonalOSPersistence

public struct ThingsImportResult: Sendable {
    public let scanned: Int
    public let created: Int
    public let updated: Int
    public let skipped: Int
}

public enum ThingsImporterError: Error, CustomStringConvertible, Sendable {
    case databaseNotReadable(URL)
    case unexpectedSchema(String)

    public var description: String {
        switch self {
        case .databaseNotReadable(let url): "Cannot read Things database at \(url.path)"
        case .unexpectedSchema(let s): "Unexpected Things schema: \(s)"
        }
    }
}

/// Reads a Things 3 SQLite database (read-only) and imports tasks into a TodoStore.
///
/// What we map (Sprint 1 scope):
/// - TMTask rows where type=0 (task) — projects/headings/areas are deferred to Sprint 2
/// - status=0 (active) → list=.todo, completedAt=nil
/// - status=3 (completed) → list=.todo, completedAt=stopDate
/// - status=2 (cancelled) and trashed=1 are skipped
/// - dueDate from TMTask.deadline (Things stores as days since 2001-01-01 epoch)
/// - notes from TMTask.notes
/// - external dedup key: "things:<UUID>" stored on Todo.externalID
///
/// What we do NOT map yet (deferred):
/// - Projects, areas, headings (no Project model in Sprint 1)
/// - Tags (Things tag schema differs; will revisit in Sprint 2 with Tag work)
/// - Repeating tasks / templates
/// - Checklist items (subtasks)
@MainActor
public struct ThingsImporter {
    private static let logger = Logger(subsystem: "com.zelig.PersonalOS", category: "ThingsImporter")

    private let store: TodoStore

    public init(store: TodoStore) {
        self.store = store
    }

    public func importDatabase(at url: URL) throws -> ThingsImportResult {
        guard FileManager.default.isReadableFile(atPath: url.path) else {
            throw ThingsImporterError.databaseNotReadable(url)
        }

        let reader = try SQLiteReader(url: url)

        // Things 2001 epoch reference (Cocoa reference date)
        let cocoaEpoch = Date(timeIntervalSinceReferenceDate: 0)

        var todos: [Todo] = []
        var skipped = 0
        var scanned = 0

        // Columns: 0=uuid, 1=title, 2=notes, 3=type, 4=status, 5=trashed,
        //          6=startDate(day#), 7=deadline(day#), 8=stopDate(secs),
        //          9=creationDate(secs), 10=userModificationDate(secs)
        let sql = """
        SELECT uuid, title, notes, type, status, trashed,
               startDate, deadline, stopDate,
               creationDate, userModificationDate
        FROM TMTask
        """

        try reader.query(sql) { row in
            scanned += 1

            let uuid = row.string(at: 0) ?? ""
            let title = row.string(at: 1) ?? ""
            let notes = row.string(at: 2)
            let type = row.int(at: 3)
            let status = row.int(at: 4)
            let trashed = row.int(at: 5)

            // Skip non-task rows, trashed rows, and cancelled rows
            guard type == 0, trashed == 0, status != 2 else {
                skipped += 1
                return
            }
            guard !uuid.isEmpty, !title.isEmpty else {
                skipped += 1
                return
            }

            let deadlineDate = Self.dateFromDayNumber(
                row.isNull(at: 7) ? nil : row.int(at: 7)
            )
            let stopDate = row.isNull(at: 8)
                ? nil
                : cocoaEpoch.addingTimeInterval(row.double(at: 8))
            let creationDate = row.isNull(at: 9)
                ? Date.now
                : cocoaEpoch.addingTimeInterval(row.double(at: 9))
            let modificationDate = row.isNull(at: 10)
                ? creationDate
                : cocoaEpoch.addingTimeInterval(row.double(at: 10))

            let isCompleted = status == 3

            let todo = Todo(
                title: title,
                notes: notes,
                list: .todo,
                dueDate: deadlineDate,
                completedAt: isCompleted ? stopDate : nil,
                source: .importer,
                externalID: "things:\(uuid)",
                createdAt: creationDate,
                updatedAt: modificationDate
            )
            todos.append(todo)
        }

        Self.logger.info("Things import scanned \(scanned), prepared \(todos.count), skipped \(skipped)")
        let result = try store.upsertByExternalID(todos)
        return ThingsImportResult(
            scanned: scanned,
            created: result.created,
            updated: result.updated,
            skipped: skipped
        )
    }

    /// Things stores some dates as integers representing days since 2001-01-01.
    /// We treat "0" or null as "no date".
    private static func dateFromDayNumber(_ dayNumber: Int64?) -> Date? {
        guard let dayNumber, dayNumber > 0 else { return nil }
        var components = DateComponents()
        components.year = 2001
        components.month = 1
        components.day = 1 + Int(dayNumber)
        return Calendar(identifier: .gregorian).date(from: components)
    }
}
