import Foundation
import Observation
import PersonalOSModels
import PersonalOSPersistence

@MainActor
@Observable
public final class DashboardsViewModel {
    public private(set) var dashboards: [Dashboard] = []
    public private(set) var lastError: String?

    private let store: DashboardStore

    public init(store: DashboardStore) {
        self.store = store
        refresh()
    }

    public func refresh() {
        do {
            dashboards = try store.fetchAll()
            lastError = nil
        } catch {
            dashboards = []
            lastError = error.localizedDescription
        }
    }

    public var groupedByType: [(type: String, dashboards: [Dashboard])] {
        let grouped = Dictionary(grouping: dashboards, by: \.type)
        return grouped.keys.sorted().map { key in
            (key, grouped[key]!.sorted { $0.name < $1.name })
        }
    }

    @discardableResult
    public func createBlank() -> Dashboard? {
        let new = Dashboard(name: "New dashboard")
        do {
            try store.create(new)
            refresh()
            return new
        } catch {
            lastError = error.localizedDescription
            return nil
        }
    }

    public func delete(id: UUID) {
        do {
            try store.delete(id: id)
            refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }
}

@MainActor
@Observable
public final class DashboardDetailViewModel {
    public let dashboardID: UUID
    public private(set) var dashboard: Dashboard?
    public private(set) var lastError: String?

    private let store: DashboardStore

    public init(dashboardID: UUID, store: DashboardStore) {
        self.dashboardID = dashboardID
        self.store = store
        refresh()
    }

    public func refresh() {
        do {
            dashboard = try store.fetch(id: dashboardID)
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func save(_ dashboard: Dashboard) {
        do {
            try store.update(dashboard)
            refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func addField(kind: FieldKind, label: String) {
        do {
            try store.addField(toDashboardID: dashboardID, kind: kind, label: label)
            refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func removeField(_ fieldID: UUID) {
        do {
            try store.removeField(fieldID, fromDashboardID: dashboardID)
            refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }
}
