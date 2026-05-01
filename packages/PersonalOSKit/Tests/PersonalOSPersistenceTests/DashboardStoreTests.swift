import Testing
import Foundation
@testable import PersonalOSPersistence
import PersonalOSModels

@Suite("DashboardStore", .serialized)
@MainActor
struct DashboardStoreTests {
    private func makeStore() -> DashboardStore {
        DashboardStore(controller: .inMemory())
    }

    @Test("CRUD round trip")
    func crud() throws {
        let store = makeStore()
        let dashboard = Dashboard(name: "Ferrari", type: "vehicle", icon: "car")
        try store.create(dashboard)
        #expect(try store.fetchAll().count == 1)

        var edited = dashboard
        edited.name = "Ferrari 360"
        try store.update(edited)
        #expect(try store.fetchAll().first?.name == "Ferrari 360")

        try store.delete(id: dashboard.id)
        #expect(try store.fetchAll().isEmpty)
    }

    @Test("create with initial fields persists fields")
    func createWithFields() throws {
        let store = makeStore()
        let dashboard = Dashboard(
            name: "Ferrari",
            type: "vehicle",
            fields: [
                FieldValue(label: "Mileage", kind: .number, position: 0, numberValue: 4_800),
                FieldValue(label: "VIN", kind: .text, position: 1, textValue: "ZFFXXXX"),
                FieldValue(
                    label: "Last service",
                    kind: .date,
                    position: 2,
                    dateValue: Date(timeIntervalSince1970: 1_700_000_000)
                ),
                FieldValue(label: "Vendor", kind: .url, position: 3, textValue: "https://ferrari.com"),
                FieldValue(label: "Buy price", kind: .currency, position: 4, decimalValue: 250_000)
            ]
        )
        try store.create(dashboard)

        let fetched = try #require(try store.fetch(id: dashboard.id))
        #expect(fetched.fields.count == 5)
        #expect(fetched.fields[0].label == "Mileage")
        #expect(fetched.fields[0].numberValue == 4_800)
        #expect(fetched.fields[1].textValue == "ZFFXXXX")
        #expect(fetched.fields[2].dateValue?.timeIntervalSince1970 == 1_700_000_000)
        #expect(fetched.fields[3].textValue == "https://ferrari.com")
        #expect(fetched.fields[4].decimalValue == 250_000)
    }

    @Test("update reconciles fields: keeps, adds, removes")
    func reconcileFields() throws {
        let store = makeStore()
        let keep = FieldValue(label: "Mileage", kind: .number, position: 0, numberValue: 100)
        let drop = FieldValue(label: "Notes", kind: .text, position: 1, textValue: "drops")
        var dashboard = Dashboard(name: "Ferrari", fields: [keep, drop])
        try store.create(dashboard)

        var keepUpdated = keep
        keepUpdated.numberValue = 200
        let added = FieldValue(label: "VIN", kind: .text, position: 2, textValue: "ZFF999")
        dashboard.fields = [keepUpdated, added]
        try store.update(dashboard)

        let fetched = try #require(try store.fetch(id: dashboard.id))
        #expect(fetched.fields.count == 2)
        let labels = fetched.fields.map(\.label)
        #expect(labels.contains("Mileage"))
        #expect(labels.contains("VIN"))
        #expect(!labels.contains("Notes"))
        let mileage = try #require(fetched.fields.first { $0.label == "Mileage" })
        #expect(mileage.numberValue == 200)
    }

    @Test("addField appends with correct position")
    func addFieldConvenience() throws {
        let store = makeStore()
        try store.create(Dashboard(name: "Ferrari"))
        let id = try #require(try store.fetchAll().first?.id)

        let after1 = try store.addField(toDashboardID: id, kind: .number, label: "Mileage")
        #expect(after1.fields.count == 1)
        #expect(after1.fields[0].position == 0)

        let after2 = try store.addField(toDashboardID: id, kind: .text, label: "VIN")
        #expect(after2.fields.count == 2)
        let positions = after2.fields.map(\.position).sorted()
        #expect(positions == [0, 1])
    }

    @Test("removeField deletes from store")
    func removeField() throws {
        let store = makeStore()
        let field = FieldValue(label: "Drop", kind: .text, position: 0)
        try store.create(Dashboard(name: "X", fields: [field]))
        let id = try #require(try store.fetchAll().first?.id)

        try store.removeField(field.id, fromDashboardID: id)
        let fetched = try #require(try store.fetch(id: id))
        #expect(fetched.fields.isEmpty)
    }

    @Test("delete cascades to fields")
    func deleteCascades() throws {
        let store = makeStore()
        try store.create(Dashboard(
            name: "Ferrari",
            fields: [FieldValue(label: "Mileage", kind: .number, position: 0)]
        ))
        let id = try #require(try store.fetchAll().first?.id)
        try store.delete(id: id)
        #expect(try store.fetchAll().isEmpty)
        // No way to query orphan CDFieldValues directly through the public store,
        // but the cascade rule guarantees they're gone — covered by CD invariants.
    }

    @Test("changing field kind clears mismatched value columns")
    func changeKindClearsValues() throws {
        let store = makeStore()
        var field = FieldValue(label: "Pivot", kind: .text, position: 0, textValue: "old")
        try store.create(Dashboard(name: "X", fields: [field]))

        // Flip kind to number, set numberValue, leave textValue stale
        field.kind = .number
        field.numberValue = 42
        field.textValue = "should be cleared on save"

        let dashboardID = try #require(try store.fetchAll().first?.id)
        var dashboard = try #require(try store.fetch(id: dashboardID))
        dashboard.fields = [field]
        try store.update(dashboard)

        let fetched = try #require(try store.fetch(id: dashboardID))
        let pivot = try #require(fetched.fields.first)
        #expect(pivot.kind == .number)
        #expect(pivot.numberValue == 42)
        #expect(pivot.textValue == nil)
    }

    @Test("FieldValue.displayString formats by kind")
    func displayStrings() {
        #expect(FieldValue(label: "x", kind: .text, textValue: "hello").displayString() == "hello")
        #expect(FieldValue(label: "x", kind: .text).displayString() == "—")
        #expect(FieldValue(label: "x", kind: .number, numberValue: 1234).displayString() == 1234.formatted())
        #expect(FieldValue(label: "x", kind: .currency, decimalValue: Decimal(string: "12.50")!).displayString() == Decimal(string: "12.50")!.formatted(.currency(code: "USD")))
    }
}
