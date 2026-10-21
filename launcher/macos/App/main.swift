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
        let configure = saved == nil || (try? saved?.validateProfile()) == nil || NSEvent.modifierFlags.contains(.option)
        guard var config = configure ? askConfiguration(saved) : saved else {
            NSApp.terminate(nil)
            return
        }
        do {
            let application = [URL(fileURLWithPath: "/Applications"), FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications")]
                .map { $0.appendingPathComponent("\(config.browser.applicationName).app/Contents/MacOS/\(config.browser.applicationName)") }
                .first { FileManager.default.isExecutableFile(atPath: $0.path) }
            guard let executable = application else {
                showError("请先安装 \(config.browser.applicationName)。")
                NSApp.terminate(nil)
                return
            }
            guard try resolveExtension(&config) else { NSApp.terminate(nil); return }
            let arguments = try config.arguments()
            try save(config)
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

    private func save(_ config: LaunchConfiguration) throws {
        try FileManager.default.createDirectory(at: configURL.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(config).write(to: configURL, options: .atomic)
    }

    private func resolveExtension(_ config: inout LaunchConfiguration) throws -> Bool {
        let profile = try config.profileDirectory(home: FileManager.default.homeDirectoryForCurrentUser)
        var scopes: [URL] = []
        defer { scopes.forEach { $0.stopAccessingSecurityScopedResource() } }
        for bookmark in config.accessBookmarks ?? [] {
            var stale = false
            let scoped = try? URL(resolvingBookmarkData: bookmark, options: [.withSecurityScope, .withoutUI], bookmarkDataIsStale: &stale)
            if let url = scoped ?? (try? URL(resolvingBookmarkData: bookmark, options: [.withoutUI], bookmarkDataIsStale: &stale)), url.startAccessingSecurityScopedResource() {
                scopes.append(url)
            }
        }
        var requested = Set<URL>()
        while true {
            do {
                let candidates = try ExtensionDiscovery().installed(in: profile)
                guard let selected = ExtensionDiscovery.preferred(candidates, previousID: config.extensionID) ?? chooseExtension(candidates) else { return false }
                config.extensionID = selected.id
                return true
            } catch let error as DiscoveryError {
                let directory: URL
                switch error {
                case .unavailable: directory = profile
                case .manifestAccess(let path): directory = path
                default: throw error
                }
                // If explicit access was still denied, stop instead of looping or using a stale ID.
                guard requested.insert(directory).inserted else { throw error }
                guard let granted = authorizeDirectory(directory, isProfile: directory == profile) else { return false }
                if granted.startAccessingSecurityScopedResource() { scopes.append(granted) }
                let scopedBookmark = try? granted.bookmarkData(options: [.withSecurityScope, .securityScopeAllowOnlyReadAccess], includingResourceValuesForKeys: nil, relativeTo: nil)
                let bookmark = try scopedBookmark ?? granted.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
                config.accessBookmarks = (config.accessBookmarks ?? []) + [bookmark]
                try save(config)
            }
        }
    }

    private func authorizeDirectory(_ directory: URL, isProfile: Bool) -> URL? {
        NSApp.activate(ignoringOtherApps: true)
        let panel = NSOpenPanel()
        panel.title = isProfile ? "读取浏览器扩展清单" : "读取扩展信息"
        panel.message = isProfile ? "请选择 \(directory.lastPathComponent) 个人资料文件夹。" : "请选择此安装目录，以读取 manifest.json。"
        panel.prompt = "允许访问"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.directoryURL = directory
        while panel.runModal() == .OK {
            if let selected = panel.url, selected.standardizedFileURL.path == directory.standardizedFileURL.path { return selected }
            panel.message = "请选择 \(directory.path)"
        }
        return nil
    }

    private func chooseExtension(_ candidates: [InstalledExtension]) -> InstalledExtension? {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "选择 M-Team 扩展"
        alert.informativeText = "此个人资料中有多份安装。"
        alert.addButton(withTitle: "打开")
        alert.addButton(withTitle: "取消")
        let choices = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 560, height: 28))
        for candidate in candidates { choices.addItem(withTitle: "v\(candidate.version) · \(candidate.directory.path)") }
        alert.accessoryView = choices
        guard alert.runModal() == .alertFirstButtonReturn else { return nil }
        return candidates[choices.indexOfSelectedItem]
    }

    private func askConfiguration(_ previous: LaunchConfiguration?) -> LaunchConfiguration? {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "连接浏览器扩展"
        alert.informativeText = "自动识别此个人资料中的 M-Team 扩展。"
        alert.addButton(withTitle: "打开")
        alert.addButton(withTitle: "取消")
        let browser = NSPopUpButton(frame: NSRect(x: 100, y: 48, width: 270, height: 28))
        browser.addItems(withTitles: Browser.allCases.map(\.applicationName))
        browser.selectItem(at: Browser.allCases.firstIndex(of: previous?.browser ?? .chrome) ?? 0)
        let profile = NSTextField(frame: NSRect(x: 100, y: 4, width: 270, height: 26))
        profile.stringValue = previous?.profile ?? "Default"
        profile.placeholderString = "Default 或 Profile 1"
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 370, height: 84))
        for (text, y) in [("浏览器", 52), ("个人资料", 8)] {
            let label = NSTextField(labelWithString: text)
            label.frame = NSRect(x: 0, y: y, width: 92, height: 20)
            view.addSubview(label)
        }
        [browser, profile].forEach { view.addSubview($0) }
        browser.nextKeyView = profile
        alert.accessoryView = view
        while alert.runModal() == .alertFirstButtonReturn {
            var config = LaunchConfiguration(browser: Browser.allCases[browser.indexOfSelectedItem], profile: profile.stringValue)
            if config.browser == previous?.browser && config.profile == previous?.profile, let previous { config = previous }
            do {
                try config.validateProfile()
                try save(config)
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
