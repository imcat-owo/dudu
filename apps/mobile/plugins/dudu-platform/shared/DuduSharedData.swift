// DuduSharedData.swift — App Group bridge (Expo Modules API)
//
// Exposes the shared App Group container to JS: shared UserDefaults keys
// and the shared file directory. Used by Share Extension intake (H2),
// Widget data (H5), and Files.app publishing (H7).
//
// Status: reference implementation — needs Xcode wiring (see README.md).

import ExpoModulesCore
import Foundation

public class DuduSharedDataModule: Module {
  private let appGroupId = "group.app.dudu.mobile"

  public func definition() -> ModuleDefinition {
    Name("DuduSharedData")

    AsyncFunction("getString") { (key: String) -> String? in
      guard let defaults = UserDefaults(suiteName: self.appGroupId) else { return nil }
      return defaults.string(forKey: key)
    }

    AsyncFunction("setString") { (key: String, value: String) in
      guard let defaults = UserDefaults(suiteName: self.appGroupId) else { return }
      defaults.set(value, forKey: key)
    }

    AsyncFunction("remove") { (key: String) in
      guard let defaults = UserDefaults(suiteName: self.appGroupId) else { return }
      defaults.removeObject(forKey: key)
    }

    AsyncFunction("getSharedFileDir") { () -> String? in
      guard let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: self.appGroupId
      ) else { return nil }
      let dir = container.appendingPathComponent("DuduSharedFiles", isDirectory: true)
      try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      return dir.path
    }

    AsyncFunction("getSharedFilePath") { (name: String) -> String? in
      guard let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: self.appGroupId
      ) else { return nil }
      let url = container.appendingPathComponent("DuduSharedFiles", isDirectory: true)
        .appendingPathComponent(name)
      return FileManager.default.fileExists(atPath: url.path) ? url.path : nil
    }
  }
}
