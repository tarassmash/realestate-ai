import Foundation
import StoreKit

/// Недельная подписка через App Store (StoreKit 2, auto-renewable).
/// Сервер проверяет подпись Apple (JWS) и открывает доступ; транзакция завершается только после этого.
@MainActor
final class PurchaseManager: ObservableObject {
    @Published private(set) var product: Product?
    @Published private(set) var isLoading = false
    @Published private(set) var isPurchasing = false
    @Published private(set) var isRestoring = false
    @Published var errorMessage: String?

    private weak var app: AppModel?
    private var updatesTask: Task<Void, Never>?

    func start(app: AppModel) {
        self.app = app
        guard updatesTask == nil else { return }
        // продления, Ask to Buy, подтверждение банка, покупка на другом устройстве
        updatesTask = Task { [weak self] in
            for await update in Transaction.updates {
                await self?.handle(update)
            }
        }
        Task { await processUnfinished() }
    }

    func loadProduct() async {
        guard product == nil else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let response: IAPProductsResponse = try await APIClient.shared.request("/api/iap/products")
            product = try await Product.products(for: [response.subscription]).first
            if product == nil { errorMessage = String(localized: "sub.unavailable") }
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = String(localized: "sub.unavailable")
        }
    }

    func subscribe() async {
        guard let product else { return }
        guard let raw = app?.user?.appAccountToken, let token = UUID(uuidString: raw) else {
            errorMessage = APIError.message(for: "auth_required")
            return
        }
        isPurchasing = true
        defer { isPurchasing = false }
        do {
            let result = try await product.purchase(options: [.appAccountToken(token)])
            switch result {
            case .success(let verification):
                await handle(verification)
            case .pending:
                app?.show(String(localized: "sub.pending"))
            case .userCancelled:
                break
            @unknown default:
                break
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// «Восстановить покупки» — обязательная кнопка для подписок
    func restore() async {
        isRestoring = true
        defer { isRestoring = false }
        do { try await AppStore.sync() } catch { /* пользователь мог отменить вход в Apple ID */ }
        var found = false
        for await result in Transaction.currentEntitlements {
            found = true
            await handle(result)
        }
        app?.show(found ? String(localized: "sub.restored") : String(localized: "sub.nothingToRestore"))
    }

    func processUnfinished() async {
        for await result in Transaction.unfinished {
            await handle(result)
        }
    }

    private func handle(_ verification: VerificationResult<Transaction>) async {
        guard case .verified(let transaction) = verification else { return }
        guard transaction.productType == .autoRenewable else {
            await transaction.finish()
            return
        }
        do {
            let entitlement: Entitlement = try await APIClient.shared.request(
                "/api/iap/apple", method: "POST",
                body: IAPBody(signedTransaction: verification.jwsRepresentation)
            )
            let wasSubscribed = app?.isSubscribed ?? false
            app?.apply(entitlement)
            await transaction.finish()
            if entitlement.subscription.active && !wasSubscribed {
                app?.show(String(localized: "sub.success"))
                app?.showPaywall = false
            }
        } catch let error as APIError {
            switch error.code {
            case "unknown_product", "wrong_bundle":
                await transaction.finish()
            default:
                // нет сети / не вошли / подписка другого аккаунта — повторим позже
                if error.status != 401 { errorMessage = error.errorDescription }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
