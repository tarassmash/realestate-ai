import UIKit
import Photos

enum ImageTools {
    /// Уменьшить по длинной стороне (с учётом ориентации снимка)
    static func resized(_ image: UIImage, maxSide: CGFloat) -> UIImage {
        let size = image.size
        let scale = min(1, maxSide / max(size.width, size.height))
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
    }

    static func jpegDataURI(_ image: UIImage, maxSide: CGFloat, quality: CGFloat) -> String? {
        guard let data = resized(image, maxSide: maxSide).jpegData(compressionQuality: quality) else { return nil }
        return "data:image/jpeg;base64," + data.base64EncodedString()
    }

    /// Пометка в правом нижнем углу (например «Виртуальный стейджинг · изображение изменено»)
    static func watermarked(_ image: UIImage, text: String) -> UIImage {
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = image.scale
        return UIGraphicsImageRenderer(size: image.size, format: format).image { _ in
            image.draw(at: .zero)
            let fontSize = max(14, image.size.width / 70)
            let attrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: fontSize, weight: .semibold),
                .foregroundColor: UIColor.white,
            ]
            let textSize = (text as NSString).size(withAttributes: attrs)
            let pad = fontSize * 0.6
            let box = CGRect(
                x: image.size.width - textSize.width - pad * 2 - fontSize,
                y: image.size.height - textSize.height - pad * 1.4 - fontSize,
                width: textSize.width + pad * 2,
                height: textSize.height + pad * 1.4
            )
            UIColor.black.withAlphaComponent(0.55).setFill()
            UIBezierPath(roundedRect: box, cornerRadius: fontSize * 0.4).fill()
            (text as NSString).draw(at: CGPoint(x: box.minX + pad, y: box.minY + pad * 0.7), withAttributes: attrs)
        }
    }

    /// Сохранить в «Фото» (нужен только доступ на добавление)
    static func saveToPhotos(_ image: UIImage) async throws {
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else { throw APIError(code: "photos_denied", status: 0) }
        try await PHPhotoLibrary.shared().performChanges {
            PHAssetChangeRequest.creationRequestForAsset(from: image)
        }
    }

    /// Временный файл для «Поделиться»
    static func temporaryFile(_ image: UIImage, name: String) -> URL? {
        guard let data = image.jpegData(compressionQuality: 0.95) else { return nil }
        let safe = name.replacingOccurrences(of: "/", with: "_")
        let url = FileManager.default.temporaryDirectory.appending(path: "\(safe).jpg")
        do {
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }
}
