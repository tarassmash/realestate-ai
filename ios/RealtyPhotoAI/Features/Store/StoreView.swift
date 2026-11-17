import SwiftUI
import StoreKit

struct StoreView: View {
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var store: PurchaseManager
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        CreditsBadge(credits: app.credits)
                        Spacer()
                    }
                    Text("store.subtitle")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    if store.isLoading && store.products.isEmpty {
                        ProgressView().frame(maxWidth: .infinity).padding(40)
                    }

                    ForEach(store.products, id: \.id) { product in
                        PackCard(
                            product: product,
                            credits: store.credits(for: product),
                            popular: store.isPopular(product),
                            busy: store.purchasingId == product.id
                        ) {
                            Task { await store.buy(product) }
                        }
                        .disabled(store.purchasingId != nil)
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Label("store.note.noexpire", systemImage: "checkmark.circle")
                        Label("store.note.cost", systemImage: "info.circle")
                        Label("store.note.apple", systemImage: "apple.logo")
                    }
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                    LegalLinksRow()
                }
                .padding()
            }
            .background(Color.appBackground)
            .navigationTitle(Text("store.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("common.close") { dismiss() }
                }
            }
            .task { await store.loadProducts() }
            .alert(
                Text("common.error"),
                isPresented: Binding(get: { store.errorMessage != nil }, set: { if !$0 { store.errorMessage = nil } })
            ) {
                Button("common.ok", role: .cancel) {}
            } message: {
                Text(store.errorMessage ?? "")
            }
            .onChange(of: app.credits) { old, new in
                if new > old { dismiss() } // кредиты начислены — закрываем
            }
        }
    }
}

private struct PackCard: View {
    let product: Product
    let credits: Int
    let popular: Bool
    let busy: Bool
    let action: () -> Void

    private var perPhoto: String {
        guard credits > 0 else { return "" }
        let value = product.price / Decimal(credits)
        return value.formatted(product.priceFormatStyle)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(String(format: String(localized: "store.photos %lld"), credits))
                    .font(.title2.bold())
                Spacer()
                if popular {
                    Text("store.popular")
                        .font(.caption.bold())
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Color.brand, in: Capsule())
                        .foregroundStyle(.white)
                }
            }
            Text(String(format: String(localized: "store.perPhoto %@"), perPhoto))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Button(action: action) {
                HStack {
                    if busy { ProgressView().tint(.white) }
                    Text(product.displayPrice).bold()
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding()
        .background(Color.card, in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(popular ? Color.brand : Color.line, lineWidth: popular ? 2 : 1)
        )
    }
}
