import Foundation
import Observation
import PersonalOSModels
import PersonalOSPersistence

@MainActor
@Observable
public final class TodayViewModel {
    public private(set) var overdue: [Todo] = []
    public private(set) var today: [Todo] = []
    public private(set) var lastError: String?

    private let store: TodoStore

    public init(store: TodoStore) {
        self.store = store
        refresh()
    }

    public func refresh() {
        do {
            let all = try store.fetchToday()
            self.overdue = all.filter { $0.isOverdue }
            self.today = all.filter { !$0.isOverdue }
            self.lastError = nil
        } catch {
            self.overdue = []
            self.today = []
            self.lastError = error.localizedDescription
        }
    }

    public func toggleComplete(_ todo: Todo) {
        do {
            if todo.isCompleted {
                try store.uncomplete(id: todo.id)
            } else {
                try store.complete(id: todo.id)
            }
            refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func snoozeOneDay(_ todo: Todo) {
        var updated = todo
        updated.snoozedUntil = Calendar.current.date(byAdding: .day, value: 1, to: .now)
        do {
            try store.update(updated)
            refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func softDelete(_ todo: Todo) {
        do {
            try store.softDelete(id: todo.id)
            refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }
}
