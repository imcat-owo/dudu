// DuduAlarmKit.swift
//
// Expo native module exposing iOS 26+ AlarmKit to the TS side.
// Follows OpenMinis' AlarmOffloadBridge pattern.
//
// Integration: add this file to the Xcode project via the with-alarmkit
// config plugin (or manually), targeting iOS 26+. The TS side
// (src/voice/alarms.ts) looks for `NativeModulesProxy.DuduAlarmKit`;
// when absent it falls back to scheduled notifications.

import Foundation
import ExpoModulesCore

#if canImport(AlarmKit)
import AlarmKit

@available(iOS 26.0, *)
nonisolated struct DuduAlarmMetadata: AlarmMetadata {}

@available(iOS 26.0, *)
public class DuduAlarmKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DuduAlarmKit")

    Function("isAvailable") { () -> Bool in
      if #available(iOS 26.0, *) { return true }
      return false
    }

    AsyncFunction("requestAuthorization") { () -> Bool in
      if #available(iOS 26.0, *) {
        let state = try await AlarmManager.shared.requestAuthorization()
        return state == .authorized
      }
      return false
    }

    AsyncFunction("scheduleAlarm") { (fireAtMs: Double, label: String) -> String in
      guard #available(iOS 26.0, *) else {
        throw Exception(name: "UNAVAILABLE", description: "AlarmKit requires iOS 26+")
      }
      let fireDate = Date(timeIntervalSince1970: fireAtMs / 1000.0)
      let stopButton = AlarmButton(
        text: "Stop",
        textColor: .white,
        systemImageName: "stop.circle"
      )
      let alert = AlarmPresentation.Alert(
        title: LocalizedStringResource(stringLiteral: label),
        stopButton: stopButton
      )
      let attributes = AlarmAttributes<DuduAlarmMetadata>(
        presentation: AlarmPresentation(alert: alert),
        tintColor: .blue
      )
      let config = AlarmManager.AlarmConfiguration(
        schedule: .fixed(fireDate),
        attributes: attributes
      )
      let alarm = try await AlarmManager.shared.schedule(
        id: UUID().uuidString,
        configuration: config
      )
      return alarm.id.uuidString
    }

    AsyncFunction("cancelAlarm") { (id: String) in
      guard #available(iOS 26.0, *) else { return }
      if let uuid = UUID(uuidString: id) {
        try await AlarmManager.shared.cancel(id: uuid)
      }
    }
  }
}
#endif
