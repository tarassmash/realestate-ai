import SwiftUI

/// Сравнение «до/после»: потяните или коснитесь, чтобы сдвинуть границу
struct BeforeAfterView<Before: View, After: View>: View {
    let before: Before
    let after: After
    var aspectRatio: CGFloat = 3 / 2
    @State private var position: CGFloat = 0.5

    init(aspectRatio: CGFloat = 3 / 2, @ViewBuilder before: () -> Before, @ViewBuilder after: () -> After) {
        self.aspectRatio = aspectRatio
        self.before = before()
        self.after = after()
    }

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack(alignment: .leading) {
                after.frame(width: w, height: h).clipped()
                before.frame(width: w, height: h).clipped()
                    .mask(alignment: .leading) { Rectangle().frame(width: w * position) }

                Rectangle()
                    .fill(.white)
                    .frame(width: 2, height: h)
                    .shadow(color: .black.opacity(0.35), radius: 3)
                    .offset(x: w * position - 1)
                Circle()
                    .fill(.white)
                    .frame(width: 36, height: 36)
                    .overlay(Image(systemName: "arrow.left.and.right").font(.footnote.bold()).foregroundStyle(.black))
                    .shadow(color: .black.opacity(0.25), radius: 4)
                    .offset(x: w * position - 18)

                cornerTag("compare.before").position(x: 34, y: 18)
                cornerTag("compare.after").position(x: w - 40, y: 18)
            }
            .contentShape(Rectangle())
            .simultaneousGesture(
                DragGesture(minimumDistance: 4)
                    .onChanged { value in position = min(max(value.location.x / w, 0), 1) }
            )
            .onTapGesture { location in
                withAnimation(.easeOut(duration: 0.2)) { position = min(max(location.x / w, 0), 1) }
            }
            .accessibilityElement()
            .accessibilityLabel(Text("compare.accessibility"))
            .accessibilityValue(Text("\(Int(position * 100))%"))
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: position = min(position + 0.1, 1)
                case .decrement: position = max(position - 0.1, 0)
                @unknown default: break
                }
            }
        }
        .aspectRatio(aspectRatio, contentMode: .fit)
        .background(Color.black.opacity(0.85))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func cornerTag(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(.caption2.bold())
            .textCase(.uppercase)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 6))
            .foregroundStyle(.white)
    }
}

/// Картинка с сервера (cookie сессии подставляется автоматически)
struct RemoteImage: View {
    let url: URL?

    var body: some View {
        AsyncImage(url: url, transaction: Transaction(animation: .easeInOut)) { phase in
            switch phase {
            case .success(let image):
                image.resizable().scaledToFit()
            case .failure:
                Image(systemName: "photo").font(.largeTitle).foregroundStyle(.secondary)
            default:
                ProgressView().tint(.white)
            }
        }
    }
}
