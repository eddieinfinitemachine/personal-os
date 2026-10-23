import SwiftUI

/// Progress ring shared by the app and the widget.
struct ProgressRing: View {
    let progress: Double
    var lineWidth: CGFloat = 10

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.accentColor.opacity(0.18), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(Color.accentColor, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .accessibilityLabel("Goal progress")
        .accessibilityValue("\(Int((progress * 100).rounded())) percent")
    }
}

/// Seven small bars, oldest left. Bars that reached the goal are filled solid.
struct WeekBars: View {
    let days: [StepSnapshot.Day]
    let goal: Int
    var showLabels = false

    private var scale: Int { max(goal, days.map(\.steps).max() ?? 0, 1) }

    var body: some View {
        HStack(alignment: .bottom, spacing: 6) {
            ForEach(days) { day in
                VStack(spacing: 4) {
                    GeometryReader { proxy in
                        VStack {
                            Spacer(minLength: 0)
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(day.steps >= goal ? Color.accentColor : Color.accentColor.opacity(0.35))
                                .frame(height: max(3, proxy.size.height * CGFloat(day.steps) / CGFloat(scale)))
                        }
                    }
                    if showLabels {
                        Text(day.date, format: .dateTime.weekday(.narrow))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(day.date.formatted(.dateTime.weekday(.wide)))
                .accessibilityValue("\(day.steps.formatted()) steps")
            }
        }
    }
}
