import SwiftUI
import PersonalOSModels

/// Attachments list inside a dashboard detail view. Cross-platform: the
/// "+ Add" button is wired by the host (Mac uses NSOpenPanel, iOS uses
/// fileImporter) — this view just renders rows.
public struct AttachmentsSection: View {
    @Bindable public var viewModel: AttachmentsViewModel
    let onAddTapped: () -> Void

    public init(
        viewModel: AttachmentsViewModel,
        onAddTapped: @escaping () -> Void
    ) {
        self.viewModel = viewModel
        self.onAddTapped = onAddTapped
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Files")
                    .font(.headline)
                Spacer()
                Button {
                    onAddTapped()
                } label: {
                    Label("Add File", systemImage: "paperclip")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }

            if viewModel.attachments.isEmpty {
                ContentUnavailableView(
                    "No files attached",
                    systemImage: "paperclip",
                    description: Text("Attach manuals, receipts, photos — anything you'd want next to this dashboard.")
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            } else {
                VStack(spacing: 6) {
                    ForEach(viewModel.attachments) { attachment in
                        AttachmentRow(
                            attachment: attachment,
                            onDelete: { viewModel.delete(id: attachment.id) }
                        )
                    }
                }
            }
        }
    }
}

struct AttachmentRow: View {
    let attachment: Attachment
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: attachment.systemImage)
                .font(.title3)
                .foregroundStyle(.tint)
                .frame(width: 32)

            VStack(alignment: .leading, spacing: 2) {
                Text(attachment.name)
                    .font(.body)
                    .lineLimit(1)
                HStack(spacing: 8) {
                    Text(attachment.sizeFormatted)
                    if let mime = attachment.mimeType {
                        Text("·")
                        Text(mime)
                            .lineLimit(1)
                    }
                    Text("·")
                    Text(attachment.addedAt, format: .relative(presentation: .named))
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            Spacer()

            Button(role: .destructive, action: onDelete) {
                Image(systemName: "trash")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.background.secondary, in: .rect(cornerRadius: 8))
    }
}
