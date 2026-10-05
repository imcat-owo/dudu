// DuduIntents.swift — Siri Shortcuts / App Intents (H4)
//
// Three intents: ask Dudu, open a dialog, start a new chat.
// Based on OpenMinis' SendPromptIntent pattern (AppIntents framework).
//
// Status: reference implementation — needs Xcode integration (see README.md).

import AppIntents
import Foundation

// MARK: - Ask Dudu

struct AskDuduIntent: AppIntent {
  static var title: LocalizedStringResource = "Ask Dudu"
  static var description = IntentDescription("Send a prompt to Dudu and get an answer.")

  @Parameter(title: "Prompt", requestValueDialog: "What would you like to ask Dudu?")
  var prompt: String

  static var openAppWhenRun = true

  @MainActor
  func perform() async throws -> some IntentResult & ProvidesDialog {
    // Deep-link into the app with the prompt; the app handles the rest.
    let encoded = prompt.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
    if let url = URL(string: "dudu://siri?action=ask&prompt=\(encoded)") {
      await UIApplication.shared.open(url)
    }
    return .result(dialog: "Asking Dudu…")
  }
}

// MARK: - Open Dialog

struct OpenDialogIntent: AppIntent {
  static var title: LocalizedStringResource = "Open Dudu Conversation"
  static var description = IntentDescription("Open a Dudu conversation.")

  static var openAppWhenRun = true

  @MainActor
  func perform() async throws -> some IntentResult {
    if let url = URL(string: "dudu://siri?action=open") {
      await UIApplication.shared.open(url)
    }
    return .result()
  }
}

// MARK: - New Chat

struct NewChatIntent: AppIntent {
  static var title: LocalizedStringResource = "New Dudu Chat"
  static var description = IntentDescription("Start a new chat with Dudu.")

  static var openAppWhenRun = true

  @MainActor
  func perform() async throws -> some IntentResult {
    if let url = URL(string: "dudu://siri?action=new") {
      await UIApplication.shared.open(url)
    }
    return .result()
  }
}
