import Foundation

// MARK: - Ответы сервера

struct User: Decodable, Equatable {
    let email: String
    var credits: Int
    let lang: String?
    let refCode: String
    let isAdmin: Bool
    let appAccountToken: String?
}

struct Referrals: Decodable, Equatable {
    let invited: Int
    let paid: Int
}

// MARK: - Подписка и доступ

struct Subscription: Decodable, Equatable {
    let active: Bool
    let provider: String?   // "apple" | "stripe"
    let expiresAt: Date?
    let cancelAtPeriodEnd: Bool
}

struct Usage: Decodable, Equatable {
    let used: Int
    let limit: Int
    let remaining: Int
}

/// Что доступно пользователю: подписка (лимит недели) и бесплатные пробные фото
struct Entitlement: Decodable, Equatable {
    let subscription: Subscription
    let usage: Usage
    let credits: Int
    let canProcess: Bool
}

struct MeResponse: Decodable {
    let user: User
    let referrals: Referrals?
    let subscription: Subscription
    let usage: Usage
    let credits: Int
    let canProcess: Bool
    var entitlement: Entitlement { Entitlement(subscription: subscription, usage: usage, credits: credits, canProcess: canProcess) }
}

struct AuthResponse: Decodable {
    let user: User
}

struct Plan: Decodable {
    let price: Int
    let currency: String
    let weeklyLimit: Int
}

struct PublicConfig: Decodable {
    let brand: String?
    let currency: String
    let plan: Plan?
    let freeCredits: Int
    let refBonus: Int?
    let refWelcome: Int?
    let supportEmail: String?
}

struct Job: Decodable, Identifiable, Hashable {
    let id: String
    let name: String?
    let preset: String
    let status: String
    let resultUrl: String?
    let error: String?
    let cost: Int?
    let upscale: Bool?
    let hasThumb: Bool?
    let createdAt: Date

    var isDone: Bool { status == "done" && resultUrl != nil }
    var isFailed: Bool { status == "failed" }
    var isRunning: Bool { status == "queued" || status == "running" }
}

struct JobsResponse: Decodable { let jobs: [Job] }
struct JobStatusResponse: Decodable {
    let job: Job
    let subscription: Subscription
    let usage: Usage
    let credits: Int
    let canProcess: Bool
    var entitlement: Entitlement { Entitlement(subscription: subscription, usage: usage, credits: credits, canProcess: canProcess) }
}

struct CreateJobResponse: Decodable {
    let id: String
    let cost: Int
    let subscription: Subscription
    let usage: Usage
    let credits: Int
    let canProcess: Bool
    var entitlement: Entitlement { Entitlement(subscription: subscription, usage: usage, credits: credits, canProcess: canProcess) }
}

struct Payment: Decodable, Identifiable {
    var id: String { "\(createdAt.timeIntervalSince1970)-\(amountCents)-\(pack)" }
    let pack: String
    let credits: Int
    let amountCents: Int
    let currency: String
    let refundedCents: Int
    let receiptUrl: String?
    let invoiceUrl: String?
    let invoicePdf: String?
    let createdAt: Date
}

struct PaymentsResponse: Decodable { let payments: [Payment] }

struct IAPProductsResponse: Decodable {
    let subscription: String   // ID подписки в App Store Connect, например com.realtyphotoai.app.weekly
    let weeklyLimit: Int
}
struct OKResponse: Decodable {}

// MARK: - Тела запросов

struct AuthBody: Encodable {
    let email: String
    let password: String
    let lang: String
    let acceptTerms: Bool?
    let ref: String?
}

struct JobBody: Encodable {
    let preset: String
    let prompt: String
    let image: String
    let thumb: String
    let name: String
}

struct PasswordBody: Encodable { let current: String; let next: String }
struct DeleteBody: Encodable { let password: String }
struct IAPBody: Encodable { let signedTransaction: String }
struct EmptyBody: Encodable {}

// MARK: - Форматирование

enum Money {
    static func format(cents: Int, currency: String) -> String {
        let value = Decimal(cents) / 100
        return value.formatted(.currency(code: currency.uppercased()))
    }
}
