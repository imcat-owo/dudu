// DuduFileProvider.swift — Files.app integration (H7)
//
// NSFileProviderReplicatedExtension exposing the shared DuduSharedFiles
// directory in the system Files app. Based on OpenMinis' FileProvider.
//
// Status: reference implementation — needs a File Provider extension
// target in Xcode (see README.md).

import FileProvider
import UniformTypeIdentifiers
import os.log

final class DuduFileProviderExtension: NSObject, NSFileProviderReplicatedExtension {
  let domain: NSFileProviderDomain
  private static let log = OSLog(subsystem: "app.dudu.mobile.FileProvider", category: "Extension")

  static var providerRoot: URL {
    let container = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: "group.app.dudu.mobile"
    )!
    let url = container.appendingPathComponent("DuduSharedFiles", isDirectory: true)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  required init(domain: NSFileProviderDomain) {
    self.domain = domain
    super.init()
    os_log("DuduFileProvider init — domain: %{public}@", log: Self.log, type: .info,
           domain.identifier.rawValue)
  }

  func invalidate() {
    // Cleanup when the extension is torn down.
  }

  // MARK: - NSFileProviderReplicatedExtension

  func materializedItemsDidChange(completionHandler: @escaping () -> Void) {
    completionHandler()
  }
}
