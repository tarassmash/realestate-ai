import Foundation

/// Инструменты обработки. Инструкции для ИИ — те же, что в веб-версии (public/presets.js).
struct Preset: Identifiable, Hashable {
    let id: String
    let symbol: String
    var staging = false      // результат меняет фото — ставим пометку «Виртуальный стейджинг»
    var upscaleOnly = false

    var titleKey: String { "preset.\(id).title" }
    var subtitleKey: String { "preset.\(id).subtitle" }

    static let all: [Preset] = [
        Preset(id: "enhance", symbol: "sparkles"),
        Preset(id: "staging", symbol: "sofa", staging: true),
        Preset(id: "declutter", symbol: "trash", staging: true),
        Preset(id: "empty", symbol: "square.dashed", staging: true),
        Preset(id: "sky", symbol: "sun.max", staging: true),
        Preset(id: "twilight", symbol: "moon.stars", staging: true),
        Preset(id: "lawn", symbol: "leaf", staging: true),
        Preset(id: "refresh", symbol: "paintbrush", staging: true),
        Preset(id: "upscale", symbol: "arrow.up.left.and.arrow.down.right", upscaleOnly: true),
        Preset(id: "custom", symbol: "text.cursor", staging: true),
    ]

    static func byId(_ id: String) -> Preset { all.first { $0.id == id } ?? all[0] }

    private static let base = "This is a real estate listing photo. Keep the exact same room layout, architecture, walls, ceiling, floor, windows, doors, camera angle and perspective. Do not add or remove structural elements and do not change the view through the windows unless asked. Output a photorealistic, professional real estate photograph."

    func prompt(style: StagingStyle, room: RoomType, custom: String) -> String {
        let b = Preset.base
        switch id {
        case "enhance":
            return "\(b) Professionally retouch it: bright, natural, even lighting; balanced HDR exposure so window views are visible and not blown out; accurate neutral white balance (remove yellow or blue color casts); straighten converging vertical lines; crisp detail; remove noise. Do not move, add or remove any furniture or objects."
        case "staging":
            return "\(b) Virtually stage this space as \(room.prompt) with tasteful furniture and decor in \(style.prompt) style. Realistic scale, contact shadows and reflections matching the existing light direction. Keep floors, walls, windows and built-in fixtures exactly unchanged. Bright, inviting, magazine-quality listing photo."
        case "declutter":
            return "\(b) Declutter the space: remove personal items, cables, toiletries, papers, fridge magnets, clothes, bags, shoes, toys, dishes, trash, family photos and small loose objects. Keep the main furniture in place. Leave clean, tidy surfaces."
        case "empty":
            return "\(b) Remove all movable furniture, rugs, decor and objects, leaving a clean, empty room with the bare floor, walls, windows, radiators, sockets and built-in fixtures intact. Fill removed areas with matching floor and wall texture."
        case "sky":
            return "\(b) Replace the sky with a clear, bright blue sky with a few soft white clouds, and adjust the exterior lighting to sunny daylight consistent with the new sky. Keep the building and surroundings unchanged."
        case "twilight":
            return "\(b) Convert this exterior photo into a professional dusk twilight shot: deep blue to warm orange sunset sky, warm glowing interior lights in every window, soft exterior and landscape lighting, gentle reflections. Keep the building unchanged."
        case "lawn":
            return "\(b) Make the lawn and landscaping lush, green and well maintained; tidy the yard and walkways; remove fallen leaves, debris, hoses, trash bins and parked construction items. Keep the building unchanged."
        case "refresh":
            return "\(b) Make the interior look freshly renovated: walls repainted in a clean warm white, remove stains, scuffs and cracks, clean and polish floors, tiles and surfaces. Keep the same materials, layout and furniture."
        case "custom":
            let text = custom.trimmingCharacters(in: .whitespacesAndNewlines)
            return "\(b) Follow this instruction (it may be in any language): \(text.isEmpty ? "Improve the photo." : text)"
        default:
            return ""
        }
    }
}

enum StagingStyle: String, CaseIterable, Identifiable {
    case scandi, modern, minimal, loft, classic, mediterranean, luxury
    var id: String { rawValue }
    var titleKey: String { "style.\(rawValue)" }
    var prompt: String {
        switch self {
        case .scandi: return "Scandinavian: light oak wood, white and beige textiles, cozy minimal decor"
        case .modern: return "modern contemporary: clean lines, neutral palette with warm accents, designer lighting"
        case .minimal: return "minimalist: very few pieces, calm neutral tones, uncluttered"
        case .loft: return "industrial loft: leather, dark metal, warm wood, Edison lamps"
        case .classic: return "classic elegant: upholstered furniture, soft patterns, brass details"
        case .mediterranean: return "Mediterranean: natural linen, rattan, terracotta, olive greens"
        case .luxury: return "luxury premium: high-end designer furniture, marble, velvet, statement chandelier"
        }
    }
}

enum RoomType: String, CaseIterable, Identifiable {
    case auto, living, bedroom, kitchen, office, kids, dining, terrace
    var id: String { rawValue }
    var titleKey: String { "room.\(rawValue)" }
    var prompt: String {
        switch self {
        case .auto: return "the appropriate room type"
        case .living: return "a living room"
        case .bedroom: return "a bedroom"
        case .kitchen: return "a kitchen with dining area"
        case .office: return "a home office"
        case .kids: return "a kids room"
        case .dining: return "a dining room"
        case .terrace: return "a terrace / balcony with outdoor furniture"
        }
    }
}

enum AIModel: String, CaseIterable, Identifiable {
    case pro = "fal-ai/nano-banana-pro/edit"
    case standard = "fal-ai/nano-banana/edit"
    var id: String { rawValue }
    var titleKey: String { self == .pro ? "model.pro" : "model.standard" }
}

enum OutputResolution: String, CaseIterable, Identifiable {
    case r1K = "1K", r2K = "2K", r4K = "4K"
    var id: String { rawValue }
}
