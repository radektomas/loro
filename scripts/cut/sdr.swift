// HDR iPhone clip → normal (SDR, BT.709) video, tone-mapped by Apple's own
// pipeline (AVFoundation), the same conversion Photos does on a "Most
// Compatible" export. render.py runs this for HLG/PQ sources before cutting.
//
//   swift scripts/cut/sdr.swift <in.mov> <out.mov>
//
// Why not ffmpeg: this Mac's ffmpeg has no zscale/libplacebo, and treating
// HLG as plain BT.2020 gamma (what render.py did before 2026-11-11) blows out
// bright areas and washes the picture: Radek saw it on a white desk + notebook.
//
// Checked 2026-11-11 against AVAssetImageGenerator and QuickLook frames of the
// same clip: identical once those are colour-managed. They come out tagged
// BT.2020 ('nclc' 9-1-9), so compare them through sips -m sRGB, never raw in
// ffmpeg, which ignores the ICC and makes them look flatter than this output.
import AVFoundation
import Foundation

let args = CommandLine.arguments
guard args.count == 3 else {
  FileHandle.standardError.write("usage: swift sdr.swift <in> <out>\n".data(using: .utf8)!)
  exit(2)
}
let src = URL(fileURLWithPath: args[1])
let dst = URL(fileURLWithPath: args[2])
try? FileManager.default.removeItem(at: dst)

let asset = AVURLAsset(url: src)
let sema = DispatchSemaphore(value: 0)
var failure: String?

Task {
  do {
    let composition = try await AVMutableVideoComposition.videoComposition(withPropertiesOf: asset)
    // asking for BT.709 output is what makes AVFoundation tone-map HDR → SDR
    composition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
    composition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
    composition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2

    guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetHighestQuality) else {
      failure = "no export session"
      sema.signal()
      return
    }
    export.videoComposition = composition
    export.outputURL = dst
    export.outputFileType = .mov
    await export.export()
    if export.status != .completed {
      failure = export.error?.localizedDescription ?? "export ended with status \(export.status.rawValue)"
    }
  } catch {
    failure = error.localizedDescription
  }
  sema.signal()
}
sema.wait()
if let failure {
  FileHandle.standardError.write("sdr.swift: \(failure)\n".data(using: .utf8)!)
  exit(1)
}
print("wrote \(dst.path)")
