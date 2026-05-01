import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif
import PersonalOSModels

public struct VaultView: View {
    @Bindable public var viewModel: VaultViewModel
    @Environment(\.scenePhase) private var scenePhase

    @State private var showingAddSheet = false
    @State private var editingID: UUID?
    @State private var copiedID: UUID?

    public init(viewModel: VaultViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        Group {
            switch viewModel.lockState {
            case .locked, .error:
                gateView
            case .unlocking:
                ProgressView("Unlocking…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .unlocked:
                unlockedList
            }
        }
        .navigationTitle("Vault")
        .toolbar {
            if case .unlocked = viewModel.lockState {
                #if os(iOS)
                ToolbarItem(placement: .topBarLeading) {
                    Button(role: .destructive) {
                        viewModel.lock()
                    } label: {
                        Label("Lock", systemImage: "lock.fill")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingAddSheet = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
                #else
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showingAddSheet = true
                    } label: {
                        Label("New Entry", systemImage: "plus")
                    }
                }
                ToolbarItem(placement: .secondaryAction) {
                    Button(role: .destructive) {
                        viewModel.lock()
                    } label: {
                        Label("Lock", systemImage: "lock.fill")
                    }
                }
                #endif
            }
        }
        .sheet(isPresented: $showingAddSheet) {
            VaultEntryEditor(
                title: "New entry",
                initialValue: nil,
                onSave: { label, value, category, notes in
                    viewModel.create(label: label, value: value, category: category, notes: notes)
                    showingAddSheet = false
                },
                onCancel: { showingAddSheet = false }
            )
        }
        .sheet(item: Binding(
            get: { editingID.flatMap { viewModel.revealed[$0] }.map { IdentifiableValue(id: $0.id, value: $0) } },
            set: { editingID = $0?.id }
        )) { wrap in
            VaultEntryEditor(
                title: "Edit entry",
                initialValue: wrap.value,
                onSave: { label, value, category, notes in
                    viewModel.update(
                        id: wrap.value.id,
                        label: label, value: value,
                        category: category, notes: notes
                    )
                    editingID = nil
                },
                onCancel: { editingID = nil }
            )
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { viewModel.lock() }
        }
        .task(id: viewModel.lockState == .unlocked ? "tick" : "off") {
            // Periodic inactivity tick while unlocked.
            guard viewModel.lockState == .unlocked else { return }
            while !Task.isCancelled, viewModel.lockState == .unlocked {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                viewModel.evaluateAutoLock()
            }
        }
    }

    // MARK: Gate

    private var gateView: some View {
        VStack(spacing: 16) {
            Image(systemName: "lock.shield")
                .font(.system(size: 56))
                .foregroundStyle(.tint)
            Text("Vault is locked")
                .font(.title2.weight(.semibold))
            Text("Re-authenticate to view your saved values.\nThe vault is never sent to Claude.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)

            Button {
                viewModel.unlock()
            } label: {
                Label("Unlock with Face ID / Touch ID", systemImage: "faceid")
                    .frame(minWidth: 220)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)

            if case let .error(msg) = viewModel.lockState {
                Text(msg)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Unlocked

    @ViewBuilder
    private var unlockedList: some View {
        if viewModel.summaries.isEmpty {
            ContentUnavailableView(
                "No vault entries",
                systemImage: "lock.open",
                description: Text("Add account numbers, codes, or anything you'd rather not memorize.")
            )
        } else {
            List {
                ForEach(viewModel.summaries) { summary in
                    row(for: summary)
                }
            }
            .refreshable {
                viewModel.refresh()
            }
        }
    }

    @ViewBuilder
    private func row(for summary: VaultEntry.Summary) -> some View {
        let isRevealed = viewModel.revealed[summary.id] != nil
        let revealedValue = viewModel.revealed[summary.id]?.value

        VStack(alignment: .leading, spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(summary.label)
                        .font(.body.weight(.medium))
                    if let category = summary.category {
                        Text(category)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if let value = revealedValue {
                    Text(value)
                        .font(.body.monospaced())
                        .lineLimit(1)
                        .truncationMode(.middle)
                } else {
                    Text("•••• •••• ••••")
                        .font(.body.monospaced())
                        .foregroundStyle(.tertiary)
                }
            }

            HStack(spacing: 8) {
                Button {
                    if isRevealed {
                        viewModel.hide(id: summary.id)
                    } else {
                        viewModel.reveal(id: summary.id)
                    }
                } label: {
                    Label(
                        isRevealed ? "Hide" : "Reveal",
                        systemImage: isRevealed ? "eye.slash" : "eye"
                    )
                }
                .controlSize(.small)
                .buttonStyle(.bordered)

                if isRevealed, let value = revealedValue {
                    Button {
                        copyToClipboard(value, for: summary.id)
                    } label: {
                        Label(copiedID == summary.id ? "Copied" : "Copy", systemImage: "doc.on.doc")
                    }
                    .controlSize(.small)
                    .buttonStyle(.bordered)

                    Button {
                        editingID = summary.id
                    } label: {
                        Label("Edit", systemImage: "pencil")
                    }
                    .controlSize(.small)
                    .buttonStyle(.bordered)
                }

                Spacer()
            }
        }
        .padding(.vertical, 4)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(role: .destructive) {
                viewModel.delete(id: summary.id)
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    // MARK: Clipboard with auto-clear

    private func copyToClipboard(_ value: String, for id: UUID) {
        #if canImport(UIKit)
        UIPasteboard.general.string = value
        #elseif canImport(AppKit)
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(value, forType: .string)
        #endif
        copiedID = id
        viewModel.touch()
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 30 * 1_000_000_000)
            // Only clear if the clipboard still contains our value (don't
            // stomp something the user copied since).
            #if canImport(UIKit)
            if UIPasteboard.general.string == value {
                UIPasteboard.general.string = ""
            }
            #elseif canImport(AppKit)
            if NSPasteboard.general.string(forType: .string) == value {
                NSPasteboard.general.clearContents()
            }
            #endif
            if copiedID == id { copiedID = nil }
        }
    }
}

private struct IdentifiableValue<T>: Identifiable {
    let id: UUID
    let value: T
}

private struct VaultEntryEditor: View {
    let title: String
    let initialValue: VaultEntry?

    let onSave: (_ label: String, _ value: String, _ category: String?, _ notes: String?) -> Void
    let onCancel: () -> Void

    @State private var label: String
    @State private var value: String
    @State private var category: String
    @State private var notes: String

    init(
        title: String,
        initialValue: VaultEntry?,
        onSave: @escaping (String, String, String?, String?) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.title = title
        self.initialValue = initialValue
        self.onSave = onSave
        self.onCancel = onCancel
        self._label = State(initialValue: initialValue?.label ?? "")
        self._value = State(initialValue: initialValue?.value ?? "")
        self._category = State(initialValue: initialValue?.category ?? "")
        self._notes = State(initialValue: initialValue?.notes ?? "")
    }

    var body: some View {
        #if os(iOS)
        NavigationStack { form }
        #else
        form
            .frame(minWidth: 420, idealHeight: 380)
        #endif
    }

    @ViewBuilder
    private var form: some View {
        Form {
            Section("Label") {
                TextField("Label", text: $label)
                    .textFieldStyle(.roundedBorder)
            }
            Section("Value") {
                SecureField("Value", text: $value)
                    .textFieldStyle(.roundedBorder)
            }
            Section("Category (optional)") {
                TextField("e.g. account, code, id", text: $category)
                    .textFieldStyle(.roundedBorder)
            }
            Section("Notes (optional)") {
                TextEditor(text: $notes)
                    .frame(minHeight: 80)
            }
        }
        .formStyle(.grouped)
        #if os(iOS)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel", action: onCancel)
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    save()
                }
                .disabled(label.trimmingCharacters(in: .whitespaces).isEmpty || value.isEmpty)
            }
        }
        #else
        .toolbar {
            ToolbarItemGroup(placement: .confirmationAction) {
                Button("Cancel", action: onCancel)
                    .keyboardShortcut(.cancelAction)
                Button("Save") { save() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(label.trimmingCharacters(in: .whitespaces).isEmpty || value.isEmpty)
            }
        }
        #endif
    }

    private func save() {
        let trimmedLabel = label.trimmingCharacters(in: .whitespaces)
        guard !trimmedLabel.isEmpty, !value.isEmpty else { return }
        let cat = category.trimmingCharacters(in: .whitespaces)
        let n = notes.trimmingCharacters(in: .whitespaces)
        onSave(trimmedLabel, value, cat.isEmpty ? nil : cat, n.isEmpty ? nil : n)
    }
}
