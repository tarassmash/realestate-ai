import SwiftUI
import UIKit

struct PickedPhoto: Identifiable {
    let id = UUID()
    let image: UIImage   // уже уменьшено до 2560 px
    let name: String
}

/// Локальная задача обработки (до/после на экране «Обработка»)
struct LocalJob: Identifiable {
    enum State: Equatable { case waiting, sending, processing, done, failed }

    let id = UUID()
    let source: UIImage
    let thumb: UIImage
    let name: String
    let preset: Preset
    let prompt: String
    let model: AIModel
    let resolution: OutputResolution
    let upscale: Bool

    var state: State = .waiting
    var serverId: String?
    var resultURL: String?
    var errorText: String?
    var startedAt: Date?

    var cost: Int { EditorModel.cost(preset: preset, model: model, resolution: resolution) }
}

@MainActor
final class EditorModel: ObservableObject {
    @Published var picked: [PickedPhoto] = []
    @Published var preset: Preset = Preset.all[0]
    @Published var style: StagingStyle = .scandi
    @Published var room: RoomType = .auto
    @Published var customText = ""
    @Published var model: AIModel = .pro
    @Published var resolution: OutputResolution = .r2K
    @Published var upscale = false
    @Published var markStaging = true
    @Published var jobs: [LocalJob] = []

    private var active = 0
    private let maxParallel = 3

    nonisolated static func cost(preset: Preset, model: AIModel, resolution: OutputResolution) -> Int {
        if preset.upscaleOnly { return 1 }
        return model == .pro && resolution == .r4K ? 2 : 1
    }

    var costPerPhoto: Int { EditorModel.cost(preset: preset, model: model, resolution: resolution) }
    var totalCost: Int { picked.count * costPerPhoto }

    func add(_ image: UIImage, name: String) {
        picked.append(PickedPhoto(image: ImageTools.resized(image, maxSide: 2560), name: name))
    }

    func remove(_ photo: PickedPhoto) {
        picked.removeAll { $0.id == photo.id }
    }

    /// Поставить выбранные фото в очередь
    func run(app: AppModel) {
        let prompt = preset.prompt(style: style, room: room, custom: customText)
        for photo in picked {
            let job = LocalJob(
                source: photo.image,
                thumb: ImageTools.resized(photo.image, maxSide: 900),
                name: photo.name,
                preset: preset,
                prompt: prompt,
                model: model,
                resolution: resolution,
                upscale: upscale && !preset.upscaleOnly
            )
            jobs.insert(job, at: 0)
        }
        picked.removeAll()
        pump(app: app)
    }

    func retry(_ id: UUID, app: AppModel) {
        guard let i = jobs.firstIndex(where: { $0.id == id }) else { return }
        jobs[i].state = .waiting
        jobs[i].resultURL = nil
        jobs[i].errorText = nil
        jobs[i].serverId = nil
        pump(app: app)
    }

    func removeJob(_ id: UUID) {
        jobs.removeAll { $0.id == id && ($0.state == .done || $0.state == .failed) }
    }

    private func pump(app: AppModel) {
        while active < maxParallel, let index = jobs.lastIndex(where: { $0.state == .waiting }) {
            active += 1
            jobs[index].state = .sending
            let id = jobs[index].id
            Task {
                await process(id, app: app)
                active -= 1
                pump(app: app)
            }
        }
    }

    private func update(_ id: UUID, _ change: (inout LocalJob) -> Void) {
        guard let i = jobs.firstIndex(where: { $0.id == id }) else { return }
        change(&jobs[i])
    }

    private func process(_ id: UUID, app: AppModel) async {
        guard let job = jobs.first(where: { $0.id == id }) else { return }
        do {
            // кодирование в base64 — вне главного потока
            let source = job.source, thumb = job.thumb
            let encoded = await Task.detached(priority: .userInitiated) { () -> (String?, String?) in
                (ImageTools.jpegDataURI(source, maxSide: 2560, quality: 0.92),
                 ImageTools.jpegDataURI(thumb, maxSide: 900, quality: 0.8))
            }.value
            guard let image = encoded.0, let thumbURI = encoded.1 else { throw APIError(code: "bad_image", status: 0) }

            let body = JobBody(
                preset: job.preset.id, prompt: job.prompt, model: job.model.rawValue,
                resolution: job.resolution.rawValue, upscale: job.upscale,
                image: image, thumb: thumbURI, name: job.name
            )
            let created: CreateJobResponse = try await APIClient.shared.request("/api/jobs", method: "POST", body: body)
            app.setCredits(created.credits)
            update(id) { $0.serverId = created.id; $0.state = .processing; $0.startedAt = Date() }

            let started = Date()
            while true {
                try await Task.sleep(for: .seconds(2))
                let status: JobStatusResponse = try await APIClient.shared.request("/api/jobs/\(created.id)")
                if status.job.isDone {
                    app.setCredits(status.credits)
                    update(id) { $0.state = .done; $0.resultURL = status.job.resultUrl }
                    return
                }
                if status.job.isFailed {
                    app.setCredits(status.credits)
                    update(id) { $0.state = .failed; $0.errorText = String(localized: "job.failedRefunded") }
                    return
                }
                if Date().timeIntervalSince(started) > 8 * 60 { throw APIError(code: "timeout", status: 0) }
            }
        } catch let error as APIError {
            update(id) { $0.state = .failed; $0.errorText = error.errorDescription }
            if error.code == "no_credits" { app.show(APIError.message(for: "no_credits")) }
        } catch {
            update(id) { $0.state = .failed; $0.errorText = APIError.message(for: "default") }
        }
    }
}
