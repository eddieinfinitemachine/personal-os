import SwiftUI
import PersonalOSModels

/// Edits a single FieldValue in place. Renders an input appropriate to its kind.
public struct FieldEditor: View {
    @Binding var field: FieldValue

    public init(field: Binding<FieldValue>) {
        self._field = field
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Image(systemName: field.kind.systemImage)
                .foregroundStyle(.secondary)
                .frame(width: 16)
            VStack(alignment: .leading, spacing: 2) {
                TextField("Label", text: $field.label)
                    .font(.subheadline.weight(.medium))
                    .textFieldStyle(.plain)
                input
                    .font(.body)
            }
        }
        .padding(.vertical, 6)
    }

    @ViewBuilder
    private var input: some View {
        switch field.kind {
        case .text:
            TextField("Value", text: bindString)
                .textFieldStyle(.roundedBorder)
        case .url:
            TextField("https://…", text: bindString)
                .textFieldStyle(.roundedBorder)
                #if os(iOS)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                #endif
        case .number:
            TextField("0", value: $field.numberValue, format: .number)
                .textFieldStyle(.roundedBorder)
                #if os(iOS)
                .keyboardType(.decimalPad)
                #endif
        case .date:
            DatePicker(
                "Date",
                selection: Binding(
                    get: { field.dateValue ?? .now },
                    set: { field.dateValue = $0 }
                ),
                displayedComponents: [.date]
            )
            .labelsHidden()
        case .currency:
            TextField("0.00", value: $field.decimalValue, format: .currency(code: "USD"))
                .textFieldStyle(.roundedBorder)
                #if os(iOS)
                .keyboardType(.decimalPad)
                #endif
        case .select, .multiselect, .attachment, .person:
            Text("Editor coming soon")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
    }

    private var bindString: Binding<String> {
        Binding(
            get: { field.textValue ?? "" },
            set: { field.textValue = $0.isEmpty ? nil : $0 }
        )
    }
}

#Preview("Number field") {
    @Previewable @State var field = FieldValue(label: "Mileage", kind: .number, numberValue: 4_800)
    return FieldEditor(field: $field).padding().frame(width: 360)
}
