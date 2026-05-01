import Foundation
import SQLite3

/// Minimal read-only SQLite wrapper. Avoids third-party deps.
final class SQLiteReader {
    private var handle: OpaquePointer?

    init(url: URL) throws {
        var db: OpaquePointer?
        let flags = SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX
        let result = sqlite3_open_v2(url.path, &db, flags, nil)
        guard result == SQLITE_OK, let db else {
            if let db { sqlite3_close(db) }
            throw SQLiteError.openFailed(code: result, message: "Could not open \(url.path)")
        }
        self.handle = db
    }

    deinit {
        if let handle { sqlite3_close(handle) }
    }

    /// Run a query and call the row handler for each row.
    /// The Statement passed to the handler is valid for the duration of the call only.
    func query(_ sql: String, _ handler: (Statement) throws -> Void) throws {
        guard let handle else { throw SQLiteError.closed }
        var stmt: OpaquePointer?
        let prep = sqlite3_prepare_v2(handle, sql, -1, &stmt, nil)
        guard prep == SQLITE_OK, let stmt else {
            let msg = String(cString: sqlite3_errmsg(handle))
            sqlite3_finalize(stmt)
            throw SQLiteError.prepareFailed(code: prep, message: msg)
        }
        defer { sqlite3_finalize(stmt) }

        while true {
            let step = sqlite3_step(stmt)
            switch step {
            case SQLITE_DONE:
                return
            case SQLITE_ROW:
                try handler(Statement(stmt: stmt))
            default:
                let msg = String(cString: sqlite3_errmsg(handle))
                throw SQLiteError.stepFailed(code: step, message: msg)
            }
        }
    }

    struct Statement {
        let stmt: OpaquePointer

        func string(at column: Int32) -> String? {
            guard let cString = sqlite3_column_text(stmt, column) else { return nil }
            return String(cString: cString)
        }

        func int(at column: Int32) -> Int64 {
            sqlite3_column_int64(stmt, column)
        }

        func double(at column: Int32) -> Double {
            sqlite3_column_double(stmt, column)
        }

        func isNull(at column: Int32) -> Bool {
            sqlite3_column_type(stmt, column) == SQLITE_NULL
        }
    }
}

enum SQLiteError: Error, CustomStringConvertible {
    case openFailed(code: Int32, message: String)
    case prepareFailed(code: Int32, message: String)
    case stepFailed(code: Int32, message: String)
    case closed

    var description: String {
        switch self {
        case .openFailed(let code, let m): "SQLite open failed (\(code)): \(m)"
        case .prepareFailed(let code, let m): "SQLite prepare failed (\(code)): \(m)"
        case .stepFailed(let code, let m): "SQLite step failed (\(code)): \(m)"
        case .closed: "SQLite handle is closed"
        }
    }
}
