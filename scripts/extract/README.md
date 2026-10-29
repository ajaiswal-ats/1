# Local document preparation (extraction, blinding, comparison)

Reproducible local preparation of CV text for the scoring prototype. It is **not** automated candidate scoring, and a
completed extraction does **not** prove the text is an accurate extraction of the PDF.

## Platform boundary
- This is a **local preparation tool for macOS**: it needs macOS, Swift (Xcode Command Line Tools) and Apple PDFKit.
- It is **not** a server or Vercel-compatible extraction backend: Vercel functions run on Linux without PDFKit or Swift.
- A future hosted workflow (for example, staff uploading CVs through the portal) needs a separate processing design:
  an approved processing location and service, a cross-platform extractor validated against these same synthetic
  fixtures, private storage, access control and retention. None of that is built here.

## Dependencies
- macOS with Apple PDFKit (part of the OS) and the Xcode Command Line Tools for `swiftc` (`xcode-select --install`).
- The Swift tool `pdftool.swift` is compiled on first use into `node_modules/.cache/scoring-pdftool/<source fingerprint>/`.
- No network access, no OCR, no external services. Tests fail (they do not skip) when `swiftc` or PDFKit is missing.

## Commands
```
npm run extract -- fixtures <dir>                              # synthetic test PDFs (fictional)
npm run extract -- extract <pdf> --label "Candidate X"         # immutable record + page-marked text
npm run extract -- blind <record.json> --options <options.json>  # derived blinded text + private residual review
npm run extract -- verify <record.json> --reviewer <name> --date <YYYY-MM-DD> --pages all --method <how> --result matches
npm run extract -- compare <old record.json> <new record.json> [--assessment <id>]
npm run extract -- adopt <assessment id> <record.json> --reviewer <name> --reason <why>   # then npm run scoring:run
```
Outputs go to the private, Git-ignored `docs/reference/scoring-inputs/prototype/extractions/` (or a folder inside it).
Nothing is overwritten. Output names never include the source file name; logs print labels, counts and fingerprints only.

## What each status means
- **completed**: the tool ran and produced page text. **failed**: it did not (encrypted, corrupt or unreadable); no text file is written.
- **manual review required**: at least one page is empty, image-only, sparse, has images, columns, hyphenated line breaks, ligature characters or suspicious characters.
- **not checked against PDF**: always, until a person records a verification (`verify`), which states its pages and method.

## Known limitations (tested on synthetic PDFs)
- Text inside images is never extracted (no OCR); image-only pages are flagged, not filled in.
- Reading order follows PDFKit; multi-column pages are flagged for a human check even when the order looks right.
- Hyphenated line breaks are kept ("manage-" / "ment"); ligatures may stay as one character ("ﬃ") or be expanded, depending on the font.
- Quote matching normalises whitespace only. A quote that would match only after ligature (compatibility-character) or
  hyphenation normalisation fails with a `nearMatch` hint for review; it is never treated as a match. Finding a quote
  proves the text is present on that page, not what it means.
- Blinding is best-effort: it can miss identifiers (for example an unsupplied nickname) and remove useful text (a name that is also a company). Every blinding needs the private residual review.
- The environment record (OS build, Swift version, tool fingerprint) identifies the extractor; PDFKit has no separate version.
