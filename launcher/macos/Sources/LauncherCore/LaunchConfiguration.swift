import Foundation

public enum Browser: String, Codable, CaseIterable {
    case chrome, edge

    public var applicationName: String { self == .chrome ? "Google Chrome" : "Microsoft Edge" }
}

public enum ConfigurationError: LocalizedError {
    case extensionID, profile

    public var errorDescription: String? {
        switch self {
        case .extensionID: return "请填写扩展管理页中的 32 位扩展 ID。"
        case .profile: return "请填写个人资料目录名，例如 Default 或 Profile 1。"
        }
    }
}

public struct LaunchConfiguration: Codable, Equatable {
    public var browser: Browser
    public var profile: String
    public var extensionID: String

    public init(browser: Browser, profile: String, extensionID: String) {
        self.browser = browser
        self.profile = profile.trimmingCharacters(in: .whitespacesAndNewlines)
        self.extensionID = extensionID.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public func arguments() throws -> [String] {
        guard extensionID.range(of: "^[a-p]{32}$", options: .regularExpression) != nil,
              extensionID.utf8.count == 32 else { throw ConfigurationError.extensionID }
        guard !profile.isEmpty, profile.count <= 128, profile != ".", profile != "..",
              !profile.hasPrefix("-"), !profile.contains("/"), !profile.contains("\\"),
              profile.rangeOfCharacter(from: .controlCharacters) == nil else { throw ConfigurationError.profile }
        // An argument array preserves spaces and never invokes a shell.
        return ["--profile-directory=\(profile)", "chrome-extension://\(extensionID)/launch.html"]
    }
}
