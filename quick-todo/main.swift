import AppKit
import Carbon.HIToolbox
import UserNotifications

// Personal OS capture endpoint.
let API_URL = "https://personal-os-two-gold.vercel.app/api/capture/todo"
let API_TOKEN = "nJpdojSLOrDa9q6rLgyDA5Sp9qA"

// MARK: - Capture popup

final class CapturePopup: NSPanel, NSTextFieldDelegate {
    static let shared = CapturePopup()

    private let textField = NSTextField()
    private let hintLabel = NSTextField(labelWithString: "↵ Add  ·  ⎋ Cancel")

    init() {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 560, height: 64),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        level = .floating
        isFloatingPanel = true
        hidesOnDeactivate = true
        isReleasedWhenClosed = false
        hasShadow = true
        backgroundColor = .clear
        animationBehavior = .utilityWindow

        let visual = NSVisualEffectView(frame: contentView!.bounds)
        visual.material = .hudWindow
        visual.state = .active
        visual.wantsLayer = true
        visual.layer?.cornerRadius = 14
        visual.layer?.masksToBounds = true
        visual.autoresizingMask = [.width, .height]
        contentView = visual

        textField.frame = NSRect(x: 18, y: 22, width: 524, height: 30)
        textField.font = .systemFont(ofSize: 22, weight: .regular)
        textField.placeholderString = "Add to inbox…"
        textField.isBezeled = false
        textField.isBordered = false
        textField.drawsBackground = false
        textField.backgroundColor = .clear
        textField.focusRingType = .none
        textField.delegate = self
        textField.autoresizingMask = [.width]
        visual.addSubview(textField)

        hintLabel.frame = NSRect(x: 18, y: 4, width: 524, height: 14)
        hintLabel.font = .systemFont(ofSize: 10, weight: .regular)
        hintLabel.textColor = NSColor.secondaryLabelColor
        hintLabel.alignment = .right
        hintLabel.autoresizingMask = [.width]
        visual.addSubview(hintLabel)
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    func showAtCenter() {
        if let screen = NSScreen.main {
            let f = screen.visibleFrame
            let w = frame.width
            let h = frame.height
            let x = f.midX - w / 2
            let y = f.midY + f.height * 0.18 - h / 2
            setFrame(NSRect(x: x, y: y, width: w, height: h), display: true)
        }
        textField.stringValue = ""
        makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        textField.becomeFirstResponder()
    }

    func submit() {
        let title = textField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        orderOut(nil)
        guard !title.isEmpty else { return }
        post(title: title)
    }

    func control(_ control: NSControl, textView: NSTextView,
                 doCommandBy commandSelector: Selector) -> Bool {
        switch commandSelector {
        case #selector(NSResponder.insertNewline(_:)):
            submit()
            return true
        case #selector(NSResponder.cancelOperation(_:)):
            orderOut(nil)
            return true
        default:
            return false
        }
    }

    private func post(title: String) {
        guard let url = URL(string: API_URL) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 10
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(API_TOKEN)", forHTTPHeaderField: "Authorization")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["title": title])

        URLSession.shared.dataTask(with: req) { _, response, error in
            DispatchQueue.main.async {
                let ok: Bool
                if let http = response as? HTTPURLResponse {
                    ok = (200...299).contains(http.statusCode)
                } else {
                    ok = false
                }
                notify(
                    title: ok ? "Added to Inbox" : "Quick Todo failed",
                    body: error?.localizedDescription ?? title
                )
            }
        }.resume()
    }
}

// MARK: - Notifications

func notify(title: String, body: String) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    let req = UNNotificationRequest(
        identifier: UUID().uuidString,
        content: content,
        trigger: nil
    )
    UNUserNotificationCenter.current().add(req, withCompletionHandler: nil)
}

// MARK: - Global hotkey (Carbon)

final class HotKeyManager {
    static let shared = HotKeyManager()
    private var hotKeyRef: EventHotKeyRef?
    private var handler: EventHandlerRef?

    func register() {
        // ⌃Space (Control + Space). Carbon's controlKey constant = (1 << 12).
        let keyCode: UInt32 = UInt32(kVK_Space)
        let modifiers: UInt32 = UInt32(controlKey)
        registerHotKey(keyCode: keyCode, modifiers: modifiers)
    }

    private func registerHotKey(keyCode: UInt32, modifiers: UInt32) {
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        InstallEventHandler(
            GetEventDispatcherTarget(),
            { (_, eventRef, _) -> OSStatus in
                DispatchQueue.main.async {
                    CapturePopup.shared.showAtCenter()
                }
                return noErr
            },
            1, &eventType, nil, &handler
        )

        let id = EventHotKeyID(signature: 0x51544F44 /* 'QTOD' */, id: 1)
        let status = RegisterEventHotKey(
            keyCode, modifiers, id,
            GetEventDispatcherTarget(), 0, &hotKeyRef
        )
        if status != noErr {
            NSLog("RegisterEventHotKey failed: \(status)")
        }
    }
}

// MARK: - Status item / app delegate

final class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        // Request notification permission silently.
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .sound], completionHandler: { _, _ in }
        )

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem?.button {
            button.image = NSImage(
                systemSymbolName: "tray.and.arrow.down.fill",
                accessibilityDescription: "Quick Todo"
            )
        }

        let menu = NSMenu()
        let cap = NSMenuItem(
            title: "Capture todo…",
            action: #selector(showCapture),
            keyEquivalent: ""
        )
        cap.target = self
        menu.addItem(cap)

        let openItem = NSMenuItem(
            title: "Open Personal OS",
            action: #selector(openApp),
            keyEquivalent: ""
        )
        openItem.target = self
        menu.addItem(openItem)

        menu.addItem(NSMenuItem.separator())

        let quitItem = NSMenuItem(
            title: "Quit Quick Todo",
            action: #selector(NSApp.terminate(_:)),
            keyEquivalent: "q"
        )
        menu.addItem(quitItem)

        statusItem?.menu = menu

        HotKeyManager.shared.register()
    }

    @objc func showCapture() {
        CapturePopup.shared.showAtCenter()
    }

    @objc func openApp() {
        if let url = URL(string: "https://personal-os-two-gold.vercel.app/") {
            NSWorkspace.shared.open(url)
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
