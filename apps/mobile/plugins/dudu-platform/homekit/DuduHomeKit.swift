// DuduHomeKit.swift — HomeKit bridge (H10, Expo Modules API)
//
// Lets the AI list/control HomeKit accessories and run scenes.
// Requires the com.apple.developer.homekit entitlement + user permission.
//
// Status: reference implementation — needs Xcode wiring (see README.md).

import ExpoModulesCore
import Foundation
import HomeKit

public class DuduHomeKitModule: Module {
  private let homeManager = HMHomeManager()
  private var ready = false

  public func definition() -> ModuleDefinition {
    Name("DuduHomeKit")

    OnCreate {
      // HMHomeManager loads homes asynchronously; poll in each call.
      self.homeManager.delegate = nil
    }

    AsyncFunction("listAccessories") { () -> [[String: Any]] in
      var out: [[String: Any]] = []
      for home in self.homeManager.homes {
        for room in home.rooms {
          for accessory in room.accessories {
            out.append([
              "id": accessory.uniqueIdentifier.uuidString,
              "name": accessory.name,
              "room": room.name,
              "category": accessory.category.categoryType,
              "reachable": accessory.isReachable,
            ])
          }
        }
      }
      return out
    }

    AsyncFunction("getCharacteristics") { (accessoryId: String) -> [[String: Any]] in
      guard let accessory = self.findAccessory(id: accessoryId) else { return [] }
      var out: [[String: Any]] = []
      for service in accessory.services {
        for char in service.characteristics {
          out.append([
            "type": char.characteristicType,
            "value": char.value as Any,
            "writable": char.properties.contains(HMCharacteristicPropertyWritable),
          ])
        }
      }
      return out
    }

    AsyncFunction("setCharacteristic") { (accessoryId: String, type: String, value: Any) -> Bool in
      guard let accessory = self.findAccessory(id: accessoryId) else { return false }
      for service in accessory.services {
        for char in service.characteristics where char.characteristicType == type {
          do {
            try await char.writeValue(value)
            return true
          } catch {
            return false
          }
        }
      }
      return false
    }

    AsyncFunction("listScenes") { () -> [[String: String]] in
      var out: [[String: String]] = []
      for home in self.homeManager.homes {
        for set in home.actionSets {
          out.append(["id": set.uniqueIdentifier.uuidString, "name": set.name])
        }
      }
      return out
    }

    AsyncFunction("runScene") { (sceneId: String) -> Bool in
      for home in self.homeManager.homes {
        for set in home.actionSets where set.uniqueIdentifier.uuidString == sceneId {
          do {
            try await home.executeActionSet(set)
            return true
          } catch {
            return false
          }
        }
      }
      return false
    }
  }

  private func findAccessory(id: String) -> HMAccessory? {
    for home in homeManager.homes {
      for room in home.rooms {
        if let acc = room.accessories.first(where: { $0.uniqueIdentifier.uuidString == id }) {
          return acc
        }
      }
    }
    return nil
  }
}
