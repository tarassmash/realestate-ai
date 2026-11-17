import SwiftUI
import UIKit

// MARK: - Цвета бренда

extension Color {
    static let brand = Color("AccentColor")
    static let gold = Color(red: 0.95, green: 0.76, blue: 0.31)
    static let appBackground = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 0.07, alpha: 1) : UIColor(red: 0.961, green: 0.953, blue: 0.937, alpha: 1) })
    static let card = Color(uiColor: .secondarySystemGroupedBackground)
    static let line = Color(uiColor: .separator)
}

// MARK: - Логотип

struct BrandMark: View {
    var size: CGFloat = 32
    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.25)
            .fill(Color.brand)
            .frame(width: size, height: size)
            .overlay(
                Image(systemName: "house.fill")
                    .font(.system(size: size * 0.5, weight: .bold))
                    .foregroundStyle(.white)
            )
            .overlay(alignment: .topTrailing) {
                Circle().fill(Color.gold).frame(width: size * 0.2, height: size * 0.2).padding(size * 0.12)
            }
            .accessibilityHidden(true)
    }
}

// MARK: - Баланс

struct CreditsBadge: View {
    let credits: Int
    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "circle.hexagongrid.fill").foregroundStyle(Color.gold)
            Text("\(credits)").monospacedDigit().bold()
            Image(systemName: "plus.circle.fill").foregroundStyle(Color.brand)
        }
        .font(.subheadline)
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(Color.card, in: Capsule())
        .overlay(Capsule().stroke(credits <= 2 ? Color.orange : Color.line))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(String(format: String(localized: "credits.accessibility %lld"), credits)))
    }
}

// MARK: - Секция

struct SectionCard<Content: View>: View {
    let title: LocalizedStringKey
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.caption.weight(.bold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)
            content
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.card, in: RoundedRectangle(cornerRadius: 16))
    }
}

// MARK: - Юридические ссылки

struct LegalLinksRow: View {
    var body: some View {
        HStack(spacing: 14) {
            Link("legal.terms", destination: AppConfig.termsURL)
            Link("legal.privacy", destination: AppConfig.privacyURL)
            Link("legal.notice", destination: AppConfig.legalNoticeURL)
        }
        .font(.footnote)
    }
}

// MARK: - Камера

struct CameraPicker: UIViewControllerRepresentable {
    var onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    init(onImage: @escaping (UIImage) -> Void) {
        self.onImage = onImage
    }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onImage(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}

// MARK: - «Поделиться»

struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

// MARK: - Уведомление внизу экрана

private struct ToastModifier: ViewModifier {
    @Binding var message: String?

    func body(content: Content) -> some View {
        content.overlay(alignment: .bottom) {
            if let message {
                Text(message)
                    .font(.subheadline.weight(.semibold))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16).padding(.vertical, 12)
                    .background(.ultraThickMaterial, in: RoundedRectangle(cornerRadius: 14))
                    .shadow(radius: 8)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 90)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .task(id: message) {
                        try? await Task.sleep(for: .seconds(3))
                        withAnimation { self.message = nil }
                    }
                    .onTapGesture { withAnimation { self.message = nil } }
            }
        }
        .animation(.spring(duration: 0.3), value: message)
    }
}

extension View {
    func toast(message: Binding<String?>) -> some View {
        modifier(ToastModifier(message: message))
    }
}
