import Foundation
import StoreKit

/// Покупка пакетов фото через App Store (StoreKit 2).
/// Сервер проверяет подпись Apple (JWS) и начисляет кредиты; транзакция завершается только после начисления.
@MainActor
final class PurchaseManager: ObservableObject {
    @Published private(set) var products: [Product] = []
    @Published private(set) var catalog: [String: IAPProduct] = [:]
    @Published private(set) var isLoading = false
    @Published private(set) var purchasingId: String?
    @Published var errorMessage: String?

    private weak var app: AppModel?
    private var updatesTask: Task<Void, Never>?

    func start(app: AppModel) {
        self.app = app
        guard updatesTask == nil else { return }
        // покупки, завершённые вне приложения (Ask to Buy, SCA-подтверждение банка, другое устройство)
        updatesTask = Task { [weak self] in
            for await update in Transaction.updates {
                await self?.handle(update)
            }
        }
        Task { await processUnfinished() }
    }

    func loadProducts() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let response: IAPProductsResponse = try await APIClient.shared.request("/api/iap/products")
            catalog = Dictionary(uniqueKeysWithValues: response.products.map { ($0.productId, $0) })
            let loaded = try await Product.products(for: response.products.map(\.productId))
            products = loaded.sorted { (catalog[$0.id]?.credits ?? 0) < (catalog[$1.id]?.credits ?? 0) }
            if products.isEmpty { errorMessage = String(localized: "store.unavailable") }
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = String(localized: "store.unavailable")
        }
    }

    func credits(for product: Product) -> Int { catalog[product.id]?.credits ?? 0 }
    func isPopular(_ product: Product) -> Bool { catalog[product.id]?.popular ?? false }

    func buy(_ product: Product) async {
        guard let raw = app?.user?.appAccountToken, let token = UUID(uuidString: raw) else {
            errorMessage = APIError.message(for: "auth_required")
            return
        }
        purchasingId = product.id
        defer { purchasingId = nil }
        do {
            let result = try await product.purchase(options: [.appAccountToken(token)])
            switch result {
            case .success(let verification):
                await handle(verification)
            case .pending:
                app?.show(String(localized: "store.pending"))
            case .userCancelled:
                break
            @unknown default:
                break
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func processUnfinished() async {
        for await result in Transaction.unfinished {
            await handle(result)
        }
    }

    private func handle(_ verification: VerificationResult<Transaction>) async {
        // неподтверждённые устройством транзакции не засчитываем
        guard case .verified(let transaction) = verification else { return }
        guard transaction.productType == .consumable, transaction.revocationDate == nil else {
            await transaction.finish()
            return
        }
        do {
            let result: IAPResult = try await APIClient.shared.request(
                "/api/iap/apple", method: "POST",
                body: IAPBody(signedTransaction: verification.jwsRepresentation)
            )
            app?.setCredits(result.credits)
            await transaction.finish()
            if result.credited {
                let credits = catalog[transaction.productID]?.credits ?? 0
                app?.show(String(format: String(localized: "store.success %lld"), credits))
            }
        } catch let error as APIError {
            switch error.code {
            case "revoked", "unknown_product", "wrong_bundle":
                await transaction.finish() // начислять нечего
            default:
                // нет сети / не вошли / покупка с другого аккаунта — оставляем, дозачислим позже
                if error.status != 401 { errorMessage = error.errorDescription }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
