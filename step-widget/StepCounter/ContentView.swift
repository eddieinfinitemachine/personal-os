import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var health: HealthStore
    @State private var goal = StepStore.goal

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 28) {
                    if !health.isAvailable {
                        unavailable
                    } else if !health.hasRequestedAuthorization {
                        connect
                    } else {
                        today
                        week
                        goalPicker
                        widgetHelp
                    }
                    if let message = health.errorMessage {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                    }
                }
                .padding(.vertical, 24)
                .frame(maxWidth: .infinity)
            }
            .refreshable { await health.refresh() }
            .navigationTitle("Steps")
            .toolbar {
                if health.hasRequestedAuthorization {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            Task { await health.refresh() }
                        } label: {
                            if health.isRefreshing {
                                ProgressView()
                            } else {
                                Image(systemName: "arrow.clockwise")
                            }
                        }
                        .accessibilityLabel("Refresh")
                    }
                }
            }
        }
    }

    // MARK: Sections

    private var unavailable: some View {
        ContentUnavailableView(
            "Health data unavailable",
            systemImage: "heart.slash",
            description: Text("This device can't provide step counts.")
        )
    }

    private var connect: some View {
        VStack(spacing: 16) {
            Image(systemName: "figure.walk.circle.fill")
                .font(.system(size: 72))
                .foregroundStyle(.tint)
            Text("Read steps from Health")
                .font(.title2.weight(.semibold))
            Text("The widget shows today's steps from the Health app. Only step counts are read, and nothing leaves the phone.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button {
                Task { await health.requestAuthorization() }
            } label: {
                Text("Allow access")
                    .frame(maxWidth: 240)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding(.top, 48)
    }

    private var today: some View {
        let snapshot = (health.snapshot ?? .empty).rolledForward()
        return VStack(spacing: 12) {
            ZStack {
                ProgressRing(progress: snapshot.progress, lineWidth: 18)
                    .frame(width: 200, height: 200)
                VStack(spacing: 2) {
                    Text(snapshot.today.formatted())
                        .font(.system(size: 44, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .contentTransition(.numericText())
                    Text("of \(snapshot.goal.formatted())")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            Text(snapshot.remaining == 0 ? "Goal reached" : "\(snapshot.remaining.formatted()) to go")
                .font(.headline)
            if snapshot.updatedAt != .distantPast {
                Text("Updated \(snapshot.updatedAt, style: .relative) ago")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .animation(.snappy, value: snapshot.today)
    }

    private var week: some View {
        let snapshot = (health.snapshot ?? .empty).rolledForward()
        return VStack(alignment: .leading, spacing: 8) {
            Text("Last 7 days")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            WeekBars(days: snapshot.week, goal: snapshot.goal, showLabels: true)
                .frame(height: 120)
        }
        .padding(.horizontal, 24)
    }

    private var goalPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Daily goal")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            Stepper(value: $goal, in: 1_000...50_000, step: 500) {
                Text("\(goal.formatted()) steps")
                    .monospacedDigit()
            }
            .onChange(of: goal) { _, value in
                health.updateGoal(value)
            }
        }
        .padding(.horizontal, 24)
    }

    private var widgetHelp: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Add the widget")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            Text("Long-press the Home Screen, tap Edit, then Add Widget, and search for Steps. Lock Screen sizes are available too. Keep this app installed; it feeds the widget.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 24)
    }
}

#Preview {
    ContentView()
        .environmentObject(HealthStore.shared)
}
