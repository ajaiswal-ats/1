// Local PDF tool for the scoring workflow (macOS only; no network). Built and run by scripts/extract/pdf.mjs.
//   pdftool extract <pdf>           JSON on stdout: page count, lock state, and per page: text (PDFPage.string), image
//                                   XObject count, and line-start positions used to flag possible multi-column layouts.
//   pdftool make-fixtures <dir>     Writes the synthetic test PDFs (fictional content only).
// Extraction uses Apple's PDFKit text layer: it does not OCR images, and it may not follow the reading order of a layout.
// The tool never prints a file path or document text to stderr; errors are short codes.
import AppKit
import CoreText
import Foundation
import PDFKit

struct PageOut: Codable { let page: Int; let text: String; let images: Int; let lineStarts: [Double]; let width: Double }
struct DocOut: Codable { let ok: Bool; let error: String?; let pageCount: Int; let locked: Bool; let encrypted: Bool; let pages: [PageOut] }

func fail(_ code: String) -> Never {
  let out = DocOut(ok: false, error: code, pageCount: 0, locked: false, encrypted: false, pages: [])
  print(String(data: try! JSONEncoder().encode(out), encoding: .utf8)!)
  exit(0)
}

/// Image XObjects in the page's resources (images drawn on the page; their text is never extracted).
func imageCount(_ page: PDFPage) -> Int {
  guard let dict = page.pageRef?.dictionary else { return 0 }
  var res: CGPDFDictionaryRef?, xobj: CGPDFDictionaryRef?
  guard CGPDFDictionaryGetDictionary(dict, "Resources", &res), let r = res, CGPDFDictionaryGetDictionary(r, "XObject", &xobj), let x = xobj else { return 0 }
  var n = 0
  CGPDFDictionaryApplyBlock(x, { _, obj, _ in
    var stream: CGPDFStreamRef?
    if CGPDFObjectGetValue(obj, .stream, &stream), let s = stream, let d = CGPDFStreamGetDictionary(s) {
      var name: UnsafePointer<CChar>?
      if CGPDFDictionaryGetName(d, "Subtype", &name), let nm = name, String(cString: nm) == "Image" { n += 1 }
    }
    return true
  }, nil)
  return n
}

func extract(_ path: String) {
  guard FileManager.default.fileExists(atPath: path) else { fail("missing") }
  guard let doc = PDFDocument(url: URL(fileURLWithPath: path)) else { fail("unreadable") }
  if doc.isLocked { print(String(data: try! JSONEncoder().encode(DocOut(ok: false, error: "locked", pageCount: doc.pageCount, locked: true, encrypted: doc.isEncrypted, pages: [])), encoding: .utf8)!); exit(0) }
  var pages: [PageOut] = []
  for i in 0..<doc.pageCount {
    guard let p = doc.page(at: i) else { pages.append(PageOut(page: i + 1, text: "", images: 0, lineStarts: [], width: 0)); continue }
    let bounds = p.bounds(for: .mediaBox)
    let lines = p.selection(for: bounds)?.selectionsByLine() ?? []
    let starts = lines.map { Double($0.bounds(for: p).minX) }
    pages.append(PageOut(page: i + 1, text: p.string ?? "", images: imageCount(p), lineStarts: starts, width: Double(bounds.width)))
  }
  let out = DocOut(ok: true, error: nil, pageCount: doc.pageCount, locked: false, encrypted: doc.isEncrypted, pages: pages)
  print(String(data: try! JSONEncoder().encode(out), encoding: .utf8)!)
}

// ---- synthetic fixtures (fictional content) ----

let box = CGRect(x: 0, y: 0, width: 612, height: 792)

func drawText(_ ctx: CGContext, _ text: String, _ rect: CGRect, font: String = "Helvetica", size: CGFloat = 12) {
  let attrs: [NSAttributedString.Key: Any] = [.font: NSFont(name: font, size: size) ?? NSFont.systemFont(ofSize: size), .foregroundColor: NSColor.black]
  let setter = CTFramesetterCreateWithAttributedString(NSAttributedString(string: text, attributes: attrs))
  let frame = CTFramesetterCreateFrame(setter, CFRange(location: 0, length: 0), CGPath(rect: rect, transform: nil), nil)
  CTFrameDraw(frame, ctx)
}

/// A bitmap with text rendered into it: an image, so its words are not in the text layer.
func textImage(_ text: String) -> CGImage {
  let w = 400, h = 80
  let cs = CGColorSpaceCreateDeviceRGB()
  let bm = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  bm.setFillColor(NSColor.white.cgColor); bm.fill(CGRect(x: 0, y: 0, width: w, height: h))
  drawText(bm, text, CGRect(x: 10, y: 10, width: CGFloat(w - 20), height: CGFloat(h - 20)), size: 18)
  return bm.makeImage()!
}

func makePDF(_ path: String, password: String? = nil, _ pages: [(CGContext) -> Void]) {
  var mb = box
  var info: [CFString: Any] = [kCGPDFContextCreator: "synthetic fixture", kCGPDFContextTitle: "Synthetic fixture"]
  if let pw = password { info[kCGPDFContextUserPassword] = pw; info[kCGPDFContextOwnerPassword] = pw + "-owner" }
  let ctx = CGContext(URL(fileURLWithPath: path) as CFURL, mediaBox: &mb, info as CFDictionary)!
  for draw in pages { ctx.beginPDFPage(nil); draw(ctx); ctx.endPDFPage() }
  ctx.closePDF()
}

func makeFixtures(_ dir: String) {
  let d = URL(fileURLWithPath: dir)
  let p = { (n: String) in d.appendingPathComponent(n).path }
  makePDF(p("normal.pdf"), [
    { drawText($0, "Synthetic Candidate Profile\nPage one opens with the summary: led field sales across a fictional territory.\nOpened 12 new accounts in 2024.", CGRect(x: 72, y: 600, width: 468, height: 120)) },
    { drawText($0, "Page two lists the work history.\nManaged 30 key accounts with quarterly visits.", CGRect(x: 72, y: 600, width: 468, height: 120)) },
    { drawText($0, "Page three ends with education: B.S. in Synthetic Studies.", CGRect(x: 72, y: 600, width: 468, height: 120)) },
  ])
  // The same profile, revised: page 2 changed, page 3 removed (for comparison tests).
  makePDF(p("normal-revised.pdf"), [
    { drawText($0, "Synthetic Candidate Profile\nPage one opens with the summary: led field sales across a fictional territory.\nOpened 12 new accounts in 2024.", CGRect(x: 72, y: 600, width: 468, height: 120)) },
    { drawText($0, "Page two lists the revised work history.\nManaged 25 key accounts with monthly visits.", CGRect(x: 72, y: 600, width: 468, height: 120)) },
  ])
  makePDF(p("columns.pdf"), [{ ctx in
    drawText(ctx, "LEFT-1 alpha column starts\nLEFT-2 alpha column continues\nLEFT-3 alpha column ends", CGRect(x: 72, y: 500, width: 210, height: 200))
    drawText(ctx, "RIGHT-1 beta column starts\nRIGHT-2 beta column continues\nRIGHT-3 beta column ends", CGRect(x: 330, y: 500, width: 210, height: 200))
  }])
  makePDF(p("unicode.pdf"), [{ ctx in
    drawText(ctx, "Unicode: Zürich, naïve, São Paulo, Kraków, €1,200 — résumé.\nLigature test: efficient office workflow. Precomposed: e\u{FB03}cient pro\u{FB01}le.\nHyphenation: the candidate improved territory manage-\nment and planning.", CGRect(x: 72, y: 560, width: 468, height: 160), font: "Times New Roman", size: 14)
  }])
  makePDF(p("mixed.pdf"), [{ ctx in
    drawText(ctx, "Mixed page: this sentence is real text.", CGRect(x: 72, y: 680, width: 468, height: 40))
    ctx.draw(textImage("IMAGEONLY sentinel words"), in: CGRect(x: 72, y: 500, width: 400, height: 80))
  }])
  makePDF(p("image-only.pdf"), [{ ctx in ctx.draw(textImage("SCANNED page sentinel"), in: CGRect(x: 72, y: 500, width: 400, height: 80)) }])
  makePDF(p("empty.pdf"), [{ _ in }])
  makePDF(p("encrypted.pdf"), password: "synthetic-pass", [{ drawText($0, "Encrypted synthetic text.", CGRect(x: 72, y: 600, width: 468, height: 60)) }])
  // Corrupt: the start of a real PDF, cut short.
  let normal = try! Data(contentsOf: URL(fileURLWithPath: p("normal.pdf")))
  try! normal.prefix(300).write(to: URL(fileURLWithPath: p("corrupt.pdf")))
  try! Data("not a pdf at all".utf8).write(to: URL(fileURLWithPath: p("not-a-pdf.pdf")))
}

let args = CommandLine.arguments
guard args.count == 3 else { fail("usage") }
switch args[1] {
case "extract": extract(args[2])
case "make-fixtures": makeFixtures(args[2])
default: fail("usage")
}
