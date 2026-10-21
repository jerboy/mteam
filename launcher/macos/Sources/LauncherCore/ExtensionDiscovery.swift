import Foundation

public struct InstalledExtension: Equatable {
    public let id: String
    public let version: String
    public let directory: URL
}

public enum DiscoveryError: LocalizedError, Equatable {
    case unavailable, malformed, notInstalled, manifestAccess(URL)

    public var errorDescription: String? {
        switch self {
        case .unavailable: return "无法读取浏览器扩展清单，请选择个人资料文件夹以允许访问。"
        case .malformed: return "浏览器扩展清单暂时无法解析，请稍后重试。"
        case .notInstalled: return "未找到已启用的 M-Team 扩展，请在所选浏览器个人资料中加载 1.10.0 或更新版本。"
        case .manifestAccess: return "无法读取已安装扩展的文件，请允许访问其安装目录后重试。"
        }
    }
}

public struct ExtensionDiscovery {
    // Injection keeps unit tests entirely in memory: no browser files or processes.
    public var read: (URL) throws -> Data
    public init(read: @escaping (URL) throws -> Data = { try Data(contentsOf: $0) }) { self.read = read }

    public func installed(in profile: URL) throws -> [InstalledExtension] {
        var settings: [String: [String: Any]] = [:]
        var readCount = 0
        var uninstalled = Set<String>()
        // Secure Preferences overrides matching fields, including disabled state.
        for name in ["Preferences", "Secure Preferences"] {
            let data: Data
            do { data = try read(profile.appendingPathComponent(name)) }
            catch {
                if Self.isMissing(error) { continue }
                throw DiscoveryError.unavailable
            }
            guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw DiscoveryError.malformed }
            readCount += 1
            guard let extensions = object["extensions"] as? [String: Any] else { continue }
            uninstalled.formUnion(extensions["external_uninstalls"] as? [String] ?? [])
            if let entries = extensions["settings"] as? [String: [String: Any]] {
                for (id, entry) in entries { settings[id, default: [:]].merge(entry) { _, secure in secure } }
            }
        }
        guard readCount > 0 else { throw DiscoveryError.unavailable }
        var candidates: [InstalledExtension] = []
        var inaccessible: URL?
        for (id, entry) in settings.sorted(by: { $0.key < $1.key }) {
            guard LaunchConfiguration.isExtensionID(id), !uninstalled.contains(id), Self.isEnabled(entry),
                  let path = entry["path"] as? String, let directory = Self.directory(path, id: id, profile: profile) else { continue }
            let cached = entry["manifest"] as? [String: Any]
            // Do not read unrelated installed extensions when their cached identity is available.
            if let cached, !Self.isMTeam(cached) { continue }
            let manifest: [String: Any]
            do {
                let data = try read(directory.appendingPathComponent("manifest.json"))
                guard let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                manifest = parsed
            } catch {
                if Self.isMissing(error) { continue } // Removed directory, not an installed candidate.
                // A cached identity is sufficient when the OS protects the installation directory.
                if let cached, Self.isMTeam(cached) { manifest = cached }
                else { inaccessible = directory; continue }
            }
            guard Self.isMTeam(manifest), let version = manifest["version"] as? String else { continue }
            candidates.append(InstalledExtension(id: id, version: version, directory: directory))
        }
        if candidates.isEmpty, let inaccessible { throw DiscoveryError.manifestAccess(inaccessible) }
        guard !candidates.isEmpty else { throw DiscoveryError.notInstalled }
        return candidates
    }

    public static func preferred(_ candidates: [InstalledExtension], previousID: String) -> InstalledExtension? {
        if candidates.count == 1 { return candidates.first }
        return candidates.first { $0.id == previousID }
    }

    private static func isMissing(_ error: Error) -> Bool {
        let error = error as NSError
        return (error.domain == NSCocoaErrorDomain && error.code == CocoaError.fileReadNoSuchFile.rawValue) ||
            (error.domain == NSPOSIXErrorDomain && error.code == 2)
    }

    private static func isEnabled(_ entry: [String: Any]) -> Bool {
        if let state = entry["state"], (state as? Int) != 1 { return false }
        if let reasons = entry["disable_reasons"] {
            if let list = reasons as? [Any] { if !list.isEmpty { return false } }
            else if let bits = reasons as? Int { if bits != 0 { return false } }
            else { return false }
        }
        for key in ["blacklist_state", "blocklist_state"] {
            if let value = entry[key], (value as? Int) != 0 { return false }
        }
        return (entry["blacklist"] as? Bool) != true && (entry["blocklist"] as? Bool) != true
    }

    private static func directory(_ path: String, id: String, profile: URL) -> URL? {
        guard !path.isEmpty, path.rangeOfCharacter(from: .controlCharacters) == nil else { return nil }
        if path.hasPrefix("/") { return URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL }
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 2, parts[0] == id, !["", ".", ".."].contains(String(parts[1])) else { return nil }
        return profile.appendingPathComponent("Extensions").appendingPathComponent(path, isDirectory: true)
    }

    private static func isMTeam(_ manifest: [String: Any]) -> Bool {
        guard manifest["name"] as? String == "M-Team 资源助手", manifest["manifest_version"] as? Int == 3,
              let background = manifest["background"] as? [String: Any], background["service_worker"] as? String == "background.js",
              background["type"] as? String == "module",
              (manifest["action"] as? [String: Any])?["default_popup"] as? String == "popup.html",
              (manifest["options_ui"] as? [String: Any])?["page"] as? String == "options.html",
              let version = manifest["version"] as? String else { return false }
        let components = version.split(separator: ".", omittingEmptySubsequences: false)
        let parts = components.compactMap { Int($0) }
        return components.count == 3 && parts.count == 3 && parts[0] == 1 && parts[1] >= 10 && parts.allSatisfy { (0...65535).contains($0) }
    }
}
