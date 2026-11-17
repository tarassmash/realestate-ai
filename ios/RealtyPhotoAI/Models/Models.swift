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

struct MeResponse: Decodable {
    let user: User
    let referrals: Referrals?
}

struct AuthResponse: Decodable {
    let user: User
}

struct PublicConfig: Decodable {
    let brand: String?
    let currency: String
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
struct JobStatusResponse: Decodable { let job: Job; let credits: Int }
struct CreateJobResponse: Decodable { let id: String; let credits: Int; let cost: Int }

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

struct IAPProduct: Decodable, Equatable {
    let productId: String
    let packId: String
    let credits: Int
    let popular: Bool
}

struct IAPProductsResponse: Decodable { let products: [IAPProduct] }
struct IAPResult: Decodable { let credited: Bool; let credits: Int }
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
    let model: String
    let resolution: String
    let upscale: Bool
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
