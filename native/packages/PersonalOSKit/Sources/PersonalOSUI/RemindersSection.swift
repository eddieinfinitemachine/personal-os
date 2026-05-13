import SwiftUI
import PersonalOSModels
import PersonalOSPersistence
import PersonalOSServices

@MainActor
@Observable
public final class DashboardRemindersViewModel {
    public let dashboardID: UUID
    public private(set) var rules: [ReminderRule] = []
    public private(set) var lastError: String?

    private let reminders: ReminderStore
    private let engine: ReminderEngine

    public init(dashboardID: UUID, reminders: ReminderStore, engine: ReminderEngine) {
        self.dashboardID = dashboardID
        self.reminders = reminders
        self.engine = engine
        refresh()
    }

    public func refresh() {
        do {
            rules = try reminders.fetch(dashboardID: dashboardID)
            lastError = nil
        } catch {
            rules = []
            lastError = error.localizedDescription
        }
    }

    public func create(
        kind: ReminderKind,
        fieldID: UUID?,
        name: String,
        config: ReminderConfig
    ) {
        let rule = ReminderRule(
            dashboardID: dashboardID,
            fieldID: fieldID,
            name: name,
            kind: kind,
            config: config
        )
        do {
            try reminders.create(rule)
            try engine.recomputeRules(forDashboardID: dashboardID)
            refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func toggle(_ rule: ReminderRule) {
        var updated = rule
        updated.enabled.toggle()
        do {
            try reminders.update(updated)
            try engine.recomputeRules(forDashboardID: dashboardID)
            refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func delete(id: UUID) {
        do {
            try reminders.delete(id: id)
            refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }
}

public struct RemindersSection: View {
    @Bindable public var viewModel: DashboardRemindersViewModel
    public let dashboard: Dashboard

    @State private var showingAdd = false
    @State private var draftKind: ReminderKind = .beforeDate
    @State private var draftFieldID: UUID?
    @State private var draftName: String = ""
    @State private var draftDays: Int = 14

    public init(viewModel: DashboardRemindersViewModel, dashboard: Dashboard) {
        self.viewModel = viewModel
        self.dashboard = dashboard
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Reminders")
                    .font(.headline)
                Spacer()
                Button {
                    draftKind = .beforeDate
                    draftFieldID = dashboard.fields.first(where: { $0.kind == .date })?.id
                    draftName = ""
                    draftDays = 14
                    showingAdd = true
                } label: {
                    Label("Add Reminder", systemImage: "bell.badge")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }

            if viewModel.rules.isEmpty {
                ContentUnavailableView(
                    "No reminders",
                    systemImage: "bell",
                    description: Text("Add reminders tied to this dashboard's date fields, or recurring check-ins.")
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            } else {
                VStack(spacing: 6) {
                    ForEach(viewModel.rules) { rule in
                        RuleRow(rule: rule, dashboard: dashboard) {
                            viewModel.toggle(rule)
                        } onDelete: {
                            viewModel.delete(id: rule.id)
                        }
                    }
                }
            }
        }
        .sheet(isPresented: $showingAdd) {
            AddRuleSheet(
                dashboard: dashboard,
                kind: $draftKind,
                fieldID: $draftFieldID,
                name: $draftName,
                days: $draftDays,
                onCancel: { showingAdd = false },
                onAdd: { kind, fieldID, name, config in
                    viewModel.create(kind: kind, fieldID: fieldID, name: name, config: config)
                    showingAdd = false
                }
            )
            #if os(macOS)
            .frame(minWidth: 420, idealHeight: 320)
            #else
            .presentationDetents([.medium, .large])
            #endif
        }
    }
}

private struct RuleRow: View {
    let rule: ReminderRule
    let dashboard: Dashboard
    let onToggle: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: rule.enabled ? "bell.fill" : "bell.slash")
                .foregroundStyle(rule.enabled ? Color.accentColor : Color.secondary)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(rule.name.isEmpty ? rule.kind.title : rule.name)
                    .font(.body)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button(action: onToggle) {
                Text(rule.enabled ? "Pause" : "Resume")
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
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

    private var subtitle: String {
        switch rule.kind {
        case .beforeDate:
            let label = rule.fieldID.flatMap { dashboard.field(id: $0)?.label } ?? "field"
            let n = rule.config.daysBefore ?? 0
            return "\(n) day\(n == 1 ? "" : "s") before \(label)"
        case .afterDate:
            let label = rule.fieldID.flatMap { dashboard.field(id: $0)?.label } ?? "field"
            let n = rule.config.daysAfter ?? 0
            return "\(n) day\(n == 1 ? "" : "s") after \(label)"
        case .recurring:
            let n = rule.config.intervalDays ?? 0
            return "Every \(n) day\(n == 1 ? "" : "s")"
        case .threshold:
            return "Threshold (coming soon)"
        }
    }
}

private struct AddRuleSheet: View {
    let dashboard: Dashboard
    @Binding var kind: ReminderKind
    @Binding var fieldID: UUID?
    @Binding var name: String
    @Binding var days: Int

    let onCancel: () -> Void
    let onAdd: (ReminderKind, UUID?, String, ReminderConfig) -> Void

    private var dateFields: [FieldValue] {
        dashboard.fields.filter { $0.kind == .date }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("New reminder")
                .font(.headline)

            Form {
                TextField("Name (optional)", text: $name)

                Picker("Kind", selection: $kind) {
                    ForEach(ReminderKind.userPickable) { k in
                        Text(k.title).tag(k)
                    }
                }

                if kind == .beforeDate || kind == .afterDate {
                    if dateFields.isEmpty {
                        Text("Add a date field to this dashboard first.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Picker("Field", selection: Binding(
                            get: { fieldID ?? dateFields.first?.id },
                            set: { fieldID = $0 }
                        )) {
                            ForEach(dateFields) { f in
                                Text(f.label).tag(f.id as UUID?)
                            }
                        }
                    }
                    Stepper(
                        value: $days,
                        in: 1...365
                    ) {
                        Text(kind == .beforeDate ? "\(days) days before" : "\(days) days after")
                    }
                }

                if kind == .recurring {
                    Stepper(
                        value: $days,
                        in: 1...365
                    ) {
                        Text("Every \(days) day\(days == 1 ? "" : "s")")
                    }
                }
            }
            .formStyle(.grouped)

            HStack {
                Button("Cancel", action: onCancel)
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Add") {
                    let config: ReminderConfig
                    switch kind {
                    case .beforeDate: config = .before(days: days)
                    case .afterDate: config = .after(days: days)
                    case .recurring: config = .recurring(everyDays: days)
                    case .threshold: config = ReminderConfig()
                    }
                    let fieldRef: UUID? = (kind == .beforeDate || kind == .afterDate)
                        ? (fieldID ?? dateFields.first?.id)
                        : nil
                    onAdd(kind, fieldRef, name.trimmingCharacters(in: .whitespaces), config)
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled((kind == .beforeDate || kind == .afterDate) && dateFields.isEmpty)
            }
        }
        .padding()
    }
}
