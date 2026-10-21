import AppKit
import Foundation

final class LauncherDelegate: NSObject, NSApplicationDelegate {
    private let configURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/M-Team Launcher/config.json")
    private var launching = false
    private var process: Process?

    func applicationDidFinishLaunching(_ notification: Notification) { launch() }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        launch()
        return false
    }

    private func launch() {
        guard !launching else { return }
        launching = true
        defer { launching = false }
        let saved = (try? Data(contentsOf: configURL)).flatMap { try? JSONDecoder().decode(LaunchConfiguration.self, from: $0) }
        let configure = saved == nil || (try? saved?.arguments()) == nil || NSEvent.modifierFlags.contains(.option)
        guard let config = configure ? askConfiguration(saved) : saved else {
            NSApp.terminate(nil)
            return
        }
        do {
            let arguments = try config.arguments()
            let application = [URL(fileURLWithPath: "/Applications"), FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications")]
                .map { $0.appendingPathComponent("\(config.browser.applicationName).app/Contents/MacOS/\(config.browser.applicationName)") }
                .first { FileManager.default.isExecutableFile(atPath: $0.path) }
            guard let executable = application else {
                showError("请先安装 \(config.browser.applicationName)。")
                NSApp.terminate(nil)
                return
            }
            // Launch Chrome's executable so profile arguments also reach an already-running browser.
            let browser = Process()
            browser.executableURL = executable
            browser.arguments = arguments
            browser.standardOutput = FileHandle.nullDevice
            browser.standardError = FileHandle.nullDevice
            try browser.run()
            process = browser
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [self] in
                if let process, !process.isRunning, process.terminationStatus != 0 {
                    showError("浏览器未能启动，请确认个人资料设置后重试。按住 Option 打开可修改入口。")
                }
                NSApp.terminate(nil)
            }
        } catch {
            showError(error.localizedDescription)
            NSApp.terminate(nil)
        }
    }

    private func askConfiguration(_ previous: LaunchConfiguration?) -> LaunchConfiguration? {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "连接浏览器扩展"
        alert.informativeText = "扩展 ID 见扩展管理页；个人资料目录名见 chrome://version 或 edge://version。"
        alert.addButton(withTitle: "打开")
        alert.addButton(withTitle: "取消")
        let browser = NSPopUpButton(frame: NSRect(x: 100, y: 92, width: 270, height: 28))
        browser.addItems(withTitles: Browser.allCases.map(\.applicationName))
        browser.selectItem(at: Browser.allCases.firstIndex(of: previous?.browser ?? .chrome) ?? 0)
        let profile = NSTextField(frame: NSRect(x: 100, y: 48, width: 270, height: 26))
        profile.stringValue = previous?.profile ?? "Default"
        let identifier = NSTextField(frame: NSRect(x: 100, y: 4, width: 270, height: 26))
        identifier.stringValue = previous?.extensionID ?? ""
        identifier.placeholderString = "32 位扩展 ID"
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 370, height: 128))
        for (text, y) in [("浏览器", 96), ("个人资料", 52), ("扩展 ID", 8)] {
            let label = NSTextField(labelWithString: text)
            label.frame = NSRect(x: 0, y: y, width: 92, height: 20)
            view.addSubview(label)
        }
        [browser, profile, identifier].forEach { view.addSubview($0) }
        browser.nextKeyView = profile
        profile.nextKeyView = identifier
        alert.accessoryView = view
        while alert.runModal() == .alertFirstButtonReturn {
            let config = LaunchConfiguration(browser: Browser.allCases[browser.indexOfSelectedItem], profile: profile.stringValue, extensionID: identifier.stringValue)
            do {
                _ = try config.arguments()
                try FileManager.default.createDirectory(at: configURL.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                try JSONEncoder().encode(config).write(to: configURL, options: .atomic)
                return config
            } catch { alert.informativeText = error.localizedDescription }
        }
        return nil
    }

    private func showError(_ message: String) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "无法打开 M-Team"
        alert.informativeText = message
        alert.runModal()
    }
}

let application = NSApplication.shared
let delegate = LauncherDelegate()
application.setActivationPolicy(.accessory)
application.delegate = delegate
application.run()
