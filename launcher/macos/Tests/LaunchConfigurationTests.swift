import Foundation

// Foundation-only unit tests also run with Command Line Tools, without XCTest/Xcode.
@main struct LaunchConfigurationTests {
    static let identifier = "abcdefghijklmnopabcdefghijklmnop"
    struct Failure: Error { let message: String }
    static func check(_ value: Bool, _ message: String) throws {
        if !value { throw Failure(message: message) }
    }
    static func rejects(_ config: LaunchConfiguration) throws {
        do { _ = try config.arguments() }
        catch is ConfigurationError { return }
        throw Failure(message: "Accepted invalid configuration")
    }
    static func main() throws {
        let cases: [(String, () throws -> Void)] = [
            ("selects the profile and extension startup page", {
                let config = LaunchConfiguration(browser: .chrome, profile: "Profile 1", extensionID: identifier)
                try check(config.arguments() == ["--profile-directory=Profile 1", "chrome-extension://\(identifier)/launch.html"], "Launch arguments")
                try check(config.browser.applicationName == "Google Chrome" && Browser.edge.applicationName == "Microsoft Edge", "Browser executable names")
            }),
            ("configuration round trips without account credentials", {
                let config = LaunchConfiguration(browser: .edge, profile: " Default ", extensionID: " \(identifier) ")
                let data = try JSONEncoder().encode(config)
                try check(JSONDecoder().decode(LaunchConfiguration.self, from: data) == config, "JSON round trip")
                try check(config.profile == "Default" && config.arguments().count == 2, "Trimmed values")
            }),
            ("rejects invalid extension IDs and navigation injection", {
                for id in ["", "abc", String(repeating: "q", count: 32), "\(identifier)/options.html", "\(identifier)\n--flag"] {
                    try rejects(LaunchConfiguration(browser: .chrome, profile: "Default", extensionID: id))
                }
            }),
            ("rejects profile paths and control characters", {
                for profile in ["", ".", "..", "../Default", "x/y", "x\\y", "--incognito", "Default\n--flag", String(repeating: "x", count: 129)] {
                    try rejects(LaunchConfiguration(browser: .chrome, profile: profile, extensionID: identifier))
                }
            }),
            ("shell characters remain a single argument", {
                let profile = "Profile $(echo test);'"
                try check(LaunchConfiguration(browser: .chrome, profile: profile, extensionID: identifier).arguments()[0] == "--profile-directory=\(profile)", "Literal argument")
            })
        ]
        print("1..\(cases.count)")
        for (index, entry) in cases.enumerated() {
            try entry.1()
            print("ok \(index + 1) - \(entry.0)")
        }
    }
}
