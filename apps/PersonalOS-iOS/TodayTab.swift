import SwiftUI
import PersonalOSModels
import PersonalOSUI

struct TodayTab: View {
    @Environment(\.appEnvironment) private var env

    @State private var viewModel: TodayViewModel?

    var body: some View {
        NavigationStack {
            Group {
                if let viewModel {
                    content(viewModel: viewModel)
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("Today")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        viewModel?.refresh()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
        }
        .onAppear {
            if viewModel == nil {
                viewModel = TodayViewModel(store: env.todos)
            } else {
                viewModel?.refresh()
            }
        }
    }

    @ViewBuilder
    private func content(viewModel: TodayViewModel) -> some View {
        if viewModel.overdue.isEmpty && viewModel.today.isEmpty {
            ContentUnavailableView(
                "Nothing due today",
                systemImage: "checkmark.circle",
                description: Text("Add a todo from the Lists tab.")
            )
        } else {
            List {
                if !viewModel.overdue.isEmpty {
                    Section("Overdue") {
                        ForEach(viewModel.overdue) { todo in
                            todoRow(todo, viewModel: viewModel)
                        }
                    }
                }
                if !viewModel.today.isEmpty {
                    Section("Today") {
                        ForEach(viewModel.today) { todo in
                            todoRow(todo, viewModel: viewModel)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .refreshable {
                viewModel.refresh()
            }
        }
    }

    private func todoRow(_ todo: Todo, viewModel: TodayViewModel) -> some View {
        TodoRow(todo: todo) {
            viewModel.toggleComplete(todo)
        }
        .swipeActions(edge: .leading) {
            Button {
                viewModel.toggleComplete(todo)
            } label: {
                Label("Complete", systemImage: "checkmark")
            }
            .tint(.green)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(role: .destructive) {
                viewModel.softDelete(todo)
            } label: {
                Label("Delete", systemImage: "trash")
            }
            Button {
                viewModel.snoozeOneDay(todo)
            } label: {
                Label("Snooze", systemImage: "clock")
            }
            .tint(.orange)
        }
    }
}
