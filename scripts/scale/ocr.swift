// Read the text on Instagram covers with Apple's on-device text recognition
// (Vision). Free, local, no network. Used by scripts/scale/enrich.mts to get
// the hook off reels posted before /cut existed.
//
//   swift scripts/scale/ocr.swift cover1.jpg cover2.jpg …
//
// Prints one JSON line per image: {"path": "...", "lines": [{"text": "...", "h": 0.05}, …]}
// with lines top to bottom and h = the line's box height as a share of the image.
import AppKit
import Foundation
import Vision

for path in CommandLine.arguments.dropFirst() {
  var lines: [[String: Any]] = []
  if let img = NSImage(contentsOfFile: path),
    let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil)
  {
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = true
    req.recognitionLanguages = ["en-US", "es-ES"]
    try? VNImageRequestHandler(cgImage: cg).perform([req])
    let found = (req.results ?? []).compactMap { o -> (CGFloat, String, CGFloat)? in
      guard let t = o.topCandidates(1).first else { return nil }
      return (o.boundingBox.minY, t.string, o.boundingBox.height)
    }
    // Vision's y runs bottom-up: sort descending for top-to-bottom
    lines = found.sorted { $0.0 > $1.0 }.map { ["text": $0.1, "h": Double($0.2)] }
  }
  let out: [String: Any] = ["path": path, "lines": lines]
  if let data = try? JSONSerialization.data(withJSONObject: out), let s = String(data: data, encoding: .utf8) {
    print(s)
  }
}
