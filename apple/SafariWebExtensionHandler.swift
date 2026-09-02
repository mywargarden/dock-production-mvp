import Foundation
import SafariServices
import os.log

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    private let managedConfigurationKey = "com.apple.configuration.managed"
    private let allowedPolicyKeys: Set<String> = [
        "orgCode",
        "organizationName",
        "emailDomain",
        "apiBaseUrl",
        "configUrl",
        "forceManagedMode",
        "allowLegacyFallback",
        "supabaseUrl",
        "supabaseAnonKey",
        "districtId",
        "licenseStatus",
        "licenseExpiresAt",
        "licenseGraceUntil"
    ]

    private func managedPolicy() -> [String: Any] {
        let defaults = UserDefaults.standard
        var raw = defaults.dictionary(forKey: managedConfigurationKey) ?? [:]

        // Some MDM payloads wrap vendor configuration inside a Dock-specific key.
        // Accept that shape without changing the keys the shared WebExtension sees.
        if let nested = raw["dockManagedPolicy"] as? [String: Any] {
            raw = nested
        }

        var policy: [String: Any] = [:]
        for key in allowedPolicyKeys {
            guard let value = raw[key] else { continue }
            if value is String || value is Bool || value is NSNumber {
                policy[key] = value
            }
        }
        return policy
    }

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message: Any?

        if #available(iOS 15.0, macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }

        let type = (message as? [String: Any])?["type"] as? String ?? ""
        let payload: [String: Any]

        switch type {
        case "DOCK_GET_MANAGED_POLICY":
            payload = ["managedPolicy": managedPolicy()]
        default:
            payload = ["ok": true]
        }

        os_log(.debug, "Dock Safari native message: %{public}@", type)

        let response = NSExtensionItem()
        if #available(iOS 15.0, macOS 11.0, *) {
            response.userInfo = [SFExtensionMessageKey: payload]
        } else {
            response.userInfo = ["message": payload]
        }
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
