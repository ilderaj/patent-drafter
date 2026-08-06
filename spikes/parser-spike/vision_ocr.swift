import Foundation
import Vision
import ImageIO

guard CommandLine.arguments.count > 1 else {
    print("ERR: usage: swift vision_ocr.swift <image> [langs]"); exit(1)
}
let path = CommandLine.arguments[1]
let langs = CommandLine.arguments.count > 2
    ? CommandLine.arguments[2].split(separator: ",").map(String.init)
    : ["zh-Hans", "en-US"]
let url = URL(fileURLWithPath: path)
guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
      let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
    print("ERR: cannot load image via CGImageSource"); exit(1)
}
let request = VNRecognizeTextRequest { req, err in
    if let err = err { print("ERR: \(err)"); return }
    guard let obs = req.results as? [VNRecognizedTextObservation] else { return }
    for o in obs {
        if let top = o.topCandidates(1).first {
            print("\(top.string) [conf:\(String(format: "%.2f", top.confidence))]")
        }
    }
}
request.recognitionLevel = .accurate
request.recognitionLanguages = langs
request.usesLanguageCorrection = true
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
do {
    try handler.perform([request])
    print("DONE")
} catch {
    print("ERR perform: \(error)")
    exit(2)
}
