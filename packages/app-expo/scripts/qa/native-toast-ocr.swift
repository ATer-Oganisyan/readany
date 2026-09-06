// Read-only native QA helper: find only the transient import-toast action.
// Compile with swiftc, then pass a screenshot path and Details or Cancel.
import Foundation
import Vision
import ImageIO

guard CommandLine.arguments.count == 3,
      ["Details", "Cancel"].contains(CommandLine.arguments[2]) else {
  fatalError("Usage: native-toast-ocr screenshot.png Details|Cancel")
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
  fatalError("Cannot read screenshot")
}
let wanted = CommandLine.arguments[2]
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["en-US"]
try VNImageRequestHandler(cgImage: image).perform([request])
let matches = (request.results ?? []).compactMap { observation -> [String: Any]? in
  guard let text = observation.topCandidates(1).first,
        text.string.caseInsensitiveCompare(wanted) == .orderedSame,
        text.confidence > 0.8 else { return nil }
  let rect = observation.boundingBox
  return ["text": text.string, "confidence": text.confidence,
          "left": rect.minX * Double(image.width),
          "top": (1 - rect.maxY) * Double(image.height),
          "right": rect.maxX * Double(image.width),
          "bottom": (1 - rect.minY) * Double(image.height)]
}
let output = try JSONSerialization.data(withJSONObject: matches, options: [.sortedKeys])
print(String(decoding: output, as: UTF8.self))
