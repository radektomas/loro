import SwiftUI
import WidgetKit

// YOUR NEXT WORD, WHERE YOU LOOK FIFTY TIMES A DAY.
//
// The app writes into the shared App Group (platform/lockWidget.ts) the next
// word on the user's path in Words, the one waiting to be trained:
//   lastWord     the word, cleaned of punctuation ("playa")
//   lastMeaning  its English ("beach")
// A tap opens Words scrolled to it (loro://words).
// and calls reloadWidget(). The widget only reads; a timeline of one entry
// that never expires, because nothing changes until the app writes again.
//
// Families: lock screen rectangular (word + meaning, under the clock),
// lock screen inline (one line above the clock), and home screen small.

private let appGroup = "group.app.getloro"

struct WordEntry: TimelineEntry {
  let date: Date
  let word: String?
  let meaning: String?
}

struct WordProvider: TimelineProvider {
  func placeholder(in context: Context) -> WordEntry {
    WordEntry(date: Date(), word: "playa", meaning: "beach")
  }

  func getSnapshot(in context: Context, completion: @escaping (WordEntry) -> Void) {
    completion(context.isPreview ? placeholder(in: context) : read())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<WordEntry>) -> Void) {
    completion(Timeline(entries: [read()], policy: .never))
  }

  private func read() -> WordEntry {
    let store = UserDefaults(suiteName: appGroup)
    let word = store?.string(forKey: "lastWord")
    let meaning = store?.string(forKey: "lastMeaning")
    return WordEntry(date: Date(), word: word?.isEmpty == false ? word : nil, meaning: meaning)
  }
}

struct LoroWidgetView: View {
  @Environment(\.widgetFamily) var family
  let entry: WordEntry

  var body: some View {
    switch family {
    case .accessoryInline:
      if let word = entry.word {
        Text("\(word) · \(entry.meaning ?? "")")
      } else {
        Text("Loro · save a word")
      }

    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 1) {
        Text("LORO · NEXT WORD")
          .font(.system(size: 10, weight: .heavy))
          .widgetAccentable()
          .opacity(0.75)
        if let word = entry.word {
          Text(word)
            .font(.system(size: 20, weight: .black, design: .rounded))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
          Text(entry.meaning ?? "")
            .font(.system(size: 13, weight: .semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        } else {
          Text("Save a word")
            .font(.system(size: 17, weight: .bold, design: .rounded))
          Text("It shows up here")
            .font(.system(size: 12, weight: .medium))
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .widgetBackground(Color.clear)

    default:
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 6) {
          Image("loroParrot")
            .resizable()
            .scaledToFit()
            .frame(width: 22, height: 26)
          Text("NEXT WORD")
            .font(.system(size: 10, weight: .heavy))
            .foregroundColor(Color.white.opacity(0.5))
        }
        Spacer(minLength: 0)
        Text(entry.word ?? "Save a word")
          .font(.system(size: 26, weight: .black, design: .rounded))
          .foregroundColor(Color("loroMint"))
          .lineLimit(1)
          .minimumScaleFactor(0.5)
        Text(entry.word == nil ? "in any video" : (entry.meaning ?? ""))
          .font(.system(size: 14, weight: .semibold))
          .foregroundColor(Color.white.opacity(0.8))
          .lineLimit(2)
          .minimumScaleFactor(0.7)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      .widgetBackground(Color("loroInk"))
    }
  }
}

extension View {
  /// iOS 17 wants widgets to declare their background; 16 just draws it.
  @ViewBuilder
  func widgetBackground(_ color: Color) -> some View {
    if #available(iOSApplicationExtension 17.0, *) {
      self.containerBackground(for: .widget) { color }
    } else {
      self.background(color)
    }
  }
}

struct LoroWidget: Widget {
  let kind = "LoroWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: WordProvider()) { entry in
      LoroWidgetView(entry: entry)
        .widgetURL(URL(string: "loro://words"))
    }
    .configurationDisplayName("Next word")
    .description("The next word waiting for you in Loro, and what it means. Tap it to train it.")
    .supportedFamilies([.accessoryRectangular, .accessoryInline, .systemSmall])
  }
}

@main
struct LoroWidgetBundle: WidgetBundle {
  var body: some Widget {
    LoroWidget()
  }
}
