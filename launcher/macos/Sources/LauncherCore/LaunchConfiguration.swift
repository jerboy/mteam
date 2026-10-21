import Foundation

public enum Browser: String, Codable, CaseIterable {
    case chrome, edge

    public var applicationName: String { self == .chrome ? "Google Chrome" : "Microsoft Edge" }
    public var supportDirectory: String { self == .chrome ? "Google/Chrome" : "Microsoft Edge" }
}

public enum ConfigurationError: LocalizedError {
    case extensionID, profile

    public var errorDescription: String? {
        switch self {
        case .extensionID: return "未识别到有效的扩展 ID，请重新选择浏览器个人资料。"
        case .profile: return "请填写个人资料目录名，例如 Default 或 Profile 1。"
        }
    }
}

public struct LaunchConfiguration: Codable, Equatable {
    public var browser: Browser
    public var profile: String
    public var extensionID: String
    public var accessBookmarks: [Data]?

    public init(browser: Browser, profile: String, extensionID: String = "", accessBookmarks: [Data]? = nil) {
        self.browser = browser
        self.profile = profile.trimmingCharacters(in: .whitespacesAndNewlines)
        self.extensionID = extensionID.trimmingCharacters(in: .whitespacesAndNewlines)
        self.accessBookmarks = accessBookmarks
    }

    public func validateProfile() throws {
        guard !profile.isEmpty, profile.count <= 128, profile != ".", profile != "..",
              !profile.hasPrefix("-"), !profile.contains("/"), !profile.contains("\\"),
              profile.rangeOfCharacter(from: .controlCharacters) == nil else { throw ConfigurationError.profile }
    }

    public func profileDirectory(home: URL) throws -> URL {
        try validateProfile()
        return home.appendingPathComponent("Library/Application Support")
            .appendingPathComponent(browser.supportDirectory).appendingPathComponent(profile)
    }

    public func arguments() throws -> [String] {
        try validateProfile()
        guard Self.isExtensionID(extensionID) else { throw ConfigurationError.extensionID }
        // An argument array preserves spaces and never invokes a shell.
        return ["--profile-directory=\(profile)", "chrome-extension://\(extensionID)/launch.html"]
    }

    public static func isExtensionID(_ value: String) -> Bool {
        value.utf8.count == 32 && value.range(of: "^[a-p]{32}$", options: .regularExpression) != nil
    }
}
