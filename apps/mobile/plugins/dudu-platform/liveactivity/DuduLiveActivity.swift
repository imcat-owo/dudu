// DuduLiveActivity.swift — Live Activity controller (H6, Expo Modules API)
//
// Bridges ActivityKit to JS (src/platform/live-activity.ts).
// The widget UI itself lives in widget/DuduWidget.swift.
//
// Status: reference implementation — needs Xcode wiring (see README.md).

import ActivityKit
import ExpoModulesCore
import Foundation

// Must match DuduActivityAttributes in the widget extension.
struct DuduActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var title: String
    var progress: Double
    var stageText: String
  }
  var id: String
}

public class DuduLiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DuduLiveActivity")

    AsyncFunction("start") { (id: String, title: String, progress: Double, stageText: String) -> Bool in
      guard #available(iOS 16.2, *) else { return false }
      let attributes = DuduActivityAttributes(id: id)
      let state = DuduActivityAttributes.ContentState(title: title, progress: progress, stageText: stageText)
      do {
        _ = try Activity<DuduActivityAttributes>.request(
          attributes: attributes,
          content: .init(state: state, staleDate: nil)
        )
        return true
      } catch {
        return false
      }
    }

    AsyncFunction("update") { (id: String, title: String?, progress: Double?, stageText: String?) -> Bool in
      guard #available(iOS 16.2, *) else { return false }
      let activities = Activity<DuduActivityAttributes>.activities.filter { $0.attributes.id == id }
      guard let activity = activities.first else { return false }
      var state = activity.content.state
      if let t = title { state.title = t }
      if let p = progress { state.progress = p }
      if let s = stageText { state.stageText = s }
      await activity.update(.init(state: state, staleDate: nil))
      return true
    }

    AsyncFunction("end") { (id: String) -> Bool in
      guard #available(iOS 16.2, *) else { return false }
      let activities = Activity<DuduActivityAttributes>.activities.filter { $0.attributes.id == id }
      for activity in activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      return !activities.isEmpty
    }

    AsyncFunction("isActive") { (id: String) -> Bool in
      guard #available(iOS 16.2, *) else { return false }
      return !Activity<DuduActivityAttributes>.activities.filter { $0.attributes.id == id }.isEmpty
    }
  }
}
