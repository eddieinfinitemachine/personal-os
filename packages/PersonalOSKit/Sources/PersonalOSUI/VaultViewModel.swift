import Foundation
import Observation
import LocalAuthentication
import PersonalOSModels
import PersonalOSServices

@MainActor
@Observable
public final class VaultViewModel {
    public enum LockState: Sendable, Equatable {
        case locked
        case unlocking
        case unlocked
        case error(String)
    }

    public private(set) var lockState: LockState = .locked
    public private(set) var summaries: [VaultEntry.Summary] = []
    /// Map of entryID → currently revealed plaintext value. Cleared on relock.
    public private(set) var revealed: [UUID: VaultEntry] = [:]
    public private(set) var lastError: String?

    /// Auto-relock after this many seconds of inactivity. 0 disables.
    public var inactivityTimeoutSeconds: TimeInterval = 60

    private let store: VaultStore
    private let inactivityClock: () -> Date
    private var lastInteractionAt: Date

    public init(store: VaultStore, clock: @escaping () -> Date = { .now }) {
        self.store = store
        self.inactivityClock = clock
        self.lastInteractionAt = clock()
    }

    public func unlock(reason: String = "Unlock vault") {
        lockState = .unlocking
        do {
            // Loading summaries doesn't decrypt anything — but we use this
            // call to validate the underlying store is reachable.
            summaries = try store.summaries()
            lockState = .unlocked
            lastError = nil
            touch()
        } catch {
            lockState = .error(error.localizedDescription)
            lastError = error.localizedDescription
        }
    }

    /// Force-relock: clears revealed values and returns to gate.
    public func lock() {
        revealed.removeAll()
        lockState = .locked
    }

    /// Refresh summaries — no decryption.
    public func refresh() {
        do {
            summaries = try store.summaries()
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Reveal the plaintext for one entry. Triggers biometric.
    public func reveal(id: UUID) {
        do {
            let entry = try store.reveal(id: id)
            revealed[id] = entry
            touch()
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func hide(id: UUID) {
        revealed.removeValue(forKey: id)
    }

    public func create(label: String, value: String, category: String?, notes: String?) {
        let entry = VaultEntry(
            label: label,
            value: value,
            category: (category?.isEmpty == false) ? category : nil,
            notes: (notes?.isEmpty == false) ? notes : nil
        )
        do {
            try store.create(entry)
            refresh()
            touch()
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func update(id: UUID, label: String, value: String, category: String?, notes: String?) {
        var entry = revealed[id]
        guard entry != nil else {
            lastError = "Reveal the entry before editing."
            return
        }
        entry!.label = label
        entry!.value = value
        entry!.category = (category?.isEmpty == false) ? category : nil
        entry!.notes = (notes?.isEmpty == false) ? notes : nil
        entry!.updatedAt = .now
        do {
            try store.update(entry!)
            revealed[id] = entry
            refresh()
            touch()
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func delete(id: UUID) {
        do {
            try store.delete(id: id)
            revealed.removeValue(forKey: id)
            refresh()
            touch()
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Call this on any user interaction. Resets the inactivity timer.
    public func touch() {
        lastInteractionAt = inactivityClock()
    }

    /// Called periodically (or on scenePhase changes) to maybe auto-relock.
    public func evaluateAutoLock() {
        guard inactivityTimeoutSeconds > 0, lockState == .unlocked else { return }
        let elapsed = inactivityClock().timeIntervalSince(lastInteractionAt)
        if elapsed >= inactivityTimeoutSeconds {
            lock()
        }
    }
}
