import AppKit
import Carbon.HIToolbox
import UserNotifications

// Kaizen smart-capture endpoint (auto-classifies → asset/todo/person/trip/interaction).
let API_URL = "https://personal-os-two-gold.vercel.app/api/capture/smart/auto"
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
        textField.placeholderString = "Capture anything — todo, friend, place, link…"
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
        // Smart capture round-trips through Claude with web search, so it can
        // take a few seconds — give it enough headroom.
        req.timeoutInterval = 30
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(API_TOKEN)", forHTTPHeaderField: "Authorization")
        // New endpoint accepts { text, url? }. If the user pasted a URL into
        // the input, send it as the url field too so Claude can fetch context.
        var body: [String: Any] = ["text": title]
        if let pastedUrl = firstUrl(in: title) {
            body["url"] = pastedUrl
        }
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)

        // Show an interim notification so the user knows it's working —
        // Sonnet + web search can take 5–12s. Updated by the response handler.
        notify(title: "Capturing…", body: title)

        URLSession.shared.dataTask(with: req) { data, response, error in
            DispatchQueue.main.async {
                let http = response as? HTTPURLResponse
                let ok = http.map { (200...299).contains($0.statusCode) } ?? false
                if !ok {
                    notify(
                        title: "Capture failed",
                        body: error?.localizedDescription ?? title
                    )
                    return
                }
                // Pull the classified type out of the response if available.
                var typeLabel = "saved"
                if let data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    if let t = json["type"] as? String {
                        if t == "asset", let kind = json["assetKind"] as? String {
                            typeLabel = kind
                        } else {
                            typeLabel = t
                        }
                    }
                }
                notify(title: "Added · \(typeLabel)", body: title)
            }
        }.resume()
    }
}

// Cheap URL extractor — first http(s):// match in the text, if any.
private func firstUrl(in text: String) -> String? {
    guard let regex = try? NSRegularExpression(pattern: "https?://[^\\s]+") else { return nil }
    let range = NSRange(text.startIndex..., in: text)
    guard let match = regex.firstMatch(in: text, range: range) else { return nil }
    guard let r = Range(match.range, in: text) else { return nil }
    return String(text[r])
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

        // Install a (mostly invisible) main menu so ⌘C / ⌘X / ⌘V / ⌘A reach
        // the NSTextField via the standard responder chain. Without this,
        // accessory apps don't get any keyboard-shortcut routing because
        // there's no Edit menu owning the bindings.
        installMainMenu()

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

    private func installMainMenu() {
        let mainMenu = NSMenu()

        // App menu (just Quit). Hidden but routes ⌘Q.
        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(
            NSMenuItem(
                title: "Quit Quick Todo",
                action: #selector(NSApp.terminate(_:)),
                keyEquivalent: "q"
            )
        )
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        // Edit menu — wires ⌘X / ⌘C / ⌘V / ⌘A / ⌘Z to the standard
        // first-responder selectors. nil target = follow the responder chain.
        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(
            NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        )
        let redo = NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(redo)
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(
            NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        )
        editMenu.addItem(
            NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        )
        editMenu.addItem(
            NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        )
        editMenu.addItem(
            NSMenuItem(
                title: "Select All",
                action: #selector(NSText.selectAll(_:)),
                keyEquivalent: "a"
            )
        )
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        NSApp.mainMenu = mainMenu
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
