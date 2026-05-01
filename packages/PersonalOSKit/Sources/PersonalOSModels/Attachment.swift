import Foundation

public enum AttachmentSource: Int16, Codable, Sendable, CaseIterable {
    case local = 0
    case dropbox = 1 // reserved — Sprint 3
}

public struct Attachment: Identifiable, Hashable, Sendable, Codable {
    public let id: UUID
    public var dashboardID: UUID
    public var name: String
    public var mimeType: String?
    public var sizeBytes: Int64
    public var source: AttachmentSource
    /// Sprint 3: Dropbox path. Sprint 2 always nil.
    public var dropboxPath: String?
    public let addedAt: Date

    public init(
        id: UUID = UUID(),
        dashboardID: UUID,
        name: String,
        mimeType: String? = nil,
        sizeBytes: Int64 = 0,
        source: AttachmentSource = .local,
        dropboxPath: String? = nil,
        addedAt: Date = .now
    ) {
        self.id = id
        self.dashboardID = dashboardID
        self.name = name
        self.mimeType = mimeType
        self.sizeBytes = sizeBytes
        self.source = source
        self.dropboxPath = dropboxPath
        self.addedAt = addedAt
    }

    public var sizeFormatted: String {
        ByteCountFormatter.string(fromByteCount: sizeBytes, countStyle: .file)
    }

    public var systemImage: String {
        switch (mimeType ?? "").lowercased() {
        case let m where m.hasPrefix("image/"): "photo"
        case let m where m.hasPrefix("video/"): "film"
        case let m where m.hasPrefix("audio/"): "waveform"
        case "application/pdf": "doc.richtext"
        case let m where m.contains("zip") || m.contains("compressed"): "archivebox"
        default: "doc"
        }
    }
}
