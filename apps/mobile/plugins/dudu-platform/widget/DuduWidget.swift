// DuduWidget.swift — Home Screen Widget (H5) + Live Activity (H6)
//
// WidgetKit widget reading task snapshots from the App Group (written by
// the TS side via widget-data.ts). Live Activity via ActivityKit.
//
// Status: reference implementation — needs a Widget Extension target
// (see README.md).

import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - Shared models (must match TS widget-data.ts JSON)

struct WidgetTask: Codable, Identifiable {
  let id: String
  let title: String
  let progress: Double
  let status: String
  let stageText: String?
}

struct WidgetData: Codable {
  let updatedAt: Double
  let tasks: [WidgetTask]
  let pendingCount: Int
}

private let appGroupId = "group.app.dudu.mobile"
private let widgetKey = "dudu.widgetData.v1"

func loadWidgetData() -> WidgetData? {
  guard let defaults = UserDefaults(suiteName: appGroupId),
        let json = defaults.string(forKey: widgetKey),
        let data = json.data(using: .utf8) else { return nil }
  return try? JSONDecoder().decode(WidgetData.self, from: data)
}

// MARK: - Timeline

struct DuduEntry: TimelineEntry {
  let date: Date
  let data: WidgetData?
}

struct DuduProvider: TimelineProvider {
  func placeholder(in context: Context) -> DuduEntry {
    DuduEntry(date: Date(), data: nil)
  }
  func getSnapshot(in context: Context, completion: @escaping (DuduEntry) -> Void) {
    completion(DuduEntry(date: Date(), data: loadWidgetData()))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<DuduEntry>) -> Void) {
    let entry = DuduEntry(date: Date(), data: loadWidgetData())
    // Refresh every 15 minutes; TS side triggers reload on updates.
    let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date())!
    completion(Timeline(entries: [entry], policy: .after(next)))
  }
}

// MARK: - Widget views

struct DuduWidgetView: View {
  let entry: DuduEntry

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text("嘟嘟")
          .font(.headline)
        Spacer()
        if let count = entry.data?.pendingCount, count > 0 {
          Text("\(count)")
            .font(.caption2.bold())
            .padding(4)
            .background(Circle().fill(.red))
            .foregroundStyle(.white)
        }
      }
      if let tasks = entry.data?.tasks, !tasks.isEmpty {
        ForEach(tasks.prefix(3)) { task in
          VStack(alignment: .leading, spacing: 2) {
            Text(task.title).font(.caption).lineLimit(1)
            ProgressView(value: task.progress)
              .progressViewStyle(.linear)
          }
        }
      } else {
        Text("没有进行中的任务")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
    .padding()
  }
}

struct DuduWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "DuduWidget", provider: DuduProvider()) { entry in
      DuduWidgetView(entry: entry)
    }
    .configurationDisplayName("嘟嘟任务")
    .description("看看 AI 在忙什么。")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

// MARK: - Live Activity (H6)

struct DuduActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var title: String
    var progress: Double
    var stageText: String
  }
  var id: String
}

struct DuduLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: DuduActivityAttributes.self) { context in
      VStack(alignment: .leading) {
        Text(context.state.title).font(.headline)
        ProgressView(value: context.state.progress)
        Text(context.state.stageText).font(.caption).foregroundStyle(.secondary)
      }
      .padding()
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text("嘟嘟").font(.caption.bold())
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text("\(Int(context.state.progress * 100))%").font(.caption.bold())
        }
        DynamicIslandExpandedRegion(.bottom) {
          ProgressView(value: context.state.progress)
        }
      } compactLeading: {
        Text("嘟嘟").font(.caption2)
      } compactTrailing: {
        ProgressView(value: context.state.progress)
          .frame(width: 24)
      } minimal: {
        ProgressView(value: context.state.progress)
          .frame(width: 16)
      }
    }
  }
}

// MARK: - Widget bundle

@main
struct DuduWidgetBundle: WidgetBundle {
  var body: some Widget {
    DuduWidget()
    if #available(iOSApplicationExtension 16.2, *) {
      DuduLiveActivityWidget()
    }
  }
}
