import Testing
import Foundation
@testable import PersonalOSPersistence
import PersonalOSModels

@Suite("AttachmentStore", .serialized)
@MainActor
struct AttachmentStoreTests {
    private func makeStores() -> (AttachmentStore, DashboardStore, PersistenceController) {
        let controller = PersistenceController.inMemory()
        return (AttachmentStore(controller: controller), DashboardStore(controller: controller), controller)
    }

    private func writeTempFile(name: String, contents: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(UUID().uuidString)-\(name)")
        try contents.write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    @Test("import local file persists name, size, mime, blob")
    func importLocal() throws {
        let (attachments, dashboards, _) = makeStores()
        let dashboard = Dashboard(name: "Ferrari")
        try dashboards.create(dashboard)

        let file = try writeTempFile(name: "manual.txt", contents: "lorem ipsum dolor sit amet")
        defer { try? FileManager.default.removeItem(at: file) }

        let attachment = try attachments.importLocal(file: file, dashboardID: dashboard.id)
        #expect(attachment.name == file.lastPathComponent)
        #expect(attachment.mimeType == "text/plain")
        #expect(attachment.sizeBytes > 0)
        #expect(attachment.source == .local)

        let blob = try attachments.data(for: attachment.id)
        #expect(blob == "lorem ipsum dolor sit amet".data(using: .utf8))
    }

    @Test("fetch returns only attachments for dashboard")
    func fetchByDashboard() throws {
        let (attachments, dashboards, _) = makeStores()
        let a = Dashboard(name: "A")
        let b = Dashboard(name: "B")
        try dashboards.create(a)
        try dashboards.create(b)

        let fileA = try writeTempFile(name: "a.txt", contents: "A")
        let fileB1 = try writeTempFile(name: "b1.txt", contents: "B1")
        let fileB2 = try writeTempFile(name: "b2.txt", contents: "B2")
        defer {
            [fileA, fileB1, fileB2].forEach { try? FileManager.default.removeItem(at: $0) }
        }

        try attachments.importLocal(file: fileA, dashboardID: a.id)
        try attachments.importLocal(file: fileB1, dashboardID: b.id)
        try attachments.importLocal(file: fileB2, dashboardID: b.id)

        #expect(try attachments.fetch(dashboardID: a.id).count == 1)
        #expect(try attachments.fetch(dashboardID: b.id).count == 2)
    }

    @Test("delete removes attachment")
    func deleteOne() throws {
        let (attachments, dashboards, _) = makeStores()
        let dashboard = Dashboard(name: "X")
        try dashboards.create(dashboard)
        let file = try writeTempFile(name: "x.txt", contents: "x")
        defer { try? FileManager.default.removeItem(at: file) }
        let a = try attachments.importLocal(file: file, dashboardID: dashboard.id)

        try attachments.delete(id: a.id)
        #expect(try attachments.fetch(dashboardID: dashboard.id).isEmpty)
    }

    @Test("dashboard delete cascades to attachments via soft FK")
    func dashboardDeleteCascades() throws {
        let (attachments, dashboards, _) = makeStores()
        let dashboard = Dashboard(name: "Doomed")
        try dashboards.create(dashboard)
        let file = try writeTempFile(name: "d.txt", contents: "dies with parent")
        defer { try? FileManager.default.removeItem(at: file) }
        try attachments.importLocal(file: file, dashboardID: dashboard.id)

        try dashboards.delete(id: dashboard.id)
        #expect(try attachments.fetch(dashboardID: dashboard.id).isEmpty)
    }

    @Test("missing file throws")
    func missingFile() {
        let (attachments, _, _) = makeStores()
        let bogus = FileManager.default.temporaryDirectory
            .appendingPathComponent("does-not-exist-\(UUID().uuidString).txt")
        #expect(throws: AttachmentStoreError.self) {
            try attachments.importLocal(file: bogus, dashboardID: UUID())
        }
    }
}
