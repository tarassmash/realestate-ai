import SwiftUI
import StoreKit

/// Экран подписки. Содержит всё, что требует Apple (3.1.2): название, срок, цену за период,
/// условия автопродления, ссылки на Условия и Политику конфиденциальности, «Восстановить покупки».
struct SubscriptionView: View {
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var store: PurchaseManager
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Text("sub.title").font(.largeTitle.bold())

                    VStack(alignment: .leading, spacing: 4) {
                        if let product = store.product {
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text(product.displayPrice).font(.system(size: 44, weight: .bold))
                                Text("sub.perWeek").foregroundStyle(.secondary)
                            }
                        } else if store.isLoading {
                            ProgressView()
                        }
                        Text("sub.autoRenews").font(.footnote).foregroundStyle(.secondary)
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        bullet(String(format: String(localized: "sub.limit %lld"), app.weeklyLimit))
                        bullet(String(localized: "sub.allTools"))
                        bullet(String(localized: "sub.cancelAnytime"))
                    }

                    Button {
                        Task { await store.subscribe() }
                    } label: {
                        HStack {
                            if store.isPurchasing { ProgressView().tint(.white) }
                            Text("sub.subscribe").bold()
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.primary)
                    .foregroundStyle(Color(uiColor: .systemBackground))
                    .controlSize(.large)
                    .disabled(store.product == nil || store.isPurchasing)

                    Button {
                        Task { await store.restore() }
                    } label: {
                        HStack(spacing: 6) {
                            if store.isRestoring { ProgressView() }
                            Text("sub.restore")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .font(.subheadline)
                    .disabled(store.isRestoring)

                    // Обязательный текст об автопродлении (App Store 3.1.2)
                    Text("sub.legal")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    HStack(spacing: 16) {
                        Link("legal.termsOfUse", destination: AppConfig.termsURL)
                        Link("legal.privacy", destination: AppConfig.privacyURL)
                    }
                    .font(.footnote)
                }
                .padding(24)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }
                        .accessibilityLabel(Text("common.close"))
                }
            }
            .task { await store.loadProduct() }
            .alert(
                Text("common.error"),
                isPresented: Binding(get: { store.errorMessage != nil }, set: { if !$0 { store.errorMessage = nil } })
            ) {
                Button("common.ok", role: .cancel) {}
            } message: {
                Text(store.errorMessage ?? "")
            }
            .onChange(of: app.isSubscribed) { _, subscribed in
                if subscribed { dismiss() }
            }
        }
    }

    private func bullet(_ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: "checkmark").font(.footnote.bold())
            Text(text)
        }
    }
}
