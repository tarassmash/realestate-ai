import Foundation
import SwiftUI

/// Сессия пользователя, баланс и общие настройки сервиса
@MainActor
final class AppModel: ObservableObject {
    @Published var user: User?
    @Published var config: PublicConfig?
    @Published var referrals: Referrals?
    @Published var entitlement: Entitlement?
    @Published var isBootstrapping = true
    @Published var toast: String?
    @Published var showPaywall = false

    private let api = APIClient.shared

    var credits: Int { entitlement?.credits ?? user?.credits ?? 0 }
    var isSubscribed: Bool { entitlement?.subscription.active ?? false }
    var canProcess: Bool { entitlement?.canProcess ?? false }
    var weeklyLimit: Int { entitlement?.usage.limit ?? config?.plan?.weeklyLimit ?? 15 }

    func bootstrap() async {
        config = try? await api.request("/api/config")
        await refreshMe()
        isBootstrapping = false
    }

    func refreshMe() async {
        do {
            let me: MeResponse = try await api.request("/api/me")
            user = me.user
            referrals = me.referrals
            entitlement = me.entitlement
        } catch let error as APIError where error.status == 401 {
            user = nil
        } catch {
            // нет сети — оставляем как есть
        }
    }

    func login(email: String, password: String) async throws {
        let body = AuthBody(email: email, password: password, lang: AppConfig.language, acceptTerms: nil, ref: nil)
        let _: AuthResponse = try await api.request("/api/auth/login", method: "POST", body: body)
        await refreshMe()
    }

    func register(email: String, password: String, acceptTerms: Bool, ref: String?) async throws {
        let body = AuthBody(email: email, password: password, lang: AppConfig.language, acceptTerms: acceptTerms, ref: ref)
        let _: AuthResponse = try await api.request("/api/auth/register", method: "POST", body: body)
        await refreshMe()
        if credits > 0 {
            toast = String(format: String(localized: "auth.welcome %lld"), credits)
        }
    }

    func logout() async {
        let _: OKResponse? = try? await api.request("/api/auth/logout", method: "POST", body: EmptyBody())
        api.clearCookies()
        user = nil
        referrals = nil
        entitlement = nil
    }

    func changePassword(current: String, next: String) async throws {
        let _: OKResponse = try await api.request("/api/me/password", method: "POST", body: PasswordBody(current: current, next: next))
    }

    /// Удаление аккаунта (требование App Store 5.1.1(v) и RGPD)
    func deleteAccount(password: String) async throws {
        let _: OKResponse = try await api.request("/api/me/delete", method: "POST", body: DeleteBody(password: password))
        api.clearCookies()
        user = nil
    }

    func apply(_ value: Entitlement) {
        entitlement = value
        user?.credits = value.credits
    }

    func show(_ message: String) {
        toast = message
    }

    var inviteURL: URL? {
        guard let code = user?.refCode else { return nil }
        return AppConfig.baseURL.appending(queryItems: [URLQueryItem(name: "ref", value: code)])
    }
}
