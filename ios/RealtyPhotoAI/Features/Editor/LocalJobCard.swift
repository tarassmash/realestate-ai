import SwiftUI

struct LocalJobCard: View {
    let job: LocalJob
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var editor: EditorModel
    @AppStorage("markStaging") private var markStaging = true

    init(job: LocalJob) {
        self.job = job
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack {
                if job.state == .done, let remote = job.resultURL {
                    BeforeAfterView {
                        Image(uiImage: job.thumb).resizable().scaledToFit()
                    } after: {
                        RemoteImage(url: APIClient.shared.resultURL(remote))
                    }
                } else {
                    Image(uiImage: job.thumb)
                        .resizable().scaledToFit()
                        .frame(maxWidth: .infinity)
                        .aspectRatio(3 / 2, contentMode: .fit)
                        .background(Color.black.opacity(0.85))
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .overlay {
                            if job.state != .failed { busyOverlay }
                        }
                }
            }
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(job.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text(LocalizedStringKey(job.preset.titleKey)).font(.caption).foregroundStyle(.secondary)
                    if let error = job.errorText {
                        Text(error).font(.caption).foregroundStyle(.orange)
                    }
                }
                Spacer()
                if job.state == .done, let remote = job.resultURL {
                    ResultActions(remote: remote, name: job.name, preset: job.preset, mark: markStaging)
                }
                if job.state == .done || job.state == .failed {
                    Menu {
                        Button {
                            editor.retry(job.id, app: app)
                        } label: { Label(LocalizedStringKey(job.state == .done ? "job.again" : "job.retry"), systemImage: "arrow.clockwise") }
                        Button(role: .destructive) { editor.removeJob(job.id) } label: { Label("common.remove", systemImage: "trash") }
                    } label: {
                        Image(systemName: "ellipsis.circle").font(.title3)
                    }
                    .accessibilityLabel(Text("common.more"))
                }
            }
            .padding(.top, 8)
        }
        .padding(.bottom, 4)
    }

    private var busyOverlay: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            HStack(spacing: 8) {
                ProgressView()
                Text(statusText(now: context.date)).font(.subheadline.weight(.semibold))
            }
            .padding(.horizontal, 14).padding(.vertical, 9)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        }
    }

    private func statusText(now: Date) -> String {
        switch job.state {
        case .waiting: return String(localized: "job.waiting")
        case .sending: return String(localized: "job.sending")
        default:
            let seconds = Int(now.timeIntervalSince(job.startedAt ?? now))
            return String(format: String(localized: "job.processing %lld"), seconds)
        }
    }
}

/// Сохранить в «Фото» и «Поделиться» — общие для обработки и истории
struct ResultActions: View {
    let remote: String
    let name: String
    let preset: Preset
    let mark: Bool

    @EnvironmentObject private var app: AppModel
    @State private var busy = false
    @State private var shareURL: URL?

    init(remote: String, name: String, preset: Preset, mark: Bool) {
        self.remote = remote
        self.name = name
        self.preset = preset
        self.mark = mark
    }

    var body: some View {
        HStack(spacing: 14) {
            Button { Task { await save() } } label: {
                Image(systemName: "square.and.arrow.down").font(.title3)
            }
            .accessibilityLabel(Text("job.save"))
            Button { Task { await share() } } label: {
                Image(systemName: "square.and.arrow.up").font(.title3)
            }
            .accessibilityLabel(Text("job.share"))
            if busy { ProgressView() }
        }
        .disabled(busy)
        .sheet(item: $shareURL) { url in
            ActivityView(items: [url]).presentationDetents([.medium, .large])
        }
    }

    private func finalImage() async throws -> UIImage {
        let data = try await APIClient.shared.download(APIClient.shared.resultURL(remote))
        guard let image = UIImage(data: data) else { throw APIError(code: "bad_image", status: 0) }
        // пометка «Виртуальный стейджинг» — требование порталов недвижимости
        return mark && preset.staging ? ImageTools.watermarked(image, text: String(localized: "watermark.text")) : image
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            try await ImageTools.saveToPhotos(try await finalImage())
            app.show(String(localized: "job.saved"))
        } catch let error as APIError {
            app.show(error.errorDescription ?? "")
        } catch {
            app.show(APIError.message(for: "default"))
        }
    }

    private func share() async {
        busy = true
        defer { busy = false }
        do {
            let image = try await finalImage()
            shareURL = ImageTools.temporaryFile(image, name: "\(name)_\(preset.id)")
        } catch {
            app.show(APIError.message(for: "download_failed"))
        }
    }
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}
