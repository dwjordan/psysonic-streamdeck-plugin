import AppKit
import Foundation

let bgColor = NSColor(red: 0.125, green: 0.133, blue: 0.165, alpha: 1)
let skipSymbolColor = NSColor(red: 0.165, green: 0.627, blue: 0.431, alpha: 1)

struct LogoJob {
	let folder: String
	let basename: String
	let size: Int
	let baseSize: Int
	let logoScale: CGFloat
}

struct SymbolJob {
	let folder: String
	let basename: String
	let symbol: String
	let size: Int
	let baseSize: Int
}

func parseArgs() -> (root: URL, logo: NSImage) {
	let args = Array(CommandLine.arguments.dropFirst())
	guard args.count >= 2 else {
		fputs("usage: render-icons <imgs-root-directory> <logo-png-path>\n", stderr)
		exit(2)
	}

	let root = URL(fileURLWithPath: args[0], isDirectory: true)
	guard let logo = NSImage(contentsOf: URL(fileURLWithPath: args[1])) else {
		fputs("error: could not load logo at \(args[1])\n", stderr)
		exit(1)
	}
	return (root, logo)
}

func retinaFileName(basename: String, size: Int, baseSize: Int) -> String {
	let suffix = size == baseSize * 2 ? "@2x" : ""
	return "\(basename)\(suffix).png"
}

func symbolScale(for size: CGFloat) -> CGFloat {
	if size <= 40 {
		return 0.48
	}
	if size <= 72 {
		return 0.44
	}
	return 0.4
}

func tintedSymbol(_ symbol: NSImage, color: NSColor, symbolSize: NSSize) -> NSImage {
	let tinted = NSImage(size: symbolSize)
	tinted.lockFocus()
	color.set()
	NSRect(origin: .zero, size: symbolSize).fill()
	symbol.draw(
		in: NSRect(origin: .zero, size: symbolSize),
		from: .zero,
		operation: .destinationIn,
		fraction: 1
	)
	tinted.unlockFocus()
	return tinted
}

func renderLogo(logo: NSImage, size: CGFloat, logoScale: CGFloat) -> NSImage? {
	let image = NSImage(size: NSSize(width: size, height: size))
	guard let rep = NSBitmapImageRep(
		bitmapDataPlanes: nil,
		pixelsWide: Int(size),
		pixelsHigh: Int(size),
		bitsPerSample: 8,
		samplesPerPixel: 4,
		hasAlpha: true,
		isPlanar: false,
		colorSpaceName: .deviceRGB,
		bytesPerRow: 0,
		bitsPerPixel: 0
	) else {
		return nil
	}

	image.addRepresentation(rep)
	NSGraphicsContext.saveGraphicsState()
	NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

	bgColor.setFill()
	NSBezierPath(rect: NSRect(x: 0, y: 0, width: size, height: size)).fill()

	let logoSide = size * logoScale
	let drawRect = NSRect(
		x: (size - logoSide) / 2,
		y: (size - logoSide) / 2,
		width: logoSide,
		height: logoSide
	)
	logo.draw(in: drawRect)

	NSGraphicsContext.restoreGraphicsState()
	return image
}

func renderSymbol(symbolName: String, size: CGFloat, color: NSColor) -> NSImage? {
	let image = NSImage(size: NSSize(width: size, height: size))
	guard let rep = NSBitmapImageRep(
		bitmapDataPlanes: nil,
		pixelsWide: Int(size),
		pixelsHigh: Int(size),
		bitsPerSample: 8,
		samplesPerPixel: 4,
		hasAlpha: true,
		isPlanar: false,
		colorSpaceName: .deviceRGB,
		bytesPerRow: 0,
		bitsPerPixel: 0
	) else {
		return nil
	}

	image.addRepresentation(rep)
	NSGraphicsContext.saveGraphicsState()
	NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

	bgColor.setFill()
	NSBezierPath(rect: NSRect(x: 0, y: 0, width: size, height: size)).fill()

	let pointSize = size * symbolScale(for: size)
	let config = NSImage.SymbolConfiguration(pointSize: pointSize, weight: .medium)
	guard let symbol = NSImage(systemSymbolName: symbolName, accessibilityDescription: nil)?
		.withSymbolConfiguration(config) else {
		NSGraphicsContext.restoreGraphicsState()
		return nil
	}
	symbol.isTemplate = true

	let symbolSize = symbol.size
	let drawRect = NSRect(
		x: (size - symbolSize.width) / 2,
		y: (size - symbolSize.height) / 2,
		width: symbolSize.width,
		height: symbolSize.height
	)
	tintedSymbol(symbol, color: color, symbolSize: symbolSize).draw(in: drawRect)

	NSGraphicsContext.restoreGraphicsState()
	return image
}

func writePNG(_ image: NSImage, to url: URL) throws {
	guard
		let tiff = image.tiffRepresentation,
		let rep = NSBitmapImageRep(data: tiff),
		let png = rep.representation(using: .png, properties: [:])
	else {
		throw NSError(domain: "render-icons", code: 1)
	}
	try png.write(to: url)
}

func logoJobs() -> [LogoJob] {
	var result: [LogoJob] = []

	func pair(folder: String, basename: String, baseSize: Int, logoScale: CGFloat) {
		result.append(LogoJob(folder: folder, basename: basename, size: baseSize, baseSize: baseSize, logoScale: logoScale))
		result.append(LogoJob(folder: folder, basename: basename, size: baseSize * 2, baseSize: baseSize, logoScale: logoScale))
	}

	pair(folder: "plugin", basename: "marketplace", baseSize: 256, logoScale: 0.58)
	pair(folder: "plugin", basename: "category-icon", baseSize: 28, logoScale: 0.72)
	pair(folder: "actions/nowplaying", basename: "icon", baseSize: 20, logoScale: 0.72)
	pair(folder: "actions/nowplaying", basename: "key", baseSize: 72, logoScale: 0.62)

	return result
}

func symbolJobs() -> [SymbolJob] {
	var result: [SymbolJob] = []

	func pair(folder: String, basename: String, symbol: String, baseSize: Int) {
		result.append(SymbolJob(folder: folder, basename: basename, symbol: symbol, size: baseSize, baseSize: baseSize))
		result.append(SymbolJob(folder: folder, basename: basename, symbol: symbol, size: baseSize * 2, baseSize: baseSize))
	}

	pair(folder: "actions/skip", basename: "icon", symbol: "forward.end.fill", baseSize: 20)
	pair(folder: "actions/skip", basename: "key", symbol: "forward.end.fill", baseSize: 72)

	return result
}

let (root, logo) = parseArgs()

for job in logoJobs() {
	let folder = root.appendingPathComponent(job.folder, isDirectory: true)
	try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

	let fileName = retinaFileName(basename: job.basename, size: job.size, baseSize: job.baseSize)
	let url = folder.appendingPathComponent(fileName)
	guard let image = renderLogo(logo: logo, size: CGFloat(job.size), logoScale: job.logoScale) else {
		fputs("error: failed to render \(fileName)\n", stderr)
		exit(1)
	}
	try writePNG(image, to: url)
}

for job in symbolJobs() {
	let folder = root.appendingPathComponent(job.folder, isDirectory: true)
	try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

	let fileName = retinaFileName(basename: job.basename, size: job.size, baseSize: job.baseSize)
	let url = folder.appendingPathComponent(fileName)
	guard let image = renderSymbol(symbolName: job.symbol, size: CGFloat(job.size), color: skipSymbolColor) else {
		fputs("error: failed to render \(fileName)\n", stderr)
		exit(1)
	}
	try writePNG(image, to: url)
}

print("rendered Psysonic icons to \(root.path)")
