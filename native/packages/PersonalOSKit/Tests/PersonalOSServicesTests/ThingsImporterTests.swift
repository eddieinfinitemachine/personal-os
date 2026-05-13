import Testing
import Foundation
import SQLite3
@testable import PersonalOSServices
import PersonalOSPersistence
import PersonalOSModels

@Suite("ThingsImporter", .serialized)
@MainActor
struct ThingsImporterTests {

    /// Build a tiny SQLite file mimicking Things' TMTask schema.
    private func makeMockDatabase(rows: [MockRow]) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("things-mock-\(UUID().uuidString).sqlite")

        var db: OpaquePointer?
        let openResult = sqlite3_open(url.path, &db)
        precondition(openResult == SQLITE_OK, "open failed")
        defer { sqlite3_close(db) }

        let createSQL = """
        CREATE TABLE TMTask (
            uuid TEXT PRIMARY KEY,
            title TEXT,
            notes TEXT,
            type INTEGER,
            status INTEGER,
            trashed INTEGER,
            startDate INTEGER,
            deadline INTEGER,
            stopDate REAL,
            creationDate REAL,
            userModificationDate REAL
        );
        """
        var err: UnsafeMutablePointer<CChar>?
        let createResult = sqlite3_exec(db, createSQL, nil, nil, &err)
        precondition(createResult == SQLITE_OK, "create failed: \(err.flatMap { String(cString: $0) } ?? "?")")

        for row in rows {
            let insert = """
            INSERT INTO TMTask (uuid, title, notes, type, status, trashed, startDate, deadline, stopDate, creationDate, userModificationDate)
            VALUES (\(quote(row.uuid)), \(quote(row.title)), \(quote(row.notes)), \(row.type), \(row.status), \(row.trashed), \(nullableInt(row.startDate)), \(nullableInt(row.deadline)), \(nullableReal(row.stopDate)), \(nullableReal(row.creationDate)), \(nullableReal(row.userModificationDate)));
            """
            var insertErr: UnsafeMutablePointer<CChar>?
            let insertResult = sqlite3_exec(db, insert, nil, nil, &insertErr)
            precondition(insertResult == SQLITE_OK, "insert failed: \(insertErr.flatMap { String(cString: $0) } ?? "?")")
        }

        return url
    }

    @Test("imports active task as todo with deadline")
    func importActiveTask() throws {
        let url = try makeMockDatabase(rows: [
            MockRow(
                uuid: "TASK-1",
                title: "Buy oat milk",
                notes: "Whole foods",
                type: 0,
                status: 0,
                trashed: 0,
                deadline: 9000, // arbitrary day number > 0
                creationDate: 700_000_000
            )
        ])
        defer { try? FileManager.default.removeItem(at: url) }

        let controller = PersistenceController.inMemory()
        let store = TodoStore(controller: controller)
        let importer = ThingsImporter(store: store)

        let result = try importer.importDatabase(at: url)

        #expect(result.scanned == 1)
        #expect(result.created == 1)
        #expect(result.updated == 0)
        #expect(result.skipped == 0)

        let imported = try store.fetch(externalID: "things:TASK-1")
        let todo = try #require(imported)
        #expect(todo.title == "Buy oat milk")
        #expect(todo.notes == "Whole foods")
        #expect(todo.list == .todo)
        #expect(todo.completedAt == nil)
        #expect(todo.source == .importer)
        #expect(todo.dueDate != nil)
    }

    @Test("imports completed task with stopDate")
    func importCompletedTask() throws {
        let url = try makeMockDatabase(rows: [
            MockRow(
                uuid: "TASK-2",
                title: "Already done",
                type: 0,
                status: 3, // completed
                trashed: 0,
                stopDate: 750_000_000,
                creationDate: 700_000_000
            )
        ])
        defer { try? FileManager.default.removeItem(at: url) }

        let controller = PersistenceController.inMemory()
        let store = TodoStore(controller: controller)
        let importer = ThingsImporter(store: store)

        let result = try importer.importDatabase(at: url)
        #expect(result.created == 1)
        let todo = try #require(try store.fetch(externalID: "things:TASK-2"))
        #expect(todo.completedAt != nil)
    }

    @Test("skips trashed and cancelled tasks and non-tasks")
    func skipsRows() throws {
        let url = try makeMockDatabase(rows: [
            MockRow(uuid: "T1", title: "trashed", type: 0, status: 0, trashed: 1),
            MockRow(uuid: "T2", title: "cancelled", type: 0, status: 2, trashed: 0),
            MockRow(uuid: "T3", title: "project", type: 1, status: 0, trashed: 0),
            MockRow(uuid: "T4", title: "valid", type: 0, status: 0, trashed: 0)
        ])
        defer { try? FileManager.default.removeItem(at: url) }

        let controller = PersistenceController.inMemory()
        let store = TodoStore(controller: controller)
        let importer = ThingsImporter(store: store)

        let result = try importer.importDatabase(at: url)
        #expect(result.scanned == 4)
        #expect(result.created == 1)
        #expect(result.skipped == 3)
    }

    @Test("re-importing same database is idempotent (updates not duplicates)")
    func idempotent() throws {
        let url = try makeMockDatabase(rows: [
            MockRow(uuid: "T1", title: "first", type: 0, status: 0, trashed: 0)
        ])
        defer { try? FileManager.default.removeItem(at: url) }

        let controller = PersistenceController.inMemory()
        let store = TodoStore(controller: controller)
        let importer = ThingsImporter(store: store)

        let firstRun = try importer.importDatabase(at: url)
        #expect(firstRun.created == 1)

        let secondRun = try importer.importDatabase(at: url)
        #expect(secondRun.created == 0)
        #expect(secondRun.updated == 1)

        // Only one todo total
        let all = try store.fetch(list: .todo, includeCompleted: true)
        #expect(all.count == 1)
    }

    @Test("missing database file throws")
    func missingFile() {
        let bogus = FileManager.default.temporaryDirectory
            .appendingPathComponent("does-not-exist-\(UUID().uuidString).sqlite")
        let store = TodoStore(controller: .inMemory())
        let importer = ThingsImporter(store: store)
        #expect(throws: ThingsImporterError.self) {
            try importer.importDatabase(at: bogus)
        }
    }

    // MARK: helpers

    private struct MockRow {
        var uuid: String
        var title: String
        var notes: String? = nil
        var type: Int = 0
        var status: Int = 0
        var trashed: Int = 0
        var startDate: Int64? = nil
        var deadline: Int64? = nil
        var stopDate: Double? = nil
        var creationDate: Double? = 700_000_000
        var userModificationDate: Double? = 700_000_100
    }

    private func quote(_ s: String?) -> String {
        guard let s else { return "NULL" }
        return "'\(s.replacingOccurrences(of: "'", with: "''"))'"
    }

    private func nullableInt(_ v: Int64?) -> String {
        v.map { String($0) } ?? "NULL"
    }

    private func nullableReal(_ v: Double?) -> String {
        v.map { String($0) } ?? "NULL"
    }
}
