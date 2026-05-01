import SwiftUI
import PersonalOSModels

public struct PersonTile: View {
    public let person: Person
    public let openTodoCount: Int

    public init(person: Person, openTodoCount: Int = 0) {
        self.person = person
        self.openTodoCount = openTodoCount
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                avatar
                Spacer()
                if openTodoCount > 0 {
                    Text("\(openTodoCount)")
                        .font(.caption.monospacedDigit())
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(.tint, in: .capsule)
                        .foregroundStyle(.white)
                }
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(person.name.isEmpty ? "Untitled" : person.name)
                    .font(.headline)
                    .lineLimit(1)
                Text(person.role.title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let team = person.team, !team.isEmpty {
                    Text(team)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: .rect(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .stroke(.separator, lineWidth: 0.5)
        }
    }

    private var avatar: some View {
        ZStack {
            Circle()
                .fill(.tint.opacity(0.15))
            Text(person.initials)
                .font(.system(.title3, design: .rounded, weight: .semibold))
                .foregroundStyle(.tint)
        }
        .frame(width: 44, height: 44)
    }
}

#Preview {
    HStack(spacing: 12) {
        PersonTile(person: .init(name: "Joe Milstein", role: .peer, team: "IM"), openTodoCount: 3)
        PersonTile(person: .init(name: "Eddie Cohen", role: .peer))
    }
    .frame(width: 400)
    .padding()
}
