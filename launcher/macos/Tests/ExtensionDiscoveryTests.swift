import Foundation

struct ExtensionDiscoveryTests {
    static let oldID = String(repeating: "a", count: 32)
    static let newID = String(repeating: "b", count: 32)
    static let otherID = String(repeating: "c", count: 32)
    static let profile = URL(fileURLWithPath: "/Fake/Chrome/Default", isDirectory: true)
    static let check = LaunchConfigurationTests.check
    static let manifest: [String: Any] = [
        "name": "M-Team 资源助手", "manifest_version": 3, "version": "1.11.0",
        "background": ["service_worker": "background.js", "type": "module"],
        "action": ["default_popup": "popup.html"], "options_ui": ["page": "options.html"]
    ]
    static func entry(_ path: String, cached: Bool = false, overrides: [String: Any] = [:]) -> [String: Any] {
        var value: [String: Any] = ["path": path, "location": 4, "disable_reasons": []]
        if cached { value["manifest"] = manifest }
        return value.merging(overrides) { _, new in new }
    }
    final class Files {
        var data: [String: Data] = [:]
        var errors: [String: Error] = [:]
        var reads: [String] = []
        func put(_ path: String, _ value: [String: Any]) throws { data[path] = try JSONSerialization.data(withJSONObject: value) }
        func preferences(_ entries: [String: [String: Any]], secure: Bool = false, uninstalled: [String] = []) throws {
            try put(profile.appendingPathComponent(secure ? "Secure Preferences" : "Preferences").path,
                    ["extensions": ["settings": entries, "external_uninstalls": uninstalled]])
        }
        var detector: ExtensionDiscovery {
            ExtensionDiscovery { url in
                self.reads.append(url.path)
                if let error = self.errors[url.path] { throw error }
                guard let data = self.data[url.path] else { throw CocoaError(.fileReadNoSuchFile) }
                return data
            }
        }
    }
    static func expect(_ expected: DiscoveryError, _ operation: () throws -> Void) throws {
        do { try operation() }
        catch let error as DiscoveryError { try check(error == expected, "Unexpected discovery error: \(error)"); return }
        throw LaunchConfigurationTests.Failure(message: "Expected discovery failure")
    }
    static let cases: [(String, () throws -> Void)] = [
        ("old launcher settings migrate to automatic discovery without losing the chosen profile", {
            let data = Data("{\"browser\":\"chrome\",\"profile\":\"Default\",\"extensionID\":\"\(oldID)\"}".utf8)
            let config = try JSONDecoder().decode(LaunchConfiguration.self, from: data)
            try check(config.extensionID == oldID && config.accessBookmarks == nil, "Legacy configuration")
            try LaunchConfiguration(browser: .edge, profile: "Profile 2").validateProfile()
            try check(LaunchConfiguration(browser: .edge, profile: "Profile 2").profileDirectory(home: URL(fileURLWithPath: "/Fake" )).path == "/Fake/Library/Application Support/Microsoft Edge/Profile 2", "Selected browser profile")
        }),
        ("an unpacked installation is identified by its manifest and actual registry ID", {
            let f = Files()
            try f.preferences([newID: entry("/Sources/mteam/extension")])
            try f.put("/Sources/mteam/extension/manifest.json", manifest)
            let candidates = try f.detector.installed(in: profile)
            try check(candidates.count == 1 && candidates[0].id == newID, "Installed ID")
            try check(ExtensionDiscovery.preferred(candidates, previousID: oldID)?.id == newID, "Obsolete binding replaced")
        }),
        ("moving and reloading an extension updates its ID on the next scan", {
            let f = Files()
            try f.preferences([oldID: entry("/Old/extension")])
            try f.put("/Old/extension/manifest.json", manifest)
            var config = LaunchConfiguration(browser: .chrome, profile: "Default", extensionID: oldID)
            config.extensionID = try f.detector.installed(in: profile)[0].id
            try f.preferences([newID: entry("/New/extension")])
            try f.put("/New/extension/manifest.json", manifest)
            config.extensionID = ExtensionDiscovery.preferred(try f.detector.installed(in: profile), previousID: config.extensionID)!.id
            try check(config.arguments()[1] == "chrome-extension://\(newID)/launch.html", "Moved extension URL")
        }),
        ("Secure Preferences supplies metadata and overrides disabled state in Preferences", {
            let f = Files()
            try f.preferences([oldID: entry("/Old/extension", overrides: ["state": 1])])
            try f.preferences([oldID: ["disable_reasons": [1]], newID: entry("/New/extension")], secure: true)
            try f.put("/New/extension/manifest.json", manifest)
            let candidates = try f.detector.installed(in: profile)
            try check(candidates.map(\.id) == [newID], "Secure disabled state")
            try check(!f.reads.contains("/Old/extension/manifest.json"), "Disabled extension not read")
        }),
        ("supports legacy enabled state and both list and bitmask disable reasons", {
            for flags: [String: Any] in [["state": 1], ["disable_reasons": 0], ["disable_reasons": []]] {
                let f = Files(); try f.preferences([newID: entry("/New", overrides: flags)])
                try f.put("/New/manifest.json", manifest)
                try check(f.detector.installed(in: profile).count == 1, "Enabled form")
            }
            for flags: [String: Any] in [["state": 0], ["state": 2], ["disable_reasons": 1], ["disable_reasons": [1]], ["disable_reasons": "unknown"], ["blacklist_state": 1], ["blacklist": true]] {
                let f = Files(); try f.preferences([newID: entry("/New", overrides: flags)])
                try expect(.notInstalled) { _ = try f.detector.installed(in: profile) }
                try check(!f.reads.contains("/New/manifest.json"), "Disabled installation skipped")
            }
        }),
        ("removed directories and uninstalled entries cannot keep stale IDs alive", {
            let f = Files()
            try f.preferences([oldID: entry("/Deleted", cached: true), newID: entry("/Uninstalled", cached: true)], uninstalled: [newID])
            try f.put("/Uninstalled/manifest.json", manifest)
            try expect(.notInstalled) { _ = try f.detector.installed(in: profile) }
        }),
        ("multiple copies preserve a valid prior choice and otherwise require selection", {
            let f = Files()
            try f.preferences([oldID: entry("/A"), newID: entry("/B")])
            try f.put("/A/manifest.json", manifest); try f.put("/B/manifest.json", manifest)
            let candidates = try f.detector.installed(in: profile)
            try check(ExtensionDiscovery.preferred(candidates, previousID: newID)?.id == newID, "Saved choice")
            try check(ExtensionDiscovery.preferred(candidates, previousID: otherID) == nil, "Ambiguous installation")
        }),
        ("unrelated and incompatible extensions are excluded", {
            for overrides: [String: Any] in [["name": "Another extension"], ["manifest_version": 2], ["version": "1.9.0"], ["version": "1.10.bad.0"], ["background": ["service_worker": "other.js"]]] {
                let f = Files(); try f.preferences([newID: entry("/New")])
                try f.put("/New/manifest.json", manifest.merging(overrides) { _, new in new })
                try expect(.notInstalled) { _ = try f.detector.installed(in: profile) }
            }
        }),
        ("packed extension paths resolve only within the selected profile's Extensions directory", {
            let f = Files()
            try f.preferences([newID: entry("\(newID)/1.11.0_0", cached: true)])
            let path = profile.appendingPathComponent("Extensions/\(newID)/1.11.0_0/manifest.json").path
            try f.put(path, manifest)
            try check(f.detector.installed(in: profile)[0].id == newID, "Packed extension")
            try check(f.reads.contains(path), "Selected profile path")
        }),
        ("rejects malformed registry IDs and relative path escapes", {
            for (id, path) in [("not-an-id", "/New"), (newID, "../elsewhere"), (newID, "\(newID)/.."), (newID, "\(otherID)/1.11.0_0")] {
                let f = Files(); try f.preferences([id: entry(path)])
                try expect(.notInstalled) { _ = try f.detector.installed(in: profile) }
                try check(f.reads.count == 2, "No traversal or arbitrary manifest read")
            }
        }),
        ("missing and denied browser registries never fall back to cached launcher IDs", {
            let f = Files()
            try expect(.unavailable) { _ = try f.detector.installed(in: profile) }
            try f.preferences([oldID: entry("/Old", cached: true)])
            f.errors[profile.appendingPathComponent("Secure Preferences").path] = CocoaError(.fileReadNoPermission)
            try expect(.unavailable) { _ = try f.detector.installed(in: profile) }
        }),
        ("a malformed registry stops discovery rather than selecting from partial data", {
            let f = Files()
            try f.preferences([newID: entry("/New", cached: true)])
            f.data[profile.appendingPathComponent("Secure Preferences").path] = Data("{broken".utf8)
            try expect(.malformed) { _ = try f.detector.installed(in: profile) }
        }),
        ("manifest access denial can use a matching cached identity or request explicit folder access", {
            let f = Files(); try f.preferences([newID: entry("/New", cached: true)])
            f.errors["/New/manifest.json"] = CocoaError(.fileReadNoPermission)
            try check(f.detector.installed(in: profile)[0].id == newID, "Cached browser metadata")
            try f.preferences([newID: entry("/New")])
            try expect(.manifestAccess(URL(fileURLWithPath: "/New", isDirectory: true))) { _ = try f.detector.installed(in: profile) }
        })
    ]
}
