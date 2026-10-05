// DuduShareViewController.swift — Share Extension (H2)
//
// Receives shared text/URLs/images/files from other apps, saves them into
// the App Group, then deep-links into Dudu. Based on OpenMinis'
// ShareExtension pattern.
//
// Status: reference implementation — needs an App Extension target in Xcode
// (see README.md).

import UIKit
import UniformTypeIdentifiers
import MobileCoreServices

class DuduShareViewController: UIViewController {
  private let appGroupId = "group.app.dudu.mobile"
  private let pendingKey = "dudu.pendingShare.v1"

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear

    Task { @MainActor in
      var items: [[String: String]] = []
      let inputItems = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []

      for item in inputItems {
        for provider in item.attachments ?? [] {
          if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            if let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
              items.append(["kind": "text", "value": text])
            }
          } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            if let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
              items.append(["kind": "url", "value": url.absoluteString])
            }
          } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            if let url = try? await provider.loadItem(forTypeIdentifier: UTType.image.identifier) as? URL {
              let saved = self.saveSharedFile(url, kind: "image")
              items.append(["kind": "image", "value": "", "filePath": saved ?? "", "fileName": url.lastPathComponent])
            }
          } else if provider.hasItemConformingToTypeIdentifier(UTType.data.identifier) {
            if let url = try? await provider.loadItem(forTypeIdentifier: UTType.data.identifier) as? URL {
              let saved = self.saveSharedFile(url, kind: "file")
              items.append(["kind": "file", "value": "", "filePath": saved ?? "", "fileName": url.lastPathComponent])
            }
          }
        }
      }

      // Save to shared defaults
      if let defaults = UserDefaults(suiteName: self.appGroupId) {
        let payload: [String: Any] = [
          "items": items,
          "receivedAt": Date().timeIntervalSince1970 * 1000,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: payload),
           let json = String(data: data, encoding: .utf8) {
          defaults.set(json, forKey: self.pendingKey)
        }
      }

      // Deep-link into the app
      if let url = URL(string: "dudu://share") {
        self.extensionContext?.open(url)
      }
      self.extensionContext?.completeRequest(returningItems: [])
    }
  }

  private func saveSharedFile(_ url: URL, kind: String) -> String? {
    guard let container = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: appGroupId
    ) else { return nil }
    let dir = container.appendingPathComponent("DuduSharedFiles", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let dest = dir.appendingPathComponent(url.lastPathComponent)
    // Security-scoped: the extension only has transient access
    let accessing = url.startAccessingSecurityScopedResource()
    defer { if accessing { url.stopAccessingSecurityScopedResource() } }
    try? FileManager.default.copyItem(at: url, to: dest)
    return dest.path
  }
}
