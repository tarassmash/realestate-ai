import SwiftUI

struct AuthView: View {
    enum Mode: String, CaseIterable, Identifiable {
        case signup, login
        var id: String { rawValue }
    }

    @EnvironmentObject private var app: AppModel
    @State private var mode: Mode = .signup
    @State private var email = ""
    @State private var password = ""
    @State private var acceptTerms = false
    @State private var inviteCode = ""
    @State private var showInvite = false
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Field?

    private enum Field { case email, password, invite }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 10) {
                    BrandMark(size: 40)
                    Text("Realty Photo AI").font(.title2.bold())
                }
                .padding(.top, 24)

                Text("auth.headline").font(.largeTitle.bold()).fixedSize(horizontal: false, vertical: true)
                Text("auth.subheadline").foregroundStyle(.secondary)

                Picker("", selection: $mode) {
                    Text("auth.signup").tag(Mode.signup)
                    Text("auth.login").tag(Mode.login)
                }
                .pickerStyle(.segmented)

                if mode == .signup, let free = app.config?.freeCredits, free > 0 {
                    Label(String(format: String(localized: "auth.gift %lld"), free), systemImage: "gift.fill")
                        .font(.subheadline.weight(.semibold))
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                }

                VStack(spacing: 12) {
                    TextField("auth.email", text: $email)
                        .keyboardType(.emailAddress)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .email)
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                    SecureField("auth.password", text: $password)
                        .textContentType(mode == .signup ? .newPassword : .password)
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit { Task { await submit() } }
                }
                .textFieldStyle(.roundedBorder)

                if mode == .signup {
                    Text("auth.passwordHint").font(.caption).foregroundStyle(.secondary)

                    Toggle(isOn: $acceptTerms) {
                        Text(LocalizedStringKey(String(format: String(localized: "auth.acceptTerms %@ %@"),
                                                       AppConfig.termsURL.absoluteString, AppConfig.privacyURL.absoluteString)))
                            .font(.footnote)
                    }
                    .toggleStyle(CheckboxToggleStyle())

                    if showInvite {
                        TextField("auth.inviteCode", text: $inviteCode)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .textFieldStyle(.roundedBorder)
                            .focused($focus, equals: .invite)
                    } else {
                        Button("auth.haveInvite") { showInvite = true; focus = .invite }.font(.footnote)
                    }
                }

                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }

                Button {
                    Task { await submit() }
                } label: {
                    HStack {
                        if busy { ProgressView().tint(.white) }
                        Text(LocalizedStringKey(mode == .signup ? "auth.createAccount" : "auth.login")).bold()
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .tint(.primary)
                .foregroundStyle(Color(uiColor: .systemBackground))
                .controlSize(.large)
                .disabled(busy || email.isEmpty || password.isEmpty)

                if mode == .login, let support = app.config?.supportEmail, !support.isEmpty,
                   let mail = URL(string: "mailto:\(support)") {
                    Link(destination: mail) {
                        Text("auth.forgot").font(.footnote)
                    }
                }

                LegalLinksRow().padding(.top, 8)
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
        .onChange(of: mode) { _, _ in error = nil }
    }

    private func submit() async {
        error = nil
        if mode == .signup && !acceptTerms {
            error = APIError.message(for: "terms_required")
            return
        }
        busy = true
        defer { busy = false }
        do {
            let mail = email.trimmingCharacters(in: .whitespaces)
            if mode == .signup {
                let code = inviteCode.trimmingCharacters(in: .whitespaces)
                try await app.register(email: mail, password: password, acceptTerms: true, ref: code.isEmpty ? nil : code)
            } else {
                try await app.login(email: mail, password: password)
            }
        } catch let err as APIError {
            error = err.errorDescription
            if err.code == "email_taken" { mode = .login }
        } catch {
            self.error = APIError.message(for: "default")
        }
    }
}

/// Галочка в стиле чекбокса (нужна для явного согласия с условиями)
struct CheckboxToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Button { configuration.isOn.toggle() } label: {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .font(.title3)
                    .foregroundStyle(configuration.isOn ? Color.primary : Color.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityHidden(true)
            configuration.label
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityValue(Text(LocalizedStringKey(configuration.isOn ? "common.on" : "common.off")))
        .accessibilityAction { configuration.isOn.toggle() }
    }
}
