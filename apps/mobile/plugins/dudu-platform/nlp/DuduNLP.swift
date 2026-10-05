// DuduNLP.swift — Apple NaturalLanguage bridge (H11, Expo Modules API)
//
// On-device: language detection, named entities, sentiment. No network.
//
// Status: reference implementation — needs Xcode wiring (see README.md).

import ExpoModulesCore
import Foundation
import NaturalLanguage

public class DuduNLPModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DuduNLP")

    AsyncFunction("dominantLanguage") { (text: String) -> String? in
      let recognizer = NLLanguageRecognizer()
      recognizer.processString(text)
      return recognizer.dominantLanguage?.rawValue
    }

    AsyncFunction("entities") { (text: String) -> [[String: Any]] in
      let tagger = NLTagger(tagSchemes: [.nameType])
      tagger.string = text
      var out: [[String: Any]] = []
      let options: NLTagger.Options = [.omitPunctuation, .omitWhitespace, .joinNames]
      tagger.enumerateTags(in: text.startIndex..<text.endIndex, unit: .word, scheme: .nameType, options: options) { tag, range in
        if let tag = tag {
          out.append([
            "text": String(text[range]),
            "type": tag.rawValue,
          ])
        }
        return true
      }
      return out
    }

    AsyncFunction("sentiment") { (text: String) -> Double? in
      let tagger = NLTagger(tagSchemes: [.sentimentScore])
      tagger.string = text
      let (score, _) = tagger.tag(at: text.startIndex, unit: .paragraph, scheme: .sentimentScore)
      if let score = score, let value = Double(score.rawValue) {
        return value
      }
      return nil
    }
  }
}
